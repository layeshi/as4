# 法律修复独立审查记录

最终状态：`d95fbc1` 的 scoped re-review 通过，P2、P3 已解决，未发现新增问题。下文先保留原终审发现，再记录修正复审；不是未解决问题清单。

# Whole-branch final review

Reviewed range: `f21781a..ba131a9`. Reviewed the final-review package, approved design and implementation plan, progress ledger, all three implementation reports, Task 3 review/correction addendum, affected engine/runtime/persistence/HTTP/read-model/UI paths and regression tests. This is a read-only source review apart from this requested report. No source/index/branch edits, subagents, production operations, or existing suite reruns. Two isolated in-memory probes were run for concrete findings below; neither writes world data.

## Strengths

- Independent semantics selection is consistently applied across all second-epoch premises; VM selection remains separate. Original genesis is preserved, legacy laws/spec snapshots retain their original thresholds, normal open-refound migration rejection is implemented, and frozen fixture JSON was not rewritten.
- Task boundaries integrate cleanly: per-action checkpoints preserve earlier successes, consumed action slots and formal procedure diagnostics; unexpected exceptions reach the command isolation boundary. Fee escrow is established before internal enact/on operations, counted in both-asset conservation, and settled only after rechecking captured recipients.
- Rules recheck holder/ownership/status identity before each invocation, while preserving collect-then-apply within a rule. Shared enact summaries distinguish collection errors, apply failures, partial delivery, false predicates and absence of enact; public views, inbox/model feedback and events reuse the persisted summary without inventing historical results.
- Governance observations use proven program identity and actual formal failures, with isolated current-state daily probes. Fixed opening electorates and procedure-proposal invalidation preserve the approved refound boundaries.
- Durable receipts record outcomes before visible commit and apply without handlers during tail/full replay, including fault, blocked-write and recovery outcomes. Source/result hashes and frame checksums protect the state transition. The prior event durability and complete-corrupt-frame findings are addressed in the final code.
- Recovery probes and discards the original request, distinguishes business failure, and never resubmits. Public protection uses an allowlist; original requests and credentials remain private. Session authorization, mutation gate and serialized recovery integrate with experiment control.

## Issues

### Critical

None found.

### Important

#### P2 — A capacity-rejected migration still enables law semantics 2

- **Location:** `src/e2/engine/index.js:187–191`, specifically the unconditional new `lawSemantics` assignment at line 190.
- **Problem:** `prepareCommand` also wraps the explicit migration of a legacy world. If VM2 post-execution capacity validation rejects that migration, the catch block clones the original legacy state but then adds `{version:2}` before dispatching the capacity protection result. The caller receives a failed migration while the committed world has opted into the new behavior. The rollback does not restore the original semantic version.
- **Impact:** An operator can believe migration failed, expand capacity and resume a world whose action/governance semantics were already changed by the failed request. This violates the approved atomic migration/version boundary. Durable receipts faithfully preserve the wrong outcome, so replay does not repair it.
- **Verified in memory:** Start a valid legacy premise-2 world, enable VM2, then choose a valid `maxWorldBytes` with enough room for the original state but insufficient room for the added semantic field. Before migration: 56,419 bytes with a 56,432-byte limit and `capacityCheck(w).ok === true`. Migration candidate: 56,448 bytes. Actual result: `ok:false`, `reason:'law_execution_capacity'`, yet `w.lawSemantics === {version:2}`; original genesis remains legacy.
- **Minimal exact reproduction from repository root:**

```sh
node --input-type=module <<'EOF'
import { createWorld } from './src/e2/world.js';
import { applyCommand } from './src/e2/engine/index.js';
import { capacityCheck } from './src/e2/engine/law-execution.js';
const w = createWorld({ seed:'review-migration-capacity', premise:2 });
const admin = (op,args={}) => applyCommand(w,{type:'admin',payload:{op,args}}).result;
console.log('vm', admin('law_execution',{version:2}).ok);
const size = Buffer.byteLength(JSON.stringify(w));
console.log('bound', admin('law_execution',{
  version:2,capacity:{maxWorldBytes:size+10}
}).ok, capacityCheck(w).ok);
console.log(admin('law_semantics',{version:2}));
console.log('unexpected semantic opt-in:', w.lawSemantics);
EOF
```

- **Fix:** Preserve the original semantic-version presence/value when handling capacity rejection during migration; capacity protection does not need a semantic opt-in. Keep unexpected-engine-fault handling explicit rather than sharing an unconditional opt-in with capacity failures. Add a focused migration-capacity regression, including durable replay of the failed migration and a subsequent explicit successful retry.

### Minor

#### P3 — Whole-command fault test throws before its intended RNG/inbox mutations

- **Location:** `test/law-command-protection.test.js:19–22`.
- **Problem:** `HANDLERS.say.apply` receives `(ctx, plan)`, but the injected wrapper treats the first argument as the world. `next(s.rng.world)` throws a TypeError because `s.rng` is undefined. Consequently `pushInbox` and the intended secret-bearing exception are never reached. The test does exercise rollback of the first diary action and the real say action, but its unchanged RNG/inbox/wake assertions and exception-message redaction do not exercise the advertised injected mutations.
- **Verified in memory:** Equivalent wrapper recorded `receivesContext:true`, `directRngPresent:false`, `afterRng:false`, while the outer command still returned `law_execution_fault`.
- **Fix:** Mutate `ctx.w.rng.world`, call `pushInbox(ctx.w, ctx.w.agents[b.id], ...)`, and assert a sentinel confirming the intended injection reached the deliberate throw. Preserve the current rollback/privacy assertions across the premise/VM matrix. No production defect was demonstrated by this test-only finding.

## Validation and residual risks

- Inspected the recorded broad-suite summary: **1,310 tests; 1,304 pass, 5 fail, 1 skip**. This is not an all-green final full-suite result. Three functional failures were corrected in later code/harness changes; the final selective log records **113/113 passed**. Prior scoped evidence supports governance, rule/action/outcome, legacy fixtures and the persistence correction. The two findings above are additional to that evidence.
- The remaining E1/E2 720-day timing failures have pre-change evidence; frozen E1 was not changed and its isolated baseline also exceeds its 60-second bound. They are reported limitations rather than new functional findings. No threshold was relaxed.
- The new-semantic performance regression is separate and material: the controlled 548-command, approximately 171-KB-world benchmark is **21.83 s versus 0.408 s legacy**, about **53.5×**, after a reported 35.95% optimization. Full-world command/action cloning, canonical hashes, changed-array receipts and synchronous durability barriers scale with world and command size. The earlier realistic runtime/replay test's 583.6-second duration reinforces the concern; its final optimized duration has not been measured.
- The approved plan does not specify a latency/throughput SLA, production activation is out of scope, and operator documentation explicitly discloses the overhead. I do not infer an additional redesign requirement or a production capacity claim. Representative-world latency, scheduler behavior and journal growth should be measured before any separately authorized activation. The passing small benchmark and bounded functional tests are insufficient evidence of acceptable production throughput.
- Receipt logs/snapshots are intentionally private recovery material; their original requests and state deltas require the existing operational access controls. Public allowlist projections were reviewed and no new private-field leak was found.

## Recommendations

Fix the failed-migration version retention and the test injection in one focused correction wave. Validate the new regression through both direct execution and receipt replay, then rerun only the directly affected semantics/protection/replay coverage. No further broad suite or unrelated architectural work is requested by this review.

## Assessment

**Spec compliance:** Changes requested for the rejected migration that nevertheless activates semantics 2. Apart from that boundary, reviewed behavior follows the binding design, including guarded rights, real daily probes, original-genesis replay, persisted failure facts and discard-only recovery.

**Code quality:** With fixes. Separation between action rollback, command staging and receipt application is clear, and the persistence corrections address the earlier important review findings. One nonblocking test injection defect remains; the measured performance cost must remain explicitly disclosed.

**Ready to merge? With fixes.** Resolve P2 before approval. P3 is small and should be corrected in the same wave. This verdict does not authorize deployment or migration and does not claim a completely green full-suite run or production performance readiness.


---

# Final scoped correction review

Range: `ba131a9..d95fbc1`. Reviewed `final-fix-review.diff`, `final-fix-report.md`, the appended Task 3 report, affected code/test context and the two original final-review findings. Scope is the single consolidated correction wave, not a reopened broad review. No source edits, subagents, production operations or test reruns; only this requested report was written.

## Findings disposition

### P2 — Capacity-rejected migration enables semantics 2: ADDRESSED

`src/e2/engine/index.js:192` now excludes `CapacityError` from the fallback semantic initialization. The failure candidate remains a clone of the original world with its semantic property presence/value preserved; capacity protection still records the rejected command and pauses it. The independent unknown-engine-fault path remains explicit.

The new direct regressions prove that the actual legacy state fits the configured byte limit while the migration candidate exceeds it. They cover absent and null legacy selection, unchanged original genesis/business fields, capacity expansion without opt-in, and a subsequent successful explicit migration. The Runtime regression covers the durable failed outcome, older-snapshot tail recovery and full replay while a replaced handler would now succeed, followed by expansion and explicit retry.

### P3 — Fault injection throws before intended mutations: ADDRESSED

`test/law-command-protection.test.js:20–29` now uses `ctx.w` for RNG and inbox mutation. The sentinel is set only after those mutations and asserted after command execution, so an accidental earlier TypeError cannot satisfy the test. The deliberate secret-bearing exception, rollback/privacy assertions and premise/VM matrix are retained.

## Related integration change

The transient `Runtime.receiptEventsPending` flag preserves the event-before-snapshot durability barrier for receipts whose outcome remains legacy. It is set after successful live receipt append (`src/runtime.js:117`) and when processing a receipt during tail recovery (`:79`), checked before event sync (`:185`), and cleared only after successful snapshot writing (`:190`). It lives on Runtime rather than the persisted world, so it does not alter historical world hashes or public projections. Existing append-failure fail-stop and event-sync-failure handling remain intact; a failed snapshot does not prematurely clear the flag.

This is a necessary, bounded consequence of fixing P2. Both live and tail barrier assertions have separate recorded red evidence, and the final regression exercises both. The operator clarification accurately explains retained legacy semantics and explicit retry. No new important or minor finding was identified in this correction diff.

## Verification evidence

Inspected final output files rather than rerunning their suites:

- `task-3-final-fix-green.log`: **33 passed, 0 failed, 0 skipped**, covering semantics, command protection and receipt replay.
- `task-3-final-persistence-green.log`: **17 passed, 0 failed, 0 skipped**.
- `git diff --check ba131a9..d95fbc1`: clean.

## Assessment

**Spec compliance: approved. Code quality: approved. Ready to merge: Yes.** Both final-review findings are addressed, and the added event barrier closes the direct persistence consequence of retaining legacy semantics after rejected migration. This supersedes the prior final-review “With fixes” verdict for these findings.

Residuals are unchanged: there is no new all-green full-suite result; the recorded baseline E1/E2 timing failures remain disclosed; and the measured approximately **53.5×** modern-versus-legacy benchmark overhead still requires representative capacity assessment before separately authorized activation. This review authorizes neither deployment nor production migration and makes no new throughput claim.

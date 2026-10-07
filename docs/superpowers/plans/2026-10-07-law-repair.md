# Law Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Implement approved F1–F3 / R1–R5 legal-system repairs without rewriting historical worlds.

**Architecture:** Independent law semantics version gates new behavior. Governance, action/rule execution, and durable command protection are sequential deliverables. Each adds real regression tests, then receives a scoped review.

**Tech Stack:** Node ESM, built-in node:test, deterministic JSON worlds and append-only command journals.

**Spec:** docs/superpowers/specs/2026-10-07-law-repair-design.md

## Global Constraints

- All Q1–Q11 approved; execute without renewed confirmation. No deployment or production migration.
- Work only in /home/ctyun/.codex/worktrees/law-repair/as4 on codex/law-repair.
- First epoch and absent lawSemantics remain legacy; do not change existing test helper defaults.
- Read the binding spec and audit REPORT; audit repro.mjs asserts legacy defects, not desired new behavior.
- TDD: write observable desired-behavior tests, run and record expected failures, implement, run covering tests, self-review and commit. No subagents from implementers.
- Every task owns its API/read-model/documentation presentation changes as well as engine behavior; old records must not receive fabricated conclusions.

### Task 1: Versioned governance and procedure recovery

**Files:** Create src/e2/engine/law-semantics.js and test/law-semantics.test.js, test/law-governance-repair.test.js. Modify src/e2/world.js, src/runtime.js genesis selection, src/e2/lore/humanlaws.js, src/e2/engine/{admin,legislation}.js, src/e2/engine/actions/politics.js and relevant governance views/protocol docs.

**Interfaces:** Export usesLawSemantics2(w) => boolean from law-semantics.js. Opt in createWorld({lawSemanticsVersion:2}); genesisOpts must return ORIGINAL genesis selection, never migrated current version. Explicit admin op law_semantics with args {version:2}; w.lawSemantics={version:2} (later task may add protection). Export humanProcedureFor(w) from humanlaws.js returning legacy or exact-2/3 definition. Keep HUMAN_PROCEDURE untouched. Runtime new second-epoch creation opts in; historical createWorld missing option stays legacy.

- [x] Write tests using `newWorld('repair', {lawSemanticsVersion:2})`; assert `w.lawSemantics.version === 2` and `genesisOpts(w).lawSemanticsVersion === 2`. Assert old worlds lack new enumerable fields, migration replay preserves genesis selection, migration with open refounds fails with IDs and deadlines without modifying business state.
- [x] Write governance regressions: 2 yes + 1 no passes NEW constitutional human procedure, legacy 667 threshold still rejects; newborn cannot refound/sign; opening electorate fixed at living age>=3 days, dormant retained, departed removed, newly mature excluded, empty electorate never succeeds; successful refound voids every open city proposal containing procedure (including legacy-origin), preserves ordinary/amend-only and notifies affected participants.
- [x] Write real procedure-fault tests for proposers/voters/weight/decide. Only formal calls record; reads/draft no mutation. Bind source law/class, new proposal source identity, conservative legacy attribution. Daily probe actual saved failed expression context against current world with cloned RNG/no effects: three successive failing DAILY probes revert affected class, success/replacement clears; stale cases clear; none/legal false/zero vote don't count. Existing eligibility recovery remains; no refound cooldown restriction on automatic reversion.
- [x] Run new tests and record failing assertions. Implement version module, selectors, migrations, electorate checks and health observation/probing. Minimal probe records identify expression field, law/class, actor/proposal as applicable. Diagnostic public views exclude private data. Implement current selector in genesis, refound humans and auto restoration only, never rewrite resident expressions or old spec snapshots.
- [x] Run `node --test test/law-semantics.test.js test/law-governance-repair.test.js test/e2-legislation.test.js test/e2-laws.test.js test/e2-bylaws.test.js`; update protocol and governance displays for changed fields and messages; commit.

### Task 2: Rule validity, action escrow and enact outcomes

**Files:** Modify src/e2/engine/{rules,actions,accounts,ledger,bylaws,legislation}.js and relevant views/public UI/model feedback. Create test/law-action-repair.test.js and test/law-outcomes.test.js. May extract a small transaction helper if needed; do not restructure unrelated engine.

**Interfaces:** Consume usesLawSemantics2(w) from src/e2/engine/law-semantics.js. Every new behavior gated. Enact result summary stored alongside existing results, with statuses no_enact/condition_false/success/partial_failure/failure and phase/rule/code diagnostics (names may follow existing conventions consistently). Task 3 consumes atomic action behavior, not an API contract.

- [x] Add failing tests adapted from audit reproductions with NEW semantics enabled. After seize, queued rules for former place owner must not run for daily/monthly/after/on; revalidate active law, non-dissolved group, current rule identity, owner, suspension before EACH rule. Preserve collect-then-apply within one rule.
- [x] Test before divide-by-zero denies action with law/rule/error code, no debit; exempt exit/refound/open-wilderness still work. Reject nonzero coins to soul during fee collection, no coins lost. Validate all fee recipients before settlement; unsupported transfer assets must not silently vanish.
- [x] Test real fee exploit: energy100, action2, fee20, internal maximum forced transfer => group68, agent10, treasury20; both assets conserve. Fees escrowed BEFORE handler.apply, recipients cannot spend before success, internal balance sees net spendable. Include escrow in conservation if exposed during operation.
- [x] Test normal ActError after business mutations rolls back only current action including cost/fees/events/inbox/wakes/RNG, preserves consumed action count, failure diagnostics and earlier successful actions in request. Unexpected exceptions propagate for Task 3 command protection.
- [x] Test city/group/place enact collect errors, apply failures, partial payments and condition-false/no-enact distinctions. Proposal passes and law activates even when enact fails, but results, events, inbox/model feedback and public details expose honest summary; historical records stay unknown and no automatic retry occurs.
- [x] Run tests to observe expected failures; implement minimal changes behind semantics gate. Run `node --test test/law-action-repair.test.js test/law-outcomes.test.js test/e2-laws.test.js test/e2-bylaws.test.js test/law-execution.test.js test/law-cost-proof.test.js test/law-cache-stability.test.js` plus tests covering changed views; update docs and commit.

### Task 3: Durable atomic command faults and verified recovery

**Files:** Modify src/e2/engine/{index,admin,law-semantics,law-execution}.js, src/runtime.js, src/commands.js, src/tools/replay.js, src/experiment-control.js and relevant server/admin/status surfaces. Add test/law-command-protection.test.js, test/law-fault-replay.test.js and operator documentation.

**Interfaces:** Consume usesLawSemantics2(w). Use w.lawSemantics.protection for sanitized public fault status, keep original command payload private and never expose through public views. Recovery admin op law_recover must probe original failed command on isolated copy, discard effects, then unpause only after successful engine/capacity validation. Returning expected business failure is allowed but explicitly distinguished. No automatic resubmission.

- [x] Add failing tests for unknown exception in second action: full COMMAND rollback (first action too), RNG/events/inbox/wakes/ledger unchanged, commandN advances and sanitized fault pause recorded; support every second-epoch premise regardless of VM budget version. Distinguish capacity protections; ordinary resume and capacity changes cannot clear program protection. Protection blocks all normal writes, controlled admin recovery/maintenance only.
- [x] Test recovery still throwing, capacity failure, successful probe, expected business failure, no duplicated register/adopt/payment/tick and no plaintext/hashed credentials or private thoughts exposed publicly. Integrate experiment-control scheduler pause/resume and runtime snapshots.
- [x] Implement durable execution receipts for new semantics: execute on isolated state before making business state externally visible, append/fsync request+recorded outcome together (one framed record) before committing/saving/delivering. Historical request rows remain readable. Record fault diagnostic/outcome sufficient for applyCommand/replay to reproduce failure even after handler repaired. Recovery outcomes likewise must not re-probe and change history during replay. Fail-stop on durable append failure; a crash before append leaves no visible state; after complete append replays exactly; incomplete final row is safely discarded. If equivalent append-only receipt scheme is simpler, document its crash boundaries and prove them. Never persist an unrecorded exception as potentially successful historical request.
- [x] Run failing tests then implement protected command execution and durable replay integration. Existing snapshot serialization, tail startup and full replay must use identical receipts. New-world original genesis and mid-world explicit migration replay equal hashes. Include crashes before/during/after append and snapshot, repaired-handler restart, blocked-write receipt, and recovery receipt tests.
- [x] Add operator instructions for explicit migration/refound blockers/fault diagnosis/recovery/retry; expose sanitized status via admin/public status and model expected error messages. Run `node --test test/law-command-protection.test.js test/law-fault-replay.test.js` and existing runtime/replay/control tests, then full `node --test --test-concurrency=2 test/*.test.js` (exclude fixture recorder scripts); fix related regressions and commit.

## Execution status

Tasks 1–3 implemented. Broad whole-branch review findings fixed in `d95fbc1`; scoped final re-review approved both findings with no new breakage. Full suite: 1304 pass / 5 fail / 1 skip before final corrections; three functional failures corrected and final selective 113/113 passed. Final correction coverage: 33/33 semantics/protection/replay and 17/17 persistence passed. Two baseline timing thresholds remain unmet; new-semantics runtime overhead is separately disclosed. Branch/worktree retained; no integration or production operation performed. See `docs/audits/2026-10-07-165200/REPAIR.md` for evidence and performance limits.

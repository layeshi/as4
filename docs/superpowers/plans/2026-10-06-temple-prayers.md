# Temple Prayers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement temple prayers, resident-earned prayer points, paid adopter replies and independent invention review.

**Architecture:** Keep deterministic prayer state and reward accounting in focused engine modules. Activate the feature with a logged command on current premise-2 runtimes, after historical replay, so old worlds and old command hashes remain unchanged. Account routes authorize human commands and expose sanitized views; a dedicated browser module renders the same flow at the temple, resident and account entry points.

**Tech Stack:** Existing Node.js ES modules, node:test, vanilla browser DOM; no new dependencies.

**Spec:** docs/plans/2026-10-06-prayer-design.md

## Global Constraints

- Prayers: temple only, existing building, 1 energy, one action, once per game day, 600 code points, ordinary law hooks.
- Points are resident-owned, nontransferable, initially zero; all currently linked accounts share them.
- Repair 100 natural-damage basis points = 1 point; completed public projects 10 energy = 1 point; first rescue per recipient/day = 1 point; approved invention = 10 points.
- Automatic rewards cap at 10/day; integer overflow discarded; fractional contribution remainders retained separately; invention awards are outside cap.
- Text reply costs 1 point; energy costs 1 point/unit, added to text cost. One successful reply closes a prayer; no negative balance or partial mutation.
- Only valid adopters reply; admin reviewer must not be an adopter. Public views never expose human actor identity; own/admin audit may.
- Death/retirement closes prayers and removes spendable points; fostering follows resident, invalidates old links; new world starts at zero; no retroactive awards.
- Preserve old replay fixtures, avoid unrelated exports/ files, do not deploy or push.

## Task 1: Deterministic engine, activation and resident perception

**Files:** Create src/e2/engine/prayers.js, src/e2/engine/prayer-rewards.js, src/e2/engine/actions/prayers.js and test/prayers.test.js. Integrate src/e2/engine/{index,actions,environment,projects,dismantle,lifecycle,perception}.js, src/e2/engine/actions/{env,basic}.js, src/e2/lore/actions.js, src/runtime.js and relevant public projections.

**Interfaces:** Engine commands prayer_enable, prayer_reply, invention_review. Actions pray(text), invent(title, text, ref, submission?). Export prayerView(w, agentId?) with sanitized balances/ledger/prayers/inventions. Reply payload {prayerId, actorId, ownerTokenHash, text?, energy?}; review payload {inventionId, actorId, decision:'approved'|'rejected', reason}. HTTP layer is responsible for authenticated actor and independent review eligibility; engine enforces matching owner token for replies, valid state, uniqueness and atomicity.

- [x] Write failing behavioral tests using real createWorld/applyCommand, then run `node --test test/prayers.test.js`.
```js
const w = bareWorld('prayer', { premise: 2 });
applyCommand(w, { type: 'prayer_enable' });
const a = reg(w, '祈愿者');
putAt(w, a, 'temple');
assert.equal(one(w, a, { type: 'pray', text: '愿得到帮助' }).ok, true);
assert.equal(one(w, a, { type: 'pray', text: '再次祈祷' }).ok, false);
```
- [x] Implement validators before mutation, bounded text and amounts, deterministic IDs, private audit versus public events, ledger source for new energy, no forced wake for text.
- [x] Track natural damage only from activation onward, consume eligible damage on every repair so it cannot be claimed twice. Track resident-razed sites; exclude rebuilding and private projects from rewards. Award project contributions only once at completion, with per-resident carry.
- [x] Add invent action and independent command review with duplicate reference prevention, rejection/revision history and 10-point once-only awards. Validate referenced resident works/projects; do not reward human canon.
- [x] Add logged activation after replay; guard all new behavior on feature state and premise 2. Preserve old snapshots and deterministic fixtures, including failed old unknown actions.
- [x] Expose prayer points/rules and own records to agent perception, public sanitized projections to observers; close live requests on exit.
- [x] Verify focused tests plus old golden tests, self-review and commit only task files. Record exact exported shape in report for Task 2.

## Task 2: Authenticated HTTP and private audit

**Files:** Create src/http/prayers.js and test/prayers-http.test.js. Modify src/http/server.js and src/http/accounts.js only as needed for exports or linked-agent summaries.

**Interfaces:** Consume Task 1 commands and prayerView. Produce GET /api/public/prayers?agentId=..., POST /api/account/prayers/:id/reply, GET /api/account/prayers/audit, GET /api/admin/inventions, POST /api/admin/inventions/:id/review. Public result includes enabled, prayers, residents with points/ledger, and inventions; document exact shape for Task 3.

- [x] First write HTTP tests verifying 401 anonymous, 403 unlinked/CSRF/self-review, stale foster links denied, and one success for concurrent replies; run focused test and observe expected failures.
```js
assert.equal((await fetch(base + '/api/account/prayers/p1/reply', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
})).status, 403);
```
- [x] Reuse session/CSRF validation, parse body then revalidate session and current resident link immediately before synchronous rt.exec. Never accept actor identity, owner token, review role or point cost from request body. Authenticate admin independently and disallow any valid adopter link.
- [x] Public views/events expose no actor IDs or credential hashes. Own audit returns only requesting actor entries; admin audit may return all. Read-only historical snapshots continue to preserve prayer records.
- [x] Return clear translated-capable error codes for insufficient points, already answered, unavailable feature and stale links. Add bounded input and test malformed/prototype refs.
- [x] Verify new HTTP tests and existing accounts/HTTP/experiment tests, self-review and commit task files; report endpoint shapes.

## Task 3: Browser flows, protocol docs and integration

**Files:** Create public/prayers-ui.js and test/prayers-ui.test.js; modify public/{e2-tabs,e2-profile,accounts,render,i18n,style}.js or style.css as appropriate, plus README.md and docs/PROTOCOL-2.md.

**Interfaces:** Consume Task 2 endpoints. Export a reusable prayer section/dialog callable from temple detail, resident profile and My Residents; admin review integrates existing admin-account interface. Use existing DOM helpers, session header and localization patterns.

- [x] Write failing DOM tests for balances/history, cost preview, unlinked view, response errors and admin review eligibility. Use real rendering and click handlers with existing fake DOM utilities.
```js
assert.match(panel.textContent, /祈愿点/);
assert.match(panel.textContent, /待回应/);
```
- [x] Build readable list/history with resident names, dates, status, text, balance and point sources. Render user content as text only. Show paid text/energy form only for active linked resident and pending prayer; show combined cost before submit, disable during request, reload after result.
- [x] Add invention review list with work reference, revision history and mandatory reason; no self-review controls. Support Chinese and English, empty/loading/error states and existing read-only snapshot behavior.
- [x] Document actions, costs, earning rules, API permission/privacy boundaries and no retroactive rewards. Update design status to implemented only after verification.
- [x] Run focused UI tests, browser smoke test when available, and diff check. The controller runs the full node:test suite once after integration. Self-review and commit task files.

## Final acceptance

- [x] Independent whole-branch spec/security/replay review, resolve concrete findings.
- [x] Full tests and syntax/diff checks on final state; report worktree and branch, tests and remaining limits. Do not deploy or publish.

## Delivery and verification — 2026-10-06

Implemented on `codex/temple-prayers` in `/home/ctyun/.codex/worktrees/temple-prayers/as4`, based on `8098f32`. No push, merge or deployment. Original workspace changes and exports were left intact.

- Engine/rewards: `919244e`, followed by demolished-site module reward fix `f3eb3ff`. HTTP authorization/audit: `b030b6b`. Browser UI and protocol: `4c1583b`. Final temple identity, standing-order and facade compatibility fixes: `dab8732`.
- Task reviews and whole-branch review completed. Final scoped re-review passed after fixes. No remaining functional review findings.
- Browser smoke test with synthetic local accounts: adopter replied with text plus 2 energy, cost 3 points, balance 5→2; duplicate controls disappeared. Independent administrator inspected referenced work and approved invention, balance 2→12. Logged-out temple/resident views showed public history without reply/review controls or human actor identity. Browser error/warning logs empty. Temporary QA server stopped.
- Final engine/perception/standing/facade tests: `node --test test/prayers.test.js test/e2-perception.test.js test/p2-perception.test.js test/p2-standing.test.js test/e2-skeleton.test.js` — **103 passed, 0 failed**, including 24 prayer behavioral tests.
- HTTP/authentication focused suite: **77 passed**; final UI focused suite: **60 passed**. Covers body-read/session-revocation races, concurrent replies, private audit, snapshot views, point previews and independent review.
- Integrated suite: `node --test --test-concurrency=2` — **1171 tests, 1167 passed, 3 failed, 1 skipped**, 843244 ms. The suite started before the final fix batch; its facade-shape failure was reproduced and fixed without weakening the test, then passed in the final 103-test run. The only outstanding failures are the two pre-existing simulation timing limits below. Full suite was not rerun after the scoped fixes.
- Existing timing failures: `test/e2-sandbox.test.js:759` took 299202 ms against 150000 ms; `test/sandbox.test.js:35` took 136719 ms against 60000 ms. Before implementation the same tests failed at 347914 ms and 196897 ms respectively. Functional/conservation assertions passed; timing thresholds were not changed. Baseline total: 1127 tests, 1124 passed, 2 failed, 1 skipped.
- All 40 changed JavaScript files passed syntax checks; `git diff --check` passed. Historical golden replay fixtures unchanged.
- Local detailed logs: `/tmp/as4-prayers-baseline.log`, `/tmp/as4-prayers-full.log`, `/tmp/as4-prayers-final-batch-focused.log`, `/tmp/as4-prayers-ui-focused-final.log`.

Implementation boundaries: activation is a replayed command after historical load, only for current premise 2; human replies/reviews remain available during experiment pause; resident perception bounds finished history to 20 recent records while retaining all pending records; pre-activation removed-module provenance is unavailable, and post-activation removals are fully tracked. `prayerView` is exported by the engine prayer module, not the shared facade.

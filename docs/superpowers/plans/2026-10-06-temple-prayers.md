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

- [ ] Write failing behavioral tests using real createWorld/applyCommand, then run `node --test test/prayers.test.js`.
```js
const w = bareWorld('prayer', { premise: 2 });
applyCommand(w, { type: 'prayer_enable' });
const a = reg(w, '祈愿者');
putAt(w, a, 'temple');
assert.equal(one(w, a, { type: 'pray', text: '愿得到帮助' }).ok, true);
assert.equal(one(w, a, { type: 'pray', text: '再次祈祷' }).ok, false);
```
- [ ] Implement validators before mutation, bounded text and amounts, deterministic IDs, private audit versus public events, ledger source for new energy, no forced wake for text.
- [ ] Track natural damage only from activation onward, consume eligible damage on every repair so it cannot be claimed twice. Track resident-razed sites; exclude rebuilding and private projects from rewards. Award project contributions only once at completion, with per-resident carry.
- [ ] Add invent action and independent command review with duplicate reference prevention, rejection/revision history and 10-point once-only awards. Validate referenced resident works/projects; do not reward human canon.
- [ ] Add logged activation after replay; guard all new behavior on feature state and premise 2. Preserve old snapshots and deterministic fixtures, including failed old unknown actions.
- [ ] Expose prayer points/rules and own records to agent perception, public sanitized projections to observers; close live requests on exit.
- [ ] Verify focused tests plus old golden tests and full suite, self-review and commit only task files. Record exact exported shape in report for Task 2.

## Task 2: Authenticated HTTP and private audit

**Files:** Create src/http/prayers.js and test/prayers-http.test.js. Modify src/http/server.js and src/http/accounts.js only as needed for exports or linked-agent summaries.

**Interfaces:** Consume Task 1 commands and prayerView. Produce GET /api/public/prayers?agentId=..., POST /api/account/prayers/:id/reply, GET /api/account/prayers/audit, GET /api/admin/inventions, POST /api/admin/inventions/:id/review. Public result includes enabled, prayers, residents with points/ledger, and inventions; document exact shape for Task 3.

- [ ] First write HTTP tests verifying 401 anonymous, 403 unlinked/CSRF/self-review, stale foster links denied, and one success for concurrent replies; run focused test and observe expected failures.
```js
assert.equal((await fetch(base + '/api/account/prayers/p1/reply', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
})).status, 403);
```
- [ ] Reuse session/CSRF validation, parse body then revalidate session and current resident link immediately before synchronous rt.exec. Never accept actor identity, owner token, review role or point cost from request body. Authenticate admin independently and disallow any valid adopter link.
- [ ] Public views/events expose no actor IDs or credential hashes. Own audit returns only requesting actor entries; admin audit may return all. Read-only historical snapshots continue to preserve prayer records.
- [ ] Return clear translated-capable error codes for insufficient points, already answered, unavailable feature and stale links. Add bounded input and test malformed/prototype refs.
- [ ] Verify new HTTP tests and existing accounts/HTTP/experiment tests, self-review and commit task files; report endpoint shapes.

## Task 3: Browser flows, protocol docs and integration

**Files:** Create public/prayers-ui.js and test/prayers-ui.test.js; modify public/{e2-tabs,e2-profile,accounts,render,i18n,style}.js or style.css as appropriate, plus README.md and docs/PROTOCOL-2.md.

**Interfaces:** Consume Task 2 endpoints. Export a reusable prayer section/dialog callable from temple detail, resident profile and My Residents; admin review integrates existing admin-account interface. Use existing DOM helpers, session header and localization patterns.

- [ ] Write failing DOM tests for balances/history, cost preview, unlinked view, response errors and admin review eligibility. Use real rendering and click handlers with existing fake DOM utilities.
```js
assert.match(panel.textContent, /祈愿点/);
assert.match(panel.textContent, /待回应/);
```
- [ ] Build readable list/history with resident names, dates, status, text, balance and point sources. Render user content as text only. Show paid text/energy form only for active linked resident and pending prayer; show combined cost before submit, disable during request, reload after result.
- [ ] Add invention review list with work reference, revision history and mandatory reason; no self-review controls. Support Chinese and English, empty/loading/error states and existing read-only snapshot behavior.
- [ ] Document actions, costs, earning rules, API permission/privacy boundaries and no retroactive rewards. Update design status to implemented only after verification.
- [ ] Run focused UI tests, full node:test suite, browser smoke test when available, and diff check. Self-review and commit task files.

## Final acceptance

- [ ] Independent whole-branch spec/security/replay review, resolve concrete findings.
- [ ] Full tests and syntax/diff checks on final state; report worktree and branch, tests and remaining limits. Do not deploy or publish.

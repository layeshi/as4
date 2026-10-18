# Experiment Assistant Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated client work and review. The user has approved implementation; no further product approval is needed.

**Goal:** Deliver the approved, read-only experiment assistant on web and WeChat with evidence, live authorization, independent cost limits and expiring conversations.

**Architecture:** An independent AssistantService owns jobs and persisted conversations/budget. Evidence retrieval reads authorized projections and branch-aware history; an OpenLux adapter supports streaming text and bounded costs without resident billing. Clients use asynchronous jobs and polling, so WeChat can moderate complete responses.

**Tech Stack:** Node.js ES modules, existing account/history/OpenLux services, native browser modules and existing WeChat Canvas controller.

## Contract (shared by backend and clients)

All API paths start `/api/assistant`, require account cookies except `/status` which returns a guest description. Writes use JSON and `X-Houren-Request: 1`. WeChat uses `X-Houren-Client: wechat`; optional research verification uses `X-Admin-Key`, legacy ownership `X-Owner-Key`. Never save these keys in conversation state or client persistent storage.

- `GET /status`: `{signedIn, available, model, quota:{limit,used,remaining,resetAt}, world:{id,branchId,day,paused,cities}, branches:[{id,worldId,epoch,day,active}], residents:[{id,name,managed}], conversations:[{id,title,updatedAt}]}`.
- `POST /questions`: `{text,conversationId?,scope:{mode:'public'|'resident'|'research',agentId?,lawId?,city?,branchId?,fromDay?,toDay?}}` → 202 `{conversationId,questionId}`. Days are zero-based API values. Omitted branch is current; blank city means all cities.
- `GET /conversations/:id`: `{conversation:{id,title,messages:[{id,role:'user'|'assistant',text,status,at,sources:[{id,title}],error?}]}}`. Status: `generating`, `complete`, `failed`, `cancelled`, `withheld`, `pending` (WeChat moderation). Poll while generating/pending. Messages expire independently after 30 days.
- `POST /questions/:id/cancel`: `{}` → `{ok:true}`.
- `DELETE /conversations/:id`: `{}` → `{ok:true}`.
- `GET /conversations/:id/sources/:sourceId`: `{source:{id,title,text,worldId,branchId,epoch,day?}}`; sources are opaque IDs, all text safely rendered, private access rechecked.
- `GET /api/admin/assistant`: `{config:{model,dailyQuestions,dailyBudgetYuan,timeoutSeconds},models:[{id,available}],usage:{day,costYuan,reservedYuan,calls,failures},available}`.
- `POST /api/admin/assistant`: config fields above → same view. `timeoutSeconds` fixed at 60 initially (read-only display). Model must be verified in published OpenLux catalog.

## Tasks

- [x] 1. Baseline: install locked dependencies; run `npm test` into `/tmp/as4-assistant-baseline.log`, inspect failures before attributing regressions. Copy approved design and merge glossary in isolated branch.
- [x] 2. Persisted state (`src/assistant/store.js`, `test/assistant-store.test.js`): write failing tests for concurrent budget reservations, midnight/restart, 21st request rejection, expiry, deletion and corrupt-store fail-closed. Implement synchronous durable transactions with in-flight reservations charged conservatively after restart. Cost uses existing integer micro-yuan helpers.
- [x] 3. Evidence (`src/assistant/evidence.js`, `test/assistant-evidence.test.js`): tests first for public redaction, current manager ownership, admin key, branch identity and history filter. Only read whitelisted documents, engine public projections, branch public rows or permitted private rows. Aggregate exact counts for matched rows, expose bounded representative events and missing coverage. Bind every source to branch and scope, preserve authorization lineage across follow-ups.
- [x] 4. Model (`src/assistant/model.js`, `test/assistant-model.test.js`): test real SSE-shaped chunks for Chat and Responses, missing usage, incomplete streams and route mismatch. Use existing endpoint validation, catalog cost conversion and usage normalization. Actual deltas update jobs; never synthesize a fake stream from a finished response.
- [x] 5. Service/HTTP (`src/assistant/service.js`, `src/http/assistant.js`, `src/http/server.js`, `test/assistant-http.test.js`): tests first for authentication, async ask/cancel, revoked in-flight permission, source access, model failure and WeChat complete-answer projection. Persist metadata and bounded text, never keys. Enforce one active job per account, bounded global concurrency, 60-second deadline. Reauthorize each poll/finalization and before model input; do not alter the engine.
- [x] 6. Web (`public/assistant.html`, `public/assistant.js`, CSS, navigation/admin entry points): implement signed-in page and guest introduction, scope controls, sessions, polling text, cancel/retry/delete, source modal and admin settings. Preserve existing design tokens and render text via textContent. Provide resident/law detail links. Add client behavior tests.
- [x] 7. WeChat (existing controller/screens/platform): implement native existing screen conventions and same API contract, managed scope, conversations, evidence, input/cancel/retry/delete. No private keys in storage. Hide drafts on background/logout; server moderation is authoritative. Build ordinary mini program using existing scripts, test controller behavior.
- [x] 8. Verify against A1–A14: run targeted tests, full suite, web screenshot/interaction and WeChat offline build/check. Run limited real-model verification only with an available authorized test configuration; if none exists, explicitly record real-provider verification pending rather than claiming it passed. Record actual branch, commit, tests and limitations in `docs/EXPERIMENT-ASSISTANT.md`.

## Completion review

Perform spec review before quality/security review; fix issues and rerun affected checks. Preserve the user's existing checkout. This request authorizes implementation, not production deployment or WeChat publication.

Current review: spec review passed; quality review passed after fixing detached-job storage failure. Final full regression: 1996 passed, 0 failed, 1 skipped. Web integration and WeChat offline build/check passed. External live-model and WeChat device validation are explicitly pending.

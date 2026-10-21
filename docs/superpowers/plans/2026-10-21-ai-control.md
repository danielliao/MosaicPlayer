# AI creation and controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver AI generation, scoped API/MCP, visual preview, voice controller and Chinese/English UI.
**Architecture:** Extend Node/PostgreSQL tenant services, reuse deployment and timeline logic. UI and Android consume scoped contracts; workers reserve budgets before external calls.
**Tech Stack:** Node ESM, PostgreSQL RLS, browser modules, Java Android 23+.
**Spec:** docs/superpowers/specs/2026-10-21-ai-control-design.md

## Global Constraints
Preserve running installs and private signing keys. No real provider requests or production migration. Encrypted provider secrets, hashed API keys, inherited role/store restrictions. External AI defaults off. Chinese/English. No paid retry after uncertainty.

## Review Focus
Concurrent quota races and duplicated client submissions; cross-tenant/global model secret access; SSRF via DNS/redirects and artifacts; revocation/role change during queued work; voice ambiguity and preview mistakenly controlling devices.

### Task 1: Console and preview
Files: public/console/app.js, new ai-ui.js/preview.js/i18n.js, style.css; tests for preview/i18n logic. Implement contract from spec, safe text rendering, mobile layout, locale switch and model/key CRUD. Preview uses public/program.js timeline and group geometry, authenticated cookie media; clearly label actual screenshots. Do not translate user names/prompts. Keep existing pages functional.
- [x] Add tests for preview cursor/locale fallback and observe RED.
- [x] Implement console integration and preview with full contract.
- [x] Run tests and browser checks; commit owned files.

### Task 2: AI storage, providers, worker and authorization
Files: commercial/schema.sql, ai.js, ai-providers.js, outbound.js, server.js; tests/commercial-ai*.test.js. Tables models/quotas/usage/jobs with RLS. Atomic reservation, idempotency and bounded worker, encrypted secrets and network policy. Export installAI returning tick/close and generation API.
- [x] Add isolated DB and local provider protocol tests; observe RED.
- [x] Implement storage/worker/adapters and media validation.
- [x] Prove success, failure, duplicate, concurrency, quota, secret and SSRF isolation tests.

### Task 3: API/MCP integration
Files: commercial/integrations.js, auth.js/server.js/schema.sql, programs.js control export, OpenAPI docs. Dedicated scoped API key auth inherits current issuer permissions; expiry/revocation. Reuse existing group controls, no HTTP loopback proxy. MCP initialize/list/call validated protocol envelopes.
- [x] Test expired/revoked keys, store boundaries, forbidden actions and MCP protocol via HTTP.
- [x] Implement API/MCP/preview and control.
- [x] Run complete commercial suite and document integration examples.

### Task 4: Android controller and localization
Files: android/app/... controller activity, API client, command parser, strings, manifest, tests. Existing player retained; controller mode separate credentials, secure storage, group selection and transcript confirmation. RecognizerIntent with typed fallback, no background microphone. Chinese/English localized controller and core UI.
- [x] Test Chinese/English grammar, unknown commands, confirmation and API boundaries.
- [x] Implement controller UI; build/test/lint signed APK using public checkout key.
- [x] Report physical device limitations; commit owned files.

### Task 5: Validation and release readiness
- [x] Review complete branch and fix important findings with regression tests.
- [x] Core/server/commercial/native/Android checks, actual UI checks, migration idempotency and Gitleaks.
- [x] Update docs and environment template, preserve original runtimes, provide APK and reviewable Git changes.

### Task 6: Mixed screen sizes and orientations
Files: lib/model.js; public/sync.js/player.js/console layout editor and preview; native core protocol/geometry and rendering; Android Protocol/SyncMath/WallView/orientation; capability exchange; geometry tests. Follow added design section. Keep grid defaults and existing identities. Reject unsupported clients on custom layout assignment. Add RED tests covering 1920x1080 landscape +1080x1920 portrait + third different size, 90/180/270 rotations, overlaps/bounds, backward compatibility and ID preservation. Implement coherent geometry in all players and console; run Node, Swift and Android checks and build updated APK. Do not touch AI/UI modules outside layout or controller activity. Acceptance records distinguish math/build checks from real screens.
- [x] Add failing geometry validation/protocol tests.
- [x] Implement editor and shared semantics across players.
- [x] Run tests/build and independent review.

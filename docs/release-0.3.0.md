# 0.3.0 implementation and verification

This release branch combines AI creation and scoped integrations, Android voice/text control, mixed-screen geometry, tenant-aware merchant content workflows, retail media operations and synchronized visual transitions. macOS player is version0.5.0; Android TV is version0.3.0 / code4.

## Included

- Encrypted tenant/global model configuration, monthly reservations and quotas, asynchronous text/image/music/video jobs, explicit cancellation and no automatic paid replay after uncertainty.
- Scoped API keys, REST/OpenAPI, MCP read/control/generation tools, preview and a foreground Android voice controller with explicit action confirmation.
- Freeform screen sizes and rotations, logical-wall preview, backward-compatible grid playback.
- HQ/store content ownership and sharing, weekly planner, draft duplication, day copying, snap dragging, validity dates and explicit immutable-version publication.
- Two-region image/video designer, bounded FFmpeg rendering, immutable render snapshots and ownership/sharing preservation.
- Retail campaign review, region/store/context targeting, store opening calendars, three-panel intake conversion, conservative playback receipts, aggregate POS/control and survey reports.
- Cut/fade transitions in browser/macOS/Android, incoming first-frame protection, previous-frame fallback and independent background music.

See [merchant workflow and reference mapping](merchant-retail-guide.zh-CN.md), [AI/API](ai-and-integrations.md), [screen geometry](freeform-layout.md), [playback evidence](playback-evidence.md), [transitions](transitions.md).

## Verification on 2026-10-21

| Boundary | Evidence |
|---|---|
| Node unit suite | 82 passed, including schedule, ownership, geometry, quotas/SSRF adapters, proof and transition math |
| Classic server | 15 isolated HTTP/WebSocket tests passed |
| Commercial server | 72 passed against disposable PostgreSQL databases; schema applied twice; source media rendered with actual FFmpeg |
| Browser | 141 assertions across11 scenarios using actual390px CDP mobile viewport; decoded PNG/H.264, pointer/keyboard actions, authorization UI and frozen-frame transitions |
| Android | 53 tests, lintRelease, assembleRelease and APK signature verification passed |
| macOS | 13 core checks; universal arm64/x86_64 app build and ad-hoc package verified |
| Source | Independent backend/UI review; Gitleaks and deployment-address/path audit; no original customer assets or signing material included |

Tests use isolated databases, simulated API UI fixtures and synthetic media. They do not establish supplier service availability, physical TV/Mac synchronization, microphone recognition, actual store reporting, deployment, or paid generation. No production database migration or running-server replacement was performed for this branch. Browser/backend tests cover each boundary separately; they are not a full production end-to-end acceptance claim.

## Upgrade considerations

Back up database, files, deployment configuration and AI encryption key before applying schema changes. An app rollback does not undo data migrations. External AI is disabled by default. Actual device completion receipts are deliberately conservative and cannot be sold as audience impressions.

Use an APK signed with the installation's existing signing identity. This repository's build creates its own development key; never publish that key. Normal TV updates need the system installer confirmation. Plain-HTTP LAN update downloads require explicitly opting in at build time; the default public build supports HTTPS updates.

The console includes Simplified Chinese and English. A complete Traditional Chinese catalog is not included. The content designer implements the reference's two-region workflow, not a general-purpose HTML/CSS editor. Weather targeting uses a fresh explicit snapshot, not an automatically connected weather service.

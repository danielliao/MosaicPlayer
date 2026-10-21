# AI creation, integrations and controller

## Installation and models

Upgrade the database with `commercial/schema.sql` using the migration owner and existing grant procedure before starting the new server. Back up the database and persistent data directory together first. Application rollback does not roll back schema or data. Do not run bootstrap against an existing production database.

External generation is **off by default**. Set `COMMERCIAL_AI_ENABLED=true` in the private server environment and restart to enable it. Provider credentials are entered in the console, never in public source. The first start creates `ai-encryption.key` (mode 0600) in the data directory. Keep this file with database backups; losing it makes saved provider credentials unreadable. Do not commit or share it.

Platform administrators configure shared models and allocate a monthly allowance to each tenant. Tenant administrators may configure their own models. New models remain disabled until explicitly enabled. A shared model needs both a positive global monthly cap and a positive tenant allowance. Budgets reset by UTC calendar month. A zero cap disables new submissions; it does not mean unlimited use.

Adapters:

| Adapter | Capability | Base URL convention |
| --- | --- | --- |
| compatible | Text | Appends `/chat/completions`; use a compatible chat model supporting `max_tokens` |
| compatible | Image | Appends `/images/generations`; accepts base64 or public signed image URLs |
| compatible | Video | Appends `/videos`, polls its job and downloads content; current output 4 seconds at 1280×720 |
| minimax | Music | Appends `/music_generation`; MP3 output, optional lyrics, otherwise instrumental |
| gateway | All four | Appends `/generate` to your own compatible gateway |

Model identifiers and endpoint availability depend on the provider account. No keys are bundled and no paid provider request is part of the automated tests.

Gateway request: `{model, kind, prompt, lyrics, max_output_tokens, request_id}`. Text response: `{text, usage?: {total_tokens}}`; media response: `{base64, usage?: {total_tokens}}`, where bytes must be a supported JPEG/PNG/WebP, H.264 MP4, or music file. Use this adapter for other providers with a server-side protocol bridge.

Only public HTTPS destinations are accepted by default. Installation administrators may explicitly allow exact hosts through `COMMERCIAL_AI_ALLOWED_HOSTS` for a trusted internal gateway. This is a privileged network exception, not a tenant-controlled setting. Redirects are disabled and DNS results are pinned. Public artifact downloads never receive the provider bearer credential.

## Quotas and job recovery

Before submission, the worker reserves quota atomically. Text reserves UTF-8 prompt bytes plus maximum output tokens and configured overhead, then settles against valid provider-reported usage. Image/music/video use the administrator's configured **token-equivalent units per job**. These are budgeting units, not claims about a provider's actual token accounting or invoice. Reported provider tokens remain a separate field.

A failed or interrupted request may already have been billed; its reserved estimate is retained. Only cancellation before submission releases the reservation. The service does not automatically resubmit uncertain paid requests after a restart. An unchanged UUID `requestId` returns the same job; using it for different content is rejected. Inspect provider billing before submitting a new request after uncertainty.

Validated media enters only the requesting tenant's library and consumes its storage allowance. Generated text is shown in the studio. Neither is automatically published to devices. Revoked accounts, expired service, disabled models and revoked API keys stop queued jobs. Long-running jobs may still incur provider charges if authorization changes after submission.

## API and MCP

Tenant administrators create expiring keys in **API keys**. The secret is displayed once, stored hashed, and can be revoked immediately. Select only needed scopes: `read`, `control`, `ai`. Current issuer role and store access apply on every request. Device pairing credentials cannot be used as integration keys; integration keys cannot log in to the administration API.

The schema is available at `/api/v1/openapi.json`. Supported endpoints:

- `GET /api/v1/groups`, `/devices`, `/media`, `/groups/:id/preview` (`read`).
- `POST /api/v1/groups/:id/control` (`control`): `{action:"pause"|"resume"|"play",mediaId?}`. `play` prepares a new single asset; pause/resume operate on direct playback, not a scheduled program.
- `GET /api/v1/ai/models`, `POST /api/v1/ai/jobs`, `GET /api/v1/ai/jobs/:id` (`ai`).

```sh
# Set these privately; never paste real keys into issue reports.
export MOSAIC_URL=https://signage.example.com
read -s MOSAIC_API_KEY
export MOSAIC_API_KEY
curl "$MOSAIC_URL/api/v1/groups" -H "Authorization: Bearer $MOSAIC_API_KEY"
```

MCP endpoint: `POST /mcp`, Streamable HTTP JSON responses, protocol `2025-11-25`. Configure the same bearer key in a client that supports custom HTTP authorization headers. OAuth discovery and browser-based OAuth setup are not implemented. Send `Accept: application/json, text/event-stream` and `MCP-Protocol-Version: 2025-11-25` after initialization. GET/SSE sessions and DELETE are not used.

Tools: `mosaic_groups`, `mosaic_devices`, `mosaic_media`, `mosaic_preview`, `mosaic_control`, `mosaic_models`, `mosaic_generate`, `mosaic_job`. Only tools allowed by the key's scope and current role are listed. Generation requires modelId, prompt and UUID requestId. Tool metadata describes control and paid effects; the calling application must obtain its user's intent before invoking them.

## Android controller and preview

In the Android setup page, choose **Controller**. Enter the server and a tenant API key with `read` and `control`, then select a playback group. The controller stores its key using Android Keystore encryption, separately from player pairing. Use a trusted HTTPS server outside a trusted LAN.

Voice uses the foreground Android speech recognizer. If the TV has no recognizer/microphone, type instead. Commands include `pause`, `resume`, `play <exact media name>` and `暂停`, `继续`, `播放<素材名称>`. Inspect/edit the transcript and confirm the target and action before sending. Ambiguous media names and unknown commands do not execute. This is a constrained controller, not an unrestricted voice agent.

The console's playback preview calculates the shared timeline and crops locally; it sends no playback commands or device heartbeats. Actual device screenshot requests remain a separate feature. A simulation is not evidence that a television is displaying correctly.

Console and controller support Chinese and English; user-entered names and prompts remain unchanged. Backend diagnostic messages and the legacy macOS setup interface may retain their original language.

## Verification boundary

Provider adapters are tested against local fixtures, and tenant isolation, quota races, revocation, media validation and migrations against isolated PostgreSQL. Real paid providers, voice recognition hardware, TV performance and mixed-panel synchronization require a test installation. The public checkout generates its own Android signing key, so its APK cannot overwrite an installation signed by a different private key.

Protocol references: [image generation](https://developers.openai.com/api/reference/resources/images), [video generation](https://developers.openai.com/api/reference/resources/videos/methods/create), [MiniMax music](https://platform.minimax.io/docs/api-reference/music-generation), [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

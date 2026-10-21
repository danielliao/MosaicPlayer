# Commercial API v2 implementation contract

All JSON responses errors `{error:string}` non2xx. IDs UUID except imported legacy screen/media IDs retained as text. Tenant derived from authenticated identity; API does not accept arbitrary tenant context except platform support session. Unknown cross-scope IDs return404.

## Admin

Cookie session; `GET /api/session` -> `{user:{id,name,role,tenantId,storeIds,mustChangePassword},csrf,tenant?}`; unauth401. Every write has `X-CSRF-Token`. JSON posts/puts use Content-Type. Same-origin required where Origin supplied.

- POST `/api/login` `{username,password}` -> session object, cookie.
- POST `/api/logout`; POST `/api/password` `{currentPassword,newPassword}`.
- GET/POST `/api/platform/tenants`, PUT `/api/platform/tenants/:id` fields `{name,status:"active"|"suspended",expiresAt,limits:{stores,devices,users,storageBytes},adminUsername?,adminPassword?}`. POST creates tenant/admin.
- POST `/api/platform/support` `{tenantId,reason}` enters explicit audited tenant session; DELETE returns platform.
- GET/POST `/api/users`, PUT `/api/users/:id` `{name,username,role,storeIds,enabled,password?}`. Roles `tenant_admin`, `operator`, `store_operator`, `viewer`; platform `platform_admin`.
- GET/POST `/api/stores`, PUT/DELETE `/api/stores/:id` `{name,timezone,templateVersionId?}`.
- GET/POST `/api/groups`, PUT/DELETE `/api/groups/:id` `{name,storeId,layout?,audioScreenId?,templateVersionId?}`. layout existing cols/rows/tileWidth/tileHeight/gapX/gapY/screens; server creates screen IDs.
- GET `/api/devices` -> array `{id,name,storeId,groupId,screenId,online,lastSeen,report,latestScreenshot?}`.
- PUT `/api/devices/:id` `{name?,groupId?,screenId?}` (same tenant explicit reassignment revokes old binding); DELETE unbinds.
- POST `/api/pairing` `{storeId,groupId?}` -> `{code,expiresAt}`.
- GET `/api/media` -> array existing metadata plus sha256,type audio supported,width/height0 audio.
- POST `/api/media` multipart file -> asset201; DELETE `/api/media/:id` archive if referenced.
- GET `/media/:id` authenticated Range.
- GET/POST `/api/templates`, PUT `/api/templates/:id` `{name,description,defaultProgram,slots}`.
- POST `/api/templates/:id/publish` -> version; GET `/api/templates/:id/versions`.
- GET `/api/versions` -> array published versions (id,templateId,name,createdAt,body).
- GET/POST `/api/deployments` POST `{versionId,groupIds,activateAt?,replacePending?:boolean}` -> batch entries. GET entries include status/progress/errors.
- POST `/api/deployments/:id/cancel`; POST `/api/deployments/:id/retry`.
- POST `/api/groups/:id/playback` `{action:"play"|"pause"|"resume"|"stop",mediaId?}` legacy direct single-asset/manual operation.
- POST `/api/devices/:id/screenshot` -> request; GET `/api/devices/:id/screenshots`; GET `/api/screenshots/:id/image`.
- GET `/api/releases` -> array; POST `/api/releases` platform multipart APK file + releaseNotes (server validates APK metadata).
- POST `/api/updates` `{releaseId,deviceIds,activateAt?}`; GET `/api/updates`.
- GET `/api/audit` -> array paginated via query limit/cursor.
- GET `/api/overview` -> tenant counters, usage/limits, recent deployments.
- GET `/api/network` -> `{addresses}`; GET `/api/health` -> no secrets.

Template program: `{playlist:[{mediaId,durationMs}],music:[{mediaId,durationMs}],audioMode:"muted"|"music"|"video",volume:0..1}`. Images durationMs required >=1000; audio/video durations from ffprobe enforced server-side. Default must have playlist (for music-only choose static background). Slots `{id?,name,startDate:"YYYY-MM-DD",endDate:"YYYY-MM-DD",weekdays:[1..7],startTime:"HH:mm",endTime:"HH:mm",program}`. Equal start/end invalid, overnight valid.

## Device

Bearer key auth; new clients send `X-Mosaic-Capabilities: programs,audio,screenshot,updates` as supported (Mac no updates). Browser advertises `programs,audio` only in a secure context (HTTPS or localhost), and does not advertise screenshot/update capabilities. Key maps physical device + tenant/store/group/screen. New pairing still retains screenId/key response.

- GET `/api/discovery` no authentication, `{service:"mosaic-player",protocolVersion:2,serverId,name,published:false,screens:[],pairingRequired:true}`.
- POST `/api/pairing/resolve` `{code}` -> `{groups:[{id,name,layout}]}`. Short-lived one-device authorization; resolve does not consume.
- POST `/api/pair` `{code,screenId,deviceId?,name?,client?}` -> `{screenId,key,deviceId}` atomically consumes code.
- GET `/api/device/state` -> `{state,serverTime,commands:[]}`.
- GET `/api/state` legacy shape scoped by key; new capability header may receive v2 additions. Device auth never returns other devices/keys.
- `/ws` authenticated Bearer (native) or key query(browser); `state` message `{type,state,serverTime}`; clock `{type:"clock",id}` response existing. report `{type:"report",...existing,capabilities:[...],programId?,mediaId?,version?,updateStatus?}`. ready/failed existing `{type,id,error?}`.
- WS `command` message `{type:"command",command:{id,type:"screenshot"|"update",...}}`. Also commands returned by device state for polling recovery.
- POST `/api/device/report` report JSON HTTP fallback.
- POST `/api/device/screenshots/:requestId` binary image/jpeg max256KiB; metadata headers `X-Captured-At` epochms, `X-Program-Id`, `X-Media-Id`; backend resolves scope from device.
- POST `/api/device/commands/:id` `{status,error?,versionCode?}`.
- Update command `{id,type:"update",versionCode,versionName,sha256,size,packageName:"local.mosaic.tv",minSdk,url:"/api/device/updates/<id>/apk",releaseNotes,activateAt}`. GETurl device-auth; installer validates own installed signer too.

state retains layout/media/playback (v1), adds `program:null|Manifest`, `pendingProgram:null|{id,program:Manifest}`, `audioScreenId:null|string`. All media include only current/pending/manual authorized dependencies. Program prepared response uses existing ready id = pendingProgram.id. Native new clients v1 pending path unchanged.

Manifest `{id,versionId,activateAt,validUntil,defaultProgram,intervals:[{start,end,program}]}` all numeric dates epoch milliseconds. Program resolved: choose interval start<=now<end else default; timeline anchor interval.start or manifest.activateAt. Playlist modulo sum durations, position seconds. Music separate modulo own durations, same anchor. Before activateAt retain previous manifest. After validUntil use defaultProgram. Video duration mismatch correction wraps by declared duration. Each deployment gets unique manifest id.

`state.program` becomes active on committed group epoch. `pendingProgram` is preparable whole manifest before commit; ready all online required. Server replaces manifest.activateAt on immediate commit to now+2000; scheduled activation remains requested timestamp. Clients retain current program until new activateAt. Persist manifest/media/cache for offline restore; avoid legacy global catalog audio validation.

For legacy clients state omits programs and audio assets; publishing programs requires capability `programs` on currently online players and registered devices that have reported a version. Old devices remain usable with direct single-media playback.

## Worker interface changes

Record any required variation here and notify other workers before changing shared names. Implement all public responses with consistent camelCase. No token/credential returned through list APIs.

### Final backend additions (2026-10-20)

- Group responses include `templateVersionId` (assigned target, distinct from currently active `program`) and `inheritsStoreTemplate`. Group PUT `templateVersionId:null` restores inheritance; a UUID selects an explicit override. Store default changes schedule inheriting existing groups; new groups inherit automatically. Explicit version deployments set successful groups to overrides. Store/group mutation responses include `assignmentResults` with durable per-group outcomes; a failed assignment preserves current playback. Clearing a default preserves already signed playback until another explicit operation.
- Multi-group deployments have a server-generated `batchId`; authorization and timestamp validation happen before mutation, then operational failures produce independent `status:"failed"` records with `errors.submission`. Single-group operational failures retain non-2xx `{error}` behavior. Retrying a failed group does not replay successful siblings.
- Direct single-media actual-render reports include `status:"playing"`, actual `mediaId`, and `preparationId` and/or `playbackRevision` (legacy `revision` accepted). Receipts must match the committed group target/revision and arrive after its epoch. Ready or same-media reports alone remain unconfirmed (`partial`).
- `manifest.generatedAt` records horizon compilation; refresh uses a new manifest ID and preserves the original timeline anchor. Audio compatibility is enforced on the designated audible device; silent group members need only required visual capabilities.
- Device command bodies include a binding revision. Reassignment revokes old command authorizations, including cancelled-update retries. Every transition authorizing update activity, download, and install rechecks tenant service, command expiry/due time and binding. Actual installed-version reports may still truthfully record completion after service suspension.
- Optional public distribution routes `/downloads/mosaic-player.apk` and `/downloads/mosaic-player-macos.zip` serve only these two filenames from explicit `COMMERCIAL_DOWNLOAD_DIR`; other paths in that prefix return 404. This does not expose authenticated release-task APK URLs or media.

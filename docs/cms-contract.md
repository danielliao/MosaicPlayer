# Merchant content / planner API contract
Existing sessions/CSRF/tenant RLS remain required. `tenant_admin`/`operator` manage tenant content; `store_operator` manages only content owned by an assigned store. HQ means `ownerStoreId:null`. Viewers can read their stores and HQ-shared content. Devices remain current/pending dependency scoped. Existing media/templates migrate HQ shared=true; new content defaults shared=false. Store-owned content is never shared across stores.

## Content access helpers (backend)
`commercial/content-access.js` exports pure `canReadContent(identity,row,storeId=undefined)`, `canEditContent(identity,row)`, `canShareContent(identity,row)`, `contentOwnerId(row)`; row accepts DB snake_case or public camelCase ownership/tenant fields. Explicit third arg storeId restricts selection to that authorized store's own content plus HQ-shared; explicit null selects HQ-owned content for managers; omitted permits managers all tenant content. Async `contentOwner(c,i,value)` validates new owner, requiring store operators to select an authorized store. `contentSharing(i,row,value)` validates boolean and permits only HQ managers to alter sharing. Never mutate owner on update.

## Media
- GET /api/media optionally `?storeId=<uuid>`: scoped library, public fields include ownerStoreId/shared. Managers without filter see all tenant media. Store operators see their stores, HQ-shared and existing authorized published dependencies (grandfathered playback availability). Archived records remain marked archived.
- POST /api/media multipart `{file,ownerStoreId?}`: tenant managers may omit owner for HQ, store operators must provide assigned store. Each request contains one file; UI batch upload sends one request per file and displays each result. New media shared=false.
- PUT /api/media/:id `{name?,shared?}`: own-store store operators or managers rename; only HQ managers alter sharing. Owners immutable. Returns mediaPublic.
- DELETE /api/media/:id: editable owner only. Existing reference/archive behavior retained (including AI/intake/retail/design references). Sharing revocation does not remove published/playing dependencies.

## Templates / versions / planner
- GET /api/templates optionally `?storeId=<uuid>`; items include ownerStoreId/shared and existing top-level defaultProgram/slots.
- POST /api/templates `{name,description?,ownerStoreId?,shared?,defaultProgram,slots}`. PUT /api/templates/:id `{name?,description?,shared?,defaultProgram?,slots?}`. Owner immutable; store operators can create/edit assigned store templates only. HQ shared templates read-only for them.
- POST /api/templates/:id/publish `{}` creates immutable version from editable draft; version list APIs filter current template visibility or already-assigned history in an authorized store. Returned versions include ownerStoreId/shared from current template.
- Version assignments obey template store ownership: a store-owned template can target only that store, even for managers. Store operators may assign HQ-shared versions to their own stores. Existing assigned versions survive later unsharing; no new assignment of revoked shared templates by store operators.
- Draft media selections must currently belong to template owner store or be HQ-shared; HQ templates select HQ content. Existing immutable versions keep dependencies readable after unsharing, but revoked media cannot be introduced into a new draft. Re-saving a draft after unsharing revalidates its resources and may require replacement.
- Slots retain `{id,name,startDate,endDate,startTime,endTime,weekdays,program}`. Clear uses `cleared:true,program:null` while retaining all time/day/date fields; compiled runtime interval uses defaultProgram. Delete omits the slot. Noncleared slot must supply valid program. Saving never publishes. At most100 slots and200 items per playlist; existing temporal overlap validation applies, including cleared windows.
- `GET /api/deployments` continues returning authorized group deployment state; POST deployment requests retain normal preparation and pending-conflict semantics.

Designer contract is root-owned; generated media inherits design owner/sharing at render snapshot and later sharing remains independent.

## Visual item transitions
Every program accepts optional `transition:{type:'cut'|'fade',durationMs}`. Omission normalizes to cut0; cut permits only duration0 or omitted. Fade duration must be integer100..2000 ms and no longer than half the shortest normalized visual playlist item (actual probed duration for video). Applies to each visual item entrance without extending/shortening the program timeline or affecting background music. Invalid settings return400. Existing versions without transition imply cut0.

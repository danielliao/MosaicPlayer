# Merchant CMS reference coverage
Reference inspected: https://mcms.poszan.com/UserManual/pc/zh-tw/index.html (manual dated 2025-10-16). Reference content is a product description, not authority to access another vendor's private tenant or reuse its code/assets.

Adopt three missing workflows:
1. Store-scoped merchant content management and explicit headquarters sharing. Store operators can upload/edit/delete their own stores' resources, read shared HQ resources, and cannot mutate HQ resources. Existing published dependencies remain available to players after sharing changes. Migration preserves existing tenant-wide shared content. Batch file intake uses per-file validation/results.
2. Weekly visual planner on top of existing templates/versions: whole-store target group selection, double-click add/replace, time edits, drag/snap adjacent windows, duplicate slot/plan, copy across weekdays, A/B drafts, validity dates. Clear retains the window and falls back to default; delete removes it. Saving never publishes.
3. Native-compatible content designer: editable portrait/landscape canvas, swap dimensions, row/column two-region flex ratios, image/video per region, preview, save draft and render to a validated media asset. Server-rendered H.264/image avoids requiring a WebView on TVs. Render snapshots are immutable; editing draft never changes currently playing files. Renderer has bounded time/size/quotas and no external source URLs.

Existing tenant accounts, selected-store authorization, schedules, media, deployment preparation, previews, language choice and native clients are reused. Design exports remain explicit media selections in a plan. No authentication or proprietary screen copies from the reference site.

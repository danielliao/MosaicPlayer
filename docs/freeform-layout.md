# Mixed screen sizes and orientations / 混合尺寸与横竖屏

In the console, open a playback group's settings and choose **Mixed sizes / orientations**. Set the logical canvas and add 1–16 rectangles. Each rectangle has x/y, width/height and clockwise output compensation of 0/90/180/270 degrees. The portrait preset starts at 1080×1920 and 90 degrees; select the compensation matching the panel's physical mounting. Use 0 for an OS that already presents the panel upright. Android follows the OS orientation and applies only the configured compensation.

在播放组设置中选择「混合尺寸 / 横竖屏」，配置逻辑画布和 1–16 个矩形。坐标和尺寸代表屏幕在整墙中的覆盖范围，可按屏幕的实际相对尺寸、像素间距调整；不自动换算英寸。竖屏预设为 1080×1920、顺时针 90°，如果系统已正确处理物理旋转，应选择 0°。矩形不能重叠或超出画布，可留空隙模拟边框。

Every player first covers the shared canvas with the source media, crops its rectangle, then rotates that clipped rectangle clockwise and fits it to the local display with centered letterboxing. The console simulation shows the upright logical wall assembly, with rotation labels; mounting compensation is applied only by players. The scaled layout diagram shows logical coverage and rotation labels, not a photograph of physical mounting.

The wire format uses `layout.mode="freeform"`, `canvasWidth`, `canvasHeight`, and `screens[].{x,y,width,height,rotation}`. Coordinates and dimensions are integers up to 65536; dimensions are positive. Grid layouts continue to use their original fields. The server generates credentials and retains existing screen IDs when supplied IDs refer to current screens. Removing an occupied screen requires unbinding first. New rectangles receive new IDs and keys; client-supplied keys are discarded.

Players announce `freeform` capability in pairing, state/WS requests, and reports. The commercial backend rejects custom-layout edits involving older players and rejects unsupported pairing/rebinding/state requests with an upgrade message. Upgrade players before changing an existing wall. Keep the previous installer for rollback; reverting to an old player also requires a grid layout.

Validation covers JavaScript, Swift and Android geometry and isolated tenant/capability integration. Actual mixed-size panels, OS/TV orientation behavior, bezel alignment, video decode and physical synchronization still require an on-site acceptance run with a numbered corner/grid calibration image.

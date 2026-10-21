# Mosaic 原生 macOS 播放端

Swift / AppKit / AVFoundation 原生播放器，支持 macOS 13+、Apple Silicon / Intel。
当前源码版本 0.5.0。视频和图像原生解码，无 WebView 或 Electron。

支持门店配对码、屏幕位置选择、完整节目缓存、分时段图片/视频/音乐、断网恢复、
当前应用画面截图、显示器选择和全屏。只由指定声音屏输出音频。

## 构建

需要 macOS、Xcode Command Line Tools 和 Swift 5.9+。

```sh
npm run test:native
npm run build:native
# 可选：指定自己的服务器；默认不指定服务器
MOSAIC_SERVER_URL=https://signage.example.com npm run build:native
```

产物为 `native/dist/Mosaic Player.app` 和 `native/dist/MosaicPlayer-macOS.zip`。
构建脚本合并 arm64 / x86_64 并生成图标，默认 ad-hoc 签名。对外发行需要自行配置
Developer ID 签名与公证，不能将本地签名视为 Apple 公证。

## 使用

将应用放入“应用程序”。首次启动选择自动发现的后台，或填写自己的服务器 URL。
多租户后台生成配对码后，在客户端验证并选择屏幕编号。不同设备分配不同位置。
凭据保存在本机钥匙串。后台发送节目，客户端校验完整缓存后按共同时间线播放。

默认不绑定任何服务器；可通过构建变量指定默认地址。无法发现时检查局域网权限、
组播/VLAN 和防火墙，也可使用手工地址。

## 集成验证

需要 Node.js 和 ffmpeg：

```sh
swift build --package-path native --product MosaicPlayer
node native/scripts/integration.mjs
```

联测使用独立端口、隔离数据和短期测试密钥，不使用正常运行的配对凭据。
输出在忽略提交的 `output/`。联测会打开原生应用窗口。

实际多机同步需验证不同显示器刷新率、真实网络、长时间循环和跨屏快速运动。
媒体时间偏差不等于屏幕实际出光偏差，本应用不提供硬件帧锁。它是独立应用，
不是系统屏保插件，不能在锁屏界面播放。

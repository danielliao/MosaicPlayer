# Mosaic TV

原生 Java / Media3 Android TV 播放器，支持 Android 6.0+、遥控器、屏幕裁切、校时、
完整节目缓存、离线恢复、音乐、应用画面截图和经用户确认的 APK 更新。
当前源码版本 0.2.0，包名 `local.mosaic.tv`。

## 构建

需要 JDK 17、Android SDK platform/build-tools 35、Node.js 和 ffmpeg（测试夹具）。
仓库包含 Gradle 8.9 wrapper。

```sh
npm ci
npm run test:android
npm run build:android
# 可选：将自己的服务器地址写入构建；默认不指定服务器
MOSAIC_SERVER_URL=https://signage.example.com npm run build:android
```

产物位于 `android/dist/MosaicPlayer-AndroidTV.apk`。首次构建自动生成自己的签名密钥，
保存在 `android/.signing/`，请安全备份。此目录及安装包不提交仓库。
不同构建者的密钥不同，不能覆盖安装彼此签名的应用；后续升级必须使用同一密钥。

## 安装与接入

通过电视支持的文件管理器侧载 APK，按系统提示授权安装来源。也可在用户主动开启
调试后使用 `adb install -r android/dist/MosaicPlayer-AndroidTV.apk`。

开源构建不内置现场服务器地址。首次启动可选择局域网发现的服务器，或手工填写自己的
服务器 URL。多租户后台在门店/播放组生成配对码，电视输入后选择屏幕编号；每台设备
选择不同位置。旧单画布后台使用公开选屏流程。

播放器使用 Bonjour/NSD，并可探测当前私有 IPv4 网段的 3210 端口。跨 VLAN、多播受限
或自定义端口时请手工配置。配对凭据在设备上保存，不随发现请求发送给其他服务器。

图片、视频、音乐按照共同时间线播放，只有指定声音屏输出音频。按返回键打开控制面板。
缓存完整、校验成功后才报告就绪；新资源不可用时保留旧节目。

## 更新与网络

在线更新验证包名、版本、大小、SHA256 和当前应用签名，每次安装前还需服务器重新授权。
电视播放中不会自动弹出系统安装器；用户在控制面板选择安装，再完成系统确认。

更新下载默认只允许 HTTPS。明确用于私有局域网 HTTP 时，可设置
`MOSAIC_ALLOW_LAN_HTTP_UPDATES=true npm run build:android`；该开关不放宽签名检查。
服务端必须信任你自己的 APK 证书，不能沿用其他发行者的指纹。

## 验证边界

单元、Robolectric 和协议测试不能替代电视硬件验收。需现场验证解码能力、遥控器、
音频焦点、休眠、长时间循环和多屏接缝。软件校时不提供硬件帧锁。
播放诊断可显示渲染帧率估算、丢帧、变速、定位和缓冲次数；计数不包含媒体密钥。

## Controller mode (0.3.0)

Open **控制器 / Controller** from player setup on the same APK. The controller is a separate activity and uses a tenant administrator-created API key with `read` and `control` scopes, never a playback pairing key. Enter a server origin, save/load the authorized groups and media, then select a group. Both the server and key are encrypted together with Android Keystore AES-GCM; the key input is masked, screen capture and backup are disabled, and errors never display credentials or server response bodies. Use HTTPS outside a trusted LAN: plain HTTP exposes bearer credentials to the network.

Choose 中文 or English in the controller. The preference persists for controller and core setup labels. Legacy playback/diagnostic/server messages remain Chinese; user-entered media names are never translated. Language changes apply to player setup on its next creation.

Voice uses the installed system recognizer only while requested in the foreground; no microphone permission or background recorder is added. System recognizers may use their provider's network service. If unavailable, use the text box. Supported commands are exactly `pause` / `暂停`, `resume` / `继续` / `恢复`, and `play Exact media name` / `播放 精确媒体名`. Media names must match one authorized item exactly; duplicates and unknown text cannot send. Recognized text only populates an editable draft. Review and explicitly confirm the selected group and action before each command, including pause/resume buttons. Pause/resume of scheduled programs may be rejected by the server. Server acceptance does not prove physical TV playback.

Local verification uses unit/parser tests, MockWebServer API tests and a Robolectric confirmation flow. Real microphone availability, recognizer/provider behavior, touch/remote focus navigation, device Keystore persistence and physical TV control still require real-device acceptance. No provider or TV is contacted by tests.

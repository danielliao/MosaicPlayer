# Mosaic Player

开源的多屏同步播放与门店内容管理系统。支持原生 macOS 播放器、Android TV 播放器和浏览器播放端，让多台设备按同一时间线显示大画面的不同区域。

## 功能

- 多租户、服务期限、门店、设备分组和角色权限，移动端后台管理。
- 图片、视频、音乐素材；默认节目、日期/星期/时段模板；立即或定时发布。
- 客户端完整预下载、摘要校验、同步切换、断网缓存播放及重新校时。
- 播放回执、在线状态、原生播放器画面截图。
- Android 同签名 APK 在线更新，安装仍需用户完成系统确认。
- 原生 macOS 服务端安装套件构建工具，包含 launchd 服务、数据库、备份和恢复。

软件同步受解码、刷新率和网络影响，不等同于硬件帧锁。请在实际设备上验证接缝、循环、断网和长期播放。

## 快速开始：多租户后台

需要 Node.js 20.11+（建议受支持的 LTS）、Docker Compose 和 FFmpeg/ffprobe。

```sh
npm ci
npm run setup:commercial
npm run start:commercial
```

默认打开 `http://localhost:3220`。初始化脚本生成随机数据库凭据和平台管理员密码，保存在 **仅本机使用** 的 `output/commercial-development/commercial.env`；该目录已忽略提交。首次登录必须修改密码。

平台管理员创建租户和租户管理员，再由租户配置门店、播放组、素材和节目。电视或 Mac 输入服务器地址和后台生成的一次性配对码，选择屏幕编号后播放。

原生播放器默认**不绑定任何服务器**，支持局域网发现和手工输入地址；可以通过 `MOSAIC_SERVER_URL` 在自己构建时指定地址。

详见 [运行手册](docs/commercial-operations.md)、[API](docs/commercial-api.md)。

## 播放端与服务端安装套件

| 组件 | 技术与要求 | 构建 |
| --- | --- | --- |
| macOS 播放端 | Swift / AppKit / AVFoundation；macOS 13+ | `npm run build:native` |
| Android TV | Java / Media3；Android 6.0+ | `npm run build:android` |
| macOS 服务端套件 | Apple Silicon / macOS 14+；内置运行库 | `npm run build:macos-server` |

先阅读 [Mac 播放端说明](native/README.md)、[Android TV 说明](android/README.md) 和 [服务端套件说明](docs/macos-server-installation.md)。

仓库仅提供源码，不附带运行数据、服务器地址、签名私钥或客户安装包。Android 首次构建会生成自己的签名密钥；后续升级必须保留同一密钥。服务端安装套件从你构建的 APK 提取可信签名指纹，不接受任意签名更新。

macOS 默认使用 ad-hoc 签名；正式发行需要自行配置 Developer ID 签名与公证。

## 兼容单画布后台

```sh
npm start
```

默认 `http://localhost:3210`。此入口为旧版可信局域网模式，数据和管理令牌保存在 `.data/`；不适合直接暴露公网。多租户后台入口是 `npm run start:commercial`，两者不要占用同一端口。

## 开发验证

```sh
npm run test:unit       # 无数据库的核心与调度检查
npm run test:server     # 隔离的旧版 HTTP / WebSocket 集成，需 ffmpeg
npm run test:native    # Swift 核心检查，需 macOS 开发工具
npm run test:android   # Android 单元/界面/协议检查，需 SDK 35、JDK 17、ffmpeg
```

`npm test` / `npm run test:commercial` 还需要先初始化本地数据库、构建 Android APK，并配置 Android Build Tools 35 的 `aapt`、`apksigner` 和 Java。商业 API 测试使用随机临时数据库；可用 `COMMERCIAL_ENV_FILE` 指定专用测试配置，切勿使用生产数据库配置。

GitHub Actions 运行核心、HTTP/WebSocket 和 Swift 核心检查。它不代表电视硬件、系统级安装或门店验收。

## 配置与贡献

- [安全说明](SECURITY.md)：配置、升级签名与漏洞报告。
- [贡献指南](CONTRIBUTING.md)：开发和公开提交的检查要求。
- [第三方许可](THIRD_PARTY_NOTICES.md)：依赖和运行库许可边界。

本项目采用 [MIT License](LICENSE)。第三方依赖、字体、图像、视频等仍遵循各自许可。演示素材请使用自己拥有授权的内容。

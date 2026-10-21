# Mosaic Server macOS 内网安装套件 0.2.0-macos.1

适用于 Apple Silicon（M1/M2/M3/M4 等）、macOS 14 或以上。Intel Mac 不适用此包。
安装后不需要 Docker、Homebrew、Node、Java 或外网。建议预留至少 5 GB 空间，另为
视频素材、设备截图和备份预留容量。电视与 Mac 应处于可互通的局域网。

## 安装

1. 双击 `MosaicServer-0.2.0-macos.1-AppleSilicon.pkg`，按系统提示输入 Mac 管理员密码。
2. 当前包未进行 Developer ID 签名和 Apple 公证。如系统拦截，在“系统设置 →
   隐私与安全性”中允许打开此安装包；不需要关闭系统安全检查。
3. 打开“应用程序 → Mosaic Server → 打开管理后台.command”。
   默认地址 `http://localhost:3210`；若该端口已被占用，首次安装会选择随后空闲端口，
   此工具会显示实际本机地址和内网地址。
4. 双击“查看初始账号.command”，使用随机生成的 `platform-admin` 初始账号登录，
   首次登录必须修改密码。初始密码文件不随改密更新。
5. 创建租户、设置服务期限和租户管理员，进入租户管理门店、屏组、素材、模板和发布。

安装创建全新独立实例，不带现有客户数据、云端密码或电视配对密钥。此实例与云端不会
自动同步。如果原来电视连接云端，切到内网实例需要重新配对。

## 电视接入

1. 用同一网络的手机或电脑打开工具显示的内网地址。
2. 下载 `http://服务器内网IP:实际端口/downloads/mosaic-player.apk`，在电视上安装。
   内置 Android TV 0.2.0；Android 6.0+，支持遥控器操作和图片、视频、音乐节目。
3. 电视客户端选择发现的 Mosaic 服务，或手工输入上述内网地址。不要填写 localhost，
   localhost 在电视上指电视自身。完成后台配对，选定门店/屏组和第几块屏。
4. 后台上传素材、配置布局和模板时段，发布到目标门店。检查设备在线、下载就绪、
   发布回执和截屏。多台电视需分别分配屏幕编号。
5. 原 0.1.1 客户端应先手工覆盖安装 0.2.0；此后后台可上传同签名的更高版本 APK
   并安排更新。电视仍需确认 Android 系统安装提示，不支持绕过系统静默安装。

Mac 播放端也包含在 `/downloads/mosaic-player-macos.zip`。
Bonjour 自动发现需要局域网允许组播；跨 VLAN 可手工配置地址。
建议通过路由器 DHCP 保留固定 IP，优先使用有线网络。
本套件为受信任内网提供 HTTP；不要把此 HTTP 端口直接映射到公网。

## 后台服务

无需登录 Mac，开机由 launchd 启动。网页和数据库分别使用 `_mosaic`、
`_mosaicdb` 两个不可登录的受限账号。PostgreSQL 仅监听 `127.0.0.1`，
后台绑定全部网络接口。数据库所有者、运行账号、数据库管理员各自独立。
服务运行时阻止接电 Mac 自动系统睡眠，不修改全局节能设置；笔记本请保持开盖、
接电。锁屏/显示器关闭不影响播放服务。

“管理服务.command”提供状态、启动、停止、重启和备份。
终端也可使用：

```sh
mosaic-server status
mosaic-server urls
sudo mosaic-server restart
sudo mosaic-server stop
sudo mosaic-server start
sudo mosaic-server backup
```

停止服务后本次保持停止；Mac 重启仍会按安装配置自动启动。要取消开机启动，
使用“卸载后台服务.command”。

## 数据、备份、恢复与升级

- 程序：`/Library/MosaicServer/versions/0.2.0-macos.1`
- 活动版本指针：`/Library/MosaicServer/current`
- 数据和配置：`/Library/Application Support/MosaicServer`
- 日志：数据目录下 `logs/app/service.log`、`logs/postgres/service.log`，
  每个服务保留当前日志及 5 个轮转文件，每文件约 5 MB。
- 初始密码：数据目录 `admin-login.txt`，仅 root / Mac 管理员可读。
- 运行配置：`config/server.json`；数据库管理凭据：`config/database.json`，
  不要上传或分享这些文件。

备份会短暂停止网页及数据库，保存一致的数据库、素材、配置和密码，再自动启动；
后台已有下载完成的节目可在电视离线播放。备份放在数据目录的 `backups/时间戳`，
包含逐文件 SHA256 清单。备份含凭据，必须限制访问，并复制到另一台安全设备。
当前没有默认定期异地备份。

恢复会覆盖当前实例，先确认目标，保留恢复前的数据目录：

```sh
sudo mosaic-server restore "/绝对路径/备份目录" --confirm-restore
```

只支持相同 CPU 架构、PostgreSQL 16 的完整快照。请先恢复匹配备份的应用版本，
再升级新版本。不要只恢复一份 SQL 或只复制素材文件来替代完整恢复。
跨机器恢复后，若备份中的端口被占用，应先排除占用；新 IP 需要电视重新填写服务地址。

后续覆盖安装同系列安装包会自动停机备份，再迁移并启动；失败时尝试恢复升级前快照
和旧程序。安装器失败请保留 `/var/log/install.log` 和本产品日志。
旧程序版本和备份均保留，不自动清理客户数据。

“卸载后台服务.command”移除 launchd 开机服务，保留数据、备份和程序文件。
重新运行安装包即可恢复服务；不会自动删除素材或数据库。

## 排查

- 本机也打不开：运行 `mosaic-server status`，查看上述两个日志。
- 电视打不开：先用手机访问同一内网 URL，检查防火墙/VLAN/路由。安装器只添加本服务
  的防火墙允许规则；如果系统询问本地网络权限，请允许。
- 发现不了但手工 URL 可用：检查网络是否禁用了组播；可继续手工配置。
- 视频不流畅：先验证单台电视、1080p H.264、30 fps；4K 或高码率解码能力依电视而异。
- 机器重启后打不开：确认后台服务未被系统“登录项与扩展”禁用。

构建后的安装包必须在目标 Mac 验证系统级安装、重启和多台电视联播。
本仓库仅提供源码及构建工具，不附带客户环境或预签名安装包。

## 维护者构建

在项目中执行 `npm run build:macos-server`，产物位于 `output/releases/macos-server`。
构建机需 Apple Silicon、Xcode Command Line Tools、Python 3、npm、Homebrew
OpenJDK 17.0.19、Android Build Tools 35.0.0，以及已经构建的 Android / Mac 播放器。
构建时下载并校验固定版本的运行库源码，最终安装包可离线安装。
`npm run test:macos-server` 用独立端口、临时数据库及当前用户的 launchd 域验证；
不会修改现有商业后台数据库。测试生成媒体夹具需要构建机的 ffmpeg。
每次对外发布必须同时递增构建脚本、安装脚本和说明中的版本，保留旧版本以供回滚。

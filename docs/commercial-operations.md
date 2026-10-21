# 多租户后台运行手册

## 本地开发

```sh
npm ci
npm run setup:commercial
npm run start:commercial
```

需要 Docker Compose 和 ffprobe。初始化工具创建独立 PostgreSQL 开发容器，默认仅绑定
`127.0.0.1:55432`；后台默认端口 3220。首次生成随机数据库密码和平台账号，写入
`output/commercial-development/commercial.env`，文件权限 0600。首次登录必须改密。
已有配置不自动重置。可用 `COMMERCIAL_ENV_FILE` 指定另外的私有配置，环境变量优先。

1. 平台管理员创建租户、服务期限和限额，指定租户管理员。
2. 租户管理员创建门店、播放组、账号，并配置门店权限。
3. 生成一次性配对码；原生客户端选择服务器、输入配对码、选择屏幕编号。
4. 上传视频、图片和音乐，配置默认节目与时段模板，发布不可变版本。
5. 按门店或组立即/定时下发，检查下载准备、提交、实际播放回执和截图。

只有指定声音屏播放声音。截图只采集播放器自身内容。离线设备不能立即接收撤销指令。

## 素材与客户端下载

`COMMERCIAL_DATA_DIR` 保存素材、截图和发布 APK；数据库保存元数据。
`COMMERCIAL_DOWNLOAD_DIR` 由管理员指向客户端产物目录，固定下载文件名为
`mosaic-player.apk` 和 `mosaic-player-macos.zip`。先自行构建播放器，再复制为这两个名称。

在线更新必须保持同一 Android 签名且 versionCode 递增。
`COMMERCIAL_APK_SIGNER_SHA256` 应设置为自己可信 APK 的**证书** SHA256，不是文件摘要。
可用 `apksigner verify --print-certs your-player.apk` 获取。未设置时，源码运行模式
以本地 `android/dist/MosaicPlayer-AndroidTV.apk` 为基准。设备仍需确认系统安装提示。

## 通用 HTTPS 自部署

仓库不包含任何已部署站点、集群地址、账号或注册表配置。
`deploy/compose.yaml` 与 `deploy/Caddyfile` 仅为可自行修改的通用示例。

1. 准备 PostgreSQL 16、数据库 owner，以及独立 runtime 角色。runtime 不得有
   SUPERUSER、BYPASSRLS 或表所有者权限。
2. 复制 `.env.commercial.example` 为仓库外的私有配置，替换所有占位符，权限设为 0600。
3. 使用 owner 配置执行 `scripts/commercial-migrate.mjs` 和
   `scripts/commercial-bootstrap.mjs`。已有管理员不会被 bootstrap 覆盖。
4. 准备持久数据目录和客户端产物目录，确保应用容器 UID 1000 可写数据目录。
5. 设置自己的 HTTPS 域名，再使用通用 Compose 示例。应用进程只接收 runtime URL，
   不得注入 owner 密码或签名私钥。只有可信 TLS 反向代理后才开启 TRUST_PROXY。
6. 验证账号登录、租户隔离、受保护素材 Range、配对、发布、设备回执和真实播放。

设备可在缓存完成后离线播放；浏览器持久节目缓存要求 HTTPS 或 localhost。
请勿将开发 HTTP 配置直接暴露到公网。

## 备份与迁移

本地 Docker 开发实例可使用：

```sh
node scripts/commercial-backup.mjs /absolute/private/backup-directory
node scripts/commercial-verify-backup.mjs /absolute/private/backup-directory
```

先停止应用写入，再备份数据库、素材和私有配置，复制到独立安全存储并演练恢复。
验证脚本使用临时数据库，不能替代完整灾备验证。跨主机部署应使用匹配版本的
`pg_dump` / `pg_restore`，另行备份角色配置和 Android 签名私钥。

旧 JSON 服务数据可用 `npm run import:commercial -- /absolute/private/legacy-data`
导入，操作前必须独立备份。导入后新的多租户数据不会回写旧 JSON。
应用回滚不能自动回滚数据库；必须确认 schema 兼容并保留回滚备份。

macOS 原生服务端套件的系统服务、完整快照与恢复见
[安装套件说明](macos-server-installation.md)。

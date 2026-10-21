#!/bin/bash
set -euo pipefail
echo "此操作停止并移除 Mosaic 后台服务；素材、数据库和备份全部保留。"
read -r -p "输入 UNINSTALL 继续：" answer
[[ "$answer" == UNINSTALL ]] || exit 0
sudo /usr/local/bin/mosaic-server stop
sudo /bin/rm -f /Library/LaunchDaemons/local.mosaic.server.plist /Library/LaunchDaemons/local.mosaic.postgres.plist
echo "服务已卸载。数据保留在 /Library/Application Support/MosaicServer。"
echo "重新安装同一安装包可恢复服务。程序文件和服务账号保留，便于恢复。"
read -r -p "按回车关闭。" answer

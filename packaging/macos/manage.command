#!/bin/bash
set -euo pipefail
CTL=/usr/local/bin/mosaic-server
echo "Mosaic Server 服务管理"
"$CTL" urls
echo "1. 查看状态   2. 重启服务   3. 停止服务   4. 启动服务   5. 创建备份"
read -r -p "请选择：" choice
case "$choice" in
1) "$CTL" status;;
2) sudo "$CTL" restart;;
3) sudo "$CTL" stop;;
4) sudo "$CTL" start;;
5) sudo "$CTL" backup;;
*) exit 0;;
esac
read -r -p "按回车关闭。" choice

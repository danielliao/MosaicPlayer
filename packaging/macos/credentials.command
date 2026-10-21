#!/bin/bash
set -euo pipefail
echo "首次登录需要修改初始密码；此文件不会随着修改密码而更新。"
sudo /bin/cat "/Library/Application Support/MosaicServer/admin-login.txt"
read -r -p "按回车关闭。" answer

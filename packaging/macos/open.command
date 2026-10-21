#!/bin/bash
set -euo pipefail
ROOT="/Library/MosaicServer/current"
"$ROOT/runtime/node/bin/node" -e 'const fs=require("fs");const port=JSON.parse(fs.readFileSync("/Library/Application Support/MosaicServer/connection.json")).port;require("child_process").execFileSync("/usr/bin/open",["http://localhost:"+port]);'
/usr/local/bin/mosaic-server urls
echo "电视连接上面的内网地址。若出现多个地址，选择与电视处于同一网段的地址。"
read -r -p "按回车关闭。" answer

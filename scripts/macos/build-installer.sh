#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$ROOT/output/macos-server-build"
VERSION=0.2.0-macos.1
DEST="$ROOT/output/releases/macos-server"
PAYLOAD="$WORK/payload"
RELEASE="$PAYLOAD/Library/MosaicServer/versions/$VERSION"
TOOLS="$PAYLOAD/Applications/Mosaic Server"
mkdir -p "$DEST" "$WORK/logs"
[[ "$(uname -m)" == arm64 ]] || { echo "Build on Apple Silicon"; exit 1; }
bash "$ROOT/scripts/macos/build-runtime.sh"
# This directory contains generated, reproducible staging files only.
rm -rf "$PAYLOAD"
mkdir -p "$RELEASE/app/scripts/macos" "$RELEASE/downloads" "$RELEASE/bin" "$RELEASE/licenses/sources" "$TOOLS"
cp -R "$WORK/runtime" "$RELEASE/runtime"
# Headers/npm are build dependencies; the delivered service needs only the Node executable.
rm -rf "$RELEASE/runtime/node/include" "$RELEASE/runtime/node/share" "$RELEASE/runtime/node/lib"
rm -f "$RELEASE/runtime/node/bin/npm" "$RELEASE/runtime/node/bin/npx" "$RELEASE/runtime/node/bin/corepack"
cp -R "$ROOT/commercial" "$ROOT/lib" "$ROOT/public" "$RELEASE/app/"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$RELEASE/app/"
cp "$ROOT/scripts/commercial-migrate.mjs" "$ROOT/scripts/commercial-bootstrap.mjs" "$RELEASE/app/scripts/"
cp "$ROOT/scripts/macos/admin.mjs" "$ROOT/scripts/macos/service.mjs" "$RELEASE/app/scripts/macos/"
(cd "$RELEASE/app"; npm ci --omit=dev --ignore-scripts --no-audit --no-fund > "$WORK/logs/npm-install.log" 2>&1)
cp "$ROOT/android/dist/MosaicPlayer-AndroidTV.apk" "$RELEASE/downloads/mosaic-player.apk"
cp "$ROOT/native/dist/MosaicPlayer-macOS.zip" "$RELEASE/downloads/mosaic-player-macos.zip"
# Trust only the certificate of the APK built by this distributor.
"$RELEASE/runtime/android/apksigner" verify --print-certs "$RELEASE/downloads/mosaic-player.apk" |
  /usr/bin/sed -n 's/^Signer #1 certificate SHA-256 digest: //p' > "$RELEASE/trusted-apk-signer.txt"
/usr/bin/grep -Eq '^[a-f0-9]{64}$' "$RELEASE/trusted-apk-signer.txt"
cp "$ROOT/packaging/macos/mosaic-server" "$RELEASE/bin/"
printf '%s\n' "$VERSION" > "$RELEASE/VERSION"
cp "$ROOT/docs/macos-server-installation.md" "$DEST/安装和运维说明.md"
cp "$ROOT/docs/macos-server-installation.md" "$TOOLS/安装和运维说明.md"
cp "$ROOT/packaging/macos/open.command" "$TOOLS/打开管理后台.command"
cp "$ROOT/packaging/macos/credentials.command" "$TOOLS/查看初始账号.command"
cp "$ROOT/packaging/macos/manage.command" "$TOOLS/管理服务.command"
cp "$ROOT/packaging/macos/uninstall.command" "$TOOLS/卸载后台服务.command"
cp "$WORK/postgresql-16.13/COPYRIGHT" "$RELEASE/licenses/PostgreSQL-COPYRIGHT"
cp "$WORK/ffmpeg-8.0.1/COPYING.LGPLv2.1" "$RELEASE/licenses/FFmpeg-LGPLv2.1"
cp "$WORK/ffmpeg-8.0.1/LICENSE.md" "$RELEASE/licenses/FFmpeg-LICENSE.md"
cp "$WORK/cache/postgresql-16.13.tar.bz2" "$WORK/cache/ffmpeg-8.0.1.tar.xz" "$RELEASE/licenses/sources/"
cp "$WORK/cache/jdk-17.0.19-ga.tar.gz" "$RELEASE/licenses/sources/"
cp /opt/homebrew/Cellar/openjdk@17/17.0.19/libexec/openjdk.jdk/Contents/Home/release "$RELEASE/licenses/OpenJDK-release.txt"
cp /opt/homebrew/Cellar/openjdk@17/17.0.19/.brew/openjdk@17.rb "$RELEASE/licenses/sources/"
cp "$ROOT/scripts/macos/build-runtime.sh" "$ROOT/scripts/macos/relocate-runtime.py" "$RELEASE/licenses/sources/"
cp "$ROOT/packaging/macos/THIRD-PARTY.md" "$RELEASE/licenses/"
python3 "$ROOT/scripts/macos/relocate-runtime.py" "$RELEASE/runtime" "$WORK/runtime" > "$DEST/runtime-verification.json"
chmod -R go-w "$PAYLOAD"
chmod 755 "$TOOLS/"*.command "$RELEASE/bin/mosaic-server"
mkdir -p "$WORK/pkg-scripts"
cp "$ROOT/packaging/macos/preinstall" "$ROOT/packaging/macos/postinstall" "$WORK/pkg-scripts/"
chmod 755 "$WORK/pkg-scripts/"*
pkgbuild --root "$PAYLOAD" --identifier local.mosaic.server --version 0.2.0.1 \
  --install-location / --ownership recommended --scripts "$WORK/pkg-scripts" "$WORK/component.pkg"
mkdir -p "$WORK/resources"
cat > "$WORK/resources/ReadMe.html" <<'HTML'
<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="font:15px -apple-system;line-height:1.7">
<h1>Mosaic Server 内网服务端</h1>
<p>适用于 Apple Silicon Mac、macOS 14 或以上。内置数据库和运行环境，安装后无需 Docker 或外网。</p>
<p>安装完成后，在“应用程序 → Mosaic Server”中打开：</p>
<ul><li><b>打开管理后台.command</b>：打开后台并显示电视连接地址。</li>
<li><b>查看初始账号.command</b>：查看随机生成的管理员密码，首次登录后请修改。</li>
<li><b>管理服务.command</b>：查看状态、重启、停止、启动、备份。</li></ul>
<p>默认端口 3210。若已占用，首次安装选择随后空闲端口，以管理工具显示为准。
电视应连接服务器内网 IP，不能填写 localhost。</p>
<p>服务开机自动运行，无需用户登录。安装创建独立实例，不复制云端客户数据。
覆盖升级会先停机备份；卸载服务保留数据库与素材。</p>
<p>请预留至少 5 GB 空间及素材/备份所需容量。完整说明见应用程序文件夹内“安装和运维说明.md”。</p>
</body></html>
HTML
cat > "$WORK/distribution.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>Mosaic Server 内网服务端</title>
  <readme file="ReadMe.html" mime-type="text/html"/>
  <options customize="never" require-scripts="true" hostArchitectures="arm64"/>
  <domains enable_localSystem="true" enable_currentUserHome="false" enable_anywhere="false"/>
  <volume-check><allowed-os-versions><os-version min="14.0"/></allowed-os-versions></volume-check>
  <choices-outline><line choice="server"/></choices-outline>
  <choice id="server" visible="false"><pkg-ref id="local.mosaic.server"/></choice>
  <pkg-ref id="local.mosaic.server" version="0.2.0.1" onConclusion="None">component.pkg</pkg-ref>
</installer-gui-script>
XML
productbuild --distribution "$WORK/distribution.xml" --resources "$WORK/resources" --package-path "$WORK" \
  "$DEST/MosaicServer-$VERSION-AppleSilicon.pkg"
(cd "$DEST"; shasum -a 256 "MosaicServer-$VERSION-AppleSilicon.pkg" > SHA256SUMS.txt)
echo "Installer: $DEST/MosaicServer-$VERSION-AppleSilicon.pkg"

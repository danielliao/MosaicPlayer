#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/environment.sh
mkdir -p .signing dist
chmod 700 .signing
if [[ ! -f .signing/mosaic-tv.jks ]]; then
  if [[ -f .signing/password ]]; then
    echo '已有签名密码但密钥丢失，请恢复 .signing/mosaic-tv.jks，避免生成不兼容的升级包。' >&2; exit 1
  fi
  umask 077
  openssl rand -hex 32 > .signing/password
  keytool -genkeypair -keystore .signing/mosaic-tv.jks -storetype PKCS12 \
    -alias mosaic-tv -keyalg RSA -keysize 3072 -validity 10000 \
    -storepass:file .signing/password -keypass:file .signing/password \
    -dname 'CN=Mosaic TV, OU=Player, O=Mosaic, C=CN'
fi
chmod 600 .signing/password .signing/mosaic-tv.jks
./gradlew testDebugUnitTest lintRelease assembleRelease --console=plain --no-daemon
cp app/build/outputs/apk/release/app-release.apk dist/MosaicPlayer-AndroidTV.apk
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose --print-certs dist/MosaicPlayer-AndroidTV.apk
(cd dist && shasum -a 256 MosaicPlayer-AndroidTV.apk > SHA256SUMS)
echo "APK: $(pwd)/dist/MosaicPlayer-AndroidTV.apk"

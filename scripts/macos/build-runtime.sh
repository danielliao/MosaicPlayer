#!/bin/bash
# Build on Apple Silicon. No Homebrew libraries are linked into PostgreSQL/ffprobe.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$ROOT/output/macos-server-build"
CACHE="$WORK/cache"
RUNTIME="$WORK/runtime"
mkdir -p "$CACHE" "$RUNTIME" "$WORK/logs"
export MACOSX_DEPLOYMENT_TARGET=14.0
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
fetch() {
  if ! test -f "$CACHE/$2"; then
    curl -fsSL --retry 3 --max-time 300 "$1" -o "$CACHE/$2.partial"
    mv "$CACHE/$2.partial" "$CACHE/$2"
  fi
}
fetch https://nodejs.org/dist/v24.14.0/SHASUMS256.txt node-SHASUMS256.txt
fetch https://nodejs.org/dist/v24.14.0/node-v24.14.0-darwin-arm64.tar.gz node-v24.14.0-darwin-arm64.tar.gz
(cd "$CACHE"; /usr/bin/grep ' node-v24.14.0-darwin-arm64.tar.gz$' node-SHASUMS256.txt | shasum -a 256 -c -)
if ! test -x "$RUNTIME/node/bin/node"; then
  tar -xzf "$CACHE/node-v24.14.0-darwin-arm64.tar.gz" -C "$WORK"
  mv "$WORK/node-v24.14.0-darwin-arm64" "$RUNTIME/node"
fi
fetch https://ftp.postgresql.org/pub/source/v16.13/postgresql-16.13.tar.bz2 postgresql-16.13.tar.bz2
fetch https://ftp.postgresql.org/pub/source/v16.13/postgresql-16.13.tar.bz2.sha256 postgresql-16.13.tar.bz2.sha256
(cd "$CACHE"; shasum -a 256 -c postgresql-16.13.tar.bz2.sha256)
if ! test -x "$RUNTIME/postgres/bin/postgres"; then
  test -d "$WORK/postgresql-16.13" || tar -xjf "$CACHE/postgresql-16.13.tar.bz2" -C "$WORK"
  (
    cd "$WORK/postgresql-16.13"
    ./configure --prefix="$RUNTIME/postgres" --without-readline --without-icu \
      --without-lz4 --without-zstd --without-libxml --without-libxslt \
      CFLAGS="-O2 -mmacosx-version-min=14.0" > "$WORK/logs/postgres-configure.log" 2>&1
    make -j6 > "$WORK/logs/postgres-build.log" 2>&1
    make install > "$WORK/logs/postgres-install.log" 2>&1
  )
fi
fetch https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz ffmpeg-8.0.1.tar.xz
(cd "$CACHE"; printf '%s\n' '05ee0b03119b45c0bdb4df654b96802e909e0a752f72e4fe3794f487229e5a41  ffmpeg-8.0.1.tar.xz' | shasum -a 256 -c -)
if ! test -x "$RUNTIME/media/ffprobe"; then
  test -d "$WORK/ffmpeg-8.0.1" || tar -xf "$CACHE/ffmpeg-8.0.1.tar.xz" -C "$WORK"
  (
    cd "$WORK/ffmpeg-8.0.1"
    ./configure --prefix="$RUNTIME/media" --cc=clang --disable-autodetect \
      --disable-doc --disable-debug --disable-ffmpeg --disable-ffplay --disable-network \
      --disable-avdevice --disable-avfilter --disable-encoders --disable-muxers \
      --disable-shared --enable-static --enable-zlib --extra-cflags="-mmacosx-version-min=14.0" \
      --extra-ldflags="-mmacosx-version-min=14.0" > "$WORK/logs/ffprobe-configure.log" 2>&1
    make -j6 ffprobe > "$WORK/logs/ffprobe-build.log" 2>&1
    mkdir -p "$RUNTIME/media"
    cp ffprobe "$RUNTIME/media/ffprobe"
  )
fi
if ! test -x "$RUNTIME/java/bin/java"; then
  /opt/homebrew/opt/openjdk@17/bin/jlink --add-modules java.base,java.logging \
    --strip-debug --no-header-files --no-man-pages --output "$RUNTIME/java"
fi
mkdir -p "$RUNTIME/android/lib" "$RUNTIME/android/lib64"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}/build-tools/35.0.0"
cp "$SDK/aapt" "$RUNTIME/android/"
cat > "$RUNTIME/android/apksigner" <<'SH'
#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
exec "$HERE/../java/bin/java" -Xmx256m -jar "$HERE/lib/apksigner.jar" "$@"
SH
chmod 755 "$RUNTIME/android/apksigner"
cp "$SDK/lib/apksigner.jar" "$RUNTIME/android/lib/"
cp -L "$SDK/lib64/libc++.dylib" "$SDK/lib64/libc++.1.dylib" "$SDK/lib64/libc++abi.1.dylib" "$RUNTIME/android/lib64/"
cp "$SDK/NOTICE.txt" "$RUNTIME/android/"
fetch https://codeload.github.com/openjdk/jdk17u/tar.gz/refs/tags/jdk-17.0.19-ga jdk-17.0.19-ga.tar.gz
(cd "$CACHE"; printf '%s\n' 'b165f0dd120f4455904b76cf87dd9352fd23f88c2e9a33c2532fabacc3cca962  jdk-17.0.19-ga.tar.gz' | shasum -a 256 -c -)
echo "Runtime build complete."

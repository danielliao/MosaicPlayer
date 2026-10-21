#!/bin/bash
set -euo pipefail
NATIVE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="$NATIVE_ROOT/dist"
APP_DIR="$OUTPUT_DIR/Mosaic Player.app"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

# Both builds use the system macOS SDK; no full Xcode project or npm dependency.
for ARCH in arm64 x86_64; do
  swift build --package-path "$NATIVE_ROOT" --scratch-path "$NATIVE_ROOT/.build-$ARCH" \
    -c release --product MosaicPlayer --triple "$ARCH-apple-macosx13.0"
done
lipo -create \
  "$NATIVE_ROOT/.build-arm64/arm64-apple-macosx/release/MosaicPlayer" \
  "$NATIVE_ROOT/.build-x86_64/x86_64-apple-macosx/release/MosaicPlayer" \
  -output "$APP_DIR/Contents/MacOS/MosaicPlayer"
cp "$NATIVE_ROOT/Resources/Info.plist" "$APP_DIR/Contents/Info.plist"
if [ -n "${MOSAIC_SERVER_URL:-}" ]; then
  # PlistBuddy receives this as a single argument; shell interpolation does not
  # execute the configured URL. Client validation rejects malformed addresses.
  /usr/libexec/PlistBuddy -c "Set :MosaicDefaultServerURL $MOSAIC_SERVER_URL" "$APP_DIR/Contents/Info.plist"
fi
ICON_DIR="$OUTPUT_DIR/AppIcon.iconset"
mkdir -p "$ICON_DIR"
swift "$NATIVE_ROOT/scripts/icon.swift" "$OUTPUT_DIR/icon-1024.png"
for SIZE in 16 32 128 256 512; do
  sips -z "$SIZE" "$SIZE" "$OUTPUT_DIR/icon-1024.png" --out "$ICON_DIR/icon_${SIZE}x${SIZE}.png" >/dev/null
  DOUBLE=$((SIZE * 2))
  sips -z "$DOUBLE" "$DOUBLE" "$OUTPUT_DIR/icon-1024.png" --out "$ICON_DIR/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns "$ICON_DIR" -o "$APP_DIR/Contents/Resources/AppIcon.icns"
# Local ad-hoc signing. A distributable notarized build needs a Developer ID.
codesign --force --sign - --identifier local.mosaic.player "$APP_DIR"
codesign --verify --deep --strict "$APP_DIR"
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_DIR/Contents/Info.plist"
lipo -archs "$APP_DIR/Contents/MacOS/MosaicPlayer"
ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$OUTPUT_DIR/MosaicPlayer-macOS.zip"
shasum -a 256 "$OUTPUT_DIR/MosaicPlayer-macOS.zip" > "$OUTPUT_DIR/SHA256SUMS.txt"
printf 'Built: %s\n' "$APP_DIR"

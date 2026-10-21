#!/bin/bash
# Builds "Swapdeck Desktop.app" (release, Apple silicon and Intel) into
# desktop/build/, signs it ad hoc and zips it into release/:
#
#   desktop/scripts/build-app.sh
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="1.2.0"
BUILD="$(date +%Y%m%d%H%M)"
APP="build/Swapdeck Desktop.app"
ARCHS=(--arch arm64 --arch x86_64)

swift build -c release "${ARCHS[@]}"
BIN="$(swift build -c release "${ARCHS[@]}" --show-bin-path)/SwapdeckDesktop"

# App icon: rendered by the app itself (the mark on Apple's icon grid), then every size.
ICONSET="build/AppIcon.iconset"
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
"$BIN" --render-icon build/icon-1024.png
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" build/icon-1024.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" build/icon-1024.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o build/AppIcon.icns

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Swapdeck Desktop"
cp build/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cp -R Resources/en.lproj Resources/vi.lproj "$APP/Contents/Resources/"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" Resources/Info.plist > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist" >/dev/null
codesign --force --sign - "$APP"

mkdir -p ../release
rm -f "../release/swapdeck-desktop-$VERSION.zip"
ditto -c -k --keepParent "$APP" "../release/swapdeck-desktop-$VERSION.zip"
echo "Built $APP and release/swapdeck-desktop-$VERSION.zip"

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./package.json').version")
release_version=$(node -p "require('./package.json').releaseVersion")
app="release/mac/Mini Mark.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" release/mac-build
cp macos/Info.plist "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $release_version" "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $version" "$app/Contents/Info.plist"
cp -R dist "$app/Contents/Resources/wwwroot"
cp dist/document-icons/markdown.icns "$app/Contents/Resources/MiniMark-Markdown.icns"
cp dist/document-icons/yaml.icns "$app/Contents/Resources/MiniMark-Yaml.icns"
cp dist/document-icons/html.icns "$app/Contents/Resources/MiniMark-Html.icns"
cp LICENSE "$app/Contents/Resources/LICENSE.txt"
cp THIRD_PARTY_NOTICES.txt "$app/Contents/Resources/"
sdk=$(xcrun --sdk macosx --show-sdk-path)
sources=()
while IFS= read -r source; do sources+=("$source"); done < <(find macos -name '*.swift' -type f | sort)
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos13.0" -sdk "$sdk" \
    -framework AppKit -framework WebKit -framework CryptoKit -framework PDFKit -framework Security \
    "${sources[@]}" -o "release/mac-build/MiniMark-$arch"
done
lipo -create release/mac-build/MiniMark-arm64 release/mac-build/MiniMark-x86_64 -output "$app/Contents/MacOS/MiniMark"
node scripts/icon-mac.mjs
iconutil -c icns release/mac-build/Moye.iconset -o "$app/Contents/Resources/Moye.icns"
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
ditto -c -k --sequesterRsrc --keepParent "$app" "release/MiniMark-$version-macos-universal.zip"
mkdir -p release/dmg
cp -R "$app" release/dmg/
ln -s /Applications release/dmg/Applications
hdiutil create -volname "Mini Mark Rev v$release_version" -srcfolder release/dmg -ov -format UDZO "release/MiniMark-$version-macos-universal.dmg"
file "$app/Contents/MacOS/MiniMark"

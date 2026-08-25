#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
HELPER_DIR="$HOME/Library/Application Support/eLabFTW Folder Opener"
HELPER_PATH="$HELPER_DIR/elabftw-folder-opener"
APP_PATH="$HOME/Applications/eLabFTW Folder Opener.app"
WRAPPER=$(mktemp -t elabftw-folder-opener.XXXXXX.applescript)
trap 'rm -f "$WRAPPER"' EXIT

if ! command -v go >/dev/null 2>&1; then
  echo "Go 1.22 or newer is required to build the folder opener." >&2
  exit 1
fi

mkdir -p "$HELPER_DIR" "$HOME/Applications"
(cd "$SCRIPT_DIR" && go build -trimpath -ldflags='-s -w' -o "$HELPER_PATH" .)

cat > "$WRAPPER" <<'APPLESCRIPT'
on open location theURL
  set helperPath to POSIX path of (path to home folder) & "Library/Application Support/eLabFTW Folder Opener/elabftw-folder-opener"
  do shell script quoted form of helperPath & " " & quoted form of theURL
end open location
APPLESCRIPT

rm -rf "$APP_PATH"
osacompile -o "$APP_PATH" "$WRAPPER"
PLIST="$APP_PATH/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Delete :CFBundleURLTypes' "$PLIST" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes array' "$PLIST"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0 dict' "$PLIST"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLName string org.elabftw.folder-opener' "$PLIST"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array' "$PLIST"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string elabftw-folder' "$PLIST"
codesign --force --deep --sign - "$APP_PATH" >/dev/null
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_PATH"

echo "Installed: $APP_PATH"
echo "Click a local folder shortcut in eLabFTW and allow the browser to open eLabFTW Folder Opener."

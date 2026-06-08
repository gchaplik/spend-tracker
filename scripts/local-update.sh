#!/bin/bash
# local-update.sh — rebuild and reinstall Spend Tracker in one command
set -e

APP_NAME="Spend Tracker"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RELEASE_DIR="$SCRIPT_DIR/../release"

# Detect arch
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  DMG=$(ls "$RELEASE_DIR/${APP_NAME}-"*"-arm64.dmg" 2>/dev/null | head -1)
else
  DMG=$(ls "$RELEASE_DIR/${APP_NAME}-"*[0-9]".dmg" 2>/dev/null | grep -v arm64 | head -1)
fi

if [ -z "$DMG" ]; then
  echo "❌ No DMG found in $RELEASE_DIR"
  exit 1
fi

echo "🔨 Building..."
npm run electron:build --prefix "$SCRIPT_DIR/.."

echo "🛑 Quitting app (if running)..."
osascript -e 'tell application "Spend Tracker" to quit' 2>/dev/null || true
sleep 1

echo "📦 Installing from $(basename "$DMG")..."
# Detach any existing Spend Tracker volume
hdiutil info | grep -o '/Volumes/Spend Tracker[^"]*' | while read v; do
  hdiutil detach "$v" 2>/dev/null || true
done

MOUNT=$(hdiutil attach "$DMG" -nobrowse | grep '/Volumes/' | awk -F'\t' '{print $NF}')
echo "   Mounted at: $MOUNT"
rm -rf "/Applications/${APP_NAME}.app"
cp -R "$MOUNT/${APP_NAME}.app" "/Applications/"
xattr -cr "/Applications/${APP_NAME}.app"
hdiutil detach "$MOUNT" -quiet

echo "🚀 Launching..."
open "/Applications/${APP_NAME}.app"

echo "✅ Done — Spend Tracker updated and launched."

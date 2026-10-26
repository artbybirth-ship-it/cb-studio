#!/bin/bash
# There is no separate Catalina DMG any more: build-dmg-universal.sh makes one DMG that runs on
# macOS 10.15 Catalina and later, on Intel and Apple Silicon Macs. Kept so old instructions work.
set -euo pipefail
cd "$(dirname "$0")"
echo "Note: the universal DMG now covers Catalina too; building it."
exec ./build-dmg-universal.sh "$@"

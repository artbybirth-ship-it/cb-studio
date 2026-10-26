#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: Production macOS DMG must be built on macOS."
  exit 1
fi

# One DMG for every supported Mac: universal (Intel + Apple Silicon), macOS 10.15 Catalina and later
# (Big Sur, Monterey, Ventura, Sonoma…). Electron 33+ dropped Catalina, so the packaged app uses
# Electron 32 (Node 20, enough for Next 16); package.json "build" sets electronVersion 32.3.3,
# mac.minimumSystemVersion 10.15 and the file name. Development (`electron .`) still uses the
# installed Electron.

# Desktop mode is self-contained by default. Do not silently bake localhost Django rewrites into
# the DMG: a packaged app then returns Next.js "Internal Server Error" whenever Django is not
# separately running.
export CB_BACKEND_ORIGIN="${CB_BACKEND_ORIGIN:-}"
export CB_AI_ORIGIN="${CB_AI_ORIGIN:-}"

if [[ -n "$CB_BACKEND_ORIGIN" ]]; then
  echo "Backend: $CB_BACKEND_ORIGIN (remote/server mode)"
else
  echo "Backend: built-in local desktop API"
fi
if [[ -n "$CB_AI_ORIGIN" ]]; then
  echo "AI:      $CB_AI_ORIGIN"
else
  echo "AI:      not configured (editor/library still work locally)"
fi

# Install dependencies only when they are missing (the folder may be shared with a running dev setup).
if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install
fi

# Next's standalone output traces project files, so an existing dist/ (earlier DMGs and apps)
# would be copied into the packaged app. Park it outside the project during the build and
# restore it afterwards; earlier DMGs end up in dist/older/.
HOLD_DIR=""
restore_dist() {
  if [[ -n "$HOLD_DIR" && -d "$HOLD_DIR/dist" ]]; then
    mkdir -p dist/older
    find "$HOLD_DIR/dist" -maxdepth 2 -name '*.dmg' -exec mv {} dist/older/ \; || true
    rm -rf "$HOLD_DIR"
  fi
  HOLD_DIR=""
}
trap restore_dist EXIT
if [[ -d dist ]]; then
  HOLD_DIR="$(mktemp -d)"
  mv dist "$HOLD_DIR/dist"
fi

echo "Building Next.js standalone app..."
rm -rf .next/standalone
npm run build

rm -rf .next/standalone/public .next/standalone/.next/static
mkdir -p .next/standalone/.next .next/standalone/node_modules
cp -R public .next/standalone/public
cp -R .next/static .next/standalone/.next/static

# Next 16 Turbopack SSR chunks external-require files from the `next` package at runtime.
# Force the full Next runtime into the packaged standalone tree so modules such as
# next/dist/compiled/next-server/app-page-turbo.runtime.prod.js resolve from nextapp.
rm -rf .next/standalone/node_modules/next
cp -R node_modules/next .next/standalone/node_modules/next

echo "Building the macOS DMG (universal, macOS 10.15 and later)..."
export CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}"
npx electron-builder --mac dmg --universal

restore_dist
echo ""
echo "Done. DMG is under frontend/dist/ (earlier DMGs, if any, in frontend/dist/older/)."

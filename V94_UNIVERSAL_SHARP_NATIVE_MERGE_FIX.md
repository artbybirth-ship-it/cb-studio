# V94 — Universal macOS Sharp Native Merge Fix

## Problem fixed
Electron Builder universal merge failed on Sharp native files such as:
`@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node`

## Fix
- Added `mac.mergeASARs: true`.
- Added `mac.x64ArchFiles: "**/node_modules/@img/**/*.{node,dylib}"` so the universal merger does not try to lipo architecture-specific Sharp/libvips binaries a second time.
- The pattern covers both Electron app dependencies and the Next standalone resources.
- Build script now cleans `dist/` before packaging.
- Unsigned local builds default to `CSC_IDENTITY_AUTO_DISCOVERY=false`.
- Added package description and author to remove builder warnings.

## Build
```bash
cd frontend
chmod +x build-dmg-universal.sh
./build-dmg-universal.sh
```

The expected output is under `frontend/dist/`.

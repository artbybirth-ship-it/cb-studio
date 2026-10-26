# V98 — Cross-architecture packaged Next runtime fix

## Fixed
- Replaced direct `require(Resources/nextapp/server.js)` startup path.
- Electron now starts Next.js through `next/dist/server/lib/start-server` from `app.asar`.
- This avoids `Cannot find module 'next'` from the standalone `server.js` path on both Intel (x64) and Apple Silicon (arm64).
- Reads `.next/required-server-files.json` and loads the exact packaged Next config before starting the local UI server.
- Keeps the existing Universal DMG Sharp/SWC merge rules.

## Rebuild
```bash
cd frontend
rm -rf dist .next
chmod +x build-dmg-universal.sh
./build-dmg-universal.sh
```

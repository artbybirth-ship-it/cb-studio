# V92 — Universal macOS DMG

This build adds an Electron desktop wrapper that packages the Next.js UI as a local standalone server.

## Goal
- One macOS DMG for **Apple Silicon + Intel** using Electron universal build.
- App UI is bundled locally.
- Django/AI services can remain on your server; set their HTTPS origins before building.
- For friction-free distribution to other Macs, sign with a Developer ID certificate and notarize with Apple.

## Build on a Mac
```bash
cd frontend
export CB_BACKEND_ORIGIN="https://YOUR-BACKEND-DOMAIN"
export CB_AI_ORIGIN="https://YOUR-AI-DOMAIN"
./build-dmg-universal.sh
```

Output is created in `frontend/dist/`.

## For signed + notarized production DMG
Install your **Developer ID Application** certificate in Keychain and provide:
```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YOURTEAMID"
```
Then run `./build-dmg-universal.sh` again. electron-builder will sign automatically when the Developer ID certificate is available and the afterSign hook will notarize.

## Important
The default backend origins are localhost only for development. Before distributing to other Macs, build with the real HTTPS backend/AI URLs.

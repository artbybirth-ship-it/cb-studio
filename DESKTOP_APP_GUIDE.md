# CharacterBazaar Studio Desktop App Guide

## Recommended first desktop architecture: Electron

For the current CharacterBazaar Studio stack, Electron is the quickest and lowest-risk way to ship both macOS and Windows applications because the editor already runs in a Chromium browser environment and uses Next.js, Canvas/CreateJS, iframe source players, audio, and rendering UI.

### Option A - Recommended: desktop shell + server backend

Use Electron only for the desktop client. Keep Django, PostgreSQL, Celery/render services, and the AI service on the Linux server.

Desktop app:
- Electron main process
- CharacterBazaar Studio Next.js UI
- Calls the existing Linux API over HTTPS
- macOS output: `.dmg` / signed `.app`
- Windows output: `.exe` installer

This is the simplest production route because the Python backend does not need to be packaged into every desktop installation.

### Basic structure

```
desktop/
  electron/
    main.js
    preload.js
  frontend/        # existing Next.js frontend
  package.json
```

The Electron window can load either:
1. a packaged/static frontend, or
2. the hosted CharacterBazaar Studio URL.

For a true application feel, package the frontend and point its API base URL to the Linux backend.

### Typical packages

```
npm install --save-dev electron electron-builder concurrently wait-on
```

Use `electron-builder` targets:
- macOS: `dmg`
- Windows: `nsis`

### macOS build

Build on a Mac when you need a properly signed/notarized macOS release. Final production distribution normally requires an Apple Developer account for signing and notarization.

Typical command after Electron configuration:

```
npm run desktop:build:mac
```

### Windows build

For the most reliable Windows installer, build on Windows or a Windows CI runner.

Typical command:

```
npm run desktop:build:win
```

### Important production note

This ZIP intentionally has authentication disabled because that was requested for the current MVP/testing flow. If the desktop application continues to use a public Linux API, reintroduce API/device/session authentication before public production release; otherwise the server endpoints are not protected by the desktop wrapper itself.

## Option B - Fully local/offline desktop app

This is possible but more complex. Package the Next.js/Electron UI together with a Python backend sidecar (for example, a PyInstaller-built Django/FastAPI executable), a local database, and local render dependencies. Electron starts/stops that sidecar automatically. Use this only if offline operation is a core requirement.

## Tauri alternative

Tauri can produce a much smaller installer than Electron, but it adds Rust/WebView differences and is more work for this editor stack. For the current CreateJS/canvas-heavy MVP, Electron is the safer first desktop target. Tauri can be evaluated later after editor behavior stabilizes.

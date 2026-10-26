# V99 — Packaged Next HTTP 500 Fix

## Root cause addressed
The packaged Next.js runtime could start, but Electron was invoking `startServer` without two assumptions used by Next's generated standalone `server.js`:

1. working directory must be the standalone app root, and
2. the parsed standalone Next config must be passed as `config` to `startServer`.

Without these, the local server can listen successfully but return HTTP 500 for `/dashboard`.

## Changes
- `frontend/electron/main.cjs`
  - `process.chdir(Resources/nextapp)` before starting Next
  - passes `config: nextConfig` to `startServer`
  - captures/logs the HTTP 500 response body for diagnostics
- package version bumped to 0.1.2

Existing Intel/Apple Silicon universal, Sharp, SWC, signing, and module-resolution fixes are retained.

# V96 — Packaged macOS UI startup fix

## Fixed
- Removed the packaged `ELECTRON_RUN_AS_NODE` child-process launch path.
- Runs the Next.js standalone server directly inside Electron's main Node context.
- This avoids RunAsNode/fuse behavior that can prevent the local UI server from ever starting in packaged universal DMGs.
- UI startup timeout increased to 90 seconds.
- Added persistent diagnostics at `~/Library/Logs/CharacterBazaar Studio/main.log`.
- Existing Universal x64 + arm64 Sharp/SWC merge fixes are retained.

## Changed file
- `frontend/electron/main.cjs`

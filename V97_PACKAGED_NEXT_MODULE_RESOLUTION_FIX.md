# V97 — Packaged Next.js module resolution fix

## Problem fixed
The packaged app could locate `Resources/nextapp/server.js` but that server failed with:

`Cannot find module 'next'`

Electron Builder keeps the app's production dependencies under `Resources/app.asar/node_modules`, while the standalone Next server is copied to `Resources/nextapp`. Node does not automatically search `app.asar/node_modules` for a module loaded from `nextapp`.

## Fix
- Adds both `Resources/nextapp/node_modules` and `Resources/app.asar/node_modules` to `NODE_PATH`.
- Reinitializes Node module search paths before loading the standalone server.
- Verifies `require.resolve("next")` before server startup and writes the exact resolved path to the diagnostic log.
- Keeps the V95 universal Sharp/SWC merge rules and V96 packaged UI startup changes.

Diagnostic log remains:
`~/Library/Logs/CharacterBazaar Studio/main.log`

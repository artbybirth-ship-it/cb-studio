# V101 — Next 16 Turbopack runtime resolution fix

The V100 isolated server starts correctly, but packaged SSR chunks fail with:

`Cannot find module next/dist/compiled/next-server/app-page-turbo.runtime.prod.js`

V101 fixes that in two layers:

1. The complete `node_modules/next` package is copied into `.next/standalone/node_modules/next` before Electron packaging, so the final `Resources/nextapp/node_modules/next` exists beside the SSR build.
2. `electron/next-server-runner.cjs` adds both `nextapp/node_modules` and `app.asar/node_modules` to `NODE_PATH` / `Module.globalPaths`, and performs a preflight `require.resolve` for the Turbopack app-page runtime before starting the server.

Version bumped to 0.1.3.

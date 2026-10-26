# V100 — actual isolated packaged Next server fix

The V99 package did not contain the promised `next-server-runner.cjs`, and `main.cjs` was still starting Next inside Electron's browser process. V100 actually implements the isolation.

Changes:
- `electron/main.cjs` now launches a dedicated Electron `utilityProcess` for the packaged Next server.
- Added `electron/next-server-runner.cjs`.
- The runner changes cwd to `Resources/nextapp`, loads `.next/required-server-files.json`, and starts Next in production mode.
- Runtime module lookup supports both `app.asar/node_modules` and `Resources/nextapp/node_modules`.
- Server stdout/stderr is forwarded into `~/Library/Logs/CharacterBazaar Studio/main.log`.
- Startup logs contain a `V100` marker so installed-version verification is easy.

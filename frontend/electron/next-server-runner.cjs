const fs = require("fs");
const path = require("path");
const Module = require("module");

function emit(type, payload) {
  try { process.parentPort?.postMessage({ type, ...(payload || {}) }); } catch (_) {}
}

function fail(error) {
  const message = error && error.stack ? error.stack : String(error);
  console.error(message);
  emit("error", { message });
  process.exitCode = 1;
}

(async () => {
  try {
    const root = process.argv[2] || process.env.CB_NEXTAPP_ROOT;
    const port = Number(process.argv[3] || process.env.CB_NEXTAPP_PORT || process.env.PORT || 3210);
    if (!root) throw new Error("CB_NEXTAPP_ROOT is missing");

    process.chdir(root);
    process.env.NODE_ENV = "production";
    process.env.HOSTNAME = "127.0.0.1";
    process.env.PORT = String(port);
    process.env.NEXT_MANUAL_SIG_HANDLE = "true";

    const requiredPath = path.join(root, ".next", "required-server-files.json");
    if (!fs.existsSync(requiredPath)) throw new Error(`Missing ${requiredPath}`);
    const required = JSON.parse(fs.readFileSync(requiredPath, "utf8"));
    const nextConfig = required && required.config ? required.config : {};
    process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

    // The utility process runs this file from app.asar/electron, so normal module
    // resolution sees app.asar/node_modules. Add the standalone node_modules too
    // as a fallback for any traced dependency copied by Next.
    const standaloneModules = path.join(root, "node_modules");
    const appAsarModules = path.resolve(__dirname, "..", "node_modules");
    const currentNodePath = process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : [];

    // SSR chunks live under Resources/nextapp/.next and therefore their plain
    // `require("next/...")` calls do not naturally walk into app.asar/node_modules.
    // Make both module roots global before any Next/Turbopack chunk is evaluated.
    process.env.NODE_PATH = [standaloneModules, appAsarModules, ...currentNodePath]
      .filter(Boolean)
      .join(path.delimiter);
    Module._initPaths();
    for (const moduleRoot of [standaloneModules, appAsarModules]) {
      if (moduleRoot && !Module.globalPaths.includes(moduleRoot)) Module.globalPaths.unshift(moduleRoot);
    }

    const turboRuntimeRequest = "next/dist/compiled/next-server/app-page-turbo.runtime.prod.js";
    const turboRuntime = require.resolve(turboRuntimeRequest, {
      paths: [standaloneModules, appAsarModules, root],
    });
    console.log(`Resolved packaged Next Turbopack runtime: ${turboRuntime}`);

    let startServer;
    try {
      ({ startServer } = require("next/dist/server/lib/start-server"));
    } catch (firstError) {
      // Fallback: resolve from standalone node_modules explicitly.
      const resolved = require.resolve("next/dist/server/lib/start-server", { paths: [standaloneModules, root] });
      ({ startServer } = require(resolved));
    }

    console.log(`Starting CharacterBazaar packaged UI on 127.0.0.1:${port} from ${root}`);
    await startServer({
      dir: root,
      isDev: false,
      config: nextConfig,
      hostname: "127.0.0.1",
      port,
      allowRetry: false,
      customServer: false,
      minimalMode: false,
      keepAliveTimeout: 5000,
    });
    emit("started", { port, root });
  } catch (error) {
    fail(error);
  }
})();

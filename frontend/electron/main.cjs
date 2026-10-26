const { app, BrowserWindow, Menu, shell, dialog, utilityProcess } = require("electron");
const net = require("net");
const path = require("path");
const http = require("http");
const fs = require("fs");
const os = require("os");

let mainWindow = null;
let packagedUiPromise = null;
let uiServerProcess = null;

function logPath() {
  return path.join(os.homedir(), "Library", "Logs", "CharacterBazaar Studio", "main.log");
}

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map((value) => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }).join(" ")}\n`;
  try {
    const file = logPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line);
  } catch (_) {}
  try { console.log(line.trim()); } catch (_) {}
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 3210;
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(url, timeoutMs = 90000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let finished = false;
    let lastLoggedStatus = null;
    const done = (fn, value) => {
      if (finished) return;
      finished = true;
      fn(value);
    };
    const retry = (lastError) => {
      if (finished) return;
      if (Date.now() - started > timeoutMs) {
        const suffix = lastError ? ` Last error: ${lastError.message || lastError}` : "";
        return done(reject, new Error(`Local UI server did not start in time.${suffix}\nLog: ${logPath()}`));
      }
      setTimeout(poll, 300);
    };
    const poll = () => {
      if (finished) return;
      const req = http.get(url, (res) => {
        const status = res.statusCode || 500;
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { if (body.length < 12000) body += chunk; });
        res.on("end", () => {
          if (status >= 200 && status < 500) return done(resolve);
          const compact = body.replace(/\s+/g, " ").slice(0, 2000);
          if (lastLoggedStatus !== status) {
            log("UI probe returned server error", { url, status, body: compact });
            lastLoggedStatus = status;
          }
          retry(new Error(`HTTP ${status}${compact ? `: ${compact}` : ""}`));
        });
      });
      req.on("error", retry);
      req.setTimeout(2500, () => req.destroy(new Error("UI probe timeout")));
    };
    poll();
  });
}

function attachServerLogs(child) {
  if (child.stdout) {
    child.stdout.on("data", (chunk) => {
      const msg = String(chunk || "").trim();
      if (msg) log("[ui-server stdout]", msg);
    });
  }
  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      const msg = String(chunk || "").trim();
      if (msg) log("[ui-server stderr]", msg);
    });
  }
  child.on("message", (message) => log("[ui-server message]", message));
  child.on("exit", (code) => log("Packaged UI utility process exited", { code }));
}

async function startPackagedNext() {
  if (packagedUiPromise) return packagedUiPromise;

  packagedUiPromise = (async () => {
    const port = await freePort();
    const root = path.join(process.resourcesPath, "nextapp");
    const requiredServerFiles = path.join(root, ".next", "required-server-files.json");
    const runner = path.join(__dirname, "next-server-runner.cjs");

    log("V103 starting self-contained packaged UI", {
      root,
      runner,
      port,
      resourcesPath: process.resourcesPath,
      arch: process.arch,
      platform: process.platform,
    });

    if (!fs.existsSync(requiredServerFiles)) {
      throw new Error(`Packaged Next.js build is incomplete: ${requiredServerFiles} is missing.\nLog: ${logPath()}`);
    }
    if (!fs.existsSync(runner)) {
      throw new Error(`Packaged UI runner is missing: ${runner}\nLog: ${logPath()}`);
    }

    const env = {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      NEXT_MANUAL_SIG_HANDLE: "true",
      CB_NEXTAPP_ROOT: root,
      CB_NEXTAPP_PORT: String(port),
      // v103 local desktop storage: no Django/Postgres process is required for
      // projects, scenes, file uploads, or the universal character library.
      CB_LOCAL_DATA_DIR: path.join(app.getPath("userData"), "local-data"),
    };

    uiServerProcess = utilityProcess.fork(runner, [root, String(port)], {
      env,
      stdio: "pipe",
      serviceName: "CharacterBazaar Studio UI Server",
    });
    attachServerLogs(uiServerProcess);

    const url = `http://127.0.0.1:${port}/dashboard`;
    await waitForServer(url, 90000);
    log("V103 packaged UI is ready", url);
    return url;
  })();

  try {
    return await packagedUiPromise;
  } catch (error) {
    packagedUiPromise = null;
    try { uiServerProcess?.kill(); } catch (_) {}
    uiServerProcess = null;
    throw error;
  }
}

function createApplicationMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Project",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            if (!mainWindow) return;
            try {
              const dashboardUrl = new URL(mainWindow.webContents.getURL());
              dashboardUrl.pathname = "/dashboard";
              dashboardUrl.search = "?newProject=1";
              dashboardUrl.hash = "";
              mainWindow.loadURL(dashboardUrl.toString()).catch((error) => {
                log("Could not open new project dialog", error);
              });
            } catch (error) {
              log("Could not build dashboard URL for new project", error);
            }
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const url = app.isPackaged
    ? await startPackagedNext()
    : (process.env.ELECTRON_DEV_URL || "http://127.0.0.1:3000/dashboard");

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: "#111111",
    title: "CharacterBazaar Studio",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => log("Renderer process gone", details));
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    log("Renderer failed to load", { errorCode, errorDescription, validatedURL });
  });

  await mainWindow.loadURL(url);
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createApplicationMenu();
    return createWindow();
  }).catch((error) => {
    log("Application startup failed", error);
    dialog.showErrorBox(
      "CharacterBazaar Studio",
      `${String(error && error.message ? error.message : error)}\n\nDiagnostic log:\n${logPath()}`,
    );
    app.quit();
  });
}

app.on("before-quit", () => {
  try { uiServerProcess?.kill(); } catch (_) {}
  uiServerProcess = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow().catch((error) => log("Reopen failed", error));
});

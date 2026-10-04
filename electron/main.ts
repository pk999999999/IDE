import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  session,
  type IpcMainInvokeEvent,
} from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import { EngineBridge } from "./engine";
import {
  isPreviewURL,
  validateRequest,
  type Provider,
} from "../src/shared/protocol";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "studio",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
let window: BrowserWindow | undefined;
let bridge = new EngineBridge();
let currentRoot: string | undefined;
let opening = false;
let quitting = false;
const envKeys: Record<Provider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
};
const development =
  !app.isPackaged && process.env.DEGRAVITY_DEV_URL === "http://127.0.0.1:5173";
if (!app.isPackaged) config({ path: path.join(app.getAppPath(), ".env") });
const trustedURL = (url: string) =>
  development
    ? new URL(url).origin === "http://127.0.0.1:5173"
    : url.startsWith("studio://app/");

function authorize(event: IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !trustedURL(event.senderFrame.url)
  )
    throw new Error("Untrusted IPC sender");
}
async function storedKeys(): Promise<Record<string, string>> {
  const keys: Record<string, string> = {};
  for (const env of Object.values(envKeys))
    if (process.env[env]) keys[env] = process.env[env]!;
  try {
    const data = JSON.parse(
      await readFile(
        path.join(app.getPath("userData"), "credentials.json"),
        "utf8",
      ),
    ) as Record<Provider, string>;
    if (safeStorage.isEncryptionAvailable())
      for (const [provider, ciphertext] of Object.entries(data)) {
        if (provider in envKeys && typeof ciphertext === "string")
          keys[envKeys[provider as Provider]] = safeStorage.decryptString(
            Buffer.from(ciphertext, "base64"),
          );
      }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.error("Credential store unavailable");
  }
  return keys;
}
function attachBridge(next: EngineBridge) {
  bridge = next;
  bridge.on("event", (payload) => {
    if (window && !window.isDestroyed())
      window.webContents.send("engine:event", payload);
  });
}
async function connect(root: string) {
  await bridge.stop();
  attachBridge(new EngineBridge());
  const name = `antigravity-engine${process.platform === "win32" ? ".exe" : ""}`;
  const binary = app.isPackaged
    ? path.join(process.resourcesPath, "bin", name)
    : path.join(app.getAppPath(), "resources", "bin", name);
  await bridge.start(binary, root, await storedKeys());
  currentRoot = root;
}
async function confirm(title: string, detail: string) {
  if (!window) throw new Error("Window unavailable");
  const { response } = await dialog.showMessageBox(window, {
    type: "question",
    title,
    message: title,
    detail,
    buttons: ["Cancel", "Allow"],
    defaultId: 0,
    cancelId: 0,
  });
  if (response !== 1) throw new Error("Action cancelled");
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#101116",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 14, y: 14 },
    frame: process.platform === "darwin",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!trustedURL(url)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event, preferences, params) => {
    if (!params.src || !isPreviewURL(params.src)) {
      event.preventDefault();
      return;
    }
    delete preferences.preload;
    preferences.nodeIntegration = false;
    preferences.nodeIntegrationInSubFrames = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
    preferences.webSecurity = true;
    preferences.partition = "degravity-preview";
  });
  window.webContents.on("did-attach-webview", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
      if (!isPreviewURL(url)) event.preventDefault();
    });
    contents.on("will-redirect", (event, url) => {
      if (!isPreviewURL(url)) event.preventDefault();
    });
    contents.session.setPermissionRequestHandler(
      (_web, _permission, callback) => callback(false),
    );
    contents.session.setPermissionCheckHandler(() => false);
    contents.session.on("will-download", (event) => event.preventDefault());
  });
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      void dialog
        .showMessageBox(window!, {
          type: "question",
          message: "Close DeGravity Studio?",
          detail:
            "Unsaved editor changes and session diff history will be lost.",
          buttons: ["Keep working", "Close"],
          defaultId: 0,
          cancelId: 0,
        })
        .then(async ({ response }) => {
          if (response === 1) {
            quitting = true;
            await bridge.stop();
            window?.destroy();
            app.quit();
          }
        });
    }
  });
  const sendMenu = (action: string) =>
    window?.webContents.send("engine:event", {
      event: "menu.action",
      data: { action },
    });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin"
        ? [
            {
              label: "DeGravity Studio",
              submenu: [{ role: "about" as const }, { role: "quit" as const }],
            },
          ]
        : []),
      {
        label: "File",
        submenu: [
          {
            label: "Open Folder",
            accelerator: "CmdOrCtrl+O",
            click: () => sendMenu("open"),
          },
          {
            label: "Save",
            accelerator: "CmdOrCtrl+S",
            click: () => sendMenu("save"),
          },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
        ],
      },
      {
        label: "View",
        submenu: [
          {
            label: "Quick Open",
            accelerator: "CmdOrCtrl+P",
            click: () => sendMenu("quickOpen"),
          },
          { role: "toggleDevTools" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Terminal",
        submenu: [
          {
            label: "Focus Terminal",
            accelerator: "Ctrl+`",
            click: () => sendMenu("terminal"),
          },
        ],
      },
      {
        label: "Agent",
        submenu: [
          {
            label: "Inline Prompt",
            accelerator: "CmdOrCtrl+K",
            click: () => sendMenu("prompt"),
          },
        ],
      },
      {
        label: "Help",
        submenu: [
          {
            label: "About DeGravity Studio",
            click: () => {
              void dialog.showMessageBox({
                message: "DeGravity Studio 0.1.0",
                detail: "Electron + React + Rust. Bring your own API keys.",
              });
            },
          },
        ],
      },
    ]),
  );
  await window.loadURL(
    development ? "http://127.0.0.1:5173" : "studio://app/index.html",
  );
}

app
  .whenReady()
  .then(async () => {
    protocol.handle("studio", (request) => {
      const url = new URL(request.url);
      const root = path.join(app.getAppPath(), "dist");
      const file = path.resolve(root, "." + decodeURIComponent(url.pathname));
      if (url.hostname !== "app" || !file.startsWith(root + path.sep))
        return new Response("Forbidden", { status: 403 });
      return net.fetch(pathToFileURL(file).href);
    });
    session.defaultSession.setPermissionRequestHandler(
      (_web, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const csp = `default-src 'self'; script-src 'self'${development ? " 'unsafe-inline'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'${development ? " ws://127.0.0.1:5173" : ""}; frame-src http://localhost:* http://127.0.0.1:* http://[::1]:*; object-src 'none'; base-uri 'self'`;
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [csp],
        },
      });
    });
    ipcMain.handle("workspace:open", async (event) => {
      authorize(event);
      if (opening) throw new Error("Workspace is already opening");
      opening = true;
      try {
        const { canceled, filePaths } = await dialog.showOpenDialog(window!, {
          properties: ["openDirectory"],
          title: "Open trusted workspace",
        });
        if (canceled || !filePaths[0]) return null;
        await connect(filePaths[0]);
        return { root: filePaths[0] };
      } finally {
        opening = false;
      }
    });
    ipcMain.handle(
      "engine:request",
      async (event, method: string, params: unknown) => {
        authorize(event);
        const input = validateRequest(method, params);
        if (method === "mcp.start" || method === "lsp.start")
          await confirm(
            "Start local server?",
            `${JSON.stringify(input, null, 2)}\n\nThis executable runs with your user account permissions.`,
          );
        if (method === "mcp.call")
          await confirm("Run MCP tool?", JSON.stringify(input, null, 2));
        if (method === "agent.verify")
          await confirm(
            "Run planned verification?",
            "Runs the displayed plan commands in an offline Docker container using a temporary workspace copy. Docker must be installed and the configured image must already be pulled.",
          );
        return bridge.request(method, input);
      },
    );
    ipcMain.handle("keys:status", async (event) => {
      authorize(event);
      const keys = await storedKeys();
      return Object.fromEntries(
        Object.entries(envKeys).map(([p, env]) => [p, Boolean(keys[env])]),
      );
    });
    ipcMain.handle(
      "keys:save",
      async (event, provider: Provider, key: string) => {
        authorize(event);
        if (
          !Object.prototype.hasOwnProperty.call(envKeys, provider) ||
          typeof key !== "string" ||
          key.length > 4096
        )
          throw new Error("Invalid credential");
        if (
          !safeStorage.isEncryptionAvailable() ||
          (process.platform === "linux" &&
            safeStorage.getSelectedStorageBackend() === "basic_text")
        )
          throw new Error(
            "A system credential store is required; use environment variables until it is available.",
          );
        const file = path.join(app.getPath("userData"), "credentials.json");
        let data: Record<string, string> = {};
        try {
          data = JSON.parse(await readFile(file, "utf8"));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        if (key)
          data[provider] = safeStorage.encryptString(key).toString("base64");
        else delete data[provider];
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(data), { mode: 0o600 });
        // Restart is explicit so terminals and rollback history are never silently discarded.
        window?.webContents.send("engine:event", {
          event: "settings.saved",
          data: { reopenRequired: Boolean(currentRoot) },
        });
      },
    );
    ipcMain.on("window:action", (event, action: string) => {
      authorize(event);
      if (action === "minimize") window?.minimize();
      if (action === "maximize")
        window?.isMaximized() ? window.unmaximize() : window?.maximize();
      if (action === "close") window?.close();
    });
    await createWindow();
  })
  .catch((error) => {
    dialog.showErrorBox("DeGravity Studio failed to start", String(error));
    quitting = true;
    app.quit();
  });
app.on("before-quit", (event) => {
  if (!quitting) {
    event.preventDefault();
    window?.close();
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    quitting = false;
    void createWindow();
  }
});

// Hidden Electron smoke test of the compiled React app and production preload.
const { app, BrowserWindow, ipcMain, net, protocol } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { mkdir, writeFile, mkdtemp, copyFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { existsSync } = require("node:fs");
const { EngineBridge } = require("../dist-electron/engine.cjs");
let bridge;
let fixture;
async function cleanup() {
  await bridge?.stop();
  if (fixture) await rm(fixture, { recursive: true, force: true });
}
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
const timeout = setTimeout(() => {
  console.error("UI smoke timeout");
  app.exit(1);
}, 60000);
app
  .whenReady()
  .then(async () => {
    const root = path.resolve(__dirname, "..");
    protocol.handle("studio", (request) =>
      net.fetch(
        pathToFileURL(path.join(root, "dist", new URL(request.url).pathname))
          .href,
      ),
    );
    ipcMain.handle("keys:status", () => ({
      openai: false,
      anthropic: false,
      gemini: false,
    }));
    const window = new BrowserWindow({
      show: false,
      width: 1600,
      height: 1000,
      webPreferences: {
        preload: path.join(root, "dist-electron", "preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: true,
        backgroundThrottling: false,
      },
    });
    const binary = path.join(
      root,
      "resources",
      "bin",
      `antigravity-engine${process.platform === "win32" ? ".exe" : ""}`,
    );
    if (existsSync(binary)) {
      fixture = await mkdtemp(path.join(tmpdir(), "degravity-ui-"));
      const workspace = path.join(fixture, "degravity-studio");
      const files = [
        "src/shared/protocol.ts",
        "src/store.ts",
        "src/App.tsx",
        "crates/engine/src/main.rs",
        "Cargo.toml",
        "package.json",
        "README.md",
      ];
      for (const relative of files) {
        const destination = path.join(workspace, relative);
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(path.join(root, relative), destination);
      }
      bridge = new EngineBridge();
      bridge.on("event", (event) =>
        window.webContents.send("engine:event", event),
      );
      await bridge.start(binary, workspace, {});
      ipcMain.handle("engine:request", (_event, method, params) =>
        bridge.request(method, params),
      );
      ipcMain.handle("workspace:open", () => ({ root: workspace }));
    }
    const errors = [];
    window.webContents.on("console-message", (_event, level, message) => {
      if (level >= 3) errors.push(message);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      console.error(details);
      app.exit(1);
    });
    await window.loadURL("studio://app/index.html");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const initial = await window.webContents.executeJavaScript(
      `({title:document.title,welcome:document.body.innerText.includes('Space to build.'),agent:document.body.innerText.includes('Agent workspace'),bridge:typeof window.studio?.request})`,
    );
    if (!initial.welcome || !initial.agent || initial.bridge !== "function")
      throw new Error(JSON.stringify(initial));
    if (bridge) {
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Open folder').click()`,
      );
      for (let attempt = 0; attempt < 40; attempt++) {
        const present = await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('button[title="src/shared/protocol.ts"]'))`,
        );
        if (present) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await window.webContents.executeJavaScript(
        `document.querySelector('button[title="src/shared/protocol.ts"]').click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2200));
      const editor = await window.webContents.executeJavaScript(
        `({connected:document.body.innerText.includes('Engine connected'),monaco:Boolean(document.querySelector('.monaco-editor')),lines:document.querySelectorAll('.view-line').length})`,
      );
      if (!editor.connected || !editor.monaco || editor.lines < 5)
        throw new Error(`Monaco did not render the source file: ${JSON.stringify(editor)}`);
      await window.webContents.executeJavaScript(
        `document.querySelector('button[title="New file"]').click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      const fileDialog = await window.webContents.executeJavaScript(
        `Boolean(document.querySelector('input[aria-label="Relative file path"]'))`,
      );
      if (!fileDialog) throw new Error("Create-file dialog did not open");
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Cancel').click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (process.env.DEGRAVITY_SMOKE_SHOW_CAPTURE) {
      window.showInactive();
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    const screenshot = await window.webContents.capturePage();
    if (process.env.DEGRAVITY_SMOKE_SHOW_CAPTURE) window.hide();
    await mkdir(path.join(root, "docs", "screenshots"), { recursive: true });
    await writeFile(
      path.join(root, "docs", "screenshots", "studio.png"),
      screenshot.toPNG(),
    );
    await window.webContents.executeJavaScript(
      `document.querySelector('button[title="Settings"]').click()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const settings = await window.webContents.executeJavaScript(
      `Boolean(document.querySelector('input[type="password"]'))`,
    );
    if (!settings) throw new Error("Settings panel did not mount");
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      `UI smoke passed: production bundle, isolated preload, workspace shell, agent panel, settings and screenshot. Native engine integration: ${Boolean(bridge)}.`,
    );
    await cleanup();
    clearTimeout(timeout);
    app.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await cleanup();
    app.exit(1);
  });

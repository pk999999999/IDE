import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI, EngineEvent } from "../src/shared/protocol";
const api: DesktopAPI = {
  platform: process.platform,
  request: (method, params) =>
    ipcRenderer.invoke("engine:request", method, params),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: EngineEvent) =>
      listener(payload);
    ipcRenderer.on("engine:event", handler);
    return () => {
      ipcRenderer.removeListener("engine:event", handler);
    };
  },
  openWorkspace: () => ipcRenderer.invoke("workspace:open"),
  keyStatus: () => ipcRenderer.invoke("keys:status"),
  saveKey: (provider, key) => ipcRenderer.invoke("keys:save", provider, key),
  window: (action) => ipcRenderer.send("window:action", action),
};
contextBridge.exposeInMainWorld("studio", api);

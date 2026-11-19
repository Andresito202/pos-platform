import { contextBridge, ipcRenderer } from "electron";
import { RENDERER_API_KEY, RENDERER_API_METHODS } from "./preload-api.js";

const api: Record<string, (payload: unknown) => Promise<unknown>> = {};

for (const method of RENDERER_API_METHODS) {
  api[method] = (payload: unknown) => ipcRenderer.invoke(`pos:${method}`, payload);
}

contextBridge.exposeInMainWorld(RENDERER_API_KEY, api);

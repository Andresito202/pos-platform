import { contextBridge, ipcRenderer } from "electron";
import { RENDERER_API_KEY, RENDERER_API_METHODS } from "./preload-api.js";
import { DESKTOP_OPEN_EXTERNAL_URL_CHANNEL } from "./desktop-shell.js";

export const DESKTOP_SHELL_API_KEY = "posDesktopShell" as const;

const api: Record<string, (payload: unknown) => Promise<unknown>> = {};

for (const method of RENDERER_API_METHODS) {
  api[method] = (payload: unknown) => ipcRenderer.invoke(`pos:${method}`, payload);
}

contextBridge.exposeInMainWorld(RENDERER_API_KEY, api);

/** Narrow shell surface: only allowlisted HTTPS URLs via main-process openExternal. */
contextBridge.exposeInMainWorld(DESKTOP_SHELL_API_KEY, {
  openExternalUrl: (url: string) => ipcRenderer.invoke(DESKTOP_OPEN_EXTERNAL_URL_CHANNEL, url),
});

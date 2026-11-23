import { ipcMain, shell } from "electron";
import { resolveAllowedExternalHttpsUrl } from "./institutional-site.js";

/** Desktop-only IPC — never forwarded to the POS Local Service channel. */
export const DESKTOP_OPEN_EXTERNAL_URL_CHANNEL = "pos:desktop.openExternalUrl" as const;

export const DESKTOP_SHELL_CHANNELS = [DESKTOP_OPEN_EXTERNAL_URL_CHANNEL] as const;

export type OpenExternalUrlResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: "INVALID" | "DENIED" | "OPEN_FAILED" };

export async function openAllowedExternalHttpsUrl(candidate: unknown): Promise<OpenExternalUrlResult> {
  const allowed = resolveAllowedExternalHttpsUrl(candidate);
  if (allowed === null) {
    return { ok: false, reason: typeof candidate === "string" ? "DENIED" : "INVALID" };
  }
  try {
    await shell.openExternal(allowed);
    return { ok: true, url: allowed };
  } catch {
    return { ok: false, reason: "OPEN_FAILED" };
  }
}

export function registerDesktopShellHandlers(): void {
  ipcMain.handle(DESKTOP_OPEN_EXTERNAL_URL_CHANNEL, async (_event, url: unknown) =>
    openAllowedExternalHttpsUrl(url));
}

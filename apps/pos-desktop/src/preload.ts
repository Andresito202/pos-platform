import { contextBridge, ipcRenderer } from "electron";
import { RENDERER_API_KEY, RENDERER_API_METHODS } from "./preload-api.js";

const api: Record<string, (payload: unknown) => Promise<unknown>> = {};

for (const method of RENDERER_API_METHODS) {
  api[method] = (payload: unknown) => ipcRenderer.invoke(`pos:${method}`, payload);
}

contextBridge.exposeInMainWorld(RENDERER_API_KEY, api);

/**
 * Non-authoritative UX hints only. Never a permission grant.
 * Design-review register id is provisioned by the isolated launcher and
 * mirrored through POS_DESIGN_REVIEW_REGISTER_ID so cashiers need not paste UUIDs.
 */
const rawRegister = process.env.POS_DESIGN_REVIEW_REGISTER_ID?.trim().toLowerCase() ?? "";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
contextBridge.exposeInMainWorld("posDesktopHints", {
  designReviewRegisterId: UUID.test(rawRegister) ? rawRegister : null,
});

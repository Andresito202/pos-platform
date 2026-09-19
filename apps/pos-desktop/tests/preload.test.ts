import { describe, it, expect, vi, beforeEach } from "vitest";
import { RENDERER_API_KEY, RENDERER_API_METHODS } from "../src/preload-api.js";
import { IPC_ALLOWED_CHANNELS } from "../src/ipc-allowlist.js";

const exposeInMainWorld = vi.fn();
const invoke = vi.fn();

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: Record<string, unknown>) =>
      exposeInMainWorld(key, api),
  },
  ipcRenderer: {
    invoke: (channel: string, payload: unknown) => invoke(channel, payload),
  },
}));

async function loadPreload(): Promise<Record<string, (payload: unknown) => Promise<unknown>>> {
  vi.resetModules();
  exposeInMainWorld.mockClear();
  invoke.mockClear();
  await import("../src/preload.js");
  const call = exposeInMainWorld.mock.calls.at(-1);
  if (!call) throw new Error("preload no llamó a exposeInMainWorld");
  return call[1] as Record<string, (payload: unknown) => Promise<unknown>>;
}

beforeEach(() => {
  invoke.mockResolvedValue({ status: "SUCCEEDED" });
});

describe("preload contextBridge wiring", () => {
  it("exposes the api under the agreed renderer key", async () => {
    await loadPreload();
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(exposeInMainWorld.mock.calls[0]?.[0]).toBe(RENDERER_API_KEY);
  });

  it("exposes exactly the declared methods and nothing else", async () => {
    const api = await loadPreload();
    expect(Object.keys(api).sort()).toEqual([...RENDERER_API_METHODS].sort());
  });

  it("never exposes node, process or require to the renderer", async () => {
    const api = await loadPreload();
    for (const forbidden of ["require", "process", "Buffer", "__dirname", "module"]) {
      expect(Object.hasOwn(api, forbidden)).toBe(false);
    }
  });

  it("routes every method through an allowlisted pos: channel", async () => {
    const api = await loadPreload();
    for (const method of RENDERER_API_METHODS) {
      invoke.mockClear();
      await api[method]?.({ probe: method });
      const channel = invoke.mock.calls[0]?.[0] as string;
      expect(channel).toBe(`pos:${method}`);
      expect(IPC_ALLOWED_CHANNELS as readonly string[]).toContain(channel);
    }
  });

  it("forwards the caller payload unchanged", async () => {
    const api = await loadPreload();
    const payload = { operation_id: "op-42" };
    await api["operation.confirm"]?.(payload);
    expect(invoke).toHaveBeenCalledWith("pos:operation.confirm", payload);
  });

  it("propagates the value resolved by the main process", async () => {
    const api = await loadPreload();
    invoke.mockResolvedValue({ status: "SUCCEEDED", result_code: "CONFIRMED" });
    await expect(api["operation.confirm"]?.({ operation_id: "op-7" })).resolves.toEqual({
      status: "SUCCEEDED",
      result_code: "CONFIRMED",
    });
  });

  it("propagates main process rejections instead of swallowing them", async () => {
    const api = await loadPreload();
    invoke.mockRejectedValue(new Error("canal cerrado"));
    await expect(api["runtime.status.get"]?.({})).rejects.toThrow("canal cerrado");
  });
});

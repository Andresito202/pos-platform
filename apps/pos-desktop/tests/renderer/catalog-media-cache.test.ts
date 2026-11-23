// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  bindCatalogMediaSession,
  clearCatalogMediaCache,
  forgetCatalogMedia,
  peekCatalogMediaUrl,
  resolveCatalogMediaUrl,
} from "../../renderer/src/catalog-media-cache.js";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";

beforeEach(() => {
  clearCatalogMediaCache();
  const service: Record<string, (payload: unknown) => Promise<unknown>> = {};
  for (const method of RENDERER_API_METHODS) {
    service[method] = async () => ({
      status: "SUCCEEDED",
      result_code: "FOUND",
      result: {
        outcome: "FOUND",
        media_id: "33333333-3333-4333-8333-333333333333",
        mime_type: "image/png",
        width_px: 32,
        height_px: 32,
        content_base64: btoa("png-bytes"),
      },
    });
  }
  Object.defineProperty(window, "posService", { value: service, writable: true, configurable: true });
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:media-1"),
    revokeObjectURL: vi.fn(),
  });
});

describe("catalog media session cache", () => {
  it("drops cached object URLs when the session identity changes", async () => {
    bindCatalogMediaSession({ username: "admin", role: "ADMINISTRADOR", epoch: 1 });
    const url = await resolveCatalogMediaUrl("33333333-3333-4333-8333-333333333333");
    expect(url).toBe("blob:media-1");
    expect(peekCatalogMediaUrl("33333333-3333-4333-8333-333333333333")).toBe("blob:media-1");

    bindCatalogMediaSession({ username: "cajero", role: "CAJERO", epoch: 2 });
    expect(peekCatalogMediaUrl("33333333-3333-4333-8333-333333333333")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("clears on logout and forgets replaced media", async () => {
    bindCatalogMediaSession({ username: "admin", role: "ADMINISTRADOR", epoch: 1 });
    await resolveCatalogMediaUrl("33333333-3333-4333-8333-333333333333");
    forgetCatalogMedia("33333333-3333-4333-8333-333333333333");
    expect(peekCatalogMediaUrl("33333333-3333-4333-8333-333333333333")).toBeNull();
    clearCatalogMediaCache();
    expect(peekCatalogMediaUrl("33333333-3333-4333-8333-333333333333")).toBeNull();
  });
});

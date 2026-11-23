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
  it("does not restore a stale image or erase a newer in-flight request after invalidation", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    bindCatalogMediaSession({ username: "admin", role: "ADMINISTRADOR", epoch: 1 });
    const pending: Array<(result: unknown) => void> = [];
    const valid = () => ({
      status: "SUCCEEDED",
      result: {
        outcome: "FOUND",
        media_id: id,
        mime_type: "image/png",
        content_base64: btoa("image-bytes"),
      },
    });
    Object.defineProperty(window, "posService", {
      value: {
        ...window.posService,
        "catalog.media.get": () => new Promise((resolve) => { pending.push(resolve); }),
      },
      writable: true,
      configurable: true,
    });
    const oldLoad = resolveCatalogMediaUrl(id);
    expect(pending).toHaveLength(1);

    forgetCatalogMedia(id);
    const newLoad = resolveCatalogMediaUrl(id);
    expect(pending).toHaveLength(2);

    pending[0]!(valid());
    expect(await oldLoad).toBeNull();
    const deduplicated = resolveCatalogMediaUrl(id);
    expect(pending).toHaveLength(2);
    pending[1]!(valid());
    expect(await newLoad).toBe("blob:media-1");
    expect(await deduplicated).toBe("blob:media-1");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("rejects previous-session loads after logout without creating blob URLs", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    bindCatalogMediaSession({ username: "admin", role: "ADMINISTRADOR", epoch: 1 });
    let finish: ((value: unknown) => void) | undefined;
    Object.defineProperty(window, "posService", {
      value: {
        ...window.posService,
        "catalog.media.get": () => new Promise((resolve) => { finish = resolve; }),
      },
      writable: true,
      configurable: true,
    });
    const loading = resolveCatalogMediaUrl(id);
    clearCatalogMediaCache();
    finish!({
      status: "SUCCEEDED",
      result: {
        outcome: "FOUND",
        media_id: id,
        mime_type: "image/png",
        content_base64: btoa("image"),
      },
    });
    expect(await loading).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("evicts the oldest images when the entry bound is reached", async () => {
    bindCatalogMediaSession({ username: "admin", role: "ADMINISTRADOR", epoch: 1 });
    let number = 0;
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:media-${++number}`),
      revokeObjectURL: vi.fn(),
    });
    const firstId = "media-000";
    for (let i = 0; i < 257; i += 1) {
      const id = `media-${String(i).padStart(3, "0")}`;
      await resolveCatalogMediaUrl(id);
    }
    expect(peekCatalogMediaUrl(firstId)).toBeNull();
    expect(peekCatalogMediaUrl("media-256")).not.toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-1");
  });

});

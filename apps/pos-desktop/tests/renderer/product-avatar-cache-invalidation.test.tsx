// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { CatalogItemListItem } from "@pos-platform/contracts";
import { ProductAvatar } from "../../renderer/src/components/ProductAvatar.js";
import { bindCatalogMediaSession, clearCatalogMediaCache, forgetCatalogMedia } from "../../renderer/src/catalog-media-cache.js";
import { notifyCatalogInventoryChanged } from "../../renderer/src/catalog-invalidate.js";

const id = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  clearCatalogMediaCache();
  let loadCount = 0;
  Object.defineProperty(window, "posService", {
    value: {
      "catalog.media.get": vi.fn(async () => ({
        status: "SUCCEEDED",
        result_code: "FOUND",
        result: {
          outcome: "FOUND",
          media_id: id,
          mime_type: "image/png",
          content_base64: btoa(`image-${++loadCount}`),
        },
      })),
    },
    writable: true,
    configurable: true,
  });
  let urls = 0;
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:catalog-${++urls}`),
    revokeObjectURL: vi.fn(),
  });
  bindCatalogMediaSession({ username: "admin", role: "ADMINISTRADOR", epoch: 1 });
});

describe("ProductAvatar media invalidation", () => {
  it("reloads replaced media with the same media_id on the existing catalog event", async () => {
    const item = { media_id: id } as CatalogItemListItem;
    render(<ProductAvatar item={item} />);
    await waitFor(() => expect(screen.getByTestId("product-avatar-image").getAttribute("src")).toBe("blob:catalog-1"));
    forgetCatalogMedia(id);
    act(() => { notifyCatalogInventoryChanged(); });
    await waitFor(() => expect(screen.getByTestId("product-avatar-image").getAttribute("src")).toBe("blob:catalog-2"));
    expect(window.posService["catalog.media.get"]).toHaveBeenCalledTimes(2);
  });
});

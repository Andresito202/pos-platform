// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { notifyCatalogInventoryChanged } from "../../renderer/src/catalog-invalidate.js";
import { useCommercialSale } from "../../renderer/src/hooks/useCommercialSale.js";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";

let listCalls = 0;
let releaseList: (() => void) | null = null;

beforeEach(() => {
  listCalls = 0;
  releaseList = null;
  const service: Record<string, (payload: unknown) => Promise<unknown>> = {};
  for (const method of RENDERER_API_METHODS) {
    service[method] = async () => ({ status: "SUCCEEDED", result_code: "OK", result: null });
  }
  service["catalog.item.list"] = async () => {
    listCalls += 1;
    await new Promise<void>((resolve) => { releaseList = resolve; });
    return {
      status: "SUCCEEDED",
      result_code: "FOUND",
      result: {
        outcome: "FOUND",
        items: [],
        has_more: false,
      },
    };
  };
  Object.defineProperty(window, "posService", { value: service, writable: true, configurable: true });
});

describe("catalog invalidate coalesce", () => {
  it("replays a pending refresh when invalidation arrives mid-list", async () => {
    const { result } = renderHook(() => useCommercialSale({ canReadCatalog: true }));
    await waitFor(() => expect(listCalls).toBe(1));

    act(() => { notifyCatalogInventoryChanged(); });
    expect(listCalls).toBe(1);

    await act(async () => {
      releaseList?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(listCalls).toBe(2));
    await act(async () => {
      releaseList?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.catalogBusy).toBe(false));
  });
});

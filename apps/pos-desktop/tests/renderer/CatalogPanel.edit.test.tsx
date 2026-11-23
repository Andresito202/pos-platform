// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CanonicalPermission } from "@pos-platform/contracts";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { CatalogPanel } from "../../renderer/src/components/CatalogPanel.js";

const calls = new Map<string, unknown[]>();
const cannedByMethod = new Map<string, unknown>();

function installDefaults(): void {
  cannedByMethod.clear();
  for (const method of RENDERER_API_METHODS) {
    cannedByMethod.set(method, { status: "SUCCEEDED", result_code: "OK", result: null });
  }
}

function install(): void {
  const service: Record<string, (payload: unknown) => Promise<unknown>> = {};
  for (const method of RENDERER_API_METHODS) {
    service[method] = (payload: unknown) => {
      const seen = calls.get(method) ?? [];
      seen.push(payload);
      calls.set(method, seen);
      return Promise.resolve(cannedByMethod.get(method));
    };
  }
  Object.defineProperty(window, "posService", { value: service, writable: true, configurable: true });
}

beforeEach(() => {
  calls.clear();
  installDefaults();
  install();
});

const ITEM = {
  product_id: "11111111-1111-4111-8111-111111111111",
  presentation_id: "22222222-2222-4222-8222-222222222222",
  code: "ARZ-500",
  name: "Arroz",
  description: "Arroz blanco",
  brand: "Diana",
  category: "Abarrotes",
  presentation_name: "Bolsa 500g",
  unit_code: "UND",
  unit_precision: 0,
  barcode: "7700000000017",
  stock_controlled: true,
  price_amount: "1500.000000",
  currency_code: "COP",
  quantity_available: "10.000000",
  quantity_on_hand: "10.000000",
  quantity_reserved: "0.000000",
  quantity_unsellable: "0.000000",
  low_stock_threshold: null,
  availability_state: "AVAILABLE" as const,
  product_version: 1,
  presentation_version: 1,
  media_id: null,
};

describe("CatalogPanel edit surface", () => {
  it("selects a catalog product and sends update without typing UUIDs", async () => {
    cannedByMethod.set("catalog.item.list", {
      status: "SUCCEEDED",
      result_code: "FOUND",
      result: { outcome: "FOUND", items: [ITEM], has_more: false },
    });
    cannedByMethod.set("catalog.product.update", {
      status: "SUCCEEDED",
      result_code: "UPDATED",
      result: {
        outcome: "UPDATED",
        product_id: ITEM.product_id,
        version: 2,
        presentation_version: 2,
        current_version: null,
      },
    });

    render(
      <CatalogPanel
        permissions={new Set([
          CanonicalPermission.CATALOG_PRODUCT_UPDATE,
          CanonicalPermission.CATALOG_PRODUCT_READ,
        ])}
      />,
    );

    fireEvent.change(screen.getByTestId("edit-product-search-input"), {
      target: { value: "Arroz" },
    });
    fireEvent.click(screen.getByTestId("edit-product-search-button"));
    await waitFor(() => {
      expect(screen.getByTestId(`edit-select-${ITEM.presentation_id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`edit-select-${ITEM.presentation_id}`));
    await waitFor(() => {
      expect(screen.getByTestId("edit-product-selected")).toBeTruthy();
    });
    expect(screen.queryByTestId("edit-product-id-input")).toBeNull();
    expect(screen.getByTestId("edit-product-name-input")).toHaveProperty("value", "Arroz");

    fireEvent.change(screen.getByTestId("edit-product-name-input"), {
      target: { value: "Arroz premium" },
    });
    fireEvent.click(screen.getByTestId("update-product-button"));
    await waitFor(() => {
      expect(screen.getByTestId("update-product-outcome").textContent).toContain("UPDATED");
    });
    const envelope = calls.get("catalog.product.update")?.[0] as Record<string, unknown>;
    const payload = envelope["payload"] as Record<string, unknown>;
    expect(payload["product_id"]).toBe(ITEM.product_id);
    expect(payload["expected_version"]).toBe(1);
    expect(payload["name"]).toBe("Arroz premium");
  });

  it("offers reload when update hits VERSION_CONFLICT", async () => {
    cannedByMethod.set("catalog.item.list", {
      status: "SUCCEEDED",
      result_code: "FOUND",
      result: { outcome: "FOUND", items: [ITEM], has_more: false },
    });
    cannedByMethod.set("catalog.product.update", {
      status: "REJECTED",
      result_code: "VERSION_CONFLICT",
      result: {
        outcome: "VERSION_CONFLICT",
        product_id: null,
        version: null,
        presentation_version: null,
        current_version: 4,
      },
    });

    render(
      <CatalogPanel
        permissions={new Set([CanonicalPermission.CATALOG_PRODUCT_UPDATE])}
      />,
    );
    fireEvent.change(screen.getByTestId("edit-product-search-input"), {
      target: { value: "Arroz" },
    });
    fireEvent.click(screen.getByTestId("edit-product-search-button"));
    await waitFor(() => screen.getByTestId(`edit-select-${ITEM.presentation_id}`));
    fireEvent.click(screen.getByTestId(`edit-select-${ITEM.presentation_id}`));
    fireEvent.click(screen.getByTestId("update-product-button"));
    await waitFor(() => {
      expect(screen.getByTestId("edit-version-conflict")).toBeTruthy();
    });
    expect(screen.getByTestId("edit-reload-button")).toBeTruthy();
  });

  it("hides edit controls without UPDATE/PRICE/MEDIA permissions", () => {
    render(<CatalogPanel permissions={new Set([CanonicalPermission.CATALOG_PRODUCT_READ])} />);
    expect(screen.queryByTestId("catalog-edit-section")).toBeNull();
  });
});

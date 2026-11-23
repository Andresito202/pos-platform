// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CanonicalPermission } from "@pos-platform/contracts";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { CatalogPanel } from "../../renderer/src/components/CatalogPanel.js";

const calls = new Map<string, unknown[]>();

function install(canned: unknown): void {
  const service: Record<string, (payload: unknown) => Promise<unknown>> = {};
  for (const method of RENDERER_API_METHODS) {
    service[method] = (payload: unknown) => {
      const seen = calls.get(method) ?? [];
      seen.push(payload);
      calls.set(method, seen);
      return Promise.resolve(canned);
    };
  }
  Object.defineProperty(window, "posService", { value: service, writable: true, configurable: true });
}

beforeEach(() => { calls.clear(); });

describe("CatalogPanel edit surface", () => {
  it("sends catalog.product.update when the administrator has UPDATE", async () => {
    install({
      status: "SUCCEEDED",
      result_code: "UPDATED",
      result: {
        outcome: "UPDATED",
        product_id: "11111111-1111-4111-8111-111111111111",
        version: 2,
        presentation_version: null,
        current_version: null,
      },
    });
    render(
      <CatalogPanel
        permissions={new Set([CanonicalPermission.CATALOG_PRODUCT_UPDATE])}
      />,
    );
    fireEvent.change(screen.getByTestId("edit-product-id-input"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.change(screen.getByTestId("edit-expected-version-input"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByTestId("edit-product-name-input"), {
      target: { value: "Nombre nuevo" },
    });
    fireEvent.click(screen.getByTestId("update-product-button"));
    await waitFor(() => {
      expect(screen.getByTestId("update-product-outcome").textContent).toContain("UPDATED");
    });
    expect(calls.get("catalog.product.update")?.length).toBe(1);
  });

  it("hides edit controls without UPDATE/PRICE/MEDIA permissions", () => {
    install({ status: "SUCCEEDED", result_code: "OK", result: null });
    render(<CatalogPanel permissions={new Set([CanonicalPermission.CATALOG_PRODUCT_READ])} />);
    expect(screen.queryByTestId("catalog-edit-section")).toBeNull();
  });
});

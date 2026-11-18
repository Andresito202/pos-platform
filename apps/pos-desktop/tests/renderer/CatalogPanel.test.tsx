// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LicenseSectorEntitlement, CanonicalPermission, CatalogFoodPolicyUpsertRequestSchema } from "@pos-platform/contracts";
import { CatalogPanel } from "../../renderer/src/components/CatalogPanel.js";

beforeEach(() => {
  Object.defineProperty(window, "posService", {
    value: {
      "catalog.product.register": vi.fn(),
      "catalog.food_policy.upsert": vi.fn().mockResolvedValue({ status: "SUCCEEDED", result_code: "SAVED", result: { outcome: "SAVED", version: 1 } }),
    },
    writable: true,
    configurable: true,
  });
});

describe("CatalogPanel sector surfaces", () => {
  it("envía la política por IPC y muestra la respuesta real del contrato", async () => {
    render(<CatalogPanel permissions={new Set([CanonicalPermission.CATALOG_PRODUCT_REGISTER])} entitlements={new Set([LicenseSectorEntitlement.SALSAMENTARIA])} />);
    const productId = "11111111-1111-4111-8111-111111111111";
    fireEvent.change(screen.getByTestId("food-policy-product-id"), { target: { value: productId } });
    fireEvent.click(screen.getByTestId("upsert-food-policy-button"));
    await waitFor(() => expect(screen.getByTestId("food-policy-outcome").textContent).toContain("SAVED v1"));
    const send = vi.mocked(window.posService["catalog.food_policy.upsert"]);
    const envelope = CatalogFoodPolicyUpsertRequestSchema.parse(send.mock.calls[0]?.[0]);
    expect(envelope.payload).toMatchObject({ product_id: productId, conservation_code: "CHILLED", requires_lot_tracking: true, requires_expiry: true });
    expect(envelope.tenant_id).toBeUndefined();
  });

  it("oculta la edición aunque haya licencia si el operador no tiene permiso", () => {
    render(<CatalogPanel permissions={new Set([CanonicalPermission.CATALOG_PRODUCT_READ])} entitlements={new Set([LicenseSectorEntitlement.SALSAMENTARIA])} />);
    expect(screen.queryByTestId("upsert-food-policy-button")).toBeNull();
    expect(window.posService["catalog.food_policy.upsert"]).not.toHaveBeenCalled();
  });

  it("shows Política alimentaria when SECTOR_SALSAMENTARIA is entitled", () => {
    render(
      <CatalogPanel
        permissions={new Set(["CATALOG_PRODUCT_REGISTER"])}
        entitlements={new Set([LicenseSectorEntitlement.SALSAMENTARIA])}
      />,
    );
    expect(screen.getByRole("heading", { name: /^Política alimentaria$/ })).toBeTruthy();
  });

  it("hides Política alimentaria without the Salsamentaria entitlement", () => {
    render(
      <CatalogPanel
        permissions={new Set(["CATALOG_PRODUCT_REGISTER"])}
        entitlements={new Set([LicenseSectorEntitlement.FARMACIA])}
      />,
    );
    expect(screen.queryByRole("heading", { name: /^Política alimentaria$/ })).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LicenseSectorEntitlement } from "@pos-platform/contracts";
import { CatalogPanel } from "../../renderer/src/components/CatalogPanel.js";

beforeEach(() => {
  Object.defineProperty(window, "posService", {
    value: {
      "catalog.product.register": vi.fn(),
      "catalog.food_policy.upsert": vi.fn(),
    },
    writable: true,
    configurable: true,
  });
});

describe("CatalogPanel sector surfaces", () => {
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

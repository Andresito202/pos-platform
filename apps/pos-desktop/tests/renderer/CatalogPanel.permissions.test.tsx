// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CatalogPanel } from "../../renderer/src/components/CatalogPanel.js";

vi.mock("../../renderer/src/hooks/useCatalogAdmin.js", () => ({
  useCatalogAdmin: () => ({
    busy: false,
    items: [],
    hasMore: false,
    product: null,
    outcome: null,
    error: null,
    listItems: vi.fn(),
    registerProduct: vi.fn(),
  }),
}));

afterEach(() => cleanup());

describe("CatalogPanel UI permissions", () => {
  it("does not show CSV import actions to a catalog reader", () => {
    render(<CatalogPanel permissions={new Set(["CATALOG_PRODUCT_READ"])} />);
    expect(screen.getByTestId("catalog-list-button")).toBeTruthy();
    expect(screen.queryByText("Importar catálogo CSV")).toBeNull();
    expect(screen.queryByLabelText("Archivo de catálogo CSV")).toBeNull();
    expect((screen.getByTestId("register-product-button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows existing CSV import controls to a catalog registrar without requiring read permission", () => {
    render(<CatalogPanel permissions={new Set(["CATALOG_PRODUCT_REGISTER"])} />);
    expect(screen.getByText("Importar catálogo CSV")).toBeTruthy();
    expect((screen.getByLabelText("Archivo de catálogo CSV") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByTestId("catalog-list-button") as HTMLButtonElement).disabled).toBe(true);
  });
});

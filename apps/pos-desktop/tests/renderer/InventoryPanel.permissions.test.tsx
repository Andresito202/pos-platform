// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { InventoryPanel } from "../../renderer/src/components/InventoryPanel.js";

vi.mock("../../renderer/src/hooks/useInventoryAdmin.js", () => ({
  useInventoryAdmin: () => ({
    busy: false,
    movement: null,
    stock: null,
    error: null,
    receive: vi.fn(),
    adjust: vi.fn(),
    getStock: vi.fn(),
  }),
}));

afterEach(() => cleanup());

describe("InventoryPanel effective-grant surfaces", () => {
  it("shows only stock query for a read-only session", () => {
    render(<InventoryPanel permissions={new Set(["INVENTORY_STOCK_READ"])} />);
    expect(screen.getByTestId("get-stock-button")).toBeTruthy();
    expect(screen.queryByTestId("receive-stock-button")).toBeNull();
    expect(screen.queryByTestId("adjust-stock-button")).toBeNull();
  });

  it("shows only receiving for a receive-only session", () => {
    render(<InventoryPanel permissions={new Set(["INVENTORY_STOCK_RECEIVE"])} />);
    expect(screen.getByTestId("receive-stock-button")).toBeTruthy();
    expect(screen.queryByTestId("get-stock-button")).toBeNull();
    expect(screen.queryByTestId("adjust-stock-button")).toBeNull();
  });

  it("shows only adjustment for an adjust-only session", () => {
    render(<InventoryPanel permissions={new Set(["INVENTORY_STOCK_ADJUST"])} />);
    expect(screen.getByTestId("adjust-stock-button")).toBeTruthy();
    expect(screen.queryByTestId("receive-stock-button")).toBeNull();
    expect(screen.queryByTestId("get-stock-button")).toBeNull();
  });

  it("does not expose any stock operation without a grant", () => {
    render(<InventoryPanel permissions={new Set()} />);
    expect(screen.queryByTestId("receive-stock-button")).toBeNull();
    expect(screen.queryByTestId("adjust-stock-button")).toBeNull();
    expect(screen.queryByTestId("get-stock-button")).toBeNull();
  });
});

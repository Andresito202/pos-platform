// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CustomerPanel } from "../../renderer/src/components/CustomerPanel.js";
import { HardwarePanel } from "../../renderer/src/components/HardwarePanel.js";

vi.mock("../../renderer/src/hooks/useCustomerDirectory.js", () => ({
  useCustomerDirectory: () => ({
    busy: false,
    registered: null,
    found: null,
    marketing: null,
    error: null,
    register: vi.fn(),
    find: vi.fn(),
    get: vi.fn(),
    getMarketing: vi.fn(),
    subscribeMarketing: vi.fn(),
    unsubscribeMarketing: vi.fn(),
  }),
}));

afterEach(() => cleanup());

describe("customer capability boundaries in the renderer", () => {
  it("permits customer lookup but hides registration and consent controls from read-only sessions", () => {
    render(<CustomerPanel permissions={new Set(["CUSTOMERS_CUSTOMER_READ"])} />);
    expect(screen.getByTestId("find-customer-button")).toBeTruthy();
    expect(screen.getByTestId("get-customer-button")).toBeTruthy();
    expect(screen.getByTestId("customer-identification-input")).toBeTruthy();
    expect(screen.queryByTestId("register-customer-button")).toBeNull();
    expect(screen.queryByTestId("customer-marketing-opt-in")).toBeNull();
    expect(screen.queryByTestId("customer-tribute-input")).toBeNull();
  });

  it("permits registration without exposing customer lookup controls", () => {
    render(<CustomerPanel permissions={new Set(["CUSTOMERS_CUSTOMER_REGISTER"])} />);
    expect(screen.getByTestId("register-customer-button")).toBeTruthy();
    expect(screen.getByTestId("customer-marketing-opt-in")).toBeTruthy();
    expect(screen.queryByTestId("find-customer-button")).toBeNull();
    expect(screen.queryByTestId("get-customer-button")).toBeNull();
  });
});

describe("hardware capability boundaries in the renderer", () => {
  it("allows diagnosis while hiding association, printing and drawer operations for read-only users", () => {
    render(<HardwarePanel permissions={new Set(["HARDWARE_READ"])} />);
    expect(screen.getByRole("button", { name: "Detectar y diagnosticar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Guardar asociación" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Encolar impresión de prueba" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Encolar apertura autorizada" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ejecutar trabajo pendiente" })).toBeNull();
  });

  it("shows only existing association controls for an authorized configurator", () => {
    render(<HardwarePanel permissions={new Set(["HARDWARE_READ", "HARDWARE_CONFIGURE"])} />);
    expect(screen.getByRole("button", { name: "Guardar asociación" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Encolar impresión de prueba" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Encolar apertura autorizada" })).toBeNull();
  });

  it("keeps drawer and print grants separate", () => {
    render(<HardwarePanel permissions={new Set(["HARDWARE_READ", "HARDWARE_PRINT"])} />);
    expect(screen.getByRole("button", { name: "Encolar impresión de prueba" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Encolar apertura autorizada" })).toBeNull();
    cleanup();
    render(<HardwarePanel permissions={new Set(["HARDWARE_READ", "HARDWARE_DRAWER_OPEN"])} />);
    expect(screen.getByRole("button", { name: "Encolar apertura autorizada" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Encolar impresión de prueba" })).toBeNull();
  });
});

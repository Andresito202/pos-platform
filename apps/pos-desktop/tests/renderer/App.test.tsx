// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../../renderer/src/App.js";

function makeService() {
  return {
    "runtime.status.get": vi.fn().mockReturnValue(new Promise<never>(() => undefined)),
    "authorization.capabilities.get": vi.fn().mockResolvedValue({
      status: "SUCCEEDED",
      result_code: "AVAILABLE",
      result: { outcome: "AVAILABLE", permissions: [] },
    }),
    "operation.result.get": vi.fn(),
    "operation.confirm": vi.fn(),
  };
}

beforeEach(() => {
  Object.defineProperty(window, "posService", {
    value: makeService(),
    writable: true,
    configurable: true,
  });
});

describe("App", () => {
  it("renders the POS Local heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /POS Local/i })).toBeTruthy();
  });

  it("renders the status panel in loading state initially", () => {
    render(<App />);
    expect(screen.getByTestId("status-loading")).toBeTruthy();
  });

  it("renders the operation panel", async () => {
    render(<App />);
    expect(screen.getByTestId("operation-panel")).toBeTruthy();
  });

  it("renders the operation id input", () => {
    render(<App />);
    expect(screen.getByTestId("operation-id-input")).toBeTruthy();
  });

  it("renders get-result and confirm buttons", () => {
    render(<App />);
    expect(screen.getByTestId("get-result-button")).toBeTruthy();
    expect(screen.getByTestId("confirm-button")).toBeTruthy();
  });
});

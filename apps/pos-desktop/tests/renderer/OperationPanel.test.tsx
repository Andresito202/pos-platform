// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OperationPanel } from "../../renderer/src/components/OperationPanel.js";

beforeEach(() => {
  Object.defineProperty(window, "posService", {
    value: {
      "runtime.status.get": vi.fn(),
      "operation.result.get": vi.fn().mockResolvedValue({ status: "SUCCEEDED" }),
      "operation.confirm": vi.fn().mockResolvedValue({ status: "SUCCEEDED", result_code: "CONFIRMED" }),
    },
    writable: true,
    configurable: true,
  });
});

describe("OperationPanel", () => {
  it("disables both buttons when operation id is empty", () => {
    render(<OperationPanel />);
    expect((screen.getByTestId("get-result-button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("confirm-button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables both buttons after typing an operation id", () => {
    render(<OperationPanel />);
    fireEvent.change(screen.getByTestId("operation-id-input"), {
      target: { value: "op-123" },
    });
    expect((screen.getByTestId("get-result-button") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("confirm-button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls operation.result.get with the entered id and shows result", async () => {
    (window.posService["operation.result.get"] as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ status: "SUCCEEDED", result: { value: 42 } });
    render(<OperationPanel />);
    fireEvent.change(screen.getByTestId("operation-id-input"), {
      target: { value: "op-456" },
    });
    fireEvent.click(screen.getByTestId("get-result-button"));
    await waitFor(() => {
      expect(screen.getByTestId("operation-result")).toBeTruthy();
    });
    expect(window.posService["operation.result.get"]).toHaveBeenCalledWith({ operation_id: "op-456" });
  });

  it("calls operation.confirm with the entered id and shows result", async () => {
    (window.posService["operation.confirm"] as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ status: "SUCCEEDED", result_code: "CONFIRMED" });
    render(<OperationPanel />);
    fireEvent.change(screen.getByTestId("operation-id-input"), {
      target: { value: "op-789" },
    });
    fireEvent.click(screen.getByTestId("confirm-button"));
    await waitFor(() => {
      expect(screen.getByTestId("operation-result")).toBeTruthy();
    });
    expect(window.posService["operation.confirm"]).toHaveBeenCalledWith({ operation_id: "op-789" });
  });

  it("shows error message when operation.result.get fails", async () => {
    (window.posService["operation.result.get"] as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error("operación no encontrada"));
    render(<OperationPanel />);
    fireEvent.change(screen.getByTestId("operation-id-input"), {
      target: { value: "op-999" },
    });
    fireEvent.click(screen.getByTestId("get-result-button"));
    await waitFor(() => {
      expect(screen.getByTestId("operation-error")).toBeTruthy();
    });
    expect(screen.getByTestId("operation-error").textContent).toContain("operación no encontrada");
  });

  it("shows error message when operation.confirm fails", async () => {
    (window.posService["operation.confirm"] as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error("operación ya confirmada"));
    render(<OperationPanel />);
    fireEvent.change(screen.getByTestId("operation-id-input"), {
      target: { value: "op-001" },
    });
    fireEvent.click(screen.getByTestId("confirm-button"));
    await waitFor(() => {
      expect(screen.getByTestId("operation-error")).toBeTruthy();
    });
    expect(screen.getByTestId("operation-error").textContent).toContain("operación ya confirmada");
  });

  it("does not call service when operation id is whitespace only", () => {
    render(<OperationPanel />);
    fireEvent.change(screen.getByTestId("operation-id-input"), {
      target: { value: "   " },
    });
    expect((screen.getByTestId("get-result-button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("confirm-button") as HTMLButtonElement).disabled).toBe(true);
  });
});

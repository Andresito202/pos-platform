// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OperationConfirmRequestSchema, OperationResultRequestSchema } from "@pos-platform/contracts";
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

function fillContext(): void {
  fireEvent.change(screen.getByTestId("idempotency-key-input"), { target: { value: "diagnostic-test-key" } });
  fireEvent.change(screen.getByTestId("operation-type-input"), { target: { value: "DIAGNOSTIC" } });
}

describe("OperationPanel", () => {
  it("disables both buttons when operation id is empty", () => {
    render(<OperationPanel />);
    fillContext();
    expect((screen.getByTestId("get-result-button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("confirm-button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables both buttons after typing an operation id", () => {
    render(<OperationPanel />);
    fillContext();
    fireEvent.change(screen.getByTestId("operation-id-input"), {
      target: { value: "00000000-0000-4000-8000-000000000123" },
    });
    expect((screen.getByTestId("get-result-button") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("confirm-button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls operation.result.get with the entered id and shows result", async () => {
    (window.posService["operation.result.get"] as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ status: "SUCCEEDED", result: { value: 42 } });
    render(<OperationPanel />);
    fillContext();
    fireEvent.change(screen.getByTestId("operation-id-input"), {
      target: { value: "00000000-0000-4000-8000-000000000456" },
    });
    fireEvent.click(screen.getByTestId("get-result-button"));
    await waitFor(() => {
      expect(screen.getByTestId("operation-result")).toBeTruthy();
    });
    const request = vi.mocked(window.posService["operation.result.get"]).mock.calls[0]?.[0];
    expect(OperationResultRequestSchema.safeParse(request).success).toBe(true);
    expect(request).toMatchObject({ payload: { operation_id: "00000000-0000-4000-8000-000000000456", idempotency_key: "diagnostic-test-key" } });
  });

  it("calls operation.confirm with the entered id and shows result", async () => {
    (window.posService["operation.confirm"] as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ status: "SUCCEEDED", result_code: "CONFIRMED" });
    render(<OperationPanel />);
    fillContext();
    fireEvent.change(screen.getByTestId("operation-id-input"), {
      target: { value: "00000000-0000-4000-8000-000000000789" },
    });
    fireEvent.click(screen.getByTestId("confirm-button"));
    await waitFor(() => {
      expect(screen.getByTestId("operation-result")).toBeTruthy();
    });
    const request = vi.mocked(window.posService["operation.confirm"]).mock.calls[0]?.[0];
    expect(OperationConfirmRequestSchema.safeParse(request).success).toBe(true);
    expect(request).toMatchObject({ operation_id: "00000000-0000-4000-8000-000000000789", idempotency_key: "diagnostic-test-key", payload: { operation_type: "DIAGNOSTIC", payload: {} } });
  });

  it("shows error message when operation.result.get fails", async () => {
    (window.posService["operation.result.get"] as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error("operación no encontrada"));
    render(<OperationPanel />);
    fillContext();
    fireEvent.change(screen.getByTestId("operation-id-input"), {
      target: { value: "00000000-0000-4000-8000-000000000999" },
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
    fillContext();
    fireEvent.change(screen.getByTestId("operation-id-input"), {
      target: { value: "00000000-0000-4000-8000-000000000001" },
    });
    fireEvent.click(screen.getByTestId("confirm-button"));
    await waitFor(() => {
      expect(screen.getByTestId("operation-error")).toBeTruthy();
    });
    expect(screen.getByTestId("operation-error").textContent).toContain("operación ya confirmada");
  });

  it("does not call service when operation id is whitespace only", () => {
    render(<OperationPanel />);
    fillContext();
    fireEvent.change(screen.getByTestId("operation-id-input"), {
      target: { value: "   " },
    });
    expect((screen.getByTestId("get-result-button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("confirm-button") as HTMLButtonElement).disabled).toBe(true);
  });
  it("does not send malformed JSON to the service", async () => {
    render(<OperationPanel />); fillContext();
    fireEvent.change(screen.getByTestId("operation-id-input"), { target: { value: "00000000-0000-4000-8000-000000000789" } });
    fireEvent.change(screen.getByTestId("operation-payload-input"), { target: { value: "{" } });
    fireEvent.click(screen.getByTestId("confirm-button"));
    await screen.findByTestId("operation-error");
    expect(window.posService["operation.confirm"]).not.toHaveBeenCalled();
  });

});

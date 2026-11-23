// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StatusPanel } from "../../renderer/src/components/StatusPanel.js";

function runtimeResponse(serviceState: string) {
  return {
    protocol_version: "1.0.0",
    request_id: "11111111-1111-4111-8111-111111111111",
    correlation_id: "11111111-1111-4111-8111-111111111112",
    operation_id: null,
    status: "SUCCEEDED",
    result_code: "OK",
    result_schema_version: "1.0.0",
    error: null,
    server_time: "2026-11-23T00:00:00.000Z",
    result: {
      service_version: "1.0.0",
      protocol_version: "1.0.0",
      service_state: serviceState,
      schema_version: "5",
    },
  };
}

beforeEach(() => {
  Object.defineProperty(window, "posService", {
    value: {
      "runtime.status.get": vi.fn(),
      "operation.result.get": vi.fn(),
      "operation.confirm": vi.fn(),
    },
    writable: true,
    configurable: true,
  });
});

describe("StatusPanel", () => {
  it("stays silent while awaiting the first validated response", () => {
    (window.posService["runtime.status.get"] as ReturnType<typeof vi.fn>)
      .mockReturnValue(new Promise<never>(() => undefined));
    const { container } = render(<StatusPanel />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("status-loading")).toBeNull();
  });

  it("stays silent when the service reports READY", async () => {
    (window.posService["runtime.status.get"] as ReturnType<typeof vi.fn>)
      .mockResolvedValue(runtimeResponse("READY"));
    const { container } = render(<StatusPanel />);
    await waitFor(() => {
      expect(window.posService["runtime.status.get"]).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/Servicio local: conectado/i)).toBeNull();
    expect(screen.queryByTestId("status-connected")).toBeNull();
  });

  it("does not treat a bare transport success as operational readiness", async () => {
    (window.posService["runtime.status.get"] as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ status: "SUCCEEDED" });
    render(<StatusPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("status-unavailable")).toBeTruthy();
    });
    expect(screen.getByTestId("status-unavailable").textContent).toContain(
      "La respuesta del servicio local no es válida.",
    );
  });

  it("reports NOT_READY without exposing raw diagnostics", async () => {
    (window.posService["runtime.status.get"] as ReturnType<typeof vi.fn>)
      .mockResolvedValue(runtimeResponse("STARTING"));
    render(<StatusPanel onRetry={() => undefined} />);
    await waitFor(() => {
      expect(screen.getByTestId("status-unavailable")).toBeTruthy();
    });
    expect(screen.getByTestId("status-unavailable").textContent).toContain(
      "El servicio local aún no está listo para operar.",
    );
    expect(screen.getByTestId("status-unavailable").textContent).not.toMatch(/STARTING|stack|secret/i);
  });

  it("shows a safe unavailable message when the call fails", async () => {
    (window.posService["runtime.status.get"] as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error("connection refused ECONNREFUSED /var/secret.pipe"));
    render(<StatusPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("status-unavailable")).toBeTruthy();
    });
    const text = screen.getByTestId("status-unavailable").textContent ?? "";
    expect(text).toContain("No hay conexión operativa con el servicio local");
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("secret");
  });

  it("offers Reintentar conexión when onRetry is provided", async () => {
    const onRetry = vi.fn();
    (window.posService["runtime.status.get"] as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error("offline"));
    render(<StatusPanel onRetry={onRetry} />);
    await waitFor(() => expect(screen.getByTestId("status-retry")).toBeTruthy());
    fireEvent.click(screen.getByTestId("status-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("calls runtime.status.get on mount with the envelope contract", async () => {
    (window.posService["runtime.status.get"] as ReturnType<typeof vi.fn>)
      .mockResolvedValue(runtimeResponse("READY"));
    render(<StatusPanel />);
    await waitFor(() => {
      expect(window.posService["runtime.status.get"]).toHaveBeenCalledTimes(1);
    });
    expect(window.posService["runtime.status.get"]).toHaveBeenCalledWith(
      expect.objectContaining({
        message_type: "runtime.status.get",
        protocol_version: "1.0.0",
        payload: {},
      }),
    );
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RuntimeStatusRequestSchema } from "@pos-platform/contracts";
import { StatusPanel } from "../../renderer/src/components/StatusPanel.js";

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
  it("shows loading state while awaiting first response", () => {
    (window.posService["runtime.status.get"] as ReturnType<typeof vi.fn>)
      .mockReturnValue(new Promise<never>(() => undefined));
    render(<StatusPanel />);
    expect(screen.getByTestId("status-loading")).toBeTruthy();
  });

  it("shows connected state after successful response", async () => {
    (window.posService["runtime.status.get"] as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        status: "SUCCEEDED",
        result: {
          service_version: "1.0.0",
          protocol_version: "1.0.0",
          service_state: "READY",
          schema_version: "5",
          outbox_pending_count: 0,
          outbox_dead_letter_count: 0,
        },
      });
    render(<StatusPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("status-connected")).toBeTruthy();
      expect(screen.getByTestId("status-outbox-idle")).toBeTruthy();
    });
  });

  it("shows real pending outbox depth from runtime.status", async () => {
    (window.posService["runtime.status.get"] as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        status: "SUCCEEDED",
        result: {
          service_version: "1.0.0",
          protocol_version: "1.0.0",
          service_state: "READY",
          schema_version: "5",
          outbox_pending_count: 3,
          outbox_dead_letter_count: 1,
        },
      });
    render(<StatusPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("status-outbox-pending").textContent).toContain("3");
      expect(screen.getByTestId("status-outbox-dead-letter").textContent).toContain("1");
    });
    expect(screen.queryByTestId("status-outbox-idle")).toBeNull();
  });

  it("shows the sanitized error state when the service transport fails", async () => {
    (window.posService["runtime.status.get"] as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error("connection refused"));
    render(<StatusPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("status-error")).toBeTruthy();
    });
    expect(screen.getByTestId("status-error").textContent).toContain("LOCAL_SERVICE_UNAVAILABLE");
    expect(screen.getByTestId("status-error").textContent).not.toContain("connection refused");
  });

  it("calls runtime.status.get on mount", async () => {
    (window.posService["runtime.status.get"] as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        status: "SUCCEEDED",
        result: {
          service_version: "1.0.0",
          protocol_version: "1.0.0",
          service_state: "READY",
          schema_version: "5",
          outbox_pending_count: 0,
          outbox_dead_letter_count: 0,
        },
      });
    render(<StatusPanel />);
    await waitFor(() => {
      expect(window.posService["runtime.status.get"]).toHaveBeenCalledTimes(1);
    });
    expect(RuntimeStatusRequestSchema.safeParse(vi.mocked(window.posService["runtime.status.get"]).mock.calls[0]?.[0]).success).toBe(true);
  });
  it("does not report a rejected status as connected", async () => {
    vi.mocked(window.posService["runtime.status.get"]).mockResolvedValue({ status: "REJECTED", result_code: "SESSION_NOT_BOUND", result: null });
    render(<StatusPanel />);
    await waitFor(() => expect(screen.getByTestId("status-error").textContent).toContain("SESSION_NOT_BOUND"));
    expect(screen.queryByTestId("status-connected")).toBeNull();
  });

});

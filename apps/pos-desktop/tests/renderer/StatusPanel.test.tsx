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
      .mockResolvedValue({ status: "SUCCEEDED" });
    render(<StatusPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("status-connected")).toBeTruthy();
    });
  });

  it("shows error state when service call fails", async () => {
    (window.posService["runtime.status.get"] as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error("connection refused"));
    render(<StatusPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("status-error")).toBeTruthy();
    });
    expect(screen.getByTestId("status-error").textContent).toContain("connection refused");
  });

  it("calls runtime.status.get on mount", async () => {
    (window.posService["runtime.status.get"] as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ status: "SUCCEEDED" });
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

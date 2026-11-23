// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AdministrativeControlPanel } from "../../renderer/src/components/AdministrativeControlPanel.js";

const metrics = {
  outcome: "AVAILABLE" as const,
  sales_completed_count: 4,
  sales_completed_amount: "12000.000000",
  sales_completed_today_count: 1,
  sales_completed_today_amount: "3500.000000",
  inventory_tracked_count: 9,
  cash_open_shift_count: 2,
  payments_confirmed_count: 3,
  payments_confirmed_amount: "10000.000000",
  payments_confirmed_cash_amount: "6000.000000",
  payments_confirmed_transfer_amount: "3000.000000",
  payments_confirmed_qr_amount: "1000.000000",
  payments_pending_transfer_count: 1,
  metrics_scope: "INSTALLATION_BRANCH" as const,
  metrics_period_timezone: "America/Bogota" as const,
  metrics_business_date: "2026-09-07",
};

beforeEach(() => {
  Object.defineProperty(window, "posService", {
    configurable: true,
    value: {
      "admin.metrics.get": vi.fn().mockResolvedValue({
        status: "SUCCEEDED",
        result_code: "AVAILABLE",
        result: metrics,
      }),
    },
  });
});

describe("AdministrativeControlPanel dashboard metrics", () => {
  it("shows cumulative, today, and confirmed payment cards without inventing values", async () => {
    render(<AdministrativeControlPanel />);
    await waitFor(() => expect(screen.getByText("4")).toBeTruthy());
    expect(screen.getByText("Ventas completadas")).toBeTruthy();
    expect(screen.getByText("Ventas de hoy")).toBeTruthy();
    expect(screen.getByText("Pagos confirmados")).toBeTruthy();
    expect(screen.getByText("Recaudo en efectivo")).toBeTruthy();
    expect(screen.getByText("Recaudo por transferencia")).toBeTruthy();
    expect(screen.getByText("Recaudo por QR")).toBeTruthy();
    expect(screen.getByText("Transferencias pendientes")).toBeTruthy();
    expect(screen.getAllByText(/Acumulado histórico/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fecha comercial 2026-09-07/).length).toBeGreaterThan(0);
    expect(screen.getByText(/No es dinero recibido/)).toBeTruthy();
    expect(screen.queryByText("null")).toBeNull();
  });
});

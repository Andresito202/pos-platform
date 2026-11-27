// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportExportPanel } from "../../renderer/src/components/ReportExportPanel.js";
import { downloadBytes, downloadText } from "../../renderer/src/sheet-workbook.js";

vi.mock("../../renderer/src/sheet-workbook.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../renderer/src/sheet-workbook.js")>(),
  downloadText: vi.fn(),
  downloadBytes: vi.fn(),
}));

const authorized = {
  status: "SUCCEEDED",
  result: {
    outcome: "AVAILABLE",
    sales_completed_count: 0,
    sales_completed_amount: "0.000000",
    sales_completed_today_count: 0,
    sales_completed_today_amount: "0.000000",
    inventory_tracked_count: 7,
    cash_open_shift_count: null,
    payments_confirmed_count: null,
    payments_confirmed_amount: null,
    payments_confirmed_cash_amount: null,
    payments_confirmed_transfer_amount: null,
    payments_confirmed_qr_amount: null,
    payments_pending_transfer_count: null,
    metrics_scope: "INSTALLATION_BRANCH",
    metrics_period_timezone: "America/Bogota",
    metrics_business_date: "2026-11-27",
  },
};

function installIpc() {
  const read = vi.fn().mockResolvedValue(authorized);
  Object.defineProperty(window, "posService", { configurable: true, value: { "admin.metrics.get": read } });
  return read;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportExportPanel", () => {
  it("exports authorized aggregates from the real format writers, preserving zero and scope", async () => {
    const read = installIpc();
    render(<ReportExportPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Descargar CSV" }));
    expect(screen.getAllByText("$0")).toHaveLength(2);
    await waitFor(() => expect(downloadText).toHaveBeenCalledOnce());
    const [name, csv] = vi.mocked(downloadText).mock.calls[0]!;
    expect(name).toBe("camacho-resumen-local-2026-11-27.csv");
    expect(csv).toContain("Alcance;Instalación y sucursal local");
    expect(csv).toContain("Importe vendido;2026-11-27;COP;0.000000");
    expect(csv).not.toContain("Recaudo confirmado");
    fireEvent.click(await screen.findByRole("button", { name: "Descargar Excel" }));
    await waitFor(() => expect(downloadBytes).toHaveBeenCalledOnce());
    const [xlsxName, xlsx] = vi.mocked(downloadBytes).mock.calls[0]!;
    expect(xlsxName).toBe("camacho-resumen-local-2026-11-27.xlsx");
    expect(Array.from(xlsx.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("blocks export from a stale preview when reporting permission is revoked", async () => {
    const read = installIpc();
    render(<ReportExportPanel />);
    const button = await screen.findByRole("button", { name: "Descargar CSV" });
    read.mockResolvedValueOnce({
      ...authorized,
      result: {
        ...authorized.result, sales_completed_count: null, sales_completed_amount: null,
        sales_completed_today_count: null, sales_completed_today_amount: null,
      },
    });
    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toContain("No se pudo exportar");
    expect(downloadText).not.toHaveBeenCalled();
  });
});

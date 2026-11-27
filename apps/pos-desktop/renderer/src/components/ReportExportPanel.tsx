import { useRef, useState } from "react";
import { AdminMetricsGetResultSchema, type AdminMetricsGetResult } from "@pos-platform/contracts";
import { useAdminMetrics } from "../hooks/useAdminMetrics.js";
import { formatScale6Display } from "../money-display.js";
import { callCommercial } from "../pos-service.js";
import { downloadBytes, downloadText, sheetRowsToCsv, writeSheetMatrixToXlsx } from "../sheet-workbook.js";

type Format = "csv" | "xlsx";

function reportRows(metrics: AdminMetricsGetResult) {
  return ([
    ["Ventas completadas", "Acumulado", "Cantidad", metrics.sales_completed_count],
    ["Importe vendido", "Acumulado", "COP", metrics.sales_completed_amount],
    ["Ventas completadas", metrics.metrics_business_date, "Cantidad", metrics.sales_completed_today_count],
    ["Importe vendido", metrics.metrics_business_date, "COP", metrics.sales_completed_today_amount],
    ["Turnos abiertos", "Al consultar", "Cantidad", metrics.cash_open_shift_count],
    ["Pagos confirmados", "Acumulado", "Cantidad", metrics.payments_confirmed_count],
    ["Recaudo confirmado", "Acumulado", "COP", metrics.payments_confirmed_amount],
    ["Recaudo en efectivo", "Acumulado", "COP", metrics.payments_confirmed_cash_amount],
    ["Recaudo por transferencia", "Acumulado", "COP", metrics.payments_confirmed_transfer_amount],
    ["Recaudo por QR", "Acumulado", "COP", metrics.payments_confirmed_qr_amount],
    ["Transferencias pendientes", "Al consultar", "Cantidad", metrics.payments_pending_transfer_count],
  ] as const).filter((row): row is typeof row & { readonly 3: number | string } => row[3] !== null);
}

export function ReportExportPanel(): React.JSX.Element {
  const { busy, error, metrics, refresh } = useAdminMetrics(true);
  const [format, setFormat] = useState<Format | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<{ error: boolean; text: string } | null>(null);
  const exporting = useRef(false);
  const rows = reportRows(metrics);

  async function exportReport(target: Format): Promise<void> {
    if (exporting.current) return;
    exporting.current = true;
    setFormat(target);
    setDownloadStatus(null);
    try {
      // The download uses a fresh authorized channel query, even if the preview
      // still shows data obtained before the user's permissions changed.
      const response = await callCommercial<AdminMetricsGetResult>("admin.metrics.get", {});
      const parsed = AdminMetricsGetResultSchema.safeParse(response.result);
      if (response.status !== "SUCCEEDED" || !parsed.success) throw Error("REPORT_UNAVAILABLE");
      const available = reportRows(parsed.data);
      if (available.length === 0) throw Error("REPORT_UNAVAILABLE");
      const table = [
        ["Alcance", "Instalación y sucursal local"],
        ["Zona horaria", parsed.data.metrics_period_timezone],
        ["Fecha comercial", parsed.data.metrics_business_date],
        ["Indicador", "Periodo", "Unidad", "Valor"],
        ...available.map(([indicator, period, unit, value]) => [indicator, period, unit, String(value)]),
      ];
      const filename = `camacho-resumen-local-${parsed.data.metrics_business_date}.${target}`;
      if (target === "csv") downloadText(filename, sheetRowsToCsv(table, ";"), "text/csv;charset=utf-8");
      else downloadBytes(filename, writeSheetMatrixToXlsx("Resumen local", table),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      setDownloadStatus({ error: false, text: "Descarga solicitada." });
    } catch {
      setDownloadStatus({ error: true, text: "No se pudo exportar. Actualiza el resumen y verifica tus permisos." });
    } finally {
      exporting.current = false;
      setFormat(null);
    }
  }

  return (
    <section className="pos-admin-panel" data-testid="report-export-panel">
      <header className="pos-admin-header">
        <div>
          <h2>Resumen y exportación</h2>
          <p>Indicadores agregados de esta instalación y sucursal. Los importes de ventas y recaudo se muestran por separado.</p>
        </div>
        <button type="button" onClick={() => { void refresh(); }} disabled={busy || format !== null}>Actualizar</button>
      </header>
      {busy && <p role="status">Consultando el resumen…</p>}
      {error && <p role="alert">No se pudo consultar el resumen.</p>}
      {!busy && !error && rows.length === 0 && <p role="status">No hay indicadores autorizados para consultar.</p>}
      {!error && rows.length > 0 && (
        <div className="pos-admin-surface">
          <p>Fecha comercial {metrics.metrics_business_date} · {metrics.metrics_period_timezone}</p>
          <div className="pos-admin-audit-table">
            <table>
              <caption>Indicadores disponibles</caption>
              <thead><tr><th scope="col">Indicador</th><th scope="col">Periodo</th><th scope="col">Valor</th></tr></thead>
              <tbody>{rows.map(([indicator, period, unit, value]) => (
                <tr key={`${indicator}-${period}`}><th scope="row">{indicator}</th><td>{period}</td>
                  <td>{unit === "COP" ? formatScale6Display(String(value)) : value}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <button type="button" onClick={() => { void exportReport("csv"); }} disabled={busy || format !== null}>Descargar CSV</button>
          <button type="button" onClick={() => { void exportReport("xlsx"); }} disabled={busy || format !== null}>Descargar Excel</button>
        </div>
      )}
      {downloadStatus && <p role={downloadStatus.error ? "alert" : "status"}>{downloadStatus.text}</p>}
    </section>
  );
}

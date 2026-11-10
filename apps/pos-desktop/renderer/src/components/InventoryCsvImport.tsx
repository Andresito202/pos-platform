import { useRef, useState } from "react";
import { inventoryCsvTemplate, previewInventoryCsv, confirmInventoryCsv, type InventoryCsvPlan, type InventoryCsvOutcome } from "../inventory-csv.js";
import { formatQuantityDisplay } from "../money-display.js";

export function InventoryCsvImport({ enabled }: { enabled: boolean }): React.JSX.Element {
  const [delimiter, setDelimiter] = useState<"," | ";">(";");
  const [plan, setPlan] = useState<InventoryCsvPlan | null>(null);
  const [results, setResults] = useState<InventoryCsvOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [templateId, setTemplateId] = useState(() => crypto.randomUUID());
  async function load(file: File) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null); setPlan(null); setResults([]);
    try {
      if (!file.name.toLowerCase().endsWith(".csv") || file.size > 1_048_576) throw Error("Usa CSV UTF-8 de máximo 1 MiB; XLSX no está habilitado.");
      setPlan(previewInventoryCsv(await file.text(), delimiter));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo leer el archivo."); }
    finally { running.current = false; setBusy(false); }
  }
  async function confirm() {
    if (!enabled || !plan || running.current) return;
    running.current = true; setBusy(true); setError(null); setResults([]);
    try { await confirmInventoryCsv(plan, outcome => setResults(current => [...current, outcome])); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo completar la importación."); }
    finally { running.current = false; setBusy(false); }
  }
  return <details className="pos-import-panel"><summary>Cargar existencias desde plantilla</summary>
    <p>Abre la plantilla en Excel y guarda como CSV UTF-8. Registra entradas reales de productos ya existentes; no crea productos ni registra facturas de compra.</p>
    <p>Conserva import_id y row_id al corregir o reintentar el mismo lote. Cambiarlos representa otra entrada. La cantidad se suma al stock, no lo reemplaza.</p>
    <label>Separador de inventario<select aria-label="Separador de inventario" value={delimiter} disabled={busy}
      onChange={event => { setDelimiter(event.target.value as "," | ";"); setPlan(null); setResults([]); }}><option value=";">Punto y coma</option><option value=",">Coma</option></select></label>
    <a download="camacho-existencias.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(inventoryCsvTemplate(delimiter, templateId))}`}>Descargar plantilla de existencias</a>
    <button type="button" disabled={busy} onClick={() => { setTemplateId(crypto.randomUUID()); setPlan(null); setResults([]); setError(null); }}>Preparar plantilla para otro lote</button>
    <input type="file" aria-label="Archivo de existencias CSV" accept=".csv,text/csv" disabled={busy || !enabled}
      onChange={event => { const file = event.target.files?.[0]; if (file) void load(file); event.target.value = ""; }} />
    {plan && <><div className="pos-table-scroll"><table className="pos-data-table"><caption>Vista previa sin escrituras</caption>
      <thead><tr><th>Fila</th><th>Presentación</th><th>Cantidad</th><th>Validación</th></tr></thead><tbody>
      {plan.rows.map(row => <tr key={row.row}><td>{row.row}</td><td>{row.payload?.presentation_id ?? "—"}</td><td>{row.payload?.quantity ?? "—"}</td><td>{row.errors.join(", ") || "Lista para validar en el servicio"}</td></tr>)}
      </tbody></table></div>
      <button type="button" className="pos-form-primary" disabled={busy || !enabled || !plan.rows.length || plan.rows.some(row => row.errors.length > 0)} onClick={() => void confirm()}>
        {busy ? "Procesando entradas…" : "Confirmar o reanudar entradas"}</button></>}
    <ul>{results.map(result => <li key={result.row}>Fila {result.row}: {result.outcome}{result.quantityAfter !== null ? ` · existencia ${formatQuantityDisplay(result.quantityAfter, 6)}` : ""}</li>)}</ul>
    {error && <p role="alert">{error}. Las filas confirmadas permanecen. Reanuda con las mismas identidades para evitar duplicar entradas.</p>}
  </details>;
}

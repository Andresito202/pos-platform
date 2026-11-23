import { useRef, useState } from "react";
import {
  catalogImportCsvTemplate,
  catalogImportXlsxTemplate,
  confirmCatalogImport,
  previewCatalogFile,
  type CatalogImportOutcome,
  type CatalogImportPlan,
} from "../catalog-import.js";
import { downloadBytes, downloadText } from "../sheet-workbook.js";

export function CatalogImport({ enabled }: { enabled: boolean }): React.JSX.Element {
  const [delimiter, setDelimiter] = useState<"," | ";">(";");
  const [plan, setPlan] = useState<CatalogImportPlan | null>(null);
  const [results, setResults] = useState<CatalogImportOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [templateId, setTemplateId] = useState(() => crypto.randomUUID());

  async function load(file: File): Promise<void> {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setPlan(null);
    setResults([]);
    try {
      setPlan(await previewCatalogFile(file, delimiter));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No se pudo leer el archivo.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (!enabled || !plan || running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setResults([]);
    try {
      await confirmCatalogImport(plan, (outcome) => {
        setResults((current) => [...current, outcome]);
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No se pudo completar la importación.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <details className="pos-import-panel" data-testid="catalog-import-panel">
      <summary>Cargar productos desde planilla</summary>
      <p>
        Descarga la plantilla, complétala en Excel y selecciona el archivo CSV o XLSX.
        La vista previa no escribe nada. Al confirmar se registran o actualizan productos
        y precios; las existencias se cargan aparte en Inventario.
      </p>
      <p>
        Conserva import_id y row_id al corregir o reintentar. No incluyas rutas de fotos:
        la fotografía se gestiona producto a producto. La columna cantidad_por_presentacion
        es informativa en esta fase.
      </p>
      <label>
        Separador CSV
        <select
          aria-label="Separador de catálogo"
          value={delimiter}
          disabled={busy}
          onChange={(event) => {
            setDelimiter(event.target.value as "," | ";");
            setPlan(null);
            setResults([]);
          }}
        >
          <option value=";">Punto y coma</option>
          <option value=",">Coma</option>
        </select>
      </label>
      <button
        type="button"
        data-testid="catalog-template-csv-button"
        disabled={busy}
        onClick={() => {
          downloadText(
            "camacho-catalogo.csv",
            catalogImportCsvTemplate(delimiter, templateId),
            "text/csv;charset=utf-8",
          );
        }}
      >
        Descargar plantilla CSV
      </button>
      <button
        type="button"
        data-testid="catalog-template-xlsx-button"
        disabled={busy}
        onClick={() => {
          downloadBytes(
            "camacho-catalogo.xlsx",
            catalogImportXlsxTemplate(templateId),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          );
        }}
      >
        Descargar plantilla Excel
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setTemplateId(crypto.randomUUID());
          setPlan(null);
          setResults([]);
          setError(null);
        }}
      >
        Preparar plantilla para otro lote
      </button>
      <input
        type="file"
        data-testid="catalog-import-file-input"
        aria-label="Archivo de catálogo CSV o Excel"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={busy || !enabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void load(file);
          event.target.value = "";
        }}
      />
      {plan && (
        <>
          <div className="pos-table-scroll">
            <table className="pos-data-table">
              <caption>Vista previa sin escrituras</caption>
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Precio</th>
                  <th>Validación</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{row.draft?.code ?? "—"}</td>
                    <td>{row.draft?.name ?? "—"}</td>
                    <td>{row.draft?.priceAmount ?? "—"}</td>
                    <td>
                      {[...row.errors, ...row.notes].join(", ") || "Lista para validar en el servicio"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="pos-form-primary"
            data-testid="catalog-import-confirm-button"
            disabled={busy || !enabled || !plan.rows.length || plan.rows.some((row) => row.errors.length > 0)}
            onClick={() => { void confirm(); }}
          >
            {busy ? "Procesando productos…" : "Confirmar o reanudar importación"}
          </button>
        </>
      )}
      <ul data-testid="catalog-import-results">
        {results.map((result) => (
          <li key={result.row}>
            Fila {result.row}: {result.outcome}
            {result.productId !== null ? ` · producto ${result.productId}` : ""}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert">
          {error}. Las filas confirmadas permanecen. Reanuda con las mismas identidades
          para evitar duplicar altas.
        </p>
      )}
    </details>
  );
}

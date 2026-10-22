import { CanonicalPermission } from "@pos-platform/contracts";
import { useRef, useState } from "react";
import { useCatalogAdmin } from "../hooks/useCatalogAdmin.js";
import { catalogCsvTemplate, previewCatalogCsv, matchCatalogCsv, confirmCatalogCsv, type CatalogCsvPlan, type CatalogCsvOutcome } from "../catalog-csv.js";

/**
 * Alta de producto. Es la pantalla que faltaba para poder usar el POS el primer
 * día: sin ella el catálogo sólo se podía cargar desde una prueba.
 *
 * Muestra el `presentation_id` resultante porque es lo que la entrada de
 * existencia necesita a continuación. Esconderlo obligaría a buscarlo en la base
 * de datos, que es justo lo que una pantalla existe para evitar.
 */
export function CatalogPanel({ permissions, onReceiveStock }: {
  permissions: ReadonlySet<string>;
  onReceiveStock?: ((presentationId: string) => void) | undefined;
}): React.JSX.Element {
  const catalog = useCatalogAdmin();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [presentationName, setPresentationName] = useState("");
  const [unitCode, setUnitCode] = useState("UND");
  const [unitPrecision, setUnitPrecision] = useState("0");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("COP");
  const [stockControlled, setStockControlled] = useState(true);
  const [query, setQuery] = useState("");
  const [loadedQuery, setLoadedQuery] = useState("");
  const [includeFiscal, setIncludeFiscal] = useState(false);
  const [fiscal, setFiscal] = useState({ codeReference: "", unitMeasureCode: "", standardCode: "", taxCode: "", taxRate: "" });
  const [csv, setCsv] = useState<CatalogCsvPlan | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvMatched, setCsvMatched] = useState(false);
  const [csvResults, setCsvResults] = useState<readonly CatalogCsvOutcome[]>([]);
  const [delimiter, setDelimiter] = useState<"," | ";">(",");
  const csvRunning = useRef(false);

  async function loadCsv(file: File): Promise<void> {
    if (csvRunning.current) return;
    csvRunning.current = true; setCsvBusy(true); setCsv(null); setCsvMatched(false); setCsvError(null); setCsvResults([]);
    try {
      if (file.size > 1_048_576) throw new Error("CSV_SIZE_OR_CONTENT_REJECTED");
      const source = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const plan = await previewCatalogCsv(source, delimiter); setCsv(plan);
      if (!plan.rows.some((row) => row.errors.length)) { setCsvResults(await matchCatalogCsv(plan)); setCsvMatched(true); }
    } catch (error) { setCsvError(error instanceof Error ? error.message : String(error)); }
    finally { csvRunning.current = false; setCsvBusy(false); }
  }
  async function confirmCsv(): Promise<void> {
    if (csvRunning.current || !csv || !csvMatched) return;
    csvRunning.current = true; setCsvBusy(true); setCsvError(null); setCsvResults([]);
    try { await confirmCatalogCsv(csv, (outcome) => setCsvResults((current) => [...current, outcome])); }
    catch (error) { setCsvError(error instanceof Error ? error.message : String(error)); }
    finally { csvRunning.current = false; setCsvBusy(false); }
  }

  const incomplete = code.trim() === ""
    || name.trim() === ""
    || presentationName.trim() === ""
    || price.trim() === "";

  return (
    <section data-testid="catalog-panel">
      <h2>Catálogo</h2>
      <details><summary>Importar catálogo CSV</summary>
        <p>CSV UTF-8 exportado desde Excel u otra hoja. No carga stock, costos ni facturas. Cada fila se confirma por separado; reintentar el mismo archivo conserva sus claves.</p>
        <label>Separador<select aria-label="Separador CSV" value={delimiter} disabled={csvBusy} onChange={(event) => { setDelimiter(event.target.value as "," | ";"); setCsv(null); setCsvResults([]); }}>
          <option value=",">Coma</option><option value=";">Punto y coma</option>
        </select></label>
        <a download="camacho-catalogo.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(catalogCsvTemplate(delimiter))}`}>Descargar plantilla CSV</a>
        <input type="file" aria-label="Archivo de catálogo CSV" accept=".csv,text/csv" disabled={csvBusy || catalog.busy || !permissions.has(CanonicalPermission.CATALOG_PRODUCT_READ)}
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadCsv(file); event.target.value = ""; }} />
        {csv && <><p>{csv.rows.length} filas. Vista previa sin escrituras.</p>
          <table><thead><tr><th>Fila</th><th>Código</th><th>Producto</th><th>Precio</th><th>Validación</th></tr></thead>
            <tbody>{csv.rows.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.payload?.code}</td><td>{row.payload?.name}</td><td>{row.payload?.price_amount}</td><td>{row.errors.join(", ") || "Forma válida; el backend revalidará"}</td></tr>)}</tbody></table>
          <button disabled={csvBusy || catalog.busy || !csvMatched || csv.rows.length === 0 || csv.rows.some((row) => row.errors.length > 0) || !permissions.has(CanonicalPermission.CATALOG_PRODUCT_REGISTER)}
            onClick={() => { void confirmCsv(); }}>Confirmar o reanudar altas CSV</button></>}
        <ul>{csvResults.map((result) => <li key={result.row}>Fila {result.row}: {result.outcome}</li>)}</ul>
        {csvError && <p role="alert">{csvError}. Las filas ya confirmadas permanecen; reintente el mismo archivo para recuperar el resultado.</p>}
      </details>
      <div>
        <input aria-label="Buscar en catálogo" value={query} onChange={(event) => setQuery(event.target.value)} disabled={catalog.busy} />
        <button data-testid="catalog-list-button" disabled={catalog.busy || !permissions.has(CanonicalPermission.CATALOG_PRODUCT_READ)}
          onClick={() => { setLoadedQuery(query.trim()); void catalog.listItems(query.trim()); }}>Consultar catálogo</button>
        <ul>{catalog.items.map((item) => (
          <li key={item.presentation_id}>{item.name} · {item.presentation_name} · {item.price_amount} {item.currency_code} · {item.presentation_id}</li>
        ))}</ul>
        {catalog.hasMore && <button disabled={catalog.busy || !permissions.has(CanonicalPermission.CATALOG_PRODUCT_READ)}
          onClick={() => { void catalog.listItems(loadedQuery, catalog.items.length); }}>Cargar más resultados</button>}
      </div>

      <input
        data-testid="product-code-input"
        aria-label="Código interno"
        value={code}
        onChange={(e) => { setCode(e.target.value); }}
        placeholder="Código interno"
        disabled={catalog.busy}
      />
      <input
        data-testid="product-name-input"
        aria-label="Nombre del producto"
        value={name}
        onChange={(e) => { setName(e.target.value); }}
        placeholder="Nombre del producto"
        disabled={catalog.busy}
      />
      <input
        data-testid="presentation-name-input"
        aria-label="Presentación"
        value={presentationName}
        onChange={(e) => { setPresentationName(e.target.value); }}
        placeholder="Presentación"
        disabled={catalog.busy}
      />
      <input
        data-testid="unit-code-input"
        aria-label="Unidad"
        value={unitCode}
        onChange={(e) => { setUnitCode(e.target.value); }}
        placeholder="Unidad"
        disabled={catalog.busy}
      />
      {/* La precisión de la unidad gobierna cuántos decimales admite una
          cantidad: 0 para unidades enteras, 3 para kilos. No es cosmética. */}
      <input
        data-testid="unit-precision-input"
        aria-label="Decimales de la unidad"
        value={unitPrecision}
        onChange={(e) => { setUnitPrecision(e.target.value); }}
        placeholder="Decimales de la unidad"
        disabled={catalog.busy}
      />
      <input
        data-testid="product-barcode-input"
        aria-label="Código de barras"
        value={barcode}
        onChange={(e) => { setBarcode(e.target.value); }}
        placeholder="Código de barras (opcional)"
        disabled={catalog.busy}
      />
      <input
        data-testid="product-price-input"
        aria-label="Precio"
        value={price}
        onChange={(e) => { setPrice(e.target.value); }}
        placeholder="Precio"
        disabled={catalog.busy}
      />
      <input
        data-testid="product-currency-input"
        aria-label="Moneda"
        value={currency}
        onChange={(e) => { setCurrency(e.target.value); }}
        placeholder="Moneda"
        disabled={catalog.busy}
      />
      <label>
        <input
          data-testid="product-stock-controlled-input"
          type="checkbox"
          checked={stockControlled}
          onChange={(e) => { setStockControlled(e.target.checked); }}
          disabled={catalog.busy}
        />
        Controla existencia
      </label>

      <label><input type="checkbox" aria-label="Declarar atributos fiscales" checked={includeFiscal}
        disabled={catalog.busy} onChange={(event) => setIncludeFiscal(event.target.checked)} />Declarar atributos fiscales</label>
      {includeFiscal && <fieldset disabled={catalog.busy}>
        <legend>Atributos fiscales de esta presentación</legend>
        {([
          ["codeReference", "Referencia fiscal"], ["unitMeasureCode", "Código DIAN de unidad"],
          ["standardCode", "Estándar de producto"], ["taxCode", "Código de impuesto"], ["taxRate", "Tasa de impuesto (%)"],
        ] as const).map(([key, label]) => <label key={key}>{label}<input aria-label={label} value={fiscal[key]}
          onChange={(event) => setFiscal((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
        <p>Declare los códigos verificados y la tasa aplicable. Dejarlos sin declarar no significa exención.</p>
      </fieldset>}

      <button
        data-testid="register-product-button"
        onClick={() => {
          void catalog.registerProduct({
            code: code.trim(),
            name: name.trim(),
            stockControlled,
            presentationName: presentationName.trim(),
            unitCode: unitCode.trim(),
            unitPrecision: Number.parseInt(unitPrecision.trim(), 10),
            barcode,
            price,
            currencyCode: currency.trim(),
            ...(includeFiscal ? { fiscalAttributes: fiscal } : {}),
          });
        }}
        disabled={csvBusy || catalog.busy || !permissions.has(CanonicalPermission.CATALOG_PRODUCT_REGISTER) || incomplete}
      >
        Dar de alta
      </button>

      {catalog.product !== null && (
        <div data-testid="product-registered">
          <span data-testid="product-id">{catalog.product.productId}</span>
          <span data-testid="presentation-id">{catalog.product.presentationId}</span>
          <span data-testid="product-outcome">{catalog.product.outcome}</span>
          {onReceiveStock && <button data-testid="product-receive-stock" onClick={() => onReceiveStock(catalog.product!.presentationId)}>Registrar entrada de este producto</button>}
        </div>
      )}
      {catalog.product === null && catalog.outcome !== null && (
        <div data-testid="product-rejected">{catalog.outcome}</div>
      )}
      {catalog.error !== null && <div data-testid="catalog-error">{catalog.error}</div>}
    </section>
  );
}

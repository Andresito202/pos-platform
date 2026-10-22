import { CanonicalPermission } from "@pos-platform/contracts";
import { useState } from "react";
import { useCatalogAdmin } from "../hooks/useCatalogAdmin.js";

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

  const incomplete = code.trim() === ""
    || name.trim() === ""
    || presentationName.trim() === ""
    || price.trim() === "";

  return (
    <section data-testid="catalog-panel">
      <h2>Catálogo</h2>
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
        disabled={catalog.busy || !permissions.has(CanonicalPermission.CATALOG_PRODUCT_REGISTER) || incomplete}
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

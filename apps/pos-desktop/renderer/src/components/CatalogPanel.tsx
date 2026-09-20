import { useEffect, useState } from "react";
import { useCatalogAdmin } from "../hooks/useCatalogAdmin.js";

/**
 * Alta de producto. Es la pantalla que faltaba para poder usar el POS el primer
 * día: sin ella el catálogo sólo se podía cargar desde una prueba.
 *
 * Muestra el `presentation_id` resultante porque es lo que la entrada de
 * existencia necesita a continuación. Esconderlo obligaría a buscarlo en la base
 * de datos, que es justo lo que una pantalla existe para evitar.
 *
 * El segundo bloque declara los **códigos fiscales** de esa presentación
 * (`D-19`). Sin ellos el producto se vende pero no se factura: la emisión se
 * detiene en `LINE_FISCAL_ATTRIBUTE_MISSING` con el cliente delante. Se
 * prerrellena con la presentación recién dada de alta porque es la secuencia
 * real —alta y códigos son el mismo momento de trabajo—, y sigue siendo
 * editable para poder **corregir** una presentación anterior.
 */
export function CatalogPanel(): React.JSX.Element {
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
  const [presentationId, setPresentationId] = useState("");
  const [codeReference, setCodeReference] = useState("");
  const [unitMeasureCode, setUnitMeasureCode] = useState("94");
  const [standardCode, setStandardCode] = useState("999");
  const [taxCode, setTaxCode] = useState("01");
  const [taxRate, setTaxRate] = useState("19");
  const [addProductId, setAddProductId] = useState("");
  const [addName, setAddName] = useState("");
  const [addUnitCode, setAddUnitCode] = useState("UND");
  const [addUnitPrecision, setAddUnitPrecision] = useState("0");
  const [addBarcode, setAddBarcode] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [factor, setFactor] = useState("12");

  // Prerrellenar copiando al estado, no calculando el valor mostrado: si el
  // campo fuese un valor derivado, borrarlo volvería a mostrar la presentación
  // recién dada de alta y el operador no podría escribir otra.
  const registeredPresentation = catalog.product?.presentationId ?? null;
  useEffect(() => {
    if (registeredPresentation !== null) setPresentationId(registeredPresentation);
  }, [registeredPresentation]);

  const targetPresentation = presentationId.trim();
  const fiscalIncomplete = targetPresentation === ""
    || codeReference.trim() === ""
    || unitMeasureCode.trim() === ""
    || standardCode.trim() === ""
    || taxCode.trim() === ""
    || taxRate.trim() === "";

  const incomplete = code.trim() === ""
    || name.trim() === ""
    || presentationName.trim() === ""
    || price.trim() === "";

  // El producto recién dado de alta se copia también aquí: añadir la segunda
  // presentación es el paso siguiente natural, y obligar a copiar el id a mano
  // es justo lo que una pantalla existe para evitar.
  const registeredProductId = catalog.product?.productId ?? null;
  useEffect(() => {
    if (registeredProductId !== null) setAddProductId(registeredProductId);
  }, [registeredProductId]);

  const addIncomplete = addProductId.trim() === ""
    || addName.trim() === ""
    || addUnitCode.trim() === ""
    || addPrice.trim() === "";

  return (
    <section data-testid="catalog-panel">
      <h2>Catálogo</h2>

      <input
        data-testid="product-code-input"
        value={code}
        onChange={(e) => { setCode(e.target.value); }}
        placeholder="Código interno"
        disabled={catalog.busy}
      />
      <input
        data-testid="product-name-input"
        value={name}
        onChange={(e) => { setName(e.target.value); }}
        placeholder="Nombre del producto"
        disabled={catalog.busy}
      />
      <input
        data-testid="presentation-name-input"
        value={presentationName}
        onChange={(e) => { setPresentationName(e.target.value); }}
        placeholder="Presentación"
        disabled={catalog.busy}
      />
      <input
        data-testid="unit-code-input"
        value={unitCode}
        onChange={(e) => { setUnitCode(e.target.value); }}
        placeholder="Unidad"
        disabled={catalog.busy}
      />
      {/* La precisión de la unidad gobierna cuántos decimales admite una
          cantidad: 0 para unidades enteras, 3 para kilos. No es cosmética. */}
      <input
        data-testid="unit-precision-input"
        value={unitPrecision}
        onChange={(e) => { setUnitPrecision(e.target.value); }}
        placeholder="Decimales de la unidad"
        disabled={catalog.busy}
      />
      <input
        data-testid="product-barcode-input"
        value={barcode}
        onChange={(e) => { setBarcode(e.target.value); }}
        placeholder="Código de barras (opcional)"
        disabled={catalog.busy}
      />
      <input
        data-testid="product-price-input"
        value={price}
        onChange={(e) => { setPrice(e.target.value); }}
        placeholder="Precio"
        disabled={catalog.busy}
      />
      <input
        data-testid="product-currency-input"
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
          });
        }}
        disabled={catalog.busy || incomplete}
      >
        Dar de alta
      </button>

      {catalog.product !== null && (
        <div data-testid="product-registered">
          <span data-testid="product-id">{catalog.product.productId}</span>
          <span data-testid="presentation-id">{catalog.product.presentationId}</span>
          <span data-testid="product-outcome">{catalog.product.outcome}</span>
        </div>
      )}
      {catalog.product === null && catalog.outcome !== null && (
        <div data-testid="product-rejected">{catalog.outcome}</div>
      )}
      <h3>Códigos fiscales de la presentación</h3>

      <input
        data-testid="fiscal-presentation-id-input"
        value={targetPresentation}
        onChange={(e) => { setPresentationId(e.target.value); }}
        placeholder="Presentación"
        disabled={catalog.busy}
      />
      <input
        data-testid="fiscal-code-reference-input"
        value={codeReference}
        onChange={(e) => { setCodeReference(e.target.value); }}
        placeholder="Referencia del artículo"
        disabled={catalog.busy}
      />
      <input
        data-testid="fiscal-unit-measure-code-input"
        value={unitMeasureCode}
        onChange={(e) => { setUnitMeasureCode(e.target.value); }}
        placeholder="Unidad de medida DIAN"
        disabled={catalog.busy}
      />
      <input
        data-testid="fiscal-standard-code-input"
        value={standardCode}
        onChange={(e) => { setStandardCode(e.target.value); }}
        placeholder="Estándar de producto DIAN"
        disabled={catalog.busy}
      />
      <input
        data-testid="fiscal-tax-code-input"
        value={taxCode}
        onChange={(e) => { setTaxCode(e.target.value); }}
        placeholder="Impuesto DIAN"
        disabled={catalog.busy}
      />
      <input
        data-testid="fiscal-tax-rate-input"
        value={taxRate}
        onChange={(e) => { setTaxRate(e.target.value); }}
        placeholder="Tasa (%)"
        disabled={catalog.busy}
      />

      <button
        data-testid="set-fiscal-attribute-button"
        onClick={() => {
          void catalog.setFiscalAttribute({
            presentationId: targetPresentation,
            codeReference: codeReference.trim(),
            unitMeasureCode: unitMeasureCode.trim(),
            standardCode: standardCode.trim(),
            taxCode: taxCode.trim(),
            taxRate,
          });
        }}
        disabled={catalog.busy || fiscalIncomplete}
      >
        Declarar códigos fiscales
      </button>

      {catalog.fiscalOutcome !== null && (
        <div data-testid="fiscal-attribute-outcome">{catalog.fiscalOutcome}</div>
      )}
      {/* Los hallazgos dicen cuál de los cuatro códigos corregir. Resumirlos a
          «no verificados» dejaría al operador probando uno por uno. */}
      {catalog.fiscalFindings.length > 0 && (
        <ul data-testid="fiscal-attribute-findings">
          {catalog.fiscalFindings.map((finding) => (
            <li key={finding.path} data-testid={`fiscal-finding-${finding.path}`}>
              {finding.path}: {finding.code}
            </li>
          ))}
        </ul>
      )}

      <h3>Otra presentación del mismo producto</h3>
      {/* La unidad y el paquete del mismo artículo. Cada presentación lleva su
          propia existencia: vender una paca NO descuenta unidades. */}

      <input
        data-testid="add-presentation-product-id-input"
        value={addProductId}
        onChange={(e) => { setAddProductId(e.target.value); }}
        placeholder="Producto"
        disabled={catalog.busy}
      />
      <input
        data-testid="add-presentation-name-input"
        value={addName}
        onChange={(e) => { setAddName(e.target.value); }}
        placeholder="Presentación (p. ej. Paca x12)"
        disabled={catalog.busy}
      />
      <input
        data-testid="add-presentation-unit-code-input"
        value={addUnitCode}
        onChange={(e) => { setAddUnitCode(e.target.value); }}
        placeholder="Unidad"
        disabled={catalog.busy}
      />
      <input
        data-testid="add-presentation-unit-precision-input"
        value={addUnitPrecision}
        onChange={(e) => { setAddUnitPrecision(e.target.value); }}
        placeholder="Decimales de la unidad"
        disabled={catalog.busy}
      />
      <input
        data-testid="add-presentation-barcode-input"
        value={addBarcode}
        onChange={(e) => { setAddBarcode(e.target.value); }}
        placeholder="Código de barras (opcional)"
        disabled={catalog.busy}
      />
      <input
        data-testid="add-presentation-price-input"
        value={addPrice}
        onChange={(e) => { setAddPrice(e.target.value); }}
        placeholder="Precio"
        disabled={catalog.busy}
      />

      <button
        data-testid="add-presentation-button"
        onClick={() => {
          void catalog.addPresentation({
            productId: addProductId.trim(),
            name: addName.trim(),
            unitCode: addUnitCode.trim(),
            unitPrecision: Number.parseInt(addUnitPrecision.trim(), 10),
            barcode: addBarcode,
            price: addPrice,
            currencyCode: currency.trim(),
          });
        }}
        disabled={catalog.busy || addIncomplete}
      >
        Añadir presentación
      </button>

      {catalog.presentationOutcome !== null && (
        <div data-testid="add-presentation-outcome">{catalog.presentationOutcome}</div>
      )}
      {/* También en el rechazo por duplicado: dice cuál presentación usa ya ese
          código, para poder ir a ella en vez de reintentar a ciegas. */}
      {catalog.addedPresentationId !== null && (
        <span data-testid="added-presentation-id">{catalog.addedPresentationId}</span>
      )}

      <h4>Equivalencia entre las dos</h4>
      {/* `1 origen = factor destino`. Origen es la presentación de arriba,
          destino la del alta. Declarar no convierte: deja escrito el factor. */}
      <input
        data-testid="conversion-factor-input"
        value={factor}
        onChange={(e) => { setFactor(e.target.value); }}
        placeholder="Cuántas del destino produce una del origen"
        disabled={catalog.busy}
      />
      <button
        data-testid="declare-conversion-button"
        onClick={() => {
          void catalog.declareConversion({
            productId: addProductId.trim(),
            sourcePresentationId: catalog.addedPresentationId ?? "",
            targetPresentationId: catalog.product?.presentationId ?? "",
            factor,
            reversible: true,
          });
        }}
        disabled={
          catalog.busy || catalog.addedPresentationId === null
          || catalog.product === null || factor.trim() === ""
        }
      >
        Declarar equivalencia
      </button>
      {catalog.conversionOutcome !== null && (
        <div data-testid="conversion-declare-outcome">{catalog.conversionOutcome}</div>
      )}

      {catalog.error !== null && <div data-testid="catalog-error">{catalog.error}</div>}
    </section>
  );
}

import { useState } from "react";
import { CanonicalPermission, LicenseSectorEntitlement } from "@pos-platform/contracts";
import { useCatalogAdmin } from "../hooks/useCatalogAdmin.js";
import { PharmacyPanel } from "./PharmacyPanel.js";
import { BakeryPanel } from "./BakeryPanel.js";

/**
 * Alta de producto. Es la pantalla que faltaba para poder usar el POS el primer
 * día: sin ella el catálogo sólo se podía cargar desde una prueba.
 *
 * Muestra el `presentation_id` resultante porque es lo que la entrada de
 * existencia necesita a continuación. Esconderlo obligaría a buscarlo en la base
 * de datos, que es justo lo que una pantalla existe para evitar.
 */
export function CatalogPanel({ permissions = new Set(), entitlements = new Set() }: {
  permissions?: ReadonlySet<string>;
  entitlements?: ReadonlySet<string>;
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
  const [fiscalCodeReference, setFiscalCodeReference] = useState("");
  const [fiscalUnitMeasure, setFiscalUnitMeasure] = useState("");
  const [fiscalStandardCode, setFiscalStandardCode] = useState("");
  const [fiscalTaxCode, setFiscalTaxCode] = useState("");
  const [fiscalTaxRate, setFiscalTaxRate] = useState("");
  const [foodProductId, setFoodProductId] = useState("");
  const [conservation, setConservation] = useState<"AMBIENT" | "CHILLED" | "FROZEN" | "CONTROLLED">("CHILLED");
  const [requiresLot, setRequiresLot] = useState(true);
  const [requiresExpiry, setRequiresExpiry] = useState(true);
  const [foodNotes, setFoodNotes] = useState("");

  const incomplete = code.trim() === ""
    || name.trim() === ""
    || presentationName.trim() === ""
    || price.trim() === "";

  return (
    <section data-testid="catalog-panel">
      <h2>Catálogo</h2>
      <p className="pos-catalog-edit-note" data-testid="catalog-edit-preparation">
        Alta de productos disponible. La edición segura de nombre, códigos, precio y
        fotografía queda preparada en documentación; aún no hay caso de uso ni IPC de
        actualización. La planilla CSV de existencias no es alta masiva de catálogo.
      </p>

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

      <h3>Atributos fiscales (opcional)</h3>
      <p>Necesarios para emisión electrónica. Vacío = producto no facturable electrónicamente.</p>
      <input
        data-testid="fiscal-code-reference-input"
        value={fiscalCodeReference}
        onChange={(e) => { setFiscalCodeReference(e.target.value); }}
        placeholder="Referencia código DIAN"
        disabled={catalog.busy}
      />
      <input
        data-testid="fiscal-unit-measure-input"
        value={fiscalUnitMeasure}
        onChange={(e) => { setFiscalUnitMeasure(e.target.value); }}
        placeholder="Unidad de medida DIAN"
        disabled={catalog.busy}
      />
      <input
        data-testid="fiscal-standard-code-input"
        value={fiscalStandardCode}
        onChange={(e) => { setFiscalStandardCode(e.target.value); }}
        placeholder="Código estándar"
        disabled={catalog.busy}
      />
      <input
        data-testid="fiscal-tax-code-input"
        value={fiscalTaxCode}
        onChange={(e) => { setFiscalTaxCode(e.target.value); }}
        placeholder="Código impuesto"
        disabled={catalog.busy}
      />
      <input
        data-testid="fiscal-tax-rate-input"
        value={fiscalTaxRate}
        onChange={(e) => { setFiscalTaxRate(e.target.value); }}
        placeholder="Tarifa (ej. 19)"
        disabled={catalog.busy}
      />

      <button
        data-testid="register-product-button"
        onClick={() => {
          const fiscalFilled = [
            fiscalCodeReference,
            fiscalUnitMeasure,
            fiscalStandardCode,
            fiscalTaxCode,
            fiscalTaxRate,
          ].some((value) => value.trim() !== "");
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
            ...(fiscalFilled
              ? {
                fiscalAttributes: {
                  codeReference: fiscalCodeReference.trim(),
                  unitMeasureCode: fiscalUnitMeasure.trim(),
                  standardCode: fiscalStandardCode.trim(),
                  taxCode: fiscalTaxCode.trim(),
                  taxRate: fiscalTaxRate.trim(),
                },
              }
              : {}),
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

      {permissions.has(CanonicalPermission.CATALOG_PRODUCT_REGISTER) && entitlements.has(LicenseSectorEntitlement.SALSAMENTARIA) && (
        <>
          <h3>Política alimentaria</h3>
          <p>Registro operativo de conservación y control. No es certificación sanitaria. Requiere licencia Salsamentaria.</p>
          <div className="pos-form-grid">
            <label className="pos-field">ID de producto
              <input
                data-testid="food-policy-product-id"
                aria-label="ID de producto para política alimentaria"
                value={foodProductId}
                disabled={catalog.busy}
                onChange={(event) => setFoodProductId(event.target.value)}
              />
            </label>
            <label className="pos-field">Conservación
              <select
                data-testid="food-policy-conservation"
                aria-label="Conservación"
                value={conservation}
                disabled={catalog.busy}
                onChange={(event) => setConservation(event.target.value as typeof conservation)}
              >
                <option value="AMBIENT">Ambiente</option>
                <option value="CHILLED">Refrigerado</option>
                <option value="FROZEN">Congelado</option>
                <option value="CONTROLLED">Controlado</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                data-testid="food-policy-lot"
                checked={requiresLot}
                disabled={catalog.busy}
                onChange={(event) => setRequiresLot(event.target.checked)}
              />
              Exige lote
            </label>
            <label>
              <input
                type="checkbox"
                data-testid="food-policy-expiry"
                checked={requiresExpiry}
                disabled={catalog.busy}
                onChange={(event) => setRequiresExpiry(event.target.checked)}
              />
              Exige vencimiento
            </label>
            <label className="pos-field">Notas
              <input
                data-testid="food-policy-notes"
                aria-label="Notas de política alimentaria"
                value={foodNotes}
                disabled={catalog.busy}
                onChange={(event) => setFoodNotes(event.target.value)}
              />
            </label>
            <button
              data-testid="upsert-food-policy-button"
              disabled={catalog.busy || foodProductId.trim() === ""}
              onClick={() => {
                void catalog.upsertFoodPolicy({
                  productId: foodProductId.trim(),
                  conservationCode: conservation,
                  requiresLotTracking: requiresLot,
                  requiresExpiry,
                  notes: foodNotes,
                });
              }}
            >
              Guardar política
            </button>
          </div>
          {catalog.foodPolicyOutcome !== null && (
            <div data-testid="food-policy-outcome">
              {catalog.foodPolicyOutcome}
              {catalog.foodPolicyVersion !== null ? ` v${catalog.foodPolicyVersion}` : ""}
            </div>
          )}
        </>
      )}

      {catalog.error !== null && <div data-testid="catalog-error">{catalog.error}</div>}

      {entitlements.has(LicenseSectorEntitlement.FARMACIA) && (
        <PharmacyPanel permissions={permissions} />
      )}
      {entitlements.has(LicenseSectorEntitlement.PASTELERIA) && (
        <BakeryPanel permissions={permissions} />
      )}
    </section>
  );
}

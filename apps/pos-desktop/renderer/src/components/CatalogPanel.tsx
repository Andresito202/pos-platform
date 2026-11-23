import { useState } from "react";
import {
  CanonicalPermission,
  LicenseSectorEntitlement,
  type CatalogItemListItem,
} from "@pos-platform/contracts";
import { formatScale6Display } from "../money-display.js";
import { useCatalogAdmin } from "../hooks/useCatalogAdmin.js";
import { CatalogImport } from "./CatalogImport.js";
import { ProductAvatar } from "./ProductAvatar.js";
import { PharmacyPanel } from "./PharmacyPanel.js";
import { BakeryPanel } from "./BakeryPanel.js";

/**
 * Alta y edición administrativa de productos (UC-CAT-002).
 * Muestra el `presentation_id` resultante porque es lo que la entrada de
 * existencia necesita a continuación. El stock no se edita aquí.
 */
export function CatalogPanel({ permissions = new Set(), entitlements = new Set() }: {
  permissions?: ReadonlySet<string>;
  entitlements?: ReadonlySet<string>;
}): React.JSX.Element {
  const catalog = useCatalogAdmin();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
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

  const [editSearch, setEditSearch] = useState("");
  const [editProductId, setEditProductId] = useState<string | null>(null);
  const [editExpectedVersion, setEditExpectedVersion] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBrand, setEditBrand] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editStatus, setEditStatus] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
  const [editPresentationId, setEditPresentationId] = useState<string | null>(null);
  const [editPresentationVersion, setEditPresentationVersion] = useState<number | null>(null);
  const [editPresentationName, setEditPresentationName] = useState("");
  const [editBarcode, setEditBarcode] = useState("");
  const [editLowStock, setEditLowStock] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editCurrency, setEditCurrency] = useState("COP");
  const [editMediaId, setEditMediaId] = useState<string | null>(null);
  const [editSelectedLabel, setEditSelectedLabel] = useState<string | null>(null);

  const canUpdate = permissions.has(CanonicalPermission.CATALOG_PRODUCT_UPDATE);
  const canPublishPrice = permissions.has(CanonicalPermission.CATALOG_PRICE_PUBLISH);
  const canManageMedia = permissions.has(CanonicalPermission.CATALOG_MEDIA_MANAGE);
  const canSearchEdit = canUpdate || canPublishPrice || canManageMedia
    || permissions.has(CanonicalPermission.CATALOG_PRODUCT_READ);

  function applySelectedItem(item: CatalogItemListItem): void {
    setEditProductId(item.product_id);
    setEditExpectedVersion(item.product_version);
    setEditName(item.name);
    setEditCode(item.code);
    setEditDescription(item.description ?? "");
    setEditBrand(item.brand ?? "");
    setEditCategory(item.category ?? "");
    setEditStatus("ACTIVE");
    setEditPresentationId(item.presentation_id);
    setEditPresentationVersion(item.presentation_version);
    setEditPresentationName(item.presentation_name);
    setEditBarcode(item.barcode ?? "");
    setEditLowStock(item.low_stock_threshold === null
      ? ""
      : formatScale6Display(item.low_stock_threshold));
    setEditPrice(formatScale6Display(item.price_amount));
    setEditCurrency(item.currency_code);
    setEditMediaId(item.media_id);
    setEditSelectedLabel(`${item.name} · ${item.code} · ${item.presentation_name}`);
  }

  async function reloadSelectedProduct(): Promise<void> {
    if (editCode.trim() === "" && editSearch.trim() === "") return;
    const query = editCode.trim() !== "" ? editCode.trim() : editSearch.trim();
    const items = await catalog.searchEditCandidates(query);
    const match = items.find((item) =>
      (editProductId !== null && item.product_id === editProductId)
      || (editPresentationId !== null && item.presentation_id === editPresentationId),
    ) ?? items[0];
    if (match !== undefined) applySelectedItem(match);
  }

  const incomplete = code.trim() === ""
    || name.trim() === ""
    || presentationName.trim() === ""
    || price.trim() === "";

  return (
    <section data-testid="catalog-panel">
      <h2>Catálogo</h2>
      <p className="pos-catalog-edit-note" data-testid="catalog-edit-preparation">
        Alta y edición autorizada de nombre, descripción, marca, categoría, códigos,
        presentación, precio y fotografía. La unidad y la precisión no se cambian en
        edición. El stock se gestiona en Inventario con su propia planilla.
      </p>

      {permissions.has(CanonicalPermission.CATALOG_PRODUCT_REGISTER) && (
        <CatalogImport
          enabled={permissions.has(CanonicalPermission.CATALOG_PRODUCT_REGISTER) && !catalog.busy}
        />
      )}

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
        data-testid="product-description-input"
        value={description}
        onChange={(e) => { setDescription(e.target.value); }}
        placeholder="Descripción comercial (opcional)"
        disabled={catalog.busy}
      />
      <input
        data-testid="product-brand-input"
        value={brand}
        onChange={(e) => { setBrand(e.target.value); }}
        placeholder="Marca (opcional)"
        disabled={catalog.busy}
      />
      <input
        data-testid="product-category-input"
        value={category}
        onChange={(e) => { setCategory(e.target.value); }}
        placeholder="Categoría (opcional)"
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
            description: description.trim() === "" ? null : description.trim(),
            brand: brand.trim() === "" ? null : brand.trim(),
            category: category.trim() === "" ? null : category.trim(),
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

      {(canUpdate || canPublishPrice || canManageMedia) && (
        <section data-testid="catalog-edit-section">
          <h3>Editar producto existente</h3>
          <p>
            Busca y selecciona un producto del catálogo. Las versiones se conservan
            internamente. No modifica existencias ni unidad base.
          </p>
          {canSearchEdit && (
            <form
              className="pos-product-tools"
              onSubmit={(event) => {
                event.preventDefault();
                void catalog.searchEditCandidates(editSearch.trim());
              }}
            >
              <label>Buscar para editar
                <input
                  data-testid="edit-product-search-input"
                  value={editSearch}
                  onChange={(e) => { setEditSearch(e.target.value); }}
                  placeholder="Nombre, código o barras"
                  disabled={catalog.busy}
                />
              </label>
              <button data-testid="edit-product-search-button" disabled={catalog.busy}>
                Buscar
              </button>
            </form>
          )}
          {catalog.editCandidates.length > 0 && (
            <ul data-testid="edit-product-candidates">
              {catalog.editCandidates.map((item) => (
                <li key={item.presentation_id}>
                  <button
                    type="button"
                    data-testid={`edit-select-${item.presentation_id}`}
                    disabled={catalog.busy}
                    onClick={() => { applySelectedItem(item); }}
                  >
                    {item.name} · {item.code} · {item.presentation_name} · {formatScale6Display(item.price_amount)}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {editProductId !== null && editExpectedVersion !== null && editPresentationId !== null
            && editPresentationVersion !== null && (
            <div data-testid="edit-product-selected">
              <p data-testid="edit-selected-label">{editSelectedLabel}</p>
              <ProductAvatar
                item={{
                  product_id: editProductId,
                  presentation_id: editPresentationId,
                  code: editCode,
                  name: editName,
                  description: editDescription.trim() === "" ? null : editDescription.trim(),
                  brand: editBrand.trim() === "" ? null : editBrand.trim(),
                  category: editCategory.trim() === "" ? null : editCategory.trim(),
                  presentation_name: editPresentationName,
                  unit_code: "UND",
                  unit_precision: 0,
                  barcode: editBarcode === "" ? null : editBarcode,
                  stock_controlled: true,
                  price_amount: "1.000000",
                  currency_code: editCurrency,
                  quantity_available: null,
                  quantity_on_hand: null,
                  quantity_reserved: null,
                  quantity_unsellable: null,
                  low_stock_threshold: editLowStock.trim() === "" ? null : null,
                  availability_state: "NOT_TRACKED",
                  product_version: editExpectedVersion,
                  presentation_version: editPresentationVersion,
                  media_id: editMediaId,
                }}
              />

              {canUpdate && (
                <>
                  <input
                    data-testid="edit-product-name-input"
                    value={editName}
                    onChange={(e) => { setEditName(e.target.value); }}
                    placeholder="Nombre comercial"
                    disabled={catalog.busy}
                  />
                  <input
                    data-testid="edit-product-code-input"
                    value={editCode}
                    onChange={(e) => { setEditCode(e.target.value); }}
                    placeholder="Código interno"
                    disabled={catalog.busy}
                  />
                  <input
                    data-testid="edit-product-description-input"
                    value={editDescription}
                    onChange={(e) => { setEditDescription(e.target.value); }}
                    placeholder="Descripción comercial"
                    disabled={catalog.busy}
                  />
                  <input
                    data-testid="edit-product-brand-input"
                    value={editBrand}
                    onChange={(e) => { setEditBrand(e.target.value); }}
                    placeholder="Marca"
                    disabled={catalog.busy}
                  />
                  <input
                    data-testid="edit-product-category-input"
                    value={editCategory}
                    onChange={(e) => { setEditCategory(e.target.value); }}
                    placeholder="Categoría"
                    disabled={catalog.busy}
                  />
                  <select
                    data-testid="edit-product-status-input"
                    aria-label="Estado del producto"
                    value={editStatus}
                    disabled={catalog.busy}
                    onChange={(e) => { setEditStatus(e.target.value as "ACTIVE" | "INACTIVE"); }}
                  >
                    <option value="ACTIVE">Activo</option>
                    <option value="INACTIVE">Inactivo</option>
                  </select>
                  <input
                    data-testid="edit-presentation-name-input"
                    value={editPresentationName}
                    onChange={(e) => { setEditPresentationName(e.target.value); }}
                    placeholder="Nombre de presentación"
                    disabled={catalog.busy}
                  />
                  <input
                    data-testid="edit-barcode-input"
                    value={editBarcode}
                    onChange={(e) => { setEditBarcode(e.target.value); }}
                    placeholder="Código de barras"
                    disabled={catalog.busy}
                  />
                  <input
                    data-testid="edit-low-stock-input"
                    value={editLowStock}
                    onChange={(e) => { setEditLowStock(e.target.value); }}
                    placeholder="Umbral existencias bajas (opcional)"
                    disabled={catalog.busy}
                  />
                  <button
                    data-testid="update-product-button"
                    disabled={catalog.busy}
                    onClick={() => {
                      void catalog.updateProduct({
                        productId: editProductId,
                        expectedVersion: editExpectedVersion,
                        name: editName.trim(),
                        code: editCode.trim(),
                        description: editDescription.trim() === "" ? null : editDescription.trim(),
                        brand: editBrand.trim() === "" ? null : editBrand.trim(),
                        category: editCategory.trim() === "" ? null : editCategory.trim(),
                        status: editStatus,
                        presentationId: editPresentationId,
                        presentationExpectedVersion: editPresentationVersion,
                        presentationName: editPresentationName.trim(),
                        barcode: editBarcode.trim() === "" ? null : editBarcode.trim(),
                        lowStockThreshold: editLowStock.trim() === ""
                          ? null
                          : editLowStock.trim(),
                      }).then((result) => {
                        if (result?.outcome === "UPDATED" || result?.outcome === "IDEMPOTENT") {
                          if (result.version !== null) setEditExpectedVersion(result.version);
                          if (result.presentation_version !== null) {
                            setEditPresentationVersion(result.presentation_version);
                          }
                        }
                      });
                    }}
                  >
                    Guardar cambios
                  </button>
                  {catalog.updateOutcome !== null && (
                    <div data-testid="update-product-outcome">
                      {catalog.updateOutcome}
                      {catalog.updateVersion !== null ? ` v${catalog.updateVersion}` : ""}
                    </div>
                  )}
                  {(catalog.updateOutcome === "VERSION_CONFLICT"
                    || catalog.updateOutcome === "PRESENTATION_VERSION_CONFLICT") && (
                    <div data-testid="edit-version-conflict">
                      <p>El producto fue modificado por otra operación. Recarga antes de guardar.</p>
                      <button
                        type="button"
                        data-testid="edit-reload-button"
                        disabled={catalog.busy}
                        onClick={() => { void reloadSelectedProduct(); }}
                      >
                        Recargar información
                      </button>
                    </div>
                  )}
                </>
              )}

              {canPublishPrice && (
                <>
                  <h4>Publicar precio</h4>
                  <input
                    data-testid="edit-price-amount-input"
                    value={editPrice}
                    onChange={(e) => { setEditPrice(e.target.value); }}
                    placeholder="Nuevo precio"
                    disabled={catalog.busy}
                  />
                  <input
                    data-testid="edit-price-currency-input"
                    value={editCurrency}
                    onChange={(e) => { setEditCurrency(e.target.value); }}
                    placeholder="Moneda"
                    disabled={catalog.busy}
                  />
                  <button
                    data-testid="publish-price-button"
                    disabled={catalog.busy || editPrice.trim() === ""}
                    onClick={() => {
                      void catalog.publishPrice({
                        presentationId: editPresentationId,
                        amount: editPrice,
                        currencyCode: editCurrency.trim(),
                      });
                    }}
                  >
                    Publicar precio
                  </button>
                  {catalog.priceOutcome !== null && (
                    <div data-testid="publish-price-outcome">{catalog.priceOutcome}</div>
                  )}
                </>
              )}

              {canManageMedia && (
                <>
                  <h4>Fotografía</h4>
                  <input
                    data-testid="edit-media-file-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={catalog.busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file === undefined) return;
                      void catalog.putMedia({
                        productId: editProductId,
                        expectedVersion: editExpectedVersion,
                        file,
                        previousMediaId: editMediaId,
                      }).then((result) => {
                        if (result?.outcome === "ATTACHED") {
                          if (result.version !== null) setEditExpectedVersion(result.version);
                          setEditMediaId(result.media_id);
                        }
                      });
                    }}
                  />
                  <button
                    data-testid="clear-media-button"
                    disabled={catalog.busy}
                    onClick={() => {
                      void catalog.clearMedia({
                        productId: editProductId,
                        expectedVersion: editExpectedVersion,
                        previousMediaId: editMediaId,
                      }).then((result) => {
                        if (result?.outcome === "ATTACHED") {
                          if (result.version !== null) setEditExpectedVersion(result.version);
                          setEditMediaId(null);
                        }
                      });
                    }}
                  >
                    Retirar fotografía
                  </button>
                  {catalog.mediaOutcome !== null && (
                    <div data-testid="media-outcome">
                      {catalog.mediaOutcome}
                      {catalog.mediaVersion !== null ? ` v${catalog.mediaVersion}` : ""}
                    </div>
                  )}
                  {catalog.mediaOutcome === "VERSION_CONFLICT" && (
                    <div data-testid="edit-media-version-conflict">
                      <p>La fotografía no se aplicó: el producto cambió. Recarga e inténtalo de nuevo.</p>
                      <button
                        type="button"
                        data-testid="edit-media-reload-button"
                        disabled={catalog.busy}
                        onClick={() => { void reloadSelectedProduct(); }}
                      >
                        Recargar información
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>
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

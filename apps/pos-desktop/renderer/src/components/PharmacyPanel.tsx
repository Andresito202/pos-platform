import React, { useState } from "react";
import { usePharmacyAdmin } from "../hooks/usePharmacyAdmin.js";

/**
 * Farmacia/Droguería controls hosted in existing admin surfaces.
 * Does not create a parallel POS. Controlled special remains blocked without accredited evidence.
 */
export function PharmacyPanel({ permissions }: {
  permissions: ReadonlySet<string>;
}): React.JSX.Element {
  const pharmacy = usePharmacyAdmin();
  const canCatalog = permissions.has("CATALOG_PRODUCT_REGISTER");
  const canReceive = permissions.has("INVENTORY_STOCK_RECEIVE");
  const canAdjust = permissions.has("INVENTORY_STOCK_ADJUST");

  const [productId, setProductId] = useState("");
  const [commercialName, setCommercialName] = useState("");
  const [category, setCategory] = useState<"OTC" | "PRESCRIPTION" | "CONTROLLED_SPECIAL" | "UNKNOWN">("OTC");
  const [verification, setVerification] = useState<"UNVERIFIED" | "VERIFIED_MANUAL" | "INVALID" | "EXPIRED">("UNVERIFIED");

  return (
    <section data-testid="pharmacy-panel">
      <h3>Farmacia / Droguería</h3>
      <p>
        Especialización sobre el catálogo e inventario existentes. No certifica habilitación
        sanitaria, inscripción FNE ni sincronización oficial INVIMA.
      </p>

      {canCatalog && <>
        <h4>Establecimiento</h4>
        <button
          data-testid="pharmacy-establishment-otc-button"
          disabled={pharmacy.busy}
          onClick={() => {
            void pharmacy.upsertEstablishment({
              establishmentType: "DROGUERIA",
              authorizedOtc: true,
              authorizedPrescription: true,
              authorizedControlledSpecial: false,
              controlledAuthorizationStatus: "NONE",
              controlledAuthorizationNote: null,
              technicalDirectorAttribution: "Director técnico documental",
            });
          }}
        >Guardar droguería OTC/Rx</button>
        {pharmacy.establishmentOutcome !== null && (
          <div data-testid="pharmacy-establishment-outcome">{pharmacy.establishmentOutcome}</div>
        )}

        <h4>Ficha farmacéutica</h4>
        <div className="pos-form-grid">
          <label className="pos-field">ID producto
            <input data-testid="pharmacy-profile-product-id" value={productId}
              disabled={pharmacy.busy} onChange={(e) => setProductId(e.target.value)} />
          </label>
          <label className="pos-field">Nombre comercial
            <input data-testid="pharmacy-profile-name" value={commercialName}
              disabled={pharmacy.busy} onChange={(e) => setCommercialName(e.target.value)} />
          </label>
          <label className="pos-field">Categoría
            <select data-testid="pharmacy-profile-category" value={category}
              disabled={pharmacy.busy}
              onChange={(e) => setCategory(e.target.value as typeof category)}>
              <option value="OTC">Venta libre</option>
              <option value="PRESCRIPTION">Con fórmula</option>
              <option value="CONTROLLED_SPECIAL">Control especial (bloqueado)</option>
              <option value="UNKNOWN">Desconocida</option>
            </select>
          </label>
          <label className="pos-field">Registro sanitario
            <select data-testid="pharmacy-profile-verification" value={verification}
              disabled={pharmacy.busy}
              onChange={(e) => setVerification(e.target.value as typeof verification)}>
              <option value="UNVERIFIED">No verificado</option>
              <option value="VERIFIED_MANUAL">Verificado manual</option>
              <option value="INVALID">Inválido</option>
              <option value="EXPIRED">Vencido</option>
            </select>
          </label>
          <button
            data-testid="pharmacy-profile-save-button"
            disabled={pharmacy.busy || productId.trim() === "" || commercialName.trim() === ""}
            onClick={() => {
              void pharmacy.upsertProfile({
                productId: productId.trim(),
                productKind: "MEDICINE",
                commercialName: commercialName.trim(),
                genericName: commercialName.trim(),
                activeIngredients: [commercialName.trim()],
                concentrationText: null,
                pharmaceuticalForm: null,
                manufacturer: null,
                sanitaryHolder: null,
                sanitaryRegistration: null,
                registrationVerificationStatus: verification,
                dispensationCategory: category,
                requiresPrescription: category === "PRESCRIPTION" || category === "CONTROLLED_SPECIAL",
                controlledSpecial: category === "CONTROLLED_SPECIAL",
                storageCondition: "AMBIENT",
                requiresLotTracking: true,
                requiresExpiry: true,
                regulatoryReviewAt: null,
              });
            }}
          >Guardar ficha</button>
        </div>
        {pharmacy.profileOutcome !== null && (
          <div data-testid="pharmacy-profile-outcome">{pharmacy.profileOutcome}</div>
        )}
      </>}

      {canReceive && (
        <p data-testid="pharmacy-receive-hint">
          Recepción técnica: use Inventario para entrar lote y registre inspección ACCEPTED/QUARANTINE/REJECTED.
          Un rechazo no aumenta existencias disponibles.
        </p>
      )}
      {canAdjust && (
        <p data-testid="pharmacy-alert-hint">
          Alertas sanitarias: carga administrativa respaldada. No se presenta como sincronización oficial INVIMA.
        </p>
      )}
      {pharmacy.error !== null && <div data-testid="pharmacy-error">{pharmacy.error}</div>}
    </section>
  );
}

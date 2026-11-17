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
  const [prescribedQty, setPrescribedQty] = useState("1.000000");
  const [issuerId, setIssuerId] = useState("");
  const [issuerName, setIssuerName] = useState("");
  const [patientRef, setPatientRef] = useState("");
  const [presentationId, setPresentationId] = useState("");
  const [lotId, setLotId] = useState("");
  const [batchCode, setBatchCode] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [receiptQty, setReceiptQty] = useState("1.000000");
  const [inspection, setInspection] = useState<"ACCEPTED" | "QUARANTINE" | "REJECTED">("ACCEPTED");
  const [alertReference, setAlertReference] = useState("");
  const [alertNote, setAlertNote] = useState("");
  const [alertAction, setAlertAction] = useState<"QUARANTINE" | "RECALL">("QUARANTINE");

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

        <h4>Registrar fórmula</h4>
        <div className="pos-form-grid">
          <label className="pos-field">Cantidad prescrita
            <input value={prescribedQty} disabled={pharmacy.busy}
              onChange={(e) => setPrescribedQty(e.target.value)} />
          </label>
          <label className="pos-field">ID profesional
            <input value={issuerId} disabled={pharmacy.busy}
              onChange={(e) => setIssuerId(e.target.value)} />
          </label>
          <label className="pos-field">Nombre profesional
            <input value={issuerName} disabled={pharmacy.busy}
              onChange={(e) => setIssuerName(e.target.value)} />
          </label>
          <label className="pos-field">Referencia paciente
            <input value={patientRef} disabled={pharmacy.busy}
              onChange={(e) => setPatientRef(e.target.value)} />
          </label>
          <button
            type="button"
            data-testid="pharmacy-prescription-register-button"
            disabled={pharmacy.busy || productId.trim() === "" || issuerId.trim() === "" || issuerName.trim() === "" || patientRef.trim() === ""}
            onClick={() => {
              const now = new Date();
              const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
              void pharmacy.registerPrescription({
                productId: productId.trim(),
                prescribedQuantity: prescribedQty,
                prescribedAt: now.toISOString(),
                expiresAt: expires.toISOString(),
                issuerProfessionalId: issuerId.trim(),
                issuerName: issuerName.trim(),
                patientReference: patientRef.trim(),
              });
            }}
          >Registrar fórmula</button>
        </div>
        {pharmacy.prescriptionOutcome !== null && (
          <div data-testid="pharmacy-prescription-outcome">{pharmacy.prescriptionOutcome}</div>
        )}
        {pharmacy.lastPrescriptionId !== null && (
          <p data-testid="pharmacy-prescription-id">Fórmula: {pharmacy.lastPrescriptionId}</p>
        )}
      </>}

      {canReceive && (
        <div>
          <h4>Recepción técnica</h4>
          <p data-testid="pharmacy-receive-hint">
            Entre el lote en Inventario y registre la inspección. REJECTED no aumenta existencias.
          </p>
          <div className="pos-form-grid">
            <label className="pos-field">Presentación
              <input value={presentationId} disabled={pharmacy.busy}
                onChange={(e) => setPresentationId(e.target.value)} />
            </label>
            <label className="pos-field">Lote (opcional)
              <input value={lotId} disabled={pharmacy.busy}
                onChange={(e) => setLotId(e.target.value)} />
            </label>
            <label className="pos-field">Código de lote
              <input value={batchCode} disabled={pharmacy.busy}
                onChange={(e) => setBatchCode(e.target.value)} />
            </label>
            <label className="pos-field">Vencimiento (AAAA-MM-DD)
              <input value={expiryDate} disabled={pharmacy.busy}
                onChange={(e) => setExpiryDate(e.target.value)} />
            </label>
            <label className="pos-field">Cantidad
              <input value={receiptQty} disabled={pharmacy.busy}
                onChange={(e) => setReceiptQty(e.target.value)} />
            </label>
            <label className="pos-field">Inspección
              <select value={inspection} disabled={pharmacy.busy}
                onChange={(e) => setInspection(e.target.value as typeof inspection)}>
                <option value="ACCEPTED">Aceptado</option>
                <option value="QUARANTINE">Cuarentena</option>
                <option value="REJECTED">Rechazado</option>
              </select>
            </label>
            <button
              type="button"
              data-testid="pharmacy-technical-receipt-button"
              disabled={pharmacy.busy || presentationId.trim() === "" || batchCode.trim() === ""}
              onClick={() => {
                void pharmacy.registerTechnicalReceipt({
                  presentationId: presentationId.trim(),
                  lotId: lotId.trim() === "" ? null : lotId.trim(),
                  sanitaryRegistration: null,
                  batchCode: batchCode.trim(),
                  expiryDate: expiryDate.trim() === "" ? null : expiryDate.trim(),
                  quantity: receiptQty,
                  storageCondition: "AMBIENT",
                  inspectionResult: inspection,
                  observations: null,
                  inventoryMovementId: null,
                });
              }}
            >Registrar recepción técnica</button>
          </div>
          {pharmacy.receiptOutcome !== null && (
            <div data-testid="pharmacy-receipt-outcome">{pharmacy.receiptOutcome}</div>
          )}
        </div>
      )}

      {canAdjust && (
        <div>
          <h4>Alerta sanitaria (administrativa)</h4>
          <p data-testid="pharmacy-alert-hint">
            Carga administrativa respaldada. No es sincronización oficial INVIMA.
          </p>
          <div className="pos-form-grid">
            <label className="pos-field">Referencia
              <input value={alertReference} disabled={pharmacy.busy}
                onChange={(e) => setAlertReference(e.target.value)} />
            </label>
            <label className="pos-field">Evidencia
              <input value={alertNote} disabled={pharmacy.busy}
                onChange={(e) => setAlertNote(e.target.value)} />
            </label>
            <label className="pos-field">Acción
              <select value={alertAction} disabled={pharmacy.busy}
                onChange={(e) => setAlertAction(e.target.value as typeof alertAction)}>
                <option value="QUARANTINE">Cuarentena</option>
                <option value="RECALL">Retiro</option>
              </select>
            </label>
            <button
              type="button"
              data-testid="pharmacy-sanitary-alert-button"
              disabled={pharmacy.busy || alertReference.trim() === "" || alertNote.trim() === ""}
              onClick={() => {
                void pharmacy.registerSanitaryAlert({
                  sourceKind: "MANUAL_AUTHORIZED",
                  sourceReference: alertReference.trim(),
                  productId: productId.trim() === "" ? null : productId.trim(),
                  lotId: lotId.trim() === "" ? null : lotId.trim(),
                  actionCode: alertAction,
                  evidenceNote: alertNote.trim(),
                });
              }}
            >Registrar alerta</button>
          </div>
          {pharmacy.alertOutcome !== null && (
            <div data-testid="pharmacy-alert-outcome">{pharmacy.alertOutcome}</div>
          )}
        </div>
      )}
      {pharmacy.error !== null && <div data-testid="pharmacy-error">{pharmacy.error}</div>}
    </section>
  );
}

import { useState } from "react";

type Outcome = string | null;

async function invoke<T>(messageType: string, payload: Record<string, unknown>): Promise<T> {
  const api = (window as unknown as {
    pos?: { invoke: (channel: string, body: unknown) => Promise<T> };
  }).pos;
  if (!api) throw new Error("POS_BRIDGE_UNAVAILABLE");
  return api.invoke(`pos:${messageType}`, {
    protocol_version: "1.0.0",
    request_id: crypto.randomUUID(),
    correlation_id: crypto.randomUUID(),
    causation_id: null,
    idempotency_key: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    message_type: messageType,
    payload,
  });
}

export function usePharmacyAdmin() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Outcome>(null);
  const [establishmentOutcome, setEstablishmentOutcome] = useState<Outcome>(null);
  const [profileOutcome, setProfileOutcome] = useState<Outcome>(null);
  const [prescriptionOutcome, setPrescriptionOutcome] = useState<Outcome>(null);
  const [lastPrescriptionId, setLastPrescriptionId] = useState<string | null>(null);
  const [receiptOutcome, setReceiptOutcome] = useState<Outcome>(null);
  const [alertOutcome, setAlertOutcome] = useState<Outcome>(null);

  return {
    busy,
    error,
    establishmentOutcome,
    profileOutcome,
    prescriptionOutcome,
    lastPrescriptionId,
    receiptOutcome,
    alertOutcome,
    async upsertEstablishment(input: {
      establishmentType: string;
      authorizedOtc: boolean;
      authorizedPrescription: boolean;
      authorizedControlledSpecial: boolean;
      controlledAuthorizationStatus: string;
      controlledAuthorizationNote: string | null;
      technicalDirectorAttribution: string | null;
    }) {
      setBusy(true); setError(null);
      try {
        const result = await invoke<{ result?: { outcome?: string } }>("pharmacy.establishment.upsert", {
          establishment_type: input.establishmentType,
          authorized_otc: input.authorizedOtc,
          authorized_prescription: input.authorizedPrescription,
          authorized_controlled_special: input.authorizedControlledSpecial,
          controlled_authorization_status: input.controlledAuthorizationStatus,
          controlled_authorization_note: input.controlledAuthorizationNote,
          technical_director_attribution: input.technicalDirectorAttribution,
        });
        setEstablishmentOutcome(result.result?.outcome ?? "UNKNOWN");
      } catch (err) {
        setError(err instanceof Error ? err.message : "PHARMACY_ERROR");
      } finally {
        setBusy(false);
      }
    },
    async upsertProfile(input: {
      productId: string;
      productKind: string;
      commercialName: string;
      genericName: string | null;
      activeIngredients: string[];
      concentrationText: string | null;
      pharmaceuticalForm: string | null;
      manufacturer: string | null;
      sanitaryHolder: string | null;
      sanitaryRegistration: string | null;
      registrationVerificationStatus: string;
      dispensationCategory: string;
      requiresPrescription: boolean;
      controlledSpecial: boolean;
      storageCondition: string;
      requiresLotTracking: boolean;
      requiresExpiry: boolean;
      regulatoryReviewAt: string | null;
    }) {
      setBusy(true); setError(null);
      try {
        const result = await invoke<{ result?: { outcome?: string } }>("pharmacy.profile.upsert", {
          product_id: input.productId,
          product_kind: input.productKind,
          commercial_name: input.commercialName,
          generic_name: input.genericName,
          active_ingredients: input.activeIngredients,
          concentration_text: input.concentrationText,
          pharmaceutical_form: input.pharmaceuticalForm,
          manufacturer: input.manufacturer,
          sanitary_holder: input.sanitaryHolder,
          sanitary_registration: input.sanitaryRegistration,
          registration_verification_status: input.registrationVerificationStatus,
          dispensation_category: input.dispensationCategory,
          requires_prescription: input.requiresPrescription,
          controlled_special: input.controlledSpecial,
          storage_condition: input.storageCondition,
          requires_lot_tracking: input.requiresLotTracking,
          requires_expiry: input.requiresExpiry,
          regulatory_review_at: input.regulatoryReviewAt,
        });
        setProfileOutcome(result.result?.outcome ?? "UNKNOWN");
      } catch (err) {
        setError(err instanceof Error ? err.message : "PHARMACY_ERROR");
      } finally {
        setBusy(false);
      }
    },
    async registerPrescription(input: {
      productId: string;
      prescribedQuantity: string;
      prescribedAt: string;
      expiresAt: string;
      issuerProfessionalId: string;
      issuerName: string;
      patientReference: string;
    }) {
      setBusy(true); setError(null);
      try {
        const result = await invoke<{ result?: { outcome?: string; prescription_id?: string | null } }>(
          "pharmacy.prescription.register",
          {
            product_id: input.productId,
            prescribed_quantity: input.prescribedQuantity,
            prescribed_at: input.prescribedAt,
            expires_at: input.expiresAt,
            issuer_professional_id: input.issuerProfessionalId,
            issuer_name: input.issuerName,
            patient_reference: input.patientReference,
          },
        );
        setPrescriptionOutcome(result.result?.outcome ?? "UNKNOWN");
        if (typeof result.result?.prescription_id === "string") {
          setLastPrescriptionId(result.result.prescription_id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "PHARMACY_ERROR");
      } finally {
        setBusy(false);
      }
    },
    async registerTechnicalReceipt(input: {
      presentationId: string;
      lotId: string | null;
      sanitaryRegistration: string | null;
      batchCode: string;
      expiryDate: string | null;
      quantity: string;
      storageCondition: "AMBIENT" | "CHILLED" | "CONTROLLED_ROOM" | "OTHER";
      inspectionResult: "ACCEPTED" | "QUARANTINE" | "REJECTED";
      observations: string | null;
      inventoryMovementId: string | null;
    }) {
      setBusy(true); setError(null);
      try {
        const result = await invoke<{ result?: { outcome?: string } }>(
          "pharmacy.technical_receipt.register",
          {
            presentation_id: input.presentationId,
            lot_id: input.lotId,
            sanitary_registration: input.sanitaryRegistration,
            batch_code: input.batchCode,
            expiry_date: input.expiryDate,
            quantity: input.quantity,
            storage_condition: input.storageCondition,
            inspection_result: input.inspectionResult,
            observations: input.observations,
            inventory_movement_id: input.inventoryMovementId,
          },
        );
        setReceiptOutcome(result.result?.outcome ?? "UNKNOWN");
      } catch (err) {
        setError(err instanceof Error ? err.message : "PHARMACY_ERROR");
      } finally {
        setBusy(false);
      }
    },
    async registerSanitaryAlert(input: {
      sourceKind: "MANUAL_AUTHORIZED" | "EXTERNAL_IMPORT";
      sourceReference: string;
      productId: string | null;
      lotId: string | null;
      actionCode: "QUARANTINE" | "RECALL";
      evidenceNote: string;
    }) {
      setBusy(true); setError(null);
      try {
        const result = await invoke<{ result?: { outcome?: string } }>(
          "pharmacy.sanitary_alert.register",
          {
            source_kind: input.sourceKind,
            source_reference: input.sourceReference,
            product_id: input.productId,
            lot_id: input.lotId,
            action_code: input.actionCode,
            evidence_note: input.evidenceNote,
          },
        );
        setAlertOutcome(result.result?.outcome ?? "UNKNOWN");
      } catch (err) {
        setError(err instanceof Error ? err.message : "PHARMACY_ERROR");
      } finally {
        setBusy(false);
      }
    },
  };
}

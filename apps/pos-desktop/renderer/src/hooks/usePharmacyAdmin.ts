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

  return {
    busy,
    error,
    establishmentOutcome,
    profileOutcome,
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
  };
}

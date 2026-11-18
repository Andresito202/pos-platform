import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  PharmacyEstablishmentUpsertRequestSchema,
  PharmacyProfileUpsertRequestSchema,
  PharmacyPrescriptionRegisterRequestSchema,
  SaleCreateRequestSchema,
  SaleCreateOutcomeSchema,
  IpcMessageTypeSchema,
} from "../src/index.js";

const base = {
  protocol_version: "1.0.0" as const,
  payload_schema_version: "1.0.0" as const,
  request_id: randomUUID(),
  correlation_id: randomUUID(),
  operation_id: randomUUID(),
  idempotency_key: randomUUID(),
};

describe("prompt-6 pharmacy contracts", () => {
  it("accepts establishment/profile/prescription envelopes and sale pharmacy outcomes", () => {
    expect(PharmacyEstablishmentUpsertRequestSchema.parse({
      ...base,
      message_type: "pharmacy.establishment.upsert",
      payload: {
        establishment_type: "DROGUERIA",
        authorized_otc: true,
        authorized_prescription: true,
        authorized_controlled_special: false,
        controlled_authorization_status: "NONE",
        controlled_authorization_note: null,
        technical_director_attribution: "Regente",
      },
    }).payload.establishment_type).toBe("DROGUERIA");

    expect(PharmacyProfileUpsertRequestSchema.parse({
      ...base,
      message_type: "pharmacy.profile.upsert",
      payload: {
        product_id: randomUUID(),
        product_kind: "MEDICINE",
        commercial_name: "Demo",
        generic_name: "Demo",
        active_ingredients: ["Demo"],
        concentration_text: "10 mg",
        pharmaceutical_form: "TABLETA",
        manufacturer: "Lab",
        sanitary_holder: "Titular",
        sanitary_registration: "INVIMA-1",
        registration_verification_status: "VERIFIED_MANUAL",
        dispensation_category: "PRESCRIPTION",
        requires_prescription: true,
        controlled_special: false,
        storage_condition: "AMBIENT",
        requires_lot_tracking: true,
        requires_expiry: true,
        regulatory_review_at: "2026-09-01",
      },
    }).payload.dispensation_category).toBe("PRESCRIPTION");

    expect(PharmacyPrescriptionRegisterRequestSchema.parse({
      ...base,
      message_type: "pharmacy.prescription.register",
      payload: {
        product_id: randomUUID(),
        prescribed_quantity: "2.000000",
        prescribed_at: "2026-09-01T00:00:00.000Z",
        expires_at: "2026-09-30T00:00:00.000Z",
        issuer_professional_id: "MP-1",
        issuer_name: "Dr Demo",
        patient_reference: "PAC-1",
      },
    }).payload.patient_reference).toBe("PAC-1");

    expect(SaleCreateOutcomeSchema.options).toContain("PHARMACY_CONTROLLED_BLOCKED");
    expect(IpcMessageTypeSchema.options).toContain("pharmacy.profile.upsert");
  });

  it("allows optional pharmacy prescription on sale lines", () => {
    const parsed = SaleCreateRequestSchema.parse({
      ...base,
      message_type: "sale.create",
      payload: {
        cash_register_id: null,
        channel: "POS_COUNTER",
        business_date: "2026-09-07",
        timezone_id: "America/Bogota",
        utc_offset_minutes: -300,
        document_series: "A",
        currency_code: "COP",
        pharmacy_professional_competence_code: null,
        lines: [{
          product_id: randomUUID(),
          presentation_id: randomUUID(),
          quantity: "1.000000",
          pharmacy_prescription_id: randomUUID(),
        }],
      },
    });
    expect(parsed.payload.lines[0]?.pharmacy_prescription_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

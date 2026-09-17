import { describe, expect, it } from "vitest";
import { QrPaymentObservationSchema, QrStaticDestinationSchema } from "@pos-platform/contracts";

describe("QR payment contracts", () => {
  it("accepts a static QR destination without treating it as payment evidence", () => {
    const result = QrStaticDestinationSchema.safeParse({
      provider_code: "BANK_QR",
      display_name: "Cuenta principal",
      qr_image_data_url: "data:image/svg+xml;base64,PHN2Zy8+",
      destination_reference: "ACCOUNT-001",
      active: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts provider evidence with optional payer identity", () => {
    const result = QrPaymentObservationSchema.safeParse({
      external_transaction_id: "tx-001",
      external_reference: "sale-ref",
      provider_code: "BANK_QR",
      status: "APPROVED",
      amount: "87500.000000",
      currency_code: "COP",
      payer_display_name: "Cliente verificado",
      payer_reference: "payer-001",
      observed_at: "2026-09-17T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a caller-provided payer identity when the observation is malformed", () => {
    const result = QrPaymentObservationSchema.safeParse({
      external_transaction_id: "tx-001",
      external_reference: null,
      provider_code: "BANK_QR",
      status: "APPROVED",
      amount: "87500",
      currency_code: "COP",
      payer_display_name: "Cliente",
      payer_reference: null,
      observed_at: "2026-09-17T12:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

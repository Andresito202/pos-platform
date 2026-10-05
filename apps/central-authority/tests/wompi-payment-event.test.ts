import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWompiTransactionEvent } from "../src/wompi-payment-event.js";

function signedEvent(secret: string) {
  const event = {
    event: "transaction.updated",
    data: {
      transaction: {
        id: "tx-001",
        reference: "POS-001",
        amount_in_cents: 8750000,
        currency: "COP",
        status: "APPROVED",
        customer_email: "cliente@example.com",
      },
    },
    environment: "test",
    signature: {
      properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
      checksum: "",
    },
    timestamp: 1_758_111_111,
  };
  const material = `tx-001APPROVED8750000${event.timestamp}${secret}`;
  event.signature.checksum = createHash("sha256").update(material).digest("hex");
  return event;
}

describe("Wompi transaction event verification", () => {
  it("authenticates and normalizes an approved transaction", () => {
    const result = verifyWompiTransactionEvent(signedEvent("test-secret"), "test-secret");
    expect(result.provider_code).toBe("WOMPI");
    expect(result.status).toBe("APPROVED");
    expect(result.amount).toBe("87500.000000");
    expect(result.payer_reference).toBe("cliente@example.com");
    expect(result.payer_display_name).toBeNull();
  });

  it("rejects a forged checksum", () => {
    const event = signedEvent("test-secret");
    event.signature.checksum = "0".repeat(64);
    expect(() => verifyWompiTransactionEvent(event, "test-secret")).toThrow("WOMPI_INVALID_CHECKSUM");
  });

  it("does not invent payer names when the provider only supplies email", () => {
    const result = verifyWompiTransactionEvent(signedEvent("test-secret"), "test-secret");
    expect(result.payer_display_name).toBeNull();
  });
});

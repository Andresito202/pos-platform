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

  it("rejects relocation of the signed tuple into an attacker-selected property",()=>{
    const event=signedEvent("test-secret");
    Object.assign(event.data,{attacker:"tx-001APPROVED8750000"});
    event.signature.properties=["attacker"];
    event.data.transaction.id="forged-transaction";
    event.data.transaction.amount_in_cents=100;
    expect(()=>verifyWompiTransactionEvent(event,"test-secret")).toThrow("WOMPI_INVALID_SIGNATURE_PROPERTIES");
  });

  it("uses the supplied supported property order rather than a fixed array order",()=>{
    const event=signedEvent("test-secret");
    event.signature.properties=["transaction.amount_in_cents","transaction.status","transaction.id"];
    event.signature.checksum=createHash("sha256").update(`8750000APPROVEDtx-001${event.timestamp}test-secret`).digest("hex");
    expect(verifyWompiTransactionEvent(event,"test-secret").status).toBe("APPROVED");
  });

  it("rejects ambiguous adjacent amount/ID tuples even with an unchanged valid checksum",()=>{
    const event=signedEvent("test-secret");
    event.signature.properties=["transaction.amount_in_cents","transaction.id","transaction.status"];
    event.signature.checksum=createHash("sha256").update(`8750000tx-001APPROVED${event.timestamp}test-secret`).digest("hex");
    event.data.transaction.amount_in_cents=875000;
    event.data.transaction.id="0tx-001";
    expect(()=>verifyWompiTransactionEvent(event,"test-secret")).toThrow("WOMPI_INVALID_SIGNATURE_PROPERTIES");
  });

  it("rejects missing, duplicate and unsupported signature selectors",()=>{
    for(const properties of [[],["transaction.id"],["transaction.id","transaction.status","transaction.status"],
      ["transaction.id","transaction.status","transaction.amount_in_cents","attacker"],["constructor","__proto__","transaction.id"]]){
      const event=signedEvent("test-secret");event.signature.properties=properties;
      expect(()=>verifyWompiTransactionEvent(event,"test-secret")).toThrow("WOMPI_INVALID_SIGNATURE_PROPERTIES");
    }
  });

  it("preserves documented states and rejects altered core values or an unreviewed delimiter",()=>{
    for(const status of ["APPROVED","DECLINED","ERROR","VOIDED","PENDING"]){
      const event=signedEvent("test-secret");event.data.transaction.status=status;
      event.signature.checksum=createHash("sha256").update(`tx-001${status}8750000${event.timestamp}test-secret`).digest("hex");
      expect(verifyWompiTransactionEvent(event,"test-secret").status).toBe(status==="APPROVED"?"APPROVED":status==="PENDING"?"PENDING":"DECLINED");
    }
    for(const mutation of [{id:"other"},{amount_in_cents:100},{status:"DECLINED"}]){
      const event=signedEvent("test-secret");Object.assign(event.data.transaction,mutation);
      expect(()=>verifyWompiTransactionEvent(event,"test-secret")).toThrow("WOMPI_INVALID_CHECKSUM");
    }
    const event=signedEvent("test-secret");event.data.transaction.status="ROVED";
    expect(()=>verifyWompiTransactionEvent(event,"test-secret")).toThrow("WOMPI_INVALID_STATUS");
  });

  it("does not invent payer names when the provider only supplies email", () => {
    const result = verifyWompiTransactionEvent(signedEvent("test-secret"), "test-secret");
    expect(result.payer_display_name).toBeNull();
  });
});

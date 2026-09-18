import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WompiPaymentProvider } from "./wompi-payment-provider.js";

const credentials = {
  checkout: { publicKey: "pub_test_1", integritySecret: "int_secret_1" },
  events: { eventsSecret: "events_secret_1" },
};

const intent = {
  paymentId: "payment-1",
  saleId: "sale-1",
  tenantId: "tenant-1",
  branchId: "branch-1",
  cashRegisterId: "register-1",
  amount: "24900.000000",
  currencyCode: "COP" as const,
  idempotencyKey: "qr-intent-1",
};

describe("WompiPaymentProvider", () => {
  it("creates a checkout intent that propagates the idempotency key as the provider reference, without calling the Wompi API", async () => {
    const provider = new WompiPaymentProvider(credentials, {
      fetchImpl: async () => {
        throw new Error("createPaymentIntent must not perform network calls");
      },
    });

    const result = await provider.createPaymentIntent(intent);

    expect(result.status).toBe("PENDING");
    expect(result.providerReference).toBe("qr-intent-1");
    expect(result.checkout?.kind).toBe("WEB_URL");
    expect(result.checkout?.url).toContain("reference=qr-intent-1");
  });

  it("queries the real Wompi transaction endpoint for getPaymentStatus", async () => {
    let requestedUrl: string | undefined;
    const provider = new WompiPaymentProvider(credentials, {
      fetchImpl: (async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({
            data: {
              id: "wompi-txn-1",
              reference: "qr-intent-1",
              status: "APPROVED",
              amount_in_cents: 2490000,
              currency: "COP",
            },
          }),
          { status: 200 },
        );
      }) as typeof fetch,
      clock: () => "2026-09-18T12:00:00.000Z",
    });

    const evidence = await provider.getPaymentStatus({ providerReference: "wompi-txn-1" });

    expect(requestedUrl).toBe("https://production.wompi.co/v1/transactions/wompi-txn-1");
    expect(evidence).toEqual({
      providerCode: "WOMPI",
      providerReference: "qr-intent-1",
      providerTransactionId: "wompi-txn-1",
      amount: "24900.000000",
      currencyCode: "COP",
      status: "APPROVED",
      receivedAt: "2026-09-18T12:00:00.000Z",
    });
  });

  it("normalizes a verified transaction.updated webhook through normalizeNotification", async () => {
    const timestamp = 1530291411;
    const checksum = createHash("sha256")
      .update("wompi-txn-1APPROVED2490000" + String(timestamp) + credentials.events.eventsSecret, "utf8")
      .digest("hex");

    const provider = new WompiPaymentProvider(credentials, {
      clock: () => "2026-09-18T12:00:00.000Z",
    });

    const evidence = await provider.normalizeNotification({
      event: "transaction.updated",
      data: {
        transaction: {
          id: "wompi-txn-1",
          reference: "qr-intent-1",
          status: "APPROVED",
          amount_in_cents: 2490000,
          currency: "COP",
        },
      },
      sent_at: "2026-09-18T12:00:00.000Z",
      timestamp,
      signature: {
        properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
        checksum,
      },
    });

    expect(evidence.status).toBe("APPROVED");
    expect(evidence.providerTransactionId).toBe("wompi-txn-1");
  });

  it("rejects a webhook with an invalid checksum instead of producing evidence", async () => {
    const provider = new WompiPaymentProvider(credentials);

    await expect(
      provider.normalizeNotification({
        event: "transaction.updated",
        data: {
          transaction: {
            id: "wompi-txn-1",
            reference: "qr-intent-1",
            status: "APPROVED",
            amount_in_cents: 2490000,
            currency: "COP",
          },
        },
        sent_at: "2026-09-18T12:00:00.000Z",
        timestamp: 1530291411,
        signature: {
          properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
          checksum: "0".repeat(64),
        },
      }),
    ).rejects.toThrow("checksum");
  });
});

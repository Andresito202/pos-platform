import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WompiPaymentProvider } from "./wompi-payment-provider.js";
import { WompiHttpError, WompiTransactionNotFoundError } from "./wompi-http-client.js";

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
  // Deliberately unlike `merchantReference`: the adapter must never reach for
  // this value (`DEC-016` §21).
  idempotencyKey: "caller-chosen-key-1",
  merchantReference: "payment-1",
};

describe("WompiPaymentProvider", () => {
  it("checks out against the merchant reference the caller decided, never the idempotency key, without calling the Wompi API", async () => {
    const provider = new WompiPaymentProvider(credentials, {
      fetchImpl: async () => {
        throw new Error("createPaymentIntent must not perform network calls");
      },
    });

    const result = await provider.createPaymentIntent(intent);

    expect(result.status).toBe("PENDING");
    expect(result.merchantReference).toBe("payment-1");
    expect(result.checkout?.kind).toBe("WEB_URL");
    expect(result.checkout?.url).toContain("reference=payment-1");
    expect(result.checkout?.url).not.toContain("caller-chosen-key-1");
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
              reference: "payment-1",
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

    const outcome = await provider.getPaymentStatus({ providerTransactionId: "wompi-txn-1" });

    expect(requestedUrl).toBe("https://production.wompi.co/v1/transactions/wompi-txn-1");
    expect(outcome).toEqual({
      kind: "EVIDENCE",
      evidence: {
        providerCode: "WOMPI",
        providerReference: "payment-1",
        providerTransactionId: "wompi-txn-1",
        amount: "24900.000000",
        currencyCode: "COP",
        status: "APPROVED",
        receivedAt: "2026-09-18T12:00:00.000Z",
      },
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

    expect(evidence.kind === "EVIDENCE" && evidence.evidence.status).toBe("APPROVED");
    expect(evidence.kind === "EVIDENCE" && evidence.evidence.providerTransactionId).toBe("wompi-txn-1");
  });

  it("rejects a webhook with an invalid checksum instead of producing evidence", async () => {
    const provider = new WompiPaymentProvider(credentials);

    await expect(
      provider.normalizeNotification({
        event: "transaction.updated",
        data: {
          transaction: {
            id: "wompi-txn-1",
            reference: "payment-1",
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

/**
 * `D-3` / `DEC-016` §6 rule 1. A query we could not get answered is
 * `UNKNOWN`, never `REJECTED`: absence of evidence of approval is not
 * evidence of rejection, and a POS that inferred refusal from its own
 * timeout would tell a customer their paid transaction failed.
 */
describe("WompiPaymentProvider technical failures", () => {
  function providerWith(fetchImpl: typeof fetch, timeoutMs?: number) {
    return new WompiPaymentProvider(credentials, {
      fetchImpl,
      clock: () => "2026-09-18T12:00:00.000Z",
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  }

  it("reports a timeout as UNKNOWN", async () => {
    const provider = providerWith(
      ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        })) as typeof fetch,
      5,
    );

    await expect(provider.getPaymentStatus({ providerTransactionId: "txn-1" }))
      .resolves.toEqual({ kind: "UNKNOWN", reason: "TIMEOUT" });
  });

  it("reports a network failure as UNKNOWN", async () => {
    const provider = providerWith((async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch);

    await expect(provider.getPaymentStatus({ providerTransactionId: "txn-1" }))
      .resolves.toEqual({ kind: "UNKNOWN", reason: "NETWORK" });
  });

  it("reports a provider 5xx as UNKNOWN", async () => {
    const provider = providerWith((async () => new Response("upstream down", { status: 503 })) as typeof fetch);

    await expect(provider.getPaymentStatus({ providerTransactionId: "txn-1" }))
      .resolves.toEqual({ kind: "UNKNOWN", reason: "PROVIDER_UNAVAILABLE" });
  });

  it("reports an unreadable provider response as UNKNOWN", async () => {
    const provider = providerWith((async () => new Response("<html>nope</html>", { status: 200 })) as typeof fetch);

    await expect(provider.getPaymentStatus({ providerTransactionId: "txn-1" }))
      .resolves.toEqual({ kind: "UNKNOWN", reason: "MALFORMED_RESPONSE" });
  });

  /**
   * The carve-out that keeps `UNKNOWN` meaningful: a rejected credential is
   * a broken deployment, not a payment whose result is pending discovery. If
   * it were folded in, every payment would read merely uncertain while the
   * real fault stayed invisible.
   */
  it("does not disguise a credential rejection as UNKNOWN", async () => {
    const provider = providerWith((async () => new Response("unauthorized", { status: 401 })) as typeof fetch);

    await expect(provider.getPaymentStatus({ providerTransactionId: "txn-1" }))
      .rejects.toThrow(WompiHttpError);
  });

  /**
   * The line `uncertaintyFor` draws inside `WompiHttpError`. A throttled
   * query is the provider declining to answer right now, so the payment's
   * result is genuinely undetermined; a forbidden one is this deployment
   * asking with credentials it should not have. Folding them together would
   * make a permissions fault read as a payment pending discovery.
   */
  it("reports a throttled query (429) as UNKNOWN, not as a verdict", async () => {
    const provider = providerWith((async () => new Response("slow down", { status: 429 })) as typeof fetch);

    const outcome = await provider.getPaymentStatus({ providerTransactionId: "txn-1" });

    expect(outcome).toEqual({ kind: "UNKNOWN", reason: "PROVIDER_UNAVAILABLE" });
    expect(outcome.kind).not.toBe("EVIDENCE");
  });

  it("does not disguise a forbidden query (403) as UNKNOWN", async () => {
    const provider = providerWith((async () => new Response("forbidden", { status: 403 })) as typeof fetch);

    const error = await provider.getPaymentStatus({ providerTransactionId: "txn-1" })
      .then(() => null, (cause: unknown) => cause);

    expect(error).toBeInstanceOf(WompiHttpError);
    expect((error as WompiHttpError).status).toBe(403);
  });

  it("does not disguise an unrecognised transaction id as UNKNOWN", async () => {
    const provider = providerWith((async () => new Response("not found", { status: 404 })) as typeof fetch);

    await expect(provider.getPaymentStatus({ providerTransactionId: "txn-1" }))
      .rejects.toThrow(WompiTransactionNotFoundError);
  });
});

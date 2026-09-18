import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WompiWebhookMalformedError,
  WompiWebhookSignatureInvalidError,
  WompiWebhookUnsupportedEventError,
  normalizeWompiTransactionUpdatedEvent,
  verifyWompiWebhookChecksum,
} from "./wompi-webhook-verifier.js";

const eventsCredentials = { eventsSecret: "test_events_secret_abc" };

// Checksum computed independently (node -e, sha256 of
// "txn-1APPROVED2490000" + "1530291411" + eventsSecret) to avoid the test
// validating the implementation against itself.
const VALID_CHECKSUM = "20e9967e49ccb353e9be2e3396bfda689d5eba75fdffc7f82a291259d10f1caa";

function validEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    event: "transaction.updated",
    data: {
      transaction: {
        id: "txn-1",
        reference: "order-249",
        status: "APPROVED",
        amount_in_cents: 2490000,
        currency: "COP",
      },
    },
    sent_at: "2018-07-20T16:45:05.000Z",
    timestamp: 1530291411,
    signature: {
      properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
      checksum: VALID_CHECKSUM,
    },
    ...overrides,
  };
}

describe("verifyWompiWebhookChecksum", () => {
  it("accepts a checksum computed with the documented recipe", () => {
    const envelope = validEnvelope() as Parameters<typeof verifyWompiWebhookChecksum>[0];
    expect(verifyWompiWebhookChecksum(envelope, eventsCredentials)).toBe(true);
  });

  it("rejects a tampered checksum", () => {
    const envelope = validEnvelope({
      signature: {
        properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
        checksum: "f".repeat(64),
      },
    }) as Parameters<typeof verifyWompiWebhookChecksum>[0];
    expect(verifyWompiWebhookChecksum(envelope, eventsCredentials)).toBe(false);
  });
});

describe("normalizeWompiTransactionUpdatedEvent", () => {
  it("normalizes a valid, correctly signed transaction.updated event into evidence", async () => {
    const evidence = await normalizeWompiTransactionUpdatedEvent(
      validEnvelope(),
      eventsCredentials,
      "2026-09-18T12:00:00.000Z",
    );

    expect(evidence).toEqual({
      providerCode: "WOMPI",
      providerReference: "order-249",
      providerTransactionId: "txn-1",
      amount: "24900.000000",
      currencyCode: "COP",
      status: "APPROVED",
      receivedAt: "2026-09-18T12:00:00.000Z",
    });
  });

  it("normalizes a pending transaction.updated event", async () => {
    // The checksum recipe signs `transaction.status`, so a different status
    // needs its own checksum; only the mapping is under test here.
    const pendingChecksum = createHash("sha256")
      .update("txn-1PENDING2490000" + "1530291411" + eventsCredentials.eventsSecret, "utf8")
      .digest("hex");

    const evidence = await normalizeWompiTransactionUpdatedEvent(
      validEnvelope({
        data: {
          transaction: {
            id: "txn-1",
            reference: "order-249",
            status: "PENDING",
            amount_in_cents: 2490000,
            currency: "COP",
          },
        },
        signature: {
          properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
          checksum: pendingChecksum,
        },
      }),
      eventsCredentials,
      "2026-09-18T12:00:00.000Z",
    );

    expect(evidence.status).toBe("PENDING");
  });

  it("rejects an event whose checksum does not match its signed properties", async () => {
    const envelope = validEnvelope({
      signature: {
        properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
        checksum: "f".repeat(64),
      },
    });

    await expect(normalizeWompiTransactionUpdatedEvent(envelope, eventsCredentials))
      .rejects.toBeInstanceOf(WompiWebhookSignatureInvalidError);
  });

  it("rejects an event whose signed data was tampered with after signing", async () => {
    const envelope = validEnvelope({
      data: {
        transaction: {
          id: "txn-1",
          reference: "order-249",
          status: "APPROVED",
          amount_in_cents: 999999999,
          currency: "COP",
        },
      },
    });

    await expect(normalizeWompiTransactionUpdatedEvent(envelope, eventsCredentials))
      .rejects.toBeInstanceOf(WompiWebhookSignatureInvalidError);
  });

  it("rejects an event type other than transaction.updated", async () => {
    const envelope = validEnvelope({ event: "transaction.created" });
    await expect(normalizeWompiTransactionUpdatedEvent(envelope, eventsCredentials))
      .rejects.toBeInstanceOf(WompiWebhookUnsupportedEventError);
  });

  it("rejects a malformed payload", async () => {
    await expect(normalizeWompiTransactionUpdatedEvent({ nonsense: true }, eventsCredentials))
      .rejects.toBeInstanceOf(WompiWebhookMalformedError);
  });

  it("rejects a payload missing a signed property", async () => {
    const envelope = validEnvelope({
      signature: {
        properties: ["transaction.id", "transaction.nonexistent_field"],
        checksum: VALID_CHECKSUM,
      },
    });

    await expect(normalizeWompiTransactionUpdatedEvent(envelope, eventsCredentials))
      .rejects.toBeInstanceOf(WompiWebhookMalformedError);
  });

  it("produces identical evidence for a repeated delivery of the same event (no duplication risk from re-normalizing)", async () => {
    const first = await normalizeWompiTransactionUpdatedEvent(
      validEnvelope(),
      eventsCredentials,
      "2026-09-18T12:00:00.000Z",
    );
    const second = await normalizeWompiTransactionUpdatedEvent(
      validEnvelope(),
      eventsCredentials,
      "2026-09-18T12:00:00.000Z",
    );
    expect(first).toEqual(second);
  });
});

import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { QrPaymentObservation } from "@pos-platform/contracts";
import {
  createFactusPayWebhookHandler,
  FACTUS_PAY_COLLECTION_WEBHOOK_PATH,
  type FactusPayWebhookInbox,
} from "../src/factus-pay-webhook-handler.js";

const key = "factus-pay-webhook-test-key-0123456789";
const payload = {
  data: { reference_code: "FACT-00123", amount: 150000, status: "paid" },
};

let server: Server | undefined;
let endpoint = "";

async function start(inbox: FactusPayWebhookInbox, maxBodyBytes = 16 * 1024) {
  server = createServer(createFactusPayWebhookHandler({
    expectedKey: key,
    inbox,
    maxBodyBytes,
    now: () => new Date("2026-10-17T14:00:00.000Z"),
  }));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind TCP port");
  endpoint = "http://127.0.0.1:" + address.port;
}

afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
  endpoint = "";
});

function inbox(
  persist: (observation: QrPaymentObservation, idempotencyKey: string) => Promise<"STORED" | "DUPLICATE">,
): FactusPayWebhookInbox {
  return { persistVerifiedObservation: persist };
}

describe("Factus Pay HTTP webhook handler", () => {
  it("acks only after the durable inbox adapter resolves", async () => {
    let release!: () => void;
    let stored = false;
    const persistenceGate = new Promise<"STORED">((resolve) => { release = () => resolve("STORED"); });
    await start(inbox(async (observation, idempotencyKey) => {
      expect(observation.external_transaction_id).toBe("FACT-00123");
      expect(idempotencyKey).toBe("FACTUS_PAY:FACT-00123");
      const result = await persistenceGate;
      stored = true;
      return result;
    }));
    const pending = fetch(endpoint + FACTUS_PAY_COLLECTION_WEBHOOK_PATH + "?key=" + encodeURIComponent(key), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stored).toBe(false);
    release();
    const response = await pending;
    expect(response.status).toBe(204);
    expect(stored).toBe(true);
  });

  it("returns 503 if durable persistence fails so the provider can retry", async () => {
    await start(inbox(async () => { throw new Error("database unavailable"); }));
    const response = await fetch(endpoint + FACTUS_PAY_COLLECTION_WEBHOOK_PATH + "?key=" + encodeURIComponent(key), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(503);
  });

  it("rejects missing or duplicated secret query parameters", async () => {
    await start(inbox(async () => "STORED"));
    const missing = await fetch(endpoint + FACTUS_PAY_COLLECTION_WEBHOOK_PATH, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    const duplicate = await fetch(endpoint + FACTUS_PAY_COLLECTION_WEBHOOK_PATH + "?key=" + key + "&key=" + key, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    expect(missing.status).toBe(401);
    expect(duplicate.status).toBe(401);
  });

  it("rejects wrong path, method, content type, malformed JSON, and oversized bodies", async () => {
    await start(inbox(async () => "STORED"), 64);
    const base = endpoint + FACTUS_PAY_COLLECTION_WEBHOOK_PATH + "?key=" + encodeURIComponent(key);
    const wrongPath = await fetch(endpoint + "/wrong?key=" + key, { method: "POST" });
    const wrongMethod = await fetch(base, { method: "GET" });
    const wrongType = await fetch(base, { method: "POST", body: JSON.stringify(payload) });
    const malformed = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    const tooLarge = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    expect(wrongPath.status).toBe(404);
    expect(wrongMethod.status).toBe(405);
    expect(wrongType.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(tooLarge.status).toBe(413);
  });
});

import { describe, expect, it } from "vitest";
import { FactusPayClient } from "../src/payments/factus-pay-client.js";
import { FactusPayCredentialStore } from "../src/payments/factus-pay-credential-store.js";
import { EncryptedFileSecretStore } from "../src/security/encrypted-secret-store.js";
import { InsecureDerivedKeyProvider } from "../src/security/insecure-derived-key-provider.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COMPANY = "018f0000-0000-7000-8000-000000000002";
const INSTALLATION = "018f0000-0000-7000-8000-000000000005";
const DEVICE = "018f0000-0000-7000-8000-000000000004";

describe("FactusPayClient", () => {
  it("authenticates once and creates then gets a paid collection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factus-pay-client-"));
    try {
      const secrets = new EncryptedFileSecretStore(
        dir,
        new InsecureDerivedKeyProvider(dir),
        `factus-pay-test:${INSTALLATION}:${DEVICE}:${COMPANY}`,
      );
      const store = new FactusPayCredentialStore(secrets, COMPANY);
      store.deposit({ environment: "SANDBOX", email: "cashier@test.invalid", password: "secret-password" });

      let authCalls = 0;
      const collections = new Map<string, Record<string, unknown>>();
      const transport: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith("/auth")) {
          authCalls += 1;
          expect(init?.method).toBe("POST");
          return new Response(JSON.stringify({ token: "TEST_TOKEN" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/v1/collections") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          collections.set(String(body.reference_code), {
            reference_code: body.reference_code,
            amount: body.amount,
            status: "ready",
            qr: "data:image/png;base64,AAAA",
          });
          return new Response(JSON.stringify({
            status: "success",
            data: collections.get(String(body.reference_code)),
          }), { status: 201, headers: { "content-type": "application/json" } });
        }
        const reference = decodeURIComponent(url.split("/").pop() ?? "");
        const row = collections.get(reference) ?? { reference_code: reference, amount: "150000", status: "paid" };
        return new Response(JSON.stringify({ status: "success", data: row }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const client = new FactusPayClient(store, "SANDBOX", () => new Date(), transport);
      const reference = "POS-TESTREF123456789";
      const created = await client.createCollection({
        referenceCode: reference,
        amountScale6: "150000.000000",
        expirationSeconds: 900,
      });
      expect(created.status).toBe("ready");
      expect(created.qr).toContain("data:image/png");

      collections.set(reference, { ...collections.get(reference)!, status: "paid" });
      const verified = await client.getCollection({
        referenceCode: reference,
        expectedAmountScale6: "150000.000000",
      });
      expect(verified.status).toBe("paid");
      await client.getCollection({
        referenceCode: reference,
        expectedAmountScale6: "150000.000000",
      });
      expect(authCalls).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
import { describe, expect, it } from "vitest";
import { FactusPayClient, FactusPayClientError } from "../src/payments/factus-pay-client.js";
import { FactusPayCredentialStore } from "../src/payments/factus-pay-credential-store.js";
import { EncryptedFileSecretStore } from "../src/security/encrypted-secret-store.js";
import { InsecureDerivedKeyProvider } from "../src/security/insecure-derived-key-provider.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COMPANY = "018f0000-0000-7000-8000-000000000002";
const OTHER_COMPANY = "018f0000-0000-7000-8000-000000000099";
const INSTALLATION = "018f0000-0000-7000-8000-000000000005";
const DEVICE = "018f0000-0000-7000-8000-000000000004";

async function openStore(companyId = COMPANY): Promise<{
  dir: string;
  secrets: EncryptedFileSecretStore;
  store: FactusPayCredentialStore;
}> {
  const dir = await mkdtemp(join(tmpdir(), "factus-pay-client-"));
  const secrets = new EncryptedFileSecretStore(
    dir,
    new InsecureDerivedKeyProvider(dir),
    `factus-pay-test:${INSTALLATION}:${DEVICE}:${companyId}`,
  );
  const store = new FactusPayCredentialStore(secrets, companyId);
  store.deposit({ environment: "SANDBOX", email: "cashier@test.invalid", password: "secret-password" });
  return { dir, secrets, store };
}

describe("FactusPayClient", () => {
  it("authenticates once and creates then gets a paid collection", async () => {
    const { dir, secrets, store } = await openStore();
    try {
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
        const row = collections.get(reference);
        if (row === undefined) {
          return new Response("missing", { status: 404 });
        }
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
      secrets.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("invalidates cached token on HTTP 401 and re-authenticates once", async () => {
    const { dir, secrets, store } = await openStore();
    try {
      let authCalls = 0;
      let getCalls = 0;
      const transport: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith("/auth")) {
          authCalls += 1;
          return new Response(JSON.stringify({ token: "TOKEN_FRESH" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        getCalls += 1;
        const auth = new Headers(init?.headers).get("authorization");
        if (auth === "Bearer TOKEN_STALE") {
          return new Response("unauthorized", { status: 401 });
        }
        expect(auth).toBe("Bearer TOKEN_FRESH");
        return new Response(JSON.stringify({
          status: "success",
          data: {
            reference_code: "POS-REF401",
            amount: "1000",
            status: "ready",
            qr: "data:image/png;base64,QQ==",
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      };

      const client = new FactusPayClient(store, "SANDBOX", () => new Date(), transport);
      store.writeCachedToken("SANDBOX", "TOKEN_STALE");
      const detail = await client.getCollection({
        referenceCode: "POS-REF401",
        expectedAmountScale6: "1000.000000",
      });
      expect(detail.status).toBe("ready");
      expect(authCalls).toBe(1);
      expect(getCalls).toBe(2);
      expect(store.readCachedToken("SANDBOX")).toBe("TOKEN_FRESH");
    } finally {
      secrets.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not loop on repeated HTTP 401 after one re-auth", async () => {
    const { dir, secrets, store } = await openStore();
    try {
      let authCalls = 0;
      let getCalls = 0;
      const transport: typeof fetch = async (input) => {
        const url = String(input);
        if (url.endsWith("/auth")) {
          authCalls += 1;
          return new Response(JSON.stringify({ token: `T${authCalls}` }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        getCalls += 1;
        return new Response("unauthorized", { status: 401 });
      };

      const client = new FactusPayClient(store, "SANDBOX", () => new Date(), transport);
      await expect(client.getCollection({
        referenceCode: "POS-REF401LOOP",
        expectedAmountScale6: "1000.000000",
      })).rejects.toMatchObject({ code: "FACTUS_PAY_UNAUTHORIZED" } satisfies Partial<FactusPayClientError>);
      expect(authCalls).toBe(2);
      expect(getCalls).toBe(2);
      expect(store.readCachedToken("SANDBOX")).toBeNull();
    } finally {
      secrets.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("recoverOrCreateCollection GETs first and POSTs only on NOT_FOUND", async () => {
    const { dir, secrets, store } = await openStore();
    try {
      const collections = new Map<string, Record<string, unknown>>();
      let posts = 0;
      let gets = 0;
      const transport: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith("/auth")) {
          return new Response(JSON.stringify({ token: "T" }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/v1/collections") && init?.method === "POST") {
          posts += 1;
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          const row = {
            reference_code: body.reference_code,
            amount: body.amount,
            status: "ready",
            qr: "data:image/png;base64,QQ==",
          };
          collections.set(String(body.reference_code), row);
          return new Response(JSON.stringify({ status: "success", data: row }), {
            status: 201, headers: { "content-type": "application/json" },
          });
        }
        gets += 1;
        const reference = decodeURIComponent(url.split("/").pop() ?? "");
        const row = collections.get(reference);
        if (row === undefined) return new Response("missing", { status: 404 });
        return new Response(JSON.stringify({ status: "success", data: row }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      };

      const client = new FactusPayClient(store, "SANDBOX", () => new Date(), transport);
      const reference = "POS-RECOVER1";
      const first = await client.recoverOrCreateCollection({
        referenceCode: reference,
        amountScale6: "5000.000000",
        expirationSeconds: 600,
      });
      expect(first.status).toBe("ready");
      expect(posts).toBe(1);
      // Outer GET (miss) + inner create GET (miss) before POST.
      expect(gets).toBe(2);

      const second = await client.recoverOrCreateCollection({
        referenceCode: reference,
        amountScale6: "5000.000000",
        expirationSeconds: 600,
      });
      expect(second.referenceCode).toBe(reference);
      expect(posts).toBe(1);
      expect(gets).toBe(3);
    } finally {
      secrets.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("recoverOrCreateCollection does not POST when GET fails with uncertain transport error", async () => {
    const { dir, secrets, store } = await openStore();
    try {
      let posts = 0;
      const transport: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith("/auth")) {
          return new Response(JSON.stringify({ token: "T" }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        }
        if (init?.method === "POST" && url.endsWith("/v1/collections")) {
          posts += 1;
          throw new Error("should not POST");
        }
        return new Response("boom", { status: 503, headers: { "content-type": "application/json" } });
      };
      const client = new FactusPayClient(store, "SANDBOX", () => new Date(), transport);
      await expect(client.recoverOrCreateCollection({
        referenceCode: "POS-UNCERTAIN",
        amountScale6: "100.000000",
        expirationSeconds: 60,
      })).rejects.toMatchObject({ code: "FACTUS_PAY_RESPONSE_REJECTED" });
      expect(posts).toBe(0);
    } finally {
      secrets.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects amount mismatch on GET", async () => {
    const { dir, secrets, store } = await openStore();
    try {
      const transport: typeof fetch = async (input) => {
        const url = String(input);
        if (url.endsWith("/auth")) {
          return new Response(JSON.stringify({ token: "T" }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({
          status: "success",
          data: { reference_code: "POS-AMT", amount: "999", status: "paid" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      };
      const client = new FactusPayClient(store, "SANDBOX", () => new Date(), transport);
      await expect(client.getCollection({
        referenceCode: "POS-AMT",
        expectedAmountScale6: "1000.000000",
      })).rejects.toMatchObject({ code: "FACTUS_PAY_AMOUNT_MISMATCH" });
    } finally {
      secrets.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("isolates credentials by company id", async () => {
    const { dir, secrets, store } = await openStore(COMPANY);
    try {
      const other = new FactusPayCredentialStore(secrets, OTHER_COMPANY);
      expect(() => other.resolveLogin("SANDBOX")).toThrow();
      expect(store.resolveLogin("SANDBOX").email).toBe("cashier@test.invalid");
    } finally {
      secrets.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

import { generateKeyPairSync } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createDeviceRequestAuthorization } from "@pos-platform/device-trust";
import {
  BUSINESS_SSA_DEVICE_PROOF_PATH,
  PostgresDeviceProofReplayVerifier,
} from "../src/device-proof-replay-verifier.js";

const keys = generateKeyPairSync("ed25519");
const NOW = new Date("2026-10-20T10:00:00.000Z");
const CREDENTIAL = "018f0000-0000-7000-8000-0000000000a1";
const DEVICE = "018f0000-0000-7000-8000-0000000000a2";
const INSTALL = "018f0000-0000-7000-8000-0000000000a3";
const TENANT = "018f0000-0000-7000-8000-0000000000a4";
const COMPANY = "018f0000-0000-7000-8000-0000000000a5";
const REQUEST = "018f0000-0000-7000-8000-0000000000a6";
const CORRELATION = "018f0000-0000-7000-8000-0000000000a7";
const BODY = '{"action":"issue"}';
const row = {
  credential_id: CREDENTIAL, device_id: DEVICE, installation_id: INSTALL,
  tenant_id: TENANT, company_id: COMPANY,
  device_public_key: Buffer.from(keys.publicKey.export({ format: "pem", type: "spki" }) as string, "utf8"),
  credential_expires_at: new Date("2026-10-20T11:00:00.000Z"),
};
function signed(body=BODY, key=keys.privateKey, requestId=REQUEST) {
  const authorization = createDeviceRequestAuthorization({
    method: "POST", path: BUSINESS_SSA_DEVICE_PROOF_PATH,
    requestId, correlationId: CORRELATION, credentialId: CREDENTIAL, body,
  }, key, NOW);
  return { authorization, requestId, correlationId: CORRELATION, body };
}
function fixture(config: { row?: typeof row | null; consumed?: boolean; throwOnInsert?: boolean } = {}) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes("FROM identity.device_credentials AS dc"))
      return { rows: config.row === null ? [] : [config.row ?? row] };
    if (sql.includes("INSERT INTO identity.device_request_proof_replays")) {
      if (config.throwOnInsert) throw new Error("REPLAY_DB_FAILURE");
      return { rows: config.consumed === false ? [] : [{ credential_id: CREDENTIAL }] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const pool = { connect } as unknown as Pool;
  return { query, connect, release, verifier: new PostgresDeviceProofReplayVerifier(pool, () => NOW) };
}
function commands(query: ReturnType<typeof fixture>["query"]): string[] {
  return query.mock.calls.map(([sql]) => sql);
}

describe("central durable Ed25519 device proof (not business login)", () => {
  it("verifies the persisted device key, consumes the signed nonce, then returns only DB-derived device scope", async () => {
    const { verifier, query, release } = fixture();
    const result = await verifier.verifyAndConsume(signed());
    expect(result).toEqual({
      deviceId: DEVICE, installationId: INSTALL, tenantId: TENANT,
      companyId: COMPANY, credentialId: CREDENTIAL,
      credentialExpiresAt: "2026-10-20T11:00:00.000Z",
      requestId: REQUEST, correlationId: CORRELATION,
    });
    const sql = commands(query);
    expect(sql[0]).toBe("BEGIN");
    expect(sql[1]).toContain("FOR SHARE OF dc, d");
    expect(query.mock.calls[1]?.[1]).toEqual([CREDENTIAL]);
    expect(sql[2]).toContain("ON CONFLICT DO NOTHING");
    expect(query.mock.calls[2]?.[1]?.[2]).toBe(REQUEST);
    expect(sql.at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects tampering with the raw body without ever inserting a nonce", async () => {
    const { verifier, query, release } = fixture();
    expect(await verifier.verifyAndConsume({ ...signed(), body: '{"action":"revoke"}' })).toBeNull();
    expect(commands(query).some(x=>x.includes("INSERT INTO identity.device_request_proof_replays"))).toBe(false);
    expect(commands(query).at(-1)).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects another private key even if the credential ID is valid", async () => {
    const outsider = generateKeyPairSync("ed25519");
    const { verifier, query } = fixture();
    expect(await verifier.verifyAndConsume(signed(BODY, outsider.privateKey))).toBeNull();
    expect(commands(query)).not.toContainEqual(expect.stringContaining("INSERT INTO identity.device_request_proof_replays"));
  });

  it("does not claim device proof for unknown, revoked or expired credentials", async () => {
    for (const dbRow of [null, { ...row, credential_expires_at: "invalid" as unknown as Date }]) {
      const { verifier, query } = fixture({ row: dbRow });
      expect(await verifier.verifyAndConsume(signed())).toBeNull();
      expect(commands(query).at(-1)).toBe("ROLLBACK");
    }
  });

  it("refuses consumed nonces and request IDs without issuing a trusted scope", async () => {
    const { verifier, query, release } = fixture({ consumed: false });
    expect(await verifier.verifyAndConsume(signed())).toBeNull();
    expect(commands(query).at(-1)).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("uses a distinct HTTP endpoint, time and request identity as Ed25519 signature inputs", async () => {
    const { verifier, query } = fixture();
    const altered = { ...signed(), requestId: "018f0000-0000-7000-8000-0000000000b1" };
    expect(await verifier.verifyAndConsume(altered)).toBeNull();
    expect(commands(query)).not.toContainEqual(expect.stringContaining("INSERT INTO identity.device_request_proof_replays"));
  });

  it("fails closed and releases the connection on database failure", async () => {
    const { verifier, query, release } = fixture({ throwOnInsert: true });
    await expect(verifier.verifyAndConsume(signed())).rejects.toThrow("REPLAY_DB_FAILURE");
    expect(commands(query).at(-1)).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects malformed signed authorization before borrowing a database connection", async () => {
    const { verifier, connect } = fixture();
    expect(await verifier.verifyAndConsume({ ...signed(), authorization: "Bearer fake" })).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });
});

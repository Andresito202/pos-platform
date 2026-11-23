import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresPool, PostgresScmCheckpointRepository, PostgresScmDeviceProofVerifier, type Pool } from "@pos-platform/database-postgres";
import { createDeviceRequestAuthorization } from "@pos-platform/device-trust";
import { windowsScmCheckpointSigningBytes, type WindowsScmHandoffProvision, type WindowsScmPolicyTrust } from "@pos-platform/contracts";
import { windowsScmPolicySigningBytes } from "@pos-platform/local-channel";
import { ScmCentralCheckpointGuard } from "../src/channel/scm-central-checkpoint.js";

const serverUrl = process.env.SCM_TEST_SERVER_URL;
const id = () => { const value = randomUUID(); return value.slice(0, 14) + "7" + value.slice(15); };
// Fresh disposable DB only; actual existing 004/012 and new 034 SQL. This
// isolates the new chain and never reruns the previously approved suites.
describe.runIf(Boolean(serverUrl))("SCM PostgreSQL -> authenticated HTTPS -> SERVICE", () => {
  const database = "test_scm_" + randomUUID().replaceAll("-", "");
  let admin: Pool, root: Pool, runtime: Pool, repository: PostgresScmCheckpointRepository;
  let listener: ReturnType<typeof createServer>, origin: string, created = false;
  const device = id(), installation = id(), credential = id(), tenant = id(), company = id();
  const deviceKeys = generateKeyPairSync("ed25519"), authority = generateKeyPairSync("ed25519");
  const publicPem = authority.publicKey.export({ type: "spki", format: "pem" }).toString();
  const pin = createHash("sha256").update(authority.publicKey.export({ type: "spki", format: "der" })).digest("hex");
  const service = { role: "SERVICE", signer_private_file: "C:\\managed\\signer", signer_spki_sha256: "f".repeat(64), handoff: { installation_id: installation, device_id: device, revision: 1, poll_ms: 100, policy_reference: "SCM_INTEGRATION_TEST_ONLY" } } as WindowsScmHandoffProvision;
  const candidate = Buffer.from(JSON.stringify({ service }));
  const checkpoint: WindowsScmPolicyTrust = { profile: "CAMACHO_SCM_POLICY_TRUST_V1", service_id: "CamachoPOSLocalService", installation_id: installation, device_id: device, not_before: new Date(Date.now() - 60000).toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString(), trust_revision: 1, authority_public_key_pem: publicPem, authority_spki_sha256: pin, current_policy_revision: 1, current_candidate_sha256: createHash("sha256").update(candidate).digest("hex"), revoked_policy_ids: [], revoked_authority_pins: [] };
  const envelope = (value = checkpoint) => ({ checkpoint: value, signature: sign(null, windowsScmCheckpointSigningBytes(value), authority.privateKey).toString("base64url") });
  const policy = { profile: "CAMACHO_SCM_PROVISION_POLICY_V1" as const, service_id: checkpoint.service_id, installation_id: installation, device_id: device, not_before: checkpoint.not_before, expires_at: checkpoint.expires_at, policy_id: id(), trust_revision: 1, policy_revision: 1, authority_spki_sha256: pin, action: "RECOVER_CANDIDATE" as const, candidate_sha256: checkpoint.current_candidate_sha256, previous_candidate_sha256: null, policy_reference: service.handoff.policy_reference };
  beforeAll(async () => {
    const url = new URL(serverUrl!);
    if (url.hostname !== "127.0.0.1" || ["", "5432", "55433"].includes(url.port) || url.pathname !== "/postgres") throw Error("SCM_DISPOSABLE_TEST_SERVER_REQUIRED");
    admin = createPostgresPool(url.href);
    for (const role of ["pos_schema_owner", "pos_migrator", "pos_platform_app", "pos_app", "pos_worker", "pos_reporting", "pos_platform_admin"]) {
      if (!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rowCount) await admin.query(`CREATE ROLE ${role} ${role === "pos_platform_app" ? "LOGIN" : "NOLOGIN"} NOSUPERUSER NOBYPASSRLS`);
    }
    await admin.query(`CREATE DATABASE "${database}" OWNER pos_schema_owner`); created = true;
    url.pathname = "/" + database; root = createPostgresPool(url.href, 1);
    await root.query("CREATE SCHEMA platform AUTHORIZATION pos_schema_owner; CREATE SCHEMA identity AUTHORIZATION pos_schema_owner; GRANT USAGE ON SCHEMA platform,identity TO pos_platform_app");
    await root.query("SET ROLE pos_schema_owner");
    const sql = (name: string) => readFileSync(new URL(`../../../tools/target-migrations/sql/postgres/${name}`, import.meta.url), "utf8");
    await root.query(sql("bootstrap.sql")); await root.query(sql("004_device_trust.up.sql")); await root.query(sql("012_device_request_proof_replays.up.sql")); await root.query(sql("034_scm_checkpoints.up.sql"));
    await root.query("RESET ROLE");
    await root.query("INSERT INTO identity.device_registry(device_id,installation_id,tenant_id,company_id,device_key_id,device_public_key,device_public_key_algorithm,status,trust_key_id,trust_key_purpose,created_at,updated_at) VALUES($1,$2,$3,$4,'TEST_DEVICE',$5,'Ed25519','ACTIVE','TEST_TRUST','DEVICE_TRUST',now(),now())", [device, installation, tenant, company, Buffer.from(deviceKeys.publicKey.export({ type: "spki", format: "pem" }))]);
    await root.query("INSERT INTO identity.device_credentials(credential_id,device_id,installation_id,tenant_id,company_id,device_key_id,trust_key_id,key_purpose,status,generation,issued_at,expires_at,credential_checksum,issuer_signature,created_at) VALUES($1,$2,$3,$4,$5,'TEST_DEVICE','TEST_TRUST','DEVICE_TRUST','ACTIVE',1,now()-interval '1 minute',now()+interval '1 hour',$6,$7,now())", [credential, device, installation, tenant, company, "a".repeat(64), Buffer.alloc(64)]);
    url.username = "pos_platform_app"; url.password = ""; runtime = createPostgresPool(url.href);
    repository = new PostgresScmCheckpointRepository(runtime); await repository.publish(envelope());
    const { createScmCheckpointHandler } = await import(new URL("../../central-authority/src/scm-checkpoint-http.ts", import.meta.url).href);
    listener = createServer({ key: readFileSync(process.env.SCM_TEST_TLS_KEY!), cert: readFileSync(process.env.SCM_TEST_TLS_CERT!) }, createScmCheckpointHandler(new PostgresScmDeviceProofVerifier(runtime), repository));
    await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
    const address = listener.address(); if (!address || typeof address === "string") throw Error("NO_ADDRESS"); origin = `https://127.0.0.1:${address.port}`;
  }, 30000);
  afterAll(async () => {
    if (listener) { listener.closeAllConnections(); await new Promise<void>(resolve => listener.close(() => resolve())); }
    await runtime?.end(); await root?.end();
    if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin?.end();
  });
  const proof = (requestId: string, correlationId: string, path = "/v1/scm/checkpoint") => createDeviceRequestAuthorization({ method: "POST", path, requestId, correlationId, body: "{}", credentialId: credential }, deviceKeys.privateKey);
  it("serves a signed persisted checkpoint, rejects replay and wrong-route proof", async () => {
    const requestId = id(), correlationId = id();
    const headers = { authorization: proof(requestId, correlationId), "content-type": "application/json", "x-request-id": requestId, "x-correlation-id": correlationId };
    const response = await fetch(origin + "/v1/scm/checkpoint", { method: "POST", headers, body: "{}" });
    expect(response.status).toBe(200); expect(await response.json()).toEqual(envelope());
    expect((await fetch(origin + "/v1/scm/checkpoint", { method: "POST", headers, body: "{}" })).status).toBe(401);
    headers.authorization = proof(requestId, correlationId, "/v1/business-session/assertions");
    expect((await fetch(origin + "/v1/scm/checkpoint", { method: "POST", headers, body: "{}" })).status).toBe(401);
  });
  it("publishes once under concurrent replay and retains append-only SQL grants", async () => {
    await Promise.all([repository.publish(envelope()), repository.publish(envelope())]);
    expect((await root.query("SELECT count(*)::int AS count FROM platform.scm_checkpoints")).rows[0].count).toBe(1);
    await expect(runtime.query("DELETE FROM platform.scm_checkpoints")).rejects.toThrow();
    await expect(root.query("TRUNCATE platform.scm_checkpoints")).rejects.toThrow("SCM_CHECKPOINT_HISTORY_IMMUTABLE");
    expect((await new PostgresScmCheckpointRepository(runtime).latest(installation, device))).toEqual(envelope());
    expect(await repository.latest(installation, id())).toBeNull();
    await expect(repository.publish(envelope({ ...checkpoint, trust_revision: 3 }))).rejects.toThrow("SCM_CHECKPOINT_TRANSITION_REJECTED");
  });
  it("SERVICE consumes live HTTPS authority and persists revocation before closing", async () => {
    let stored: Buffer | undefined;
    const store = { has: () => stored !== undefined, read: () => Buffer.from(stored!), write: (_key: string, bytes: Buffer) => { stored = Buffer.from(bytes); } };
    const guard = new ScmCentralCheckpointGuard({ origin, root_public_key_pem: publicPem, root_spki_sha256: pin, candidate_file: "C:\\test\\candidate", policy: { policy, signature: sign(null, windowsScmPolicySigningBytes(policy), authority.privateKey).toString("base64url") } }, service, { authorization: async context => proof(context!.requestId, context!.correlationId) }, store, () => Buffer.from(candidate));
    try {
      let revoked!: () => void; const closed = new Promise<void>(resolve => { revoked = resolve; });
      await guard.start(revoked); expect(() => guard.assertCurrent()).not.toThrow();
      await repository.publish(envelope({ ...checkpoint, trust_revision: 2, revoked_policy_ids: [policy.policy_id] }));
      await Promise.race([closed, new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(Error("REVOCATION_NOT_PROPAGATED")), 10000); timer.unref(); })]);
      expect(() => guard.assertCurrent()).toThrow(); expect(JSON.parse(stored!.toString()).checkpoint.trust_revision).toBe(2);
      await expect(repository.publish(envelope())).rejects.toThrow("SCM_CHECKPOINT_TRANSITION_REJECTED");
    } finally { await guard.stop(); }
  }, 12000);
});

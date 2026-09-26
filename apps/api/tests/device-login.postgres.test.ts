import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  unsignedDeviceTrustChallengeBytes,
  unsignedDeviceTrustCredentialBytes,
} from "@pos-platform/device-trust";
import {
  DeviceTrustCredentialClaimsSchema,
  type DeviceTrustChallenge,
} from "@pos-platform/contracts";
import { hashPassword } from "../src/authentication/password-hasher.js";
import { createApi } from "../src/app.js";

/**
 * Login end-to-end real (`DEC-026` §13.7, primer tramo con ruta HTTP): un
 * equipo se prueba a sí mismo con una clave de dispositivo real, el servidor
 * deriva el `tenant_id` del registro central —nunca del cuerpo de la
 * petición— y sólo entonces se intenta la contraseña.
 *
 * El esquema lo prepara `@pos-platform/target-migrations` en un proceso
 * aparte, igual que `tenant-login.postgres.test.ts`.
 */

const SERVER_URL = process.env.POSTGRES_TEST_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";
const DATABASE = "api_device_login";
const url = (): string => {
  const value = new URL(SERVER_URL);
  value.pathname = `/${DATABASE}`;
  return value.toString();
};

const ROOT = generateKeyPairSync("ed25519");
const OPERATIONAL = generateKeyPairSync("ed25519");
const OPERATIONAL_KEY_ID = "DEVICE-TRUST-TEST-01";
const DEVICE = generateKeyPairSync("ed25519");

const TENANT = "018f0000-0000-7000-8000-00000000b101";
const COMPANY = "018f0000-0000-7000-8000-00000000b102";
const INSTALLATION = "018f0000-0000-7000-8000-00000000b103";
const DEVICE_ID = "018f0000-0000-7000-8000-00000000b104";
const CASHIER_MEMBERSHIP = "018f0000-0000-7000-8000-00000000b105";
const CASHIER_USER = "018f0000-0000-7000-8000-00000000b106";
const CREDENTIAL_ID = "018f0000-0000-7000-8000-00000000b107";
const T0 = new Date("2026-09-26T12:00:00.000Z");
const PASSWORD = "caballo correcto grapa pila";

function prepareSchema(): void {
  const script = `(async () => {
    const { readFile } = await import("node:fs/promises");
    const { default: pg } = await import("pg");
    const { applyPostgres001, applyPostgres002 } = await import("./src/postgres.js");
    const adminUrl = process.env.TARGET_URL;
    await applyPostgres001({ adminUrl });
    await applyPostgres002({ adminUrl, skipSmoke: true });
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    for (const file of ["sql/postgres/004_device_trust.up.sql", "sql/postgres/005_identity_login.up.sql"]) {
      await client.query("SET ROLE pos_schema_owner");
      await client.query(await readFile(file, "utf8"));
      await client.query("RESET ROLE");
    }
    await client.end();
  })().catch((error) => { console.error(error); process.exit(1); });`;
  const run = spawnSync("pnpm", ["--filter", "@pos-platform/target-migrations", "exec", "tsx", "--eval", script], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    env: { ...process.env, TARGET_URL: url() },
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`schema preparation failed:\n${run.stderr}\n${run.stdout}`);
}

async function inject(app: NestFastifyApplication, path: string, payload: unknown) {
  const response = await app.getHttpAdapter().getInstance().inject({
    method: "POST", url: path, headers: { "content-type": "application/json" }, payload: JSON.stringify(payload),
  });
  return { statusCode: response.statusCode, body: response.json() as { result_code: string; result: unknown } };
}

function signedDeviceCredential() {
  const claims = DeviceTrustCredentialClaimsSchema.parse({
    credential_id: CREDENTIAL_ID,
    key_id: OPERATIONAL_KEY_ID,
    tenant_id: TENANT,
    company_id: COMPANY,
    installation_id: INSTALLATION,
    device_id: DEVICE_ID,
    device_public_key_pem: DEVICE.publicKey.export({ type: "spki", format: "pem" }).toString(),
    issued_at: "2026-09-01T00:00:00.000Z",
    not_before: "2026-09-01T00:00:00.000Z",
    expires_at: null,
    version: 1,
  });
  return { claims, signature: sign(null, unsignedDeviceTrustCredentialBytes(claims), OPERATIONAL.privateKey).toString("base64url") };
}

function signedProof(credentialId: string, keyId: string, challenge: DeviceTrustChallenge) {
  return {
    credential_id: credentialId,
    key_id: keyId,
    challenge_id: challenge.challenge_id,
    signature: sign(null, unsignedDeviceTrustChallengeBytes(challenge), DEVICE.privateKey).toString("base64url"),
  };
}

describe("login end-to-end — reto de equipo real + contraseña, sobre PostgreSQL real", () => {
  let admin: Client;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const server = new Client({ connectionString: SERVER_URL });
    await server.connect();
    await server.query(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`);
    await server.query(`CREATE DATABASE "${DATABASE}"`);
    await server.end();
    prepareSchema();

    admin = new Client({ connectionString: url() });
    await admin.connect();
    await admin.query(`INSERT INTO tenancy.tenants (id,name,status,created_at,updated_at) VALUES ($1,'Comercio','ACTIVE',$2,$2)`, [TENANT, T0]);
    await admin.query(
      `INSERT INTO identity.device_registry (device_id,installation_id,tenant_id,company_id,device_key_id,device_public_key,device_public_key_algorithm,status,trust_key_id,trust_key_purpose,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'DK-1',$5,'Ed25519','ACTIVE',$6,'DEVICE_TRUST',$7,$7)`,
      [DEVICE_ID, INSTALLATION, TENANT, COMPANY, DEVICE.publicKey.export({ type: "spki", format: "der" }), OPERATIONAL_KEY_ID, T0],
    );
    await admin.query(`INSERT INTO identity.users (id,full_name,status,created_at,updated_at) VALUES ($1,'Cajero',$2,$3,$3)`, [CASHIER_USER, "ACTIVE", T0]);
    await admin.query(
      `INSERT INTO tenancy.tenant_memberships (id,tenant_id,user_id,membership_type,status,created_by_actor_type,created_at,activated_at) VALUES ($1,$2,$3,'MEMBER','ACTIVE','SYSTEM',$4,$4)`,
      [CASHIER_MEMBERSHIP, TENANT, CASHIER_USER, T0],
    );
    await admin.query(
      `INSERT INTO identity.user_login_names (id,tenant_id,tenant_membership_id,user_id,login_name,login_name_normalized,status,created_at) VALUES ($1,$2,$3,$4,'Cajero1','cajero1','ACTIVE',$5)`,
      ["018f0000-0000-7000-8000-00000000b108", TENANT, CASHIER_MEMBERSHIP, CASHIER_USER, T0],
    );
    await admin.query(
      `INSERT INTO identity.user_credentials (id,user_id,credential_type,verifier,status,failed_attempt_count,must_change_at_next_login,created_at) VALUES ($1,$2,'PASSWORD',$3,'ACTIVE',0,false,$4)`,
      ["018f0000-0000-7000-8000-00000000b109", CASHIER_USER, await hashPassword(PASSWORD), T0],
    );
    const role = await admin.query(`INSERT INTO "authorization".roles (id,code,name,scope_type,version,status,created_at) VALUES ($1,'CASHIER','CASHIER','BUSINESS',1,'ACTIVE',$2) RETURNING id`, ["018f0000-0000-7000-8000-00000000b110", T0]);
    await admin.query(
      `INSERT INTO "authorization".user_role_assignments (id,tenant_id,tenant_membership_id,role_id,status,valid_from,created_at,created_by_actor_type) VALUES ($1,$2,$3,$4,'ACTIVE',$5,$5,'SYSTEM')`,
      ["018f0000-0000-7000-8000-00000000b111", TENANT, CASHIER_MEMBERSHIP, role.rows[0].id, T0],
    );

    process.env.CENTRAL_DATABASE_URL = url();
    process.env.DEVICE_TRUST_ROOT_PUBLIC_KEY_PEM = ROOT.publicKey.export({ type: "spki", format: "pem" }).toString();
    process.env.DEVICE_TRUST_OPERATIONAL_KEY_ID = OPERATIONAL_KEY_ID;
    process.env.DEVICE_TRUST_OPERATIONAL_PUBLIC_KEY_PEM = OPERATIONAL.publicKey.export({ type: "spki", format: "pem" }).toString();
    app = await createApi();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await admin?.end();
    const server = new Client({ connectionString: SERVER_URL });
    await server.connect();
    await server.query(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`);
    await server.end();
  });

  it("un equipo desconocido no recibe desafío", async () => {
    const response = await inject(app, "/v1/auth/device/challenge", { device_id: "018f0000-0000-7000-8000-00000000ffff" });
    expect(response.body).toEqual({ result_code: "UNKNOWN_DEVICE", result: null });
  });

  it("emite desafío, verifica la prueba de equipo y sólo entonces intenta la contraseña", async () => {
    const challengeResponse = await inject(app, "/v1/auth/device/challenge", { device_id: DEVICE_ID });
    expect(challengeResponse.body.result_code).toBe("ISSUED");
    const issued = challengeResponse.body.result as DeviceTrustChallenge;

    const credential = signedDeviceCredential();
    const challenge = issued;
    const proof = signedProof(CREDENTIAL_ID, OPERATIONAL_KEY_ID, challenge);

    const login = await inject(app, "/v1/auth/login", {
      device_credential: credential, challenge_id: issued.challenge_id, proof, login_name: "CAJERO1", password: PASSWORD,
    });
    expect(login.body.result_code).toBe("AUTHENTICATED");
    const result = login.body.result as { session_id: string; refresh_token: string };
    expect(result.session_id).toBeTruthy();
    expect(result.refresh_token).toBeTruthy();

    const session = (await admin.query(`SELECT tenant_id, user_id FROM identity.sessions WHERE id=$1`, [result.session_id])).rows[0];
    expect(session).toEqual({ tenant_id: TENANT, user_id: CASHIER_USER });
  }, 30_000);

  it("un desafío no puede reutilizarse: la segunda prueba con el mismo challenge_id se rechaza", async () => {
    const challengeResponse = await inject(app, "/v1/auth/device/challenge", { device_id: DEVICE_ID });
    const issued = challengeResponse.body.result as DeviceTrustChallenge;
    const credential = signedDeviceCredential();
    const challenge = issued;
    const proof = signedProof(CREDENTIAL_ID, OPERATIONAL_KEY_ID, challenge);
    const body = { device_credential: credential, challenge_id: issued.challenge_id, proof, login_name: "CAJERO1", password: PASSWORD };

    expect((await inject(app, "/v1/auth/login", body)).body.result_code).toBe("AUTHENTICATED");
    expect((await inject(app, "/v1/auth/login", body)).body.result_code).toBe("DEVICE_CHALLENGE_NOT_FOUND_OR_EXPIRED");
  }, 30_000);

  it("una prueba firmada con una clave de dispositivo distinta se rechaza", async () => {
    const impostor = generateKeyPairSync("ed25519");
    const challengeResponse = await inject(app, "/v1/auth/device/challenge", { device_id: DEVICE_ID });
    const issued = challengeResponse.body.result as DeviceTrustChallenge;
    const credential = signedDeviceCredential();
    const challenge = issued;
    const forgedProof = {
      credential_id: CREDENTIAL_ID, key_id: OPERATIONAL_KEY_ID, challenge_id: challenge.challenge_id,
      signature: sign(null, unsignedDeviceTrustChallengeBytes(challenge), impostor.privateKey).toString("base64url"),
    };
    const response = await inject(app, "/v1/auth/login", {
      device_credential: credential, challenge_id: issued.challenge_id, proof: forgedProof, login_name: "CAJERO1", password: PASSWORD,
    });
    expect(response.body.result_code).toBe("DEVICE_REJECTED");
  }, 30_000);

  it("una contraseña equivocada se rechaza sólo después de que el equipo verificó, no antes", async () => {
    const challengeResponse = await inject(app, "/v1/auth/device/challenge", { device_id: DEVICE_ID });
    const issued = challengeResponse.body.result as DeviceTrustChallenge;
    const credential = signedDeviceCredential();
    const challenge = issued;
    const proof = signedProof(CREDENTIAL_ID, OPERATIONAL_KEY_ID, challenge);
    const response = await inject(app, "/v1/auth/login", {
      device_credential: credential, challenge_id: issued.challenge_id, proof, login_name: "CAJERO1", password: "contraseña equivocada",
    });
    expect(response.body.result_code).toBe("REJECTED");
  }, 30_000);

  it("un cuerpo mal formado responde 400 sin tocar la base de datos", async () => {
    const response = await inject(app, "/v1/auth/login", { login_name: "x" });
    expect(response.statusCode).toBe(400);
  });
});

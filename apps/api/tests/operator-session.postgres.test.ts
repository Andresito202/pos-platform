import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  OperatorSessionProvisioningArtifactSchema,
  canonicalSessionTrustJson,
  type DeviceTrustChallenge,
  type OperatorSessionProvisioningArtifact,
} from "@pos-platform/contracts";
import { hashPassword } from "../src/authentication/password-hasher.js";
import { createApi } from "../src/app.js";

/**
 * Emisión de sesión local en el login (`DEC-026` §13.10), end-to-end por HTTP
 * real sobre PostgreSQL real: tras la prueba de equipo y la contraseña, el
 * servidor devuelve la SSA y el SAS firmados, ligados al equipo que se probó,
 * con los permisos que conceden los roles de la persona en ese instante.
 *
 * La firma se comprueba aquí con `node:crypto` sobre la canonicalización del
 * contrato —la misma que usa el POS—, no con el verificador del servicio
 * local: `apps/api` no importa de otra app. Que el POS acepte estos sobres lo
 * prueba la E2E de la ventana, que los activa de verdad.
 */

const SERVER_URL = process.env.POSTGRES_TEST_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";
const DATABASE = "api_operator_session";
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
const SESSION_KEY = generateKeyPairSync("ed25519");
const SNAPSHOT_KEY = generateKeyPairSync("ed25519");
const SUPERVISOR_ROLE = "018f0000-0000-7000-8000-00000000b120";
const CASHIER_ROLE = "018f0000-0000-7000-8000-00000000b110";
const PERMISSION_IDS = {
  SALES_SALE_CREATE: "018f0000-0000-7000-8000-00000000b131",
  CASH_SHIFT_OPEN: "018f0000-0000-7000-8000-00000000b132",
  INVENTORY_STOCK_ADJUST: "018f0000-0000-7000-8000-00000000b133",
  LEGACY_RETIRED: "018f0000-0000-7000-8000-00000000b134",
} as const;

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
    for (const file of ["sql/postgres/004_device_trust.up.sql", "sql/postgres/005_identity_login.up.sql", "sql/postgres/006_session_trust_sequence.up.sql"]) {
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



function signatureValid(claims: unknown, signature: string, key: KeyObject): boolean {
  return verify(null, Buffer.from(canonicalSessionTrustJson(claims)), key, Buffer.from(signature, "base64url"));
}

describe("login con emisión de sesión local — SSA + SAS firmados, sobre PostgreSQL real", () => {
  let admin: Client;
  let app: NestFastifyApplication;

  async function login(): Promise<{ session_id: string; operator_session: OperatorSessionProvisioningArtifact | null }> {
    const challengeResponse = await inject(app, "/v1/auth/device/challenge", { device_id: DEVICE_ID });
    const challenge = challengeResponse.body.result as DeviceTrustChallenge;
    const response = await inject(app, "/v1/auth/login", {
      device_credential: signedDeviceCredential(), challenge_id: challenge.challenge_id,
      proof: signedProof(CREDENTIAL_ID, OPERATIONAL_KEY_ID, challenge), login_name: "cajero1", password: PASSWORD,
    });
    expect(response.body.result_code).toBe("AUTHENTICATED");
    return response.body.result as { session_id: string; operator_session: OperatorSessionProvisioningArtifact | null };
  }

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
      `INSERT INTO organization.companies (id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at) VALUES ($1,$2,'Tienda','America/Bogota','COP','ACTIVE',$3,$3)`,
      [COMPANY, TENANT, T0],
    );
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
    for (const [code, id] of Object.entries(PERMISSION_IDS)) {
      const retired = code === "LEGACY_RETIRED";
      await admin.query(
        `INSERT INTO "authorization".permissions (id,code,module,description,status,created_at,retired_at) VALUES ($1,$2,'TEST',$2,$3,$4,$5)`,
        [id, code, retired ? "RETIRED" : "ACTIVE", T0, retired ? T0 : null],
      );
    }
    await admin.query(`INSERT INTO "authorization".roles (id,code,name,scope_type,version,status,created_at) VALUES ($1,'CASHIER','CASHIER','BUSINESS',1,'ACTIVE',$2)`, [CASHIER_ROLE, T0]);
    await admin.query(`INSERT INTO "authorization".roles (id,code,name,scope_type,version,status,created_at) VALUES ($1,'SUPERVISOR','SUPERVISOR','BUSINESS',1,'ACTIVE',$2)`, [SUPERVISOR_ROLE, T0]);
    let grant = 0;
    const grantPermission = async (role: string, permission: string, status = "ACTIVE", validUntil: Date | null = null) => {
      grant += 1;
      await admin.query(
        `INSERT INTO "authorization".role_permission_grants (id,role_id,permission_id,grant_version,status,valid_from,valid_until,created_at,retired_at) VALUES ($1,$2,$3,1,$4,$5,$6,$5,$7)`,
        [`018f0000-0000-7000-8000-${String(200000000000 + grant)}`, role, permission, status, T0, validUntil, status === "RETIRED" ? T0 : null],
      );
    };
    await grantPermission(CASHIER_ROLE, PERMISSION_IDS.SALES_SALE_CREATE);
    await grantPermission(CASHIER_ROLE, PERMISSION_IDS.CASH_SHIFT_OPEN);
    await grantPermission(CASHIER_ROLE, PERMISSION_IDS.LEGACY_RETIRED);
    // Concesión retirada: no debe aparecer como permiso.
    await grantPermission(SUPERVISOR_ROLE, PERMISSION_IDS.SALES_SALE_CREATE, "RETIRED");
    await grantPermission(SUPERVISOR_ROLE, PERMISSION_IDS.INVENTORY_STOCK_ADJUST);
    // Cajero en todo el comercio; supervisor sólo en la empresa.
    await admin.query(
      `INSERT INTO "authorization".user_role_assignments (id,tenant_id,tenant_membership_id,role_id,status,valid_from,created_at,created_by_actor_type) VALUES ($1,$2,$3,$4,'ACTIVE',$5,$5,'SYSTEM')`,
      ["018f0000-0000-7000-8000-00000000b111", TENANT, CASHIER_MEMBERSHIP, CASHIER_ROLE, T0],
    );
    await admin.query(
      `INSERT INTO "authorization".user_role_assignments (id,tenant_id,tenant_membership_id,role_id,company_id,status,valid_from,created_at,created_by_actor_type) VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$6,'SYSTEM')`,
      ["018f0000-0000-7000-8000-00000000b112", TENANT, CASHIER_MEMBERSHIP, SUPERVISOR_ROLE, COMPANY, T0],
    );

    const keys = mkdtempSync(join(tmpdir(), "api-session-keys-"));
    writeFileSync(join(keys, "ssa.pem"), SESSION_KEY.privateKey.export({ type: "pkcs8", format: "pem" }));
    writeFileSync(join(keys, "sas.pem"), SNAPSHOT_KEY.privateKey.export({ type: "pkcs8", format: "pem" }));
    process.env.CENTRAL_DATABASE_URL = url();
    process.env.DEVICE_TRUST_ROOT_PUBLIC_KEY_PEM = ROOT.publicKey.export({ type: "spki", format: "pem" }).toString();
    process.env.DEVICE_TRUST_OPERATIONAL_KEY_ID = OPERATIONAL_KEY_ID;
    process.env.DEVICE_TRUST_OPERATIONAL_PUBLIC_KEY_PEM = OPERATIONAL.publicKey.export({ type: "spki", format: "pem" }).toString();
    process.env.MFA_SECRET_ENCRYPTION_KEY_BASE64URL = randomBytes(32).toString("base64url");
    process.env.SESSION_ASSERTION_SIGNING_KEY_ID = "SSA-TEST-01";
    process.env.SESSION_ASSERTION_SIGNING_KEY_FILE = join(keys, "ssa.pem");
    process.env.AUTHORIZATION_SNAPSHOT_SIGNING_KEY_ID = "SAS-TEST-01";
    process.env.AUTHORIZATION_SNAPSHOT_SIGNING_KEY_FILE = join(keys, "sas.pem");
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

  it("devuelve SSA y SAS firmados, cada uno con su clave, ligados al equipo que se probó", async () => {
    const result = await login();
    const artifact = OperatorSessionProvisioningArtifactSchema.parse(result.operator_session);
    const ssa = artifact.session_assertion;
    const sas = artifact.authorization_snapshot;

    expect(signatureValid(ssa.claims, ssa.signature, SESSION_KEY.publicKey)).toBe(true);
    expect(signatureValid(sas.claims, sas.signature, SNAPSHOT_KEY.publicKey)).toBe(true);
    // Una clave por propósito: la de permisos no firma identidad ni al revés.
    expect(signatureValid(ssa.claims, ssa.signature, SNAPSHOT_KEY.publicKey)).toBe(false);
    expect(signatureValid(sas.claims, sas.signature, SESSION_KEY.publicKey)).toBe(false);
    expect(ssa.claims.key_id).toBe("SSA-TEST-01");
    expect(sas.claims.key_id).toBe("SAS-TEST-01");

    expect(ssa.claims).toMatchObject({
      session_id: result.session_id, user_id: CASHIER_USER, tenant_membership_id: CASHIER_MEMBERSHIP,
      installation_id: INSTALLATION, device_id: DEVICE_ID,
    });
    expect(sas.claims).toMatchObject({ user_id: CASHIER_USER, installation_id: INSTALLATION, device_id: DEVICE_ID });
    // Operador: 24 h de sesión = 24 h de SAS; la SSA no sobrevive al SAS.
    expect(Date.parse(ssa.claims.offline_valid_until) - Date.parse(ssa.claims.issued_at)).toBe(24 * 60 * 60 * 1000);
    expect(ssa.claims.offline_valid_until).toBe(sas.claims.expires_at);
  }, 30_000);

  it("el SAS proyecta los permisos vigentes de cada rol en su ámbito, y ninguno retirado como activo", async () => {
    const artifact = OperatorSessionProvisioningArtifactSchema.parse((await login()).operator_session);
    const assignments = artifact.authorization_snapshot.claims.assignments;
    expect(assignments.map((assignment) => [assignment.company_id, assignment.branch_id])).toEqual([[null, null], [COMPANY, null]]);
    expect(assignments[0]!.permissions).toEqual([
      { code: "CASH_SHIFT_OPEN", status: "ACTIVE" },
      { code: "LEGACY_RETIRED", status: "RETIRED" },
      { code: "SALES_SALE_CREATE", status: "ACTIVE" },
    ]);
    // La concesión RETIRADA de SALES_SALE_CREATE al supervisor no aparece.
    expect(assignments[1]!.permissions).toEqual([{ code: "INVENTORY_STOCK_ADJUST", status: "ACTIVE" }]);
    expect(assignments.every((assignment) => assignment.tenant_id === TENANT && assignment.status === "ACTIVE")).toBe(true);
  }, 30_000);

  it("la secuencia crece en cada login: el POS acepta la nueva y rechaza la vieja", async () => {
    const first = OperatorSessionProvisioningArtifactSchema.parse((await login()).operator_session);
    const second = OperatorSessionProvisioningArtifactSchema.parse((await login()).operator_session);
    expect(second.session_assertion.claims.sequence).toBeGreaterThan(first.session_assertion.claims.sequence);
    expect(second.authorization_snapshot.claims.sequence).toBeGreaterThan(first.authorization_snapshot.claims.sequence);
  }, 30_000);

  it("la sesión central queda ligada al equipo y con su vigencia offline", async () => {
    const result = await login();
    const artifact = OperatorSessionProvisioningArtifactSchema.parse(result.operator_session);
    const row = (await admin.query<{ device_id: string; offline_valid_until: Date }>(
      "SELECT device_id, offline_valid_until FROM identity.sessions WHERE id = $1", [result.session_id],
    )).rows[0]!;
    expect(row.device_id).toBe(DEVICE_ID);
    expect(row.offline_valid_until.toISOString()).toBe(artifact.session_assertion.claims.offline_valid_until);
  }, 30_000);

  it("una revocación de rol llega en el siguiente login: el SAS nuevo ya no lo trae", async () => {
    await admin.query(`UPDATE "authorization".user_role_assignments SET status='REVOKED', revoked_at=$2 WHERE id=$1`, ["018f0000-0000-7000-8000-00000000b112", new Date()]);
    try {
      const artifact = OperatorSessionProvisioningArtifactSchema.parse((await login()).operator_session);
      expect(artifact.authorization_snapshot.claims.assignments.map((assignment) => assignment.company_id)).toEqual([null]);
    } finally {
      await admin.query(`UPDATE "authorization".user_role_assignments SET status='ACTIVE', revoked_at=NULL WHERE id=$1`, ["018f0000-0000-7000-8000-00000000b112"]);
    }
  }, 30_000);
});

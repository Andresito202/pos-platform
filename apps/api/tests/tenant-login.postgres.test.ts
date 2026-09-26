import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/authentication/password-hasher.js";
import { PostgresTenantLoginStore } from "../src/authentication/postgres-tenant-login-store.js";
import { TenantLoginService, type TenantLoginOutcome } from "../src/authentication/tenant-login-service.js";

/**
 * Login por comercio (`DEC-026` `A-7`, `A-8`, `A-10`) contra PostgreSQL real,
 * con el esquema de 001 + 002 + 004 + 005 y **conectado como
 * `pos_platform_app`**, sin `BYPASSRLS`: permisos por columna y RLS de
 * membresías, asignaciones, sesiones y eventos se ejercen de verdad.
 *
 * El esquema lo prepara `@pos-platform/target-migrations` en un proceso
 * aparte, para no importar código de otro proyecto desde aquí.
 */

const SERVER_URL = process.env.POSTGRES_TEST_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";
const DATABASE = "api_tenant_login";
const url = (role?: string): string => {
  const value = new URL(SERVER_URL);
  value.pathname = `/${DATABASE}`;
  if (role) { value.username = role; value.password = ""; }
  return value.toString();
};

const T1 = "018f0000-0000-7000-8000-00000000a101";
const T2 = "018f0000-0000-7000-8000-00000000a102";
const T0 = new Date("2026-09-26T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const PASSWORD = "caballo correcto grapa pila";
let seq = 0;
const id = (): string => `018f0000-0000-7000-8000-${String(700000000000 + (seq += 1))}`;

function prepareSchema(): void {
  // `tsx --eval` compila como CommonJS: sin `await` de primer nivel.
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

interface Person { userId: string; membershipId: string; credentialId: string; }

async function seedPerson(admin: Client, tenantId: string, loginName: string, roleCode: string | null, options: { mustChange?: boolean; userStatus?: string } = {}): Promise<Person> {
  const person = { userId: id(), membershipId: id(), credentialId: id() };
  await admin.query(`INSERT INTO identity.users (id,full_name,status,created_at,updated_at) VALUES ($1,'Persona',$2,$3,$3)`, [person.userId, options.userStatus ?? "ACTIVE", T0]);
  await admin.query(`INSERT INTO tenancy.tenant_memberships (id,tenant_id,user_id,membership_type,status,created_by_actor_type,created_at,activated_at) VALUES ($1,$2,$3,'MEMBER','ACTIVE','SYSTEM',$4,$4)`, [person.membershipId, tenantId, person.userId, T0]);
  await admin.query(`INSERT INTO identity.user_login_names (id,tenant_id,tenant_membership_id,user_id,login_name,login_name_normalized,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7)`, [id(), tenantId, person.membershipId, person.userId, loginName, loginName.toLowerCase(), T0]);
  await admin.query(`INSERT INTO identity.user_credentials (id,user_id,credential_type,verifier,status,failed_attempt_count,must_change_at_next_login,created_at) VALUES ($1,$2,'PASSWORD',$3,'ACTIVE',0,$4,$5)`, [person.credentialId, person.userId, await hashPassword(PASSWORD), options.mustChange ?? false, T0]);
  if (roleCode !== null) {
    const role = (await admin.query<{ id: string }>(`SELECT id FROM "authorization".roles WHERE code=$1`, [roleCode])).rows[0];
    await admin.query(`INSERT INTO "authorization".user_role_assignments (id,tenant_id,tenant_membership_id,role_id,status,valid_from,created_at,created_by_actor_type) VALUES ($1,$2,$3,$4,'ACTIVE',$5,$5,'SYSTEM')`, [id(), tenantId, person.membershipId, role?.id, T0]);
  }
  return person;
}

describe("login por comercio — PostgreSQL real como pos_platform_app", () => {
  let admin: Client;
  let pool: Pool;
  let cashier: Person;
  const service = (now: Date) => new TenantLoginService(new PostgresTenantLoginStore(pool), () => now);
  const login = (now: Date, loginName: string, password = PASSWORD, tenantId = T1): Promise<TenantLoginOutcome> =>
    service(now).login({ tenantId, loginName, password, ipAddress: "203.0.113.7" });

  beforeAll(async () => {
    const server = new Client({ connectionString: SERVER_URL });
    await server.connect();
    await server.query(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`);
    await server.query(`CREATE DATABASE "${DATABASE}"`);
    await server.end();
    prepareSchema();

    admin = new Client({ connectionString: url() });
    await admin.connect();
    for (const tenant of [T1, T2]) await admin.query(`INSERT INTO tenancy.tenants (id,name,status,created_at,updated_at) VALUES ($1,'Comercio','ACTIVE',$2,$2)`, [tenant, T0]);
    for (const code of ["CASHIER", "SUPERVISOR", "GENERAL_ADMIN", "SUPPORT_AGENT"]) {
      await admin.query(`INSERT INTO "authorization".roles (id,code,name,scope_type,version,status,created_at) VALUES ($1,$2,$2,'BUSINESS',1,'ACTIVE',$3)`, [id(), code, T0]);
    }
    cashier = await seedPerson(admin, T1, "Cajero1", "CASHIER");
    pool = new Pool({ connectionString: url("pos_platform_app"), max: 4 });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    const server = new Client({ connectionString: SERVER_URL });
    await server.connect();
    await server.query(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`);
    await server.end();
  });

  it("un cajero con la contraseña correcta obtiene sesión de 24 h y sólo se guarda el hash del refresh", async () => {
    const outcome = await login(T0, "  CAJERO1 ");
    if (outcome.kind !== "AUTHENTICATED") throw new Error(`esperaba AUTHENTICATED y llegó ${outcome.kind}`);
    expect(outcome.sessionExpiresAt).toEqual(at(24 * 3_600_000));
    expect(outcome.refreshTokenExpiresAt).toEqual(outcome.sessionExpiresAt);

    const session = (await admin.query(`SELECT tenant_id, tenant_membership_id, expires_at FROM identity.sessions WHERE id=$1`, [outcome.sessionId])).rows[0];
    expect(session).toEqual({ tenant_id: T1, tenant_membership_id: cashier.membershipId, expires_at: at(24 * 3_600_000) });
    const tokens = (await admin.query(`SELECT token_hash FROM identity.session_refresh_tokens WHERE session_id=$1`, [outcome.sessionId])).rows;
    expect(tokens).toEqual([{ token_hash: createHash("sha256").update(outcome.refreshToken).digest("hex") }]);
    const events = (await admin.query(`SELECT event_code, tenant_id, host(ip_address) ip FROM identity.security_events WHERE session_id=$1`, [outcome.sessionId])).rows;
    expect(events).toEqual([{ event_code: "LOGIN_SUCCEEDED", tenant_id: T1, ip: "203.0.113.7" }]);
  }, 30_000);

  it("cuenta inexistente, otro comercio y contraseña errónea dan la misma respuesta", async () => {
    expect(await login(T0, "nadie")).toEqual({ kind: "REJECTED" });
    expect(await login(T0, "cajero1", PASSWORD, T2)).toEqual({ kind: "REJECTED" });
    const other = await seedPerson(admin, T1, "cajero-erroneo", "CASHIER");
    expect(await login(T0, "cajero-erroneo", "no es la contraseña")).toEqual({ kind: "REJECTED" });
    const row = (await admin.query(`SELECT failed_attempt_count, last_failed_at FROM identity.user_credentials WHERE id=$1`, [other.credentialId])).rows[0];
    expect(row).toEqual({ failed_attempt_count: 1, last_failed_at: T0 });
  }, 60_000);

  it("A-8: esperas tras el 3.º y 4.º fallo, bloqueo de 15 min al 5.º, y se levanta solo", async () => {
    await seedPerson(admin, T1, "bloqueable", "CASHIER");
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await login(T0, "bloqueable", "mala")).kind).toBe("REJECTED");
    // Durante la espera ni la contraseña correcta entra: no llega a verificarse.
    expect(await login(at(1_000), "bloqueable")).toEqual({ kind: "THROTTLED", retryAt: at(5_000) });
    expect((await login(at(5_000), "bloqueable", "mala")).kind).toBe("REJECTED");
    expect(await login(at(6_000), "bloqueable")).toEqual({ kind: "THROTTLED", retryAt: at(20_000) });
    expect((await login(at(20_000), "bloqueable", "mala")).kind).toBe("REJECTED");
    const until = at(20_000 + 15 * 60_000);
    expect(await login(at(21_000), "bloqueable")).toEqual({ kind: "THROTTLED", retryAt: until });
    expect((await login(until, "bloqueable")).kind).toBe("AUTHENTICATED");
  }, 120_000);

  it("dos intentos fallidos simultáneos cuentan dos: la credencial se bloquea por transacción", async () => {
    const racer = await seedPerson(admin, T1, "concurrente", "CASHIER");
    await Promise.all([login(T0, "concurrente", "mala-1"), login(T0, "concurrente", "mala-2")]);
    const row = (await admin.query(`SELECT failed_attempt_count FROM identity.user_credentials WHERE id=$1`, [racer.credentialId])).rows[0];
    expect(row).toEqual({ failed_attempt_count: 2 });
  }, 60_000);

  it("A-6: con contraseña temporal no se abre sesión", async () => {
    const temporary = await seedPerson(admin, T1, "nuevo", "CASHIER", { mustChange: true });
    expect(await login(T0, "nuevo")).toEqual({ kind: "PASSWORD_CHANGE_REQUIRED" });
    const sessions = await admin.query(`SELECT 1 FROM identity.sessions WHERE user_id=$1`, [temporary.userId]);
    expect(sessions.rowCount).toBe(0);
  }, 30_000);

  it("A-4: un rol de administración pide MFA, un rol no ratificado se rechaza, sin rol no entra", async () => {
    const manager = await seedPerson(admin, T1, "gerente", "GENERAL_ADMIN");
    await seedPerson(admin, T1, "soporte", "SUPPORT_AGENT");
    await seedPerson(admin, T1, "sinrol", null);
    expect(await login(T0, "gerente")).toEqual({ kind: "MFA_REQUIRED" });
    expect(await login(T0, "soporte")).toEqual({ kind: "ROLE_UNDECIDED" });
    expect(await login(T0, "sinrol")).toEqual({ kind: "NO_ACTIVE_ROLE" });
    const sessions = await admin.query(`SELECT 1 FROM identity.sessions WHERE user_id=$1`, [manager.userId]);
    expect(sessions.rowCount).toBe(0);
  }, 60_000);

  it("una persona inactiva no entra aunque la contraseña sea correcta", async () => {
    await seedPerson(admin, T1, "inactivo", "CASHIER", { userStatus: "INACTIVE" });
    expect(await login(T0, "inactivo")).toEqual({ kind: "REJECTED" });
  }, 30_000);
});

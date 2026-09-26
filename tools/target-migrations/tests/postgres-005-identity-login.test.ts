import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPostgres001, applyPostgres002 } from "../src/postgres.js";
import { readArtifact, sha256 } from "../src/shared.js";
import {
  IDENTITY_LOGIN_005_COLUMNS,
  IDENTITY_LOGIN_005_TABLES,
  POSTGRES_005_DESCRIPTOR,
} from "../src/postgres-005-contract.js";
import { POSTGRES_004_DESCRIPTOR } from "../src/postgres-004-contract.js";

/**
 * `005_identity_login` — `DEC-026` §13.3–§13.4, contra PostgreSQL real.
 *
 * Qué mide: el **SQL** de la 005 sobre el esquema de 001 + 004. Aplica 001 y
 * 002 con sus runners y 004/005 como `pos_schema_owner`, igual que harían sus
 * runners. **No** mide el runner de la 005: ese exige el ledger completo con
 * 003, cuya preparación de roles fija PostgreSQL 16.14 exacto
 * (`postgres-003-role-readiness.ts:226`); lo ejerce CI (`d3-live-security-e2e`).
 */

const SERVER_URL = process.env.POSTGRES_TEST_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";
const DATABASES = ["target_migration_005", "target_migration_005_down"] as const;

function databaseUrl(name: string): string {
  const url = new URL(SERVER_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

const T1 = "018f0000-0000-7000-8000-000000005001";
const T2 = "018f0000-0000-7000-8000-000000005002";
const U1 = "018f0000-0000-7000-8000-000000005011";
const U2 = "018f0000-0000-7000-8000-000000005012";
const M1 = "018f0000-0000-7000-8000-000000005021"; // T1, U1
const M2 = "018f0000-0000-7000-8000-000000005022"; // T2, U2
const M4 = "018f0000-0000-7000-8000-000000005024"; // T1, U2
const DEVICE = "018f0000-0000-7000-8000-000000005031";
const UNKNOWN_DEVICE = "018f0000-0000-7000-8000-000000005039";
const NOW = "2026-09-26T12:00:00Z";

let n = 0;
const id = (): string => `018f0000-0000-7000-8000-${String(900000000000 + (n += 1))}`;

async function prepare(name: string): Promise<Client> {
  const admin = new Pool({ connectionString: SERVER_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  await applyPostgres001({ adminUrl: databaseUrl(name) });
  await applyPostgres002({ adminUrl: databaseUrl(name), skipSmoke: true });
  // Conexión dedicada: `Pool.query` descarta el cliente cuando una consulta
  // falla y con él la transacción de prueba.
  const pool = new Client({ connectionString: databaseUrl(name) });
  await pool.connect();
  for (const artifact of [POSTGRES_004_DESCRIPTOR.upArtifact, POSTGRES_005_DESCRIPTOR.upArtifact]) {
    await pool.query("SET ROLE pos_schema_owner");
    await pool.query(await readArtifact(artifact));
    await pool.query("RESET ROLE");
  }
  return pool;
}

/** Devuelve el SQLSTATE con que PostgreSQL rechaza la sentencia, o `null` si la acepta. */
async function sqlState(pool: Client, text: string, values: unknown[] = []): Promise<string | null> {
  await pool.query("SAVEPOINT probe");
  try {
    await pool.query(text, values);
    await pool.query("RELEASE SAVEPOINT probe");
    return null;
  } catch (error) {
    await pool.query("ROLLBACK TO SAVEPOINT probe");
    return (error as { code?: string }).code ?? "UNKNOWN";
  }
}

const insertUser = (userId: string, email: string | null, normalized: string | null = email): [string, unknown[]] =>
  [`INSERT INTO identity.users (id,email,email_normalized,full_name,status,created_at,updated_at) VALUES ($1,$2,$3,'Persona','ACTIVE',$4,$4)`, [userId, email, normalized, NOW]];
const insertLoginName = (tenant: string, membership: string, user: string, name: string, normalized = name.toLowerCase()): [string, unknown[]] =>
  [`INSERT INTO identity.user_login_names (id,tenant_id,tenant_membership_id,user_id,login_name,login_name_normalized,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7)`, [id(), tenant, membership, user, name, normalized, NOW]];
const insertSession = (device: string | null): [string, unknown[]] =>
  [`INSERT INTO identity.sessions (id,user_id,authenticated_at,expires_at,mfa_status,created_at,device_id) VALUES ($1,$2,$3,$4,'NOT_REQUIRED',$3,$5)`, [id(), U1, NOW, "2026-09-27T12:00:00Z", device]];

describe("005_identity_login — descriptor", () => {
  it("depende exactamente de 004 y posee dos tablas nuevas", async () => {
    expect(POSTGRES_005_DESCRIPTOR.dependencies).toEqual(["004_device_trust"]);
    expect(POSTGRES_005_DESCRIPTOR.ownedTables).toEqual(IDENTITY_LOGIN_005_TABLES);
    const up = await readArtifact(POSTGRES_005_DESCRIPTOR.upArtifact);
    expect(sha256(up)).toHaveLength(32);
    for (const [table, columns] of Object.entries(IDENTITY_LOGIN_005_COLUMNS)) {
      for (const column of columns) expect(up, `${table}.${column}`).toContain(column);
    }
  });
});

describe("005_identity_login — PostgreSQL real", () => {
  let pool: Client;

  beforeAll(async () => {
    pool = await prepare("target_migration_005");
    // Datos semilla como superusuario: salta el RLS forzado de tenancy, que no es lo medido.
    await pool.query("BEGIN");
    for (const tenant of [T1, T2]) {
      await pool.query(`INSERT INTO tenancy.tenants (id,name,status,created_at,updated_at) VALUES ($1,'Comercio','ACTIVE',$2,$2)`, [tenant, NOW]);
    }
    await pool.query(...insertUser(U2, "admin@example.test"));
    await pool.query(`INSERT INTO identity.device_registry (device_id,installation_id,tenant_id,company_id,device_key_id,device_public_key,device_public_key_algorithm,status,trust_key_id,trust_key_purpose,created_at,updated_at) VALUES ($1,$2,$3,$4,'DK-1','\\x00','Ed25519','ACTIVE','TK-1','DEVICE_TRUST',$5,$5)`, [DEVICE, id(), T1, id(), NOW]);
  }, 120_000);

  afterAll(async () => {
    await pool?.query("ROLLBACK").catch(() => undefined);
    await pool?.end();
    const admin = new Pool({ connectionString: SERVER_URL });
    try { for (const name of DATABASES) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); } finally { await admin.end(); }
  });

  it("G-1: un usuario puede no tener correo, pero no medio correo", async () => {
    expect(await sqlState(pool, ...insertUser(U1, null))).toBeNull();
    expect(await sqlState(pool, ...insertUser(id(), "x@example.test", null))).toBe("23514");
  });

  it("G-2: el nombre de usuario es único por comercio y se puede repetir entre comercios", async () => {
    const membership = `INSERT INTO tenancy.tenant_memberships (id,tenant_id,user_id,membership_type,status,created_by_actor_type,created_at,activated_at) VALUES ($1,$2,$3,'MEMBER','ACTIVE','SYSTEM',$4,$4)`;
    await pool.query(membership, [M1, T1, U1, NOW]);
    await pool.query(membership, [M2, T2, U2, NOW]);
    await pool.query(membership, [M4, T1, U2, NOW]);

    expect(await sqlState(pool, ...insertLoginName(T1, M1, U1, "Cajero1"))).toBeNull();
    expect(await sqlState(pool, ...insertLoginName(T1, M4, U2, "CAJERO1"))).toBe("23505");
    expect(await sqlState(pool, ...insertLoginName(T2, M2, U2, "cajero1"))).toBeNull();
  });

  it("G-2: no puede nombrar a alguien en un comercio donde no es miembro", async () => {
    // M4 (T1, U2) aún no tiene nombre: así sólo puede saltar la clave foránea.
    expect(await sqlState(pool, ...insertLoginName(T2, M4, U2, "intruso"))).toBe("23503");
    expect(await sqlState(pool, ...insertLoginName(T1, M4, U1, "suplantado"))).toBe("23503");
  });

  it("G-2: la forma normalizada tiene que estar en minúsculas y sin espacios", async () => {
    expect(await sqlState(pool, ...insertLoginName(T1, M4, U2, "Otro", "Otro"))).toBe("23514");
  });

  it("G-3/G-4: marca de cambio obligatorio y hora del último fallo", async () => {
    const credential = `INSERT INTO identity.user_credentials (id,user_id,credential_type,verifier,status,failed_attempt_count,last_failed_at,created_at) VALUES ($1,$2,'PASSWORD','scrypt$x','ACTIVE',$3,$4,$5)`;
    expect(await sqlState(pool, credential, [id(), U2, 2, null, NOW])).toBe("23514");
    const credentialId = id();
    expect(await sqlState(pool, credential, [credentialId, U2, 2, NOW, NOW])).toBeNull();
    const row = await pool.query("SELECT must_change_at_next_login FROM identity.user_credentials WHERE id=$1", [credentialId]);
    expect(row.rows[0]?.must_change_at_next_login).toBe(false);
  });

  it("G-5: la sesión se ata a un equipo registrado, y sólo a uno registrado", async () => {
    expect(await sqlState(pool, ...insertSession(DEVICE))).toBeNull();
    expect(await sqlState(pool, ...insertSession(UNKNOWN_DEVICE))).toBe("23503");
  });

  it("G-6: códigos de recuperación de un solo uso, sólo como hash único", async () => {
    const code = `INSERT INTO identity.mfa_recovery_codes (id,user_id,batch_id,code_hash,status,created_at,consumed_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`;
    const batch = id();
    expect(await sqlState(pool, code, [id(), U2, batch, "hash-1", "ACTIVE", NOW, null])).toBeNull();
    expect(await sqlState(pool, code, [id(), U2, batch, "hash-1", "ACTIVE", NOW, null])).toBe("23505");
    expect(await sqlState(pool, code, [id(), U2, batch, "hash-2", "ACTIVE", NOW, NOW])).toBe("23514");
  });

  it("permisos: sólo el rol de Identity toca las tablas nuevas", async () => {
    const privilege = async (sql: string) => (await pool.query(sql)).rows[0]?.value as boolean;
    expect(await privilege("SELECT has_table_privilege('pos_platform_app','identity.user_login_names','INSERT') value")).toBe(true);
    expect(await privilege("SELECT has_column_privilege('pos_platform_app','identity.user_credentials','must_change_at_next_login','UPDATE') value")).toBe(true);
    for (const role of ["pos_app", "pos_worker", "pos_platform_admin"]) {
      expect(await privilege(`SELECT has_table_privilege('${role}','identity.user_login_names','SELECT') value`), role).toBe(false);
      expect(await privilege(`SELECT has_table_privilege('${role}','identity.mfa_recovery_codes','SELECT') value`), role).toBe(false);
    }
  });

  it("la reversión se niega si hay una sesión atada a un equipo", async () => {
    await pool.query("SET ROLE pos_schema_owner");
    const state = await sqlState(pool, await readArtifact(POSTGRES_005_DESCRIPTOR.downArtifact));
    await pool.query("RESET ROLE");
    // Restituir `sessions_device_deferred_ck` choca con la sesión de G-5.
    expect(state).toBe("23514");
  });
});

describe("005_identity_login — reversión", () => {
  it("se niega mientras exista un usuario sin correo; sin él, revierte y devuelve las restricciones de 001", async () => {
    const pool = await prepare("target_migration_005_down");
    try {
      const orphan = "018f0000-0000-7000-8000-000000005099";
      await pool.query(...insertUser(orphan, null));
      await pool.query("BEGIN");
      await pool.query("SET LOCAL ROLE pos_schema_owner");
      expect(await sqlState(pool, await readArtifact(POSTGRES_005_DESCRIPTOR.downArtifact))).toBe("23502");
      await pool.query("ROLLBACK");
      await pool.query("DELETE FROM identity.users WHERE id=$1", [orphan]);

      await pool.query("SET ROLE pos_schema_owner");
      await pool.query(await readArtifact(POSTGRES_005_DESCRIPTOR.downArtifact));
      await pool.query("RESET ROLE");
      const constraints = await pool.query("SELECT conname FROM pg_constraint WHERE conname IN ('sessions_device_deferred_ck','security_events_device_deferred_ck')");
      expect(constraints.rowCount).toBe(2);
      const tables = await pool.query("SELECT to_regclass('identity.user_login_names') a, to_regclass('identity.mfa_recovery_codes') b");
      expect(tables.rows[0]).toEqual({ a: null, b: null });
      const email = await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='identity' AND table_name='users' AND column_name='email'");
      expect(email.rows[0]?.is_nullable).toBe("NO");
    } finally {
      await pool.end();
    }
  }, 120_000);
});

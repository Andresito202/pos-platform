import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPostgres001, applyPostgres002 } from "../src/postgres.js";
import { readArtifact, sha256 } from "../src/shared.js";
import { POSTGRES_004_DESCRIPTOR } from "../src/postgres-004-contract.js";
import { POSTGRES_005_DESCRIPTOR } from "../src/postgres-005-contract.js";
import { POSTGRES_006_DESCRIPTOR, SESSION_TRUST_006_SEQUENCE } from "../src/postgres-006-contract.js";

/**
 * `006_session_trust_sequence` — `DEC-026` §13.10, contra PostgreSQL real.
 *
 * Mide el **SQL** de la 006 sobre 001 + 002 + 004 + 005, aplicado como
 * `pos_schema_owner` igual que el runner, y lo que el emisor de sesión
 * necesita de ella: que `pos_platform_app` —el rol con el que corre
 * `apps/api`— pueda pedir el siguiente valor, que ese valor crezca siempre y
 * que no pueda hacerlo retroceder. Igual que la prueba de la 005, **no** mide
 * el runner: ese exige el ledger con la 003 (PostgreSQL 16.14 exacto), y lo
 * ejerce CI.
 */

const SERVER_URL = process.env.POSTGRES_TEST_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";
const DATABASE = "target_migration_006";

function databaseUrl(name: string): string {
  const url = new URL(SERVER_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

async function prepare(): Promise<Client> {
  const admin = new Pool({ connectionString: SERVER_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${DATABASE}"`);
  } finally {
    await admin.end();
  }
  await applyPostgres001({ adminUrl: databaseUrl(DATABASE) });
  await applyPostgres002({ adminUrl: databaseUrl(DATABASE), skipSmoke: true });
  const client = new Client({ connectionString: databaseUrl(DATABASE) });
  await client.connect();
  for (const artifact of [POSTGRES_004_DESCRIPTOR.upArtifact, POSTGRES_005_DESCRIPTOR.upArtifact, POSTGRES_006_DESCRIPTOR.upArtifact]) {
    await client.query("SET ROLE pos_schema_owner");
    await client.query(await readArtifact(artifact));
    await client.query("RESET ROLE");
  }
  return client;
}

async function sqlState(client: Client, text: string): Promise<string | null> {
  await client.query("SAVEPOINT probe");
  try {
    await client.query(text);
    await client.query("RELEASE SAVEPOINT probe");
    return null;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT probe");
    return (error as { code?: string }).code ?? "UNKNOWN";
  }
}

describe("006_session_trust_sequence — descriptor", () => {
  it("depende exactamente de 005 y no posee tablas", async () => {
    expect(POSTGRES_006_DESCRIPTOR.dependencies).toEqual(["005_identity_login"]);
    expect(POSTGRES_006_DESCRIPTOR.ownedTables).toEqual([]);
    const up = await readArtifact(POSTGRES_006_DESCRIPTOR.upArtifact);
    expect(sha256(up)).toHaveLength(32);
    expect(up).toContain(SESSION_TRUST_006_SEQUENCE);
  });
});

describe("006_session_trust_sequence — PostgreSQL real", () => {
  let client: Client;

  beforeAll(async () => { client = await prepare(); }, 120_000);

  afterAll(async () => {
    await client?.end();
    const admin = new Pool({ connectionString: SERVER_URL });
    try { await admin.query(`DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE)`); } finally { await admin.end(); }
  });

  it("pos_platform_app obtiene valores estrictamente crecientes", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE pos_platform_app");
      const values: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        const row = await client.query<{ value: string }>(`SELECT nextval('${SESSION_TRUST_006_SEQUENCE}') AS value`);
        values.push(Number(row.rows[0]!.value));
      }
      for (let index = 1; index < values.length; index += 1) expect(values[index]).toBeGreaterThan(values[index - 1]!);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("un rollback no devuelve el valor: la secuencia nunca repite", async () => {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE pos_platform_app");
    const before = Number((await client.query<{ value: string }>(`SELECT nextval('${SESSION_TRUST_006_SEQUENCE}') AS value`)).rows[0]!.value);
    await client.query("ROLLBACK");
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE pos_platform_app");
    const after = Number((await client.query<{ value: string }>(`SELECT nextval('${SESSION_TRUST_006_SEQUENCE}') AS value`)).rows[0]!.value);
    await client.query("ROLLBACK");
    expect(after).toBeGreaterThan(before);
  });

  it("pos_platform_app no puede hacerla retroceder ni reiniciarla", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE pos_platform_app");
      expect(await sqlState(client, `SELECT setval('${SESSION_TRUST_006_SEQUENCE}', 1)`)).toBe("42501");
      expect(await sqlState(client, `ALTER SEQUENCE ${SESSION_TRUST_006_SEQUENCE} RESTART`)).toBe("42501");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("la reversión retira la secuencia y el permiso", async () => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE pos_schema_owner");
      await client.query(await readArtifact(POSTGRES_006_DESCRIPTOR.downArtifact));
      const exists = await client.query("SELECT 1 FROM pg_class WHERE relname = 'session_trust_sequence' AND relkind = 'S'");
      expect(exists.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});

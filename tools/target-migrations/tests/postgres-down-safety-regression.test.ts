import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPostgres001, applyPostgres002, downPostgres001, downPostgres002 } from "../src/postgres.js";

const SERVER_URL = process.env.POSTGRES_TEST_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";
const DATABASES = [
  "target_down_checksum_001_regression",
  "target_down_checksum_002_regression",
  "target_down_latest_started_regression",
] as const;

function databaseUrl(name: string): string {
  const url = new URL(SERVER_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

async function recreateDatabases(): Promise<void> {
  const pool = new Pool({ connectionString: SERVER_URL });
  try {
    for (const name of DATABASES) {
      await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await pool.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await pool.end();
  }
}

async function dropDatabases(): Promise<void> {
  const pool = new Pool({ connectionString: SERVER_URL });
  try {
    for (const name of DATABASES) await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await pool.end();
  }
}

describe("PostgreSQL destructive down safety regressions", () => {
  beforeAll(recreateDatabases);
  afterAll(dropDatabases);

  it("down 001 fails closed on checksum mismatch before dropping schemas", async () => {
    const url = databaseUrl("target_down_checksum_001_regression");
    await applyPostgres001({ adminUrl: url });

    const pool = new Pool({ connectionString: url });
    try {
      await pool.query(`
        UPDATE platform.target_migration_executions
        SET checksum = decode(repeat('00', 32), 'hex')
        WHERE migration_id = '001_central_foundation' AND status = 'APPLIED'
      `);
    } finally {
      await pool.end();
    }

    await expect(downPostgres001({ adminUrl: url })).rejects.toThrow("checksum mismatch for 001_central_foundation");

    const verify = new Pool({ connectionString: url });
    try {
      const result = await verify.query<{ exists: boolean }>("SELECT to_regnamespace('identity') IS NOT NULL AS exists");
      expect(result.rows[0]!.exists).toBe(true);
    } finally {
      await verify.end();
    }
  }, 60_000);

  it("down 002 fails closed on checksum mismatch before dropping integrations", async () => {
    const url = databaseUrl("target_down_checksum_002_regression");
    await applyPostgres001({ adminUrl: url });
    await applyPostgres002({ adminUrl: url });

    const pool = new Pool({ connectionString: url });
    try {
      await pool.query(`
        UPDATE platform.target_migration_executions
        SET checksum = decode(repeat('00', 32), 'hex')
        WHERE migration_id = '002_external_integrations_foundation' AND status = 'APPLIED'
      `);
    } finally {
      await pool.end();
    }

    await expect(downPostgres002({ adminUrl: url })).rejects.toThrow("checksum mismatch for 002_external_integrations_foundation");

    const verify = new Pool({ connectionString: url });
    try {
      const result = await verify.query<{ exists: boolean }>("SELECT to_regnamespace('integrations') IS NOT NULL AS exists");
      expect(result.rows[0]!.exists).toBe(true);
    } finally {
      await verify.end();
    }
  }, 60_000);

  it("repeated down 002 rejects a newer active STARTED execution", async () => {
    const url = databaseUrl("target_down_latest_started_regression");
    await applyPostgres001({ adminUrl: url });
    await applyPostgres002({ adminUrl: url });
    await downPostgres002({ adminUrl: url });

    await expect(applyPostgres002({ adminUrl: url, simulateCrashAfterStarted: true })).rejects.toThrow("simulated 002 crash after STARTED");
    await expect(downPostgres002({ adminUrl: url })).rejects.toThrow("down 002 rejected because latest execution is active STARTED");

    const verify = new Pool({ connectionString: url });
    try {
      const result = await verify.query<{ status: string }>(`
        SELECT status
        FROM platform.target_migration_executions
        WHERE migration_id = '002_external_integrations_foundation'
        ORDER BY started_at
      `);
      expect(result.rows.map((row) => row.status)).toEqual(["ROLLED_BACK", "STARTED"]);
      const schema = await verify.query<{ exists: boolean }>("SELECT to_regnamespace('integrations') IS NOT NULL AS exists");
      expect(schema.rows[0]!.exists).toBe(false);
    } finally {
      await verify.end();
    }
  }, 60_000);
});

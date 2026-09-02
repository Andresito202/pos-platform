import { Pool, type PoolClient } from "pg";

/**
 * Bloque 24-B: thin connection wrapper for the Cash PostgreSQL adapter.
 * Mirrors `LocalDatabase`'s role in `packages/database-sqlite` — owns the
 * connection, not the domain/application logic. Every write/read runs
 * inside `withTenantTransaction`, which sets `app.tenant_id` via `SET
 * LOCAL` (the same session variable `platform.current_tenant_id()` reads,
 * per `tools/target-migrations/sql/postgres/001_central_foundation.up.sql`)
 * so RLS actually applies — a query run outside a transaction with this set
 * would see no rows under `FORCE ROW LEVEL SECURITY`, by design.
 */
export class PostgresDatabase {
  private constructor(private readonly pool: Pool) {}

  static open(connectionString: string): PostgresDatabase {
    return new PostgresDatabase(new Pool({ connectionString, max: 4 }));
  }

  async withTenantTransaction<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      try {
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function roleConnectionString(adminUrl: string, roleName: string): string {
  const value = new URL(adminUrl);
  value.username = roleName;
  value.password = "";
  return value.toString();
}

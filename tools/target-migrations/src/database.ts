import Database from "better-sqlite3";
import { Kysely, PostgresDialect, SqliteDialect, sql } from "kysely";
import { Pool } from "pg";

export type EmptyDatabase = Record<string, never>;
export type SqlExecutor = Kysely<EmptyDatabase>;

export function postgresDatabase(connectionString: string, max = 4): SqlExecutor {
  return new Kysely<EmptyDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, max }),
    }),
  });
}

export function sqliteDatabase(path: string): { db: SqlExecutor; native: Database.Database } {
  const native = new Database(path);
  const db = new Kysely<EmptyDatabase>({ dialect: new SqliteDialect({ database: native }) });
  return { db, native };
}

export async function executeRaw(db: SqlExecutor, statement: string): Promise<void> {
  await sql.raw(statement).execute(db);
}

export async function queryRows<T>(db: SqlExecutor, statement: string): Promise<T[]> {
  const result = await sql.raw<T>(statement).execute(db);
  return result.rows;
}

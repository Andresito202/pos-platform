import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyPostgres001 } from "../src/postgres.js";
import { uuidV7 } from "../src/shared.js";

// An isolated disposable database; NEVER run this against a commercial DB.
// TARGET provides POSTGRES_TEST_URL on localhost. No privilege/grant is
// inserted into Central's deployed or onboarding databases.
const serverUrl = process.env.POSTGRES_TEST_URL;
const enabled = (() => {
  if (!serverUrl) return false;
  try {
    const u = new URL(serverUrl);
    return ["127.0.0.1", "localhost"].includes(u.hostname) &&
      u.pathname === "/postgres" &&
      u.username === "postgres";
  } catch { return false; }
})();

describe.skipIf(!enabled)("BUSINESS role-grant SQL audit against PostgreSQL", () => {
  const name = "pos_business_grant_audit_" + randomBytes(6).toString("hex");
  const url = new URL(serverUrl ?? "postgres://postgres@127.0.0.1:55433/postgres");
  url.pathname = "/" + name;
  let db: Pool;
  let auditSql: string;
  const ids = new Map<string, string>();

  async function runAudit(): Promise<void> {
    const client = await db.connect();
    try {
      // This executes the exact operator SQL, including READ ONLY and its DO guard.
      await client.query(auditSql);
    } finally {
      // After an expected SQL exception, a rollback resets this connection.
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  }

  async function putRole(code: string, scope: "BUSINESS" | "PLATFORM"): Promise<string> {
    const id = uuidV7();
    await db.query(
      `INSERT INTO "authorization".roles(id,code,name,scope_type,version,status,created_at)
        VALUES($1,$2,$2,$3,1,'ACTIVE',clock_timestamp())`,
      [id, code, scope],
    );
    ids.set("role:" + code, id);
    return id;
  }

  async function putPermission(code: string): Promise<string> {
    const id = uuidV7();
    await db.query(
      `INSERT INTO "authorization".permissions(id,code,module,description,status,created_at)
        VALUES($1,$2,'TEST','Isolated authorization audit fixture','ACTIVE',clock_timestamp())`,
      [id, code],
    );
    ids.set("permission:" + code, id);
    return id;
  }

  async function grant(role: string, permission: string): Promise<void> {
    await db.query(
      `INSERT INTO "authorization".role_permission_grants
        (id,role_id,permission_id,grant_version,status,valid_from,created_at)
        VALUES($1,$2,$3,1,'ACTIVE',clock_timestamp()-interval '1 minute',clock_timestamp())`,
      [uuidV7(), ids.get("role:" + role), ids.get("permission:" + permission)],
    );
  }

  beforeAll(async () => {
    if (!enabled) throw Error("AUDIT_TEST_LOCAL_POSTGRES_REQUIRED");
    const control = new Pool({ connectionString: serverUrl });
    try {
      await control.query(`CREATE DATABASE "${name}"`);
    } finally {
      await control.end();
    }
    await applyPostgres001({ adminUrl: url.toString(), skipSmoke: true });
    db = new Pool({ connectionString: url.toString() });
    auditSql = await readFile(new URL("../../operators/audit-business-role-grants.sql", import.meta.url), "utf8");
    await putRole("CASHIER", "BUSINESS");
    await putRole("SUPERVISOR", "BUSINESS");
    await putRole("OWNER", "BUSINESS");
    await putPermission("SALES_SALE_CREATE");
    await putPermission("CATALOG_PRODUCT_READ");
    await putPermission("INVENTORY_STOCK_RECEIVE");
    await putPermission("LICENSE_PLAN_MANAGE");
  }, 120_000);

  beforeEach(async () => {
    await db.query('DELETE FROM "authorization".role_permission_grants');
  });

  afterAll(async () => {
    await db?.end();
    const control = new Pool({ connectionString: serverUrl });
    try { await control.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); }
    finally { await control.end(); }
  }, 120_000);

  it("fails closed with no effective BUSINESS grants", async () => {
    await expect(runAudit()).rejects.toThrow("BUSINESS_GRANT_AUDIT_INCONCLUSIVE");
  });

  it("accepts an authorized CASHIER sale grant", async () => {
    await grant("CASHIER", "SALES_SALE_CREATE");
    await expect(runAudit()).resolves.toBeUndefined();
  });

  it("rejects SUPERVISOR stock modification even with an unrelated permitted grant", async () => {
    await grant("CASHIER", "SALES_SALE_CREATE");
    await grant("SUPERVISOR", "INVENTORY_STOCK_RECEIVE");
    await expect(runAudit()).rejects.toThrow("BUSINESS_GRANT_SEPARATION_VIOLATION");
  });

  it("rejects OWNER sale creation, not just SUPERVISOR grants", async () => {
    await grant("CASHIER", "SALES_SALE_CREATE");
    await grant("OWNER", "SALES_SALE_CREATE");
    await expect(runAudit()).rejects.toThrow("BUSINESS_GRANT_SEPARATION_VIOLATION");
  });

  it("rejects a GLOBAL licensing permission granted to CASHIER", async () => {
    await grant("CASHIER", "SALES_SALE_CREATE");
    await grant("CASHIER", "LICENSE_PLAN_MANAGE");
    await expect(runAudit()).rejects.toThrow("BUSINESS_GRANT_SEPARATION_VIOLATION");
  });

  it("ignores retired grants and permits safe read-only SUPERVISOR grants", async () => {
    await grant("CASHIER", "SALES_SALE_CREATE");
    await grant("SUPERVISOR", "CATALOG_PRODUCT_READ");
    await grant("SUPERVISOR", "INVENTORY_STOCK_RECEIVE");
    await db.query(`UPDATE "authorization".role_permission_grants
      SET status='RETIRED',retired_at=clock_timestamp()
      WHERE role_id=$1 AND permission_id=$2`,[
      ids.get("role:SUPERVISOR"), ids.get("permission:INVENTORY_STOCK_RECEIVE"),
    ]);
    await expect(runAudit()).resolves.toBeUndefined();
  });
});

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  POSTGRES_011_DESCRIPTOR,
  POSTGRES_011_SSA_SEQUENCE_COLUMNS,
  POSTGRES_011_SSA_SEQUENCE_TABLES,
} from "../src/index.js";

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "sql", "postgres");
describe("PostgreSQL 011 central SSA durable sequence migration contract", () => {
  it("declares one retained central watermark per device/user/installation", () => {
    expect(POSTGRES_011_DESCRIPTOR.migrationId).toBe("011_session_assertion_sequences");
    expect(POSTGRES_011_DESCRIPTOR.dependencies).toContain("004_device_trust");
    expect(POSTGRES_011_DESCRIPTOR.dependencies).toContain("010_webauthn_credential_material");
    expect(POSTGRES_011_SSA_SEQUENCE_TABLES).toEqual(["identity.session_assertion_sequences"]);
    expect(POSTGRES_011_SSA_SEQUENCE_COLUMNS).toContain("last_issued_sequence");
  });

  it("restricts application and forces RLS without a business POS write grant", async () => {
    const sql = await readFile(join(SQL_DIR, "011_session_assertion_sequences.up.sql"), "utf8");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("FOR ALL TO pos_platform_app");
    expect(sql).toContain("REVOKE ALL ON identity.session_assertion_sequences FROM PUBLIC, pos_app, pos_worker, pos_platform_admin");
    expect(sql).toContain("GRANT UPDATE (last_issued_sequence, updated_at)");
    expect(sql).toContain("9007199254740991");
    expect(sql).toContain("NEW.last_issued_sequence <> OLD.last_issued_sequence + 1");
    expect(sql).toContain("SSA sequence watermark must never be deleted");
    expect(sql).not.toContain("GRANT DELETE");
  });

  it("refuses destructive down migration after even one reservation", async () => {
    const sql = await readFile(join(SQL_DIR, "011_session_assertion_sequences.down.sql"), "utf8");
    expect(sql).toContain("IF EXISTS (SELECT 1 FROM identity.session_assertion_sequences LIMIT 1)");
    expect(sql).toContain("011 rollback refused: SSA sequence watermarks exist");
  });
});

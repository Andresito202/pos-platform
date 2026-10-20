import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEVICE_PROOF_012_COLUMNS, DEVICE_PROOF_012_TABLES, POSTGRES_012_DESCRIPTOR } from "../src/index.js";

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "sql", "postgres");
describe("PostgreSQL 012 durable Ed25519 device proof replay contract", () => {
  it("preserves an irreversible replay ledger downstream from SSA watermark 011", () => {
    expect(POSTGRES_012_DESCRIPTOR.migrationId).toBe("012_device_request_proof_replays");
    expect(POSTGRES_012_DESCRIPTOR.dependencies).toEqual(["011_session_assertion_sequences"]);
    expect(DEVICE_PROOF_012_TABLES).toEqual(["identity.device_request_proof_replays"]);
    expect(DEVICE_PROOF_012_COLUMNS).toContain("nonce_sha256");
    expect(DEVICE_PROOF_012_COLUMNS).toContain("request_id");
  });

  it("enforces per-credential nonce and request uniqueness with FORCE RLS and central-only INSERT", async () => {
    const sql = await readFile(join(SQL_DIR, "012_device_request_proof_replays.up.sql"), "utf8");
    expect(sql).toContain("PRIMARY KEY (credential_id, nonce_sha256)");
    expect(sql).toContain("UNIQUE (credential_id, request_id)");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("FOR ALL TO pos_platform_app");
    expect(sql).toContain("GRANT SELECT, INSERT ON identity.device_request_proof_replays TO pos_platform_app");
    expect(sql).not.toContain("GRANT DELETE");
    expect(sql).not.toContain("GRANT UPDATE");
  });

  it("rejects deletion or mutation and a destructive down when history exists", async () => {
    const up = await readFile(join(SQL_DIR, "012_device_request_proof_replays.up.sql"), "utf8");
    const down = await readFile(join(SQL_DIR, "012_device_request_proof_replays.down.sql"), "utf8");
    expect(up).toContain("consumed device request proof cannot be changed or deleted");
    expect(down).toContain("012 rollback refused: consumed device request proofs exist");
  });
});

import { describe, expect, it } from "vitest";
import { readArtifact, sha256 } from "../src/shared.js";
import { DEVICE_TRUST_004_COLUMNS, DEVICE_TRUST_004_TABLES, POSTGRES_004_DESCRIPTOR } from "../src/postgres-004-contract.js";

describe("PostgreSQL 004 device trust descriptor", () => {
  it("has an exact dependency on 003 and four owned identity tables", () => {
    expect(POSTGRES_004_DESCRIPTOR.migrationId).toBe("004_device_trust");
    expect(POSTGRES_004_DESCRIPTOR.dependencies).toEqual(["003_fiscal_electronic_invoicing_foundation"]);
    expect(DEVICE_TRUST_004_TABLES).toHaveLength(4);
    expect(POSTGRES_004_DESCRIPTOR.ownedTables).toEqual(DEVICE_TRUST_004_TABLES);
  });

  it("keeps the artifact checksum derived from the up SQL", async () => {
    const sql = await readArtifact(POSTGRES_004_DESCRIPTOR.upArtifact);
    expect(sql).toContain("CREATE TABLE identity.device_registry");
    expect(sql).toContain("CREATE TABLE identity.device_credentials");
    expect(sql).toContain("CREATE TABLE identity.device_enrollment_activations");
    expect(sql).toContain("CREATE TABLE identity.device_authentication_events");
    expect(sha256(sql)).toHaveLength(32);
  });

  it("declares the columns required by the D-3 registry boundary", () => {
    expect(DEVICE_TRUST_004_COLUMNS["identity.device_registry"]).toContain("trust_key_purpose");
    expect(DEVICE_TRUST_004_COLUMNS["identity.device_credentials"]).toContain("issuer_signature");
    expect(DEVICE_TRUST_004_COLUMNS["identity.device_enrollment_activations"]).toContain("consumed_credential_id");
    expect(DEVICE_TRUST_004_COLUMNS["identity.device_authentication_events"]).toContain("evidence_checksum");
  });
});

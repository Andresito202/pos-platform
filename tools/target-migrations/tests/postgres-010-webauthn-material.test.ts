import { describe, expect, it } from "vitest";
import { POSTGRES_010_DESCRIPTOR, WEBAUTHN_010_COLUMNS, WEBAUTHN_010_TABLES } from "../src/postgres-010-webauthn-material-contract.js";
import { POSTGRES_009_DESCRIPTOR } from "../src/postgres-009-webauthn-contract.js";
import { readArtifact, sha256 } from "../src/shared.js";

describe("PostgreSQL 010 public credential material (no duplicate MFA registry)", () => {
  it("depends only on established WebAuthn challenge schema 009", () => {
    expect(POSTGRES_010_DESCRIPTOR.dependencies).toEqual([POSTGRES_009_DESCRIPTOR.migrationId]);
    expect(POSTGRES_010_DESCRIPTOR.ownedTables).toEqual(WEBAUTHN_010_TABLES);
    expect(WEBAUTHN_010_COLUMNS).toEqual([
      "id", "factor_id", "credential_id", "public_key_cose_base64url",
      "counter", "backup_eligible", "backed_up", "created_at", "last_used_at", "version",
    ]);
  });

  it("binds one immutable public key to one canonical factor, not a password or secret", async () => {
    const sql = await readArtifact(POSTGRES_010_DESCRIPTOR.upArtifact);
    expect(sql).toContain("factor_id uuid NOT NULL UNIQUE REFERENCES identity.mfa_factors");
    expect(sql).toContain("credential_id text NOT NULL UNIQUE");
    expect(sql).toContain("public_key_cose_base64url text NOT NULL");
    expect(sql).toContain("counter BETWEEN 0 AND 4294967295");
    expect(sql).not.toContain("CREATE TABLE identity.mfa_factors");
    expect(sql).not.toContain("private_key");
    expect(sql).not.toContain("password");
    expect(sha256(sql)).toHaveLength(32);
  });

  it("uses PostgreSQL-safe length checks rather than unsupported large regex repetitions", async () => {
    const sql = await readArtifact(POSTGRES_010_DESCRIPTOR.upArtifact);
    expect(sql).toContain("credential_id ~ '^[A-Za-z0-9_-]+
    const sql = await readArtifact(POSTGRES_010_DESCRIPTOR.upArtifact);
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("CREATE POLICY webauthn_material_platform_only");
    expect(sql).toContain("CREATE POLICY webauthn_material_owner_inspect");
    expect(sql).toContain("NEW.counter < OLD.counter");
    expect(sql).toContain("NEW.version <> OLD.version + 1");
    expect(sql).toContain("CREATE TRIGGER webauthn_credential_material_guard");
    expect(sql).toContain("GRANT UPDATE (counter, backed_up, last_used_at, version)");
    expect(sql).toContain("REVOKE ALL ON identity.webauthn_credential_material FROM PUBLIC, pos_app, pos_worker, pos_platform_admin");
    expect(sql).not.toContain("GRANT UPDATE ON identity.webauthn_credential_material");
  });

  it("rejects any rollback that would erase public key or counter evidence", async () => {
    const down = await readArtifact(POSTGRES_010_DESCRIPTOR.downArtifact);
    expect(down).toContain("IF EXISTS (SELECT 1 FROM identity.webauthn_credential_material LIMIT 1)");
    expect(down).toContain("RAISE EXCEPTION");
    expect(down).toContain("DROP TABLE identity.webauthn_credential_material");
  });
});
");
    expect(sql).toContain("char_length(credential_id) BETWEEN 22 AND 1366");
    expect(sql).toContain("public_key_cose_base64url ~ '^[A-Za-z0-9_-]+
    const sql = await readArtifact(POSTGRES_010_DESCRIPTOR.upArtifact);
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("CREATE POLICY webauthn_material_platform_only");
    expect(sql).toContain("CREATE POLICY webauthn_material_owner_inspect");
    expect(sql).toContain("NEW.counter < OLD.counter");
    expect(sql).toContain("NEW.version <> OLD.version + 1");
    expect(sql).toContain("CREATE TRIGGER webauthn_credential_material_guard");
    expect(sql).toContain("GRANT UPDATE (counter, backed_up, last_used_at, version)");
    expect(sql).toContain("REVOKE ALL ON identity.webauthn_credential_material FROM PUBLIC, pos_app, pos_worker, pos_platform_admin");
    expect(sql).not.toContain("GRANT UPDATE ON identity.webauthn_credential_material");
  });

  it("rejects any rollback that would erase public key or counter evidence", async () => {
    const down = await readArtifact(POSTGRES_010_DESCRIPTOR.downArtifact);
    expect(down).toContain("IF EXISTS (SELECT 1 FROM identity.webauthn_credential_material LIMIT 1)");
    expect(down).toContain("RAISE EXCEPTION");
    expect(down).toContain("DROP TABLE identity.webauthn_credential_material");
  });
});
");
    expect(sql).toContain("char_length(public_key_cose_base64url) BETWEEN 43 AND 2731");
    expect(sql).not.toMatch(/\{\d+,\d+\}/);
  });

  it("forces RLS and permits only monotonic counter and backup update", async () => {
    const sql = await readArtifact(POSTGRES_010_DESCRIPTOR.upArtifact);
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("CREATE POLICY webauthn_material_platform_only");
    expect(sql).toContain("CREATE POLICY webauthn_material_owner_inspect");
    expect(sql).toContain("NEW.counter < OLD.counter");
    expect(sql).toContain("NEW.version <> OLD.version + 1");
    expect(sql).toContain("CREATE TRIGGER webauthn_credential_material_guard");
    expect(sql).toContain("GRANT UPDATE (counter, backed_up, last_used_at, version)");
    expect(sql).toContain("REVOKE ALL ON identity.webauthn_credential_material FROM PUBLIC, pos_app, pos_worker, pos_platform_admin");
    expect(sql).not.toContain("GRANT UPDATE ON identity.webauthn_credential_material");
  });

  it("rejects any rollback that would erase public key or counter evidence", async () => {
    const down = await readArtifact(POSTGRES_010_DESCRIPTOR.downArtifact);
    expect(down).toContain("IF EXISTS (SELECT 1 FROM identity.webauthn_credential_material LIMIT 1)");
    expect(down).toContain("RAISE EXCEPTION");
    expect(down).toContain("DROP TABLE identity.webauthn_credential_material");
  });
});

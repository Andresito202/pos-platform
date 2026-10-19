import { describe, expect, it } from "vitest";
import { readArtifact, sha256 } from "../src/shared.js";
import { POSTGRES_009_DESCRIPTOR, WEBAUTHN_009_COLUMNS, WEBAUTHN_009_TABLES } from "../src/postgres-009-webauthn-contract.js";
import { POSTGRES_008_DESCRIPTOR } from "../src/postgres-008-platform-roles-contract.js";

describe("Postgres 009 durable WebAuthn challenge (schema only)", () => {
  it("depends on 008 and creates a single challenge table, not a new MFA store", () => {
    expect(POSTGRES_009_DESCRIPTOR.dependencies).toEqual([POSTGRES_008_DESCRIPTOR.migrationId]);
    expect(POSTGRES_009_DESCRIPTOR.ownedTables).toEqual(WEBAUTHN_009_TABLES);
    expect(POSTGRES_009_DESCRIPTOR.ownedSchemas).toEqual(["identity"]);
    expect(WEBAUTHN_009_COLUMNS).toContain("challenge_hash");
    expect(WEBAUTHN_009_COLUMNS).toContain("consumed_at");
    expect(WEBAUTHN_009_COLUMNS).not.toContain("public_key");
  });

  it("persists only a digest and binds challenge to subject, purpose, session and origin", async () => {
    const sql = await readArtifact(POSTGRES_009_DESCRIPTOR.upArtifact);
    expect(sql).toContain("challenge_hash text NOT NULL");
    expect(sql).toContain("^[0-9a-f]{64}$");
    expect(sql).toContain("UNIQUE (challenge_hash)");
    expect(sql).toContain("user_id uuid NOT NULL REFERENCES identity.users");
    expect(sql).toContain("factor_id uuid NULL REFERENCES identity.mfa_factors");
    expect(sql).toContain("session_id uuid NULL REFERENCES identity.sessions");
    expect(sql).toContain("expected_origin text NOT NULL");
    expect(sql).toContain("purpose IN ('ENROLL','AUTHENTICATE','REAUTHENTICATE','RECOVERY_APPROVAL')");
    expect(sql).not.toMatch(/challenge\s+text\s+NOT\s+NULL/i);
    expect(sql).not.toContain("CREATE TABLE identity.mfa_factors");
    expect(sha256(sql)).toHaveLength(32);
  });

  it("forces RLS, prevents update replay and restricts grants to platform app", async () => {
    const sql = await readArtifact(POSTGRES_009_DESCRIPTOR.upArtifact);
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("CREATE POLICY webauthn_challenges_central_only");
    expect(sql).toContain("CREATE POLICY webauthn_challenges_owner_inspect");
    expect(sql).toContain("CREATE TRIGGER webauthn_challenge_consume_guard");
    expect(sql).toContain("OLD.consumed_at IS NOT NULL");
    expect(sql).toContain("NEW.version <> OLD.version + 1");
    expect(sql).toContain("GRANT UPDATE (consumed_at, version)");
    expect(sql).toContain("REVOKE ALL ON identity.webauthn_challenges FROM PUBLIC, pos_app, pos_worker, pos_platform_admin");
    expect(sql).not.toContain("GRANT UPDATE ON identity.webauthn_challenges");
  });

  it("will not erase any unpurged, including already consumed, challenge evidence", async () => {
    const sql = await readArtifact(POSTGRES_009_DESCRIPTOR.downArtifact);
    expect(sql).toContain("IF EXISTS (SELECT 1 FROM identity.webauthn_challenges LIMIT 1)");
    expect(sql).toContain("RAISE EXCEPTION");
    expect(sql).toContain("DROP TABLE identity.webauthn_challenges");
    expect(sql).toContain("DROP FUNCTION identity.webauthn_challenge_consume_guard()");
  });
});

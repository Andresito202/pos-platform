import { describe, expect, it } from "vitest";
import { POSTGRES_001_DESCRIPTOR, POSTGRES_002_DESCRIPTOR, POSTGRES_003_DESCRIPTOR } from "../src/contract.js";
import { buildPostgres003DownSql, buildPostgres003UpSql } from "../src/postgres-003-artifact.js";
import { readArtifact, sha256 } from "../src/shared.js";

describe("003 materialized SQL artifact parity", () => {
  it("freezes the generated Gate A catalog as exact up/down artifacts", async () => {
    const [up,down]=await Promise.all([
      readArtifact(POSTGRES_003_DESCRIPTOR.upArtifact),
      readArtifact(POSTGRES_003_DESCRIPTOR.downArtifact),
    ]);
    expect(up).toBe(buildPostgres003UpSql());
    expect(down).toBe(buildPostgres003DownSql());
    expect(sha256(up).toString("hex")).toMatch(/^[0-9a-f]{64}$/);
    expect(up).toContain("CREATE SCHEMA fiscal AUTHORIZATION pos_schema_owner;");
    expect(up).toContain("ALTER TABLE integrations.integration_dispatches ADD COLUMN fiscal_document_preparation_id uuid NULL;");
    expect(up).toContain("ALTER TABLE integrations.external_webhook_receipts ADD COLUMN fiscal_electronic_document_id uuid NULL;");
    expect(up).toContain("GRANT EXECUTE ON FUNCTION fiscal.safe_external_text(text,integer) TO pos_app,pos_worker,pos_schema_owner;");
    expect(up).toContain("integration_dispatches_dispatch_class_003_ck");
    expect(down).toContain("integration_dispatches_dispatch_class_002_ck");
    expect(down).not.toContain("DROP EXTENSION btree_gist");
  });

  it("preserves migrations 001 and 002 as immutable predecessors", async () => {
    const [up001,down001,up002,down002]=await Promise.all([
      readArtifact(POSTGRES_001_DESCRIPTOR.upArtifact),
      readArtifact(POSTGRES_001_DESCRIPTOR.downArtifact),
      readArtifact(POSTGRES_002_DESCRIPTOR.upArtifact),
      readArtifact(POSTGRES_002_DESCRIPTOR.downArtifact),
    ]);
    expect(sha256(up001).toString("hex")).toBe("7f188dd5c14a33f223e4684ace877d588278081924ab4c7286eb105a7c829507");
    expect(sha256(down001).toString("hex")).toBe("383a26d046beb31975e0a5f00657aea00b9748de67f1188ca2fc7edfe765c0b7");
    expect(sha256(up002).toString("hex")).toBe("8b22fdbc76ff79178d3063541012d7f428ed6d538d9027edb7987ebbbe09a554");
    expect(sha256(down002).toString("hex")).toBe("91acc3576b784daa261fa8e125c32fed522c0c5be12dd8c8fc91ed0c60bb1cf6");
  });
});

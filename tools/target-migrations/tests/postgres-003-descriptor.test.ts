import { describe, expect, it } from "vitest";
import {
  FISCAL_003_ALTERED_TABLES,
  FISCAL_003_INTEGRATION_EXTENSION_COLUMNS,
  FISCAL_RLS_TABLES,
  FISCAL_TABLES,
  POSTGRES_001_DESCRIPTOR,
  POSTGRES_002_DESCRIPTOR,
  POSTGRES_003_DESCRIPTOR,
} from "../src/contract.js";
import { readArtifact, sha256 } from "../src/shared.js";

const up001 = await readArtifact(POSTGRES_001_DESCRIPTOR.upArtifact);
const down001 = await readArtifact(POSTGRES_001_DESCRIPTOR.downArtifact);
const up002 = await readArtifact(POSTGRES_002_DESCRIPTOR.upArtifact);
const down002 = await readArtifact(POSTGRES_002_DESCRIPTOR.downArtifact);

describe("003 fiscal descriptor contract", () => {
  it("uses the exact migration identity and both immutable dependencies", () => {
    expect(POSTGRES_003_DESCRIPTOR).toMatchObject({
      migrationId: "003_fiscal_electronic_invoicing_foundation",
      manifestVersion: 1,
      dependencies: [
        "001_central_foundation",
        "002_external_integrations_foundation",
      ],
      targetPostgresVersion: "16.14",
      requiredExtensions: ["btree_gist"],
      ownedSchemas: ["fiscal"],
      sqliteArtifact: "NONE",
      expectedLedgerState: "APPLIED",
    });
  });

  it("owns exactly the authoritative ten-table Modelo A target", () => {
    expect(FISCAL_TABLES).toEqual([
      "fiscal_connections",
      "fiscal_emission_configurations",
      "fiscal_emission_configuration_versions",
      "electronic_documents",
      "fiscal_document_preparations",
      "fiscal_submission_attempts",
      "fiscal_artifacts",
      "fiscal_reconciliations",
      "fiscal_incidents",
      "fiscal_reconciliation_items",
    ]);
    expect(POSTGRES_003_DESCRIPTOR.fiscalTableCount).toBe(10);
    expect(POSTGRES_003_DESCRIPTOR.ownedTables).toEqual(
      FISCAL_TABLES.map((table) => `fiscal.${table}`),
    );
    expect(FISCAL_RLS_TABLES).toEqual(FISCAL_TABLES);
  });

  it("declares only the integration tables owned by 003 extensions", () => {
    expect(POSTGRES_003_DESCRIPTOR.alteredTables).toEqual([
      "integrations.provider_capability_declarations",
      "integrations.integration_capabilities",
      "integrations.integration_dispatches",
      "integrations.external_webhook_receipts",
    ]);
    expect(POSTGRES_003_DESCRIPTOR.alteredTables).toEqual(FISCAL_003_ALTERED_TABLES);
    expect(FISCAL_003_INTEGRATION_EXTENSION_COLUMNS).toEqual({
      "integrations.integration_dispatches": [
        "fiscal_document_preparation_id",
        "fiscal_preparation_generation",
      ],
      "integrations.external_webhook_receipts": [
        "fiscal_electronic_document_id",
        "fiscal_document_preparation_id",
        "fiscal_preparation_generation",
        "fiscal_integration_dispatch_id",
        "fiscal_correlated_at",
      ],
    });
  });

  it("materializes only SUBMIT_DOCUMENT in V1 and keeps SQLite 003 absent", () => {
    expect(POSTGRES_003_DESCRIPTOR.operationTypes).toEqual(["SUBMIT_DOCUMENT"]);
    expect(POSTGRES_003_DESCRIPTOR.operationTypes).not.toContain("QUERY_DOCUMENT_STATUS");
    expect(POSTGRES_003_DESCRIPTOR.operationTypes).not.toContain("RETRIEVE_ARTIFACT");
    expect(POSTGRES_003_DESCRIPTOR.sqliteArtifact).toBe("NONE");
  });

  it("preserves immutable 001 and 002 SQL bytes", () => {
    expect([
      sha256(up001).toString("hex"),
      sha256(down001).toString("hex"),
    ]).toEqual([
      "7f188dd5c14a33f223e4684ace877d588278081924ab4c7286eb105a7c829507",
      "383a26d046beb31975e0a5f00657aea00b9748de67f1188ca2fc7edfe765c0b7",
    ]);
    expect([
      sha256(up002).toString("hex"),
      sha256(down002).toString("hex"),
    ]).toEqual([
      "8b22fdbc76ff79178d3063541012d7f428ed6d538d9027edb7987ebbbe09a554",
      "91acc3576b784daa261fa8e125c32fed522c0c5be12dd8c8fc91ed0c60bb1cf6",
    ]);
  });
});

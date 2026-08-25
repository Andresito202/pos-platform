import { describe,expect,it } from "vitest";
import { FISCAL_TABLES,POSTGRES_002_DESCRIPTOR,POSTGRES_003_DESCRIPTOR } from "../src/contract.js";
import { readArtifact,sha256 } from "../src/shared.js";

const up=await readArtifact(POSTGRES_003_DESCRIPTOR.upArtifact);
const down=await readArtifact(POSTGRES_003_DESCRIPTOR.downArtifact);
const up001=await readArtifact("postgres/001_central_foundation.up.sql");
const down001=await readArtifact("postgres/001_central_foundation.down.sql");
const up002=await readArtifact(POSTGRES_002_DESCRIPTOR.upArtifact);
const down002=await readArtifact(POSTGRES_002_DESCRIPTOR.downArtifact);
const captures=(source:string,expression:RegExp)=>[...source.matchAll(expression)].map((match)=>match[1]!);

const requiredIndexes=[
  "fiscal_connections_scope_effective_idx","fiscal_connections_capability_fk_idx","fiscal_emission_configurations_branch_fk_idx",
  "fiscal_emission_configuration_versions_lookup_idx","fiscal_emission_configuration_versions_supersedes_idx","electronic_documents_source_idx",
  "electronic_documents_work_idx","electronic_documents_uncertain_idx","electronic_documents_original_idx","fiscal_submission_attempts_dispatch_fk_idx",
  "fiscal_submission_attempts_document_idx","fiscal_submission_attempts_unknown_idx","fiscal_submission_attempts_provider_operation_idx",
  "fiscal_artifacts_document_idx","fiscal_artifacts_attempt_fk_idx","fiscal_reconciliations_work_idx","fiscal_reconciliations_connection_idx",
  "fiscal_incidents_open_idx","fiscal_incidents_document_idx","fiscal_incidents_attempt_idx","fiscal_incidents_reconciliation_idx",
  "fiscal_reconciliation_items_document_idx","fiscal_reconciliation_items_incident_idx",
] as const;

const requiredGuards=[
  "fiscal_connections_scope_guard","fiscal_connections_capability_guard","fiscal_emission_configurations_scope_guard",
  "fiscal_emission_configuration_versions_update_guard","fiscal_emission_configuration_versions_state_guard","fiscal_emission_configuration_versions_numbering_guard",
  "electronic_documents_insert_guard","electronic_documents_update_guard","electronic_documents_state_guard","electronic_documents_evidence_guard","electronic_documents_numbering_guard",
  "fiscal_submission_attempts_insert_guard","fiscal_submission_attempts_update_guard","fiscal_submission_attempts_state_guard","fiscal_submission_attempts_number_guard",
  "fiscal_artifacts_immutable_guard","fiscal_reconciliations_insert_guard","fiscal_reconciliations_update_guard","fiscal_reconciliations_state_guard",
  "fiscal_incidents_insert_guard","fiscal_incidents_update_guard","fiscal_incidents_state_guard","fiscal_reconciliation_items_immutable_guard",
  "integration_dispatches_fiscal_document_guard","provider_capability_declarations_fiscal_downgrade_guard",
] as const;

describe("003_fiscal_electronic_invoicing_foundation static contract",()=>{
  it("has the exact descriptor identity and dependency",()=>expect(POSTGRES_003_DESCRIPTOR).toMatchObject({migrationId:"003_fiscal_electronic_invoicing_foundation",manifestVersion:1,dependencies:["002_external_integrations_foundation"],ownedSchemas:["fiscal"],requiredExtensions:["btree_gist"],checksum:"DERIVED_FROM_UP_ARTIFACT",expectedLedgerState:"APPLIED"}));
  it("owns exactly nine fiscal tables",()=>expect(POSTGRES_003_DESCRIPTOR.ownedTables).toEqual(FISCAL_TABLES.map((table)=>`fiscal.${table}`)));
  it("creates exactly nine fiscal tables",()=>expect(captures(up,/CREATE TABLE fiscal\.([a-z][a-z0-9_]*)/g)).toEqual([...FISCAL_TABLES]));
  it("creates no SQLite artifact or statement",()=>expect(up+down).not.toMatch(/sqlite|WITHOUT ROWID|PRAGMA/i));
  it("preserves exact 001 artifacts",()=>expect([sha256(up001).toString("hex"),sha256(down001).toString("hex")]).toEqual(["7f188dd5c14a33f223e4684ace877d588278081924ab4c7286eb105a7c829507","383a26d046beb31975e0a5f00657aea00b9748de67f1188ca2fc7edfe765c0b7"]));
  it("preserves exact 002 artifacts",()=>expect([sha256(up002).toString("hex"),sha256(down002).toString("hex")]).toEqual(["8b22fdbc76ff79178d3063541012d7f428ed6d538d9027edb7987ebbbe09a554","91acc3576b784daa261fa8e125c32fed522c0c5be12dd8c8fc91ed0c60bb1cf6"]));
  it("uses UUIDv7 checks on every fiscal table",()=>expect(captures(up,/CONSTRAINT ([a-z][a-z0-9_]*_id_v7_ck)/g)).toHaveLength(9));
  it("enables and forces RLS on all nine tables",()=>expect([captures(up,/ALTER TABLE fiscal\.([a-z][a-z0-9_]*) ENABLE ROW LEVEL SECURITY/g),captures(up,/ALTER TABLE fiscal\.([a-z][a-z0-9_]*) FORCE ROW LEVEL SECURITY/g)]).toEqual([[...FISCAL_TABLES],[...FISCAL_TABLES]]));
  it("materializes the closed index inventory",()=>expect(captures(up,/CREATE (?:UNIQUE )?INDEX ([a-z][a-z0-9_]*)/g).filter((name)=>requiredIndexes.includes(name as never))).toEqual([...requiredIndexes]));
  it("does not materialize retired speculative indexes",()=>expect(up).not.toMatch(/fiscal_emission_configurations_connection_idx|electronic_documents_connection_idx/));
  it("materializes every normative guard",()=>expect(requiredGuards.every((name)=>up.includes(`CREATE TRIGGER ${name} `))).toBe(true));
  it("keeps FiscalSubmissionAttempt as the sole FISCAL attempt owner",()=>{expect(up).toContain("fiscal_submission_attempts_class_ck CHECK (dispatch_class='FISCAL')");expect(up).not.toMatch(/ALTER TABLE integrations\.integration_dispatch_attempts/);});
  it("adds DEBIT_NOTES without seeds",()=>{expect(up).toContain("'DEBIT_NOTES'");expect(up).not.toMatch(/\bINSERT\s+INTO\b/i);});
  it("keeps the 002 discriminator until the final structural change",()=>{const add=up.lastIndexOf("ADD CONSTRAINT integration_dispatches_dispatch_class_003_ck");const validate=up.lastIndexOf("VALIDATE CONSTRAINT integration_dispatches_dispatch_class_003_ck");const finalStatement="ALTER TABLE integrations.integration_dispatches DROP CONSTRAINT integration_dispatches_dispatch_class_002_ck;";const drop=up.lastIndexOf(finalStatement);expect(add).toBeGreaterThan(0);expect(validate).toBeGreaterThan(add);expect(drop).toBeGreaterThan(validate);expect(up.slice(drop).trim()).toBe(finalStatement);});
  it("uses the exact final FISCAL/NON_FISCAL discriminator",()=>expect(up).toContain("(dispatch_class='FISCAL' AND capability_code IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS') AND internal_entity_type='ElectronicDocument') OR (dispatch_class='NON_FISCAL' AND capability_code NOT IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS') AND internal_entity_type<>'ElectronicDocument')"));
  it("uses literal role grants with deny-by-default exclusions",()=>{expect(up).not.toMatch(/GRANT ALL| TO PUBLIC|TO pos_reporting/i);expect(up).not.toMatch(/GRANT (?:DELETE|TRUNCATE|REFERENCES|TRIGGER)/i);expect(up).not.toMatch(/GRANT (?:SELECT|INSERT|SELECT,INSERT) ON fiscal\./i);expect(up).toContain("GRANT UPDATE (next_number_value,numbering_exhausted_at,updated_at,row_version)");});
  it("keeps admin read-only and platform application without fiscal DML",()=>{expect(up).not.toMatch(/GRANT (?:INSERT|UPDATE)[^;]+ TO [^;]*(?:pos_platform_admin|pos_platform_app)/i);});
  it("contains no provider calls, auth material, secrets, blobs, or provider seeds",()=>expect(up+down).not.toMatch(/https?:\/\/|fetch\(|axios|curl|access_token|refresh_token|client_secret|private_key|api_key|CREATE TABLE[^;]*(?:payload_blob|xml_content|pdf_content)/i));
  it("restores 002 before removing fiscal ownership",()=>{const restore=down.indexOf("ADD CONSTRAINT integration_dispatches_dispatch_class_002_ck");const remove=down.indexOf("DROP CONSTRAINT integration_dispatches_dispatch_class_003_ck");const firstDrop=down.indexOf("DROP TABLE fiscal.");expect(down.trimStart().startsWith("ALTER TABLE integrations.integration_dispatches ADD CONSTRAINT integration_dispatches_dispatch_class_002_ck")).toBe(true);expect(restore).toBeGreaterThan(0);expect(remove).toBeGreaterThan(restore);expect(firstDrop).toBeGreaterThan(remove);});
  it("drops all nine tables in reverse dependency order",()=>expect(captures(down,/DROP TABLE fiscal\.([a-z][a-z0-9_]*)/g)).toEqual([...FISCAL_TABLES].reverse()));
  it("never drops btree_gist or predecessor schemas",()=>expect(down).not.toMatch(/DROP EXTENSION|DROP SCHEMA (?:integrations|platform)|DROP TABLE integrations\./));
});

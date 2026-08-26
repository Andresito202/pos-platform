import { FISCAL_003_FUNCTION_DEFINITION_SQL, FISCAL_003_REQUIRED_FUNCTIONS } from "../src/postgres-003-functions.js";
import { FISCAL_003_DISPATCH_CLASS_TRANSITION } from "../src/postgres-003-transitions.js";
import {
  FISCAL_003_EXACT_CONSTRAINT_DEFINITIONS,
  FISCAL_003_EXACT_GUARD_DEFINITIONS,
  FISCAL_003_EXACT_INDEX_DEFINITIONS,
  FISCAL_003_EXACT_POLICY_DEFINITIONS,
  FISCAL_003_TABLE_BLUEPRINT_SQL,
} from "../src/postgres-003-blueprint.js";
import { describe, expect, it } from "vitest";
import {
  FISCAL_003_ALTERED_TABLES,
  FISCAL_003_CURRENT_PREPARATION_CONSTRAINT_TRIGGERS,
  FISCAL_003_GRANT_MATRIX,
  FISCAL_003_INTEGRATION_EXTENSION_COLUMNS,
  FISCAL_003_INTEGRATION_EXTENSION_GRANTS,
  FISCAL_003_PROHIBITED_CATALOG,
  FISCAL_003_REQUIRED_GUARDS,
  FISCAL_003_REQUIRED_INDEXES,
  FISCAL_003_REQUIRED_POLICIES,
  FISCAL_003_SHARED_VALIDATOR,
  FISCAL_003_TABLE_COLUMNS,
  FISCAL_003_TABLE_CONSTRAINTS,
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
      dependencies: ["001_central_foundation","002_external_integrations_foundation"],
      targetPostgresVersion: "16.14",
      requiredExtensions: ["btree_gist"],
      ownedSchemas: ["fiscal"],
      sqliteArtifact: "NONE",
      expectedLedgerState: "APPLIED",
      mat003PrerequisiteOnly: true,
    });
  });

  it("owns exactly the authoritative ten-table Modelo A target", () => {
    expect(FISCAL_TABLES).toEqual([
      "fiscal_connections","fiscal_emission_configurations",
      "fiscal_emission_configuration_versions","electronic_documents",
      "fiscal_document_preparations","fiscal_submission_attempts","fiscal_artifacts",
      "fiscal_reconciliations","fiscal_incidents","fiscal_reconciliation_items",
    ]);
    expect(Object.keys(FISCAL_003_TABLE_COLUMNS)).toEqual(FISCAL_TABLES.map((table)=>`fiscal.${table}`));
    expect(POSTGRES_003_DESCRIPTOR.fiscalTableCount).toBe(10);
    expect(POSTGRES_003_DESCRIPTOR.expectedTableColumns).toBe(FISCAL_003_TABLE_COLUMNS);
    expect(POSTGRES_003_DESCRIPTOR.ownedTables).toEqual(FISCAL_TABLES.map((table)=>`fiscal.${table}`));
    expect(FISCAL_RLS_TABLES).toEqual(FISCAL_TABLES);
  });

  it("locks exact V2 columns and keeps provider identity on preparation, not document", () => {
    expect(FISCAL_003_TABLE_COLUMNS["fiscal.electronic_documents"]).toEqual([
      "id","tenant_id","company_id","branch_id","source_type","source_id","document_type",
      "logical_operation_key","status","internal_reference","preparation_generation",
      "authority_reference","legal_identifier","authority_status_raw","uncertainty_reason",
      "original_electronic_document_id","issued_at","accepted_at","rejected_at",
      "last_reconciled_at","created_at","updated_at","version",
    ]);
    for(const column of FISCAL_003_PROHIBITED_CATALOG.electronicDocumentColumns){
      expect(FISCAL_003_TABLE_COLUMNS["fiscal.electronic_documents"]).not.toContain(column);
      expect(FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_document_preparations"]).toContain(column);
    }
    expect(FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_document_preparations"]).toContain("preparation_generation");
    expect(FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_submission_attempts"]).toEqual(expect.arrayContaining(["fiscal_document_preparation_id","preparation_generation"]));
    expect(FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_artifacts"]).toEqual(expect.arrayContaining(["fiscal_document_preparation_id","preparation_generation"]));
    expect(FISCAL_003_TABLE_COLUMNS["fiscal.fiscal_reconciliation_items"]).toEqual(expect.arrayContaining(["fiscal_document_preparation_id","preparation_generation"]));
  });

  it("encodes exact candidate/FK/constraint expectations before DDL exists", () => {
    expect(FISCAL_003_TABLE_CONSTRAINTS["fiscal.fiscal_document_preparations"]).toEqual(expect.arrayContaining([
      "fiscal_document_preparations_generation_uq",
      "fiscal_document_preparations_dispatch_scope_uq",
      "fiscal_document_preparations_attempt_scope_uq",
      "fiscal_document_preparations_document_fk",
      "fiscal_document_preparations_configuration_version_fk",
      "fiscal_document_preparations_supersedes_fk",
    ]));
    expect(FISCAL_003_TABLE_CONSTRAINTS["fiscal.fiscal_submission_attempts"]).toEqual(expect.arrayContaining([
      "fiscal_submission_attempts_dispatch_history_uq",
      "fiscal_submission_attempts_document_history_uq",
      "fiscal_submission_attempts_preparation_fk",
      "fiscal_submission_attempts_dispatch_fk",
    ]));
    expect(POSTGRES_003_DESCRIPTOR.ownedConstraints).not.toBe("DERIVED_FROM_UP_ARTIFACT");
    for(const prohibited of FISCAL_003_PROHIBITED_CATALOG.attemptConstraints){
      expect(POSTGRES_003_DESCRIPTOR.ownedConstraints).not.toContain(prohibited);
    }
  });

  it("locks the conservative no-reuse, indexes and no-lease V1 catalog", () => {
    expect(FISCAL_003_REQUIRED_INDEXES).toEqual(expect.arrayContaining([
      "fiscal_document_preparations_legal_number_uq",
      "fiscal_document_preparations_provider_document_uq",
      "integration_dispatches_fiscal_preparation_idx",
      "external_webhook_receipts_fiscal_correlation_idx",
    ]));
    for(const retired of FISCAL_003_PROHIBITED_CATALOG.speculativeIndexes){
      expect(FISCAL_003_REQUIRED_INDEXES).not.toContain(retired);
    }
    for(const lease of FISCAL_003_PROHIBITED_CATALOG.leaseColumns){
      expect(Object.values(FISCAL_003_TABLE_COLUMNS).flat()).not.toContain(lease);
      expect(Object.values(FISCAL_003_INTEGRATION_EXTENSION_COLUMNS).flat()).not.toContain(lease);
    }
    expect(POSTGRES_003_DESCRIPTOR.ownedIndexes).toBe(FISCAL_003_REQUIRED_INDEXES);
  });

  it("locks guards including the two deferred current-preparation constraint triggers", () => {
    expect(FISCAL_003_REQUIRED_GUARDS).toEqual(expect.arrayContaining([
      "electronic_documents_reprepare_guard",
      "fiscal_document_preparations_late_evidence_guard",
      "fiscal_submission_attempts_root_guard",
      "integration_dispatches_fiscal_preparation_guard",
      "external_webhook_receipts_fiscal_correlation_guard",
    ]));
    expect(FISCAL_003_CURRENT_PREPARATION_CONSTRAINT_TRIGGERS).toEqual([
      "electronic_documents_current_preparation_guard",
      "fiscal_document_preparations_current_generation_guard",
    ]);
    for(const trigger of FISCAL_003_CURRENT_PREPARATION_CONSTRAINT_TRIGGERS){
      expect(FISCAL_003_REQUIRED_GUARDS).toContain(trigger);
    }
    expect(FISCAL_003_SHARED_VALIDATOR).toBe("validate_current_fiscal_preparation_invariant");
    expect(POSTGRES_003_DESCRIPTOR.expectedGuards).toBe(FISCAL_003_REQUIRED_GUARDS);
  });

  it("locks RLS policies and deny-by-default grant matrices", () => {
    expect(FISCAL_003_REQUIRED_POLICIES).toEqual(expect.arrayContaining([
      "fiscal_document_preparations_app_tenant_isolation",
      "fiscal_document_preparations_platform_tenant_select",
      "fiscal_document_preparations_worker_frozen",
      "fiscal_document_preparations_worker_historical_evidence",
    ]));
    expect(POSTGRES_003_DESCRIPTOR.ownedPolicies).toBe(FISCAL_003_REQUIRED_POLICIES);
    expect(FISCAL_003_GRANT_MATRIX["fiscal.fiscal_document_preparations"].pos_worker.update).toEqual([
      "numbering_state","prefix","number","number_reserved_at","number_consumed_at","number_burned_at",
      "numbering_resolution_reason","provider_document_id","provider_reference","provider_status_raw",
      "updated_at","version",
    ]);
    expect(FISCAL_003_GRANT_MATRIX["fiscal.fiscal_document_preparations"].pos_platform_admin.insert).toEqual([]);
    expect(FISCAL_003_GRANT_MATRIX["fiscal.fiscal_document_preparations"].pos_platform_admin.update).toEqual([]);
    expect(FISCAL_003_INTEGRATION_EXTENSION_GRANTS["integrations.integration_dispatches"].pos_app.update).toEqual([]);
    expect(FISCAL_003_INTEGRATION_EXTENSION_GRANTS["integrations.integration_dispatches"].pos_worker.update).toEqual([]);
    expect(FISCAL_003_INTEGRATION_EXTENSION_GRANTS["integrations.external_webhook_receipts"].pos_worker.update).toEqual(
      FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.external_webhook_receipts"],
    );
    expect(FISCAL_003_INTEGRATION_EXTENSION_GRANTS["integrations.external_webhook_receipts"].pos_platform_app.update).toEqual([]);
    expect(POSTGRES_003_DESCRIPTOR.grantMatrix).toBe(FISCAL_003_GRANT_MATRIX);
    expect(POSTGRES_003_DESCRIPTOR.integrationExtensionGrants).toBe(FISCAL_003_INTEGRATION_EXTENSION_GRANTS);
  });

  it("declares only the integration tables and columns owned by 003 extensions", () => {
    expect(POSTGRES_003_DESCRIPTOR.alteredTables).toEqual([
      "integrations.provider_capability_declarations",
      "integrations.integration_capabilities",
      "integrations.integration_credential_bindings",
      "integrations.integration_dispatches",
      "integrations.external_webhook_receipts",
    ]);
    expect(POSTGRES_003_DESCRIPTOR.alteredTables).toBe(FISCAL_003_ALTERED_TABLES);
    expect(POSTGRES_003_DESCRIPTOR.integrationExtensionColumns).toBe(FISCAL_003_INTEGRATION_EXTENSION_COLUMNS);
    expect(FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.integration_dispatches"]).toEqual([
      "fiscal_document_preparation_id","fiscal_preparation_generation",
      "fiscal_request_semantic_version","fiscal_request_semantic_checksum",
    ]);
    expect(FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.external_webhook_receipts"]).toEqual([
      "fiscal_electronic_document_id","fiscal_document_preparation_id",
      "fiscal_preparation_generation","fiscal_integration_dispatch_id","fiscal_correlated_at",
    ]);
  });

  it("materializes only SUBMIT_DOCUMENT in V1 and keeps SQLite 003 absent", () => {
    expect(POSTGRES_003_DESCRIPTOR.operationTypes).toEqual(["SUBMIT_DOCUMENT"]);
    for(const operation of FISCAL_003_PROHIBITED_CATALOG.operationTypes){
      expect(POSTGRES_003_DESCRIPTOR.operationTypes).not.toContain(operation as "SUBMIT_DOCUMENT");
    }
    expect(POSTGRES_003_DESCRIPTOR.sqliteArtifact).toBe("NONE");
  });

  it("preserves immutable 001 and 002 SQL bytes", () => {
    expect([sha256(up001).toString("hex"),sha256(down001).toString("hex")]).toEqual([
      "7f188dd5c14a33f223e4684ace877d588278081924ab4c7286eb105a7c829507",
      "383a26d046beb31975e0a5f00657aea00b9748de67f1188ca2fc7edfe765c0b7",
    ]);
    expect([sha256(up002).toString("hex"),sha256(down002).toString("hex")]).toEqual([
      "8b22fdbc76ff79178d3063541012d7f428ed6d538d9027edb7987ebbbe09a554",
      "91acc3576b784daa261fa8e125c32fed522c0c5be12dd8c8fc91ed0c60bb1cf6",
    ]);
  });
  it("pins provider-facing semantic identity on every fiscal dispatch", () => {
    const defs=POSTGRES_003_DESCRIPTOR.catalogDefinitions;
    expect(defs.columns["integrations.integration_dispatches#003"].fiscal_request_semantic_version)
      .toEqual({type:"integer",nullable:true,defaultSql:null});
    expect(defs.columns["integrations.integration_dispatches#003"].fiscal_request_semantic_checksum)
      .toEqual({type:"text",nullable:true,defaultSql:null});
    expect(defs.constraints["integration_dispatches_fiscal_semantic_request_ck"])
      .toContain("fiscal_request_semantic_version IS NOT NULL");
    expect(defs.constraints["integration_dispatches_fiscal_semantic_request_ck"])
      .toContain("fiscal_request_semantic_checksum IS NOT NULL");
    expect(defs.semanticRules.dispatchRequestIdentity)
      .toContain("same idempotency root with different semantic version/checksum is CONFLICT before HTTP");
  });

  it("pins exact credential binding generation on every submission attempt", () => {
    const defs=POSTGRES_003_DESCRIPTOR.catalogDefinitions;
    expect(defs.columns["fiscal.fiscal_submission_attempts"].credential_binding_id)
      .toEqual({type:"uuid",nullable:false,defaultSql:null});
    expect(defs.columns["fiscal.fiscal_submission_attempts"].credential_binding_generation)
      .toEqual({type:"integer",nullable:false,defaultSql:null});
    expect(defs.constraints["integration_credential_bindings_attempt_scope_uq"])
      .toContain("UNIQUE (tenant_id,company_id,integration_id,id,generation)");
    expect(defs.constraints["fiscal_submission_attempts_credential_binding_fk"])
      .toContain("REFERENCES integrations.integration_credential_bindings(tenant_id,company_id,integration_id,id,generation)");
  });

  it("encodes definition-level catalog invariants before Gate B DDL", () => {
    const defs=POSTGRES_003_DESCRIPTOR.catalogDefinitions;
    expect(defs.columns["fiscal.fiscal_document_preparations"].currency_code.type).toBe("char(3)");
    expect(defs.columns["fiscal.fiscal_document_preparations"].subtotal_amount.type).toBe("numeric(19,6)");
    expect(defs.constraints["fiscal_document_preparations_document_fk"])
      .toContain("REFERENCES fiscal.electronic_documents(tenant_id,company_id,id,document_type)");
    expect(defs.indexes["fiscal_document_preparations_legal_number_uq"])
      .toContain("COALESCE(prefix,''),number) WHERE number IS NOT NULL");
    expect(defs.triggers["electronic_documents_current_preparation_guard"])
      .toContain("CONSTRAINT TRIGGER electronic_documents_current_preparation_guard AFTER INSERT OR UPDATE");
    expect(defs.triggers["electronic_documents_current_preparation_guard"])
      .toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(defs.policies["fiscal_document_preparations_platform_tenant_select"])
      .toContain("FOR SELECT TO pos_platform_app");
  });

  it("has exact definition coverage for every advertised constraint, index, guard and policy", () => {
    const sorted=(values:readonly string[])=>[...values].sort();
    expect(sorted(Object.keys(FISCAL_003_EXACT_CONSTRAINT_DEFINITIONS))).toEqual(sorted(POSTGRES_003_DESCRIPTOR.ownedConstraints as readonly string[]));
    expect(sorted(Object.keys(FISCAL_003_EXACT_INDEX_DEFINITIONS))).toEqual(sorted(POSTGRES_003_DESCRIPTOR.ownedIndexes as readonly string[]));
    expect(sorted(Object.keys(FISCAL_003_EXACT_GUARD_DEFINITIONS))).toEqual(sorted(POSTGRES_003_DESCRIPTOR.expectedGuards));
    expect(sorted(Object.keys(FISCAL_003_EXACT_POLICY_DEFINITIONS))).toEqual(sorted(POSTGRES_003_DESCRIPTOR.ownedPolicies as readonly string[]));
    expect(Object.keys(FISCAL_003_TABLE_BLUEPRINT_SQL).sort()).toEqual(POSTGRES_003_DESCRIPTOR.ownedTables.slice().sort());
  });

  it("uses normative defense-in-depth unique indexes", () => {
    expect(FISCAL_003_EXACT_INDEX_DEFINITIONS["fiscal_submission_attempts_one_in_progress_uq"])
      .toBe("CREATE UNIQUE INDEX fiscal_submission_attempts_one_in_progress_uq ON fiscal.fiscal_submission_attempts(tenant_id,integration_dispatch_id) WHERE status='IN_PROGRESS';");
    expect(FISCAL_003_EXACT_INDEX_DEFINITIONS["integration_dispatches_one_fiscal_per_preparation_uq"])
      .toContain("ON integrations.integration_dispatches(tenant_id,fiscal_document_preparation_id) WHERE dispatch_class='FISCAL'");
    expect(FISCAL_003_EXACT_INDEX_DEFINITIONS["fiscal_submission_attempts_in_progress_uq"]).toBeUndefined();
  });

  it("rejects NULL semantic identities for FISCAL while preserving nullable NON_FISCAL columns", () => {
    const constraint=FISCAL_003_EXACT_CONSTRAINT_DEFINITIONS["integration_dispatches_fiscal_semantic_request_ck"];
    expect(constraint).toContain("fiscal_request_semantic_version IS NOT NULL");
    expect(constraint).toContain("fiscal_request_semantic_checksum IS NOT NULL");
    expect(constraint).toContain("dispatch_class='NON_FISCAL' AND fiscal_request_semantic_version IS NULL AND fiscal_request_semantic_checksum IS NULL");
  });

  it("keeps attempt scoped candidates needed by downstream evidence FKs", () => {
    expect(FISCAL_003_EXACT_CONSTRAINT_DEFINITIONS["fiscal_submission_attempts_document_scope_uq"])
      .toContain("UNIQUE (tenant_id,company_id,external_integration_id,electronic_document_id,preparation_generation,id)");
    expect(FISCAL_003_EXACT_CONSTRAINT_DEFINITIONS["fiscal_submission_attempts_connection_scope_uq"])
      .toContain("UNIQUE (tenant_id,company_id,external_integration_id,fiscal_connection_id,id)");
    expect(FISCAL_003_EXACT_CONSTRAINT_DEFINITIONS["fiscal_artifacts_attempt_fk"])
      .toContain("REFERENCES fiscal.fiscal_submission_attempts(tenant_id,company_id,external_integration_id,electronic_document_id,preparation_generation,id)");
  });

  it("rejects NULL local numbering range fields under PostgreSQL three-valued CHECK logic", () => {
    const constraint=FISCAL_003_EXACT_CONSTRAINT_DEFINITIONS["fiscal_emission_configuration_versions_numbering_ck"];
    expect(constraint).toContain("number_range_start IS NOT NULL");
    expect(constraint).toContain("number_range_end IS NOT NULL");
    expect(constraint).toContain("next_number_value IS NOT NULL");
    expect(constraint).toContain("numbering_policy_code IN ('AUTHORIZED_RANGE','LOCAL_CONTINGENCY')");
    expect(constraint).toContain("next_number_value BETWEEN number_range_start AND number_range_end+1");
  });

  it("rejects a reconciliation close timestamp without a durable start timestamp", () => {
    const constraint=FISCAL_003_EXACT_CONSTRAINT_DEFINITIONS["fiscal_reconciliations_version_ck"];
    expect(constraint).toContain("closed_at IS NULL OR (started_at IS NOT NULL AND started_at<=closed_at)");
  });

  it("defines every fiscal function referenced by tables, guards and policies", () => {
    const source=[
      ...Object.values(FISCAL_003_TABLE_BLUEPRINT_SQL),
      ...Object.values(FISCAL_003_EXACT_GUARD_DEFINITIONS),
      ...Object.values(FISCAL_003_EXACT_POLICY_DEFINITIONS),
    ].join("\n");
    const tableNames=new Set(FISCAL_TABLES);
    const referenced=[...source.matchAll(/\bfiscal\.([a-z][a-z0-9_]*)\s*\(/g)]
      .map((match)=>match[1]!)
      .filter((name)=>!tableNames.has(name as typeof FISCAL_TABLES[number]));
    expect([...new Set(referenced)].sort()).toEqual([...FISCAL_003_REQUIRED_FUNCTIONS].sort());
    expect(Object.keys(FISCAL_003_FUNCTION_DEFINITION_SQL).sort()).toEqual([...FISCAL_003_REQUIRED_FUNCTIONS].sort());
    for(const name of FISCAL_003_REQUIRED_FUNCTIONS){
      const sql=FISCAL_003_FUNCTION_DEFINITION_SQL[name as keyof typeof FISCAL_003_FUNCTION_DEFINITION_SQL];
      expect(sql).toContain(`CREATE FUNCTION fiscal.${name}`);
      expect(sql.length).toBeGreaterThan(120);
      expect(sql).not.toMatch(/BEGIN\s*RETURN NEW;\s*END;/);
    }
  });

  it("locks the critical Modelo A function bodies, not trigger names only", () => {
    expect(FISCAL_003_FUNCTION_DEFINITION_SQL.guard_submission_attempt_root)
      .toContain("dispatch.fiscal_request_semantic_checksum<>NEW.request_checksum");
    expect(FISCAL_003_FUNCTION_DEFINITION_SQL.guard_submission_attempt_root)
      .toContain("binding.status<>'ACTIVE'");
    expect(FISCAL_003_FUNCTION_DEFINITION_SQL.guard_attempt_number)
      .toContain("integration_dispatch_id=NEW.integration_dispatch_id");
    expect(FISCAL_003_FUNCTION_DEFINITION_SQL.guard_fiscal_dispatch)
      .toContain("FISCAL_SUBMIT_DISPATCH_V1");
    expect(FISCAL_003_FUNCTION_DEFINITION_SQL.guard_fiscal_dispatch)
      .toContain("NEW.payload_checksum<>prep.canonical_payload_checksum");
    expect(FISCAL_003_FUNCTION_DEFINITION_SQL.guard_electronic_document_reprepare)
      .toContain("durable external evidence blocks reprepare");
    expect(FISCAL_003_FUNCTION_DEFINITION_SQL.validate_current_fiscal_preparation_invariant)
      .toContain("exactly one current fiscal preparation is required");
    expect(FISCAL_003_FUNCTION_DEFINITION_SQL.guard_fiscal_webhook_correlation)
      .toContain("fiscal webhook correlation is immutable once set");
  });

  it("owns the 002 to 003 dispatch-class transition and its fail-closed inverse", () => {
    const transition=FISCAL_003_DISPATCH_CLASS_TRANSITION;
    expect(transition.predecessorName).toBe("integration_dispatches_dispatch_class_002_ck");
    expect(transition.successorName).toBe("integration_dispatches_dispatch_class_003_ck");
    expect(transition.upSql).toEqual([
      expect.stringContaining("ADD CONSTRAINT integration_dispatches_dispatch_class_003_ck"),
      "ALTER TABLE integrations.integration_dispatches VALIDATE CONSTRAINT integration_dispatches_dispatch_class_003_ck;",
      "ALTER TABLE integrations.integration_dispatches DROP CONSTRAINT integration_dispatches_dispatch_class_002_ck;",
    ]);
    expect(transition.upSql[0]).toContain("NOT VALID");
    expect(transition.upSql[0]).toContain("'DEBIT_NOTES'");
    expect(transition.expectedAfterUp).toEqual({
      present:["integration_dispatches_dispatch_class_003_ck"],
      absent:["integration_dispatches_dispatch_class_002_ck"],
    });
    expect(transition.downSql).toEqual([
      expect.stringContaining("ADD CONSTRAINT integration_dispatches_dispatch_class_002_ck"),
      "ALTER TABLE integrations.integration_dispatches VALIDATE CONSTRAINT integration_dispatches_dispatch_class_002_ck;",
      "ALTER TABLE integrations.integration_dispatches DROP CONSTRAINT integration_dispatches_dispatch_class_003_ck;",
    ]);
    expect(transition.downSql[0]).toContain("NOT VALID");
    expect(transition.downSql[0]).not.toContain("'DEBIT_NOTES'");
    expect(transition.downEligibility).toContain("any remaining FISCAL dispatch makes predecessor validation fail closed");
    expect(POSTGRES_003_DESCRIPTOR.exactConstraintDefinitions[transition.successorName])
      .toBe(transition.successorDefinitionSql);
    expect(POSTGRES_003_DESCRIPTOR.ownedConstraints).not.toContain(transition.predecessorName);
    expect(POSTGRES_003_DESCRIPTOR.legacyConstraintTransitions).toBe(transition);
  });

});

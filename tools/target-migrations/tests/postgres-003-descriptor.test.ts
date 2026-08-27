import { FISCAL_003_FUNCTION_DEFINITION_SQL, FISCAL_003_REQUIRED_FUNCTIONS } from "../src/postgres-003-functions.js";
import { FISCAL_003_EXTERNAL_FENCE_CONTRACTS } from "../src/postgres-003-external-contracts.js";
import {
  FISCAL_003_DISPATCH_CLASS_TRANSITION,
  FISCAL_003_RECEIPT_UPDATE_GUARD_TRANSITION,
  FISCAL_003_RECEIPT_INGRESS_GRANT_TRANSITION,
  FISCAL_003_DISPATCH_INGRESS_GRANT_TRANSITION,
  FISCAL_003_LOCK_ROW_PRIVILEGE_TRANSITION,
  FISCAL_003_LEGACY_GRANT_TRANSITIONS,
} from "../src/postgres-003-transitions.js";
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

  it("revalidates preparation through the canonical capability prefix before the precedence/document fence", () => {
    const sql=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_fiscal_preparation_insert;
    expect(sql).toContain("preparation requires SUPPORTED adapter capability declaration");
    expect(sql).toContain("preparation adapter version is absent or retired");
    expect(sql).toContain("preparation requires stable ACTIVE ExternalIntegration identity");
    expect(sql).toContain("preparation requires effective SUPPORTED integration capability");
    expect(sql).toContain("FROM fiscal.fiscal_connections c");
    expect(sql).toContain("FOR UPDATE;");
    expect(sql).toContain("transaction_timestamp()>=connection_valid_until");
    expect(sql).toContain("v.status='PUBLISHED'");
    expect(sql).toContain("cfg.scope_type='BRANCH' AND cfg.branch_id=document_branch_pre");
    expect(sql).toContain("cfg.scope_type='COMPANY' AND cfg.branch_id IS NULL");
    expect(sql).toContain("selected_version_id<>NEW.emission_configuration_version_id");
    expect(sql).toContain("preparation document changed during canonical lock acquisition");
  });

  it("requires atomic reprepare closure of predecessor preparation, dispatch and reserved numbering", () => {
    const sql=FISCAL_003_FUNCTION_DEFINITION_SQL.validate_current_fiscal_preparation_invariant;
    expect(sql).toContain("prior.preparation_state='CANCELLED'");
    expect(sql).toContain("d.status<>'CANCELLED'");
    expect(sql).toContain("d.fiscal_preparation_generation=current_generation-1");
    expect(sql).toContain("prior.numbering_state='RESERVED'");
    expect(sql).toContain("released-without-reuse or burned before reprepare commit");
  });

  it("freezes published configuration material and permits only monotonic operational cursor advancement", () => {
    const sql=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_configuration_version_state;
    expect(sql).toContain("published configuration material is immutable");
    expect(sql).toContain("next_number_value','numbering_exhausted_at','updated_at','row_version");
    expect(sql).toContain("published numbering cursor cannot move backwards");
    expect(sql).toContain("numbering exhaustion is write-once");
    expect(sql).toContain("terminal configuration version cannot transition again");
  });

  it("makes FiscalConnection closure irreversible and CAS-versioned", () => {
    const sql=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_connection_scope;
    expect(sql).toContain("fiscal connection version must increment exactly one");
    expect(sql).toContain("closed fiscal connection cannot be reopened, extended or rewritten");
    expect(sql).toContain("OLD.valid_until IS NULL AND NEW.valid_until IS NOT NULL");
  });

  it("binds every preparation to the exact document branch at insert and deferred commit", () => {
    expect(FISCAL_003_FUNCTION_DEFINITION_SQL.guard_fiscal_preparation_insert)
      .toContain("document_branch<>NEW.branch_id");
    expect(FISCAL_003_FUNCTION_DEFINITION_SQL.validate_current_fiscal_preparation_invariant)
      .toContain("p.branch_id<>document_branch");
  });

  it("limits CANCELLED late numbering to admissible remote evidence only", () => {
    const sql=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_fiscal_preparation_late_evidence;
    expect(sql).toContain("authentication_verification_result='VERIFIED'");
    expect(sql).toContain("replay_verification_result='VERIFIED'");
    expect(sql).toContain("OLD.numbering_mode NOT IN ('PROVIDER_ASSIGNED','AUTHORITY_ASSIGNED')");
    expect(sql).toContain("OLD.numbering_state<>'PENDING_EXTERNAL'");
    expect(sql).toContain("NEW.numbering_state NOT IN ('CONSUMED','UNKNOWN_OUTCOME')");
    expect(sql).toContain("NEW.number IS NULL");
    expect(sql).toContain("cancelled preparation permits only evidence-backed late remote numbering");
    expect(FISCAL_003_FUNCTION_DEFINITION_SQL.guard_fiscal_preparation_numbering)
      .toContain("cancelled numbering is immutable except late remote evidence resolution");
  });

  it("serializes admissible webhook correlation with the document/preparation/dispatch fence", () => {
    const sql=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_fiscal_webhook_correlation;
    expect(sql).toContain("authentication_verification_result<>'VERIFIED'");
    expect(sql).toContain("replay_verification_result<>'VERIFIED'");
    expect(sql).toContain("FROM fiscal.electronic_documents");
    expect(sql).toContain("FROM fiscal.fiscal_document_preparations");
    expect(sql).toContain("FROM integrations.integration_dispatches");
    expect((sql.match(/FOR UPDATE/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(FISCAL_003_FUNCTION_DEFINITION_SQL.guard_electronic_document_reprepare)
      .toContain("admissible correlated webhook blocks reprepare");
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.webhookCorrelation.deterministicSelector.genericTenantIntegrationMatchForbidden)
      .toBe(true);
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.webhookCorrelation.concurrencyOutcome)
      .toBe("ONE_WINNER_CORRELATOR_OR_REPREPARE");
  });

  it("revalidates the DB-owned claim chain and explicitly pins the external snapshot comparator contract", () => {
    const sql=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_submission_attempt_root;
    expect(sql).toContain("claim requires stable ACTIVE ExternalIntegration identity");
    expect(sql).toContain("claim adapter version is absent or retired");
    expect(sql).toContain("claim requires SUPPORTED adapter capability declaration");
    expect(sql).toContain("claim requires effective SUPPORTED integration capability");
    expect(sql).toContain("claim requires exact ACTIVE credential binding generation");
    expect(sql).toContain("claim requires effective FiscalConnection");
    expect(sql).toContain("claim fiscal configuration drifted from BRANCH-over-COMPANY selection");
    expect(sql).toContain("dispatch.fiscal_request_semantic_checksum<>NEW.request_checksum");
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.frozenEmissionSnapshot.contract)
      .toBe("FISCAL_EMISSION_SNAPSHOT_V2");
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.frozenEmissionSnapshot.requiredFields)
      .toEqual(expect.arrayContaining([
        "provider_id","provider_adapter_version_id","environment",
        "external_integration_configuration_version",
        "integration_routing_material_schema_version",
        "integration_routing_material_checksum",
        "integration_capability_id","integration_capability_version",
      ]));
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.frozenEmissionSnapshot.forbiddenShortcuts)
      .toContain("session GUC/user-supplied attestation is not authoritative snapshot evidence");
    expect(POSTGRES_003_DESCRIPTOR.externalFenceContracts)
      .toBe(FISCAL_003_EXTERNAL_FENCE_CONTRACTS);
  });

  it("re-resolves BRANCH-over-COMPANY configuration under the FiscalConnection coordinator", () => {
    const prepare=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_fiscal_preparation_insert;
    const claim=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_submission_attempt_root;
    const connectionStart=prepare.indexOf("FROM fiscal.fiscal_connections c");
    const candidateStart=prepare.indexOf("FROM fiscal.fiscal_emission_configurations cfg");
    expect(connectionStart).toBeGreaterThan(-1);
    expect(prepare.slice(connectionStart,candidateStart)).toContain("FOR UPDATE;");
    expect(prepare).toContain("ORDER BY CASE WHEN cfg.scope_type='BRANCH' THEN 0 ELSE 1 END");
    expect(prepare).toContain("preparation must use current BRANCH-over-COMPANY published configuration");
    expect(claim).toContain("FOR UPDATE;");
    expect(claim).toContain("claim fiscal configuration drifted from BRANCH-over-COMPANY selection");
  });

  it("locks the claim chain in the authoritative upstream-to-fence order", () => {
    const sql=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_submission_attempt_root;
    const declaration=sql.indexOf("FROM integrations.provider_capability_declarations");
    const adapter=sql.indexOf("FROM integrations.provider_adapter_versions");
    const integration=sql.indexOf("FROM integrations.external_integrations i");
    const capability=sql.indexOf("FROM integrations.integration_capabilities c");
    const binding=sql.indexOf("FROM integrations.integration_credential_bindings");
    const connection=sql.indexOf("FROM fiscal.fiscal_connections c");
    const lockedDocument=sql.indexOf("FROM fiscal.electronic_documents",sql.indexOf("claim fiscal configuration drifted"));
    const lockedPreparation=sql.indexOf("FROM fiscal.fiscal_document_preparations",lockedDocument);
    const dispatch=sql.indexOf("FROM integrations.integration_dispatches",lockedPreparation);
    expect(declaration).toBeGreaterThan(-1);
    expect(declaration).toBeLessThan(adapter);
    expect(adapter).toBeLessThan(integration);
    expect(integration).toBeLessThan(capability);
    expect(capability).toBeLessThan(binding);
    expect(binding).toBeLessThan(connection);
    expect(connection).toBeLessThan(lockedDocument);
    expect(lockedDocument).toBeLessThan(lockedPreparation);
    expect(lockedPreparation).toBeLessThan(dispatch);
  });

  it("does not pretend a receipt trigger can establish caller lock order", () => {
    const selector=FISCAL_003_EXTERNAL_FENCE_CONTRACTS.webhookCorrelation.deterministicSelector;
    expect(selector.receiptMutationPrecondition)
      .toBe("CALLER_LOCKS_DOCUMENT_PREPARATION_DISPATCH_BEFORE_RECEIPT_INSERT_OR_UPDATE");
    expect(selector.receiptTriggerRole).toBe("AFTER_FISCAL_LINKAGE_WRITE_REVALIDATION_AND_HISTORICAL_QUARANTINE_NOT_LOCK_ORDER_ACQUISITION");
    expect(selector.normalProcessingUpdatesBypassFiscalFence).toBe(true);
  });

  it("locks preparation selection in the universal authoritative order", () => {
    const sql=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_fiscal_preparation_insert;
    const declaration=sql.indexOf("FROM integrations.provider_capability_declarations");
    const adapter=sql.indexOf("FROM integrations.provider_adapter_versions");
    const integration=sql.indexOf("FROM integrations.external_integrations i");
    const capability=sql.indexOf("FROM integrations.integration_capabilities c");
    const connection=sql.indexOf("FROM fiscal.fiscal_connections c");
    const configuration=sql.indexOf("FROM fiscal.fiscal_emission_configurations cfg");
    const lockedDocument=sql.lastIndexOf("FROM fiscal.electronic_documents");
    const predecessor=sql.indexOf("FROM fiscal.fiscal_document_preparations",lockedDocument);
    expect(declaration).toBeGreaterThan(-1);
    expect(declaration).toBeLessThan(adapter);
    expect(adapter).toBeLessThan(integration);
    expect(integration).toBeLessThan(capability);
    expect(capability).toBeLessThan(connection);
    expect(connection).toBeLessThan(configuration);
    expect(configuration).toBeLessThan(lockedDocument);
    expect(lockedDocument).toBeLessThan(predecessor);
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.preparationSelection.phantomFence)
      .toBe("FISCAL_CONNECTION_FOR_UPDATE_BEFORE_BRANCH_COMPANY_CANDIDATE_SCAN");
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.preparationSelection.callerPrecondition)
      .toBe("PREPARATION_COMMAND_MUST_NOT_PRELOCK_A_SUCCESSOR_BEFORE_THE_CANONICAL_PREFIX");
  });

  it("uses FOR UPDATE on ProviderCapabilityDeclaration for both preparation and claim", () => {
    for(const sql of [
      FISCAL_003_FUNCTION_DEFINITION_SQL.guard_fiscal_preparation_insert,
      FISCAL_003_FUNCTION_DEFINITION_SQL.guard_submission_attempt_root,
    ]){
      const start=sql.indexOf("FROM integrations.provider_capability_declarations");
      expect(start).toBeGreaterThan(-1);
      const tail=sql.slice(start,sql.indexOf("IF NOT FOUND",start));
      expect(tail).toContain("FOR UPDATE;");
      expect(tail).not.toContain("FOR SHARE;");
    }
  });

  it("grants only immutable identity sentinels required by PostgreSQL row locks", () => {
    const transition=FISCAL_003_LOCK_ROW_PRIVILEGE_TRANSITION;
    expect(transition.mechanism).toBe("COLUMN_SCOPED_UPDATE_ON_IMMUTABLE_IDENTITY_SENTINELS");
    expect(transition.upSql).toEqual([
      "GRANT UPDATE (id) ON integrations.provider_capability_declarations TO pos_app,pos_worker;",
      "GRANT UPDATE (provider_adapter_version_id) ON integrations.provider_adapter_versions TO pos_app,pos_worker;",
      "GRANT UPDATE (id) ON integrations.integration_capabilities TO pos_worker;",
      "GRANT UPDATE (id) ON integrations.integration_credential_bindings TO pos_worker;",
    ]);
    expect(transition.downSql).toEqual([
      "REVOKE UPDATE (id) ON integrations.integration_credential_bindings FROM pos_worker;",
      "REVOKE UPDATE (id) ON integrations.integration_capabilities FROM pos_worker;",
      "REVOKE UPDATE (provider_adapter_version_id) ON integrations.provider_adapter_versions FROM pos_app,pos_worker;",
      "REVOKE UPDATE (id) ON integrations.provider_capability_declarations FROM pos_app,pos_worker;",
    ]);
    expect(FISCAL_003_GRANT_MATRIX["fiscal.fiscal_connections"].pos_worker.update).toEqual(["id"]);
    expect(FISCAL_003_GRANT_MATRIX["fiscal.fiscal_emission_configurations"].pos_app.update).toEqual(["id"]);
    expect(FISCAL_003_GRANT_MATRIX["fiscal.fiscal_emission_configurations"].pos_worker.update).toEqual(["id"]);
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.preparationSelection.rowLockExecutionPrivilege)
      .toBe("INVOKER_ONLY_NO_SECURITY_DEFINER");
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.claimExecution.rowLockExecutionPrivilege)
      .toBe("INVOKER_ONLY_NO_SECURITY_DEFINER");
    expect(FISCAL_003_LEGACY_GRANT_TRANSITIONS.lockRows).toBe(transition);
  });

  it("keeps historical-worker preparation RLS non-recursive under FORCE RLS", () => {
    const policy=FISCAL_003_EXACT_POLICY_DEFINITIONS.fiscal_document_preparations_worker_historical_evidence;
    expect(policy).not.toContain("has_correlated_generation_evidence");
    expect(policy).not.toContain("FROM fiscal.fiscal_document_preparations p");
    expect(policy).toContain("fiscal.fiscal_reconciliation_items");
    expect(policy).toContain("VERIFIED_LATE_REMOTE_EVIDENCE_V1");
    expect(policy).toContain("fiscal.fiscal_submission_attempts");
    expect(policy).toContain("integrations.external_webhook_receipts");
    expect(policy).toContain("authentication_verification_result='VERIFIED'");
    expect(policy).toContain("replay_verification_result='VERIFIED'");
  });

  it("requires the claim caller to own the canonical prefix before durable state mutation", () => {
    const claim=FISCAL_003_EXTERNAL_FENCE_CONTRACTS.claimExecution;
    expect(claim.declarationLockMode).toBe("FOR_UPDATE");
    expect(claim.callerPrecondition)
      .toBe("CALLER_ACQUIRES_CANONICAL_UPSTREAM_PREFIX_BEFORE_DOCUMENT_OR_DISPATCH_STATE_CHANGE_AND_ATTEMPT_INSERT");
    expect(claim.attemptTriggerRole).toBe("REVALIDATION_AND_DEFENSE_IN_DEPTH_ONLY");
    expect(claim.durableAtomicBoundary).toEqual(expect.arrayContaining([
      "ElectronicDocument:QUEUED_TO_SUBMITTING",
      "FiscalSubmissionAttempt:IN_PROGRESS",
      "COMMIT_BEFORE_HTTP",
    ]));
  });

  it("limits live outbound eligibility checks to the transition entering IN_PROGRESS", () => {
    const sql=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_submission_attempt_root;
    expect(sql).toContain("entering_in_progress :=");
    expect(sql).toContain("IF NOT entering_in_progress THEN");
    expect(sql.indexOf("IF NOT entering_in_progress THEN")).toBeLessThan(
      sql.indexOf("FROM integrations.provider_capability_declarations")
    );
    expect(sql).toContain("submission attempt root differs from dispatch/preparation root");
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.claimExecution.liveChainRevalidationOnlyWhen)
      .toEqual(["INSERT_IN_PROGRESS","CREATED_TO_IN_PROGRESS"]);
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.claimExecution.postClaimEvidenceUpdate)
      .toBe("STATIC_ROOT_SCOPE_ONLY_LIVE_OUTBOUND_ELIGIBILITY_MAY_DRIFT_AFTER_COMMIT");
  });

  it("requires a durable verified comparator result before cancelled historical fields can change", () => {
    const sql=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_fiscal_preparation_late_evidence;
    expect(sql).toContain("VERIFIED_LATE_REMOTE_EVIDENCE_V1");
    expect(sql).toContain("fiscal.fiscal_reconciliation_items");
    expect(sql).toContain("late remote mutation requires VERIFIED_LATE_REMOTE_EVIDENCE_V1 comparator output");
    expect(sql).toContain("^LATE_REMOTE_EVIDENCE_V1:[0-9a-f]{64}$");
    expect(sql).toContain("late remote numbering values are not bound to verified source evidence");
    const contract=FISCAL_003_EXTERNAL_FENCE_CONTRACTS.lateRemoteEvidence;
    expect(contract.contract).toBe("LATE_REMOTE_EVIDENCE_V1");
    expect(contract.comparatorOutput.resultCode).toBe("VERIFIED_LATE_REMOTE_EVIDENCE_V1");
    expect(contract.comparatorOutput.verifiedMutationProjection)
      .toContain("jsonb_build_array(prefix,number,numbering_state,provider_document_id,provider_reference,provider_status_raw)");
    expect(sql).toContain("ri.expected_state_reference=jsonb_build_array(NEW.prefix,NEW.number,NEW.numbering_state,NEW.provider_document_id,NEW.provider_reference,NEW.provider_status_raw)::text");
    expect(contract.forbidden).toContain("presence of an attempt alone is never authorization to write a number");
  });

  it("quarantines the current generation atomically when historical late evidence appears", () => {
    const late=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_fiscal_preparation_late_evidence;
    expect(late).toContain("current_generation>OLD.preparation_generation");
    expect(late).toContain("status='UNKNOWN_OUTCOME'");
    expect(late).toContain("uncertainty_reason='HISTORICAL_GENERATION_EVIDENCE'");
    const state=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_electronic_document_state;
    expect(state).toContain("historical-generation quarantine requires durable historical evidence");
    expect(state).toContain("p.preparation_generation<OLD.preparation_generation");
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.historicalGenerationQuarantine.sameTransactionRequired)
      .toBe(true);
  });

  it("quarantines current generation after historical webhook correlation in the same transaction", () => {
    const trigger=FISCAL_003_EXACT_GUARD_DEFINITIONS.external_webhook_receipts_fiscal_correlation_guard;
    expect(trigger).toContain("AFTER INSERT OR UPDATE OF fiscal_electronic_document_id,fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_integration_dispatch_id,fiscal_correlated_at");
    expect(trigger).not.toContain("AFTER INSERT OR UPDATE ON");
    const sql=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_fiscal_webhook_correlation;
    expect(sql).not.toContain("SECURITY DEFINER");
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.webhookCorrelation.executionPrivilege)
      .toBe("INVOKER_ONLY_NO_SECURITY_DEFINER");
    expect(sql).toContain("NEW.fiscal_preparation_generation<document_generation");
    expect(sql).toContain("uncertainty_reason='HISTORICAL_GENERATION_EVIDENCE'");
    expect(sql).toContain("version=version+1");
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.webhookCorrelation.historicalCorrelationOutcome)
      .toBe("SAME_TRANSACTION_CURRENT_GENERATION_QUARANTINE");
  });

  it("replaces the legacy receipt update allowlist without a permissive window", () => {
    const transition=FISCAL_003_RECEIPT_UPDATE_GUARD_TRANSITION;
    expect(transition.predecessorName).toBe("external_webhook_receipts_update_guard");
    expect(transition.successorName).toBe("external_webhook_receipts_update_guard_003");
    expect(transition.successorDefinitionSql).toContain("processing_status,attempt_count,next_attempt_at,last_error_code,processed_at,version,fiscal_electronic_document_id,fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_integration_dispatch_id,fiscal_correlated_at");
    expect(transition.upSql).toEqual([
      transition.successorDefinitionSql,
      "DROP TRIGGER external_webhook_receipts_update_guard ON integrations.external_webhook_receipts;",
    ]);
    expect(transition.downSql).toEqual([
      transition.predecessorDefinitionSql,
      "DROP TRIGGER external_webhook_receipts_update_guard_003 ON integrations.external_webhook_receipts;",
    ]);
    expect(transition.expectedAfterUp).toEqual({
      present:["external_webhook_receipts_update_guard_003"],
      absent:["external_webhook_receipts_update_guard"],
    });
    expect(FISCAL_003_EXACT_GUARD_DEFINITIONS[transition.successorName])
      .toBe(transition.successorDefinitionSql);
    expect(POSTGRES_003_DESCRIPTOR.legacyGuardTransitions).toBe(transition);
  });

  it("serializes DRAFT to PUBLISHED through the FiscalConnection coordinator", () => {
    const sql=FISCAL_003_FUNCTION_DEFINITION_SQL.guard_configuration_version_state;
    expect(sql).toContain("transition='DRAFT>PUBLISHED'");
    expect(sql).toContain("FROM fiscal.fiscal_connections c");
    expect(sql).toContain("FOR UPDATE;");
    expect(sql).toContain("publication requires locked FiscalConnection coordinator");
    const publication=FISCAL_003_EXTERNAL_FENCE_CONTRACTS.configurationPublication;
    expect(publication.callerPrecondition)
      .toBe("CALLER_LOCKS_FISCAL_CONNECTION_FOR_UPDATE_BEFORE_DRAFT_TO_PUBLISHED_UPDATE");
    expect(publication.coordinator).toBe("FiscalConnection");
    expect(publication.precedenceProtected).toBe("BRANCH_THEN_COMPANY");
    expect(publication.directPublicationWithoutCoordinator).toBe("FORBIDDEN");
  });

  it("converts webhook ingress from broad 002 INSERT to general-receipt columns only", () => {
    const transition=FISCAL_003_RECEIPT_INGRESS_GRANT_TRANSITION;
    expect(transition.predecessor).toBe("TABLE_INSERT_002");
    expect(transition.successor).toBe("GENERAL_RECEIPT_COLUMN_INSERT_ONLY_003");
    expect(transition.allowedInsertColumns).toEqual([
      "id","tenant_id","company_id","integration_id","deduplication_key","received_at",
      "payload_schema_version","payload_checksum","authentication_verification_result",
      "replay_verification_result","processing_status","attempt_count","correlation_id",
      "provider_event_id","payload_evidence_reference","next_attempt_at","last_error_code",
      "processed_at","created_at","version"
    ]);
    expect(transition.forbiddenFiscalLinkageColumns).toEqual(
      FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.external_webhook_receipts"]
    );
    expect(transition.upSql[0]).toContain("GRANT INSERT (id,tenant_id,company_id,integration_id");
    expect(transition.upSql[1])
      .toBe("REVOKE INSERT ON integrations.external_webhook_receipts FROM pos_platform_app;");
    expect(FISCAL_003_INTEGRATION_EXTENSION_GRANTS["integrations.external_webhook_receipts"].pos_platform_app.insert)
      .toEqual([]);
    expect(POSTGRES_003_DESCRIPTOR.legacyGrantTransitions.receiptIngress).toBe(transition);
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.webhookCorrelation.ingressMode)
      .toBe("GENERAL_RECEIPT_ONLY_FISCAL_LINKAGE_COLUMNS_NULL");
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.webhookCorrelation.fiscalLinkageWriter)
      .toBe("pos_worker");
  });

  it("removes inherited platform INSERT access to fiscal dispatch extensions", () => {
    const transition=FISCAL_003_DISPATCH_INGRESS_GRANT_TRANSITION;
    expect(transition.predecessor).toBe("TABLE_INSERT_002");
    expect(transition.successor).toBe("BASE_DISPATCH_COLUMN_INSERT_ONLY_003");
    expect(transition.allowedInsertColumns).toEqual([
      "id","tenant_id","company_id","integration_id","capability_code","dispatch_class",
      "resource_type","internal_operation_id","internal_entity_type","internal_entity_id",
      "idempotency_key","payload_schema_version","payload_checksum","status","correlation_id",
      "provider_request_reference","retry_classification","next_attempt_at","last_reconciled_at",
      "causation_id","created_at","updated_at","version"
    ]);
    expect(transition.forbiddenFiscalExtensionColumns)
      .toEqual(FISCAL_003_INTEGRATION_EXTENSION_COLUMNS["integrations.integration_dispatches"]);
    expect(transition.upSql[0])
      .toContain("GRANT INSERT (id,tenant_id,company_id,integration_id,capability_code");
    expect(transition.upSql[1])
      .toBe("REVOKE INSERT ON integrations.integration_dispatches FROM pos_platform_app;");
    expect(FISCAL_003_INTEGRATION_EXTENSION_GRANTS["integrations.integration_dispatches"].pos_platform_app.insert)
      .toEqual([]);
    expect(POSTGRES_003_DESCRIPTOR.legacyGrantTransitions.dispatchIngress).toBe(transition);
    expect(POSTGRES_003_DESCRIPTOR.legacyGrantTransitions)
      .toBe(FISCAL_003_LEGACY_GRANT_TRANSITIONS);
    expect(FISCAL_003_EXTERNAL_FENCE_CONTRACTS.dispatchIngress.platformMode)
      .toBe("BASE_002_COLUMNS_ONLY_NON_FISCAL");
  });

});

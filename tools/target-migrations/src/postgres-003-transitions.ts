export const FISCAL_003_DISPATCH_CLASS_TRANSITION = {
  table: "integrations.integration_dispatches",
  predecessorName: "integration_dispatches_dispatch_class_002_ck",
  successorName: "integration_dispatches_dispatch_class_003_ck",
  predecessorDefinitionSql: "CONSTRAINT integration_dispatches_dispatch_class_002_ck CHECK (dispatch_class='NON_FISCAL' AND capability_code NOT IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','SUPPORT_DOCUMENTS') AND internal_entity_type<>'ElectronicDocument')",
  successorDefinitionSql: "CONSTRAINT integration_dispatches_dispatch_class_003_ck CHECK ((dispatch_class='FISCAL' AND capability_code IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS') AND resource_type='ELECTRONIC_DOCUMENT' AND internal_entity_type='ElectronicDocument') OR (dispatch_class='NON_FISCAL' AND capability_code NOT IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS') AND internal_entity_type<>'ElectronicDocument'))",
  upSql: [
    "ALTER TABLE integrations.integration_dispatches ADD CONSTRAINT integration_dispatches_dispatch_class_003_ck CHECK ((dispatch_class='FISCAL' AND capability_code IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS') AND resource_type='ELECTRONIC_DOCUMENT' AND internal_entity_type='ElectronicDocument') OR (dispatch_class='NON_FISCAL' AND capability_code NOT IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS') AND internal_entity_type<>'ElectronicDocument')) NOT VALID;",
    "ALTER TABLE integrations.integration_dispatches VALIDATE CONSTRAINT integration_dispatches_dispatch_class_003_ck;",
    "ALTER TABLE integrations.integration_dispatches DROP CONSTRAINT integration_dispatches_dispatch_class_002_ck;"
  ],
  downEligibility: [
    "predecessor validation must succeed before successor retirement",
    "any remaining FISCAL dispatch makes predecessor validation fail closed",
    "down never deletes or rewrites dispatch rows to manufacture eligibility"
  ],
  downSql: [
    "ALTER TABLE integrations.integration_dispatches ADD CONSTRAINT integration_dispatches_dispatch_class_002_ck CHECK (dispatch_class='NON_FISCAL' AND capability_code NOT IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','SUPPORT_DOCUMENTS') AND internal_entity_type<>'ElectronicDocument') NOT VALID;",
    "ALTER TABLE integrations.integration_dispatches VALIDATE CONSTRAINT integration_dispatches_dispatch_class_002_ck;",
    "ALTER TABLE integrations.integration_dispatches DROP CONSTRAINT integration_dispatches_dispatch_class_003_ck;"
  ],
  expectedAfterUp: {
    present: ["integration_dispatches_dispatch_class_003_ck"],
    absent: ["integration_dispatches_dispatch_class_002_ck"]
  },
  expectedAfterDown: {
    present: ["integration_dispatches_dispatch_class_002_ck"],
    absent: ["integration_dispatches_dispatch_class_003_ck"]
  }
} as const;


export const FISCAL_003_RECEIPT_UPDATE_GUARD_TRANSITION = {
  table: "integrations.external_webhook_receipts",
  predecessorName: "external_webhook_receipts_update_guard",
  successorName: "external_webhook_receipts_update_guard_003",
  predecessorDefinitionSql: "CREATE TRIGGER external_webhook_receipts_update_guard BEFORE UPDATE ON integrations.external_webhook_receipts FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('processing_status,attempt_count,next_attempt_at,last_error_code,processed_at,version');",
  successorDefinitionSql: "CREATE TRIGGER external_webhook_receipts_update_guard_003 BEFORE UPDATE ON integrations.external_webhook_receipts FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('processing_status,attempt_count,next_attempt_at,last_error_code,processed_at,version,fiscal_electronic_document_id,fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_integration_dispatch_id,fiscal_correlated_at');",
  upSql: [
    "CREATE TRIGGER external_webhook_receipts_update_guard_003 BEFORE UPDATE ON integrations.external_webhook_receipts FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('processing_status,attempt_count,next_attempt_at,last_error_code,processed_at,version,fiscal_electronic_document_id,fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_integration_dispatch_id,fiscal_correlated_at');",
    "DROP TRIGGER external_webhook_receipts_update_guard ON integrations.external_webhook_receipts;"
  ],
  downSql: [
    "CREATE TRIGGER external_webhook_receipts_update_guard BEFORE UPDATE ON integrations.external_webhook_receipts FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('processing_status,attempt_count,next_attempt_at,last_error_code,processed_at,version');",
    "DROP TRIGGER external_webhook_receipts_update_guard_003 ON integrations.external_webhook_receipts;"
  ],
  expectedAfterUp: {
    present: ["external_webhook_receipts_update_guard_003"],
    absent: ["external_webhook_receipts_update_guard"]
  },
  expectedAfterDown: {
    present: ["external_webhook_receipts_update_guard"],
    absent: ["external_webhook_receipts_update_guard_003"]
  },
  safety: [
    "successor is created before predecessor is dropped",
    "while both exist the narrower 002 guard remains fail-closed",
    "down restores the narrower 002 guard before removing the 003 successor"
  ]
} as const;


export const FISCAL_003_RECEIPT_GENERAL_INGRESS_COLUMNS = [
  "id","tenant_id","company_id","integration_id","deduplication_key","received_at",
  "payload_schema_version","payload_checksum","authentication_verification_result",
  "replay_verification_result","processing_status","attempt_count","correlation_id",
  "provider_event_id","payload_evidence_reference","next_attempt_at","last_error_code",
  "processed_at","created_at","version"
] as const;

const FISCAL_003_RECEIPT_GENERAL_INGRESS_COLUMN_LIST =
  FISCAL_003_RECEIPT_GENERAL_INGRESS_COLUMNS.join(",");

export const FISCAL_003_RECEIPT_INGRESS_GRANT_TRANSITION = {
  table: "integrations.external_webhook_receipts",
  role: "pos_platform_app",
  predecessor: "TABLE_INSERT_002",
  successor: "GENERAL_RECEIPT_COLUMN_INSERT_ONLY_003",
  allowedInsertColumns: FISCAL_003_RECEIPT_GENERAL_INGRESS_COLUMNS,
  forbiddenFiscalLinkageColumns: [
    "fiscal_electronic_document_id",
    "fiscal_document_preparation_id",
    "fiscal_preparation_generation",
    "fiscal_integration_dispatch_id",
    "fiscal_correlated_at"
  ],
  upSql: [
    "REVOKE INSERT ON integrations.external_webhook_receipts FROM pos_platform_app;",
    `GRANT INSERT (${FISCAL_003_RECEIPT_GENERAL_INGRESS_COLUMN_LIST}) ON integrations.external_webhook_receipts TO pos_platform_app;`
  ],
  downSql: [
    "GRANT INSERT ON integrations.external_webhook_receipts TO pos_platform_app;",
    `REVOKE INSERT (${FISCAL_003_RECEIPT_GENERAL_INGRESS_COLUMN_LIST}) ON integrations.external_webhook_receipts FROM pos_platform_app;`
  ],
  safety: [
    "revoke broad table INSERT before granting base-column INSERT",
    "after up, webhook ingress can persist only general receipt columns",
    "fiscal linkage is NULL at ingress and can be written only by pos_worker under the correlation fence",
    "down restores table INSERT before removing the temporary column grant"
  ]
} as const;


export const FISCAL_003_DISPATCH_PLATFORM_INGRESS_COLUMNS = [
  "id","tenant_id","company_id","integration_id","capability_code","dispatch_class",
  "resource_type","internal_operation_id","internal_entity_type","internal_entity_id",
  "idempotency_key","payload_schema_version","payload_checksum","status","correlation_id",
  "provider_request_reference","retry_classification","next_attempt_at","last_reconciled_at",
  "causation_id","created_at","updated_at","version"
] as const;

const FISCAL_003_DISPATCH_PLATFORM_INGRESS_COLUMN_LIST =
  FISCAL_003_DISPATCH_PLATFORM_INGRESS_COLUMNS.join(",");

export const FISCAL_003_DISPATCH_INGRESS_GRANT_TRANSITION = {
  table: "integrations.integration_dispatches",
  role: "pos_platform_app",
  predecessor: "TABLE_INSERT_002",
  successor: "BASE_DISPATCH_COLUMN_INSERT_ONLY_003",
  allowedInsertColumns: FISCAL_003_DISPATCH_PLATFORM_INGRESS_COLUMNS,
  forbiddenFiscalExtensionColumns: [
    "fiscal_document_preparation_id",
    "fiscal_preparation_generation",
    "fiscal_request_semantic_version",
    "fiscal_request_semantic_checksum"
  ],
  upSql: [
    `GRANT INSERT (${FISCAL_003_DISPATCH_PLATFORM_INGRESS_COLUMN_LIST}) ON integrations.integration_dispatches TO pos_platform_app;`,
    "REVOKE INSERT ON integrations.integration_dispatches FROM pos_platform_app;"
  ],
  downSql: [
    "GRANT INSERT ON integrations.integration_dispatches TO pos_platform_app;",
    `REVOKE INSERT (${FISCAL_003_DISPATCH_PLATFORM_INGRESS_COLUMN_LIST}) ON integrations.integration_dispatches FROM pos_platform_app;`
  ],
  safety: [
    "grant base-column INSERT before revoking inherited table INSERT",
    "pos_platform_app keeps non-fiscal/base dispatch creation capability",
    "fiscal extension columns remain unavailable to pos_platform_app",
    "pos_app remains the tenant fiscal dispatch creator",
    "down restores the exact migration002 table INSERT before removing the column grant"
  ]
} as const;

export const FISCAL_003_LOCK_ROW_PRIVILEGE_TRANSITION = {
  purpose: "ALLOW_CANONICAL_ROW_LOCKS_WITHOUT_BUSINESS_COLUMN_MUTATION",
  mechanism: "COLUMN_SCOPED_UPDATE_ON_IMMUTABLE_IDENTITY_SENTINELS",
  grants: [
    { table: "integrations.provider_capability_declarations", roles: ["pos_app","pos_worker"], column: "id" },
    { table: "integrations.provider_adapter_versions", roles: ["pos_app","pos_worker"], column: "provider_adapter_version_id" },
    { table: "integrations.integration_capabilities", roles: ["pos_worker"], column: "id" },
    { table: "integrations.integration_credential_bindings", roles: ["pos_worker"], column: "id" },
    { table: "integrations.external_webhook_receipts", roles: ["pos_app"], column: "id" },
  ],
  upSql: [
    "GRANT UPDATE (id) ON integrations.provider_capability_declarations TO pos_app,pos_worker;",
    "GRANT UPDATE (provider_adapter_version_id) ON integrations.provider_adapter_versions TO pos_app,pos_worker;",
    "GRANT UPDATE (id) ON integrations.integration_capabilities TO pos_worker;",
    "GRANT UPDATE (id) ON integrations.integration_credential_bindings TO pos_worker;",
    "GRANT UPDATE (id) ON integrations.external_webhook_receipts TO pos_app;",
  ],
  downSql: [
    "REVOKE UPDATE (id) ON integrations.external_webhook_receipts FROM pos_app;",
    "REVOKE UPDATE (id) ON integrations.integration_credential_bindings FROM pos_worker;",
    "REVOKE UPDATE (id) ON integrations.integration_capabilities FROM pos_worker;",
    "REVOKE UPDATE (provider_adapter_version_id) ON integrations.provider_adapter_versions FROM pos_app,pos_worker;",
    "REVOKE UPDATE (id) ON integrations.provider_capability_declarations FROM pos_app,pos_worker;",
  ],
  safety: [
    "PostgreSQL row-locking clauses require UPDATE on at least one selected-table column",
    "only immutable identity sentinels receive UPDATE privilege",
    "existing 002 update guards reject identity mutation",
    "no SECURITY DEFINER lock helper and no business-column UPDATE widening",
    "down revokes every 003 lock-only privilege and restores the exact 002 privilege surface",
  ],
} as const;

export const FISCAL_003_LEGACY_GRANT_TRANSITIONS = {
  receiptIngress: FISCAL_003_RECEIPT_INGRESS_GRANT_TRANSITION,
  dispatchIngress: FISCAL_003_DISPATCH_INGRESS_GRANT_TRANSITION,
  lockRows: FISCAL_003_LOCK_ROW_PRIVILEGE_TRANSITION,
} as const;

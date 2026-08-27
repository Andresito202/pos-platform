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

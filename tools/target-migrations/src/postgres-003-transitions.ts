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

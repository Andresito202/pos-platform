import { FISCAL_003_FUNCTION_DEFINITION_SQL } from "./postgres-003-functions.js";
import { FISCAL_003_EXTERNAL_FENCE_CONTRACTS } from "./postgres-003-external-contracts.js";
import { FISCAL_003_DISPATCH_CLASS_TRANSITION, FISCAL_003_RECEIPT_UPDATE_GUARD_TRANSITION } from "./postgres-003-transitions.js";
import {
  FISCAL_003_EXACT_CONSTRAINT_DEFINITIONS,
  FISCAL_003_EXACT_GUARD_DEFINITIONS,
  FISCAL_003_EXACT_INDEX_DEFINITIONS,
  FISCAL_003_EXACT_POLICY_DEFINITIONS,
} from "./postgres-003-blueprint.js";

export interface FiscalColumnDefinition {
  type: string;
  nullable: boolean;
  defaultSql: string | null;
}
const c=(type:string,nullable=false,defaultSql:string|null=null):FiscalColumnDefinition=>({type,nullable,defaultSql});

export const FISCAL_003_CATALOG_DEFINITIONS = {
  columns: {
    "fiscal.fiscal_connections": {
      id:c("uuid"),tenant_id:c("uuid"),company_id:c("uuid"),external_integration_id:c("uuid"),
      electronic_invoicing_capability_id:c("uuid"),capability_code:c("text",false,"'ELECTRONIC_INVOICING'"),
      valid_from:c("timestamptz"),valid_until:c("timestamptz",true),created_at:c("timestamptz"),
      updated_at:c("timestamptz"),version:c("bigint",false,"1"),
    },
    "fiscal.fiscal_emission_configurations": {
      id:c("uuid"),tenant_id:c("uuid"),company_id:c("uuid"),branch_id:c("uuid",true),scope_type:c("text"),
      fiscal_connection_id:c("uuid"),external_integration_id:c("uuid"),document_type:c("text"),created_at:c("timestamptz"),
    },
    "fiscal.fiscal_emission_configuration_versions": {
      id:c("uuid"),tenant_id:c("uuid"),company_id:c("uuid"),branch_id:c("uuid",true),scope_type:c("text"),
      fiscal_connection_id:c("uuid"),external_integration_id:c("uuid"),fiscal_emission_configuration_id:c("uuid"),
      document_type:c("text"),version_number:c("bigint"),status:c("text"),issuer_tax_id_normalized_snapshot:c("text"),
      issuer_legal_name_snapshot:c("text"),authorization_reference:c("text",true),numbering_policy_code:c("text"),
      prefix:c("text",true),number_range_start:c("bigint",true),number_range_end:c("bigint",true),
      next_number_value:c("bigint",true),numbering_exhausted_at:c("timestamptz",true),
      provider_numbering_reference:c("text",true),certificate_reference:c("text",true),
      contingency_policy_reference:c("text",true),fiscal_capabilities_snapshot_reference:c("text"),
      fiscal_capabilities_snapshot_checksum:c("text"),configuration_schema_version:c("integer"),
      configuration_checksum:c("text"),valid_from:c("timestamptz"),valid_until:c("timestamptz",true),
      published_at:c("timestamptz",true),supersedes_version_id:c("uuid",true),created_by_actor_id:c("uuid"),
      published_by_actor_id:c("uuid",true),created_at:c("timestamptz"),updated_at:c("timestamptz"),
      row_version:c("bigint",false,"1"),
    },
    "fiscal.electronic_documents": {
      id:c("uuid"),tenant_id:c("uuid"),company_id:c("uuid"),branch_id:c("uuid"),source_type:c("text"),
      source_id:c("uuid"),document_type:c("text"),logical_operation_key:c("text"),status:c("text"),
      internal_reference:c("text"),preparation_generation:c("bigint",false,"1"),
      authority_reference:c("text",true),legal_identifier:c("text",true),authority_status_raw:c("text",true),
      uncertainty_reason:c("text",true),original_electronic_document_id:c("uuid",true),
      issued_at:c("timestamptz",true),accepted_at:c("timestamptz",true),rejected_at:c("timestamptz",true),
      last_reconciled_at:c("timestamptz",true),created_at:c("timestamptz"),updated_at:c("timestamptz"),
      version:c("bigint",false,"1"),
    },
    "fiscal.fiscal_document_preparations": {
      id:c("uuid"),tenant_id:c("uuid"),company_id:c("uuid"),branch_id:c("uuid"),electronic_document_id:c("uuid"),
      document_type:c("text"),preparation_generation:c("bigint"),supersedes_preparation_id:c("uuid",true),
      preparation_state:c("text"),external_integration_id:c("uuid"),fiscal_connection_id:c("uuid"),
      fiscal_emission_configuration_id:c("uuid"),emission_configuration_version_id:c("uuid"),source_version:c("bigint"),
      correction_source_reference:c("text",true),currency_code:c("char(3)"),subtotal_amount:c("numeric(19,6)"),
      discount_amount:c("numeric(19,6)"),tax_amount:c("numeric(19,6)"),total_amount:c("numeric(19,6)"),
      tax_snapshot_reference:c("text"),tax_snapshot_checksum:c("text"),fiscal_emission_snapshot_reference:c("text"),
      fiscal_emission_snapshot_checksum:c("text"),canonical_payload_version:c("integer"),canonical_payload_checksum:c("text"),
      numbering_mode:c("text"),numbering_state:c("text"),prefix:c("text",true),number:c("text",true),
      number_reserved_at:c("timestamptz",true),number_consumed_at:c("timestamptz",true),number_burned_at:c("timestamptz",true),
      numbering_resolution_reason:c("text",true),provider_document_id:c("text",true),provider_reference:c("text",true),
      provider_status_raw:c("text",true),created_by_actor_id:c("uuid"),frozen_at:c("timestamptz",true),
      cancelled_at:c("timestamptz",true),cancelled_by_actor_id:c("uuid",true),cancellation_reason:c("text",true),
      created_at:c("timestamptz"),updated_at:c("timestamptz"),version:c("bigint",false,"1"),
    },
    "fiscal.fiscal_submission_attempts": {
      id:c("uuid"),tenant_id:c("uuid"),company_id:c("uuid"),external_integration_id:c("uuid"),fiscal_connection_id:c("uuid"),
      electronic_document_id:c("uuid"),fiscal_document_preparation_id:c("uuid"),preparation_generation:c("bigint"),
      integration_dispatch_id:c("uuid"),credential_binding_id:c("uuid"),credential_binding_generation:c("integer"),
      dispatch_class:c("text",false,"'FISCAL'"),operation_type:c("text"),attempt_number:c("integer"),status:c("text"),
      transport_status:c("text",true),normalized_result:c("text",true),request_id:c("text"),idempotency_key:c("text"),
      request_checksum:c("text"),provider_operation_id:c("text",true),provider_correlation_reference:c("text",true),
      provider_response_reference:c("text",true),http_status:c("integer",true),provider_code_raw:c("text",true),
      retry_classification:c("text",true),error_code:c("text",true),retry_after_at:c("timestamptz",true),
      started_at:c("timestamptz",true),completed_at:c("timestamptz",true),correlation_id:c("uuid"),
      causation_id:c("uuid",true),created_at:c("timestamptz"),version:c("bigint",false,"1"),
    },
    "fiscal.fiscal_artifacts": {
      id:c("uuid"),tenant_id:c("uuid"),company_id:c("uuid"),external_integration_id:c("uuid"),
      electronic_document_id:c("uuid"),fiscal_document_preparation_id:c("uuid"),preparation_generation:c("bigint"),
      fiscal_submission_attempt_id:c("uuid",true),artifact_type:c("text"),media_type:c("text"),storage_reference:c("text"),
      checksum_algorithm:c("text"),checksum:c("text"),size_bytes:c("bigint",true),provider_reference:c("text",true),
      authority_reference:c("text",true),retention_policy_reference:c("text"),immutable_evidence:c("boolean"),
      created_at:c("timestamptz"),
    },
    "fiscal.fiscal_reconciliations": {
      id:c("uuid"),tenant_id:c("uuid"),company_id:c("uuid"),branch_id:c("uuid",true),external_integration_id:c("uuid"),
      fiscal_connection_id:c("uuid"),scope_type:c("text"),electronic_document_id:c("uuid",true),
      preparation_generation:c("bigint",true),scope_snapshot_reference:c("text"),scope_snapshot_checksum:c("text"),
      status:c("text"),expected_state_snapshot_reference:c("text"),observed_state_snapshot_reference:c("text",true),
      provider_evidence_reference:c("text",true),authority_evidence_reference:c("text",true),
      discrepancy_summary_code:c("text",true),started_by_actor_id:c("uuid"),reviewed_by_actor_id:c("uuid",true),
      closed_by_actor_id:c("uuid",true),resolution_reason:c("text",true),started_at:c("timestamptz",true),
      closed_at:c("timestamptz",true),correlation_id:c("uuid"),causation_id:c("uuid",true),created_at:c("timestamptz"),
      updated_at:c("timestamptz"),version:c("bigint",false,"1"),
    },
    "fiscal.fiscal_incidents": {
      id:c("uuid"),tenant_id:c("uuid"),company_id:c("uuid"),branch_id:c("uuid",true),external_integration_id:c("uuid"),
      fiscal_connection_id:c("uuid"),electronic_document_id:c("uuid",true),preparation_generation:c("bigint",true),
      fiscal_submission_attempt_id:c("uuid",true),fiscal_reconciliation_id:c("uuid",true),incident_type:c("text"),
      severity:c("text"),status:c("text"),summary_code:c("text"),evidence_reference:c("text"),
      assigned_reviewer_id:c("uuid",true),resolution_type:c("text",true),resolution_reason:c("text",true),
      resolved_by_actor_id:c("uuid",true),resolved_at:c("timestamptz",true),archived_at:c("timestamptz",true),
      correlation_id:c("uuid"),causation_id:c("uuid",true),created_at:c("timestamptz"),updated_at:c("timestamptz"),
      version:c("bigint",false,"1"),
    },
    "fiscal.fiscal_reconciliation_items": {
      id:c("uuid"),tenant_id:c("uuid"),company_id:c("uuid"),external_integration_id:c("uuid"),
      fiscal_connection_id:c("uuid"),fiscal_reconciliation_id:c("uuid"),electronic_document_id:c("uuid"),
      fiscal_document_preparation_id:c("uuid"),preparation_generation:c("bigint"),
      expected_state_reference:c("text"),observed_state_reference:c("text"),evidence_checksum:c("text"),
      discrepancy_code:c("text",true),result_code:c("text"),evidence_reference:c("text"),
      fiscal_incident_id:c("uuid",true),created_at:c("timestamptz"),
    },
    "integrations.integration_dispatches#003": {
      fiscal_document_preparation_id:c("uuid",true),fiscal_preparation_generation:c("bigint",true),
      fiscal_request_semantic_version:c("integer",true),fiscal_request_semantic_checksum:c("text",true),
    },
    "integrations.external_webhook_receipts#003": {
      fiscal_electronic_document_id:c("uuid",true),fiscal_document_preparation_id:c("uuid",true),
      fiscal_preparation_generation:c("bigint",true),fiscal_integration_dispatch_id:c("uuid",true),
      fiscal_correlated_at:c("timestamptz",true),
    },
  },
  constraints: FISCAL_003_EXACT_CONSTRAINT_DEFINITIONS,
  indexes: FISCAL_003_EXACT_INDEX_DEFINITIONS,
  triggers: FISCAL_003_EXACT_GUARD_DEFINITIONS,
  policies: FISCAL_003_EXACT_POLICY_DEFINITIONS,
  functions: FISCAL_003_FUNCTION_DEFINITION_SQL,
  externalFenceContracts: FISCAL_003_EXTERNAL_FENCE_CONTRACTS,
  legacyConstraintTransitions: FISCAL_003_DISPATCH_CLASS_TRANSITION,
  legacyGuardTransitions: FISCAL_003_RECEIPT_UPDATE_GUARD_TRANSITION,
  semanticRules: {
    dispatchRequestIdentity:["fiscal_request_semantic_version >= 1 for FISCAL","fiscal_request_semantic_checksum is lowercase SHA-256 for FISCAL","both semantic fields are NULL for NON_FISCAL","both fields are fixed at dispatch creation and immutable","same idempotency root with different semantic version/checksum is CONFLICT before HTTP"],
    credentialBinding:["exactly one ACTIVE integration credential binding is eligible at claim","each attempt pins credential_binding_id + credential_binding_generation","credential rotation same-account may change binding generation without changing root/checksum","revoked/superseded binding before secret resolution prevents HTTP","no credential_reference or secret is stored on fiscal attempts"],
  },
} as const;

CREATE SCHEMA fiscal AUTHORIZATION pos_schema_owner;

REVOKE ALL ON SCHEMA fiscal FROM PUBLIC;

CREATE FUNCTION fiscal.safe_external_text(value text,max_bytes integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path=pg_catalog
AS $function$
  SELECT value=btrim(value)
     AND value<>''
     AND octet_length(convert_to(value,'UTF8'))<=max_bytes
     AND value!~'[[:cntrl:]]'
     AND value!~*'(authorization|bearer|api[_-]?key|client[_-]?secret|private[ _-]?key|token|jwt|credential)'
$function$;

ALTER TABLE integrations.integration_dispatches ADD COLUMN fiscal_document_preparation_id uuid NULL;

ALTER TABLE integrations.integration_dispatches ADD COLUMN fiscal_preparation_generation bigint NULL;

ALTER TABLE integrations.integration_dispatches ADD COLUMN fiscal_request_semantic_version integer NULL;

ALTER TABLE integrations.integration_dispatches ADD COLUMN fiscal_request_semantic_checksum text NULL;

ALTER TABLE integrations.external_webhook_receipts ADD COLUMN fiscal_electronic_document_id uuid NULL;

ALTER TABLE integrations.external_webhook_receipts ADD COLUMN fiscal_document_preparation_id uuid NULL;

ALTER TABLE integrations.external_webhook_receipts ADD COLUMN fiscal_preparation_generation bigint NULL;

ALTER TABLE integrations.external_webhook_receipts ADD COLUMN fiscal_integration_dispatch_id uuid NULL;

ALTER TABLE integrations.external_webhook_receipts ADD COLUMN fiscal_correlated_at timestamptz NULL;

ALTER TABLE integrations.integration_capabilities ADD CONSTRAINT integration_capabilities_fiscal_scope_uq UNIQUE (tenant_id,company_id,integration_id,id,capability_code);

ALTER TABLE integrations.integration_credential_bindings ADD CONSTRAINT integration_credential_bindings_attempt_scope_uq UNIQUE (tenant_id,company_id,integration_id,id,generation);

CREATE TABLE fiscal.fiscal_connections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  external_integration_id uuid NOT NULL,
  electronic_invoicing_capability_id uuid NOT NULL,
  capability_code text NOT NULL DEFAULT 'ELECTRONIC_INVOICING',
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT fiscal_connections_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT fiscal_connections_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT fiscal_connections_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT fiscal_connections_tenant_company_integration_id_uq UNIQUE (tenant_id,company_id,external_integration_id,id),
  CONSTRAINT fiscal_connections_company_fk FOREIGN KEY (tenant_id,company_id) REFERENCES organization.companies(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_connections_integration_fk FOREIGN KEY (tenant_id,company_id,external_integration_id) REFERENCES integrations.external_integrations(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_connections_capability_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code) REFERENCES integrations.integration_capabilities(tenant_id,company_id,integration_id,id,capability_code) ON DELETE NO ACTION,
  CONSTRAINT fiscal_connections_capability_ck CHECK (capability_code='ELECTRONIC_INVOICING'),
  CONSTRAINT fiscal_connections_validity_ck CHECK (valid_until IS NULL OR valid_from<valid_until),
  CONSTRAINT fiscal_connections_version_ck CHECK (version>0 AND created_at<=updated_at)
);

CREATE TABLE fiscal.fiscal_emission_configurations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NULL,
  scope_type text NOT NULL,
  fiscal_connection_id uuid NOT NULL,
  external_integration_id uuid NOT NULL,
  document_type text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT fiscal_emission_configurations_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT fiscal_emission_configurations_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT fiscal_emission_configurations_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT fiscal_emission_configurations_scope_uq UNIQUE (tenant_id,company_id,external_integration_id,fiscal_connection_id,id,document_type,scope_type),
  CONSTRAINT fiscal_emission_configurations_connection_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id) REFERENCES fiscal.fiscal_connections(tenant_id,company_id,external_integration_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_emission_configurations_branch_fk FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES organization.branches(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_emission_configurations_scope_ck CHECK ((scope_type='COMPANY' AND branch_id IS NULL) OR (scope_type='BRANCH' AND branch_id IS NOT NULL)),
  CONSTRAINT fiscal_emission_configurations_document_type_ck CHECK (document_type IN ('ELECTRONIC_SALES_INVOICE','CREDIT_NOTE','DEBIT_NOTE','SUPPORT_DOCUMENT','SUPPORT_DOCUMENT_ADJUSTMENT'))
);

CREATE TABLE fiscal.fiscal_emission_configuration_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NULL,
  scope_type text NOT NULL,
  fiscal_connection_id uuid NOT NULL,
  external_integration_id uuid NOT NULL,
  fiscal_emission_configuration_id uuid NOT NULL,
  document_type text NOT NULL,
  version_number bigint NOT NULL,
  status text NOT NULL,
  issuer_tax_id_normalized_snapshot text NOT NULL,
  issuer_legal_name_snapshot text NOT NULL,
  authorization_reference text NULL,
  numbering_policy_code text NOT NULL,
  prefix text NULL,
  number_range_start bigint NULL,
  number_range_end bigint NULL,
  next_number_value bigint NULL,
  numbering_exhausted_at timestamptz NULL,
  provider_numbering_reference text NULL,
  certificate_reference text NULL,
  contingency_policy_reference text NULL,
  fiscal_capabilities_snapshot_reference text NOT NULL,
  fiscal_capabilities_snapshot_checksum text NOT NULL,
  configuration_schema_version integer NOT NULL,
  configuration_checksum text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NULL,
  published_at timestamptz NULL,
  supersedes_version_id uuid NULL,
  created_by_actor_id uuid NOT NULL,
  published_by_actor_id uuid NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  row_version bigint NOT NULL DEFAULT 1,
  CONSTRAINT fiscal_emission_configuration_versions_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT fiscal_emission_configuration_versions_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT fiscal_emission_configuration_versions_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT fiscal_emission_configuration_versions_scope_uq UNIQUE (tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,id,document_type),
  CONSTRAINT fiscal_emission_configuration_versions_number_uq UNIQUE (tenant_id,fiscal_emission_configuration_id,version_number),
  CONSTRAINT fiscal_emission_configuration_versions_configuration_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,document_type,scope_type) REFERENCES fiscal.fiscal_emission_configurations(tenant_id,company_id,external_integration_id,fiscal_connection_id,id,document_type,scope_type) ON DELETE NO ACTION,
  CONSTRAINT fiscal_emission_configuration_versions_branch_fk FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES organization.branches(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_emission_configuration_versions_created_by_fk FOREIGN KEY (created_by_actor_id) REFERENCES identity.users(id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_emission_configuration_versions_published_by_fk FOREIGN KEY (published_by_actor_id) REFERENCES identity.users(id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_emission_configuration_versions_scope_ck CHECK ((scope_type='COMPANY' AND branch_id IS NULL) OR (scope_type='BRANCH' AND branch_id IS NOT NULL)),
  CONSTRAINT fiscal_emission_configuration_versions_status_ck CHECK (status IN ('DRAFT','PUBLISHED','SUPERSEDED','REVOKED')),
  CONSTRAINT fiscal_emission_configuration_versions_numbering_ck CHECK ((numbering_policy_code IN ('PROVIDER_ASSIGNED','AUTHORITY_ASSIGNED') AND number_range_start IS NULL AND number_range_end IS NULL AND next_number_value IS NULL AND numbering_exhausted_at IS NULL) OR (numbering_policy_code IN ('AUTHORIZED_RANGE','LOCAL_CONTINGENCY') AND number_range_start IS NOT NULL AND number_range_end IS NOT NULL AND next_number_value IS NOT NULL AND number_range_start>0 AND number_range_end>=number_range_start AND next_number_value BETWEEN number_range_start AND number_range_end+1 AND (numbering_exhausted_at IS NULL)=(next_number_value<=number_range_end))),
  CONSTRAINT fiscal_emission_configuration_versions_checksum_ck CHECK (fiscal_capabilities_snapshot_checksum~'^[0-9a-f]{64}$' AND configuration_checksum~'^[0-9a-f]{64}$' AND configuration_schema_version>0 AND version_number>0 AND row_version>0),
  CONSTRAINT fiscal_emission_configuration_versions_publication_ck CHECK ((status='DRAFT' AND published_at IS NULL AND published_by_actor_id IS NULL AND numbering_exhausted_at IS NULL) OR (status<>'DRAFT' AND published_at IS NOT NULL AND published_by_actor_id IS NOT NULL)),
  CONSTRAINT fiscal_emission_configuration_versions_validity_ck CHECK (valid_until IS NULL OR valid_from<valid_until)
);

CREATE TABLE fiscal.electronic_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  document_type text NOT NULL,
  logical_operation_key text NOT NULL,
  status text NOT NULL,
  internal_reference text NOT NULL,
  preparation_generation bigint NOT NULL DEFAULT 1,
  authority_reference text NULL,
  legal_identifier text NULL,
  authority_status_raw text NULL,
  uncertainty_reason text NULL,
  original_electronic_document_id uuid NULL,
  issued_at timestamptz NULL,
  accepted_at timestamptz NULL,
  rejected_at timestamptz NULL,
  last_reconciled_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT electronic_documents_id_v7_ck CHECK (platform.is_uuid_v7(id) AND platform.is_uuid_v7(source_id) AND (original_electronic_document_id IS NULL OR platform.is_uuid_v7(original_electronic_document_id))),
  CONSTRAINT electronic_documents_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT electronic_documents_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT electronic_documents_document_type_scope_uq UNIQUE (tenant_id,company_id,id,document_type),
  CONSTRAINT electronic_documents_logical_operation_uq UNIQUE (tenant_id,company_id,logical_operation_key),
  CONSTRAINT electronic_documents_branch_fk FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES organization.branches(tenant_id,company_id,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT electronic_documents_original_fk FOREIGN KEY (tenant_id,company_id,original_electronic_document_id) REFERENCES fiscal.electronic_documents(tenant_id,company_id,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT electronic_documents_status_ck CHECK (status IN ('DRAFT','READY','QUEUED','SUBMITTING','ACCEPTED','REJECTED','UNKNOWN_OUTCOME','CONTINGENCY','VOIDED_BEFORE_SUBMISSION')),
  CONSTRAINT electronic_documents_document_type_ck CHECK (document_type IN ('ELECTRONIC_SALES_INVOICE','CREDIT_NOTE','DEBIT_NOTE','SUPPORT_DOCUMENT','SUPPORT_DOCUMENT_ADJUSTMENT')),
  CONSTRAINT electronic_documents_generation_ck CHECK (preparation_generation>=1),
  CONSTRAINT electronic_documents_original_type_ck CHECK (((document_type IN ('CREDIT_NOTE','DEBIT_NOTE','SUPPORT_DOCUMENT_ADJUSTMENT'))=(original_electronic_document_id IS NOT NULL)) AND original_electronic_document_id IS DISTINCT FROM id),
  CONSTRAINT electronic_documents_authority_identity_ck CHECK (fiscal.safe_external_text(internal_reference,512) AND (authority_reference IS NULL OR fiscal.safe_external_text(authority_reference,2048)) AND (legal_identifier IS NULL OR fiscal.safe_external_text(legal_identifier,512)) AND (authority_status_raw IS NULL OR fiscal.safe_external_text(authority_status_raw,256)) AND (uncertainty_reason IS NULL OR fiscal.safe_external_text(uncertainty_reason,1024))),
  CONSTRAINT electronic_documents_timestamps_ck CHECK (created_at<=updated_at AND (accepted_at IS NULL OR issued_at IS NOT NULL) AND (rejected_at IS NULL OR accepted_at IS NULL)),
  CONSTRAINT electronic_documents_version_ck CHECK (version>0)
);

CREATE TABLE fiscal.fiscal_document_preparations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  electronic_document_id uuid NOT NULL,
  document_type text NOT NULL,
  preparation_generation bigint NOT NULL,
  supersedes_preparation_id uuid NULL,
  preparation_state text NOT NULL,
  external_integration_id uuid NOT NULL,
  fiscal_connection_id uuid NOT NULL,
  fiscal_emission_configuration_id uuid NOT NULL,
  emission_configuration_version_id uuid NOT NULL,
  source_version bigint NOT NULL,
  correction_source_reference text NULL,
  currency_code char(3) NOT NULL,
  subtotal_amount numeric(19,6) NOT NULL,
  discount_amount numeric(19,6) NOT NULL,
  tax_amount numeric(19,6) NOT NULL,
  total_amount numeric(19,6) NOT NULL,
  tax_snapshot_reference text NOT NULL,
  tax_snapshot_checksum text NOT NULL,
  fiscal_emission_snapshot_reference text NOT NULL,
  fiscal_emission_snapshot_checksum text NOT NULL,
  canonical_payload_version integer NOT NULL,
  canonical_payload_checksum text NOT NULL,
  numbering_mode text NOT NULL,
  numbering_state text NOT NULL,
  prefix text NULL,
  number text NULL,
  number_reserved_at timestamptz NULL,
  number_consumed_at timestamptz NULL,
  number_burned_at timestamptz NULL,
  numbering_resolution_reason text NULL,
  provider_document_id text NULL,
  provider_reference text NULL,
  provider_status_raw text NULL,
  created_by_actor_id uuid NOT NULL,
  frozen_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  cancelled_by_actor_id uuid NULL,
  cancellation_reason text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT fiscal_document_preparations_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT fiscal_document_preparations_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT fiscal_document_preparations_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT fiscal_document_preparations_document_id_uq UNIQUE (tenant_id,electronic_document_id,id),
  CONSTRAINT fiscal_document_preparations_generation_uq UNIQUE (tenant_id,electronic_document_id,preparation_generation),
  CONSTRAINT fiscal_document_preparations_dispatch_scope_uq UNIQUE (tenant_id,company_id,external_integration_id,electronic_document_id,preparation_generation,id),
  CONSTRAINT fiscal_document_preparations_attempt_scope_uq UNIQUE (tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,preparation_generation,id),
  CONSTRAINT fiscal_document_preparations_document_fk FOREIGN KEY (tenant_id,company_id,electronic_document_id,document_type) REFERENCES fiscal.electronic_documents(tenant_id,company_id,id,document_type) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_document_preparations_branch_fk FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES organization.branches(tenant_id,company_id,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_document_preparations_connection_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id) REFERENCES fiscal.fiscal_connections(tenant_id,company_id,external_integration_id,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_document_preparations_configuration_version_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,document_type) REFERENCES fiscal.fiscal_emission_configuration_versions(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,id,document_type) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_document_preparations_supersedes_fk FOREIGN KEY (tenant_id,electronic_document_id,supersedes_preparation_id) REFERENCES fiscal.fiscal_document_preparations(tenant_id,electronic_document_id,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_document_preparations_created_by_fk FOREIGN KEY (created_by_actor_id) REFERENCES identity.users(id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_document_preparations_cancelled_by_fk FOREIGN KEY (cancelled_by_actor_id) REFERENCES identity.users(id) MATCH SIMPLE ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_document_preparations_state_ck CHECK (preparation_state IN ('DRAFT','FROZEN','CANCELLED')),
  CONSTRAINT fiscal_document_preparations_generation_ck CHECK (preparation_generation>=1 AND ((preparation_generation=1 AND supersedes_preparation_id IS NULL) OR (preparation_generation>1 AND supersedes_preparation_id IS NOT NULL))),
  CONSTRAINT fiscal_document_preparations_checksum_ck CHECK (tax_snapshot_checksum~'^[0-9a-f]{64}$' AND fiscal_emission_snapshot_checksum~'^[0-9a-f]{64}$' AND canonical_payload_checksum~'^[0-9a-f]{64}$' AND canonical_payload_version>0),
  CONSTRAINT fiscal_document_preparations_amounts_ck CHECK (subtotal_amount>=0 AND discount_amount>=0 AND tax_amount>=0 AND total_amount>=0 AND currency_code~'^[A-Z]{3}$'),
  CONSTRAINT fiscal_document_preparations_numbering_ck CHECK (numbering_mode IN ('PROVIDER_ASSIGNED','AUTHORITY_ASSIGNED','AUTHORIZED_RANGE','LOCAL_CONTINGENCY') AND numbering_state IN ('NOT_APPLICABLE','PENDING_EXTERNAL','RESERVED','CONSUMED','UNKNOWN_OUTCOME','RELEASED_WITHOUT_REUSE','BURNED') AND (prefix IS NULL OR (btrim(prefix)<>'' AND fiscal.safe_external_text(prefix,128))) AND (number IS NULL OR (btrim(number)<>'' AND fiscal.safe_external_text(number,256))) AND (numbering_resolution_reason IS NULL OR fiscal.safe_external_text(numbering_resolution_reason,1024))),
  CONSTRAINT fiscal_document_preparations_lifecycle_ck CHECK ((preparation_state='DRAFT' AND frozen_at IS NULL AND cancelled_at IS NULL AND cancelled_by_actor_id IS NULL AND cancellation_reason IS NULL) OR (preparation_state='FROZEN' AND frozen_at IS NOT NULL AND cancelled_at IS NULL AND cancelled_by_actor_id IS NULL AND cancellation_reason IS NULL) OR (preparation_state='CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by_actor_id IS NOT NULL AND cancellation_reason IS NOT NULL)),
  CONSTRAINT fiscal_document_preparations_provider_identity_ck CHECK ((provider_document_id IS NULL OR fiscal.safe_external_text(provider_document_id,512)) AND (provider_reference IS NULL OR fiscal.safe_external_text(provider_reference,2048)) AND (provider_status_raw IS NULL OR fiscal.safe_external_text(provider_status_raw,256))),
  CONSTRAINT fiscal_document_preparations_version_ck CHECK (source_version>0 AND version>0 AND created_at<=updated_at)
);

CREATE TABLE fiscal.fiscal_submission_attempts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  external_integration_id uuid NOT NULL,
  fiscal_connection_id uuid NOT NULL,
  electronic_document_id uuid NOT NULL,
  fiscal_document_preparation_id uuid NOT NULL,
  preparation_generation bigint NOT NULL,
  integration_dispatch_id uuid NOT NULL,
  credential_binding_id uuid NOT NULL,
  credential_binding_generation integer NOT NULL,
  dispatch_class text NOT NULL DEFAULT 'FISCAL',
  operation_type text NOT NULL,
  attempt_number integer NOT NULL,
  status text NOT NULL,
  transport_status text NULL,
  normalized_result text NULL,
  request_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_checksum text NOT NULL,
  provider_operation_id text NULL,
  provider_correlation_reference text NULL,
  provider_response_reference text NULL,
  http_status integer NULL,
  provider_code_raw text NULL,
  retry_classification text NULL,
  error_code text NULL,
  retry_after_at timestamptz NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid NULL,
  created_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT fiscal_submission_attempts_id_v7_ck CHECK (platform.is_uuid_v7(id) AND platform.is_uuid_v7(correlation_id) AND (causation_id IS NULL OR platform.is_uuid_v7(causation_id))),
  CONSTRAINT fiscal_submission_attempts_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT fiscal_submission_attempts_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT fiscal_submission_attempts_document_scope_uq UNIQUE (tenant_id,company_id,external_integration_id,electronic_document_id,preparation_generation,id),
  CONSTRAINT fiscal_submission_attempts_connection_scope_uq UNIQUE (tenant_id,company_id,external_integration_id,fiscal_connection_id,id),
  CONSTRAINT fiscal_submission_attempts_dispatch_history_uq UNIQUE (tenant_id,integration_dispatch_id,attempt_number),
  CONSTRAINT fiscal_submission_attempts_document_history_uq UNIQUE (tenant_id,electronic_document_id,preparation_generation,operation_type,attempt_number),
  CONSTRAINT fiscal_submission_attempts_preparation_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,preparation_generation,fiscal_document_preparation_id) REFERENCES fiscal.fiscal_document_preparations(tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,preparation_generation,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_submission_attempts_connection_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id) REFERENCES fiscal.fiscal_connections(tenant_id,company_id,external_integration_id,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_submission_attempts_dispatch_fk FOREIGN KEY (tenant_id,company_id,integration_dispatch_id,dispatch_class) REFERENCES integrations.integration_dispatches(tenant_id,company_id,id,dispatch_class) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_submission_attempts_credential_binding_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,credential_binding_id,credential_binding_generation) REFERENCES integrations.integration_credential_bindings(tenant_id,company_id,integration_id,id,generation) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_submission_attempts_credential_generation_ck CHECK (credential_binding_generation>0),
  CONSTRAINT fiscal_submission_attempts_class_ck CHECK (dispatch_class='FISCAL'),
  CONSTRAINT fiscal_submission_attempts_operation_type_ck CHECK (operation_type='SUBMIT_DOCUMENT'),
  CONSTRAINT fiscal_submission_attempts_status_ck CHECK (status IN ('CREATED','IN_PROGRESS','COMPLETED','FAILED','UNKNOWN_OUTCOME','CANCELLED')),
  CONSTRAINT fiscal_submission_attempts_result_ck CHECK (normalized_result IS NULL OR normalized_result IN ('ACCEPTED','REJECTED')),
  CONSTRAINT fiscal_submission_attempts_transport_ck CHECK (transport_status IS NULL OR transport_status IN ('NOT_SENT','SENT','RESPONSE_RECEIVED','UNKNOWN')),
  CONSTRAINT fiscal_submission_attempts_retry_ck CHECK (retry_classification IS NULL OR retry_classification IN ('SAFE_RETRY','RECONCILE_REQUIRED','NON_RETRYABLE')),
  CONSTRAINT fiscal_submission_attempts_checksum_ck CHECK (request_checksum~'^[0-9a-f]{64}$'),
  CONSTRAINT fiscal_submission_attempts_values_ck CHECK (attempt_number>0 AND version>0 AND fiscal.safe_external_text(request_id,512) AND fiscal.safe_external_text(idempotency_key,512) AND (provider_operation_id IS NULL OR fiscal.safe_external_text(provider_operation_id,512)) AND (provider_correlation_reference IS NULL OR fiscal.safe_external_text(provider_correlation_reference,512)) AND (provider_response_reference IS NULL OR fiscal.safe_external_text(provider_response_reference,2048)) AND (provider_code_raw IS NULL OR fiscal.safe_external_text(provider_code_raw,256)) AND (error_code IS NULL OR fiscal.safe_external_text(error_code,256)) AND (http_status IS NULL OR http_status BETWEEN 100 AND 599)),
  CONSTRAINT fiscal_submission_attempts_timestamps_ck CHECK ((completed_at IS NULL OR (started_at IS NOT NULL AND started_at<=completed_at)) AND (status<>'CREATED' OR (started_at IS NULL AND completed_at IS NULL)) AND (status<>'IN_PROGRESS' OR (started_at IS NOT NULL AND completed_at IS NULL)) AND (status NOT IN ('COMPLETED','FAILED','UNKNOWN_OUTCOME') OR (started_at IS NOT NULL AND completed_at IS NOT NULL)))
);

CREATE TABLE fiscal.fiscal_artifacts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  external_integration_id uuid NOT NULL,
  electronic_document_id uuid NOT NULL,
  fiscal_document_preparation_id uuid NOT NULL,
  preparation_generation bigint NOT NULL,
  fiscal_submission_attempt_id uuid NULL,
  artifact_type text NOT NULL,
  media_type text NOT NULL,
  storage_reference text NOT NULL,
  checksum_algorithm text NOT NULL,
  checksum text NOT NULL,
  size_bytes bigint NULL,
  provider_reference text NULL,
  authority_reference text NULL,
  retention_policy_reference text NOT NULL,
  immutable_evidence boolean NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT fiscal_artifacts_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT fiscal_artifacts_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT fiscal_artifacts_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT fiscal_artifacts_identity_uq UNIQUE (tenant_id,electronic_document_id,preparation_generation,artifact_type,checksum),
  CONSTRAINT fiscal_artifacts_preparation_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,electronic_document_id,preparation_generation,fiscal_document_preparation_id) REFERENCES fiscal.fiscal_document_preparations(tenant_id,company_id,external_integration_id,electronic_document_id,preparation_generation,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_artifacts_attempt_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,electronic_document_id,preparation_generation,fiscal_submission_attempt_id) REFERENCES fiscal.fiscal_submission_attempts(tenant_id,company_id,external_integration_id,electronic_document_id,preparation_generation,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_artifacts_type_ck CHECK (artifact_type IN ('XML','PDF','ATTACHED_DOCUMENT','AUTHORITY_RESPONSE','PROVIDER_RESPONSE','QR_DATA','SIGNED_PAYLOAD')),
  CONSTRAINT fiscal_artifacts_checksum_ck CHECK (checksum_algorithm='SHA-256' AND checksum~'^[0-9a-f]{64}$'),
  CONSTRAINT fiscal_artifacts_values_ck CHECK (fiscal.safe_external_text(media_type,256) AND fiscal.safe_external_text(storage_reference,2048) AND fiscal.safe_external_text(retention_policy_reference,2048) AND (provider_reference IS NULL OR fiscal.safe_external_text(provider_reference,2048)) AND (authority_reference IS NULL OR fiscal.safe_external_text(authority_reference,2048)) AND (size_bytes IS NULL OR size_bytes>=0))
);

CREATE TABLE fiscal.fiscal_reconciliations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NULL,
  external_integration_id uuid NOT NULL,
  fiscal_connection_id uuid NOT NULL,
  scope_type text NOT NULL,
  electronic_document_id uuid NULL,
  preparation_generation bigint NULL,
  scope_snapshot_reference text NOT NULL,
  scope_snapshot_checksum text NOT NULL,
  status text NOT NULL,
  expected_state_snapshot_reference text NOT NULL,
  observed_state_snapshot_reference text NULL,
  provider_evidence_reference text NULL,
  authority_evidence_reference text NULL,
  discrepancy_summary_code text NULL,
  started_by_actor_id uuid NOT NULL,
  reviewed_by_actor_id uuid NULL,
  closed_by_actor_id uuid NULL,
  resolution_reason text NULL,
  started_at timestamptz NULL,
  closed_at timestamptz NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT fiscal_reconciliations_id_v7_ck CHECK (platform.is_uuid_v7(id) AND platform.is_uuid_v7(correlation_id) AND (causation_id IS NULL OR platform.is_uuid_v7(causation_id))),
  CONSTRAINT fiscal_reconciliations_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT fiscal_reconciliations_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT fiscal_reconciliations_scope_uq UNIQUE (tenant_id,company_id,external_integration_id,fiscal_connection_id,id),
  CONSTRAINT fiscal_reconciliations_connection_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id) REFERENCES fiscal.fiscal_connections(tenant_id,company_id,external_integration_id,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_reconciliations_branch_fk FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES organization.branches(tenant_id,company_id,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_reconciliations_preparation_generation_fk FOREIGN KEY (tenant_id,electronic_document_id,preparation_generation) REFERENCES fiscal.fiscal_document_preparations(tenant_id,electronic_document_id,preparation_generation) MATCH SIMPLE ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_reconciliations_started_by_fk FOREIGN KEY (started_by_actor_id) REFERENCES identity.users(id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_reconciliations_reviewed_by_fk FOREIGN KEY (reviewed_by_actor_id) REFERENCES identity.users(id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_reconciliations_closed_by_fk FOREIGN KEY (closed_by_actor_id) REFERENCES identity.users(id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_reconciliations_scope_ck CHECK ((scope_type='DOCUMENT' AND electronic_document_id IS NOT NULL AND preparation_generation IS NOT NULL) OR (scope_type='CONNECTION' AND electronic_document_id IS NULL AND preparation_generation IS NULL)),
  CONSTRAINT fiscal_reconciliations_status_ck CHECK (status IN ('CREATED','RUNNING','REVIEW_REQUIRED','PARTIALLY_RECONCILED','RECONCILED','FAILED','CANCELLED','CLOSED','REOPENED')),
  CONSTRAINT fiscal_reconciliations_checksum_ck CHECK (scope_snapshot_checksum~'^[0-9a-f]{64}$' AND fiscal.safe_external_text(scope_snapshot_reference,2048) AND fiscal.safe_external_text(expected_state_snapshot_reference,2048) AND (observed_state_snapshot_reference IS NULL OR fiscal.safe_external_text(observed_state_snapshot_reference,2048)) AND (provider_evidence_reference IS NULL OR fiscal.safe_external_text(provider_evidence_reference,2048)) AND (authority_evidence_reference IS NULL OR fiscal.safe_external_text(authority_evidence_reference,2048)) AND (discrepancy_summary_code IS NULL OR fiscal.safe_external_text(discrepancy_summary_code,256)) AND (resolution_reason IS NULL OR fiscal.safe_external_text(resolution_reason,1024))),
  CONSTRAINT fiscal_reconciliations_lifecycle_ck CHECK ((status='CREATED' AND observed_state_snapshot_reference IS NULL AND reviewed_by_actor_id IS NULL AND closed_by_actor_id IS NULL AND resolution_reason IS NULL AND started_at IS NULL AND closed_at IS NULL) OR status<>'CREATED'),
  CONSTRAINT fiscal_reconciliations_version_ck CHECK (version>0 AND created_at<=updated_at AND (closed_at IS NULL OR (started_at IS NOT NULL AND started_at<=closed_at)))
);

CREATE TABLE fiscal.fiscal_incidents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NULL,
  external_integration_id uuid NOT NULL,
  fiscal_connection_id uuid NOT NULL,
  electronic_document_id uuid NULL,
  preparation_generation bigint NULL,
  fiscal_submission_attempt_id uuid NULL,
  fiscal_reconciliation_id uuid NULL,
  incident_type text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL,
  summary_code text NOT NULL,
  evidence_reference text NOT NULL,
  assigned_reviewer_id uuid NULL,
  resolution_type text NULL,
  resolution_reason text NULL,
  resolved_by_actor_id uuid NULL,
  resolved_at timestamptz NULL,
  archived_at timestamptz NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT fiscal_incidents_id_v7_ck CHECK (platform.is_uuid_v7(id) AND platform.is_uuid_v7(correlation_id) AND (causation_id IS NULL OR platform.is_uuid_v7(causation_id))),
  CONSTRAINT fiscal_incidents_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT fiscal_incidents_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT fiscal_incidents_scope_uq UNIQUE (tenant_id,company_id,external_integration_id,fiscal_connection_id,id),
  CONSTRAINT fiscal_incidents_connection_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id) REFERENCES fiscal.fiscal_connections(tenant_id,company_id,external_integration_id,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_incidents_branch_fk FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES organization.branches(tenant_id,company_id,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_incidents_document_fk FOREIGN KEY (tenant_id,company_id,electronic_document_id) REFERENCES fiscal.electronic_documents(tenant_id,company_id,id) MATCH SIMPLE ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_incidents_preparation_generation_fk FOREIGN KEY (tenant_id,electronic_document_id,preparation_generation) REFERENCES fiscal.fiscal_document_preparations(tenant_id,electronic_document_id,preparation_generation) MATCH SIMPLE ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_incidents_attempt_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_submission_attempt_id) REFERENCES fiscal.fiscal_submission_attempts(tenant_id,company_id,external_integration_id,fiscal_connection_id,id) MATCH SIMPLE ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_incidents_reconciliation_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id) REFERENCES fiscal.fiscal_reconciliations(tenant_id,company_id,external_integration_id,fiscal_connection_id,id) MATCH SIMPLE ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_incidents_reviewer_fk FOREIGN KEY (assigned_reviewer_id) REFERENCES identity.users(id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_incidents_resolved_by_fk FOREIGN KEY (resolved_by_actor_id) REFERENCES identity.users(id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_incidents_status_ck CHECK (status IN ('OPEN','IN_REVIEW','RESOLVED','ARCHIVED')),
  CONSTRAINT fiscal_incidents_resolution_ck CHECK ((status IN ('OPEN','IN_REVIEW') AND resolution_type IS NULL AND resolution_reason IS NULL AND resolved_by_actor_id IS NULL AND resolved_at IS NULL AND archived_at IS NULL) OR (status='RESOLVED' AND resolution_type IS NOT NULL AND resolution_reason IS NOT NULL AND resolved_by_actor_id IS NOT NULL AND resolved_at IS NOT NULL AND archived_at IS NULL) OR (status='ARCHIVED' AND resolved_at IS NOT NULL AND archived_at IS NOT NULL)),
  CONSTRAINT fiscal_incidents_lifecycle_ck CHECK ((preparation_generation IS NULL OR electronic_document_id IS NOT NULL) AND (status<>'OPEN' OR assigned_reviewer_id IS NULL) AND fiscal.safe_external_text(incident_type,256) AND fiscal.safe_external_text(severity,256) AND fiscal.safe_external_text(summary_code,256) AND fiscal.safe_external_text(evidence_reference,2048) AND (resolution_type IS NULL OR fiscal.safe_external_text(resolution_type,256)) AND (resolution_reason IS NULL OR fiscal.safe_external_text(resolution_reason,1024))),
  CONSTRAINT fiscal_incidents_version_ck CHECK (version>0 AND created_at<=updated_at)
);

CREATE TABLE fiscal.fiscal_reconciliation_items (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  external_integration_id uuid NOT NULL,
  fiscal_connection_id uuid NOT NULL,
  fiscal_reconciliation_id uuid NOT NULL,
  electronic_document_id uuid NOT NULL,
  fiscal_document_preparation_id uuid NOT NULL,
  preparation_generation bigint NOT NULL,
  expected_state_reference text NOT NULL,
  observed_state_reference text NOT NULL,
  evidence_checksum text NOT NULL,
  discrepancy_code text NULL,
  result_code text NOT NULL,
  evidence_reference text NOT NULL,
  fiscal_incident_id uuid NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT fiscal_reconciliation_items_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT fiscal_reconciliation_items_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT fiscal_reconciliation_items_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT fiscal_reconciliation_items_identity_uq UNIQUE (tenant_id,fiscal_reconciliation_id,electronic_document_id,preparation_generation),
  CONSTRAINT fiscal_reconciliation_items_reconciliation_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id) REFERENCES fiscal.fiscal_reconciliations(tenant_id,company_id,external_integration_id,fiscal_connection_id,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_reconciliation_items_preparation_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,electronic_document_id,preparation_generation,fiscal_document_preparation_id) REFERENCES fiscal.fiscal_document_preparations(tenant_id,company_id,external_integration_id,electronic_document_id,preparation_generation,id) ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_reconciliation_items_incident_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_incident_id) REFERENCES fiscal.fiscal_incidents(tenant_id,company_id,external_integration_id,fiscal_connection_id,id) MATCH SIMPLE ON DELETE NO ACTION NOT DEFERRABLE,
  CONSTRAINT fiscal_reconciliation_items_checksum_ck CHECK (evidence_checksum~'^[0-9a-f]{64}$'),
  CONSTRAINT fiscal_reconciliation_items_result_ck CHECK (result_code~'^[A-Z][A-Z0-9_]{1,127}$' AND fiscal.safe_external_text(expected_state_reference,2048) AND fiscal.safe_external_text(observed_state_reference,2048) AND fiscal.safe_external_text(evidence_reference,2048) AND (discrepancy_code IS NULL OR fiscal.safe_external_text(discrepancy_code,256)))
);

ALTER TABLE fiscal.fiscal_connections ADD CONSTRAINT fiscal_connections_company_validity_excl EXCLUDE USING gist (tenant_id WITH =,company_id WITH =,external_integration_id WITH =,tstzrange(valid_from,valid_until,'[)') WITH &&);

ALTER TABLE fiscal.fiscal_emission_configuration_versions ADD CONSTRAINT fiscal_emission_configuration_versions_supersedes_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,supersedes_version_id,document_type) REFERENCES fiscal.fiscal_emission_configuration_versions(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,id,document_type) ON DELETE NO ACTION NOT DEFERRABLE;

ALTER TABLE fiscal.fiscal_emission_configuration_versions ADD CONSTRAINT fiscal_emission_configuration_versions_published_validity_excl EXCLUDE USING gist (tenant_id WITH =,company_id WITH =,fiscal_emission_configuration_id WITH =,tstzrange(valid_from,valid_until,'[)') WITH &&) WHERE (status='PUBLISHED');

ALTER TABLE integrations.integration_dispatches ADD CONSTRAINT integration_dispatches_fiscal_preparation_ck CHECK ((dispatch_class='FISCAL' AND fiscal_document_preparation_id IS NOT NULL AND fiscal_preparation_generation IS NOT NULL AND fiscal_preparation_generation>=1 AND resource_type='ELECTRONIC_DOCUMENT' AND internal_entity_type='ElectronicDocument') OR (dispatch_class='NON_FISCAL' AND fiscal_document_preparation_id IS NULL AND fiscal_preparation_generation IS NULL));

ALTER TABLE integrations.integration_dispatches ADD CONSTRAINT integration_dispatches_fiscal_semantic_request_ck CHECK ((dispatch_class='FISCAL' AND fiscal_request_semantic_version IS NOT NULL AND fiscal_request_semantic_checksum IS NOT NULL AND fiscal_request_semantic_version>=1 AND fiscal_request_semantic_checksum~'^[0-9a-f]{64}$') OR (dispatch_class='NON_FISCAL' AND fiscal_request_semantic_version IS NULL AND fiscal_request_semantic_checksum IS NULL));

ALTER TABLE integrations.integration_dispatches ADD CONSTRAINT integration_dispatches_fiscal_preparation_fk FOREIGN KEY (tenant_id,company_id,integration_id,internal_entity_id,fiscal_preparation_generation,fiscal_document_preparation_id) REFERENCES fiscal.fiscal_document_preparations(tenant_id,company_id,external_integration_id,electronic_document_id,preparation_generation,id) ON DELETE NO ACTION NOT DEFERRABLE;

ALTER TABLE integrations.external_webhook_receipts ADD CONSTRAINT external_webhook_receipts_fiscal_correlation_ck CHECK ((fiscal_electronic_document_id IS NULL AND fiscal_document_preparation_id IS NULL AND fiscal_preparation_generation IS NULL AND fiscal_integration_dispatch_id IS NULL AND fiscal_correlated_at IS NULL) OR (fiscal_electronic_document_id IS NOT NULL AND fiscal_document_preparation_id IS NOT NULL AND fiscal_preparation_generation IS NOT NULL AND fiscal_preparation_generation>=1 AND fiscal_integration_dispatch_id IS NOT NULL AND fiscal_correlated_at IS NOT NULL));

ALTER TABLE integrations.external_webhook_receipts ADD CONSTRAINT external_webhook_receipts_fiscal_dispatch_fk FOREIGN KEY (tenant_id,company_id,fiscal_integration_dispatch_id) REFERENCES integrations.integration_dispatches(tenant_id,company_id,id) MATCH SIMPLE ON DELETE NO ACTION NOT DEFERRABLE;

ALTER TABLE integrations.external_webhook_receipts ADD CONSTRAINT external_webhook_receipts_fiscal_document_fk FOREIGN KEY (tenant_id,company_id,fiscal_electronic_document_id) REFERENCES fiscal.electronic_documents(tenant_id,company_id,id) MATCH SIMPLE ON DELETE NO ACTION NOT DEFERRABLE;

ALTER TABLE integrations.external_webhook_receipts ADD CONSTRAINT external_webhook_receipts_fiscal_preparation_fk FOREIGN KEY (tenant_id,company_id,integration_id,fiscal_electronic_document_id,fiscal_preparation_generation,fiscal_document_preparation_id) REFERENCES fiscal.fiscal_document_preparations(tenant_id,company_id,external_integration_id,electronic_document_id,preparation_generation,id) MATCH SIMPLE ON DELETE NO ACTION NOT DEFERRABLE;

CREATE FUNCTION fiscal.guard_allowed_update_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE allowed text[]:=string_to_array(TG_ARGV[0],',');
BEGIN
  IF (to_jsonb(NEW)-allowed) IS DISTINCT FROM (to_jsonb(OLD)-allowed) THEN
    RAISE EXCEPTION 'immutable columns changed on %',TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_initial_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
BEGIN
  IF NEW.status<>TG_ARGV[0] THEN
    RAISE EXCEPTION 'invalid initial status on %',TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE
  old_state text:=to_jsonb(OLD)->>TG_ARGV[0];
  new_state text:=to_jsonb(NEW)->>TG_ARGV[0];
BEGIN
  IF old_state<>new_state
     AND old_state||'>'||new_state<>ALL(string_to_array(TG_ARGV[1],',')) THEN
    RAISE EXCEPTION 'invalid % transition on %',TG_ARGV[0],TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
BEGIN
  RAISE EXCEPTION '% is append-only',TG_TABLE_NAME;
END;
$function$;

CREATE FUNCTION fiscal.guard_configuration_version_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE transition text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'DRAFT'
       OR NEW.published_at IS NOT NULL
       OR NEW.published_by_actor_id IS NOT NULL
       OR NEW.numbering_exhausted_at IS NOT NULL THEN
      RAISE EXCEPTION 'configuration version must start DRAFT';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.row_version<>OLD.row_version+1 THEN
    RAISE EXCEPTION 'configuration row_version must increment exactly one';
  END IF;
  transition:=OLD.status||'>'||NEW.status;

  IF OLD.status='DRAFT' THEN
    IF OLD.status<>NEW.status AND transition<>'DRAFT>PUBLISHED' THEN
      RAISE EXCEPTION 'invalid configuration version transition %',transition;
    END IF;

    IF transition='DRAFT>PUBLISHED' THEN
      PERFORM 1
      FROM fiscal.fiscal_connections c
      WHERE c.tenant_id=NEW.tenant_id
        AND c.company_id=NEW.company_id
        AND c.external_integration_id=NEW.external_integration_id
        AND c.id=NEW.fiscal_connection_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'publication requires locked FiscalConnection coordinator';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF OLD.status='PUBLISHED' THEN
    IF NEW.status='PUBLISHED' THEN
      IF (to_jsonb(NEW)-ARRAY['next_number_value','numbering_exhausted_at','updated_at','row_version'])
         IS DISTINCT FROM
         (to_jsonb(OLD)-ARRAY['next_number_value','numbering_exhausted_at','updated_at','row_version']) THEN
        RAISE EXCEPTION 'published configuration material is immutable';
      END IF;
      IF OLD.numbering_policy_code NOT IN ('AUTHORIZED_RANGE','LOCAL_CONTINGENCY')
         AND ROW(NEW.next_number_value,NEW.numbering_exhausted_at)
             IS DISTINCT FROM ROW(OLD.next_number_value,OLD.numbering_exhausted_at) THEN
        RAISE EXCEPTION 'remote numbering configuration has no mutable local cursor';
      END IF;
      IF OLD.next_number_value IS NOT NULL
         AND NEW.next_number_value IS NOT NULL
         AND NEW.next_number_value<OLD.next_number_value THEN
        RAISE EXCEPTION 'published numbering cursor cannot move backwards';
      END IF;
      IF OLD.numbering_exhausted_at IS NOT NULL
         AND NEW.numbering_exhausted_at IS DISTINCT FROM OLD.numbering_exhausted_at THEN
        RAISE EXCEPTION 'numbering exhaustion is write-once';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.status IN ('SUPERSEDED','REVOKED') THEN
      IF (to_jsonb(NEW)-ARRAY['status','updated_at','row_version'])
         IS DISTINCT FROM
         (to_jsonb(OLD)-ARRAY['status','updated_at','row_version']) THEN
        RAISE EXCEPTION 'published material cannot change while retiring configuration version';
      END IF;
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'invalid configuration version transition %',transition;
  END IF;

  IF NEW.status<>OLD.status THEN
    RAISE EXCEPTION 'terminal configuration version cannot transition again';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['updated_at','row_version'])
     IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['updated_at','row_version']) THEN
    RAISE EXCEPTION 'historical configuration material is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_connection_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.tenant_id,NEW.company_id,NEW.external_integration_id,NEW.electronic_invoicing_capability_id,NEW.capability_code,NEW.valid_from,NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.tenant_id,OLD.company_id,OLD.external_integration_id,OLD.electronic_invoicing_capability_id,OLD.capability_code,OLD.valid_from,OLD.created_at) THEN
      RAISE EXCEPTION 'fiscal connection identity and opening boundary are immutable';
    END IF;
    IF NEW.version<>OLD.version+1 THEN
      RAISE EXCEPTION 'fiscal connection version must increment exactly one';
    END IF;
    IF OLD.valid_until IS NOT NULL AND NEW.valid_until IS DISTINCT FROM OLD.valid_until THEN
      RAISE EXCEPTION 'closed fiscal connection cannot be reopened, extended or rewritten';
    END IF;
    IF NEW.updated_at<OLD.updated_at THEN
      RAISE EXCEPTION 'fiscal connection updated_at cannot move backwards';
    END IF;
    IF OLD.valid_until IS NULL AND NEW.valid_until IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM integrations.external_integrations i
    JOIN integrations.integration_capabilities c
      ON c.tenant_id=i.tenant_id
     AND c.company_id=i.company_id
     AND c.integration_id=i.id
    WHERE i.tenant_id=NEW.tenant_id
      AND i.company_id=NEW.company_id
      AND i.id=NEW.external_integration_id
      AND i.status='ACTIVE'
      AND c.id=NEW.electronic_invoicing_capability_id
      AND c.capability_code='ELECTRONIC_INVOICING'
      AND c.support_status='SUPPORTED'
      AND c.effective_from<=transaction_timestamp()
      AND (c.effective_until IS NULL OR transaction_timestamp()<c.effective_until)
  ) THEN
    RAISE EXCEPTION 'active effective fiscal capability required';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_configuration_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE
  configured_branch uuid;
  configured_scope text;
  configured_connection uuid;
  configured_integration uuid;
  configured_type text;
BEGIN
  SELECT branch_id,scope_type,fiscal_connection_id,external_integration_id,document_type
    INTO configured_branch,configured_scope,configured_connection,configured_integration,configured_type
  FROM fiscal.fiscal_emission_configurations
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND id=NEW.fiscal_emission_configuration_id;

  IF NOT FOUND
     OR configured_branch IS DISTINCT FROM NEW.branch_id
     OR configured_scope<>NEW.scope_type
     OR configured_connection<>NEW.fiscal_connection_id
     OR configured_integration<>NEW.external_integration_id
     OR configured_type<>NEW.document_type THEN
    RAISE EXCEPTION 'configuration scope mismatch';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_electronic_document_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
BEGIN
  IF NEW.status<>'DRAFT' OR NEW.preparation_generation<>1 THEN
    RAISE EXCEPTION 'electronic document must start DRAFT generation 1';
  END IF;
  IF NEW.authority_reference IS NOT NULL
     OR NEW.legal_identifier IS NOT NULL
     OR NEW.authority_status_raw IS NOT NULL
     OR NEW.uncertainty_reason IS NOT NULL
     OR NEW.issued_at IS NOT NULL
     OR NEW.accepted_at IS NOT NULL
     OR NEW.rejected_at IS NOT NULL
     OR NEW.last_reconciled_at IS NOT NULL THEN
    RAISE EXCEPTION 'new electronic document cannot start with external evidence';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_electronic_document_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
BEGIN
  IF ROW(NEW.tenant_id,NEW.company_id,NEW.branch_id,NEW.source_type,NEW.source_id,NEW.document_type,NEW.logical_operation_key,NEW.original_electronic_document_id)
     IS DISTINCT FROM
     ROW(OLD.tenant_id,OLD.company_id,OLD.branch_id,OLD.source_type,OLD.source_id,OLD.document_type,OLD.logical_operation_key,OLD.original_electronic_document_id) THEN
    RAISE EXCEPTION 'electronic document identity is immutable';
  END IF;
  IF NEW.preparation_generation<OLD.preparation_generation
     OR NEW.preparation_generation>OLD.preparation_generation+1 THEN
    RAISE EXCEPTION 'invalid preparation generation change';
  END IF;
  IF NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'electronic document version must increment exactly one';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_electronic_document_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE
  transition text:=OLD.status||'>'||NEW.status;
  historical_evidence boolean:=false;
BEGIN
  IF OLD.status=NEW.status THEN RETURN NEW; END IF;

  IF NEW.status='UNKNOWN_OUTCOME'
     AND NEW.uncertainty_reason='HISTORICAL_GENERATION_EVIDENCE'
     AND OLD.status IN ('DRAFT','READY','QUEUED','VOIDED_BEFORE_SUBMISSION') THEN
    SELECT EXISTS (
      SELECT 1
      FROM fiscal.fiscal_document_preparations p
      WHERE p.tenant_id=OLD.tenant_id
        AND p.company_id=OLD.company_id
        AND p.electronic_document_id=OLD.id
        AND p.preparation_generation<OLD.preparation_generation
        AND p.preparation_state='CANCELLED'
        AND fiscal.has_correlated_generation_evidence(OLD.tenant_id,OLD.id,p.preparation_generation)
    ) INTO historical_evidence;
    IF historical_evidence THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'historical-generation quarantine requires durable historical evidence';
  END IF;

  IF transition=ANY(ARRAY[
      'DRAFT>READY','DRAFT>VOIDED_BEFORE_SUBMISSION',
      'READY>QUEUED','READY>VOIDED_BEFORE_SUBMISSION',
      'QUEUED>SUBMITTING','QUEUED>VOIDED_BEFORE_SUBMISSION',
      'SUBMITTING>ACCEPTED','SUBMITTING>REJECTED','SUBMITTING>UNKNOWN_OUTCOME','SUBMITTING>CONTINGENCY',
      'CONTINGENCY>ACCEPTED','CONTINGENCY>REJECTED','CONTINGENCY>UNKNOWN_OUTCOME'
    ]) THEN
    RETURN NEW;
  END IF;
  IF transition=ANY(ARRAY['DRAFT>DRAFT','READY>DRAFT','QUEUED>DRAFT'])
     AND NEW.preparation_generation=OLD.preparation_generation+1 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid electronic document status transition %',transition;
END;
$function$;

CREATE FUNCTION fiscal.guard_electronic_document_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
BEGIN
  IF OLD.authority_reference IS NOT NULL AND NEW.authority_reference IS DISTINCT FROM OLD.authority_reference THEN
    RAISE EXCEPTION 'authority_reference is write-once';
  END IF;
  IF OLD.legal_identifier IS NOT NULL AND NEW.legal_identifier IS DISTINCT FROM OLD.legal_identifier THEN
    RAISE EXCEPTION 'legal_identifier is write-once';
  END IF;
  IF OLD.issued_at IS NOT NULL AND NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION 'issued_at is write-once';
  END IF;
  IF OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
    RAISE EXCEPTION 'accepted_at is write-once';
  END IF;
  IF OLD.rejected_at IS NOT NULL AND NEW.rejected_at IS DISTINCT FROM OLD.rejected_at THEN
    RAISE EXCEPTION 'rejected_at is write-once';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.has_correlated_generation_evidence(p_tenant_id uuid,p_document_id uuid,p_generation bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path=pg_catalog,fiscal,integrations
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM fiscal.fiscal_submission_attempts a
      WHERE a.tenant_id=p_tenant_id
        AND a.electronic_document_id=p_document_id
        AND a.preparation_generation=p_generation
    )
    OR EXISTS (
      SELECT 1 FROM fiscal.fiscal_artifacts a
      WHERE a.tenant_id=p_tenant_id
        AND a.electronic_document_id=p_document_id
        AND a.preparation_generation=p_generation
    )
    OR EXISTS (
      SELECT 1 FROM integrations.external_webhook_receipts r
      WHERE r.tenant_id=p_tenant_id
        AND r.fiscal_electronic_document_id=p_document_id
        AND r.fiscal_preparation_generation=p_generation
        AND r.authentication_verification_result='VERIFIED'
        AND r.replay_verification_result='VERIFIED'
    )
    OR EXISTS (
      SELECT 1 FROM fiscal.fiscal_reconciliations r
      WHERE r.tenant_id=p_tenant_id
        AND r.electronic_document_id=p_document_id
        AND r.preparation_generation=p_generation
        AND r.status IN ('RUNNING','REVIEW_REQUIRED','PARTIALLY_RECONCILED','RECONCILED','CLOSED','REOPENED')
    )
    OR EXISTS (
      SELECT 1 FROM fiscal.fiscal_document_preparations p
      WHERE p.tenant_id=p_tenant_id
        AND p.electronic_document_id=p_document_id
        AND p.preparation_generation=p_generation
        AND (
          p.provider_document_id IS NOT NULL
          OR p.provider_reference IS NOT NULL
          OR p.provider_status_raw IS NOT NULL
          OR p.numbering_state IN ('CONSUMED','UNKNOWN_OUTCOME','BURNED')
        )
    )
    OR EXISTS (
      SELECT 1 FROM fiscal.electronic_documents d
      WHERE d.tenant_id=p_tenant_id
        AND d.id=p_document_id
        AND (
          d.authority_reference IS NOT NULL
          OR d.legal_identifier IS NOT NULL
          OR d.status='UNKNOWN_OUTCOME'
        )
    )
$function$;

CREATE FUNCTION fiscal.guard_electronic_document_reprepare()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE
  p fiscal.fiscal_document_preparations%ROWTYPE;
  d integrations.integration_dispatches%ROWTYPE;
  dispatch_count integer;
BEGIN
  IF NEW.preparation_generation=OLD.preparation_generation THEN RETURN NEW; END IF;
  IF NEW.preparation_generation<>OLD.preparation_generation+1 THEN
    RAISE EXCEPTION 'reprepare must increment generation exactly one';
  END IF;
  IF OLD.status NOT IN ('DRAFT','READY','QUEUED') OR NEW.status<>'DRAFT' THEN
    RAISE EXCEPTION 'reprepare is only valid before submission and returns document to DRAFT';
  END IF;

  SELECT * INTO p
  FROM fiscal.fiscal_document_preparations
  WHERE tenant_id=OLD.tenant_id
    AND company_id=OLD.company_id
    AND electronic_document_id=OLD.id
    AND preparation_generation=OLD.preparation_generation
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'current fiscal preparation missing'; END IF;

  SELECT count(*) INTO dispatch_count
  FROM integrations.integration_dispatches
  WHERE tenant_id=OLD.tenant_id
    AND company_id=OLD.company_id
    AND internal_entity_id=OLD.id
    AND fiscal_preparation_generation=OLD.preparation_generation
    AND dispatch_class='FISCAL';

  IF dispatch_count>1 THEN RAISE EXCEPTION 'multiple fiscal dispatches for preparation'; END IF;
  IF dispatch_count=1 THEN
    SELECT * INTO d
    FROM integrations.integration_dispatches
    WHERE tenant_id=OLD.tenant_id
      AND company_id=OLD.company_id
      AND internal_entity_id=OLD.id
      AND fiscal_preparation_generation=OLD.preparation_generation
      AND dispatch_class='FISCAL'
    FOR UPDATE;
    IF d.status<>'QUEUED'
       OR d.provider_request_reference IS NOT NULL
       OR EXISTS (
          SELECT 1 FROM fiscal.fiscal_submission_attempts a
          WHERE a.tenant_id=OLD.tenant_id AND a.integration_dispatch_id=d.id
       ) THEN
      RAISE EXCEPTION 'dispatch exposure blocks reprepare';
    END IF;

    PERFORM 1
    FROM integrations.external_webhook_receipts r
    WHERE r.tenant_id=OLD.tenant_id
      AND r.company_id=OLD.company_id
      AND r.integration_id=d.integration_id
      AND r.fiscal_integration_dispatch_id=d.id
      AND r.fiscal_electronic_document_id=OLD.id
      AND r.fiscal_document_preparation_id=p.id
      AND r.fiscal_preparation_generation=OLD.preparation_generation
      AND r.authentication_verification_result='VERIFIED'
      AND r.replay_verification_result='VERIFIED'
    FOR UPDATE;
    IF FOUND THEN
      RAISE EXCEPTION 'admissible correlated webhook blocks reprepare';
    END IF;
  END IF;

  IF fiscal.has_correlated_generation_evidence(OLD.tenant_id,OLD.id,OLD.preparation_generation) THEN
    RAISE EXCEPTION 'durable external evidence blocks reprepare';
  END IF;

  IF EXISTS (
    SELECT 1 FROM fiscal.fiscal_reconciliations r
    WHERE r.tenant_id=OLD.tenant_id
      AND r.external_integration_id=p.external_integration_id
      AND r.status='RUNNING'
      AND (
        (r.scope_type='DOCUMENT' AND r.electronic_document_id=OLD.id AND r.preparation_generation=OLD.preparation_generation)
        OR (r.scope_type='CONNECTION' AND r.fiscal_connection_id=p.fiscal_connection_id)
      )
  ) THEN
    RAISE EXCEPTION 'in-flight reconciliation blocks reprepare';
  END IF;

  IF p.numbering_state IN ('CONSUMED','UNKNOWN_OUTCOME','BURNED') THEN
    RAISE EXCEPTION 'durable numbering exposure blocks reprepare';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.validate_current_fiscal_preparation_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE
  document_id uuid;
  tenant uuid;
  current_generation bigint;
  document_branch uuid;
  current_count integer;
BEGIN
  IF TG_TABLE_NAME='electronic_documents' THEN
    tenant:=COALESCE(NEW.tenant_id,OLD.tenant_id);
    document_id:=COALESCE(NEW.id,OLD.id);
  ELSE
    tenant:=COALESCE(NEW.tenant_id,OLD.tenant_id);
    document_id:=COALESCE(NEW.electronic_document_id,OLD.electronic_document_id);
  END IF;

  SELECT preparation_generation,branch_id
    INTO current_generation,document_branch
  FROM fiscal.electronic_documents
  WHERE tenant_id=tenant AND id=document_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*) INTO current_count
  FROM fiscal.fiscal_document_preparations p
  WHERE p.tenant_id=tenant
    AND p.electronic_document_id=document_id
    AND p.preparation_generation=current_generation;

  IF current_count<>1 THEN
    RAISE EXCEPTION 'exactly one current fiscal preparation is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM fiscal.fiscal_document_preparations p
    WHERE p.tenant_id=tenant
      AND p.electronic_document_id=document_id
      AND p.preparation_generation=current_generation
      AND p.branch_id<>document_branch
  ) THEN
    RAISE EXCEPTION 'current fiscal preparation branch must match electronic document branch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM fiscal.fiscal_document_preparations p
    WHERE p.tenant_id=tenant
      AND p.electronic_document_id=document_id
      AND p.preparation_generation>current_generation
  ) THEN
    RAISE EXCEPTION 'future fiscal preparation generation is not allowed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM fiscal.fiscal_document_preparations p
    WHERE p.tenant_id=tenant
      AND p.electronic_document_id=document_id
      AND p.preparation_generation>1
      AND NOT EXISTS (
        SELECT 1
        FROM fiscal.fiscal_document_preparations prior
        WHERE prior.tenant_id=p.tenant_id
          AND prior.electronic_document_id=p.electronic_document_id
          AND prior.preparation_generation=p.preparation_generation-1
          AND prior.id=p.supersedes_preparation_id
      )
  ) THEN
    RAISE EXCEPTION 'fiscal preparation lineage is not contiguous';
  END IF;

  IF current_generation>1 THEN
    IF NOT EXISTS (
      SELECT 1
      FROM fiscal.fiscal_document_preparations prior
      WHERE prior.tenant_id=tenant
        AND prior.electronic_document_id=document_id
        AND prior.preparation_generation=current_generation-1
        AND prior.preparation_state='CANCELLED'
    ) THEN
      RAISE EXCEPTION 'reprepare predecessor must be CANCELLED before commit';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM integrations.integration_dispatches d
      WHERE d.tenant_id=tenant
        AND d.internal_entity_id=document_id
        AND d.fiscal_preparation_generation=current_generation-1
        AND d.dispatch_class='FISCAL'
        AND d.status<>'CANCELLED'
    ) THEN
      RAISE EXCEPTION 'historical fiscal dispatch must be CANCELLED before reprepare commit';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM fiscal.fiscal_document_preparations prior
      WHERE prior.tenant_id=tenant
        AND prior.electronic_document_id=document_id
        AND prior.preparation_generation=current_generation-1
        AND prior.numbering_state='RESERVED'
    ) THEN
      RAISE EXCEPTION 'reserved legal numbering must be released-without-reuse or burned before reprepare commit';
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE FUNCTION fiscal.guard_fiscal_preparation_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE
  document_generation_pre bigint;
  document_type_pre text;
  document_branch_pre uuid;
  document_generation bigint;
  document_type_value text;
  document_branch uuid;
  integration_pre integrations.external_integrations%ROWTYPE;
  integration integrations.external_integrations%ROWTYPE;
  expected_capability text;
  declaration_id uuid;
  capability_id uuid;
  selected_version_id uuid;
  prior_id uuid;
  connection_valid_from timestamptz;
  connection_valid_until timestamptz;
BEGIN
  -- Read-only discovery is allowed before the canonical lock prefix.
  -- No mutable decision is accepted until every authoritative row is locked below.
  SELECT preparation_generation,document_type,branch_id
    INTO document_generation_pre,document_type_pre,document_branch_pre
  FROM fiscal.electronic_documents
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND id=NEW.electronic_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'preparation document not found'; END IF;

  SELECT * INTO integration_pre
  FROM integrations.external_integrations
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND id=NEW.external_integration_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'preparation integration not found'; END IF;

  expected_capability:=CASE document_type_pre
    WHEN 'ELECTRONIC_SALES_INVOICE' THEN 'ELECTRONIC_INVOICING'
    WHEN 'CREDIT_NOTE' THEN 'CREDIT_NOTES'
    WHEN 'DEBIT_NOTE' THEN 'DEBIT_NOTES'
    WHEN 'SUPPORT_DOCUMENT' THEN 'SUPPORT_DOCUMENTS'
    WHEN 'SUPPORT_DOCUMENT_ADJUSTMENT' THEN 'SUPPORT_DOCUMENTS'
    ELSE NULL
  END;

  -- Canonical universal lock prefix:
  -- declaration -> adapter -> integration -> capability -> connection -> config/version.
  SELECT d.id INTO declaration_id
  FROM integrations.provider_capability_declarations d
  WHERE d.provider_id=integration_pre.provider_id
    AND d.provider_adapter_version_id=integration_pre.provider_adapter_version_id
    AND d.capability_code=expected_capability
    AND d.support_status='SUPPORTED'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'preparation requires SUPPORTED adapter capability declaration';
  END IF;

  PERFORM 1
  FROM integrations.provider_adapter_versions av
  WHERE av.provider_id=integration_pre.provider_id
    AND av.provider_adapter_version_id=integration_pre.provider_adapter_version_id
    AND av.retired_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'preparation adapter version is absent or retired'; END IF;

  SELECT * INTO integration
  FROM integrations.external_integrations i
  WHERE i.tenant_id=NEW.tenant_id
    AND i.company_id=NEW.company_id
    AND i.id=NEW.external_integration_id
  FOR SHARE;
  IF NOT FOUND
     OR integration.status<>'ACTIVE'
     OR integration.provider_id<>integration_pre.provider_id
     OR integration.provider_adapter_version_id<>integration_pre.provider_adapter_version_id THEN
    RAISE EXCEPTION 'preparation requires stable ACTIVE ExternalIntegration identity';
  END IF;

  SELECT c.id INTO capability_id
  FROM integrations.integration_capabilities c
  WHERE c.tenant_id=NEW.tenant_id
    AND c.company_id=NEW.company_id
    AND c.integration_id=NEW.external_integration_id
    AND c.capability_code=expected_capability
    AND c.support_status='SUPPORTED'
    AND c.effective_from<=transaction_timestamp()
    AND (c.effective_until IS NULL OR transaction_timestamp()<c.effective_until)
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'preparation requires effective SUPPORTED integration capability';
  END IF;

  SELECT c.valid_from,c.valid_until
    INTO connection_valid_from,connection_valid_until
  FROM fiscal.fiscal_connections c
  WHERE c.tenant_id=NEW.tenant_id
    AND c.company_id=NEW.company_id
    AND c.external_integration_id=NEW.external_integration_id
    AND c.id=NEW.fiscal_connection_id
  FOR UPDATE;

  IF NOT FOUND
     OR connection_valid_from>transaction_timestamp()
     OR (connection_valid_until IS NOT NULL AND transaction_timestamp()>=connection_valid_until) THEN
    RAISE EXCEPTION 'preparation requires effective FiscalConnection';
  END IF;

  SELECT v.id
    INTO selected_version_id
  FROM fiscal.fiscal_emission_configurations cfg
  JOIN fiscal.fiscal_emission_configuration_versions v
    ON v.tenant_id=cfg.tenant_id
   AND v.company_id=cfg.company_id
   AND v.external_integration_id=cfg.external_integration_id
   AND v.fiscal_connection_id=cfg.fiscal_connection_id
   AND v.fiscal_emission_configuration_id=cfg.id
   AND v.document_type=cfg.document_type
   AND v.scope_type=cfg.scope_type
  WHERE cfg.tenant_id=NEW.tenant_id
    AND cfg.company_id=NEW.company_id
    AND cfg.external_integration_id=NEW.external_integration_id
    AND cfg.fiscal_connection_id=NEW.fiscal_connection_id
    AND cfg.document_type=document_type_pre
    AND (
      (cfg.scope_type='BRANCH' AND cfg.branch_id=document_branch_pre AND v.branch_id=document_branch_pre)
      OR (cfg.scope_type='COMPANY' AND cfg.branch_id IS NULL AND v.branch_id IS NULL)
    )
    AND v.status='PUBLISHED'
    AND v.valid_from<=transaction_timestamp()
    AND (v.valid_until IS NULL OR transaction_timestamp()<v.valid_until)
  ORDER BY CASE WHEN cfg.scope_type='BRANCH' THEN 0 ELSE 1 END, v.version_number DESC
  LIMIT 1
  FOR SHARE OF cfg,v;

  IF selected_version_id IS NULL
     OR selected_version_id<>NEW.emission_configuration_version_id THEN
    RAISE EXCEPTION 'preparation must use current BRANCH-over-COMPANY published configuration';
  END IF;

  -- Only after the upstream chain is locked may the preparation command lock the document.
  SELECT preparation_generation,document_type,branch_id
    INTO document_generation,document_type_value,document_branch
  FROM fiscal.electronic_documents
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND id=NEW.electronic_document_id
  FOR UPDATE;

  IF NOT FOUND
     OR document_generation<>document_generation_pre
     OR document_type_value<>document_type_pre
     OR document_branch<>document_branch_pre
     OR document_generation<>NEW.preparation_generation
     OR document_type_value<>NEW.document_type
     OR document_branch<>NEW.branch_id THEN
    RAISE EXCEPTION 'preparation document changed during canonical lock acquisition';
  END IF;

  IF NEW.preparation_state<>'DRAFT'
     OR NEW.provider_document_id IS NOT NULL
     OR NEW.provider_reference IS NOT NULL
     OR NEW.provider_status_raw IS NOT NULL THEN
    RAISE EXCEPTION 'preparation must start DRAFT without provider identity';
  END IF;

  IF NEW.preparation_generation>1 THEN
    SELECT id INTO prior_id
    FROM fiscal.fiscal_document_preparations
    WHERE tenant_id=NEW.tenant_id
      AND electronic_document_id=NEW.electronic_document_id
      AND preparation_generation=NEW.preparation_generation-1
    FOR SHARE;
    IF prior_id IS NULL OR NEW.supersedes_preparation_id IS DISTINCT FROM prior_id THEN
      RAISE EXCEPTION 'preparation must supersede the immediately prior generation';
    END IF;
  END IF;

  IF declaration_id IS NULL OR capability_id IS NULL THEN
    RAISE EXCEPTION 'preparation capability chain identity is incomplete';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_fiscal_preparation_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
BEGIN
  IF ROW(NEW.tenant_id,NEW.company_id,NEW.branch_id,NEW.electronic_document_id,NEW.document_type,NEW.preparation_generation,NEW.supersedes_preparation_id,NEW.external_integration_id,NEW.fiscal_connection_id,NEW.fiscal_emission_configuration_id,NEW.emission_configuration_version_id,NEW.created_by_actor_id,NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id,OLD.company_id,OLD.branch_id,OLD.electronic_document_id,OLD.document_type,OLD.preparation_generation,OLD.supersedes_preparation_id,OLD.external_integration_id,OLD.fiscal_connection_id,OLD.fiscal_emission_configuration_id,OLD.emission_configuration_version_id,OLD.created_by_actor_id,OLD.created_at) THEN
    RAISE EXCEPTION 'preparation identity and frozen scope are immutable';
  END IF;

  IF OLD.preparation_state<>'DRAFT' AND
     ROW(NEW.source_version,NEW.correction_source_reference,NEW.currency_code,NEW.subtotal_amount,NEW.discount_amount,NEW.tax_amount,NEW.total_amount,NEW.tax_snapshot_reference,NEW.tax_snapshot_checksum,NEW.fiscal_emission_snapshot_reference,NEW.fiscal_emission_snapshot_checksum,NEW.canonical_payload_version,NEW.canonical_payload_checksum)
     IS DISTINCT FROM
     ROW(OLD.source_version,OLD.correction_source_reference,OLD.currency_code,OLD.subtotal_amount,OLD.discount_amount,OLD.tax_amount,OLD.total_amount,OLD.tax_snapshot_reference,OLD.tax_snapshot_checksum,OLD.fiscal_emission_snapshot_reference,OLD.fiscal_emission_snapshot_checksum,OLD.canonical_payload_version,OLD.canonical_payload_checksum) THEN
    RAISE EXCEPTION 'frozen preparation material is immutable';
  END IF;

  IF NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'preparation version must increment exactly one';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_fiscal_preparation_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE transition text:=OLD.preparation_state||'>'||NEW.preparation_state;
BEGIN
  IF OLD.preparation_state=NEW.preparation_state THEN RETURN NEW; END IF;
  IF transition<>ALL(ARRAY['DRAFT>FROZEN','DRAFT>CANCELLED','FROZEN>CANCELLED']) THEN
    RAISE EXCEPTION 'invalid fiscal preparation transition %',transition;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_fiscal_preparation_numbering()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE transition text:=OLD.numbering_state||'>'||NEW.numbering_state;
BEGIN
  IF OLD.prefix IS NOT NULL AND NEW.prefix IS DISTINCT FROM OLD.prefix THEN
    RAISE EXCEPTION 'legal numbering prefix is write-once';
  END IF;
  IF OLD.number IS NOT NULL AND NEW.number IS DISTINCT FROM OLD.number THEN
    RAISE EXCEPTION 'legal number is write-once and non-reusable';
  END IF;

  IF OLD.numbering_state=NEW.numbering_state THEN RETURN NEW; END IF;

  IF OLD.preparation_state='CANCELLED' THEN
    IF OLD.numbering_mode NOT IN ('PROVIDER_ASSIGNED','AUTHORITY_ASSIGNED')
       OR OLD.numbering_state<>'PENDING_EXTERNAL'
       OR NEW.numbering_state NOT IN ('CONSUMED','UNKNOWN_OUTCOME') THEN
      RAISE EXCEPTION 'cancelled numbering is immutable except late remote evidence resolution';
    END IF;
  END IF;

  IF OLD.numbering_state IN ('CONSUMED','RELEASED_WITHOUT_REUSE','BURNED') THEN
    RAISE EXCEPTION 'terminal numbering state is immutable';
  END IF;
  IF transition<>ALL(ARRAY[
    'NOT_APPLICABLE>PENDING_EXTERNAL',
    'PENDING_EXTERNAL>RESERVED','PENDING_EXTERNAL>CONSUMED','PENDING_EXTERNAL>UNKNOWN_OUTCOME','PENDING_EXTERNAL>BURNED',
    'RESERVED>CONSUMED','RESERVED>UNKNOWN_OUTCOME','RESERVED>RELEASED_WITHOUT_REUSE','RESERVED>BURNED',
    'UNKNOWN_OUTCOME>CONSUMED','UNKNOWN_OUTCOME>BURNED'
  ]) THEN
    RAISE EXCEPTION 'invalid numbering transition %',transition;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_fiscal_preparation_late_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE
  provider_changed boolean;
  numbering_changed boolean;
  admissible_evidence boolean;
  verified_comparator boolean;
  verification_checksum text;
  current_generation bigint;
  current_status text;
BEGIN
  IF OLD.provider_document_id IS NOT NULL AND NEW.provider_document_id IS DISTINCT FROM OLD.provider_document_id THEN
    RAISE EXCEPTION 'provider_document_id is write-once';
  END IF;
  IF OLD.provider_reference IS NOT NULL AND NEW.provider_reference IS DISTINCT FROM OLD.provider_reference THEN
    RAISE EXCEPTION 'provider_reference is write-once';
  END IF;
  IF OLD.number IS NOT NULL AND NEW.number IS DISTINCT FROM OLD.number THEN
    RAISE EXCEPTION 'late evidence cannot rewrite legal number';
  END IF;

  IF OLD.preparation_state<>'CANCELLED' THEN
    RETURN NEW;
  END IF;

  provider_changed :=
    ROW(NEW.provider_document_id,NEW.provider_reference,NEW.provider_status_raw)
    IS DISTINCT FROM
    ROW(OLD.provider_document_id,OLD.provider_reference,OLD.provider_status_raw);

  numbering_changed :=
    ROW(NEW.numbering_state,NEW.prefix,NEW.number,NEW.number_reserved_at,NEW.number_consumed_at,NEW.number_burned_at,NEW.numbering_resolution_reason)
    IS DISTINCT FROM
    ROW(OLD.numbering_state,OLD.prefix,OLD.number,OLD.number_reserved_at,OLD.number_consumed_at,OLD.number_burned_at,OLD.numbering_resolution_reason);

  IF NOT provider_changed AND NOT numbering_changed THEN
    RETURN NEW;
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM integrations.external_webhook_receipts r
      WHERE r.tenant_id=OLD.tenant_id
        AND r.company_id=OLD.company_id
        AND r.integration_id=OLD.external_integration_id
        AND r.fiscal_electronic_document_id=OLD.electronic_document_id
        AND r.fiscal_document_preparation_id=OLD.id
        AND r.fiscal_preparation_generation=OLD.preparation_generation
        AND r.authentication_verification_result='VERIFIED'
        AND r.replay_verification_result='VERIFIED'
    )
    OR EXISTS (
      SELECT 1
      FROM fiscal.fiscal_submission_attempts a
      WHERE a.tenant_id=OLD.tenant_id
        AND a.company_id=OLD.company_id
        AND a.external_integration_id=OLD.external_integration_id
        AND a.electronic_document_id=OLD.electronic_document_id
        AND a.fiscal_document_preparation_id=OLD.id
        AND a.preparation_generation=OLD.preparation_generation
        AND a.transport_status='RESPONSE_RECEIVED'
        AND (
          a.provider_operation_id IS NOT NULL
          OR a.provider_correlation_reference IS NOT NULL
          OR a.provider_response_reference IS NOT NULL
          OR a.http_status IS NOT NULL
          OR a.normalized_result IS NOT NULL
        )
    )
    OR EXISTS (
      SELECT 1
      FROM fiscal.fiscal_artifacts a
      WHERE a.tenant_id=OLD.tenant_id
        AND a.company_id=OLD.company_id
        AND a.external_integration_id=OLD.external_integration_id
        AND a.electronic_document_id=OLD.electronic_document_id
        AND a.fiscal_document_preparation_id=OLD.id
        AND a.preparation_generation=OLD.preparation_generation
        AND a.immutable_evidence
        AND a.artifact_type IN ('AUTHORITY_RESPONSE','PROVIDER_RESPONSE')
    )
    OR EXISTS (
      SELECT 1
      FROM fiscal.fiscal_reconciliations r
      WHERE r.tenant_id=OLD.tenant_id
        AND r.company_id=OLD.company_id
        AND r.external_integration_id=OLD.external_integration_id
        AND r.electronic_document_id=OLD.electronic_document_id
        AND r.preparation_generation=OLD.preparation_generation
        AND r.status IN ('REVIEW_REQUIRED','PARTIALLY_RECONCILED','RECONCILED','CLOSED')
        AND (r.provider_evidence_reference IS NOT NULL OR r.authority_evidence_reference IS NOT NULL)
    )
  INTO admissible_evidence;

  IF NOT admissible_evidence THEN
    RAISE EXCEPTION 'cancelled preparation late evidence requires admissible generation-scoped evidence';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM fiscal.fiscal_reconciliation_items ri
    JOIN fiscal.fiscal_reconciliations r
      ON r.tenant_id=ri.tenant_id AND r.company_id=ri.company_id
     AND r.external_integration_id=ri.external_integration_id
     AND r.fiscal_connection_id=ri.fiscal_connection_id
     AND r.id=ri.fiscal_reconciliation_id
    WHERE ri.tenant_id=OLD.tenant_id
      AND ri.company_id=OLD.company_id
      AND ri.external_integration_id=OLD.external_integration_id
      AND ri.electronic_document_id=OLD.electronic_document_id
      AND ri.fiscal_document_preparation_id=OLD.id
      AND ri.preparation_generation=OLD.preparation_generation
      AND ri.result_code='VERIFIED_LATE_REMOTE_EVIDENCE_V1'
      AND ri.expected_state_reference=jsonb_build_array(NEW.prefix,NEW.number,NEW.numbering_state,NEW.provider_document_id,NEW.provider_reference,NEW.provider_status_raw)::text
      AND ri.evidence_checksum ~ '^[0-9a-f]{64}$'
      AND btrim(ri.observed_state_reference)<>''
      AND btrim(ri.evidence_reference)<>''
      AND r.status IN ('REVIEW_REQUIRED','PARTIALLY_RECONCILED','RECONCILED','CLOSED')
  ) INTO verified_comparator;

  IF NOT verified_comparator THEN
    RAISE EXCEPTION 'late remote mutation requires VERIFIED_LATE_REMOTE_EVIDENCE_V1 comparator output';
  END IF;

  IF numbering_changed THEN
    IF OLD.numbering_mode NOT IN ('PROVIDER_ASSIGNED','AUTHORITY_ASSIGNED')
       OR OLD.numbering_state<>'PENDING_EXTERNAL'
       OR OLD.prefix IS NOT NULL
       OR OLD.number IS NOT NULL
       OR NEW.numbering_state NOT IN ('CONSUMED','UNKNOWN_OUTCOME')
       OR NEW.number IS NULL
       OR NEW.number_reserved_at IS DISTINCT FROM OLD.number_reserved_at
       OR NEW.number_burned_at IS DISTINCT FROM OLD.number_burned_at
       OR (NEW.numbering_state='UNKNOWN_OUTCOME' AND NEW.number_consumed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'cancelled preparation permits only evidence-backed late remote numbering';
    END IF;

    IF NEW.numbering_resolution_reason !~ '^LATE_REMOTE_EVIDENCE_V1:[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'late remote numbering must bind to verified comparator checksum';
    END IF;
    verification_checksum:=split_part(NEW.numbering_resolution_reason,':',2);
    IF NOT EXISTS (
      SELECT 1 FROM fiscal.fiscal_reconciliation_items ri
      WHERE ri.tenant_id=OLD.tenant_id AND ri.company_id=OLD.company_id
        AND ri.external_integration_id=OLD.external_integration_id
        AND ri.electronic_document_id=OLD.electronic_document_id
        AND ri.fiscal_document_preparation_id=OLD.id
        AND ri.preparation_generation=OLD.preparation_generation
        AND ri.result_code='VERIFIED_LATE_REMOTE_EVIDENCE_V1'
        AND ri.expected_state_reference=jsonb_build_array(NEW.prefix,NEW.number,NEW.numbering_state,NEW.provider_document_id,NEW.provider_reference,NEW.provider_status_raw)::text
        AND lower(ri.evidence_checksum)=verification_checksum
    ) THEN
      RAISE EXCEPTION 'late remote numbering values are not bound to verified source evidence';
    END IF;
  END IF;

  SELECT preparation_generation,status INTO current_generation,current_status
  FROM fiscal.electronic_documents
  WHERE tenant_id=OLD.tenant_id AND company_id=OLD.company_id AND id=OLD.electronic_document_id
  FOR UPDATE;

  IF current_generation>OLD.preparation_generation
     AND current_status IN ('DRAFT','READY','QUEUED','SUBMITTING','CONTINGENCY','VOIDED_BEFORE_SUBMISSION') THEN
    UPDATE fiscal.electronic_documents
    SET status='UNKNOWN_OUTCOME',uncertainty_reason='HISTORICAL_GENERATION_EVIDENCE',
        updated_at=GREATEST(updated_at,transaction_timestamp()),version=version+1
    WHERE tenant_id=OLD.tenant_id AND company_id=OLD.company_id
      AND id=OLD.electronic_document_id AND preparation_generation=current_generation AND status=current_status;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_submission_attempt_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
BEGIN
  IF NEW.dispatch_class<>'FISCAL' OR NEW.operation_type<>'SUBMIT_DOCUMENT' THEN
    RAISE EXCEPTION 'only FISCAL SUBMIT_DOCUMENT attempts are materialized in V1';
  END IF;
  IF NEW.status NOT IN ('CREATED','IN_PROGRESS') THEN
    RAISE EXCEPTION 'submission attempt must start CREATED or IN_PROGRESS';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_submission_attempt_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
BEGIN
  IF ROW(NEW.tenant_id,NEW.company_id,NEW.external_integration_id,NEW.fiscal_connection_id,NEW.electronic_document_id,NEW.fiscal_document_preparation_id,NEW.preparation_generation,NEW.integration_dispatch_id,NEW.credential_binding_id,NEW.credential_binding_generation,NEW.dispatch_class,NEW.operation_type,NEW.attempt_number,NEW.request_id,NEW.idempotency_key,NEW.request_checksum,NEW.correlation_id,NEW.causation_id,NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id,OLD.company_id,OLD.external_integration_id,OLD.fiscal_connection_id,OLD.electronic_document_id,OLD.fiscal_document_preparation_id,OLD.preparation_generation,OLD.integration_dispatch_id,OLD.credential_binding_id,OLD.credential_binding_generation,OLD.dispatch_class,OLD.operation_type,OLD.attempt_number,OLD.request_id,OLD.idempotency_key,OLD.request_checksum,OLD.correlation_id,OLD.causation_id,OLD.created_at) THEN
    RAISE EXCEPTION 'submission attempt root and request identity are immutable';
  END IF;
  IF NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'submission attempt version must increment exactly one';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_submission_attempt_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE transition text:=OLD.status||'>'||NEW.status;
BEGIN
  IF OLD.status=NEW.status THEN RETURN NEW; END IF;
  IF transition<>ALL(ARRAY[
    'CREATED>IN_PROGRESS','CREATED>CANCELLED',
    'IN_PROGRESS>COMPLETED','IN_PROGRESS>FAILED','IN_PROGRESS>UNKNOWN_OUTCOME'
  ]) THEN
    RAISE EXCEPTION 'invalid submission attempt transition %',transition;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_attempt_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE expected integer;
BEGIN
  PERFORM 1
  FROM integrations.integration_dispatches
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND id=NEW.integration_dispatch_id
    AND dispatch_class='FISCAL'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal dispatch lock required'; END IF;

  SELECT coalesce(max(attempt_number),0)+1 INTO expected
  FROM fiscal.fiscal_submission_attempts
  WHERE tenant_id=NEW.tenant_id
    AND integration_dispatch_id=NEW.integration_dispatch_id;

  IF NEW.attempt_number<>expected THEN
    RAISE EXCEPTION 'attempt number is not monotonic for dispatch';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_submission_attempt_root()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE
  dispatch integrations.integration_dispatches%ROWTYPE;
  binding integrations.integration_credential_bindings%ROWTYPE;
  prep fiscal.fiscal_document_preparations%ROWTYPE;
  doc fiscal.electronic_documents%ROWTYPE;
  integration_pre integrations.external_integrations%ROWTYPE;
  integration integrations.external_integrations%ROWTYPE;
  expected_capability text;
  declaration_id uuid;
  capability_id uuid;
  capability_version bigint;
  selected_version_id uuid;
  connection_valid_from timestamptz;
  connection_valid_until timestamptz;
  entering_in_progress boolean;
BEGIN
  SELECT * INTO prep
  FROM fiscal.fiscal_document_preparations
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND external_integration_id=NEW.external_integration_id
    AND fiscal_connection_id=NEW.fiscal_connection_id
    AND electronic_document_id=NEW.electronic_document_id
    AND preparation_generation=NEW.preparation_generation
    AND id=NEW.fiscal_document_preparation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt preparation root not found'; END IF;

  SELECT * INTO dispatch
  FROM integrations.integration_dispatches
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND id=NEW.integration_dispatch_id
    AND dispatch_class='FISCAL';
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt fiscal dispatch root not found'; END IF;

  expected_capability:=CASE prep.document_type
    WHEN 'ELECTRONIC_SALES_INVOICE' THEN 'ELECTRONIC_INVOICING'
    WHEN 'CREDIT_NOTE' THEN 'CREDIT_NOTES'
    WHEN 'DEBIT_NOTE' THEN 'DEBIT_NOTES'
    WHEN 'SUPPORT_DOCUMENT' THEN 'SUPPORT_DOCUMENTS'
    WHEN 'SUPPORT_DOCUMENT_ADJUSTMENT' THEN 'SUPPORT_DOCUMENTS'
    ELSE NULL
  END;

  IF dispatch.integration_id<>NEW.external_integration_id
     OR dispatch.internal_entity_id<>NEW.electronic_document_id
     OR dispatch.fiscal_document_preparation_id<>NEW.fiscal_document_preparation_id
     OR dispatch.fiscal_preparation_generation<>NEW.preparation_generation
     OR dispatch.capability_code<>expected_capability
     OR dispatch.idempotency_key<>NEW.idempotency_key
     OR dispatch.fiscal_request_semantic_checksum<>NEW.request_checksum THEN
    RAISE EXCEPTION 'submission attempt root differs from dispatch/preparation root';
  END IF;

  entering_in_progress :=
    (TG_OP='INSERT' AND NEW.status='IN_PROGRESS')
    OR
    (TG_OP='UPDATE' AND OLD.status<>'IN_PROGRESS' AND NEW.status='IN_PROGRESS');

  -- Response/evidence updates after the durable claim must remain recordable even
  -- if outbound eligibility changes while HTTP is in flight. Immutable root scope
  -- is still checked above and by guard_submission_attempt_update().
  IF NOT entering_in_progress THEN
    RETURN NEW;
  END IF;

  SELECT * INTO integration_pre
  FROM integrations.external_integrations
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND id=NEW.external_integration_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim integration not found'; END IF;

  SELECT d.id INTO declaration_id
  FROM integrations.provider_capability_declarations d
  WHERE d.provider_id=integration_pre.provider_id
    AND d.provider_adapter_version_id=integration_pre.provider_adapter_version_id
    AND d.capability_code=expected_capability
    AND d.support_status='SUPPORTED'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim requires SUPPORTED adapter capability declaration';
  END IF;

  PERFORM 1
  FROM integrations.provider_adapter_versions av
  WHERE av.provider_id=integration_pre.provider_id
    AND av.provider_adapter_version_id=integration_pre.provider_adapter_version_id
    AND av.retired_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim adapter version is absent or retired'; END IF;

  SELECT * INTO integration
  FROM integrations.external_integrations i
  WHERE i.tenant_id=NEW.tenant_id
    AND i.company_id=NEW.company_id
    AND i.id=NEW.external_integration_id
  FOR SHARE;
  IF NOT FOUND
     OR integration.status<>'ACTIVE'
     OR integration.provider_id<>integration_pre.provider_id
     OR integration.provider_adapter_version_id<>integration_pre.provider_adapter_version_id THEN
    RAISE EXCEPTION 'claim requires stable ACTIVE ExternalIntegration identity';
  END IF;

  SELECT c.id,c.configuration_version
    INTO capability_id,capability_version
  FROM integrations.integration_capabilities c
  WHERE c.tenant_id=NEW.tenant_id
    AND c.company_id=NEW.company_id
    AND c.integration_id=NEW.external_integration_id
    AND c.capability_code=expected_capability
    AND c.support_status='SUPPORTED'
    AND c.effective_from<=transaction_timestamp()
    AND (c.effective_until IS NULL OR transaction_timestamp()<c.effective_until)
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim requires effective SUPPORTED integration capability';
  END IF;

  SELECT * INTO binding
  FROM integrations.integration_credential_bindings
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND integration_id=NEW.external_integration_id
    AND id=NEW.credential_binding_id
    AND generation=NEW.credential_binding_generation
  FOR SHARE;
  IF NOT FOUND OR binding.status<>'ACTIVE' THEN
    RAISE EXCEPTION 'claim requires exact ACTIVE credential binding generation';
  END IF;

  SELECT c.valid_from,c.valid_until
    INTO connection_valid_from,connection_valid_until
  FROM fiscal.fiscal_connections c
  WHERE c.tenant_id=NEW.tenant_id
    AND c.company_id=NEW.company_id
    AND c.external_integration_id=NEW.external_integration_id
    AND c.id=NEW.fiscal_connection_id
  FOR UPDATE;
  IF NOT FOUND
     OR connection_valid_from>transaction_timestamp()
     OR (connection_valid_until IS NOT NULL AND transaction_timestamp()>=connection_valid_until) THEN
    RAISE EXCEPTION 'claim requires effective FiscalConnection';
  END IF;

  SELECT v.id
    INTO selected_version_id
  FROM fiscal.fiscal_emission_configurations cfg
  JOIN fiscal.fiscal_emission_configuration_versions v
    ON v.tenant_id=cfg.tenant_id
   AND v.company_id=cfg.company_id
   AND v.external_integration_id=cfg.external_integration_id
   AND v.fiscal_connection_id=cfg.fiscal_connection_id
   AND v.fiscal_emission_configuration_id=cfg.id
   AND v.document_type=cfg.document_type
   AND v.scope_type=cfg.scope_type
  WHERE cfg.tenant_id=NEW.tenant_id
    AND cfg.company_id=NEW.company_id
    AND cfg.external_integration_id=NEW.external_integration_id
    AND cfg.fiscal_connection_id=NEW.fiscal_connection_id
    AND cfg.document_type=prep.document_type
    AND (
      (cfg.scope_type='BRANCH' AND cfg.branch_id=prep.branch_id AND v.branch_id=prep.branch_id)
      OR (cfg.scope_type='COMPANY' AND cfg.branch_id IS NULL AND v.branch_id IS NULL)
    )
    AND v.status='PUBLISHED'
    AND v.valid_from<=transaction_timestamp()
    AND (v.valid_until IS NULL OR transaction_timestamp()<v.valid_until)
  ORDER BY CASE WHEN cfg.scope_type='BRANCH' THEN 0 ELSE 1 END, v.version_number DESC
  LIMIT 1
  FOR SHARE OF cfg,v;

  IF selected_version_id IS NULL
     OR selected_version_id<>prep.emission_configuration_version_id THEN
    RAISE EXCEPTION 'claim fiscal configuration drifted from BRANCH-over-COMPANY selection';
  END IF;

  SELECT * INTO doc
  FROM fiscal.electronic_documents
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND id=NEW.electronic_document_id
  FOR UPDATE;

  SELECT * INTO prep
  FROM fiscal.fiscal_document_preparations
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND external_integration_id=NEW.external_integration_id
    AND fiscal_connection_id=NEW.fiscal_connection_id
    AND electronic_document_id=NEW.electronic_document_id
    AND preparation_generation=NEW.preparation_generation
    AND id=NEW.fiscal_document_preparation_id
  FOR UPDATE;

  SELECT * INTO dispatch
  FROM integrations.integration_dispatches
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND id=NEW.integration_dispatch_id
    AND dispatch_class='FISCAL'
  FOR UPDATE;

  IF doc.preparation_generation<>NEW.preparation_generation
     OR doc.branch_id<>prep.branch_id
     OR prep.preparation_state<>'FROZEN' THEN
    RAISE EXCEPTION 'claim document/preparation fence is stale';
  END IF;

  IF dispatch.integration_id<>NEW.external_integration_id
     OR dispatch.internal_entity_id<>NEW.electronic_document_id
     OR dispatch.fiscal_document_preparation_id<>NEW.fiscal_document_preparation_id
     OR dispatch.fiscal_preparation_generation<>NEW.preparation_generation
     OR dispatch.capability_code<>expected_capability
     OR dispatch.idempotency_key<>NEW.idempotency_key
     OR dispatch.fiscal_request_semantic_checksum<>NEW.request_checksum THEN
    RAISE EXCEPTION 'submission attempt root differs from locked dispatch/preparation root';
  END IF;

  IF dispatch.status<>'DISPATCHING' THEN
    RAISE EXCEPTION 'IN_PROGRESS attempt requires DISPATCHING dispatch';
  END IF;
  IF doc.status<>'SUBMITTING' THEN
    RAISE EXCEPTION 'IN_PROGRESS attempt requires SUBMITTING current document';
  END IF;

  IF capability_id IS NULL OR capability_version IS NULL OR declaration_id IS NULL THEN
    RAISE EXCEPTION 'claim chain identity is incomplete';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_fiscal_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE
  prep fiscal.fiscal_document_preparations%ROWTYPE;
  doc fiscal.electronic_documents%ROWTYPE;
  expected_capability text;
  expected_root text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.dispatch_class='FISCAL' THEN
    IF ROW(NEW.tenant_id,NEW.company_id,NEW.integration_id,NEW.capability_code,NEW.dispatch_class,NEW.resource_type,NEW.internal_operation_id,NEW.internal_entity_type,NEW.internal_entity_id,NEW.idempotency_key,NEW.payload_schema_version,NEW.payload_checksum,NEW.fiscal_document_preparation_id,NEW.fiscal_preparation_generation,NEW.fiscal_request_semantic_version,NEW.fiscal_request_semantic_checksum)
       IS DISTINCT FROM
       ROW(OLD.tenant_id,OLD.company_id,OLD.integration_id,OLD.capability_code,OLD.dispatch_class,OLD.resource_type,OLD.internal_operation_id,OLD.internal_entity_type,OLD.internal_entity_id,OLD.idempotency_key,OLD.payload_schema_version,OLD.payload_checksum,OLD.fiscal_document_preparation_id,OLD.fiscal_preparation_generation,OLD.fiscal_request_semantic_version,OLD.fiscal_request_semantic_checksum) THEN
      RAISE EXCEPTION 'fiscal dispatch provider-facing identity is immutable';
    END IF;
  END IF;

  IF NEW.dispatch_class<>'FISCAL' THEN RETURN NEW; END IF;

  SELECT * INTO prep
  FROM fiscal.fiscal_document_preparations
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND external_integration_id=NEW.integration_id
    AND electronic_document_id=NEW.internal_entity_id
    AND preparation_generation=NEW.fiscal_preparation_generation
    AND id=NEW.fiscal_document_preparation_id;

  IF NOT FOUND OR prep.preparation_state<>'FROZEN' THEN
    RAISE EXCEPTION 'fiscal dispatch requires exact frozen preparation';
  END IF;

  SELECT * INTO doc
  FROM fiscal.electronic_documents
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND id=NEW.internal_entity_id;

  IF NOT FOUND OR doc.preparation_generation<>NEW.fiscal_preparation_generation THEN
    RAISE EXCEPTION 'fiscal dispatch must target current document generation';
  END IF;

  expected_capability:=CASE doc.document_type
    WHEN 'ELECTRONIC_SALES_INVOICE' THEN 'ELECTRONIC_INVOICING'
    WHEN 'CREDIT_NOTE' THEN 'CREDIT_NOTES'
    WHEN 'DEBIT_NOTE' THEN 'DEBIT_NOTES'
    WHEN 'SUPPORT_DOCUMENT' THEN 'SUPPORT_DOCUMENTS'
    WHEN 'SUPPORT_DOCUMENT_ADJUSTMENT' THEN 'SUPPORT_DOCUMENTS'
    ELSE NULL
  END;

  expected_root:=format(
    'FISCAL_SUBMIT_DISPATCH_V1:%s:%s:%s:%s:SUBMIT_DOCUMENT',
    NEW.tenant_id,NEW.integration_id,NEW.internal_entity_id,NEW.fiscal_preparation_generation
  );

  IF NEW.resource_type<>'ELECTRONIC_DOCUMENT'
     OR NEW.internal_entity_type<>'ElectronicDocument'
     OR NEW.capability_code IS DISTINCT FROM expected_capability
     OR NEW.idempotency_key<>expected_root
     OR NEW.payload_schema_version<>prep.canonical_payload_version
     OR NEW.payload_checksum<>prep.canonical_payload_checksum THEN
    RAISE EXCEPTION 'fiscal dispatch canonical identity mismatch';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_fiscal_webhook_correlation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
DECLARE
  document_generation bigint;
  document_status text;
  preparation_state_value text;
  dispatch integrations.integration_dispatches%ROWTYPE;
BEGIN
  IF NEW.fiscal_electronic_document_id IS NULL THEN
    IF TG_OP='UPDATE' AND OLD.fiscal_electronic_document_id IS NOT NULL THEN
      RAISE EXCEPTION 'fiscal webhook correlation is write-once';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.authentication_verification_result<>'VERIFIED'
     OR NEW.replay_verification_result<>'VERIFIED' THEN
    RAISE EXCEPTION 'only VERIFIED auth and replay receipts are admissible fiscal evidence in V1';
  END IF;

  IF TG_OP='UPDATE' AND OLD.fiscal_electronic_document_id IS NOT NULL AND
     ROW(NEW.fiscal_electronic_document_id,NEW.fiscal_document_preparation_id,NEW.fiscal_preparation_generation,NEW.fiscal_integration_dispatch_id,NEW.fiscal_correlated_at)
     IS DISTINCT FROM
     ROW(OLD.fiscal_electronic_document_id,OLD.fiscal_document_preparation_id,OLD.fiscal_preparation_generation,OLD.fiscal_integration_dispatch_id,OLD.fiscal_correlated_at) THEN
    RAISE EXCEPTION 'fiscal webhook correlation is immutable once set';
  END IF;

  SELECT preparation_generation,status
    INTO document_generation,document_status
  FROM fiscal.electronic_documents
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND id=NEW.fiscal_electronic_document_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal webhook document not found'; END IF;

  SELECT preparation_state
    INTO preparation_state_value
  FROM fiscal.fiscal_document_preparations
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND external_integration_id=NEW.integration_id
    AND electronic_document_id=NEW.fiscal_electronic_document_id
    AND preparation_generation=NEW.fiscal_preparation_generation
    AND id=NEW.fiscal_document_preparation_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal webhook preparation not found'; END IF;

  SELECT * INTO dispatch
  FROM integrations.integration_dispatches
  WHERE tenant_id=NEW.tenant_id
    AND company_id=NEW.company_id
    AND integration_id=NEW.integration_id
    AND id=NEW.fiscal_integration_dispatch_id
    AND dispatch_class='FISCAL'
  FOR UPDATE;

  IF NOT FOUND
     OR dispatch.internal_entity_id<>NEW.fiscal_electronic_document_id
     OR dispatch.fiscal_document_preparation_id<>NEW.fiscal_document_preparation_id
     OR dispatch.fiscal_preparation_generation<>NEW.fiscal_preparation_generation THEN
    RAISE EXCEPTION 'webhook fiscal correlation scope mismatch';
  END IF;

  IF NEW.fiscal_preparation_generation>document_generation THEN
    RAISE EXCEPTION 'webhook cannot correlate to a future preparation generation';
  END IF;

  IF NEW.fiscal_preparation_generation<document_generation THEN
    IF preparation_state_value<>'CANCELLED' THEN
      RAISE EXCEPTION 'historical webhook evidence requires historical CANCELLED preparation';
    END IF;

    IF document_status IN ('DRAFT','READY','QUEUED','SUBMITTING','CONTINGENCY','VOIDED_BEFORE_SUBMISSION') THEN
      UPDATE fiscal.electronic_documents
      SET status='UNKNOWN_OUTCOME',
          uncertainty_reason='HISTORICAL_GENERATION_EVIDENCE',
          updated_at=GREATEST(updated_at,transaction_timestamp()),
          version=version+1
      WHERE tenant_id=NEW.tenant_id
        AND company_id=NEW.company_id
        AND id=NEW.fiscal_electronic_document_id
        AND preparation_generation=document_generation
        AND status=document_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE FUNCTION fiscal.guard_capability_downgrade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,fiscal,integrations
AS $function$
BEGIN
  IF OLD.support_status='SUPPORTED'
     AND NEW.support_status<>'SUPPORTED'
     AND NEW.capability_code IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS')
     AND EXISTS (
       SELECT 1
       FROM integrations.integration_capabilities c
       JOIN integrations.external_integrations i
         ON i.tenant_id=c.tenant_id
        AND i.company_id=c.company_id
        AND i.id=c.integration_id
       WHERE i.provider_adapter_version_id=NEW.provider_adapter_version_id
         AND c.capability_code=NEW.capability_code
         AND c.support_status='SUPPORTED'
         AND c.effective_from<=transaction_timestamp()
         AND (c.effective_until IS NULL OR transaction_timestamp()<c.effective_until)
     ) THEN
    RAISE EXCEPTION 'effective fiscal capability must be downgraded first';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE UNIQUE INDEX fiscal_emission_configurations_company_scope_uq ON fiscal.fiscal_emission_configurations(tenant_id,company_id,fiscal_connection_id,document_type) WHERE scope_type='COMPANY';

CREATE UNIQUE INDEX fiscal_emission_configurations_branch_scope_uq ON fiscal.fiscal_emission_configurations(tenant_id,company_id,branch_id,fiscal_connection_id,document_type) WHERE scope_type='BRANCH';

CREATE UNIQUE INDEX electronic_documents_legal_identifier_uq ON fiscal.electronic_documents(tenant_id,company_id,legal_identifier) WHERE legal_identifier IS NOT NULL;

CREATE UNIQUE INDEX fiscal_document_preparations_legal_number_uq ON fiscal.fiscal_document_preparations(tenant_id,company_id,COALESCE(prefix,''),number) WHERE number IS NOT NULL;

CREATE UNIQUE INDEX fiscal_document_preparations_provider_document_uq ON fiscal.fiscal_document_preparations(tenant_id,external_integration_id,provider_document_id) WHERE provider_document_id IS NOT NULL;

CREATE UNIQUE INDEX integration_dispatches_one_fiscal_per_preparation_uq ON integrations.integration_dispatches(tenant_id,fiscal_document_preparation_id) WHERE dispatch_class='FISCAL';

CREATE UNIQUE INDEX fiscal_submission_attempts_one_in_progress_uq ON fiscal.fiscal_submission_attempts(tenant_id,integration_dispatch_id) WHERE status='IN_PROGRESS';

CREATE INDEX fiscal_connections_scope_effective_idx ON fiscal.fiscal_connections(tenant_id,company_id,external_integration_id,valid_from DESC);

CREATE INDEX fiscal_connections_capability_fk_idx ON fiscal.fiscal_connections(tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code);

CREATE INDEX fiscal_emission_configurations_branch_fk_idx ON fiscal.fiscal_emission_configurations(tenant_id,company_id,branch_id) WHERE branch_id IS NOT NULL;

CREATE INDEX fiscal_emission_configuration_versions_lookup_idx ON fiscal.fiscal_emission_configuration_versions(tenant_id,company_id,fiscal_emission_configuration_id,status,valid_from DESC);

CREATE INDEX fiscal_emission_configuration_versions_supersedes_idx ON fiscal.fiscal_emission_configuration_versions(tenant_id,company_id,fiscal_emission_configuration_id,supersedes_version_id) WHERE supersedes_version_id IS NOT NULL;

CREATE INDEX electronic_documents_source_idx ON fiscal.electronic_documents(tenant_id,company_id,source_type,source_id,created_at DESC);

CREATE INDEX electronic_documents_work_idx ON fiscal.electronic_documents(tenant_id,status,created_at,id) WHERE status IN ('READY','QUEUED','SUBMITTING');

CREATE INDEX electronic_documents_uncertain_idx ON fiscal.electronic_documents(tenant_id,last_reconciled_at,id) WHERE status='UNKNOWN_OUTCOME';

CREATE INDEX electronic_documents_original_idx ON fiscal.electronic_documents(tenant_id,company_id,original_electronic_document_id) WHERE original_electronic_document_id IS NOT NULL;

CREATE INDEX fiscal_document_preparations_document_generation_idx ON fiscal.fiscal_document_preparations(tenant_id,electronic_document_id,preparation_generation DESC);

CREATE INDEX fiscal_document_preparations_integration_connection_idx ON fiscal.fiscal_document_preparations(tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,preparation_generation);

CREATE INDEX fiscal_document_preparations_supersedes_idx ON fiscal.fiscal_document_preparations(tenant_id,electronic_document_id,supersedes_preparation_id) WHERE supersedes_preparation_id IS NOT NULL;

CREATE INDEX fiscal_document_preparations_created_by_idx ON fiscal.fiscal_document_preparations(created_by_actor_id);

CREATE INDEX fiscal_document_preparations_cancelled_by_idx ON fiscal.fiscal_document_preparations(cancelled_by_actor_id) WHERE cancelled_by_actor_id IS NOT NULL;

CREATE INDEX fiscal_submission_attempts_dispatch_fk_idx ON fiscal.fiscal_submission_attempts(tenant_id,company_id,integration_dispatch_id,dispatch_class);

CREATE INDEX fiscal_submission_attempts_document_generation_idx ON fiscal.fiscal_submission_attempts(tenant_id,company_id,electronic_document_id,preparation_generation,created_at DESC);

CREATE INDEX fiscal_submission_attempts_unknown_idx ON fiscal.fiscal_submission_attempts(tenant_id,created_at,id) WHERE status='UNKNOWN_OUTCOME';

CREATE INDEX fiscal_submission_attempts_provider_operation_idx ON fiscal.fiscal_submission_attempts(tenant_id,external_integration_id,provider_operation_id) WHERE provider_operation_id IS NOT NULL;

CREATE INDEX fiscal_artifacts_document_generation_idx ON fiscal.fiscal_artifacts(tenant_id,company_id,electronic_document_id,preparation_generation,artifact_type,created_at);

CREATE INDEX fiscal_artifacts_attempt_fk_idx ON fiscal.fiscal_artifacts(tenant_id,company_id,external_integration_id,electronic_document_id,preparation_generation,fiscal_submission_attempt_id) WHERE fiscal_submission_attempt_id IS NOT NULL;

CREATE INDEX fiscal_reconciliations_work_idx ON fiscal.fiscal_reconciliations(tenant_id,status,created_at,id) WHERE status IN ('CREATED','RUNNING','REVIEW_REQUIRED','PARTIALLY_RECONCILED','REOPENED');

CREATE INDEX fiscal_reconciliations_connection_idx ON fiscal.fiscal_reconciliations(tenant_id,company_id,external_integration_id,fiscal_connection_id,created_at DESC);

CREATE INDEX fiscal_reconciliations_document_generation_idx ON fiscal.fiscal_reconciliations(tenant_id,company_id,electronic_document_id,preparation_generation,created_at DESC) WHERE scope_type='DOCUMENT';

CREATE INDEX fiscal_incidents_open_idx ON fiscal.fiscal_incidents(tenant_id,company_id,severity,created_at,id) WHERE status IN ('OPEN','IN_REVIEW');

CREATE INDEX fiscal_incidents_document_generation_idx ON fiscal.fiscal_incidents(tenant_id,company_id,electronic_document_id,preparation_generation) WHERE electronic_document_id IS NOT NULL;

CREATE INDEX fiscal_incidents_attempt_idx ON fiscal.fiscal_incidents(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_submission_attempt_id) WHERE fiscal_submission_attempt_id IS NOT NULL;

CREATE INDEX fiscal_incidents_reconciliation_idx ON fiscal.fiscal_incidents(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id) WHERE fiscal_reconciliation_id IS NOT NULL;

CREATE INDEX fiscal_reconciliation_items_document_generation_idx ON fiscal.fiscal_reconciliation_items(tenant_id,company_id,electronic_document_id,preparation_generation,created_at);

CREATE INDEX fiscal_reconciliation_items_incident_idx ON fiscal.fiscal_reconciliation_items(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_incident_id) WHERE fiscal_incident_id IS NOT NULL;

CREATE INDEX fiscal_reconciliation_items_preparation_idx ON fiscal.fiscal_reconciliation_items(tenant_id,company_id,external_integration_id,electronic_document_id,preparation_generation,fiscal_document_preparation_id);

CREATE INDEX integration_dispatches_fiscal_preparation_idx ON integrations.integration_dispatches(tenant_id,company_id,internal_entity_id,fiscal_preparation_generation) WHERE dispatch_class='FISCAL';

CREATE INDEX external_webhook_receipts_fiscal_correlation_idx ON integrations.external_webhook_receipts(tenant_id,company_id,fiscal_electronic_document_id,fiscal_preparation_generation) WHERE fiscal_electronic_document_id IS NOT NULL;

CREATE INDEX external_webhook_receipts_integration_fk_idx ON integrations.external_webhook_receipts(tenant_id,company_id,integration_id,fiscal_integration_dispatch_id) WHERE fiscal_integration_dispatch_id IS NOT NULL;

ALTER TABLE fiscal.fiscal_connections ENABLE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_connections FORCE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_emission_configurations ENABLE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_emission_configurations FORCE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_emission_configuration_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_emission_configuration_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE fiscal.electronic_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE fiscal.electronic_documents FORCE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_document_preparations ENABLE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_document_preparations FORCE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_submission_attempts ENABLE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_submission_attempts FORCE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_artifacts ENABLE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_artifacts FORCE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_reconciliations ENABLE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_reconciliations FORCE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_incidents ENABLE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_incidents FORCE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_reconciliation_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE fiscal.fiscal_reconciliation_items FORCE ROW LEVEL SECURITY;

CREATE POLICY fiscal_connections_tenant_isolation ON fiscal.fiscal_connections TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());

CREATE POLICY fiscal_emission_configurations_tenant_isolation ON fiscal.fiscal_emission_configurations TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());

CREATE POLICY fiscal_emission_configuration_versions_app_tenant_isolation ON fiscal.fiscal_emission_configuration_versions TO pos_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());

CREATE POLICY fiscal_emission_configuration_versions_platform_tenant_isolation ON fiscal.fiscal_emission_configuration_versions FOR SELECT TO pos_platform_app USING (tenant_id=platform.current_tenant_id());

CREATE POLICY fiscal_emission_configuration_versions_worker_published_history ON fiscal.fiscal_emission_configuration_versions FOR SELECT TO pos_worker USING (tenant_id=platform.current_tenant_id() AND (status='PUBLISHED' OR (status IN ('SUPERSEDED','REVOKED') AND EXISTS (SELECT 1 FROM fiscal.fiscal_document_preparations p WHERE p.tenant_id=fiscal_emission_configuration_versions.tenant_id AND p.emission_configuration_version_id=fiscal_emission_configuration_versions.id))));

CREATE POLICY fiscal_emission_configuration_versions_worker_numbering_update ON fiscal.fiscal_emission_configuration_versions FOR UPDATE TO pos_worker USING (tenant_id=platform.current_tenant_id() AND status='PUBLISHED') WITH CHECK (tenant_id=platform.current_tenant_id() AND status='PUBLISHED');

CREATE POLICY electronic_documents_tenant_isolation ON fiscal.electronic_documents TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());

CREATE POLICY fiscal_document_preparations_app_tenant_isolation ON fiscal.fiscal_document_preparations TO pos_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());

CREATE POLICY fiscal_document_preparations_platform_tenant_select ON fiscal.fiscal_document_preparations FOR SELECT TO pos_platform_app USING (tenant_id=platform.current_tenant_id());

CREATE POLICY fiscal_document_preparations_worker_frozen ON fiscal.fiscal_document_preparations TO pos_worker USING (tenant_id=platform.current_tenant_id() AND preparation_state='FROZEN') WITH CHECK (tenant_id=platform.current_tenant_id() AND preparation_state='FROZEN');

CREATE POLICY fiscal_document_preparations_worker_historical_evidence ON fiscal.fiscal_document_preparations TO pos_worker USING (tenant_id=platform.current_tenant_id() AND preparation_state='CANCELLED' AND (provider_document_id IS NOT NULL OR provider_reference IS NOT NULL OR provider_status_raw IS NOT NULL OR numbering_state IN ('CONSUMED','UNKNOWN_OUTCOME','BURNED') OR EXISTS (SELECT 1 FROM fiscal.fiscal_submission_attempts a WHERE a.tenant_id=fiscal_document_preparations.tenant_id AND a.electronic_document_id=fiscal_document_preparations.electronic_document_id AND a.preparation_generation=fiscal_document_preparations.preparation_generation) OR EXISTS (SELECT 1 FROM fiscal.fiscal_artifacts a WHERE a.tenant_id=fiscal_document_preparations.tenant_id AND a.electronic_document_id=fiscal_document_preparations.electronic_document_id AND a.preparation_generation=fiscal_document_preparations.preparation_generation) OR EXISTS (SELECT 1 FROM integrations.external_webhook_receipts r WHERE r.tenant_id=fiscal_document_preparations.tenant_id AND r.fiscal_electronic_document_id=fiscal_document_preparations.electronic_document_id AND r.fiscal_preparation_generation=fiscal_document_preparations.preparation_generation AND r.authentication_verification_result='VERIFIED' AND r.replay_verification_result='VERIFIED') OR EXISTS (SELECT 1 FROM fiscal.fiscal_reconciliations r WHERE r.tenant_id=fiscal_document_preparations.tenant_id AND r.electronic_document_id=fiscal_document_preparations.electronic_document_id AND r.preparation_generation=fiscal_document_preparations.preparation_generation AND r.status IN ('RUNNING','REVIEW_REQUIRED','PARTIALLY_RECONCILED','RECONCILED','CLOSED','REOPENED')) OR EXISTS (SELECT 1 FROM fiscal.fiscal_reconciliation_items ri WHERE ri.tenant_id=fiscal_document_preparations.tenant_id AND ri.electronic_document_id=fiscal_document_preparations.electronic_document_id AND ri.fiscal_document_preparation_id=fiscal_document_preparations.id AND ri.preparation_generation=fiscal_document_preparations.preparation_generation AND ri.result_code='VERIFIED_LATE_REMOTE_EVIDENCE_V1' AND ri.evidence_reference IS NOT NULL AND ri.evidence_checksum~'^[0-9a-f]{64}$') OR EXISTS (SELECT 1 FROM fiscal.electronic_documents d WHERE d.tenant_id=fiscal_document_preparations.tenant_id AND d.id=fiscal_document_preparations.electronic_document_id AND (d.authority_reference IS NOT NULL OR d.legal_identifier IS NOT NULL OR d.status='UNKNOWN_OUTCOME')))) WITH CHECK (tenant_id=platform.current_tenant_id() AND preparation_state='CANCELLED' AND (provider_document_id IS NOT NULL OR provider_reference IS NOT NULL OR provider_status_raw IS NOT NULL OR numbering_state IN ('CONSUMED','UNKNOWN_OUTCOME','BURNED') OR EXISTS (SELECT 1 FROM fiscal.fiscal_submission_attempts a WHERE a.tenant_id=fiscal_document_preparations.tenant_id AND a.electronic_document_id=fiscal_document_preparations.electronic_document_id AND a.preparation_generation=fiscal_document_preparations.preparation_generation) OR EXISTS (SELECT 1 FROM fiscal.fiscal_artifacts a WHERE a.tenant_id=fiscal_document_preparations.tenant_id AND a.electronic_document_id=fiscal_document_preparations.electronic_document_id AND a.preparation_generation=fiscal_document_preparations.preparation_generation) OR EXISTS (SELECT 1 FROM integrations.external_webhook_receipts r WHERE r.tenant_id=fiscal_document_preparations.tenant_id AND r.fiscal_electronic_document_id=fiscal_document_preparations.electronic_document_id AND r.fiscal_preparation_generation=fiscal_document_preparations.preparation_generation AND r.authentication_verification_result='VERIFIED' AND r.replay_verification_result='VERIFIED') OR EXISTS (SELECT 1 FROM fiscal.fiscal_reconciliations r WHERE r.tenant_id=fiscal_document_preparations.tenant_id AND r.electronic_document_id=fiscal_document_preparations.electronic_document_id AND r.preparation_generation=fiscal_document_preparations.preparation_generation AND r.status IN ('RUNNING','REVIEW_REQUIRED','PARTIALLY_RECONCILED','RECONCILED','CLOSED','REOPENED')) OR EXISTS (SELECT 1 FROM fiscal.fiscal_reconciliation_items ri WHERE ri.tenant_id=fiscal_document_preparations.tenant_id AND ri.electronic_document_id=fiscal_document_preparations.electronic_document_id AND ri.fiscal_document_preparation_id=fiscal_document_preparations.id AND ri.preparation_generation=fiscal_document_preparations.preparation_generation AND ri.result_code='VERIFIED_LATE_REMOTE_EVIDENCE_V1' AND ri.evidence_reference IS NOT NULL AND ri.evidence_checksum~'^[0-9a-f]{64}$') OR EXISTS (SELECT 1 FROM fiscal.electronic_documents d WHERE d.tenant_id=fiscal_document_preparations.tenant_id AND d.id=fiscal_document_preparations.electronic_document_id AND (d.authority_reference IS NOT NULL OR d.legal_identifier IS NOT NULL OR d.status='UNKNOWN_OUTCOME'))));

CREATE POLICY fiscal_submission_attempts_tenant_isolation ON fiscal.fiscal_submission_attempts TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());

CREATE POLICY fiscal_artifacts_tenant_isolation ON fiscal.fiscal_artifacts TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());

CREATE POLICY fiscal_reconciliations_tenant_isolation ON fiscal.fiscal_reconciliations TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());

CREATE POLICY fiscal_incidents_tenant_isolation ON fiscal.fiscal_incidents TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());

CREATE POLICY fiscal_reconciliation_items_tenant_isolation ON fiscal.fiscal_reconciliation_items TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());

CREATE TRIGGER fiscal_connections_scope_guard BEFORE INSERT OR UPDATE ON fiscal.fiscal_connections FOR EACH ROW EXECUTE FUNCTION fiscal.guard_connection_scope();

CREATE TRIGGER fiscal_connections_capability_guard BEFORE INSERT OR UPDATE OF electronic_invoicing_capability_id,capability_code ON fiscal.fiscal_connections FOR EACH ROW EXECUTE FUNCTION fiscal.guard_connection_scope();

CREATE TRIGGER fiscal_emission_configurations_scope_guard BEFORE UPDATE ON fiscal.fiscal_emission_configurations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_append_only();

CREATE TRIGGER fiscal_emission_configuration_versions_update_guard BEFORE UPDATE ON fiscal.fiscal_emission_configuration_versions FOR EACH ROW EXECUTE FUNCTION fiscal.guard_allowed_update_columns('issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,certificate_reference,contingency_policy_reference,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,valid_until,status,published_at,published_by_actor_id,updated_at,row_version');

CREATE TRIGGER fiscal_emission_configuration_versions_state_guard BEFORE INSERT OR UPDATE ON fiscal.fiscal_emission_configuration_versions FOR EACH ROW EXECUTE FUNCTION fiscal.guard_configuration_version_state();

CREATE TRIGGER fiscal_emission_configuration_versions_numbering_guard BEFORE INSERT OR UPDATE ON fiscal.fiscal_emission_configuration_versions FOR EACH ROW EXECUTE FUNCTION fiscal.guard_configuration_scope();

CREATE TRIGGER electronic_documents_insert_guard BEFORE INSERT ON fiscal.electronic_documents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_electronic_document_insert();

CREATE TRIGGER electronic_documents_update_guard BEFORE UPDATE ON fiscal.electronic_documents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_electronic_document_update();

CREATE TRIGGER electronic_documents_state_guard BEFORE UPDATE OF status ON fiscal.electronic_documents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_electronic_document_state();

CREATE TRIGGER electronic_documents_evidence_guard BEFORE UPDATE OF authority_reference,legal_identifier,authority_status_raw,uncertainty_reason,issued_at,accepted_at,rejected_at,last_reconciled_at ON fiscal.electronic_documents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_electronic_document_evidence();

CREATE TRIGGER electronic_documents_reprepare_guard BEFORE UPDATE OF preparation_generation ON fiscal.electronic_documents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_electronic_document_reprepare();

CREATE CONSTRAINT TRIGGER electronic_documents_current_preparation_guard AFTER INSERT OR UPDATE ON fiscal.electronic_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fiscal.validate_current_fiscal_preparation_invariant();

CREATE TRIGGER fiscal_document_preparations_insert_guard BEFORE INSERT ON fiscal.fiscal_document_preparations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_fiscal_preparation_insert();

CREATE TRIGGER fiscal_document_preparations_update_guard BEFORE UPDATE ON fiscal.fiscal_document_preparations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_fiscal_preparation_update();

CREATE TRIGGER fiscal_document_preparations_state_guard BEFORE UPDATE OF preparation_state ON fiscal.fiscal_document_preparations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_fiscal_preparation_state();

CREATE TRIGGER fiscal_document_preparations_numbering_guard BEFORE UPDATE OF numbering_state,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason ON fiscal.fiscal_document_preparations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_fiscal_preparation_numbering();

CREATE TRIGGER fiscal_document_preparations_late_evidence_guard BEFORE UPDATE OF provider_document_id,provider_reference,provider_status_raw,numbering_state,prefix,number,number_consumed_at,numbering_resolution_reason ON fiscal.fiscal_document_preparations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_fiscal_preparation_late_evidence();

CREATE CONSTRAINT TRIGGER fiscal_document_preparations_current_generation_guard AFTER INSERT OR UPDATE OR DELETE ON fiscal.fiscal_document_preparations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fiscal.validate_current_fiscal_preparation_invariant();

CREATE TRIGGER fiscal_submission_attempts_insert_guard BEFORE INSERT ON fiscal.fiscal_submission_attempts FOR EACH ROW EXECUTE FUNCTION fiscal.guard_submission_attempt_insert();

CREATE TRIGGER fiscal_submission_attempts_update_guard BEFORE UPDATE ON fiscal.fiscal_submission_attempts FOR EACH ROW EXECUTE FUNCTION fiscal.guard_submission_attempt_update();

CREATE TRIGGER fiscal_submission_attempts_state_guard BEFORE UPDATE OF status ON fiscal.fiscal_submission_attempts FOR EACH ROW EXECUTE FUNCTION fiscal.guard_submission_attempt_state();

CREATE TRIGGER fiscal_submission_attempts_number_guard BEFORE INSERT ON fiscal.fiscal_submission_attempts FOR EACH ROW EXECUTE FUNCTION fiscal.guard_attempt_number();

CREATE TRIGGER fiscal_submission_attempts_root_guard BEFORE INSERT OR UPDATE ON fiscal.fiscal_submission_attempts FOR EACH ROW EXECUTE FUNCTION fiscal.guard_submission_attempt_root();

CREATE TRIGGER fiscal_artifacts_immutable_guard BEFORE UPDATE OR DELETE ON fiscal.fiscal_artifacts FOR EACH ROW EXECUTE FUNCTION fiscal.guard_append_only();

CREATE TRIGGER fiscal_reconciliations_insert_guard BEFORE INSERT ON fiscal.fiscal_reconciliations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_initial_status('CREATED');

CREATE TRIGGER fiscal_reconciliations_update_guard BEFORE UPDATE ON fiscal.fiscal_reconciliations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_allowed_update_columns('status,observed_state_snapshot_reference,provider_evidence_reference,authority_evidence_reference,discrepancy_summary_code,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,started_at,closed_at,updated_at,version');

CREATE TRIGGER fiscal_reconciliations_state_guard BEFORE UPDATE OF status ON fiscal.fiscal_reconciliations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_state_transition('status','CREATED>RUNNING,CREATED>CANCELLED,RUNNING>REVIEW_REQUIRED,RUNNING>PARTIALLY_RECONCILED,RUNNING>RECONCILED,RUNNING>FAILED,RUNNING>CANCELLED,REVIEW_REQUIRED>PARTIALLY_RECONCILED,REVIEW_REQUIRED>RECONCILED,REVIEW_REQUIRED>CLOSED,PARTIALLY_RECONCILED>RECONCILED,PARTIALLY_RECONCILED>CLOSED,RECONCILED>CLOSED,CLOSED>REOPENED,REOPENED>RUNNING');

CREATE TRIGGER fiscal_incidents_insert_guard BEFORE INSERT ON fiscal.fiscal_incidents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_initial_status('OPEN');

CREATE TRIGGER fiscal_incidents_update_guard BEFORE UPDATE ON fiscal.fiscal_incidents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_allowed_update_columns('status,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,updated_at,version');

CREATE TRIGGER fiscal_incidents_state_guard BEFORE UPDATE OF status ON fiscal.fiscal_incidents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_state_transition('status','OPEN>IN_REVIEW,OPEN>RESOLVED,IN_REVIEW>RESOLVED,RESOLVED>ARCHIVED');

CREATE TRIGGER fiscal_reconciliation_items_immutable_guard BEFORE UPDATE OR DELETE ON fiscal.fiscal_reconciliation_items FOR EACH ROW EXECUTE FUNCTION fiscal.guard_append_only();

CREATE TRIGGER integration_dispatches_fiscal_preparation_guard BEFORE INSERT OR UPDATE ON integrations.integration_dispatches FOR EACH ROW EXECUTE FUNCTION fiscal.guard_fiscal_dispatch();

CREATE TRIGGER external_webhook_receipts_fiscal_correlation_guard AFTER INSERT OR UPDATE OF fiscal_electronic_document_id,fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_integration_dispatch_id,fiscal_correlated_at ON integrations.external_webhook_receipts FOR EACH ROW EXECUTE FUNCTION fiscal.guard_fiscal_webhook_correlation();

CREATE TRIGGER provider_capability_declarations_fiscal_downgrade_guard BEFORE UPDATE OF support_status ON integrations.provider_capability_declarations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_capability_downgrade();

CREATE TRIGGER external_webhook_receipts_update_guard_003 BEFORE UPDATE ON integrations.external_webhook_receipts FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('processing_status,attempt_count,next_attempt_at,last_error_code,processed_at,version,fiscal_electronic_document_id,fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_integration_dispatch_id,fiscal_correlated_at');

DROP TRIGGER external_webhook_receipts_update_guard ON integrations.external_webhook_receipts;

GRANT INSERT (id,tenant_id,company_id,integration_id,deduplication_key,received_at,payload_schema_version,payload_checksum,authentication_verification_result,replay_verification_result,processing_status,attempt_count,correlation_id,provider_event_id,payload_evidence_reference,next_attempt_at,last_error_code,processed_at,created_at,version) ON integrations.external_webhook_receipts TO pos_platform_app;

REVOKE INSERT ON integrations.external_webhook_receipts FROM pos_platform_app;

GRANT INSERT (id,tenant_id,company_id,integration_id,capability_code,dispatch_class,resource_type,internal_operation_id,internal_entity_type,internal_entity_id,idempotency_key,payload_schema_version,payload_checksum,status,correlation_id,provider_request_reference,retry_classification,next_attempt_at,last_reconciled_at,causation_id,created_at,updated_at,version) ON integrations.integration_dispatches TO pos_platform_app;

REVOKE INSERT ON integrations.integration_dispatches FROM pos_platform_app;

GRANT UPDATE (id) ON integrations.provider_capability_declarations TO pos_app,pos_worker;

GRANT UPDATE (provider_adapter_version_id) ON integrations.provider_adapter_versions TO pos_app,pos_worker;

GRANT UPDATE (id) ON integrations.integration_capabilities TO pos_worker;

GRANT UPDATE (id) ON integrations.integration_credential_bindings TO pos_worker;

GRANT USAGE ON SCHEMA fiscal TO pos_app,pos_worker,pos_platform_app,pos_platform_admin;

REVOKE ALL ON ALL TABLES IN SCHEMA fiscal FROM PUBLIC;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fiscal FROM PUBLIC;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code,valid_from,valid_until,created_at,updated_at,version) ON fiscal.fiscal_connections TO pos_app;

GRANT INSERT (id,tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code,valid_from,valid_until,created_at,updated_at,version) ON fiscal.fiscal_connections TO pos_app;

GRANT UPDATE (valid_until,updated_at,version) ON fiscal.fiscal_connections TO pos_app;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code,valid_from,valid_until,created_at,updated_at,version) ON fiscal.fiscal_connections TO pos_worker;

GRANT UPDATE (id) ON fiscal.fiscal_connections TO pos_worker;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,capability_code,valid_from,valid_until,created_at,updated_at,version) ON fiscal.fiscal_connections TO pos_platform_app;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,capability_code,valid_from,valid_until,created_at,updated_at,version) ON fiscal.fiscal_connections TO pos_platform_admin;

GRANT SELECT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,document_type,created_at) ON fiscal.fiscal_emission_configurations TO pos_app;

GRANT INSERT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,document_type,created_at) ON fiscal.fiscal_emission_configurations TO pos_app;

GRANT UPDATE (id) ON fiscal.fiscal_emission_configurations TO pos_app;

GRANT SELECT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,document_type,created_at) ON fiscal.fiscal_emission_configurations TO pos_worker;

GRANT UPDATE (id) ON fiscal.fiscal_emission_configurations TO pos_worker;

GRANT SELECT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,document_type,created_at) ON fiscal.fiscal_emission_configurations TO pos_platform_app;

GRANT SELECT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,document_type,created_at) ON fiscal.fiscal_emission_configurations TO pos_platform_admin;

GRANT SELECT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,fiscal_emission_configuration_id,document_type,version_number,status,issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,contingency_policy_reference,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,valid_until,published_at,supersedes_version_id,created_by_actor_id,published_by_actor_id,created_at,updated_at,row_version) ON fiscal.fiscal_emission_configuration_versions TO pos_app;

GRANT INSERT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,fiscal_emission_configuration_id,document_type,version_number,status,issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,provider_numbering_reference,certificate_reference,contingency_policy_reference,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,valid_until,supersedes_version_id,created_by_actor_id,created_at,updated_at,row_version) ON fiscal.fiscal_emission_configuration_versions TO pos_app;

GRANT UPDATE (issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,certificate_reference,contingency_policy_reference,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,valid_until,status,published_at,published_by_actor_id,updated_at,row_version) ON fiscal.fiscal_emission_configuration_versions TO pos_app;

GRANT SELECT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,fiscal_emission_configuration_id,document_type,version_number,status,issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,certificate_reference,contingency_policy_reference,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,valid_until,published_at,supersedes_version_id,created_by_actor_id,published_by_actor_id,created_at,updated_at,row_version) ON fiscal.fiscal_emission_configuration_versions TO pos_worker;

GRANT UPDATE (next_number_value,numbering_exhausted_at,updated_at,row_version) ON fiscal.fiscal_emission_configuration_versions TO pos_worker;

GRANT SELECT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,fiscal_emission_configuration_id,document_type,version_number,status,issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,contingency_policy_reference,configuration_schema_version,valid_from,valid_until,published_at,supersedes_version_id,created_by_actor_id,published_by_actor_id,created_at,updated_at,row_version) ON fiscal.fiscal_emission_configuration_versions TO pos_platform_app;

GRANT SELECT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,fiscal_emission_configuration_id,document_type,version_number,status,issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,contingency_policy_reference,configuration_schema_version,valid_from,valid_until,published_at,supersedes_version_id,created_by_actor_id,published_by_actor_id,created_at,updated_at,row_version) ON fiscal.fiscal_emission_configuration_versions TO pos_platform_admin;

GRANT SELECT (id,tenant_id,company_id,branch_id,source_type,source_id,document_type,logical_operation_key,status,internal_reference,preparation_generation,authority_reference,legal_identifier,authority_status_raw,uncertainty_reason,original_electronic_document_id,issued_at,accepted_at,rejected_at,last_reconciled_at,created_at,updated_at,version) ON fiscal.electronic_documents TO pos_app;

GRANT INSERT (id,tenant_id,company_id,branch_id,source_type,source_id,document_type,logical_operation_key,status,internal_reference,preparation_generation,original_electronic_document_id,created_at,updated_at,version) ON fiscal.electronic_documents TO pos_app;

GRANT UPDATE (status,internal_reference,preparation_generation,updated_at,version) ON fiscal.electronic_documents TO pos_app;

GRANT SELECT (id,tenant_id,company_id,branch_id,source_type,source_id,document_type,logical_operation_key,status,internal_reference,preparation_generation,authority_reference,legal_identifier,authority_status_raw,uncertainty_reason,original_electronic_document_id,issued_at,accepted_at,rejected_at,last_reconciled_at,created_at,updated_at,version) ON fiscal.electronic_documents TO pos_worker;

GRANT UPDATE (status,authority_reference,legal_identifier,authority_status_raw,uncertainty_reason,issued_at,accepted_at,rejected_at,last_reconciled_at,updated_at,version) ON fiscal.electronic_documents TO pos_worker;

GRANT SELECT (id,tenant_id,company_id,branch_id,source_type,source_id,document_type,logical_operation_key,status,internal_reference,preparation_generation,authority_reference,legal_identifier,original_electronic_document_id,issued_at,accepted_at,rejected_at,last_reconciled_at,created_at,updated_at,version) ON fiscal.electronic_documents TO pos_platform_app;

GRANT SELECT (id,tenant_id,company_id,branch_id,source_type,source_id,document_type,logical_operation_key,status,internal_reference,preparation_generation,authority_reference,legal_identifier,original_electronic_document_id,issued_at,accepted_at,rejected_at,last_reconciled_at,created_at,updated_at,version) ON fiscal.electronic_documents TO pos_platform_admin;

GRANT SELECT (id,tenant_id,company_id,branch_id,electronic_document_id,document_type,preparation_generation,supersedes_preparation_id,preparation_state,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_version,correction_source_reference,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,numbering_mode,numbering_state,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,provider_status_raw,created_by_actor_id,frozen_at,cancelled_at,cancelled_by_actor_id,cancellation_reason,created_at,updated_at,version) ON fiscal.fiscal_document_preparations TO pos_app;

GRANT INSERT (id,tenant_id,company_id,branch_id,electronic_document_id,document_type,preparation_generation,supersedes_preparation_id,preparation_state,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_version,correction_source_reference,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,numbering_mode,numbering_state,prefix,number,number_reserved_at,created_by_actor_id,created_at,updated_at,version) ON fiscal.fiscal_document_preparations TO pos_app;

GRANT UPDATE (source_version,correction_source_reference,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,numbering_state,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,preparation_state,frozen_at,cancelled_at,cancelled_by_actor_id,cancellation_reason,updated_at,version) ON fiscal.fiscal_document_preparations TO pos_app;

GRANT SELECT (id,tenant_id,company_id,branch_id,electronic_document_id,document_type,preparation_generation,supersedes_preparation_id,preparation_state,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_version,correction_source_reference,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,numbering_mode,numbering_state,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,provider_status_raw,created_by_actor_id,frozen_at,cancelled_at,cancelled_by_actor_id,cancellation_reason,created_at,updated_at,version) ON fiscal.fiscal_document_preparations TO pos_worker;

GRANT UPDATE (numbering_state,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,provider_status_raw,updated_at,version) ON fiscal.fiscal_document_preparations TO pos_worker;

GRANT SELECT (id,tenant_id,company_id,branch_id,electronic_document_id,document_type,preparation_generation,supersedes_preparation_id,preparation_state,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_version,correction_source_reference,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,canonical_payload_version,numbering_mode,numbering_state,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,provider_status_raw,created_by_actor_id,frozen_at,cancelled_at,cancelled_by_actor_id,cancellation_reason,created_at,updated_at,version) ON fiscal.fiscal_document_preparations TO pos_platform_app;

GRANT SELECT (id,tenant_id,company_id,branch_id,electronic_document_id,document_type,preparation_generation,supersedes_preparation_id,preparation_state,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_version,correction_source_reference,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,canonical_payload_version,numbering_mode,numbering_state,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,provider_status_raw,created_by_actor_id,frozen_at,cancelled_at,cancelled_by_actor_id,cancellation_reason,created_at,updated_at,version) ON fiscal.fiscal_document_preparations TO pos_platform_admin;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,integration_dispatch_id,credential_binding_id,credential_binding_generation,dispatch_class,operation_type,attempt_number,status,transport_status,normalized_result,request_id,idempotency_key,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,correlation_id,causation_id,created_at,version) ON fiscal.fiscal_submission_attempts TO pos_app;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,integration_dispatch_id,credential_binding_id,credential_binding_generation,dispatch_class,operation_type,attempt_number,status,transport_status,normalized_result,request_id,idempotency_key,request_checksum,provider_operation_id,provider_correlation_reference,provider_response_reference,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,correlation_id,causation_id,created_at,version) ON fiscal.fiscal_submission_attempts TO pos_worker;

GRANT INSERT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,integration_dispatch_id,credential_binding_id,credential_binding_generation,dispatch_class,operation_type,attempt_number,status,request_id,idempotency_key,request_checksum,correlation_id,causation_id,created_at,version) ON fiscal.fiscal_submission_attempts TO pos_worker;

GRANT UPDATE (status,transport_status,normalized_result,provider_operation_id,provider_correlation_reference,provider_response_reference,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,version) ON fiscal.fiscal_submission_attempts TO pos_worker;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,integration_dispatch_id,credential_binding_id,credential_binding_generation,dispatch_class,operation_type,attempt_number,status,transport_status,normalized_result,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,correlation_id,causation_id,created_at,version) ON fiscal.fiscal_submission_attempts TO pos_platform_app;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,integration_dispatch_id,credential_binding_id,credential_binding_generation,dispatch_class,operation_type,attempt_number,status,transport_status,normalized_result,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,correlation_id,causation_id,created_at,version) ON fiscal.fiscal_submission_attempts TO pos_platform_admin;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,fiscal_submission_attempt_id,artifact_type,media_type,checksum_algorithm,checksum,size_bytes,retention_policy_reference,immutable_evidence,created_at) ON fiscal.fiscal_artifacts TO pos_app;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,fiscal_submission_attempt_id,artifact_type,media_type,storage_reference,checksum_algorithm,checksum,size_bytes,provider_reference,authority_reference,retention_policy_reference,immutable_evidence,created_at) ON fiscal.fiscal_artifacts TO pos_worker;

GRANT INSERT (id,tenant_id,company_id,external_integration_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,fiscal_submission_attempt_id,artifact_type,media_type,storage_reference,checksum_algorithm,checksum,size_bytes,provider_reference,authority_reference,retention_policy_reference,immutable_evidence,created_at) ON fiscal.fiscal_artifacts TO pos_worker;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,fiscal_submission_attempt_id,artifact_type,media_type,checksum_algorithm,checksum,size_bytes,retention_policy_reference,immutable_evidence,created_at) ON fiscal.fiscal_artifacts TO pos_platform_app;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,fiscal_submission_attempt_id,artifact_type,media_type,checksum_algorithm,checksum,size_bytes,retention_policy_reference,immutable_evidence,created_at) ON fiscal.fiscal_artifacts TO pos_platform_admin;

GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,scope_type,electronic_document_id,preparation_generation,status,discrepancy_summary_code,started_by_actor_id,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,started_at,closed_at,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_app;

GRANT INSERT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,scope_type,electronic_document_id,preparation_generation,scope_snapshot_reference,scope_snapshot_checksum,status,expected_state_snapshot_reference,started_by_actor_id,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_app;

GRANT UPDATE (status,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,closed_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_app;

GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,scope_type,electronic_document_id,preparation_generation,scope_snapshot_reference,scope_snapshot_checksum,status,expected_state_snapshot_reference,observed_state_snapshot_reference,provider_evidence_reference,authority_evidence_reference,discrepancy_summary_code,started_by_actor_id,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,started_at,closed_at,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_worker;

GRANT INSERT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,scope_type,electronic_document_id,preparation_generation,scope_snapshot_reference,scope_snapshot_checksum,status,expected_state_snapshot_reference,started_by_actor_id,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_worker;

GRANT UPDATE (status,observed_state_snapshot_reference,provider_evidence_reference,authority_evidence_reference,discrepancy_summary_code,started_at,closed_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_worker;

GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,scope_type,electronic_document_id,preparation_generation,status,discrepancy_summary_code,started_by_actor_id,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,started_at,closed_at,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_platform_app;

GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,scope_type,electronic_document_id,preparation_generation,status,discrepancy_summary_code,started_by_actor_id,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,started_at,closed_at,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_platform_admin;

GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,preparation_generation,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_incidents TO pos_app;

GRANT INSERT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,preparation_generation,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,evidence_reference,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_incidents TO pos_app;

GRANT UPDATE (status,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,updated_at,version) ON fiscal.fiscal_incidents TO pos_app;

GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,preparation_generation,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,evidence_reference,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_incidents TO pos_worker;

GRANT INSERT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,preparation_generation,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,evidence_reference,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_incidents TO pos_worker;

GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,preparation_generation,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_incidents TO pos_platform_app;

GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,preparation_generation,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_incidents TO pos_platform_admin;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,evidence_checksum,discrepancy_code,result_code,fiscal_incident_id,created_at) ON fiscal.fiscal_reconciliation_items TO pos_app;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,expected_state_reference,observed_state_reference,evidence_checksum,discrepancy_code,result_code,evidence_reference,fiscal_incident_id,created_at) ON fiscal.fiscal_reconciliation_items TO pos_worker;

GRANT INSERT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,expected_state_reference,observed_state_reference,evidence_checksum,discrepancy_code,result_code,evidence_reference,fiscal_incident_id,created_at) ON fiscal.fiscal_reconciliation_items TO pos_worker;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,evidence_checksum,discrepancy_code,result_code,fiscal_incident_id,created_at) ON fiscal.fiscal_reconciliation_items TO pos_platform_app;

GRANT SELECT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id,electronic_document_id,fiscal_document_preparation_id,preparation_generation,evidence_checksum,discrepancy_code,result_code,fiscal_incident_id,created_at) ON fiscal.fiscal_reconciliation_items TO pos_platform_admin;

GRANT SELECT (fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_request_semantic_version,fiscal_request_semantic_checksum) ON integrations.integration_dispatches TO pos_app;

GRANT INSERT (fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_request_semantic_version,fiscal_request_semantic_checksum) ON integrations.integration_dispatches TO pos_app;

GRANT SELECT (fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_request_semantic_version,fiscal_request_semantic_checksum) ON integrations.integration_dispatches TO pos_worker;

GRANT SELECT (fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_request_semantic_version,fiscal_request_semantic_checksum) ON integrations.integration_dispatches TO pos_platform_app;

GRANT SELECT (fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_request_semantic_version,fiscal_request_semantic_checksum) ON integrations.integration_dispatches TO pos_platform_admin;

GRANT SELECT (fiscal_electronic_document_id,fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_integration_dispatch_id,fiscal_correlated_at) ON integrations.external_webhook_receipts TO pos_app;

GRANT SELECT (fiscal_electronic_document_id,fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_integration_dispatch_id,fiscal_correlated_at) ON integrations.external_webhook_receipts TO pos_worker;

GRANT UPDATE (fiscal_electronic_document_id,fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_integration_dispatch_id,fiscal_correlated_at) ON integrations.external_webhook_receipts TO pos_worker;

GRANT SELECT (fiscal_electronic_document_id,fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_integration_dispatch_id,fiscal_correlated_at) ON integrations.external_webhook_receipts TO pos_platform_app;

GRANT SELECT (fiscal_electronic_document_id,fiscal_document_preparation_id,fiscal_preparation_generation,fiscal_integration_dispatch_id,fiscal_correlated_at) ON integrations.external_webhook_receipts TO pos_platform_admin;

GRANT EXECUTE ON FUNCTION fiscal.safe_external_text(text,integer) TO pos_app,pos_worker,pos_schema_owner;

GRANT EXECUTE ON FUNCTION fiscal.has_correlated_generation_evidence(uuid,uuid,bigint) TO pos_app,pos_worker,pos_schema_owner;

ALTER FUNCTION fiscal.safe_external_text(value text,max_bytes integer) OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_allowed_update_columns() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_initial_status() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_state_transition() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_append_only() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_configuration_version_state() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_connection_scope() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_configuration_scope() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_electronic_document_insert() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_electronic_document_update() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_electronic_document_state() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_electronic_document_evidence() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.has_correlated_generation_evidence(p_tenant_id uuid,p_document_id uuid,p_generation bigint) OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_electronic_document_reprepare() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.validate_current_fiscal_preparation_invariant() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_fiscal_preparation_insert() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_fiscal_preparation_update() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_fiscal_preparation_state() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_fiscal_preparation_numbering() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_fiscal_preparation_late_evidence() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_submission_attempt_insert() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_submission_attempt_update() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_submission_attempt_state() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_attempt_number() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_submission_attempt_root() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_fiscal_dispatch() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_fiscal_webhook_correlation() OWNER TO pos_schema_owner;

ALTER FUNCTION fiscal.guard_capability_downgrade() OWNER TO pos_schema_owner;

ALTER TABLE integrations.integration_dispatches ADD CONSTRAINT integration_dispatches_dispatch_class_003_ck CHECK ((dispatch_class='FISCAL' AND capability_code IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS') AND resource_type='ELECTRONIC_DOCUMENT' AND internal_entity_type='ElectronicDocument') OR (dispatch_class='NON_FISCAL' AND capability_code NOT IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS') AND internal_entity_type<>'ElectronicDocument')) NOT VALID;

ALTER TABLE integrations.integration_dispatches VALIDATE CONSTRAINT integration_dispatches_dispatch_class_003_ck;

ALTER TABLE integrations.integration_dispatches DROP CONSTRAINT integration_dispatches_dispatch_class_002_ck;

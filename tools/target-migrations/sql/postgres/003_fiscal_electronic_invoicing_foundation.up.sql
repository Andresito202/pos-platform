CREATE SCHEMA fiscal AUTHORIZATION pos_schema_owner;
REVOKE ALL ON SCHEMA fiscal FROM PUBLIC;

ALTER TABLE integrations.integration_capabilities
  ADD CONSTRAINT integration_capabilities_fiscal_scope_uq
  UNIQUE (tenant_id,company_id,integration_id,id,capability_code);

CREATE FUNCTION fiscal.guard_allowed_update_columns()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fiscal,integrations AS $$
DECLARE allowed text[]:=string_to_array(TG_ARGV[0],',');
BEGIN
  IF (to_jsonb(NEW)-allowed) IS DISTINCT FROM (to_jsonb(OLD)-allowed) THEN
    RAISE EXCEPTION 'immutable columns changed on %',TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION fiscal.guard_initial_status()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fiscal,integrations AS $$
BEGIN
  IF NEW.status<>TG_ARGV[0] THEN RAISE EXCEPTION 'invalid initial status on %',TG_TABLE_NAME; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION fiscal.guard_state_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fiscal,integrations AS $$
DECLARE old_state text:=to_jsonb(OLD)->>TG_ARGV[0]; new_state text:=to_jsonb(NEW)->>TG_ARGV[0];
BEGIN
  IF old_state<>new_state AND old_state||'>'||new_state<>ALL(string_to_array(TG_ARGV[1],',')) THEN
    RAISE EXCEPTION 'invalid % transition on %',TG_ARGV[0],TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION fiscal.guard_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fiscal,integrations AS $$
BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME; END;
$$;

CREATE FUNCTION fiscal.guard_configuration_version_state()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fiscal,integrations AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'DRAFT' OR NEW.published_at IS NOT NULL OR NEW.published_by_actor_id IS NOT NULL OR NEW.numbering_exhausted_at IS NOT NULL THEN RAISE EXCEPTION 'configuration version must start DRAFT'; END IF;
  ELSIF OLD.status<>NEW.status AND OLD.status||'>'||NEW.status<>ALL(ARRAY['DRAFT>PUBLISHED','PUBLISHED>SUPERSEDED','PUBLISHED>REVOKED']) THEN
    RAISE EXCEPTION 'invalid configuration version transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION fiscal.safe_external_text(value text,max_bytes integer)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
  SELECT value=btrim(value)
     AND value<>''
     AND octet_length(convert_to(value,'UTF8'))<=max_bytes
     AND value!~'[[:cntrl:]]'
     AND value!~*'(authorization|bearer|api[_-]?key|client[_-]?secret|private[ _-]?key|token|jwt|credential)'
$$;

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
ALTER TABLE fiscal.fiscal_connections ADD CONSTRAINT fiscal_connections_company_validity_excl EXCLUDE USING gist (tenant_id WITH =,company_id WITH =,external_integration_id WITH =,tstzrange(valid_from,valid_until,'[)') WITH &&);

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
CREATE UNIQUE INDEX fiscal_emission_configurations_company_scope_uq ON fiscal.fiscal_emission_configurations(tenant_id,company_id,fiscal_connection_id,document_type) WHERE scope_type='COMPANY';
CREATE UNIQUE INDEX fiscal_emission_configurations_branch_scope_uq ON fiscal.fiscal_emission_configurations(tenant_id,company_id,branch_id,fiscal_connection_id,document_type) WHERE scope_type='BRANCH';

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
  CONSTRAINT fiscal_emission_configuration_versions_numbering_ck CHECK ((numbering_policy_code IN ('PROVIDER_ASSIGNED','AUTHORITY_ASSIGNED') AND number_range_start IS NULL AND number_range_end IS NULL AND next_number_value IS NULL AND numbering_exhausted_at IS NULL) OR (numbering_policy_code IN ('AUTHORIZED_RANGE','LOCAL_CONTINGENCY') AND number_range_start>0 AND number_range_end>=number_range_start AND next_number_value BETWEEN number_range_start AND number_range_end+1 AND (numbering_exhausted_at IS NULL)=(next_number_value<=number_range_end))),
  CONSTRAINT fiscal_emission_configuration_versions_checksum_ck CHECK (fiscal_capabilities_snapshot_checksum~'^[0-9a-f]{64}$' AND configuration_checksum~'^[0-9a-f]{64}$' AND configuration_schema_version>0 AND version_number>0 AND row_version>0),
  CONSTRAINT fiscal_emission_configuration_versions_publication_ck CHECK ((status='DRAFT' AND published_at IS NULL AND published_by_actor_id IS NULL AND numbering_exhausted_at IS NULL) OR (status<>'DRAFT' AND published_at IS NOT NULL AND published_by_actor_id IS NOT NULL)),
  CONSTRAINT fiscal_emission_configuration_versions_validity_ck CHECK (valid_until IS NULL OR valid_from<valid_until)
);
ALTER TABLE fiscal.fiscal_emission_configuration_versions ADD CONSTRAINT fiscal_emission_configuration_versions_supersedes_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,supersedes_version_id,document_type) REFERENCES fiscal.fiscal_emission_configuration_versions(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,id,document_type) ON DELETE NO ACTION;
ALTER TABLE fiscal.fiscal_emission_configuration_versions ADD CONSTRAINT fiscal_emission_configuration_versions_published_validity_excl EXCLUDE USING gist (tenant_id WITH =,company_id WITH =,fiscal_emission_configuration_id WITH =,tstzrange(valid_from,valid_until,'[)') WITH &&) WHERE (status='PUBLISHED');

CREATE TABLE fiscal.electronic_documents (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, branch_id uuid NOT NULL,
  external_integration_id uuid NOT NULL, fiscal_connection_id uuid NOT NULL,
  fiscal_emission_configuration_id uuid NOT NULL, emission_configuration_version_id uuid NOT NULL,
  source_type text NOT NULL, source_id uuid NOT NULL, source_version bigint NOT NULL,
  document_type text NOT NULL, logical_operation_key text NOT NULL, status text NOT NULL,
  numbering_mode text NOT NULL, numbering_state text NOT NULL, currency_code char(3) NOT NULL,
  subtotal_amount numeric(19,6) NOT NULL, discount_amount numeric(19,6) NOT NULL, tax_amount numeric(19,6) NOT NULL, total_amount numeric(19,6) NOT NULL,
  tax_snapshot_reference text NOT NULL, tax_snapshot_checksum text NOT NULL,
  fiscal_emission_snapshot_reference text NOT NULL, fiscal_emission_snapshot_checksum text NOT NULL,
  canonical_payload_version integer NOT NULL, canonical_payload_checksum text NOT NULL, internal_reference text NOT NULL,
  prefix text NULL, number text NULL, number_reserved_at timestamptz NULL, number_consumed_at timestamptz NULL,
  number_burned_at timestamptz NULL, numbering_resolution_reason text NULL,
  provider_document_id text NULL, provider_reference text NULL, authority_reference text NULL, legal_identifier text NULL,
  provider_status_raw text NULL, authority_status_raw text NULL, uncertainty_reason text NULL,
  original_electronic_document_id uuid NULL, correction_source_reference text NULL,
  issued_at timestamptz NULL, accepted_at timestamptz NULL, rejected_at timestamptz NULL, last_reconciled_at timestamptz NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 1,
  CONSTRAINT electronic_documents_id_v7_ck CHECK (platform.is_uuid_v7(id) AND platform.is_uuid_v7(source_id)),
  CONSTRAINT electronic_documents_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT electronic_documents_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT electronic_documents_tenant_company_integration_id_uq UNIQUE (tenant_id,company_id,external_integration_id,id),
  CONSTRAINT electronic_documents_tenant_company_connection_id_uq UNIQUE (tenant_id,company_id,fiscal_connection_id,id),
  CONSTRAINT electronic_documents_integration_connection_id_uq UNIQUE (tenant_id,company_id,external_integration_id,fiscal_connection_id,id),
  CONSTRAINT electronic_documents_logical_operation_uq UNIQUE (tenant_id,company_id,logical_operation_key),
  CONSTRAINT electronic_documents_connection_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id) REFERENCES fiscal.fiscal_connections(tenant_id,company_id,external_integration_id,id) ON DELETE NO ACTION,
  CONSTRAINT electronic_documents_branch_fk FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES organization.branches(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT electronic_documents_configuration_version_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,document_type) REFERENCES fiscal.fiscal_emission_configuration_versions(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,id,document_type) ON DELETE NO ACTION,
  CONSTRAINT electronic_documents_status_ck CHECK (status IN ('DRAFT','READY','QUEUED','SUBMITTING','ACCEPTED','REJECTED','UNKNOWN_OUTCOME','CONTINGENCY','VOIDED_BEFORE_SUBMISSION')),
  CONSTRAINT electronic_documents_document_type_ck CHECK (document_type IN ('ELECTRONIC_SALES_INVOICE','CREDIT_NOTE','DEBIT_NOTE','SUPPORT_DOCUMENT','SUPPORT_DOCUMENT_ADJUSTMENT')),
  CONSTRAINT electronic_documents_checksum_ck CHECK (tax_snapshot_checksum~'^[0-9a-f]{64}$' AND fiscal_emission_snapshot_checksum~'^[0-9a-f]{64}$' AND canonical_payload_checksum~'^[0-9a-f]{64}$' AND canonical_payload_version>0),
  CONSTRAINT electronic_documents_amounts_ck CHECK (subtotal_amount>=0 AND discount_amount>=0 AND tax_amount>=0 AND total_amount>=0 AND currency_code~'^[A-Z]{3}$'),
  CONSTRAINT electronic_documents_correction_ck CHECK ((document_type IN ('CREDIT_NOTE','DEBIT_NOTE','SUPPORT_DOCUMENT_ADJUSTMENT'))=(original_electronic_document_id IS NOT NULL AND correction_source_reference IS NOT NULL) AND original_electronic_document_id IS DISTINCT FROM id),
  CONSTRAINT electronic_documents_external_identity_ck CHECK ((prefix IS NULL)=(number IS NULL) AND (status<>'DRAFT' OR (provider_document_id IS NULL AND provider_reference IS NULL AND authority_reference IS NULL AND legal_identifier IS NULL AND provider_status_raw IS NULL AND authority_status_raw IS NULL AND uncertainty_reason IS NULL AND issued_at IS NULL AND accepted_at IS NULL AND rejected_at IS NULL AND last_reconciled_at IS NULL)) AND (provider_status_raw IS NULL OR fiscal.safe_external_text(provider_status_raw,256)) AND (authority_status_raw IS NULL OR fiscal.safe_external_text(authority_status_raw,256)) AND fiscal.safe_external_text(tax_snapshot_reference,2048) AND fiscal.safe_external_text(fiscal_emission_snapshot_reference,2048) AND fiscal.safe_external_text(internal_reference,512) AND (provider_document_id IS NULL OR fiscal.safe_external_text(provider_document_id,512)) AND (provider_reference IS NULL OR fiscal.safe_external_text(provider_reference,2048)) AND (authority_reference IS NULL OR fiscal.safe_external_text(authority_reference,2048)) AND (legal_identifier IS NULL OR fiscal.safe_external_text(legal_identifier,512)) AND (uncertainty_reason IS NULL OR fiscal.safe_external_text(uncertainty_reason,1024))),
  CONSTRAINT electronic_documents_timestamps_ck CHECK (created_at<=updated_at AND (accepted_at IS NULL OR issued_at IS NOT NULL) AND (rejected_at IS NULL OR accepted_at IS NULL)),
  CONSTRAINT electronic_documents_version_ck CHECK (source_version>0 AND version>0 AND numbering_mode IN ('PROVIDER_ASSIGNED','AUTHORITY_ASSIGNED','AUTHORIZED_RANGE','LOCAL_CONTINGENCY') AND numbering_state IN ('NOT_APPLICABLE','PENDING_EXTERNAL','RESERVED','CONSUMED','UNKNOWN_OUTCOME','RELEASED_WITHOUT_REUSE','BURNED'))
);
ALTER TABLE fiscal.electronic_documents ADD CONSTRAINT electronic_documents_original_fk FOREIGN KEY (tenant_id,company_id,original_electronic_document_id) REFERENCES fiscal.electronic_documents(tenant_id,company_id,id) ON DELETE NO ACTION;
CREATE UNIQUE INDEX electronic_documents_legal_number_uq ON fiscal.electronic_documents(tenant_id,company_id,fiscal_connection_id,document_type,prefix,number) WHERE prefix IS NOT NULL AND number IS NOT NULL;
CREATE UNIQUE INDEX electronic_documents_legal_identifier_uq ON fiscal.electronic_documents(tenant_id,company_id,legal_identifier) WHERE legal_identifier IS NOT NULL;
CREATE UNIQUE INDEX electronic_documents_provider_document_uq ON fiscal.electronic_documents(tenant_id,external_integration_id,provider_document_id) WHERE provider_document_id IS NOT NULL;

CREATE TABLE fiscal.fiscal_submission_attempts (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, external_integration_id uuid NOT NULL,
  fiscal_connection_id uuid NOT NULL, electronic_document_id uuid NOT NULL, integration_dispatch_id uuid NOT NULL,
  dispatch_class text NOT NULL DEFAULT 'FISCAL', operation_type text NOT NULL, attempt_number integer NOT NULL,
  status text NOT NULL, transport_status text NULL, normalized_result text NULL, request_id text NOT NULL,
  idempotency_key text NOT NULL, request_checksum text NOT NULL, provider_operation_id text NULL,
  provider_correlation_reference text NULL, provider_response_reference text NULL, http_status integer NULL,
  provider_code_raw text NULL, retry_classification text NULL, error_code text NULL, retry_after_at timestamptz NULL,
  started_at timestamptz NULL, completed_at timestamptz NULL, correlation_id uuid NOT NULL, causation_id uuid NULL,
  created_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 1,
  CONSTRAINT fiscal_submission_attempts_id_v7_ck CHECK (platform.is_uuid_v7(id) AND platform.is_uuid_v7(correlation_id) AND (causation_id IS NULL OR platform.is_uuid_v7(causation_id))),
  CONSTRAINT fiscal_submission_attempts_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT fiscal_submission_attempts_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT fiscal_submission_attempts_document_scope_uq UNIQUE (tenant_id,company_id,external_integration_id,electronic_document_id,id),
  CONSTRAINT fiscal_submission_attempts_connection_scope_uq UNIQUE (tenant_id,company_id,external_integration_id,fiscal_connection_id,id),
  CONSTRAINT fiscal_submission_attempts_dispatch_history_uq UNIQUE (tenant_id,integration_dispatch_id,attempt_number),
  CONSTRAINT fiscal_submission_attempts_document_history_uq UNIQUE (tenant_id,electronic_document_id,operation_type,attempt_number),
  CONSTRAINT fiscal_submission_attempts_idempotency_uq UNIQUE (tenant_id,electronic_document_id,operation_type,idempotency_key),
  CONSTRAINT fiscal_submission_attempts_document_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id) REFERENCES fiscal.electronic_documents(tenant_id,company_id,external_integration_id,fiscal_connection_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_submission_attempts_connection_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id) REFERENCES fiscal.fiscal_connections(tenant_id,company_id,external_integration_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_submission_attempts_dispatch_fk FOREIGN KEY (tenant_id,company_id,integration_dispatch_id,dispatch_class) REFERENCES integrations.integration_dispatches(tenant_id,company_id,id,dispatch_class) ON DELETE NO ACTION,
  CONSTRAINT fiscal_submission_attempts_class_ck CHECK (dispatch_class='FISCAL'),
  CONSTRAINT fiscal_submission_attempts_status_ck CHECK (status IN ('CREATED','IN_PROGRESS','COMPLETED','FAILED','UNKNOWN_OUTCOME','CANCELLED')),
  CONSTRAINT fiscal_submission_attempts_result_ck CHECK ((normalized_result IS NULL OR normalized_result IN ('ACCEPTED','REJECTED')) AND (status<>'CREATED' OR (transport_status IS NULL AND normalized_result IS NULL AND provider_operation_id IS NULL AND provider_correlation_reference IS NULL AND provider_response_reference IS NULL AND http_status IS NULL AND provider_code_raw IS NULL AND retry_classification IS NULL AND error_code IS NULL AND retry_after_at IS NULL AND started_at IS NULL AND completed_at IS NULL))),
  CONSTRAINT fiscal_submission_attempts_checksum_ck CHECK (request_checksum~'^[0-9a-f]{64}$'),
  CONSTRAINT fiscal_submission_attempts_values_ck CHECK (attempt_number>0 AND version>0 AND fiscal.safe_external_text(request_id,512) AND fiscal.safe_external_text(idempotency_key,512) AND (provider_operation_id IS NULL OR fiscal.safe_external_text(provider_operation_id,512)) AND (provider_correlation_reference IS NULL OR fiscal.safe_external_text(provider_correlation_reference,512)) AND (provider_response_reference IS NULL OR fiscal.safe_external_text(provider_response_reference,2048)) AND (provider_code_raw IS NULL OR fiscal.safe_external_text(provider_code_raw,256)) AND (error_code IS NULL OR fiscal.safe_external_text(error_code,256)) AND (http_status IS NULL OR http_status BETWEEN 100 AND 599)),
  CONSTRAINT fiscal_submission_attempts_timestamps_ck CHECK (completed_at IS NULL OR (started_at IS NOT NULL AND started_at<=completed_at))
);

CREATE TABLE fiscal.fiscal_artifacts (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, external_integration_id uuid NOT NULL,
  electronic_document_id uuid NOT NULL, fiscal_submission_attempt_id uuid NULL, artifact_type text NOT NULL,
  media_type text NOT NULL, storage_reference text NOT NULL, checksum_algorithm text NOT NULL, checksum text NOT NULL,
  size_bytes bigint NULL, provider_reference text NULL, authority_reference text NULL,
  retention_policy_reference text NOT NULL, immutable_evidence boolean NOT NULL, created_at timestamptz NOT NULL,
  CONSTRAINT fiscal_artifacts_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT fiscal_artifacts_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT fiscal_artifacts_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT fiscal_artifacts_identity_uq UNIQUE (tenant_id,electronic_document_id,artifact_type,checksum),
  CONSTRAINT fiscal_artifacts_document_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,electronic_document_id) REFERENCES fiscal.electronic_documents(tenant_id,company_id,external_integration_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_artifacts_attempt_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,electronic_document_id,fiscal_submission_attempt_id) REFERENCES fiscal.fiscal_submission_attempts(tenant_id,company_id,external_integration_id,electronic_document_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_artifacts_type_ck CHECK (artifact_type IN ('XML','PDF','ATTACHED_DOCUMENT','AUTHORITY_RESPONSE','PROVIDER_RESPONSE','QR_DATA','SIGNED_PAYLOAD')),
  CONSTRAINT fiscal_artifacts_checksum_ck CHECK (checksum_algorithm='SHA-256' AND checksum~'^[0-9a-f]{64}$'),
  CONSTRAINT fiscal_artifacts_values_ck CHECK (fiscal.safe_external_text(media_type,256) AND fiscal.safe_external_text(storage_reference,2048) AND fiscal.safe_external_text(retention_policy_reference,2048) AND (provider_reference IS NULL OR fiscal.safe_external_text(provider_reference,2048)) AND (authority_reference IS NULL OR fiscal.safe_external_text(authority_reference,2048)) AND (size_bytes IS NULL OR size_bytes>=0))
);

CREATE TABLE fiscal.fiscal_reconciliations (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, branch_id uuid NULL,
  external_integration_id uuid NOT NULL, fiscal_connection_id uuid NOT NULL,
  scope_snapshot_reference text NOT NULL, scope_snapshot_checksum text NOT NULL, status text NOT NULL,
  expected_state_snapshot_reference text NOT NULL, observed_state_snapshot_reference text NULL,
  provider_evidence_reference text NULL, authority_evidence_reference text NULL, discrepancy_summary_code text NULL,
  started_by_actor_id uuid NOT NULL, reviewed_by_actor_id uuid NULL, closed_by_actor_id uuid NULL,
  resolution_reason text NULL, started_at timestamptz NULL, closed_at timestamptz NULL,
  correlation_id uuid NOT NULL, causation_id uuid NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT fiscal_reconciliations_id_v7_ck CHECK (platform.is_uuid_v7(id) AND platform.is_uuid_v7(correlation_id) AND (causation_id IS NULL OR platform.is_uuid_v7(causation_id))),
  CONSTRAINT fiscal_reconciliations_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT fiscal_reconciliations_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT fiscal_reconciliations_scope_uq UNIQUE (tenant_id,company_id,external_integration_id,fiscal_connection_id,id),
  CONSTRAINT fiscal_reconciliations_connection_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id) REFERENCES fiscal.fiscal_connections(tenant_id,company_id,external_integration_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_reconciliations_branch_fk FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES organization.branches(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_reconciliations_started_by_fk FOREIGN KEY (started_by_actor_id) REFERENCES identity.users(id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_reconciliations_reviewed_by_fk FOREIGN KEY (reviewed_by_actor_id) REFERENCES identity.users(id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_reconciliations_closed_by_fk FOREIGN KEY (closed_by_actor_id) REFERENCES identity.users(id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_reconciliations_status_ck CHECK (status IN ('CREATED','RUNNING','REVIEW_REQUIRED','PARTIALLY_RECONCILED','RECONCILED','FAILED','CANCELLED','CLOSED','REOPENED')),
  CONSTRAINT fiscal_reconciliations_checksum_ck CHECK (scope_snapshot_checksum~'^[0-9a-f]{64}$' AND fiscal.safe_external_text(scope_snapshot_reference,2048) AND fiscal.safe_external_text(expected_state_snapshot_reference,2048) AND (observed_state_snapshot_reference IS NULL OR fiscal.safe_external_text(observed_state_snapshot_reference,2048)) AND (provider_evidence_reference IS NULL OR fiscal.safe_external_text(provider_evidence_reference,2048)) AND (authority_evidence_reference IS NULL OR fiscal.safe_external_text(authority_evidence_reference,2048)) AND (discrepancy_summary_code IS NULL OR fiscal.safe_external_text(discrepancy_summary_code,256)) AND (resolution_reason IS NULL OR fiscal.safe_external_text(resolution_reason,1024))),
  CONSTRAINT fiscal_reconciliations_lifecycle_ck CHECK ((status='CREATED' AND observed_state_snapshot_reference IS NULL AND reviewed_by_actor_id IS NULL AND closed_by_actor_id IS NULL AND resolution_reason IS NULL AND started_at IS NULL AND closed_at IS NULL) OR status<>'CREATED'),
  CONSTRAINT fiscal_reconciliations_version_ck CHECK (version>0 AND created_at<=updated_at AND (closed_at IS NULL OR started_at<=closed_at))
);

CREATE TABLE fiscal.fiscal_incidents (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, branch_id uuid NULL,
  external_integration_id uuid NOT NULL, fiscal_connection_id uuid NOT NULL, electronic_document_id uuid NULL,
  fiscal_submission_attempt_id uuid NULL, fiscal_reconciliation_id uuid NULL, incident_type text NOT NULL,
  severity text NOT NULL, status text NOT NULL, summary_code text NOT NULL, evidence_reference text NOT NULL,
  assigned_reviewer_id uuid NULL, resolution_type text NULL, resolution_reason text NULL, resolved_by_actor_id uuid NULL,
  resolved_at timestamptz NULL, archived_at timestamptz NULL, correlation_id uuid NOT NULL, causation_id uuid NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 1,
  CONSTRAINT fiscal_incidents_id_v7_ck CHECK (platform.is_uuid_v7(id) AND platform.is_uuid_v7(correlation_id) AND (causation_id IS NULL OR platform.is_uuid_v7(causation_id))),
  CONSTRAINT fiscal_incidents_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT fiscal_incidents_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT fiscal_incidents_scope_uq UNIQUE (tenant_id,company_id,external_integration_id,fiscal_connection_id,id),
  CONSTRAINT fiscal_incidents_connection_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id) REFERENCES fiscal.fiscal_connections(tenant_id,company_id,external_integration_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_incidents_branch_fk FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES organization.branches(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_incidents_document_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id) REFERENCES fiscal.electronic_documents(tenant_id,company_id,external_integration_id,fiscal_connection_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_incidents_attempt_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_submission_attempt_id) REFERENCES fiscal.fiscal_submission_attempts(tenant_id,company_id,external_integration_id,fiscal_connection_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_incidents_reconciliation_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id) REFERENCES fiscal.fiscal_reconciliations(tenant_id,company_id,external_integration_id,fiscal_connection_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_incidents_reviewer_fk FOREIGN KEY (assigned_reviewer_id) REFERENCES identity.users(id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_incidents_resolved_by_fk FOREIGN KEY (resolved_by_actor_id) REFERENCES identity.users(id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_incidents_status_ck CHECK (status IN ('OPEN','IN_REVIEW','RESOLVED','ARCHIVED')),
  CONSTRAINT fiscal_incidents_resolution_ck CHECK ((status IN ('OPEN','IN_REVIEW') AND resolution_type IS NULL AND resolution_reason IS NULL AND resolved_by_actor_id IS NULL AND resolved_at IS NULL AND archived_at IS NULL) OR (status='RESOLVED' AND resolution_type IS NOT NULL AND resolution_reason IS NOT NULL AND resolved_by_actor_id IS NOT NULL AND resolved_at IS NOT NULL AND archived_at IS NULL) OR (status='ARCHIVED' AND resolved_at IS NOT NULL AND archived_at IS NOT NULL)),
  CONSTRAINT fiscal_incidents_lifecycle_ck CHECK ((status<>'OPEN' OR assigned_reviewer_id IS NULL) AND fiscal.safe_external_text(incident_type,256) AND fiscal.safe_external_text(severity,256) AND fiscal.safe_external_text(summary_code,256) AND fiscal.safe_external_text(evidence_reference,2048) AND (resolution_type IS NULL OR fiscal.safe_external_text(resolution_type,256)) AND (resolution_reason IS NULL OR fiscal.safe_external_text(resolution_reason,1024))),
  CONSTRAINT fiscal_incidents_version_ck CHECK (version>0 AND created_at<=updated_at)
);

CREATE TABLE fiscal.fiscal_reconciliation_items (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, external_integration_id uuid NOT NULL,
  fiscal_connection_id uuid NOT NULL, fiscal_reconciliation_id uuid NOT NULL, electronic_document_id uuid NOT NULL,
  expected_state_reference text NOT NULL, observed_state_reference text NOT NULL, evidence_checksum text NOT NULL,
  discrepancy_code text NULL, result_code text NOT NULL, evidence_reference text NOT NULL,
  fiscal_incident_id uuid NULL, created_at timestamptz NOT NULL,
  CONSTRAINT fiscal_reconciliation_items_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT fiscal_reconciliation_items_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT fiscal_reconciliation_items_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT fiscal_reconciliation_items_identity_uq UNIQUE (tenant_id,fiscal_reconciliation_id,electronic_document_id),
  CONSTRAINT fiscal_reconciliation_items_reconciliation_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id) REFERENCES fiscal.fiscal_reconciliations(tenant_id,company_id,external_integration_id,fiscal_connection_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_reconciliation_items_document_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id) REFERENCES fiscal.electronic_documents(tenant_id,company_id,external_integration_id,fiscal_connection_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_reconciliation_items_incident_fk FOREIGN KEY (tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_incident_id) REFERENCES fiscal.fiscal_incidents(tenant_id,company_id,external_integration_id,fiscal_connection_id,id) ON DELETE NO ACTION,
  CONSTRAINT fiscal_reconciliation_items_checksum_ck CHECK (evidence_checksum~'^[0-9a-f]{64}$'),
  CONSTRAINT fiscal_reconciliation_items_result_ck CHECK (result_code~'^[A-Z][A-Z0-9_]{1,127}$' AND fiscal.safe_external_text(expected_state_reference,2048) AND fiscal.safe_external_text(observed_state_reference,2048) AND fiscal.safe_external_text(evidence_reference,2048) AND (discrepancy_code IS NULL OR fiscal.safe_external_text(discrepancy_code,256)))
);

CREATE INDEX fiscal_connections_scope_effective_idx ON fiscal.fiscal_connections(tenant_id,company_id,external_integration_id,valid_from DESC);
CREATE INDEX fiscal_connections_capability_fk_idx ON fiscal.fiscal_connections(tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code);
CREATE INDEX fiscal_emission_configurations_branch_fk_idx ON fiscal.fiscal_emission_configurations(tenant_id,company_id,branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX fiscal_emission_configuration_versions_lookup_idx ON fiscal.fiscal_emission_configuration_versions(tenant_id,company_id,fiscal_emission_configuration_id,status,valid_from DESC);
CREATE INDEX fiscal_emission_configuration_versions_supersedes_idx ON fiscal.fiscal_emission_configuration_versions(tenant_id,company_id,fiscal_emission_configuration_id,supersedes_version_id) WHERE supersedes_version_id IS NOT NULL;
CREATE INDEX electronic_documents_source_idx ON fiscal.electronic_documents(tenant_id,company_id,source_type,source_id,created_at DESC);
CREATE INDEX electronic_documents_work_idx ON fiscal.electronic_documents(tenant_id,status,created_at,id) WHERE status IN ('READY','QUEUED','SUBMITTING');
CREATE INDEX electronic_documents_uncertain_idx ON fiscal.electronic_documents(tenant_id,last_reconciled_at,id) WHERE status='UNKNOWN_OUTCOME';
CREATE INDEX electronic_documents_original_idx ON fiscal.electronic_documents(tenant_id,company_id,original_electronic_document_id) WHERE original_electronic_document_id IS NOT NULL;
CREATE INDEX fiscal_submission_attempts_dispatch_fk_idx ON fiscal.fiscal_submission_attempts(tenant_id,company_id,integration_dispatch_id,dispatch_class);
CREATE INDEX fiscal_submission_attempts_document_idx ON fiscal.fiscal_submission_attempts(tenant_id,company_id,external_integration_id,electronic_document_id,created_at DESC);
CREATE INDEX fiscal_submission_attempts_unknown_idx ON fiscal.fiscal_submission_attempts(tenant_id,created_at,id) WHERE status='UNKNOWN_OUTCOME';
CREATE INDEX fiscal_submission_attempts_provider_operation_idx ON fiscal.fiscal_submission_attempts(tenant_id,external_integration_id,provider_operation_id) WHERE provider_operation_id IS NOT NULL;
CREATE INDEX fiscal_artifacts_document_idx ON fiscal.fiscal_artifacts(tenant_id,company_id,electronic_document_id,artifact_type,created_at);
CREATE INDEX fiscal_artifacts_attempt_fk_idx ON fiscal.fiscal_artifacts(tenant_id,company_id,external_integration_id,electronic_document_id,fiscal_submission_attempt_id) WHERE fiscal_submission_attempt_id IS NOT NULL;
CREATE INDEX fiscal_reconciliations_work_idx ON fiscal.fiscal_reconciliations(tenant_id,status,created_at,id) WHERE status IN ('CREATED','RUNNING','REVIEW_REQUIRED','PARTIALLY_RECONCILED','REOPENED');
CREATE INDEX fiscal_reconciliations_connection_idx ON fiscal.fiscal_reconciliations(tenant_id,company_id,external_integration_id,fiscal_connection_id,created_at DESC);
CREATE INDEX fiscal_incidents_open_idx ON fiscal.fiscal_incidents(tenant_id,company_id,severity,created_at,id) WHERE status IN ('OPEN','IN_REVIEW');
CREATE INDEX fiscal_incidents_document_idx ON fiscal.fiscal_incidents(tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id) WHERE electronic_document_id IS NOT NULL;
CREATE INDEX fiscal_incidents_attempt_idx ON fiscal.fiscal_incidents(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_submission_attempt_id) WHERE fiscal_submission_attempt_id IS NOT NULL;
CREATE INDEX fiscal_incidents_reconciliation_idx ON fiscal.fiscal_incidents(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id) WHERE fiscal_reconciliation_id IS NOT NULL;
CREATE INDEX fiscal_reconciliation_items_document_idx ON fiscal.fiscal_reconciliation_items(tenant_id,company_id,electronic_document_id,created_at);
CREATE INDEX fiscal_reconciliation_items_incident_idx ON fiscal.fiscal_reconciliation_items(tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_incident_id) WHERE fiscal_incident_id IS NOT NULL;

CREATE FUNCTION fiscal.guard_connection_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fiscal,integrations AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM integrations.external_integrations i JOIN integrations.integration_capabilities c ON c.tenant_id=i.tenant_id AND c.company_id=i.company_id AND c.integration_id=i.id WHERE i.tenant_id=NEW.tenant_id AND i.company_id=NEW.company_id AND i.id=NEW.external_integration_id AND i.status IN ('ACTIVE','DEGRADED') AND c.id=NEW.electronic_invoicing_capability_id AND c.capability_code='ELECTRONIC_INVOICING' AND c.support_status='SUPPORTED' AND c.effective_from<=transaction_timestamp() AND (c.effective_until IS NULL OR transaction_timestamp()<c.effective_until)) THEN RAISE EXCEPTION 'effective fiscal capability required'; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION fiscal.guard_configuration_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fiscal,integrations AS $$
DECLARE configured_branch uuid;
BEGIN
  SELECT branch_id INTO configured_branch FROM fiscal.fiscal_emission_configurations WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.fiscal_emission_configuration_id;
  IF configured_branch IS DISTINCT FROM NEW.branch_id THEN RAISE EXCEPTION 'configuration branch mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION fiscal.guard_document_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fiscal,integrations AS $$
DECLARE version_branch uuid; version_status text; version_type text;
BEGIN
  SELECT branch_id,status,document_type INTO version_branch,version_status,version_type FROM fiscal.fiscal_emission_configuration_versions WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.emission_configuration_version_id;
  IF version_status<>'PUBLISHED' OR version_type<>NEW.document_type OR (version_branch IS NOT NULL AND version_branch<>NEW.branch_id) THEN RAISE EXCEPTION 'effective emission configuration required'; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION fiscal.guard_attempt_number()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fiscal,integrations AS $$
DECLARE expected integer;
BEGIN
  PERFORM 1 FROM fiscal.electronic_documents WHERE tenant_id=NEW.tenant_id AND id=NEW.electronic_document_id FOR UPDATE;
  SELECT coalesce(max(attempt_number),0)+1 INTO expected FROM fiscal.fiscal_submission_attempts WHERE tenant_id=NEW.tenant_id AND electronic_document_id=NEW.electronic_document_id AND operation_type=NEW.operation_type;
  IF NEW.attempt_number<>expected THEN RAISE EXCEPTION 'attempt number is not monotonic'; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION fiscal.guard_fiscal_dispatch()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fiscal,integrations AS $$
DECLARE expected_capability text;
BEGIN
  IF NEW.dispatch_class<>'FISCAL' THEN RETURN NEW; END IF;
  SELECT CASE document_type WHEN 'ELECTRONIC_SALES_INVOICE' THEN 'ELECTRONIC_INVOICING' WHEN 'CREDIT_NOTE' THEN 'CREDIT_NOTES' WHEN 'DEBIT_NOTE' THEN 'DEBIT_NOTES' ELSE 'SUPPORT_DOCUMENTS' END INTO expected_capability
  FROM fiscal.electronic_documents d WHERE d.tenant_id=NEW.tenant_id AND d.company_id=NEW.company_id AND d.external_integration_id=NEW.integration_id AND d.id=NEW.internal_entity_id;
  IF NOT FOUND OR NEW.internal_entity_type<>'ElectronicDocument' OR NEW.capability_code<>expected_capability THEN RAISE EXCEPTION 'fiscal dispatch owner/capability mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION fiscal.guard_capability_downgrade()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fiscal,integrations AS $$
BEGIN
  IF OLD.support_status='SUPPORTED' AND NEW.support_status<>'SUPPORTED' AND NEW.capability_code IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS') AND EXISTS (SELECT 1 FROM integrations.integration_capabilities c JOIN integrations.external_integrations i ON i.tenant_id=c.tenant_id AND i.company_id=c.company_id AND i.id=c.integration_id WHERE i.provider_adapter_version_id=NEW.provider_adapter_version_id AND c.capability_code=NEW.capability_code AND c.support_status='SUPPORTED' AND c.effective_from<=transaction_timestamp() AND (c.effective_until IS NULL OR transaction_timestamp()<c.effective_until)) THEN RAISE EXCEPTION 'effective fiscal capability must be downgraded first'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fiscal_connections_scope_guard BEFORE INSERT OR UPDATE ON fiscal.fiscal_connections FOR EACH ROW EXECUTE FUNCTION fiscal.guard_connection_scope();
CREATE TRIGGER fiscal_connections_capability_guard BEFORE INSERT OR UPDATE OF electronic_invoicing_capability_id,capability_code ON fiscal.fiscal_connections FOR EACH ROW EXECUTE FUNCTION fiscal.guard_connection_scope();
CREATE TRIGGER fiscal_emission_configurations_scope_guard BEFORE UPDATE ON fiscal.fiscal_emission_configurations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_append_only();
CREATE TRIGGER fiscal_emission_configuration_versions_update_guard BEFORE UPDATE ON fiscal.fiscal_emission_configuration_versions FOR EACH ROW EXECUTE FUNCTION fiscal.guard_allowed_update_columns('issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,certificate_reference,contingency_policy_reference,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,valid_until,status,published_at,published_by_actor_id,updated_at,row_version');
CREATE TRIGGER fiscal_emission_configuration_versions_state_guard BEFORE INSERT OR UPDATE ON fiscal.fiscal_emission_configuration_versions FOR EACH ROW EXECUTE FUNCTION fiscal.guard_configuration_version_state();
CREATE TRIGGER fiscal_emission_configuration_versions_numbering_guard BEFORE INSERT OR UPDATE ON fiscal.fiscal_emission_configuration_versions FOR EACH ROW EXECUTE FUNCTION fiscal.guard_configuration_scope();
CREATE TRIGGER electronic_documents_insert_guard BEFORE INSERT ON fiscal.electronic_documents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_initial_status('DRAFT');
CREATE TRIGGER electronic_documents_update_guard BEFORE UPDATE ON fiscal.electronic_documents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_allowed_update_columns('source_version,status,numbering_state,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,internal_reference,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,authority_reference,legal_identifier,provider_status_raw,authority_status_raw,uncertainty_reason,correction_source_reference,issued_at,accepted_at,rejected_at,last_reconciled_at,updated_at,version');
CREATE TRIGGER electronic_documents_state_guard BEFORE UPDATE OF status ON fiscal.electronic_documents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_state_transition('status','DRAFT>READY,DRAFT>VOIDED_BEFORE_SUBMISSION,READY>QUEUED,READY>VOIDED_BEFORE_SUBMISSION,QUEUED>SUBMITTING,QUEUED>VOIDED_BEFORE_SUBMISSION,SUBMITTING>ACCEPTED,SUBMITTING>REJECTED,SUBMITTING>UNKNOWN_OUTCOME,SUBMITTING>CONTINGENCY,UNKNOWN_OUTCOME>ACCEPTED,UNKNOWN_OUTCOME>REJECTED,CONTINGENCY>ACCEPTED,CONTINGENCY>REJECTED');
CREATE TRIGGER electronic_documents_evidence_guard BEFORE INSERT OR UPDATE ON fiscal.electronic_documents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_document_scope();
CREATE TRIGGER electronic_documents_numbering_guard BEFORE INSERT OR UPDATE OF numbering_state,prefix,number,number_reserved_at,number_consumed_at,number_burned_at ON fiscal.electronic_documents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_document_scope();
CREATE TRIGGER fiscal_submission_attempts_insert_guard BEFORE INSERT ON fiscal.fiscal_submission_attempts FOR EACH ROW EXECUTE FUNCTION fiscal.guard_initial_status('CREATED');
CREATE TRIGGER fiscal_submission_attempts_update_guard BEFORE UPDATE ON fiscal.fiscal_submission_attempts FOR EACH ROW EXECUTE FUNCTION fiscal.guard_allowed_update_columns('status,transport_status,normalized_result,provider_operation_id,provider_correlation_reference,provider_response_reference,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,version');
CREATE TRIGGER fiscal_submission_attempts_state_guard BEFORE UPDATE OF status ON fiscal.fiscal_submission_attempts FOR EACH ROW EXECUTE FUNCTION fiscal.guard_state_transition('status','CREATED>IN_PROGRESS,CREATED>CANCELLED,IN_PROGRESS>COMPLETED,IN_PROGRESS>FAILED,IN_PROGRESS>UNKNOWN_OUTCOME,IN_PROGRESS>CANCELLED');
CREATE TRIGGER fiscal_submission_attempts_number_guard BEFORE INSERT ON fiscal.fiscal_submission_attempts FOR EACH ROW EXECUTE FUNCTION fiscal.guard_attempt_number();
CREATE TRIGGER fiscal_artifacts_immutable_guard BEFORE UPDATE OR DELETE ON fiscal.fiscal_artifacts FOR EACH ROW EXECUTE FUNCTION fiscal.guard_append_only();
CREATE TRIGGER fiscal_reconciliations_insert_guard BEFORE INSERT ON fiscal.fiscal_reconciliations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_initial_status('CREATED');
CREATE TRIGGER fiscal_reconciliations_update_guard BEFORE UPDATE ON fiscal.fiscal_reconciliations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_allowed_update_columns('status,observed_state_snapshot_reference,provider_evidence_reference,authority_evidence_reference,discrepancy_summary_code,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,started_at,closed_at,updated_at,version');
CREATE TRIGGER fiscal_reconciliations_state_guard BEFORE UPDATE OF status ON fiscal.fiscal_reconciliations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_state_transition('status','CREATED>RUNNING,CREATED>CANCELLED,RUNNING>REVIEW_REQUIRED,RUNNING>PARTIALLY_RECONCILED,RUNNING>RECONCILED,RUNNING>FAILED,RUNNING>CANCELLED,REVIEW_REQUIRED>PARTIALLY_RECONCILED,REVIEW_REQUIRED>RECONCILED,REVIEW_REQUIRED>CLOSED,PARTIALLY_RECONCILED>RECONCILED,PARTIALLY_RECONCILED>CLOSED,RECONCILED>CLOSED,CLOSED>REOPENED,REOPENED>RUNNING');
CREATE TRIGGER fiscal_incidents_insert_guard BEFORE INSERT ON fiscal.fiscal_incidents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_initial_status('OPEN');
CREATE TRIGGER fiscal_incidents_update_guard BEFORE UPDATE ON fiscal.fiscal_incidents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_allowed_update_columns('status,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,updated_at,version');
CREATE TRIGGER fiscal_incidents_state_guard BEFORE UPDATE OF status ON fiscal.fiscal_incidents FOR EACH ROW EXECUTE FUNCTION fiscal.guard_state_transition('status','OPEN>IN_REVIEW,OPEN>RESOLVED,IN_REVIEW>RESOLVED,RESOLVED>ARCHIVED');
CREATE TRIGGER fiscal_reconciliation_items_immutable_guard BEFORE UPDATE OR DELETE ON fiscal.fiscal_reconciliation_items FOR EACH ROW EXECUTE FUNCTION fiscal.guard_append_only();
CREATE TRIGGER integration_dispatches_fiscal_document_guard BEFORE INSERT OR UPDATE ON integrations.integration_dispatches FOR EACH ROW EXECUTE FUNCTION fiscal.guard_fiscal_dispatch();
CREATE TRIGGER provider_capability_declarations_fiscal_downgrade_guard BEFORE UPDATE OF support_status ON integrations.provider_capability_declarations FOR EACH ROW EXECUTE FUNCTION fiscal.guard_capability_downgrade();

ALTER TABLE fiscal.fiscal_connections ENABLE ROW LEVEL SECURITY; ALTER TABLE fiscal.fiscal_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal.fiscal_emission_configurations ENABLE ROW LEVEL SECURITY; ALTER TABLE fiscal.fiscal_emission_configurations FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal.fiscal_emission_configuration_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE fiscal.fiscal_emission_configuration_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal.electronic_documents ENABLE ROW LEVEL SECURITY; ALTER TABLE fiscal.electronic_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal.fiscal_submission_attempts ENABLE ROW LEVEL SECURITY; ALTER TABLE fiscal.fiscal_submission_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal.fiscal_artifacts ENABLE ROW LEVEL SECURITY; ALTER TABLE fiscal.fiscal_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal.fiscal_reconciliations ENABLE ROW LEVEL SECURITY; ALTER TABLE fiscal.fiscal_reconciliations FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal.fiscal_incidents ENABLE ROW LEVEL SECURITY; ALTER TABLE fiscal.fiscal_incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal.fiscal_reconciliation_items ENABLE ROW LEVEL SECURITY; ALTER TABLE fiscal.fiscal_reconciliation_items FORCE ROW LEVEL SECURITY;

CREATE POLICY fiscal_connections_tenant_isolation ON fiscal.fiscal_connections TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY fiscal_emission_configurations_tenant_isolation ON fiscal.fiscal_emission_configurations TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY fiscal_emission_configuration_versions_app_tenant_isolation ON fiscal.fiscal_emission_configuration_versions TO pos_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY fiscal_emission_configuration_versions_platform_tenant_isolation ON fiscal.fiscal_emission_configuration_versions FOR SELECT TO pos_platform_app USING (tenant_id=platform.current_tenant_id());
CREATE POLICY fiscal_emission_configuration_versions_worker_published_history ON fiscal.fiscal_emission_configuration_versions FOR SELECT TO pos_worker USING (tenant_id=platform.current_tenant_id() AND (status='PUBLISHED' OR (status IN ('SUPERSEDED','REVOKED') AND EXISTS (SELECT 1 FROM fiscal.electronic_documents d WHERE d.tenant_id=fiscal_emission_configuration_versions.tenant_id AND d.emission_configuration_version_id=fiscal_emission_configuration_versions.id))));
CREATE POLICY fiscal_emission_configuration_versions_worker_numbering_update ON fiscal.fiscal_emission_configuration_versions FOR UPDATE TO pos_worker USING (tenant_id=platform.current_tenant_id() AND status='PUBLISHED') WITH CHECK (tenant_id=platform.current_tenant_id() AND status='PUBLISHED');
CREATE POLICY electronic_documents_tenant_isolation ON fiscal.electronic_documents TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY fiscal_submission_attempts_tenant_isolation ON fiscal.fiscal_submission_attempts TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY fiscal_artifacts_tenant_isolation ON fiscal.fiscal_artifacts TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY fiscal_reconciliations_tenant_isolation ON fiscal.fiscal_reconciliations TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY fiscal_incidents_tenant_isolation ON fiscal.fiscal_incidents TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY fiscal_reconciliation_items_tenant_isolation ON fiscal.fiscal_reconciliation_items TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());

GRANT USAGE ON SCHEMA fiscal TO pos_app,pos_worker,pos_platform_app,pos_platform_admin;
GRANT SELECT (id,tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code,valid_from,valid_until,created_at,updated_at,version),INSERT (id,tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code,valid_from,valid_until,created_at,updated_at,version) ON fiscal.fiscal_connections TO pos_app;
GRANT UPDATE (valid_until,updated_at,version) ON fiscal.fiscal_connections TO pos_app;
GRANT SELECT (id,tenant_id,company_id,external_integration_id,electronic_invoicing_capability_id,capability_code,valid_from,valid_until,created_at,updated_at,version) ON fiscal.fiscal_connections TO pos_worker;
GRANT SELECT (id,tenant_id,company_id,external_integration_id,capability_code,valid_from,valid_until,created_at,updated_at,version) ON fiscal.fiscal_connections TO pos_platform_app,pos_platform_admin;
GRANT SELECT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,document_type,created_at),INSERT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,document_type,created_at) ON fiscal.fiscal_emission_configurations TO pos_app;
GRANT SELECT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,document_type,created_at) ON fiscal.fiscal_emission_configurations TO pos_worker,pos_platform_app,pos_platform_admin;
GRANT SELECT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,fiscal_emission_configuration_id,document_type,version_number,status,issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,contingency_policy_reference,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,valid_until,published_at,supersedes_version_id,created_by_actor_id,published_by_actor_id,created_at,updated_at,row_version) ON fiscal.fiscal_emission_configuration_versions TO pos_app;
GRANT INSERT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,fiscal_emission_configuration_id,document_type,version_number,status,issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,provider_numbering_reference,certificate_reference,contingency_policy_reference,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,valid_until,supersedes_version_id,created_by_actor_id,created_at,updated_at,row_version) ON fiscal.fiscal_emission_configuration_versions TO pos_app;
GRANT UPDATE (issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,certificate_reference,contingency_policy_reference,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,valid_until,status,published_at,published_by_actor_id,updated_at,row_version) ON fiscal.fiscal_emission_configuration_versions TO pos_app;
GRANT SELECT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,fiscal_emission_configuration_id,document_type,version_number,status,issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,certificate_reference,contingency_policy_reference,fiscal_capabilities_snapshot_reference,fiscal_capabilities_snapshot_checksum,configuration_schema_version,configuration_checksum,valid_from,valid_until,published_at,supersedes_version_id,created_by_actor_id,published_by_actor_id,created_at,updated_at,row_version) ON fiscal.fiscal_emission_configuration_versions TO pos_worker;
GRANT UPDATE (next_number_value,numbering_exhausted_at,updated_at,row_version) ON fiscal.fiscal_emission_configuration_versions TO pos_worker;
GRANT SELECT (id,tenant_id,company_id,branch_id,scope_type,fiscal_connection_id,external_integration_id,fiscal_emission_configuration_id,document_type,version_number,status,issuer_tax_id_normalized_snapshot,issuer_legal_name_snapshot,authorization_reference,numbering_policy_code,prefix,number_range_start,number_range_end,next_number_value,numbering_exhausted_at,provider_numbering_reference,contingency_policy_reference,configuration_schema_version,valid_from,valid_until,published_at,supersedes_version_id,created_by_actor_id,published_by_actor_id,created_at,updated_at,row_version) ON fiscal.fiscal_emission_configuration_versions TO pos_platform_app,pos_platform_admin;
GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_type,source_id,source_version,document_type,logical_operation_key,status,numbering_mode,numbering_state,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,internal_reference,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,authority_reference,legal_identifier,provider_status_raw,authority_status_raw,uncertainty_reason,original_electronic_document_id,correction_source_reference,issued_at,accepted_at,rejected_at,last_reconciled_at,created_at,updated_at,version) ON fiscal.electronic_documents TO pos_app;
GRANT INSERT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_type,source_id,source_version,document_type,logical_operation_key,status,numbering_mode,numbering_state,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,internal_reference,prefix,number,number_reserved_at,original_electronic_document_id,correction_source_reference,created_at,updated_at,version) ON fiscal.electronic_documents TO pos_app;
GRANT UPDATE (source_version,status,numbering_state,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,internal_reference,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,correction_source_reference,updated_at,version) ON fiscal.electronic_documents TO pos_app;
GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_type,source_id,source_version,document_type,logical_operation_key,status,numbering_mode,numbering_state,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,tax_snapshot_reference,tax_snapshot_checksum,fiscal_emission_snapshot_reference,fiscal_emission_snapshot_checksum,canonical_payload_version,canonical_payload_checksum,internal_reference,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,authority_reference,legal_identifier,provider_status_raw,authority_status_raw,uncertainty_reason,original_electronic_document_id,correction_source_reference,issued_at,accepted_at,rejected_at,last_reconciled_at,created_at,updated_at,version) ON fiscal.electronic_documents TO pos_worker;
GRANT UPDATE (status,numbering_state,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,authority_reference,legal_identifier,provider_status_raw,authority_status_raw,uncertainty_reason,issued_at,accepted_at,rejected_at,last_reconciled_at,updated_at,version) ON fiscal.electronic_documents TO pos_worker;
GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,fiscal_emission_configuration_id,emission_configuration_version_id,source_type,source_id,source_version,document_type,logical_operation_key,status,numbering_mode,numbering_state,currency_code,subtotal_amount,discount_amount,tax_amount,total_amount,canonical_payload_version,internal_reference,prefix,number,number_reserved_at,number_consumed_at,number_burned_at,numbering_resolution_reason,provider_document_id,provider_reference,authority_reference,legal_identifier,provider_status_raw,authority_status_raw,uncertainty_reason,original_electronic_document_id,correction_source_reference,issued_at,accepted_at,rejected_at,last_reconciled_at,created_at,updated_at,version) ON fiscal.electronic_documents TO pos_platform_app,pos_platform_admin;
GRANT SELECT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,integration_dispatch_id,dispatch_class,operation_type,attempt_number,status,transport_status,normalized_result,request_id,idempotency_key,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,correlation_id,causation_id,created_at,version) ON fiscal.fiscal_submission_attempts TO pos_app;
GRANT SELECT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,integration_dispatch_id,dispatch_class,operation_type,attempt_number,status,transport_status,normalized_result,request_id,idempotency_key,request_checksum,provider_operation_id,provider_correlation_reference,provider_response_reference,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,correlation_id,causation_id,created_at,version) ON fiscal.fiscal_submission_attempts TO pos_worker;
GRANT INSERT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,integration_dispatch_id,dispatch_class,operation_type,attempt_number,status,request_id,idempotency_key,request_checksum,correlation_id,causation_id,created_at,version) ON fiscal.fiscal_submission_attempts TO pos_worker;
GRANT UPDATE (status,transport_status,normalized_result,provider_operation_id,provider_correlation_reference,provider_response_reference,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,version) ON fiscal.fiscal_submission_attempts TO pos_worker;
GRANT SELECT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,electronic_document_id,integration_dispatch_id,dispatch_class,operation_type,attempt_number,status,transport_status,normalized_result,http_status,provider_code_raw,retry_classification,error_code,retry_after_at,started_at,completed_at,correlation_id,causation_id,created_at,version) ON fiscal.fiscal_submission_attempts TO pos_platform_app,pos_platform_admin;
GRANT SELECT (id,tenant_id,company_id,external_integration_id,electronic_document_id,fiscal_submission_attempt_id,artifact_type,media_type,checksum_algorithm,checksum,size_bytes,retention_policy_reference,immutable_evidence,created_at) ON fiscal.fiscal_artifacts TO pos_app;
GRANT SELECT (id,tenant_id,company_id,external_integration_id,electronic_document_id,fiscal_submission_attempt_id,artifact_type,media_type,storage_reference,checksum_algorithm,checksum,size_bytes,provider_reference,authority_reference,retention_policy_reference,immutable_evidence,created_at),INSERT (id,tenant_id,company_id,external_integration_id,electronic_document_id,fiscal_submission_attempt_id,artifact_type,media_type,storage_reference,checksum_algorithm,checksum,size_bytes,provider_reference,authority_reference,retention_policy_reference,immutable_evidence,created_at) ON fiscal.fiscal_artifacts TO pos_worker;
GRANT SELECT (id,tenant_id,company_id,external_integration_id,electronic_document_id,fiscal_submission_attempt_id,artifact_type,media_type,checksum_algorithm,checksum,size_bytes,retention_policy_reference,immutable_evidence,created_at) ON fiscal.fiscal_artifacts TO pos_platform_app,pos_platform_admin;
GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,status,discrepancy_summary_code,started_by_actor_id,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,started_at,closed_at,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_app;
GRANT INSERT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,scope_snapshot_reference,scope_snapshot_checksum,status,expected_state_snapshot_reference,started_by_actor_id,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_app;
GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,scope_snapshot_reference,scope_snapshot_checksum,status,expected_state_snapshot_reference,observed_state_snapshot_reference,provider_evidence_reference,authority_evidence_reference,discrepancy_summary_code,started_by_actor_id,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,started_at,closed_at,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_worker;
GRANT INSERT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,scope_snapshot_reference,scope_snapshot_checksum,status,expected_state_snapshot_reference,started_by_actor_id,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_worker;
GRANT UPDATE (status,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,closed_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_app;
GRANT UPDATE (status,observed_state_snapshot_reference,provider_evidence_reference,authority_evidence_reference,discrepancy_summary_code,started_at,closed_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_worker;
GRANT UPDATE (status,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,updated_at,version) ON fiscal.fiscal_incidents TO pos_app;
GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,status,discrepancy_summary_code,started_by_actor_id,reviewed_by_actor_id,closed_by_actor_id,resolution_reason,started_at,closed_at,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_reconciliations TO pos_platform_app,pos_platform_admin;
GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_incidents TO pos_app,pos_platform_app,pos_platform_admin;
GRANT INSERT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,evidence_reference,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_incidents TO pos_app;
GRANT SELECT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,evidence_reference,assigned_reviewer_id,resolution_type,resolution_reason,resolved_by_actor_id,resolved_at,archived_at,correlation_id,causation_id,created_at,updated_at,version),INSERT (id,tenant_id,company_id,branch_id,external_integration_id,fiscal_connection_id,electronic_document_id,fiscal_submission_attempt_id,fiscal_reconciliation_id,incident_type,severity,status,summary_code,evidence_reference,correlation_id,causation_id,created_at,updated_at,version) ON fiscal.fiscal_incidents TO pos_worker;
GRANT SELECT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id,electronic_document_id,expected_state_reference,observed_state_reference,evidence_checksum,discrepancy_code,result_code,fiscal_incident_id,created_at) ON fiscal.fiscal_reconciliation_items TO pos_app;
GRANT SELECT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id,electronic_document_id,expected_state_reference,observed_state_reference,evidence_checksum,discrepancy_code,result_code,evidence_reference,fiscal_incident_id,created_at),INSERT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id,electronic_document_id,expected_state_reference,observed_state_reference,evidence_checksum,discrepancy_code,result_code,evidence_reference,fiscal_incident_id,created_at) ON fiscal.fiscal_reconciliation_items TO pos_worker;
GRANT SELECT (id,tenant_id,company_id,external_integration_id,fiscal_connection_id,fiscal_reconciliation_id,electronic_document_id,evidence_checksum,discrepancy_code,result_code,fiscal_incident_id,created_at) ON fiscal.fiscal_reconciliation_items TO pos_platform_app,pos_platform_admin;

ALTER TABLE integrations.integration_dispatches ADD CONSTRAINT integration_dispatches_dispatch_class_003_ck CHECK ((dispatch_class='FISCAL' AND capability_code IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS') AND internal_entity_type='ElectronicDocument') OR (dispatch_class='NON_FISCAL' AND capability_code NOT IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS') AND internal_entity_type<>'ElectronicDocument')) NOT VALID;
ALTER TABLE integrations.integration_dispatches VALIDATE CONSTRAINT integration_dispatches_dispatch_class_003_ck;
ALTER TABLE integrations.integration_dispatches DROP CONSTRAINT integration_dispatches_dispatch_class_002_ck;

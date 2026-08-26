CREATE SCHEMA integrations AUTHORIZATION pos_schema_owner;
REVOKE ALL ON SCHEMA integrations FROM PUBLIC;

CREATE FUNCTION integrations.guard_allowed_update_columns()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed text[] := string_to_array(TG_ARGV[0], ',');
BEGIN
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'immutable columns changed on %', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION integrations.guard_initial_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> ALL(string_to_array(TG_ARGV[0], ',')) THEN
    RAISE EXCEPTION 'invalid initial status % on %', NEW.status, TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION integrations.guard_rate_policy_publication()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND session_user = 'pos_app' AND NEW.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'ordinary tenant policy must start DRAFT';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'DRAFT' AND NEW.status <> 'DRAFT'
     AND session_user <> 'pos_platform_app' THEN
    RAISE EXCEPTION 'rate policy publication requires platform application';
  END IF;
  IF OLD.status IN ('PUBLISHED','RETIRED') AND
     ROW(NEW.provider_id,NEW.scope_type,NEW.tenant_id,NEW.company_id,NEW.integration_id,
         NEW.endpoint_class,NEW.request_limit,NEW.window_seconds,NEW.concurrency_limit,
         NEW.retry_after_mode,NEW.backoff_policy_code,NEW.cooldown_seconds,NEW.valid_from,NEW.version)
     IS DISTINCT FROM
     ROW(OLD.provider_id,OLD.scope_type,OLD.tenant_id,OLD.company_id,OLD.integration_id,
         OLD.endpoint_class,OLD.request_limit,OLD.window_seconds,OLD.concurrency_limit,
         OLD.retry_after_mode,OLD.backoff_policy_code,OLD.cooldown_seconds,OLD.valid_from,OLD.version) THEN
    RAISE EXCEPTION 'published rate policy is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION integrations.guard_verification_evidence_review()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reviewed_at IS NOT NULL OR OLD.reviewed_by_actor_id IS NOT NULL THEN
    RAISE EXCEPTION 'evidence review is write-once';
  END IF;
  IF NEW.reviewed_at IS NULL OR NEW.reviewed_by_actor_id IS NULL OR NEW.reviewed_by_actor_id = NEW.registered_by_actor_id THEN
    RAISE EXCEPTION 'independent reviewer required';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['reviewed_by_actor_id','reviewed_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['reviewed_by_actor_id','reviewed_at']) THEN
    RAISE EXCEPTION 'evidence is append-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION integrations.guard_provider_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM integrations.provider_registry p WHERE p.provider_id=NEW.provider_id AND p.provider_code=NEW.provider_code_snapshot) THEN
    RAISE EXCEPTION 'provider code snapshot mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION integrations.guard_capability_declaration()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.support_status='SUPPORTED' AND NOT EXISTS (
    SELECT 1 FROM integrations.external_integrations i
    JOIN integrations.provider_capability_declarations d
      ON d.provider_adapter_version_id=i.provider_adapter_version_id
     AND d.capability_code=NEW.capability_code AND d.support_status='SUPPORTED'
    WHERE i.tenant_id=NEW.tenant_id AND i.company_id=NEW.company_id AND i.id=NEW.integration_id
  ) THEN RAISE EXCEPTION 'SUPPORTED adapter declaration required'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION integrations.guard_dispatch_capability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM integrations.integration_capabilities c
    WHERE c.tenant_id=NEW.tenant_id AND c.company_id=NEW.company_id
      AND c.integration_id=NEW.integration_id AND c.capability_code=NEW.capability_code
      AND c.support_status='SUPPORTED' AND c.effective_from<=transaction_timestamp()
      AND (c.effective_until IS NULL OR transaction_timestamp()<c.effective_until)
  ) THEN RAISE EXCEPTION 'effective SUPPORTED integration capability required'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION integrations.guard_exactly_one_active_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_tenant uuid; target_company uuid; target_integration uuid; integration_status text; active_count integer;
BEGIN
  IF TG_TABLE_NAME='external_integrations' THEN
    target_tenant:=NEW.tenant_id; target_company:=NEW.company_id; target_integration:=NEW.id; integration_status:=NEW.status;
  ELSE
    target_tenant:=NEW.tenant_id; target_company:=NEW.company_id; target_integration:=NEW.integration_id;
    SELECT status INTO integration_status FROM integrations.external_integrations
      WHERE tenant_id=target_tenant AND company_id=target_company AND id=target_integration;
  END IF;
  IF integration_status IN ('AUTHENTICATED','DISCOVERING','DISCOVERY_COMPLETE','MAPPING_REQUIRED','READY_FOR_REVIEW','ACTIVE','DEGRADED') THEN
    SELECT count(*) INTO active_count FROM integrations.integration_credential_bindings
      WHERE tenant_id=target_tenant AND integration_id=target_integration AND status='ACTIVE';
    IF active_count<>1 THEN RAISE EXCEPTION 'operational integration requires exactly one ACTIVE binding'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION integrations.guard_adapter_verification_promotion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE levels text[] := ARRAY['NOT_EVALUATED','MOCK_TESTED','SANDBOX_VERIFIED','PRODUCTION_VERIFIED','CERTIFIED'];
DECLARE old_level integer; new_level integer; actor_id uuid; evidence_id uuid; audit_id uuid; correlation_id uuid;
DECLARE evidence_adapter uuid; evidence_level_value text; evidence_result text; evidence_registered uuid; evidence_reviewed uuid; evidence_reviewed_at timestamptz; evidence_expires timestamptz; evidence_tenant uuid; evidence_company uuid; evidence_reference_value text; evidence_checksum_value text;
BEGIN
  IF NEW.verification_status=OLD.verification_status THEN RETURN NEW; END IF;
  old_level:=array_position(levels,OLD.verification_status); new_level:=array_position(levels,NEW.verification_status);
  IF new_level<>old_level+1 THEN RAISE EXCEPTION 'verification level skipping is prohibited'; END IF;
  BEGIN
    actor_id:=current_setting('app.actor_id',true)::uuid;
    evidence_id:=current_setting('app.evidence_id',true)::uuid;
    audit_id:=current_setting('app.audit_id',true)::uuid;
    correlation_id:=current_setting('app.correlation_id',true)::uuid;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'promotion actor, evidence, audit and correlation context required'; END;
  SELECT provider_adapter_version_id,evidence_level,result,registered_by_actor_id,reviewed_by_actor_id,reviewed_at,expires_at,tenant_id,company_id,evidence_reference,evidence_checksum
    INTO evidence_adapter,evidence_level_value,evidence_result,evidence_registered,evidence_reviewed,evidence_reviewed_at,evidence_expires,evidence_tenant,evidence_company,evidence_reference_value,evidence_checksum_value
    FROM integrations.provider_verification_evidence WHERE id=evidence_id FOR SHARE;
  IF NOT FOUND OR evidence_adapter<>NEW.provider_adapter_version_id
     OR evidence_level_value<>NEW.verification_status OR evidence_result<>'PASS'
     OR evidence_reviewed_at IS NULL OR (evidence_expires IS NOT NULL AND evidence_expires<=transaction_timestamp()) THEN
    RAISE EXCEPTION 'eligible reviewed PASS evidence required';
  END IF;
  IF actor_id=evidence_registered OR actor_id=evidence_reviewed THEN
    RAISE EXCEPTION 'self-promotion is prohibited';
  END IF;
  INSERT INTO audit.audit_events(id,tenant_id,company_id,actor_type,actor_id,action_code,resource_type,resource_reference_kind,resource_id,correlation_id,schema_version,reported_at,server_recorded_at,result,approver_actor_type,approver_actor_id,evidence_reference,evidence_checksum,payload_checksum)
    VALUES (audit_id,evidence_tenant,evidence_company,'USER',actor_id,'PROVIDER_VERIFICATION_PROMOTED','ProviderAdapterVersion','INSTANCE',NEW.provider_adapter_version_id,correlation_id,1,clock_timestamp(),clock_timestamp(),'SUCCESS','USER',actor_id,evidence_reference_value,evidence_checksum_value,evidence_checksum_value);
  RETURN NEW;
END;
$$;

CREATE FUNCTION integrations.guard_state_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_state text := to_jsonb(OLD)->>TG_ARGV[0]; new_state text := to_jsonb(NEW)->>TG_ARGV[0]; allowed text;
BEGIN
  IF old_state=new_state THEN RETURN NEW; END IF;
  IF TG_ARGV[1]='EXTERNAL_INTEGRATION' AND session_user='pos_worker' THEN
    allowed:='ACTIVE>DEGRADED,DEGRADED>ACTIVE,ACTIVE>ERROR,DEGRADED>ERROR';
  ELSIF TG_ARGV[1]='DISPATCH' AND session_user<>'pos_worker' THEN
    allowed:='QUEUED>CANCELLED,RETRY_SCHEDULED>CANCELLED';
  ELSE allowed:=TG_ARGV[2]; END IF;
  IF old_state||'>'||new_state <> ALL(string_to_array(allowed,',')) THEN
    RAISE EXCEPTION 'invalid % transition % -> % on %',TG_ARGV[0],old_state,new_state,TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE integrations.provider_registry (
  provider_id uuid PRIMARY KEY,
  provider_code text NOT NULL,
  display_name text NOT NULL,
  integration_class text NOT NULL,
  status text NOT NULL,
  official_reference_uri text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT provider_registry_provider_id_v7_ck CHECK (platform.is_uuid_v7(provider_id)),
  CONSTRAINT provider_registry_provider_code_uq UNIQUE (provider_code),
  CONSTRAINT provider_registry_provider_code_ck CHECK (provider_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT provider_registry_display_name_ck CHECK (btrim(display_name) <> ''),
  CONSTRAINT provider_registry_integration_class_ck CHECK (integration_class IN ('ERP_ACCOUNTING','ELECTRONIC_DOCUMENT_PROVIDER','HYBRID','OTHER_REVIEW_REQUIRED')),
  CONSTRAINT provider_registry_status_ck CHECK (status IN ('ACTIVE','RETIRED','BLOCKED')),
  CONSTRAINT provider_registry_version_ck CHECK (version > 0),
  CONSTRAINT provider_registry_timestamps_ck CHECK (created_at <= updated_at)
);

CREATE TABLE integrations.provider_adapter_versions (
  provider_adapter_version_id uuid PRIMARY KEY,
  provider_id uuid NOT NULL,
  adapter_code text NOT NULL,
  adapter_version text NOT NULL,
  contract_version integer NOT NULL,
  implementation_status text NOT NULL,
  verification_status text NOT NULL,
  released_at timestamptz NULL,
  retired_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT provider_adapter_versions_id_v7_ck CHECK (platform.is_uuid_v7(provider_adapter_version_id)),
  CONSTRAINT provider_adapter_versions_provider_id_id_uq UNIQUE (provider_id,provider_adapter_version_id),
  CONSTRAINT provider_adapter_versions_identity_uq UNIQUE (provider_id,adapter_code,adapter_version),
  CONSTRAINT provider_adapter_versions_provider_fk FOREIGN KEY (provider_id) REFERENCES integrations.provider_registry(provider_id) ON DELETE NO ACTION,
  CONSTRAINT provider_adapter_versions_text_ck CHECK (btrim(adapter_code) <> '' AND btrim(adapter_version) <> ''),
  CONSTRAINT provider_adapter_versions_contract_version_ck CHECK (contract_version >= 1),
  CONSTRAINT provider_adapter_versions_implementation_ck CHECK (implementation_status IN ('DESIGNED','IMPLEMENTED')),
  CONSTRAINT provider_adapter_versions_verification_ck CHECK (verification_status IN ('NOT_EVALUATED','MOCK_TESTED','SANDBOX_VERIFIED','PRODUCTION_VERIFIED','CERTIFIED')),
  CONSTRAINT provider_adapter_versions_timestamps_ck CHECK ((retired_at IS NULL OR released_at IS NOT NULL) AND (retired_at IS NULL OR released_at <= retired_at))
);

CREATE TABLE integrations.provider_capability_declarations (
  id uuid PRIMARY KEY,
  provider_id uuid NOT NULL,
  provider_adapter_version_id uuid NOT NULL,
  capability_code text NOT NULL,
  support_status text NOT NULL,
  official_reference_uri text NULL,
  verified_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT provider_capability_declarations_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT provider_capability_declarations_identity_uq UNIQUE (provider_adapter_version_id,capability_code),
  CONSTRAINT provider_capability_declarations_adapter_fk FOREIGN KEY (provider_id,provider_adapter_version_id) REFERENCES integrations.provider_adapter_versions(provider_id,provider_adapter_version_id) ON DELETE NO ACTION,
  CONSTRAINT provider_capability_declarations_code_ck CHECK (capability_code ~ '^[A-Z][A-Z0-9_]{1,127}$'),
  CONSTRAINT provider_capability_declarations_support_ck CHECK (support_status IN ('SUPPORTED','UNSUPPORTED','UNVERIFIED')),
  CONSTRAINT provider_capability_declarations_verified_ck CHECK (verified_at IS NULL OR support_status <> 'UNVERIFIED'),
  CONSTRAINT provider_capability_declarations_version_ck CHECK (version > 0)
);

CREATE TABLE integrations.provider_platform_configurations (
  id uuid PRIMARY KEY,
  provider_id uuid NOT NULL,
  environment text NOT NULL,
  configuration_type text NOT NULL,
  configuration_schema_version integer NOT NULL,
  configuration_payload jsonb NOT NULL,
  status text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NULL,
  published_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL,
  row_version bigint NOT NULL DEFAULT 1,
  CONSTRAINT provider_platform_configurations_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT provider_platform_configurations_version_uq UNIQUE (provider_id,environment,configuration_type,version),
  CONSTRAINT provider_platform_configurations_provider_fk FOREIGN KEY (provider_id) REFERENCES integrations.provider_registry(provider_id) ON DELETE NO ACTION,
  CONSTRAINT provider_platform_configurations_codes_ck CHECK (environment ~ '^[A-Z][A-Z0-9_]{1,63}$' AND configuration_type ~ '^[A-Z][A-Z0-9_]{1,127}$'),
  CONSTRAINT provider_platform_configurations_versions_ck CHECK (configuration_schema_version > 0 AND version > 0 AND row_version > 0),
  CONSTRAINT provider_platform_configurations_json_ck CHECK (jsonb_typeof(configuration_payload) = 'object' AND octet_length(convert_to(configuration_payload::text,'UTF8')) <= 16384),
  CONSTRAINT provider_platform_configurations_status_ck CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  CONSTRAINT provider_platform_configurations_validity_ck CHECK (valid_until IS NULL OR valid_from < valid_until),
  CONSTRAINT provider_platform_configurations_publish_ck CHECK ((status='DRAFT' AND published_at IS NULL) OR (status IN ('PUBLISHED','RETIRED') AND published_at IS NOT NULL)),
  CONSTRAINT provider_platform_configurations_timestamps_ck CHECK (created_at <= updated_at)
);

CREATE TABLE integrations.external_integrations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NULL,
  provider_id uuid NOT NULL,
  provider_code_snapshot text NOT NULL,
  provider_adapter_version_id uuid NOT NULL,
  environment text NOT NULL,
  status text NOT NULL,
  configuration_version bigint NOT NULL,
  provider_account_reference text NULL,
  last_health_check_at timestamptz NULL,
  last_success_at timestamptz NULL,
  last_failure_at timestamptz NULL,
  activated_at timestamptz NULL,
  disabled_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT external_integrations_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT external_integrations_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT external_integrations_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT external_integrations_tenant_company_id_provider_uq UNIQUE (tenant_id,company_id,id,provider_id),
  CONSTRAINT external_integrations_tenant_company_id_adapter_uq UNIQUE (tenant_id,company_id,id,provider_adapter_version_id),
  CONSTRAINT external_integrations_company_fk FOREIGN KEY (tenant_id,company_id) REFERENCES organization.companies(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT external_integrations_branch_fk FOREIGN KEY (tenant_id,company_id,branch_id) REFERENCES organization.branches(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT external_integrations_adapter_fk FOREIGN KEY (provider_id,provider_adapter_version_id) REFERENCES integrations.provider_adapter_versions(provider_id,provider_adapter_version_id) ON DELETE NO ACTION,
  CONSTRAINT external_integrations_snapshot_ck CHECK (provider_code_snapshot ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT external_integrations_environment_ck CHECK (environment ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT external_integrations_status_ck CHECK (status IN ('CREATED','CREDENTIALS_CONFIGURED','AUTHENTICATED','DISCOVERING','DISCOVERY_COMPLETE','MAPPING_REQUIRED','READY_FOR_REVIEW','ACTIVE','DEGRADED','DISABLED','CREDENTIAL_ROTATION_REQUIRED','ERROR')),
  CONSTRAINT external_integrations_versions_ck CHECK (configuration_version > 0 AND version > 0),
  CONSTRAINT external_integrations_timestamps_ck CHECK (created_at <= updated_at)
);

CREATE TABLE integrations.integration_credential_bindings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  credential_reference text NOT NULL,
  credential_kind text NOT NULL,
  generation integer NOT NULL,
  status text NOT NULL,
  activated_at timestamptz NULL,
  rotation_due_at timestamptz NULL,
  superseded_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT integration_credential_bindings_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT integration_credential_bindings_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT integration_credential_bindings_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT integration_credential_bindings_integration_id_uq UNIQUE (tenant_id,company_id,integration_id,id),
  CONSTRAINT integration_credential_bindings_generation_uq UNIQUE (tenant_id,integration_id,generation),
  CONSTRAINT integration_credential_bindings_integration_fk FOREIGN KEY (tenant_id,company_id,integration_id) REFERENCES integrations.external_integrations(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT integration_credential_bindings_reference_ck CHECK (btrim(credential_reference) <> '' AND btrim(credential_kind) <> ''),
  CONSTRAINT integration_credential_bindings_numbers_ck CHECK (generation > 0 AND version > 0),
  CONSTRAINT integration_credential_bindings_status_ck CHECK (status IN ('PENDING','ACTIVE','SUPERSEDED','REVOKED')),
  CONSTRAINT integration_credential_bindings_lifecycle_ck CHECK ((status='PENDING' AND activated_at IS NULL AND superseded_at IS NULL AND revoked_at IS NULL) OR (status='ACTIVE' AND activated_at IS NOT NULL AND superseded_at IS NULL AND revoked_at IS NULL) OR (status='SUPERSEDED' AND activated_at IS NOT NULL AND superseded_at IS NOT NULL AND revoked_at IS NULL) OR (status='REVOKED' AND revoked_at IS NOT NULL))
);

CREATE TABLE integrations.resource_ownership_policies (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  resource_type text NOT NULL,
  operation_scope text NOT NULL,
  authority_type text NOT NULL,
  policy_version bigint NOT NULL,
  status text NOT NULL,
  effective_from timestamptz NOT NULL,
  conflict_policy_code text NULL,
  effective_until timestamptz NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT resource_ownership_policies_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT resource_ownership_policies_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT resource_ownership_policies_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT resource_ownership_policies_integration_id_uq UNIQUE (tenant_id,company_id,integration_id,id),
  CONSTRAINT resource_ownership_policies_version_uq UNIQUE (tenant_id,company_id,integration_id,resource_type,operation_scope,policy_version),
  CONSTRAINT resource_ownership_policies_integration_fk FOREIGN KEY (tenant_id,company_id,integration_id) REFERENCES integrations.external_integrations(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT resource_ownership_policies_text_ck CHECK (btrim(resource_type) <> '' AND btrim(operation_scope) <> ''),
  CONSTRAINT resource_ownership_policies_authority_ck CHECK ((authority_type='BIDIRECTIONAL_WITH_EXPLICIT_CONFLICT_POLICY' AND conflict_policy_code IS NOT NULL AND btrim(conflict_policy_code)<>'') OR (authority_type IN ('POS_AUTHORITATIVE','PROVIDER_AUTHORITATIVE','REFERENCE_ONLY') AND conflict_policy_code IS NULL)),
  CONSTRAINT resource_ownership_policies_status_ck CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  CONSTRAINT resource_ownership_policies_validity_ck CHECK (policy_version > 0 AND (effective_until IS NULL OR effective_from < effective_until))
);

CREATE TABLE integrations.integration_capabilities (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  capability_code text NOT NULL,
  support_status text NOT NULL,
  configuration_version bigint NOT NULL,
  effective_from timestamptz NOT NULL,
  ownership_policy_id uuid NULL,
  effective_until timestamptz NULL,
  source_reference_uri text NULL,
  verified_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT integration_capabilities_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT integration_capabilities_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT integration_capabilities_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT integration_capabilities_version_uq UNIQUE (tenant_id,company_id,integration_id,capability_code,configuration_version),
  CONSTRAINT integration_capabilities_integration_fk FOREIGN KEY (tenant_id,company_id,integration_id) REFERENCES integrations.external_integrations(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT integration_capabilities_ownership_fk FOREIGN KEY (tenant_id,company_id,integration_id,ownership_policy_id) REFERENCES integrations.resource_ownership_policies(tenant_id,company_id,integration_id,id) ON DELETE NO ACTION,
  CONSTRAINT integration_capabilities_code_ck CHECK (capability_code ~ '^[A-Z][A-Z0-9_]{1,127}$'),
  CONSTRAINT integration_capabilities_support_ck CHECK (support_status IN ('SUPPORTED','UNSUPPORTED','UNVERIFIED','DISABLED')),
  CONSTRAINT integration_capabilities_version_ck CHECK (configuration_version > 0 AND version > 0),
  CONSTRAINT integration_capabilities_validity_ck CHECK (effective_until IS NULL OR effective_from < effective_until)
);

CREATE TABLE integrations.integration_discovery_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  provider_adapter_version_id uuid NOT NULL,
  discovery_type text NOT NULL,
  status text NOT NULL,
  idempotency_key text NOT NULL,
  request_checksum text NOT NULL,
  correlation_id uuid NOT NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  item_count integer NULL,
  reviewed_item_count integer NULL,
  error_code text NULL,
  evidence_reference text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT integration_discovery_runs_id_v7_ck CHECK (platform.is_uuid_v7(id) AND platform.is_uuid_v7(correlation_id)),
  CONSTRAINT integration_discovery_runs_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT integration_discovery_runs_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT integration_discovery_runs_integration_id_uq UNIQUE (tenant_id,company_id,integration_id,id),
  CONSTRAINT integration_discovery_runs_idempotency_uq UNIQUE (tenant_id,integration_id,idempotency_key),
  CONSTRAINT integration_discovery_runs_integration_adapter_fk FOREIGN KEY (tenant_id,company_id,integration_id,provider_adapter_version_id) REFERENCES integrations.external_integrations(tenant_id,company_id,id,provider_adapter_version_id) ON DELETE NO ACTION,
  CONSTRAINT integration_discovery_runs_text_ck CHECK (btrim(discovery_type)<>'' AND btrim(idempotency_key)<>''),
  CONSTRAINT integration_discovery_runs_checksum_ck CHECK (request_checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT integration_discovery_runs_status_ck CHECK (status IN ('CREATED','RUNNING','COMPLETED','PARTIAL','FAILED','CANCELLED')),
  CONSTRAINT integration_discovery_runs_counts_ck CHECK ((item_count IS NULL OR item_count>=0) AND (reviewed_item_count IS NULL OR reviewed_item_count>=0)),
  CONSTRAINT integration_discovery_runs_timestamps_ck CHECK (created_at<=updated_at AND (completed_at IS NULL OR started_at IS NOT NULL AND started_at<=completed_at)),
  CONSTRAINT integration_discovery_runs_version_ck CHECK (version > 0)
);

CREATE TABLE integrations.integration_discovery_items (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  discovery_run_id uuid NOT NULL,
  resource_type text NOT NULL,
  external_id text NOT NULL,
  provider_checksum text NOT NULL,
  review_status text NOT NULL,
  metadata_schema_version integer NOT NULL,
  provider_metadata jsonb NOT NULL,
  external_code text NULL,
  display_reference text NULL,
  proposed_internal_entity_type text NULL,
  proposed_internal_entity_id uuid NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT integration_discovery_items_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT integration_discovery_items_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT integration_discovery_items_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT integration_discovery_items_external_uq UNIQUE (tenant_id,discovery_run_id,resource_type,external_id),
  CONSTRAINT integration_discovery_items_run_fk FOREIGN KEY (tenant_id,company_id,integration_id,discovery_run_id) REFERENCES integrations.integration_discovery_runs(tenant_id,company_id,integration_id,id) ON DELETE NO ACTION,
  CONSTRAINT integration_discovery_items_text_ck CHECK (btrim(resource_type)<>'' AND btrim(external_id)<>''),
  CONSTRAINT integration_discovery_items_checksum_ck CHECK (provider_checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT integration_discovery_items_review_ck CHECK (review_status IN ('PENDING','PROPOSED','ACCEPTED','REJECTED','CONFLICT')),
  CONSTRAINT integration_discovery_items_json_ck CHECK (metadata_schema_version>0 AND jsonb_typeof(provider_metadata)='object' AND octet_length(convert_to(provider_metadata::text,'UTF8'))<=32768),
  CONSTRAINT integration_discovery_items_proposed_ck CHECK ((proposed_internal_entity_type IS NULL)=(proposed_internal_entity_id IS NULL)),
  CONSTRAINT integration_discovery_items_timestamps_ck CHECK (created_at<=updated_at),
  CONSTRAINT integration_discovery_items_version_ck CHECK (version>0)
);

CREATE TABLE integrations.external_reference_mappings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  resource_type text NOT NULL,
  internal_entity_type text NOT NULL,
  internal_entity_id uuid NOT NULL,
  external_id text NOT NULL,
  mapping_status text NOT NULL,
  provider_metadata_schema_version integer NOT NULL,
  provider_metadata jsonb NOT NULL,
  external_code text NULL,
  verified_at timestamptz NULL,
  verified_by_actor_id uuid NULL,
  supersedes_mapping_id uuid NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT external_reference_mappings_id_v7_ck CHECK (platform.is_uuid_v7(id) AND platform.is_uuid_v7(internal_entity_id)),
  CONSTRAINT external_reference_mappings_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT external_reference_mappings_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT external_reference_mappings_self_scope_uq UNIQUE (tenant_id,company_id,integration_id,resource_type,id),
  CONSTRAINT external_reference_mappings_integration_fk FOREIGN KEY (tenant_id,company_id,integration_id) REFERENCES integrations.external_integrations(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT external_reference_mappings_supersedes_fk FOREIGN KEY (tenant_id,company_id,integration_id,resource_type,supersedes_mapping_id) REFERENCES integrations.external_reference_mappings(tenant_id,company_id,integration_id,resource_type,id) ON DELETE NO ACTION,
  CONSTRAINT external_reference_mappings_reviewer_fk FOREIGN KEY (verified_by_actor_id) REFERENCES identity.users(id) ON DELETE NO ACTION,
  CONSTRAINT external_reference_mappings_text_ck CHECK (btrim(resource_type)<>'' AND btrim(internal_entity_type)<>'' AND btrim(external_id)<>''),
  CONSTRAINT external_reference_mappings_status_ck CHECK (mapping_status IN ('PROPOSED','VERIFIED','ACTIVE','CONFLICT','STALE','RETIRED')),
  CONSTRAINT external_reference_mappings_json_ck CHECK (provider_metadata_schema_version>0 AND jsonb_typeof(provider_metadata)='object' AND octet_length(convert_to(provider_metadata::text,'UTF8'))<=16384),
  CONSTRAINT external_reference_mappings_verification_ck CHECK ((mapping_status IN ('VERIFIED','ACTIVE'))=(verified_at IS NOT NULL AND verified_by_actor_id IS NOT NULL)),
  CONSTRAINT external_reference_mappings_timestamps_ck CHECK (created_at<=updated_at),
  CONSTRAINT external_reference_mappings_version_ck CHECK (version>0)
);

CREATE TABLE integrations.integration_dispatches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  capability_code text NOT NULL,
  dispatch_class text NOT NULL,
  resource_type text NOT NULL,
  internal_operation_id uuid NOT NULL,
  internal_entity_type text NOT NULL,
  internal_entity_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  payload_schema_version integer NOT NULL,
  payload_checksum text NOT NULL,
  status text NOT NULL,
  correlation_id uuid NOT NULL,
  provider_request_reference text NULL,
  retry_classification text NULL,
  next_attempt_at timestamptz NULL,
  last_reconciled_at timestamptz NULL,
  causation_id uuid NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT integration_dispatches_id_v7_ck CHECK (platform.is_uuid_v7(id) AND platform.is_uuid_v7(internal_operation_id) AND platform.is_uuid_v7(internal_entity_id) AND platform.is_uuid_v7(correlation_id) AND (causation_id IS NULL OR platform.is_uuid_v7(causation_id))),
  CONSTRAINT integration_dispatches_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT integration_dispatches_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT integration_dispatches_tenant_id_class_uq UNIQUE (tenant_id,id,dispatch_class),
  CONSTRAINT integration_dispatches_tenant_company_id_class_uq UNIQUE (tenant_id,company_id,id,dispatch_class),
  CONSTRAINT integration_dispatches_idempotency_uq UNIQUE (tenant_id,integration_id,idempotency_key),
  CONSTRAINT integration_dispatches_integration_fk FOREIGN KEY (tenant_id,company_id,integration_id) REFERENCES integrations.external_integrations(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT integration_dispatches_text_ck CHECK (capability_code ~ '^[A-Z][A-Z0-9_]{1,127}$' AND btrim(resource_type)<>'' AND btrim(internal_entity_type)<>'' AND btrim(idempotency_key)<>''),
  CONSTRAINT integration_dispatches_checksum_ck CHECK (payload_schema_version>0 AND payload_checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT integration_dispatches_status_ck CHECK (status IN ('QUEUED','DISPATCHING','SUCCEEDED','RETRY_SCHEDULED','UNKNOWN_OUTCOME','RECONCILIATION_REQUIRED','PERMANENT_FAILURE','DEAD_LETTER','CANCELLED')),
  CONSTRAINT integration_dispatches_dispatch_class_002_ck CHECK (dispatch_class='NON_FISCAL' AND capability_code NOT IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','SUPPORT_DOCUMENTS') AND internal_entity_type<>'ElectronicDocument'),
  CONSTRAINT integration_dispatches_timestamps_ck CHECK (created_at<=updated_at),
  CONSTRAINT integration_dispatches_version_ck CHECK (version>0)
);

CREATE TABLE integrations.integration_dispatch_attempts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  integration_dispatch_id uuid NOT NULL,
  dispatch_class text NOT NULL,
  attempt_number integer NOT NULL,
  status text NOT NULL,
  request_id text NOT NULL,
  started_at timestamptz NOT NULL,
  transport_status text NULL,
  http_status integer NULL,
  provider_operation_reference text NULL,
  provider_response_reference text NULL,
  retry_after_at timestamptz NULL,
  finished_at timestamptz NULL,
  diagnostic_reference text NULL,
  created_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT integration_dispatch_attempts_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT integration_dispatch_attempts_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT integration_dispatch_attempts_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT integration_dispatch_attempts_history_uq UNIQUE (tenant_id,integration_dispatch_id,attempt_number),
  CONSTRAINT integration_dispatch_attempts_dispatch_fk FOREIGN KEY (tenant_id,company_id,integration_dispatch_id,dispatch_class) REFERENCES integrations.integration_dispatches(tenant_id,company_id,id,dispatch_class) ON DELETE NO ACTION,
  CONSTRAINT integration_dispatch_attempts_class_ck CHECK (dispatch_class='NON_FISCAL'),
  CONSTRAINT integration_dispatch_attempts_status_ck CHECK (status IN ('CREATED','IN_PROGRESS','SUCCEEDED','FAILED','UNKNOWN_OUTCOME','CANCELLED')),
  CONSTRAINT integration_dispatch_attempts_values_ck CHECK (attempt_number>0 AND version>0 AND btrim(request_id)<>'' AND (http_status IS NULL OR http_status BETWEEN 100 AND 599)),
  CONSTRAINT integration_dispatch_attempts_timestamps_ck CHECK (finished_at IS NULL OR started_at<=finished_at)
);

CREATE TABLE integrations.external_webhook_receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  deduplication_key text NOT NULL,
  received_at timestamptz NOT NULL,
  payload_schema_version integer NOT NULL,
  payload_checksum text NOT NULL,
  authentication_verification_result text NOT NULL,
  replay_verification_result text NOT NULL,
  processing_status text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  correlation_id uuid NOT NULL,
  provider_event_id text NULL,
  payload_evidence_reference text NULL,
  next_attempt_at timestamptz NULL,
  last_error_code text NULL,
  processed_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT external_webhook_receipts_id_v7_ck CHECK (platform.is_uuid_v7(id) AND platform.is_uuid_v7(correlation_id)),
  CONSTRAINT external_webhook_receipts_tenant_id_id_uq UNIQUE (tenant_id,id),
  CONSTRAINT external_webhook_receipts_tenant_company_id_id_uq UNIQUE (tenant_id,company_id,id),
  CONSTRAINT external_webhook_receipts_dedup_uq UNIQUE (tenant_id,integration_id,deduplication_key),
  CONSTRAINT external_webhook_receipts_integration_fk FOREIGN KEY (tenant_id,company_id,integration_id) REFERENCES integrations.external_integrations(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT external_webhook_receipts_checksum_ck CHECK (payload_schema_version>0 AND payload_checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT external_webhook_receipts_auth_ck CHECK (authentication_verification_result IN ('VERIFIED','FAILED','UNSUPPORTED_BY_PROVIDER','UNVERIFIED_CONTRACT')),
  CONSTRAINT external_webhook_receipts_replay_ck CHECK (replay_verification_result IN ('VERIFIED','FAILED','UNSUPPORTED_BY_PROVIDER','UNVERIFIED_CONTRACT')),
  CONSTRAINT external_webhook_receipts_status_ck CHECK (processing_status IN ('RECEIVED','REJECTED','PENDING','PROCESSING','PROCESSED','RETRY_SCHEDULED','DEAD_LETTER')),
  CONSTRAINT external_webhook_receipts_values_ck CHECK (attempt_count>=0 AND version>0 AND btrim(deduplication_key)<>'')
);

CREATE TABLE integrations.provider_rate_limit_policies (
  id uuid PRIMARY KEY,
  provider_id uuid NOT NULL,
  scope_type text NOT NULL,
  tenant_id uuid NULL,
  company_id uuid NULL,
  integration_id uuid NULL,
  endpoint_class text NOT NULL,
  retry_after_mode text NOT NULL,
  backoff_policy_code text NOT NULL,
  status text NOT NULL,
  valid_from timestamptz NOT NULL,
  version bigint NOT NULL,
  row_version bigint NOT NULL DEFAULT 1,
  request_limit integer NULL,
  window_seconds integer NULL,
  concurrency_limit integer NULL,
  cooldown_seconds integer NULL,
  source_reference_uri text NULL,
  valid_until timestamptz NULL,
  published_at timestamptz NULL,
  CONSTRAINT provider_rate_limit_policies_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT provider_rate_limit_policies_provider_fk FOREIGN KEY (provider_id) REFERENCES integrations.provider_registry(provider_id) ON DELETE NO ACTION,
  CONSTRAINT provider_rate_limit_policies_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id) ON DELETE NO ACTION,
  CONSTRAINT provider_rate_limit_policies_company_fk FOREIGN KEY (tenant_id,company_id) REFERENCES organization.companies(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT provider_rate_limit_policies_integration_provider_fk FOREIGN KEY (tenant_id,company_id,integration_id,provider_id) REFERENCES integrations.external_integrations(tenant_id,company_id,id,provider_id) ON DELETE NO ACTION,
  CONSTRAINT provider_rate_limit_policies_scope_ck CHECK ((scope_type='PROVIDER' AND tenant_id IS NULL AND company_id IS NULL AND integration_id IS NULL) OR (scope_type='TENANT' AND tenant_id IS NOT NULL AND company_id IS NULL AND integration_id IS NULL) OR (scope_type='COMPANY' AND tenant_id IS NOT NULL AND company_id IS NOT NULL AND integration_id IS NULL) OR (scope_type='INTEGRATION' AND tenant_id IS NOT NULL AND company_id IS NOT NULL AND integration_id IS NOT NULL)),
  CONSTRAINT provider_rate_limit_policies_text_ck CHECK (btrim(endpoint_class)<>'' AND btrim(backoff_policy_code)<>''),
  CONSTRAINT provider_rate_limit_policies_limits_ck CHECK ((request_limit IS NULL OR request_limit>0) AND (window_seconds IS NULL OR window_seconds>0) AND (concurrency_limit IS NULL OR concurrency_limit>0) AND (cooldown_seconds IS NULL OR cooldown_seconds>0)),
  CONSTRAINT provider_rate_limit_policies_retry_ck CHECK (retry_after_mode IN ('PROVIDER_HEADER_DRIVEN','FIXED_WINDOW','UNVERIFIED')),
  CONSTRAINT provider_rate_limit_policies_status_ck CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  CONSTRAINT provider_rate_limit_policies_publish_ck CHECK ((status='DRAFT' AND published_at IS NULL) OR (status IN ('PUBLISHED','RETIRED') AND published_at IS NOT NULL)),
  CONSTRAINT provider_rate_limit_policies_validity_ck CHECK (version>0 AND row_version>0 AND (valid_until IS NULL OR valid_from<valid_until))
);

CREATE TABLE integrations.provider_verification_evidence (
  id uuid PRIMARY KEY,
  provider_id uuid NOT NULL,
  provider_adapter_version_id uuid NOT NULL,
  scope_type text NOT NULL,
  environment text NOT NULL,
  evidence_level text NOT NULL,
  test_suite_version text NOT NULL,
  source_commit text NOT NULL,
  executed_at timestamptz NOT NULL,
  result text NOT NULL,
  evidence_reference text NOT NULL,
  evidence_checksum text NOT NULL,
  registered_by_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  tenant_id uuid NULL,
  company_id uuid NULL,
  integration_id uuid NULL,
  authorized_account_reference text NULL,
  reviewed_by_actor_id uuid NULL,
  reviewed_at timestamptz NULL,
  expires_at timestamptz NULL,
  CONSTRAINT provider_verification_evidence_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  CONSTRAINT provider_verification_evidence_provider_id_id_uq UNIQUE (provider_id,id),
  CONSTRAINT provider_verification_evidence_adapter_fk FOREIGN KEY (provider_id,provider_adapter_version_id) REFERENCES integrations.provider_adapter_versions(provider_id,provider_adapter_version_id) ON DELETE NO ACTION,
  CONSTRAINT provider_verification_evidence_integration_adapter_fk FOREIGN KEY (tenant_id,company_id,integration_id,provider_adapter_version_id) REFERENCES integrations.external_integrations(tenant_id,company_id,id,provider_adapter_version_id) ON DELETE NO ACTION,
  CONSTRAINT provider_verification_evidence_registrar_fk FOREIGN KEY (registered_by_actor_id) REFERENCES identity.users(id) ON DELETE NO ACTION,
  CONSTRAINT provider_verification_evidence_reviewer_fk FOREIGN KEY (reviewed_by_actor_id) REFERENCES identity.users(id) ON DELETE NO ACTION,
  CONSTRAINT provider_verification_evidence_scope_ck CHECK ((scope_type='GLOBAL' AND tenant_id IS NULL AND company_id IS NULL AND integration_id IS NULL) OR (scope_type='INTEGRATION' AND tenant_id IS NOT NULL AND company_id IS NOT NULL AND integration_id IS NOT NULL)),
  CONSTRAINT provider_verification_evidence_level_ck CHECK (evidence_level IN ('DOCUMENTED','IMPLEMENTED','MOCK_TESTED','SANDBOX_VERIFIED','PRODUCTION_VERIFIED','CERTIFIED')),
  CONSTRAINT provider_verification_evidence_result_ck CHECK (result IN ('PASS','FAIL','BLOCKED')),
  CONSTRAINT provider_verification_evidence_checksum_ck CHECK (evidence_checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT provider_verification_evidence_review_ck CHECK ((reviewed_by_actor_id IS NULL)=(reviewed_at IS NULL) AND (reviewed_by_actor_id IS NULL OR reviewed_by_actor_id<>registered_by_actor_id)),
  CONSTRAINT provider_verification_evidence_expiry_ck CHECK (expires_at IS NULL OR executed_at<expires_at),
  CONSTRAINT provider_verification_evidence_text_ck CHECK (btrim(environment)<>'' AND btrim(test_suite_version)<>'' AND btrim(source_commit)<>'' AND btrim(evidence_reference)<>'')
);

ALTER TABLE integrations.provider_platform_configurations ADD CONSTRAINT provider_platform_configurations_published_validity_excl EXCLUDE USING gist (provider_id WITH =,environment WITH =,configuration_type WITH =,tstzrange(valid_from,valid_until,'[)') WITH &&) WHERE (status='PUBLISHED');
ALTER TABLE integrations.resource_ownership_policies ADD CONSTRAINT resource_ownership_policies_published_validity_excl EXCLUDE USING gist (tenant_id WITH =,company_id WITH =,integration_id WITH =,resource_type WITH =,operation_scope WITH =,tstzrange(effective_from,effective_until,'[)') WITH &&) WHERE (status='PUBLISHED');
ALTER TABLE integrations.integration_capabilities ADD CONSTRAINT integration_capabilities_effective_validity_excl EXCLUDE USING gist (tenant_id WITH =,company_id WITH =,integration_id WITH =,capability_code WITH =,tstzrange(effective_from,effective_until,'[)') WITH &&);
ALTER TABLE integrations.provider_rate_limit_policies ADD CONSTRAINT provider_rate_limit_policies_provider_validity_excl EXCLUDE USING gist (provider_id WITH =,endpoint_class WITH =,tstzrange(valid_from,valid_until,'[)') WITH &&) WHERE (scope_type='PROVIDER' AND status='PUBLISHED');
ALTER TABLE integrations.provider_rate_limit_policies ADD CONSTRAINT provider_rate_limit_policies_tenant_validity_excl EXCLUDE USING gist (provider_id WITH =,tenant_id WITH =,endpoint_class WITH =,tstzrange(valid_from,valid_until,'[)') WITH &&) WHERE (scope_type='TENANT' AND status='PUBLISHED');
ALTER TABLE integrations.provider_rate_limit_policies ADD CONSTRAINT provider_rate_limit_policies_company_validity_excl EXCLUDE USING gist (provider_id WITH =,tenant_id WITH =,company_id WITH =,endpoint_class WITH =,tstzrange(valid_from,valid_until,'[)') WITH &&) WHERE (scope_type='COMPANY' AND status='PUBLISHED');
ALTER TABLE integrations.provider_rate_limit_policies ADD CONSTRAINT provider_rate_limit_policies_integration_validity_excl EXCLUDE USING gist (provider_id WITH =,tenant_id WITH =,company_id WITH =,integration_id WITH =,endpoint_class WITH =,tstzrange(valid_from,valid_until,'[)') WITH &&) WHERE (scope_type='INTEGRATION' AND status='PUBLISHED');

CREATE UNIQUE INDEX external_integrations_company_account_active_uq ON integrations.external_integrations(tenant_id,company_id,provider_id,environment,provider_account_reference) WHERE branch_id IS NULL AND provider_account_reference IS NOT NULL AND status<>'DISABLED';
CREATE UNIQUE INDEX external_integrations_branch_account_active_uq ON integrations.external_integrations(tenant_id,company_id,branch_id,provider_id,environment,provider_account_reference) WHERE branch_id IS NOT NULL AND provider_account_reference IS NOT NULL AND status<>'DISABLED';
CREATE UNIQUE INDEX integration_credential_bindings_active_uq ON integrations.integration_credential_bindings(tenant_id,integration_id) WHERE status='ACTIVE';
CREATE UNIQUE INDEX external_reference_mappings_internal_current_uq ON integrations.external_reference_mappings(tenant_id,company_id,integration_id,resource_type,internal_entity_type,internal_entity_id) WHERE mapping_status<>'RETIRED';
CREATE UNIQUE INDEX external_reference_mappings_external_current_uq ON integrations.external_reference_mappings(tenant_id,company_id,integration_id,resource_type,external_id) WHERE mapping_status<>'RETIRED';
CREATE UNIQUE INDEX provider_rate_limit_policies_provider_version_uq ON integrations.provider_rate_limit_policies(provider_id,endpoint_class,version) WHERE scope_type='PROVIDER';
CREATE UNIQUE INDEX provider_rate_limit_policies_tenant_version_uq ON integrations.provider_rate_limit_policies(provider_id,tenant_id,endpoint_class,version) WHERE scope_type='TENANT';
CREATE UNIQUE INDEX provider_rate_limit_policies_company_version_uq ON integrations.provider_rate_limit_policies(provider_id,tenant_id,company_id,endpoint_class,version) WHERE scope_type='COMPANY';
CREATE UNIQUE INDEX provider_rate_limit_policies_integration_version_uq ON integrations.provider_rate_limit_policies(provider_id,tenant_id,company_id,integration_id,endpoint_class,version) WHERE scope_type='INTEGRATION';
CREATE UNIQUE INDEX provider_verification_evidence_global_uq ON integrations.provider_verification_evidence(provider_adapter_version_id,environment,test_suite_version,source_commit,executed_at) WHERE scope_type='GLOBAL';
CREATE UNIQUE INDEX provider_verification_evidence_integration_uq ON integrations.provider_verification_evidence(tenant_id,integration_id,provider_adapter_version_id,environment,test_suite_version,source_commit,executed_at) WHERE scope_type='INTEGRATION';
CREATE UNIQUE INDEX provider_verification_evidence_tenant_id_uq ON integrations.provider_verification_evidence(tenant_id,id) WHERE tenant_id IS NOT NULL;

CREATE INDEX provider_adapter_versions_provider_status_idx ON integrations.provider_adapter_versions(provider_id,implementation_status,verification_status);
CREATE INDEX provider_adapter_versions_released_idx ON integrations.provider_adapter_versions(provider_id,released_at DESC) WHERE retired_at IS NULL;
CREATE INDEX provider_capability_declarations_provider_capability_idx ON integrations.provider_capability_declarations(provider_id,capability_code,support_status);
CREATE INDEX provider_capability_declarations_adapter_fk_idx ON integrations.provider_capability_declarations(provider_id,provider_adapter_version_id);
CREATE INDEX provider_platform_configurations_lookup_idx ON integrations.provider_platform_configurations(provider_id,environment,configuration_type,status,valid_from DESC);
CREATE INDEX external_integrations_tenant_status_provider_idx ON integrations.external_integrations(tenant_id,company_id,status,provider_id,id);
CREATE INDEX external_integrations_provider_environment_status_idx ON integrations.external_integrations(provider_id,environment,status,id);
CREATE INDEX external_integrations_branch_fk_idx ON integrations.external_integrations(tenant_id,company_id,branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX external_integrations_adapter_fk_idx ON integrations.external_integrations(provider_id,provider_adapter_version_id);
CREATE INDEX external_integrations_health_idx ON integrations.external_integrations(tenant_id,company_id,last_health_check_at,id) WHERE status IN ('ACTIVE','DEGRADED');
CREATE INDEX integration_credential_bindings_integration_status_idx ON integrations.integration_credential_bindings(tenant_id,company_id,integration_id,status,generation DESC);
CREATE INDEX integration_credential_bindings_rotation_idx ON integrations.integration_credential_bindings(rotation_due_at,tenant_id,integration_id) WHERE status='ACTIVE' AND rotation_due_at IS NOT NULL;
CREATE INDEX resource_ownership_policies_lookup_idx ON integrations.resource_ownership_policies(tenant_id,company_id,integration_id,resource_type,operation_scope,status,effective_from DESC);
CREATE INDEX integration_capabilities_lookup_idx ON integrations.integration_capabilities(tenant_id,company_id,integration_id,capability_code,support_status,effective_from DESC);
CREATE INDEX integration_capabilities_ownership_fk_idx ON integrations.integration_capabilities(tenant_id,company_id,integration_id,ownership_policy_id) WHERE ownership_policy_id IS NOT NULL;
CREATE INDEX integration_discovery_runs_work_idx ON integrations.integration_discovery_runs(tenant_id,status,created_at,id) WHERE status IN ('CREATED','RUNNING');
CREATE INDEX integration_discovery_runs_review_idx ON integrations.integration_discovery_runs(tenant_id,integration_id,completed_at DESC,id) WHERE status IN ('COMPLETED','PARTIAL');
CREATE INDEX integration_discovery_runs_integration_adapter_fk_idx ON integrations.integration_discovery_runs(tenant_id,company_id,integration_id,provider_adapter_version_id);
CREATE INDEX integration_discovery_items_review_idx ON integrations.integration_discovery_items(tenant_id,integration_id,review_status,created_at,id);
CREATE INDEX integration_discovery_items_external_idx ON integrations.integration_discovery_items(tenant_id,integration_id,resource_type,external_id);
CREATE INDEX integration_discovery_items_run_fk_idx ON integrations.integration_discovery_items(tenant_id,company_id,integration_id,discovery_run_id);
CREATE INDEX external_reference_mappings_internal_idx ON integrations.external_reference_mappings(tenant_id,company_id,integration_id,internal_entity_type,internal_entity_id,resource_type);
CREATE INDEX external_reference_mappings_external_idx ON integrations.external_reference_mappings(tenant_id,company_id,integration_id,resource_type,external_id);
CREATE INDEX external_reference_mappings_review_idx ON integrations.external_reference_mappings(tenant_id,integration_id,mapping_status,updated_at,id) WHERE mapping_status IN ('PROPOSED','CONFLICT','STALE');
CREATE INDEX external_reference_mappings_supersedes_fk_idx ON integrations.external_reference_mappings(tenant_id,company_id,integration_id,resource_type,supersedes_mapping_id) WHERE supersedes_mapping_id IS NOT NULL;
CREATE INDEX external_reference_mappings_reviewer_fk_idx ON integrations.external_reference_mappings(verified_by_actor_id) WHERE verified_by_actor_id IS NOT NULL;
CREATE INDEX integration_dispatches_work_idx ON integrations.integration_dispatches(tenant_id,status,next_attempt_at,created_at,id) WHERE status IN ('QUEUED','RETRY_SCHEDULED');
CREATE INDEX integration_dispatches_reconciliation_idx ON integrations.integration_dispatches(tenant_id,status,last_reconciled_at,id) WHERE status IN ('UNKNOWN_OUTCOME','RECONCILIATION_REQUIRED');
CREATE INDEX integration_dispatches_internal_idx ON integrations.integration_dispatches(tenant_id,internal_entity_type,internal_entity_id,created_at DESC);
CREATE INDEX integration_dispatches_correlation_idx ON integrations.integration_dispatches(tenant_id,correlation_id,created_at,id);
CREATE INDEX integration_dispatches_integration_fk_idx ON integrations.integration_dispatches(tenant_id,company_id,integration_id);
CREATE INDEX integration_dispatch_attempts_dispatch_fk_idx ON integrations.integration_dispatch_attempts(tenant_id,company_id,integration_dispatch_id,dispatch_class);
CREATE INDEX integration_dispatch_attempts_provider_operation_idx ON integrations.integration_dispatch_attempts(tenant_id,provider_operation_reference) WHERE provider_operation_reference IS NOT NULL;
CREATE INDEX integration_dispatch_attempts_unknown_idx ON integrations.integration_dispatch_attempts(tenant_id,started_at,id) WHERE status='UNKNOWN_OUTCOME';
CREATE INDEX external_webhook_receipts_work_idx ON integrations.external_webhook_receipts(tenant_id,processing_status,next_attempt_at,received_at,id) WHERE processing_status IN ('RECEIVED','PENDING','RETRY_SCHEDULED');
CREATE INDEX external_webhook_receipts_integration_fk_idx ON integrations.external_webhook_receipts(tenant_id,company_id,integration_id);
CREATE INDEX external_webhook_receipts_provider_event_idx ON integrations.external_webhook_receipts(tenant_id,integration_id,provider_event_id) WHERE provider_event_id IS NOT NULL;
CREATE INDEX external_webhook_receipts_received_idx ON integrations.external_webhook_receipts(tenant_id,received_at,id);
CREATE INDEX external_webhook_receipts_dead_letter_idx ON integrations.external_webhook_receipts(tenant_id,received_at,id) WHERE processing_status='DEAD_LETTER';
CREATE INDEX provider_rate_limit_policies_lookup_idx ON integrations.provider_rate_limit_policies(provider_id,scope_type,tenant_id,company_id,integration_id,endpoint_class,status,valid_from DESC);
CREATE INDEX provider_rate_limit_policies_tenant_fk_idx ON integrations.provider_rate_limit_policies(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX provider_rate_limit_policies_company_fk_idx ON integrations.provider_rate_limit_policies(tenant_id,company_id) WHERE company_id IS NOT NULL;
CREATE INDEX provider_rate_limit_policies_integration_provider_fk_idx ON integrations.provider_rate_limit_policies(tenant_id,company_id,integration_id,provider_id) WHERE integration_id IS NOT NULL;
CREATE INDEX provider_verification_evidence_adapter_idx ON integrations.provider_verification_evidence(provider_adapter_version_id,evidence_level,result,executed_at DESC);
CREATE INDEX provider_verification_evidence_adapter_fk_idx ON integrations.provider_verification_evidence(provider_id,provider_adapter_version_id);
CREATE INDEX provider_verification_evidence_integration_idx ON integrations.provider_verification_evidence(tenant_id,company_id,integration_id,provider_adapter_version_id,environment,executed_at DESC) WHERE scope_type='INTEGRATION';
CREATE INDEX provider_verification_evidence_registrar_fk_idx ON integrations.provider_verification_evidence(registered_by_actor_id);
CREATE INDEX provider_verification_evidence_reviewer_fk_idx ON integrations.provider_verification_evidence(reviewed_by_actor_id) WHERE reviewed_by_actor_id IS NOT NULL;
CREATE INDEX provider_verification_evidence_expiry_idx ON integrations.provider_verification_evidence(expires_at,provider_adapter_version_id) WHERE expires_at IS NOT NULL;

CREATE TRIGGER provider_registry_update_guard BEFORE UPDATE ON integrations.provider_registry FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('display_name,integration_class,status,official_reference_uri,updated_at,version');
CREATE TRIGGER provider_adapter_versions_update_guard BEFORE UPDATE ON integrations.provider_adapter_versions FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('implementation_status,verification_status,released_at,retired_at');
CREATE TRIGGER provider_adapter_versions_promotion_guard BEFORE UPDATE OF verification_status ON integrations.provider_adapter_versions FOR EACH ROW EXECUTE FUNCTION integrations.guard_adapter_verification_promotion();
CREATE TRIGGER provider_capability_declarations_update_guard BEFORE UPDATE ON integrations.provider_capability_declarations FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('support_status,official_reference_uri,verified_at,version');
CREATE TRIGGER provider_platform_configurations_update_guard BEFORE UPDATE ON integrations.provider_platform_configurations FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('configuration_payload,status,valid_from,valid_until,published_at,updated_at,row_version');
CREATE TRIGGER external_integrations_insert_guard BEFORE INSERT ON integrations.external_integrations FOR EACH ROW EXECUTE FUNCTION integrations.guard_initial_status('CREATED,CREDENTIALS_CONFIGURED');
CREATE TRIGGER external_integrations_provider_snapshot_guard BEFORE INSERT OR UPDATE OF provider_id,provider_code_snapshot ON integrations.external_integrations FOR EACH ROW EXECUTE FUNCTION integrations.guard_provider_snapshot();
CREATE TRIGGER external_integrations_update_guard BEFORE UPDATE ON integrations.external_integrations FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('status,configuration_version,provider_account_reference,last_health_check_at,last_success_at,last_failure_at,activated_at,disabled_at,updated_at,version');
CREATE TRIGGER external_integrations_state_guard BEFORE UPDATE OF status ON integrations.external_integrations FOR EACH ROW EXECUTE FUNCTION integrations.guard_state_transition('status','EXTERNAL_INTEGRATION','CREATED>CREDENTIALS_CONFIGURED,CREATED>DISABLED,CREATED>ERROR,CREDENTIALS_CONFIGURED>AUTHENTICATED,CREDENTIALS_CONFIGURED>CREDENTIAL_ROTATION_REQUIRED,CREDENTIALS_CONFIGURED>DISABLED,CREDENTIALS_CONFIGURED>ERROR,AUTHENTICATED>DISCOVERING,AUTHENTICATED>DISABLED,AUTHENTICATED>CREDENTIAL_ROTATION_REQUIRED,AUTHENTICATED>ERROR,DISCOVERING>DISCOVERY_COMPLETE,DISCOVERING>MAPPING_REQUIRED,DISCOVERING>ERROR,DISCOVERY_COMPLETE>MAPPING_REQUIRED,DISCOVERY_COMPLETE>READY_FOR_REVIEW,DISCOVERY_COMPLETE>ERROR,MAPPING_REQUIRED>READY_FOR_REVIEW,MAPPING_REQUIRED>ERROR,READY_FOR_REVIEW>ACTIVE,READY_FOR_REVIEW>DISABLED,READY_FOR_REVIEW>ERROR,ACTIVE>DEGRADED,ACTIVE>DISABLED,ACTIVE>CREDENTIAL_ROTATION_REQUIRED,ACTIVE>ERROR,DEGRADED>ACTIVE,DEGRADED>DISABLED,DEGRADED>CREDENTIAL_ROTATION_REQUIRED,DEGRADED>ERROR,CREDENTIAL_ROTATION_REQUIRED>CREDENTIALS_CONFIGURED,CREDENTIAL_ROTATION_REQUIRED>AUTHENTICATED,CREDENTIAL_ROTATION_REQUIRED>DISABLED,CREDENTIAL_ROTATION_REQUIRED>ERROR,ERROR>CREDENTIALS_CONFIGURED,ERROR>DISABLED');
CREATE TRIGGER integration_credential_bindings_insert_guard BEFORE INSERT ON integrations.integration_credential_bindings FOR EACH ROW EXECUTE FUNCTION integrations.guard_initial_status('PENDING');
CREATE TRIGGER integration_credential_bindings_update_guard BEFORE UPDATE ON integrations.integration_credential_bindings FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('status,activated_at,rotation_due_at,superseded_at,revoked_at,version');
CREATE TRIGGER integration_credential_bindings_state_guard BEFORE UPDATE OF status ON integrations.integration_credential_bindings FOR EACH ROW EXECUTE FUNCTION integrations.guard_state_transition('status','DEFAULT','PENDING>ACTIVE,PENDING>REVOKED,ACTIVE>SUPERSEDED,ACTIVE>REVOKED');
CREATE TRIGGER resource_ownership_policies_update_guard BEFORE UPDATE ON integrations.resource_ownership_policies FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('status,effective_until');
CREATE TRIGGER integration_capabilities_update_guard BEFORE UPDATE ON integrations.integration_capabilities FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('support_status,ownership_policy_id,effective_until,source_reference_uri,verified_at,version');
CREATE TRIGGER integration_capabilities_declaration_guard BEFORE INSERT OR UPDATE OF support_status ON integrations.integration_capabilities FOR EACH ROW EXECUTE FUNCTION integrations.guard_capability_declaration();
CREATE TRIGGER integration_discovery_runs_update_guard BEFORE UPDATE ON integrations.integration_discovery_runs FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('status,started_at,completed_at,item_count,reviewed_item_count,error_code,evidence_reference,updated_at,version');
CREATE TRIGGER integration_discovery_runs_state_guard BEFORE UPDATE OF status ON integrations.integration_discovery_runs FOR EACH ROW EXECUTE FUNCTION integrations.guard_state_transition('status','DEFAULT','CREATED>RUNNING,CREATED>CANCELLED,CREATED>FAILED,RUNNING>COMPLETED,RUNNING>PARTIAL,RUNNING>FAILED,RUNNING>CANCELLED');
CREATE TRIGGER integration_discovery_items_update_guard BEFORE UPDATE ON integrations.integration_discovery_items FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('review_status,proposed_internal_entity_type,proposed_internal_entity_id,updated_at,version');
CREATE TRIGGER integration_discovery_items_state_guard BEFORE UPDATE OF review_status ON integrations.integration_discovery_items FOR EACH ROW EXECUTE FUNCTION integrations.guard_state_transition('review_status','DEFAULT','PENDING>PROPOSED,PENDING>ACCEPTED,PENDING>REJECTED,PENDING>CONFLICT,PROPOSED>ACCEPTED,PROPOSED>REJECTED,PROPOSED>CONFLICT,CONFLICT>ACCEPTED,CONFLICT>REJECTED');
CREATE TRIGGER external_reference_mappings_update_guard BEFORE UPDATE ON integrations.external_reference_mappings FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('mapping_status,verified_at,verified_by_actor_id,updated_at,version');
CREATE TRIGGER external_reference_mappings_state_guard BEFORE UPDATE OF mapping_status ON integrations.external_reference_mappings FOR EACH ROW EXECUTE FUNCTION integrations.guard_state_transition('mapping_status','DEFAULT','PROPOSED>VERIFIED,PROPOSED>ACTIVE,PROPOSED>CONFLICT,PROPOSED>STALE,PROPOSED>RETIRED,VERIFIED>ACTIVE,VERIFIED>CONFLICT,VERIFIED>STALE,VERIFIED>RETIRED,ACTIVE>CONFLICT,ACTIVE>STALE,ACTIVE>RETIRED,CONFLICT>VERIFIED,CONFLICT>ACTIVE,CONFLICT>STALE,CONFLICT>RETIRED,STALE>VERIFIED,STALE>ACTIVE,STALE>CONFLICT,STALE>RETIRED');
CREATE TRIGGER integration_dispatches_insert_guard BEFORE INSERT ON integrations.integration_dispatches FOR EACH ROW EXECUTE FUNCTION integrations.guard_initial_status('QUEUED');
CREATE TRIGGER integration_dispatches_capability_guard BEFORE INSERT ON integrations.integration_dispatches FOR EACH ROW EXECUTE FUNCTION integrations.guard_dispatch_capability();
CREATE TRIGGER integration_dispatches_update_guard BEFORE UPDATE ON integrations.integration_dispatches FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('status,provider_request_reference,retry_classification,next_attempt_at,last_reconciled_at,updated_at,version');
CREATE TRIGGER integration_dispatches_state_guard BEFORE UPDATE OF status ON integrations.integration_dispatches FOR EACH ROW EXECUTE FUNCTION integrations.guard_state_transition('status','DISPATCH','QUEUED>DISPATCHING,QUEUED>CANCELLED,DISPATCHING>SUCCEEDED,DISPATCHING>RETRY_SCHEDULED,DISPATCHING>UNKNOWN_OUTCOME,DISPATCHING>PERMANENT_FAILURE,RETRY_SCHEDULED>DISPATCHING,RETRY_SCHEDULED>CANCELLED,UNKNOWN_OUTCOME>RECONCILIATION_REQUIRED,UNKNOWN_OUTCOME>SUCCEEDED,UNKNOWN_OUTCOME>PERMANENT_FAILURE,RECONCILIATION_REQUIRED>SUCCEEDED,RECONCILIATION_REQUIRED>RETRY_SCHEDULED,RECONCILIATION_REQUIRED>PERMANENT_FAILURE,RECONCILIATION_REQUIRED>DEAD_LETTER,PERMANENT_FAILURE>DEAD_LETTER');
CREATE TRIGGER integration_dispatch_attempts_insert_guard BEFORE INSERT ON integrations.integration_dispatch_attempts FOR EACH ROW EXECUTE FUNCTION integrations.guard_initial_status('CREATED');
CREATE TRIGGER integration_dispatch_attempts_update_guard BEFORE UPDATE ON integrations.integration_dispatch_attempts FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('status,transport_status,http_status,provider_operation_reference,provider_response_reference,retry_after_at,finished_at,diagnostic_reference,version');
CREATE TRIGGER integration_dispatch_attempts_state_guard BEFORE UPDATE OF status ON integrations.integration_dispatch_attempts FOR EACH ROW EXECUTE FUNCTION integrations.guard_state_transition('status','DEFAULT','CREATED>IN_PROGRESS,CREATED>CANCELLED,IN_PROGRESS>SUCCEEDED,IN_PROGRESS>FAILED,IN_PROGRESS>UNKNOWN_OUTCOME,IN_PROGRESS>CANCELLED,UNKNOWN_OUTCOME>SUCCEEDED,UNKNOWN_OUTCOME>FAILED');
CREATE TRIGGER external_webhook_receipts_insert_guard BEFORE INSERT ON integrations.external_webhook_receipts FOR EACH ROW EXECUTE FUNCTION integrations.guard_initial_status('RECEIVED,REJECTED,PENDING');
CREATE TRIGGER external_webhook_receipts_update_guard BEFORE UPDATE ON integrations.external_webhook_receipts FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('processing_status,attempt_count,next_attempt_at,last_error_code,processed_at,version');
CREATE TRIGGER external_webhook_receipts_state_guard BEFORE UPDATE OF processing_status ON integrations.external_webhook_receipts FOR EACH ROW EXECUTE FUNCTION integrations.guard_state_transition('processing_status','DEFAULT','RECEIVED>PENDING,RECEIVED>PROCESSING,RECEIVED>REJECTED,PENDING>PROCESSING,PENDING>REJECTED,PROCESSING>PROCESSED,PROCESSING>RETRY_SCHEDULED,PROCESSING>DEAD_LETTER,RETRY_SCHEDULED>PROCESSING,RETRY_SCHEDULED>DEAD_LETTER');
CREATE TRIGGER provider_rate_limit_policies_publication_guard BEFORE INSERT OR UPDATE ON integrations.provider_rate_limit_policies FOR EACH ROW EXECUTE FUNCTION integrations.guard_rate_policy_publication();
CREATE TRIGGER provider_verification_evidence_review_guard BEFORE UPDATE ON integrations.provider_verification_evidence FOR EACH ROW EXECUTE FUNCTION integrations.guard_verification_evidence_review();
CREATE CONSTRAINT TRIGGER external_integrations_active_binding_guard AFTER INSERT OR UPDATE OF status ON integrations.external_integrations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION integrations.guard_exactly_one_active_binding();
CREATE CONSTRAINT TRIGGER integration_credential_bindings_exactly_one_guard AFTER INSERT OR UPDATE OF status ON integrations.integration_credential_bindings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION integrations.guard_exactly_one_active_binding();

ALTER TABLE integrations.external_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.integration_credential_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.resource_ownership_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.integration_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.integration_discovery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.integration_discovery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.external_reference_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.integration_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.integration_dispatch_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.external_webhook_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.provider_rate_limit_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.provider_verification_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY external_integrations_tenant_isolation ON integrations.external_integrations TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY integration_credential_bindings_tenant_isolation ON integrations.integration_credential_bindings TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY resource_ownership_policies_tenant_isolation ON integrations.resource_ownership_policies TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY integration_capabilities_tenant_isolation ON integrations.integration_capabilities TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY integration_discovery_runs_tenant_isolation ON integrations.integration_discovery_runs TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY integration_discovery_items_tenant_isolation ON integrations.integration_discovery_items TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY external_reference_mappings_tenant_isolation ON integrations.external_reference_mappings TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY integration_dispatches_tenant_isolation ON integrations.integration_dispatches TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY integration_dispatch_attempts_tenant_isolation ON integrations.integration_dispatch_attempts TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY external_webhook_receipts_tenant_isolation ON integrations.external_webhook_receipts TO pos_app,pos_worker,pos_platform_app USING (tenant_id=platform.current_tenant_id()) WITH CHECK (tenant_id=platform.current_tenant_id());
CREATE POLICY provider_rate_limit_policies_runtime_global_select ON integrations.provider_rate_limit_policies FOR SELECT TO pos_app,pos_worker USING (scope_type='PROVIDER' AND status='PUBLISHED' AND valid_from<=transaction_timestamp() AND (valid_until IS NULL OR transaction_timestamp()<valid_until));
CREATE POLICY provider_rate_limit_policies_worker_tenant_select ON integrations.provider_rate_limit_policies FOR SELECT TO pos_worker USING (scope_type<>'PROVIDER' AND tenant_id=platform.current_tenant_id() AND status='PUBLISHED' AND valid_from<=transaction_timestamp() AND (valid_until IS NULL OR transaction_timestamp()<valid_until));
CREATE POLICY provider_rate_limit_policies_app_tenant_select ON integrations.provider_rate_limit_policies FOR SELECT TO pos_app USING (scope_type<>'PROVIDER' AND tenant_id=platform.current_tenant_id());
CREATE POLICY provider_rate_limit_policies_app_tenant_insert ON integrations.provider_rate_limit_policies FOR INSERT TO pos_app WITH CHECK (scope_type IN ('TENANT','COMPANY','INTEGRATION') AND tenant_id=platform.current_tenant_id());
CREATE POLICY provider_rate_limit_policies_app_tenant_update ON integrations.provider_rate_limit_policies FOR UPDATE TO pos_app USING (scope_type<>'PROVIDER' AND tenant_id=platform.current_tenant_id()) WITH CHECK (scope_type<>'PROVIDER' AND tenant_id=platform.current_tenant_id());
CREATE POLICY provider_rate_limit_policies_platform_global ON integrations.provider_rate_limit_policies TO pos_platform_app USING (scope_type='PROVIDER') WITH CHECK (scope_type='PROVIDER');
CREATE POLICY provider_rate_limit_policies_platform_tenant ON integrations.provider_rate_limit_policies TO pos_platform_app USING (scope_type<>'PROVIDER' AND tenant_id=platform.current_tenant_id()) WITH CHECK (scope_type<>'PROVIDER' AND tenant_id=platform.current_tenant_id());
CREATE POLICY provider_verification_evidence_tenant_minimal_select ON integrations.provider_verification_evidence FOR SELECT TO pos_app USING (scope_type='INTEGRATION' AND tenant_id=platform.current_tenant_id());
CREATE POLICY provider_verification_evidence_platform_global ON integrations.provider_verification_evidence TO pos_platform_app USING (scope_type='GLOBAL') WITH CHECK (scope_type='GLOBAL');
CREATE POLICY provider_verification_evidence_platform_tenant ON integrations.provider_verification_evidence TO pos_platform_app USING (scope_type='INTEGRATION' AND tenant_id=platform.current_tenant_id()) WITH CHECK (scope_type='INTEGRATION' AND tenant_id=platform.current_tenant_id());

ALTER TABLE integrations.external_integrations FORCE ROW LEVEL SECURITY;
ALTER TABLE integrations.integration_credential_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE integrations.resource_ownership_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE integrations.integration_capabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE integrations.integration_discovery_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE integrations.integration_discovery_items FORCE ROW LEVEL SECURITY;
ALTER TABLE integrations.external_reference_mappings FORCE ROW LEVEL SECURITY;
ALTER TABLE integrations.integration_dispatches FORCE ROW LEVEL SECURITY;
ALTER TABLE integrations.integration_dispatch_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE integrations.external_webhook_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE integrations.provider_rate_limit_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE integrations.provider_verification_evidence FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA integrations TO pos_app,pos_worker,pos_platform_app,pos_platform_admin;
GRANT SELECT ON integrations.provider_registry,integrations.provider_adapter_versions,integrations.provider_capability_declarations TO pos_app,pos_worker,pos_platform_app,pos_platform_admin;
GRANT INSERT ON integrations.provider_registry,integrations.provider_adapter_versions,integrations.provider_capability_declarations TO pos_platform_app;
GRANT UPDATE (display_name,integration_class,status,official_reference_uri,updated_at,version) ON integrations.provider_registry TO pos_platform_app;
GRANT UPDATE (implementation_status,verification_status,released_at,retired_at) ON integrations.provider_adapter_versions TO pos_platform_app;
GRANT UPDATE (support_status,official_reference_uri,verified_at,version) ON integrations.provider_capability_declarations TO pos_platform_app;
GRANT SELECT (id,provider_id,environment,configuration_type,configuration_schema_version,status,valid_from,valid_until,published_at,created_at,updated_at,version,row_version) ON integrations.provider_platform_configurations TO pos_app,pos_platform_admin;
GRANT SELECT ON integrations.provider_platform_configurations TO pos_worker,pos_platform_app;
GRANT INSERT ON integrations.provider_platform_configurations TO pos_platform_app;
GRANT UPDATE (configuration_payload,status,valid_from,valid_until,published_at,updated_at,row_version) ON integrations.provider_platform_configurations TO pos_platform_app;
GRANT SELECT,INSERT ON integrations.external_integrations TO pos_app,pos_platform_app;
GRANT SELECT ON integrations.external_integrations TO pos_worker;
GRANT UPDATE (status,configuration_version,provider_account_reference,activated_at,disabled_at,updated_at,version) ON integrations.external_integrations TO pos_app,pos_platform_app;
GRANT UPDATE (status,last_health_check_at,last_success_at,last_failure_at,updated_at,version) ON integrations.external_integrations TO pos_worker;
GRANT SELECT (id,tenant_id,company_id,branch_id,provider_id,provider_code_snapshot,provider_adapter_version_id,environment,status,configuration_version,last_health_check_at,last_success_at,last_failure_at,activated_at,disabled_at,created_at,updated_at,version) ON integrations.external_integrations TO pos_platform_admin;
GRANT SELECT (id,tenant_id,company_id,integration_id,credential_kind,generation,status,activated_at,rotation_due_at,superseded_at,revoked_at,created_at,version) ON integrations.integration_credential_bindings TO pos_app,pos_platform_admin;
GRANT SELECT ON integrations.integration_credential_bindings TO pos_worker,pos_platform_app;
GRANT INSERT ON integrations.integration_credential_bindings TO pos_platform_app;
GRANT UPDATE (status,activated_at,rotation_due_at,superseded_at,revoked_at,version) ON integrations.integration_credential_bindings TO pos_platform_app;
GRANT SELECT,INSERT ON integrations.resource_ownership_policies,integrations.integration_capabilities TO pos_app,pos_platform_app;
GRANT SELECT ON integrations.resource_ownership_policies,integrations.integration_capabilities TO pos_worker,pos_platform_admin;
GRANT UPDATE (status,effective_until) ON integrations.resource_ownership_policies TO pos_app,pos_platform_app;
GRANT UPDATE (support_status,ownership_policy_id,effective_until,source_reference_uri,verified_at,version) ON integrations.integration_capabilities TO pos_app,pos_platform_app;
GRANT SELECT,INSERT ON integrations.integration_discovery_runs TO pos_app,pos_platform_app;
GRANT SELECT ON integrations.integration_discovery_runs TO pos_worker;
GRANT UPDATE (status,reviewed_item_count,updated_at,version) ON integrations.integration_discovery_runs TO pos_app,pos_platform_app;
GRANT UPDATE (status,started_at,completed_at,item_count,error_code,evidence_reference,updated_at,version) ON integrations.integration_discovery_runs TO pos_worker;
GRANT SELECT (id,tenant_id,company_id,integration_id,provider_adapter_version_id,discovery_type,status,idempotency_key,request_checksum,correlation_id,started_at,completed_at,item_count,reviewed_item_count,error_code,created_at,updated_at,version) ON integrations.integration_discovery_runs TO pos_platform_admin;
GRANT SELECT,INSERT ON integrations.integration_discovery_items TO pos_worker;
GRANT SELECT,UPDATE (review_status,proposed_internal_entity_type,proposed_internal_entity_id,updated_at,version) ON integrations.integration_discovery_items TO pos_app,pos_platform_app;
GRANT SELECT (id,tenant_id,company_id,integration_id,discovery_run_id,resource_type,external_id,provider_checksum,review_status,metadata_schema_version,external_code,proposed_internal_entity_type,proposed_internal_entity_id,created_at,updated_at,version) ON integrations.integration_discovery_items TO pos_platform_admin;
GRANT SELECT,INSERT ON integrations.external_reference_mappings TO pos_app,pos_platform_app;
GRANT SELECT ON integrations.external_reference_mappings TO pos_worker;
GRANT UPDATE (mapping_status,verified_at,verified_by_actor_id,updated_at,version) ON integrations.external_reference_mappings TO pos_app,pos_platform_app;
GRANT SELECT (id,tenant_id,company_id,integration_id,resource_type,internal_entity_type,internal_entity_id,external_id,mapping_status,provider_metadata_schema_version,external_code,verified_at,verified_by_actor_id,supersedes_mapping_id,created_at,updated_at,version) ON integrations.external_reference_mappings TO pos_platform_admin;
GRANT SELECT,INSERT ON integrations.integration_dispatches TO pos_app,pos_platform_app;
GRANT SELECT ON integrations.integration_dispatches TO pos_worker;
GRANT UPDATE (status,updated_at,version) ON integrations.integration_dispatches TO pos_app,pos_platform_app;
GRANT UPDATE (status,provider_request_reference,retry_classification,next_attempt_at,last_reconciled_at,updated_at,version) ON integrations.integration_dispatches TO pos_worker;
GRANT SELECT (id,tenant_id,company_id,integration_id,capability_code,dispatch_class,resource_type,internal_operation_id,internal_entity_type,internal_entity_id,idempotency_key,payload_schema_version,payload_checksum,status,correlation_id,retry_classification,next_attempt_at,last_reconciled_at,causation_id,created_at,updated_at,version) ON integrations.integration_dispatches TO pos_platform_admin;
GRANT SELECT ON integrations.integration_dispatch_attempts TO pos_app,pos_worker,pos_platform_app;
GRANT INSERT ON integrations.integration_dispatch_attempts TO pos_worker;
GRANT UPDATE (status,transport_status,http_status,provider_operation_reference,provider_response_reference,retry_after_at,finished_at,diagnostic_reference,version) ON integrations.integration_dispatch_attempts TO pos_worker;
GRANT SELECT (id,tenant_id,company_id,integration_dispatch_id,dispatch_class,attempt_number,status,request_id,started_at,transport_status,http_status,provider_operation_reference,retry_after_at,finished_at,created_at,version) ON integrations.integration_dispatch_attempts TO pos_platform_admin;
GRANT SELECT ON integrations.external_webhook_receipts TO pos_app,pos_worker,pos_platform_app;
GRANT INSERT ON integrations.external_webhook_receipts TO pos_platform_app;
GRANT UPDATE (processing_status,attempt_count,next_attempt_at,last_error_code,processed_at,version) ON integrations.external_webhook_receipts TO pos_worker;
GRANT SELECT (id,tenant_id,company_id,integration_id,deduplication_key,received_at,payload_schema_version,payload_checksum,authentication_verification_result,replay_verification_result,processing_status,attempt_count,correlation_id,provider_event_id,next_attempt_at,last_error_code,processed_at,created_at,version) ON integrations.external_webhook_receipts TO pos_platform_admin;
GRANT SELECT (id,provider_id,scope_type,tenant_id,company_id,integration_id,endpoint_class,retry_after_mode,backoff_policy_code,status,valid_from,version,request_limit,window_seconds,concurrency_limit,cooldown_seconds,valid_until) ON integrations.provider_rate_limit_policies TO pos_app,pos_worker;
GRANT SELECT,INSERT ON integrations.provider_rate_limit_policies TO pos_platform_app;
GRANT INSERT ON integrations.provider_rate_limit_policies TO pos_app;
GRANT UPDATE (request_limit,window_seconds,concurrency_limit,retry_after_mode,backoff_policy_code,cooldown_seconds,status,valid_from,valid_until,published_at,row_version) ON integrations.provider_rate_limit_policies TO pos_app,pos_platform_app;
GRANT SELECT (id,provider_id,scope_type,tenant_id,company_id,integration_id,endpoint_class,retry_after_mode,backoff_policy_code,status,valid_from,version,row_version,request_limit,window_seconds,concurrency_limit,cooldown_seconds,valid_until,published_at) ON integrations.provider_rate_limit_policies TO pos_platform_admin;
GRANT SELECT (id,provider_id,provider_adapter_version_id,scope_type,tenant_id,company_id,integration_id,environment,evidence_level,test_suite_version,source_commit,executed_at,result,expires_at,created_at) ON integrations.provider_verification_evidence TO pos_app;
GRANT SELECT ON integrations.provider_verification_evidence TO pos_platform_app;
GRANT INSERT (id,provider_id,provider_adapter_version_id,scope_type,environment,evidence_level,test_suite_version,source_commit,executed_at,result,evidence_reference,evidence_checksum,registered_by_actor_id,created_at,tenant_id,company_id,integration_id,authorized_account_reference,expires_at) ON integrations.provider_verification_evidence TO pos_platform_app;
GRANT UPDATE (reviewed_by_actor_id,reviewed_at) ON integrations.provider_verification_evidence TO pos_platform_app;
GRANT SELECT (id,provider_id,provider_adapter_version_id,scope_type,environment,evidence_level,test_suite_version,source_commit,executed_at,result,registered_by_actor_id,created_at,tenant_id,company_id,integration_id,reviewed_by_actor_id,reviewed_at,expires_at) ON integrations.provider_verification_evidence TO pos_platform_admin;

ALTER FUNCTION integrations.guard_allowed_update_columns() OWNER TO pos_schema_owner;
ALTER FUNCTION integrations.guard_allowed_update_columns() SET search_path=pg_catalog,integrations;
ALTER FUNCTION integrations.guard_initial_status() OWNER TO pos_schema_owner;
ALTER FUNCTION integrations.guard_initial_status() SET search_path=pg_catalog,integrations;
ALTER FUNCTION integrations.guard_rate_policy_publication() OWNER TO pos_schema_owner;
ALTER FUNCTION integrations.guard_rate_policy_publication() SET search_path=pg_catalog,integrations;
ALTER FUNCTION integrations.guard_verification_evidence_review() OWNER TO pos_schema_owner;
ALTER FUNCTION integrations.guard_verification_evidence_review() SET search_path=pg_catalog,integrations;
ALTER FUNCTION integrations.guard_provider_snapshot() OWNER TO pos_schema_owner;
ALTER FUNCTION integrations.guard_provider_snapshot() SET search_path=pg_catalog,integrations;
ALTER FUNCTION integrations.guard_capability_declaration() OWNER TO pos_schema_owner;
ALTER FUNCTION integrations.guard_capability_declaration() SET search_path=pg_catalog,integrations;
ALTER FUNCTION integrations.guard_dispatch_capability() OWNER TO pos_schema_owner;
ALTER FUNCTION integrations.guard_dispatch_capability() SET search_path=pg_catalog,integrations;
ALTER FUNCTION integrations.guard_exactly_one_active_binding() OWNER TO pos_schema_owner;
ALTER FUNCTION integrations.guard_exactly_one_active_binding() SET search_path=pg_catalog,integrations;
ALTER FUNCTION integrations.guard_adapter_verification_promotion() OWNER TO pos_schema_owner;
ALTER FUNCTION integrations.guard_adapter_verification_promotion() SET search_path=pg_catalog,integrations;
ALTER FUNCTION integrations.guard_state_transition() OWNER TO pos_schema_owner;
ALTER FUNCTION integrations.guard_state_transition() SET search_path=pg_catalog,integrations;
REVOKE ALL ON ALL TABLES IN SCHEMA integrations FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA integrations FROM PUBLIC;

CREATE SCHEMA identity AUTHORIZATION pos_schema_owner;
CREATE SCHEMA tenancy AUTHORIZATION pos_schema_owner;
CREATE SCHEMA organization AUTHORIZATION pos_schema_owner;
CREATE SCHEMA "authorization" AUTHORIZATION pos_schema_owner;
CREATE SCHEMA sync AUTHORIZATION pos_schema_owner;
CREATE SCHEMA audit AUTHORIZATION pos_schema_owner;

CREATE FUNCTION platform.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  raw_value text;
BEGIN
  raw_value := current_setting('app.tenant_id', true);
  IF raw_value IS NULL OR btrim(raw_value) = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN raw_value::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
END;
$$;

CREATE TABLE identity.users (
  id uuid PRIMARY KEY CONSTRAINT users_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  email text NOT NULL CONSTRAINT users_email_ck CHECK (btrim(email) <> ''),
  email_normalized text NOT NULL CONSTRAINT users_email_normalized_ck CHECK (btrim(email_normalized) <> ''),
  phone text NULL,
  phone_normalized text NULL,
  full_name text NOT NULL CONSTRAINT users_full_name_ck CHECK (btrim(full_name) <> ''),
  status text NOT NULL CONSTRAINT users_status_ck CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT users_email_normalized_uq UNIQUE (email_normalized),
  CONSTRAINT users_phone_pair_ck CHECK ((phone IS NULL) = (phone_normalized IS NULL)),
  CONSTRAINT users_timestamps_ck CHECK (updated_at >= created_at),
  CONSTRAINT users_version_ck CHECK (version >= 1)
);

CREATE TABLE tenancy.tenants (
  id uuid PRIMARY KEY CONSTRAINT tenants_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  name text NOT NULL CONSTRAINT tenants_name_ck CHECK (btrim(name) <> ''),
  code text NULL,
  code_normalized text NULL,
  status text NOT NULL CONSTRAINT tenants_status_ck CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT tenants_id_uq UNIQUE (id),
  CONSTRAINT tenants_code_pair_ck CHECK ((code IS NULL) = (code_normalized IS NULL)),
  CONSTRAINT tenants_timestamps_ck CHECK (updated_at >= created_at),
  CONSTRAINT tenants_version_ck CHECK (version >= 1)
);

CREATE TABLE organization.companies (
  id uuid PRIMARY KEY CONSTRAINT companies_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  legal_name text NULL,
  trade_name text NOT NULL CONSTRAINT companies_trade_name_ck CHECK (btrim(trade_name) <> ''),
  tax_id text NULL,
  tax_id_normalized text NULL,
  email text NULL,
  phone text NULL,
  phone_normalized text NULL,
  timezone text NOT NULL CONSTRAINT companies_timezone_ck CHECK (btrim(timezone) <> ''),
  currency_code char(3) NOT NULL CONSTRAINT companies_currency_ck CHECK (currency_code ~ '^[A-Z]{3}$'),
  status text NOT NULL CONSTRAINT companies_status_ck CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT companies_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT companies_tax_id_pair_ck CHECK ((tax_id IS NULL) = (tax_id_normalized IS NULL)),
  CONSTRAINT companies_phone_pair_ck CHECK ((phone IS NULL) = (phone_normalized IS NULL)),
  CONSTRAINT companies_timestamps_ck CHECK (updated_at >= created_at),
  CONSTRAINT companies_version_ck CHECK (version >= 1)
);

CREATE TABLE organization.branches (
  id uuid PRIMARY KEY CONSTRAINT branches_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL CONSTRAINT branches_name_ck CHECK (btrim(name) <> ''),
  code text NULL,
  code_normalized text NULL,
  address text NULL,
  city text NULL,
  latitude numeric(9,6) NULL,
  longitude numeric(9,6) NULL,
  timezone text NOT NULL CONSTRAINT branches_timezone_ck CHECK (btrim(timezone) <> ''),
  status text NOT NULL CONSTRAINT branches_status_ck CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT branches_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT branches_tenant_company_id_id_uq UNIQUE (tenant_id, company_id, id),
  CONSTRAINT branches_code_pair_ck CHECK ((code IS NULL) = (code_normalized IS NULL)),
  CONSTRAINT branches_location_pair_ck CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT branches_latitude_ck CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT branches_longitude_ck CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT branches_timestamps_ck CHECK (updated_at >= created_at),
  CONSTRAINT branches_version_ck CHECK (version >= 1)
);

CREATE TABLE tenancy.tenant_memberships (
  id uuid PRIMARY KEY CONSTRAINT tenant_memberships_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  membership_type text NOT NULL CONSTRAINT tenant_memberships_type_ck CHECK (membership_type IN ('OWNER','ADMIN','MEMBER','SERVICE')),
  status text NOT NULL CONSTRAINT tenant_memberships_status_ck CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','REVOKED')),
  is_primary boolean NOT NULL DEFAULT false,
  created_by_actor_type text NOT NULL CONSTRAINT tenant_memberships_actor_type_ck CHECK (created_by_actor_type IN ('USER','PLATFORM_ACCOUNT','SYSTEM')),
  created_by_actor_id uuid NULL,
  created_at timestamptz NOT NULL,
  activated_at timestamptz NULL,
  suspended_at timestamptz NULL,
  revoked_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT tenant_memberships_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT tenant_memberships_user_id_id_uq UNIQUE (user_id, id),
  CONSTRAINT tenant_memberships_owner_reference_uq UNIQUE (tenant_id, user_id, id, membership_type),
  CONSTRAINT tenant_memberships_actor_ck CHECK ((created_by_actor_type = 'SYSTEM') = (created_by_actor_id IS NULL)),
  CONSTRAINT tenant_memberships_timestamps_ck CHECK (
    (status = 'PENDING' AND activated_at IS NULL AND suspended_at IS NULL AND revoked_at IS NULL)
    OR (status = 'ACTIVE' AND activated_at IS NOT NULL AND suspended_at IS NULL AND revoked_at IS NULL)
    OR (status = 'SUSPENDED' AND activated_at IS NOT NULL AND suspended_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT tenant_memberships_version_ck CHECK (version >= 1)
);

CREATE TABLE identity.user_credentials (
  id uuid PRIMARY KEY CONSTRAINT user_credentials_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  user_id uuid NOT NULL,
  credential_type text NOT NULL CONSTRAINT user_credentials_type_ck CHECK (credential_type = 'PASSWORD'),
  verifier text NOT NULL CONSTRAINT user_credentials_verifier_ck CHECK (btrim(verifier) <> ''),
  status text NOT NULL CONSTRAINT user_credentials_status_ck CHECK (status IN ('ACTIVE','RETIRED','REVOKED')),
  failed_attempt_count integer NOT NULL DEFAULT 0 CONSTRAINT user_credentials_failed_count_ck CHECK (failed_attempt_count >= 0),
  locked_until timestamptz NULL,
  created_at timestamptz NOT NULL,
  rotated_at timestamptz NULL,
  last_used_at timestamptz NULL,
  revoked_at timestamptz NULL,
  retained_until timestamptz NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT user_credentials_state_ck CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL)
    OR (status = 'RETIRED' AND rotated_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT user_credentials_version_ck CHECK (version >= 1)
);

CREATE TABLE identity.mfa_factors (
  id uuid PRIMARY KEY CONSTRAINT mfa_factors_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  user_id uuid NOT NULL,
  factor_type text NOT NULL CONSTRAINT mfa_factors_type_ck CHECK (btrim(factor_type) <> ''),
  secret_reference text NULL,
  status text NOT NULL CONSTRAINT mfa_factors_status_ck CHECK (status IN ('PENDING','ACTIVE','REVOKED')),
  enrolled_at timestamptz NOT NULL,
  verified_at timestamptz NULL,
  last_used_at timestamptz NULL,
  revoked_at timestamptz NULL,
  retained_until timestamptz NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT mfa_factors_secret_reference_ck CHECK (secret_reference IS NULL OR btrim(secret_reference) <> ''),
  CONSTRAINT mfa_factors_state_ck CHECK (
    (status = 'PENDING' AND revoked_at IS NULL)
    OR (status = 'ACTIVE' AND verified_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT mfa_factors_version_ck CHECK (version >= 1)
);

CREATE TABLE "authorization".roles (
  id uuid PRIMARY KEY CONSTRAINT roles_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  code text NOT NULL CONSTRAINT roles_code_ck CHECK (btrim(code) <> ''),
  name text NOT NULL CONSTRAINT roles_name_ck CHECK (btrim(name) <> ''),
  scope_type text NOT NULL CONSTRAINT roles_scope_type_ck CHECK (scope_type IN ('PLATFORM','BUSINESS')),
  version bigint NOT NULL CONSTRAINT roles_version_ck CHECK (version >= 1),
  status text NOT NULL CONSTRAINT roles_status_ck CHECK (status IN ('ACTIVE','RETIRED')),
  created_at timestamptz NOT NULL,
  retired_at timestamptz NULL,
  CONSTRAINT roles_code_version_uq UNIQUE (code, version),
  CONSTRAINT roles_retired_ck CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL))
);

CREATE TABLE "authorization".permissions (
  id uuid PRIMARY KEY CONSTRAINT permissions_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  code text NOT NULL CONSTRAINT permissions_code_ck CHECK (btrim(code) <> ''),
  module text NOT NULL CONSTRAINT permissions_module_ck CHECK (btrim(module) <> ''),
  description text NOT NULL CONSTRAINT permissions_description_ck CHECK (btrim(description) <> ''),
  status text NOT NULL CONSTRAINT permissions_status_ck CHECK (status IN ('ACTIVE','RETIRED')),
  created_at timestamptz NOT NULL,
  retired_at timestamptz NULL,
  CONSTRAINT permissions_code_uq UNIQUE (code),
  CONSTRAINT permissions_retired_ck CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL))
);

CREATE TABLE "authorization".role_permission_grants (
  id uuid PRIMARY KEY CONSTRAINT role_permission_grants_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL,
  grant_version bigint NOT NULL CONSTRAINT role_permission_grants_version_ck CHECK (grant_version >= 1),
  status text NOT NULL CONSTRAINT role_permission_grants_status_ck CHECK (status IN ('ACTIVE','RETIRED')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NULL,
  created_at timestamptz NOT NULL,
  retired_at timestamptz NULL,
  CONSTRAINT role_permission_grants_role_permission_version_uq UNIQUE (role_id, permission_id, grant_version),
  CONSTRAINT role_permission_grants_range_ck CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT role_permission_grants_retired_ck CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL))
);

CREATE TABLE "authorization".authorization_policy_versions (
  id uuid PRIMARY KEY CONSTRAINT authorization_policy_versions_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  code text NOT NULL CONSTRAINT authorization_policy_versions_code_ck CHECK (btrim(code) <> ''),
  version bigint NOT NULL CONSTRAINT authorization_policy_versions_version_ck CHECK (version >= 1),
  ruleset_checksum text NOT NULL CONSTRAINT authorization_policy_versions_checksum_ck CHECK (ruleset_checksum ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CONSTRAINT authorization_policy_versions_status_ck CHECK (status IN ('ACTIVE','RETIRED')),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz NULL,
  created_at timestamptz NOT NULL,
  retired_at timestamptz NULL,
  CONSTRAINT authorization_policy_versions_code_version_uq UNIQUE (code, version),
  CONSTRAINT authorization_policy_versions_range_ck CHECK (effective_until IS NULL OR effective_until > effective_from),
  CONSTRAINT authorization_policy_versions_retired_ck CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL))
);

CREATE TABLE "authorization".user_role_assignments (
  id uuid PRIMARY KEY CONSTRAINT user_role_assignments_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  tenant_membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  company_id uuid NULL,
  branch_id uuid NULL,
  status text NOT NULL CONSTRAINT user_role_assignments_status_ck CHECK (status IN ('ACTIVE','REVOKED')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NULL,
  created_at timestamptz NOT NULL,
  created_by_actor_type text NOT NULL CONSTRAINT user_role_assignments_actor_type_ck CHECK (created_by_actor_type IN ('USER','PLATFORM_ACCOUNT','SYSTEM')),
  created_by_actor_id uuid NULL,
  revoked_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT user_role_assignments_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT user_role_assignments_branch_scope_ck CHECK (branch_id IS NULL OR company_id IS NOT NULL),
  CONSTRAINT user_role_assignments_actor_ck CHECK ((created_by_actor_type = 'SYSTEM') = (created_by_actor_id IS NULL)),
  CONSTRAINT user_role_assignments_range_ck CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT user_role_assignments_revoked_ck CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL)),
  CONSTRAINT user_role_assignments_version_ck CHECK (version >= 1)
);

CREATE TABLE identity.sessions (
  id uuid PRIMARY KEY CONSTRAINT sessions_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  user_id uuid NOT NULL,
  tenant_id uuid NULL,
  tenant_membership_id uuid NULL,
  device_id uuid NULL,
  authenticated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_reauthenticated_at timestamptz NULL,
  mfa_status text NOT NULL CONSTRAINT sessions_mfa_status_ck CHECK (mfa_status IN ('NOT_REQUIRED','PENDING','SATISFIED')),
  authorization_policy_version_id uuid NULL,
  offline_valid_until timestamptz NULL,
  revoked_at timestamptz NULL,
  revoked_by_actor_type text NULL,
  revoked_by_actor_id uuid NULL,
  revocation_reason text NULL,
  created_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT sessions_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT sessions_tenant_context_ck CHECK ((tenant_id IS NULL) = (tenant_membership_id IS NULL)),
  CONSTRAINT sessions_device_deferred_ck CHECK (device_id IS NULL),
  CONSTRAINT sessions_expiry_ck CHECK (expires_at > authenticated_at),
  CONSTRAINT sessions_offline_expiry_ck CHECK (offline_valid_until IS NULL OR offline_valid_until <= expires_at),
  CONSTRAINT sessions_revocation_ck CHECK (
    (revoked_at IS NULL AND revoked_by_actor_type IS NULL AND revoked_by_actor_id IS NULL AND revocation_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by_actor_type IN ('USER','PLATFORM_ACCOUNT','SYSTEM') AND btrim(revocation_reason) <> ''
      AND ((revoked_by_actor_type = 'SYSTEM' AND revoked_by_actor_id IS NULL) OR (revoked_by_actor_type <> 'SYSTEM' AND revoked_by_actor_id IS NOT NULL)))
  ),
  CONSTRAINT sessions_version_ck CHECK (version >= 1)
);

CREATE TABLE identity.session_refresh_tokens (
  id uuid PRIMARY KEY CONSTRAINT session_refresh_tokens_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  session_id uuid NOT NULL,
  token_family_id uuid NOT NULL CONSTRAINT session_refresh_tokens_family_v7_ck CHECK (platform.is_uuid_v7(token_family_id)),
  parent_token_id uuid NULL,
  token_hash text NOT NULL CONSTRAINT session_refresh_tokens_hash_ck CHECK (btrim(token_hash) <> ''),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  replacement_token_id uuid NULL,
  revoked_at timestamptz NULL,
  revocation_reason text NULL,
  reuse_detected_at timestamptz NULL,
  retained_until timestamptz NULL,
  CONSTRAINT session_refresh_tokens_hash_uq UNIQUE (token_hash),
  CONSTRAINT session_refresh_tokens_expiry_ck CHECK (expires_at > issued_at),
  CONSTRAINT session_refresh_tokens_revocation_ck CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL))
);

CREATE TABLE identity.security_events (
  id uuid PRIMARY KEY CONSTRAINT security_events_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  user_id uuid NULL,
  session_id uuid NULL,
  tenant_id uuid NULL,
  device_id uuid NULL,
  event_code text NOT NULL CONSTRAINT security_events_code_ck CHECK (btrim(event_code) <> ''),
  result text NOT NULL CONSTRAINT security_events_result_ck CHECK (btrim(result) <> ''),
  reason_code text NULL,
  ip_address inet NULL,
  evidence_checksum text NULL,
  correlation_id uuid NOT NULL CONSTRAINT security_events_correlation_v7_ck CHECK (platform.is_uuid_v7(correlation_id)),
  occurred_at timestamptz NOT NULL,
  server_recorded_at timestamptz NOT NULL,
  CONSTRAINT security_events_device_deferred_ck CHECK (device_id IS NULL),
  CONSTRAINT security_events_checksum_ck CHECK (evidence_checksum IS NULL OR evidence_checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT security_events_timestamps_ck CHECK (server_recorded_at >= occurred_at),
  CONSTRAINT security_events_tenant_session_ck CHECK (tenant_id IS NULL OR session_id IS NOT NULL)
);

CREATE TABLE tenancy.onboarding_operations (
  id uuid PRIMARY KEY CONSTRAINT onboarding_operations_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  actor_type text NOT NULL CONSTRAINT onboarding_operations_actor_type_ck CHECK (actor_type IN ('USER','PLATFORM_ACCOUNT')),
  actor_id uuid NOT NULL,
  idempotency_key text NOT NULL CONSTRAINT onboarding_operations_idempotency_key_ck CHECK (btrim(idempotency_key) <> ''),
  request_checksum text NOT NULL CONSTRAINT onboarding_operations_request_checksum_ck CHECK (request_checksum ~ '^[0-9a-f]{64}$'),
  correlation_id uuid NOT NULL CONSTRAINT onboarding_operations_correlation_v7_ck CHECK (platform.is_uuid_v7(correlation_id)),
  tenant_id uuid NULL,
  company_id uuid NULL,
  branch_id uuid NULL,
  owner_user_id uuid NULL,
  tenant_membership_id uuid NULL,
  owner_membership_type text GENERATED ALWAYS AS ('OWNER'::text) STORED,
  status text NOT NULL CONSTRAINT onboarding_operations_status_ck CHECK (status IN ('PENDING','IN_PROGRESS','REVIEW_REQUIRED','READY_FOR_LICENSE','READY_FOR_ACTIVATION','COMPLETED','FAILED','CANCELLED')),
  reason_code text NULL,
  license_reference text NULL,
  requested_plan text NULL,
  effective_plan text NULL,
  pricing_policy_version text NULL,
  tax_policy_version text NULL,
  rounding_policy_version text NULL,
  authorization_policy_version_id uuid NULL,
  required_action text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT onboarding_operations_identity_uq UNIQUE (actor_type, actor_id, idempotency_key),
  CONSTRAINT onboarding_operations_structural_group_ck CHECK (
    (tenant_id IS NULL AND company_id IS NULL AND branch_id IS NULL AND tenant_membership_id IS NULL)
    OR (tenant_id IS NOT NULL AND company_id IS NOT NULL AND branch_id IS NOT NULL AND tenant_membership_id IS NOT NULL AND owner_user_id IS NOT NULL)
  ),
  CONSTRAINT onboarding_operations_pending_ck CHECK (status <> 'PENDING' OR tenant_id IS NULL),
  CONSTRAINT onboarding_operations_ready_ck CHECK (status NOT IN ('READY_FOR_LICENSE','READY_FOR_ACTIVATION','COMPLETED') OR (tenant_id IS NOT NULL AND owner_user_id IS NOT NULL)),
  CONSTRAINT onboarding_operations_timestamps_ck CHECK (
    updated_at >= created_at
    AND ((status = 'COMPLETED') = (completed_at IS NOT NULL))
    AND ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
  ),
  CONSTRAINT onboarding_operations_version_ck CHECK (version >= 1)
);

CREATE TABLE sync.sync_operations (
  id uuid PRIMARY KEY CONSTRAINT sync_operations_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NULL,
  branch_id uuid NULL,
  source_kind text NOT NULL CONSTRAINT sync_operations_source_kind_ck CHECK (source_kind = 'CENTRAL_SERVICE'),
  device_id uuid NULL,
  installation_id uuid NULL,
  session_id uuid NULL,
  actor_type text NOT NULL CONSTRAINT sync_operations_actor_type_ck CHECK (btrim(actor_type) <> ''),
  actor_id uuid NULL,
  aggregate_type text NOT NULL CONSTRAINT sync_operations_aggregate_type_ck CHECK (btrim(aggregate_type) <> ''),
  aggregate_id uuid NOT NULL,
  operation_type text NOT NULL CONSTRAINT sync_operations_operation_type_ck CHECK (btrim(operation_type) <> ''),
  idempotency_key text NOT NULL CONSTRAINT sync_operations_idempotency_key_ck CHECK (btrim(idempotency_key) <> ''),
  expected_version bigint NULL,
  authority_policy text NOT NULL CONSTRAINT sync_operations_authority_policy_ck CHECK (authority_policy IN ('LOCAL_AUTHORITATIVE_UNTIL_SYNC','SERVER_AUTHORITATIVE','APPEND_ONLY_SHARED','CENTRAL_REVIEW_REQUIRED','EXTERNAL_PROVIDER_AUTHORITATIVE','DERIVED_PROJECTION')),
  parent_operation_id uuid NULL,
  causation_id uuid NULL,
  correlation_id uuid NOT NULL CONSTRAINT sync_operations_correlation_v7_ck CHECK (platform.is_uuid_v7(correlation_id)),
  schema_version integer NOT NULL CONSTRAINT sync_operations_schema_version_ck CHECK (schema_version >= 1),
  payload jsonb NOT NULL,
  payload_checksum bytea NOT NULL CONSTRAINT sync_operations_payload_checksum_ck CHECK (octet_length(payload_checksum) = 32),
  sync_status text NOT NULL CONSTRAINT sync_operations_status_ck CHECK (sync_status IN ('LOCAL_PENDING','READY_TO_SYNC','SYNCING','SERVER_ACCEPTED','SERVER_REJECTED','CONFLICT','WAITING_FOR_DEPENDENCY','RETRY_SCHEDULED','REVIEW_REQUIRED','DEAD_LETTER','ARCHIVED')),
  occurred_at_local timestamptz NULL,
  recorded_at_local timestamptz NULL,
  received_at_server timestamptz NULL,
  committed_at_server timestamptz NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT sync_operations_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT sync_operations_idempotency_uq UNIQUE (tenant_id, operation_type, idempotency_key),
  CONSTRAINT sync_operations_central_profile_ck CHECK (device_id IS NULL AND installation_id IS NULL AND occurred_at_local IS NULL AND recorded_at_local IS NULL),
  CONSTRAINT sync_operations_branch_scope_ck CHECK (branch_id IS NULL OR company_id IS NOT NULL),
  CONSTRAINT sync_operations_expected_version_ck CHECK (expected_version IS NULL OR expected_version >= 1),
  CONSTRAINT sync_operations_server_times_ck CHECK (committed_at_server IS NULL OR (received_at_server IS NOT NULL AND committed_at_server >= received_at_server)),
  CONSTRAINT sync_operations_version_ck CHECK (version >= 1)
);

CREATE TABLE sync.outbox_entries (
  id uuid PRIMARY KEY CONSTRAINT outbox_entries_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  device_id uuid NULL,
  local_sequence bigint NULL,
  operation_type text NOT NULL CONSTRAINT outbox_entries_operation_type_ck CHECK (btrim(operation_type) <> ''),
  schema_version integer NOT NULL CONSTRAINT outbox_entries_schema_version_ck CHECK (schema_version >= 1),
  payload_checksum bytea NOT NULL CONSTRAINT outbox_entries_payload_checksum_ck CHECK (octet_length(payload_checksum) = 32),
  correlation_id uuid NOT NULL CONSTRAINT outbox_entries_correlation_v7_ck CHECK (platform.is_uuid_v7(correlation_id)),
  causation_id uuid NULL,
  sync_status text NOT NULL CONSTRAINT outbox_entries_status_ck CHECK (sync_status IN ('LOCAL_PENDING','READY_TO_SYNC','SYNCING','SERVER_ACCEPTED','SERVER_REJECTED','CONFLICT','WAITING_FOR_DEPENDENCY','RETRY_SCHEDULED','REVIEW_REQUIRED','DEAD_LETTER','ARCHIVED')),
  created_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CONSTRAINT outbox_entries_attempt_count_ck CHECK (attempt_count >= 0),
  last_attempt_at timestamptz NULL,
  next_attempt_at timestamptz NULL,
  last_error_code text NULL,
  acknowledged_at timestamptz NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT outbox_entries_operation_id_uq UNIQUE (operation_id),
  CONSTRAINT outbox_entries_tenant_id_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT outbox_entries_tenant_operation_id_id_uq UNIQUE (tenant_id, operation_id, id),
  CONSTRAINT outbox_entries_central_profile_ck CHECK (device_id IS NULL AND local_sequence IS NULL),
  CONSTRAINT outbox_entries_timestamps_ck CHECK (available_at >= created_at AND updated_at >= created_at),
  CONSTRAINT outbox_entries_ack_ck CHECK (acknowledged_at IS NULL OR sync_status IN ('SERVER_ACCEPTED','SERVER_REJECTED','ARCHIVED')),
  CONSTRAINT outbox_entries_version_ck CHECK (version >= 1)
);

CREATE TABLE audit.audit_events (
  id uuid PRIMARY KEY CONSTRAINT audit_events_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NULL,
  company_id uuid NULL,
  branch_id uuid NULL,
  actor_type text NOT NULL CONSTRAINT audit_events_actor_type_ck CHECK (btrim(actor_type) <> ''),
  actor_id uuid NULL,
  session_id uuid NULL,
  device_id uuid NULL,
  action_code text NOT NULL CONSTRAINT audit_events_action_code_ck CHECK (btrim(action_code) <> ''),
  resource_type text NOT NULL CONSTRAINT audit_events_resource_type_ck CHECK (btrim(resource_type) <> ''),
  resource_reference_kind text NOT NULL CONSTRAINT audit_events_reference_kind_ck CHECK (resource_reference_kind IN ('INSTANCE','SYSTEM','BATCH')),
  resource_id uuid NULL,
  operation_id uuid NULL,
  correlation_id uuid NOT NULL CONSTRAINT audit_events_correlation_v7_ck CHECK (platform.is_uuid_v7(correlation_id)),
  causation_id uuid NULL,
  schema_version integer NOT NULL CONSTRAINT audit_events_schema_version_ck CHECK (schema_version >= 1),
  reported_at timestamptz NOT NULL,
  server_recorded_at timestamptz NOT NULL,
  result text NOT NULL CONSTRAINT audit_events_result_ck CHECK (btrim(result) <> ''),
  reason_code text NULL,
  reason_detail text NULL,
  previous_value jsonb NULL,
  new_value jsonb NULL,
  reviewer_actor_type text NULL,
  reviewer_actor_id uuid NULL,
  approver_actor_type text NULL,
  approver_actor_id uuid NULL,
  evidence_reference text NULL,
  evidence_checksum text NULL,
  payload_checksum text NOT NULL CONSTRAINT audit_events_payload_checksum_ck CHECK (payload_checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT audit_events_resource_reference_ck CHECK (
    (resource_reference_kind = 'INSTANCE' AND resource_id IS NOT NULL)
    OR (resource_reference_kind = 'SYSTEM' AND resource_id IS NULL)
    OR (resource_reference_kind = 'BATCH' AND resource_id IS NULL AND operation_id IS NOT NULL)
  ),
  CONSTRAINT audit_events_device_deferred_ck CHECK (device_id IS NULL),
  CONSTRAINT audit_events_company_scope_ck CHECK (company_id IS NULL OR tenant_id IS NOT NULL),
  CONSTRAINT audit_events_branch_scope_ck CHECK (branch_id IS NULL OR (tenant_id IS NOT NULL AND company_id IS NOT NULL)),
  CONSTRAINT audit_events_operation_scope_ck CHECK (operation_id IS NULL OR tenant_id IS NOT NULL),
  CONSTRAINT audit_events_reviewer_pair_ck CHECK ((reviewer_actor_type IS NULL) = (reviewer_actor_id IS NULL)),
  CONSTRAINT audit_events_approver_pair_ck CHECK ((approver_actor_type IS NULL) = (approver_actor_id IS NULL)),
  CONSTRAINT audit_events_evidence_pair_ck CHECK ((evidence_reference IS NULL) = (evidence_checksum IS NULL)),
  CONSTRAINT audit_events_evidence_checksum_ck CHECK (evidence_checksum IS NULL OR evidence_checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT audit_events_timestamps_ck CHECK (server_recorded_at >= reported_at)
);

ALTER TABLE organization.companies
  ADD CONSTRAINT companies_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id) ON DELETE NO ACTION;
ALTER TABLE organization.branches
  ADD CONSTRAINT branches_company_fk FOREIGN KEY (tenant_id, company_id) REFERENCES organization.companies(tenant_id, id) ON DELETE NO ACTION;
ALTER TABLE tenancy.tenant_memberships
  ADD CONSTRAINT tenant_memberships_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id) ON DELETE NO ACTION,
  ADD CONSTRAINT tenant_memberships_user_fk FOREIGN KEY (user_id) REFERENCES identity.users(id) ON DELETE NO ACTION;
ALTER TABLE identity.user_credentials
  ADD CONSTRAINT user_credentials_user_fk FOREIGN KEY (user_id) REFERENCES identity.users(id) ON DELETE NO ACTION;
ALTER TABLE identity.mfa_factors
  ADD CONSTRAINT mfa_factors_user_fk FOREIGN KEY (user_id) REFERENCES identity.users(id) ON DELETE NO ACTION;
ALTER TABLE "authorization".role_permission_grants
  ADD CONSTRAINT role_permission_grants_role_fk FOREIGN KEY (role_id) REFERENCES "authorization".roles(id) ON DELETE NO ACTION,
  ADD CONSTRAINT role_permission_grants_permission_fk FOREIGN KEY (permission_id) REFERENCES "authorization".permissions(id) ON DELETE NO ACTION;
ALTER TABLE "authorization".user_role_assignments
  ADD CONSTRAINT user_role_assignments_membership_fk FOREIGN KEY (tenant_id, tenant_membership_id) REFERENCES tenancy.tenant_memberships(tenant_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT user_role_assignments_role_fk FOREIGN KEY (role_id) REFERENCES "authorization".roles(id) ON DELETE NO ACTION,
  ADD CONSTRAINT user_role_assignments_company_fk FOREIGN KEY (tenant_id, company_id) REFERENCES organization.companies(tenant_id, id) MATCH SIMPLE ON DELETE NO ACTION,
  ADD CONSTRAINT user_role_assignments_branch_fk FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES organization.branches(tenant_id, company_id, id) MATCH SIMPLE ON DELETE NO ACTION;
ALTER TABLE identity.sessions
  ADD CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES identity.users(id) ON DELETE NO ACTION,
  ADD CONSTRAINT sessions_user_membership_fk FOREIGN KEY (user_id, tenant_membership_id) REFERENCES tenancy.tenant_memberships(user_id, id) MATCH SIMPLE ON DELETE NO ACTION,
  ADD CONSTRAINT sessions_tenant_membership_fk FOREIGN KEY (tenant_id, tenant_membership_id) REFERENCES tenancy.tenant_memberships(tenant_id, id) MATCH SIMPLE ON DELETE NO ACTION,
  ADD CONSTRAINT sessions_policy_fk FOREIGN KEY (authorization_policy_version_id) REFERENCES "authorization".authorization_policy_versions(id) ON DELETE NO ACTION;
ALTER TABLE identity.session_refresh_tokens
  ADD CONSTRAINT session_refresh_tokens_session_fk FOREIGN KEY (session_id) REFERENCES identity.sessions(id) ON DELETE NO ACTION;
ALTER TABLE identity.security_events
  ADD CONSTRAINT security_events_user_fk FOREIGN KEY (user_id) REFERENCES identity.users(id) ON DELETE NO ACTION,
  ADD CONSTRAINT security_events_session_fk FOREIGN KEY (session_id) REFERENCES identity.sessions(id) ON DELETE NO ACTION,
  ADD CONSTRAINT security_events_tenant_session_fk FOREIGN KEY (tenant_id, session_id) REFERENCES identity.sessions(tenant_id, id) MATCH SIMPLE ON DELETE NO ACTION;
ALTER TABLE tenancy.onboarding_operations
  ADD CONSTRAINT onboarding_operations_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id) ON DELETE NO ACTION,
  ADD CONSTRAINT onboarding_operations_company_fk FOREIGN KEY (tenant_id, company_id) REFERENCES organization.companies(tenant_id, id) MATCH SIMPLE ON DELETE NO ACTION,
  ADD CONSTRAINT onboarding_operations_branch_fk FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES organization.branches(tenant_id, company_id, id) MATCH SIMPLE ON DELETE NO ACTION,
  ADD CONSTRAINT onboarding_operations_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES identity.users(id) ON DELETE NO ACTION,
  ADD CONSTRAINT onboarding_operations_owner_membership_fk FOREIGN KEY (tenant_id, owner_user_id, tenant_membership_id, owner_membership_type) REFERENCES tenancy.tenant_memberships(tenant_id, user_id, id, membership_type) MATCH SIMPLE ON DELETE NO ACTION,
  ADD CONSTRAINT onboarding_operations_policy_fk FOREIGN KEY (authorization_policy_version_id) REFERENCES "authorization".authorization_policy_versions(id) ON DELETE NO ACTION;
ALTER TABLE sync.sync_operations
  ADD CONSTRAINT sync_operations_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id) ON DELETE NO ACTION,
  ADD CONSTRAINT sync_operations_company_fk FOREIGN KEY (tenant_id, company_id) REFERENCES organization.companies(tenant_id, id) MATCH SIMPLE ON DELETE NO ACTION,
  ADD CONSTRAINT sync_operations_branch_fk FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES organization.branches(tenant_id, company_id, id) MATCH SIMPLE ON DELETE NO ACTION,
  ADD CONSTRAINT sync_operations_session_fk FOREIGN KEY (tenant_id, session_id) REFERENCES identity.sessions(tenant_id, id) MATCH SIMPLE ON DELETE NO ACTION;
ALTER TABLE sync.outbox_entries
  ADD CONSTRAINT outbox_entries_operation_fk FOREIGN KEY (tenant_id, operation_id) REFERENCES sync.sync_operations(tenant_id, id) ON DELETE NO ACTION;
ALTER TABLE audit.audit_events
  ADD CONSTRAINT audit_events_session_fk FOREIGN KEY (session_id) REFERENCES identity.sessions(id) ON DELETE NO ACTION,
  ADD CONSTRAINT audit_events_tenant_session_fk FOREIGN KEY (tenant_id, session_id) REFERENCES identity.sessions(tenant_id, id) MATCH SIMPLE ON DELETE NO ACTION,
  ADD CONSTRAINT audit_events_company_fk FOREIGN KEY (tenant_id, company_id) REFERENCES organization.companies(tenant_id, id) MATCH SIMPLE ON DELETE NO ACTION,
  ADD CONSTRAINT audit_events_branch_fk FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES organization.branches(tenant_id, company_id, id) MATCH SIMPLE ON DELETE NO ACTION,
  ADD CONSTRAINT audit_events_operation_fk FOREIGN KEY (tenant_id, operation_id) REFERENCES sync.sync_operations(tenant_id, id) MATCH SIMPLE ON DELETE NO ACTION;

ALTER TABLE identity.session_refresh_tokens
  ADD CONSTRAINT session_refresh_tokens_parent_fk FOREIGN KEY (parent_token_id) REFERENCES identity.session_refresh_tokens(id) ON DELETE NO ACTION,
  ADD CONSTRAINT session_refresh_tokens_replacement_fk FOREIGN KEY (replacement_token_id) REFERENCES identity.session_refresh_tokens(id) ON DELETE NO ACTION;
ALTER TABLE sync.sync_operations
  ADD CONSTRAINT sync_operations_parent_fk FOREIGN KEY (tenant_id, parent_operation_id) REFERENCES sync.sync_operations(tenant_id, id) MATCH SIMPLE ON DELETE NO ACTION,
  ADD CONSTRAINT sync_operations_causation_fk FOREIGN KEY (tenant_id, causation_id) REFERENCES sync.sync_operations(tenant_id, id) MATCH SIMPLE ON DELETE NO ACTION;

CREATE UNIQUE INDEX tenants_code_normalized_uq ON tenancy.tenants(code_normalized) WHERE code_normalized IS NOT NULL;
CREATE INDEX tenants_status_id_idx ON tenancy.tenants(status, id);
CREATE UNIQUE INDEX companies_tax_id_normalized_uq ON organization.companies(tenant_id, tax_id_normalized) WHERE tax_id_normalized IS NOT NULL;
CREATE INDEX companies_tenant_status_id_idx ON organization.companies(tenant_id, status, id);
CREATE UNIQUE INDEX branches_code_normalized_uq ON organization.branches(tenant_id, company_id, code_normalized) WHERE code_normalized IS NOT NULL;
CREATE INDEX branches_tenant_company_status_id_idx ON organization.branches(tenant_id, company_id, status, id);
CREATE UNIQUE INDEX tenant_memberships_active_user_uq ON tenancy.tenant_memberships(tenant_id, user_id) WHERE status <> 'REVOKED';
CREATE UNIQUE INDEX tenant_memberships_primary_active_uq ON tenancy.tenant_memberships(user_id) WHERE is_primary AND status = 'ACTIVE';
CREATE INDEX tenant_memberships_user_status_tenant_idx ON tenancy.tenant_memberships(user_id, status, tenant_id);
CREATE INDEX users_status_id_idx ON identity.users(status, id);
CREATE UNIQUE INDEX user_credentials_active_type_uq ON identity.user_credentials(user_id, credential_type) WHERE status = 'ACTIVE';
CREATE INDEX user_credentials_user_status_idx ON identity.user_credentials(user_id, status);
CREATE INDEX mfa_factors_user_status_type_idx ON identity.mfa_factors(user_id, status, factor_type);
CREATE INDEX role_permission_grants_permission_fk_idx ON "authorization".role_permission_grants(permission_id);
CREATE UNIQUE INDEX user_role_assignments_tenant_active_uq ON "authorization".user_role_assignments(tenant_membership_id, role_id) WHERE status = 'ACTIVE' AND company_id IS NULL AND branch_id IS NULL;
CREATE UNIQUE INDEX user_role_assignments_company_active_uq ON "authorization".user_role_assignments(tenant_membership_id, role_id, company_id) WHERE status = 'ACTIVE' AND company_id IS NOT NULL AND branch_id IS NULL;
CREATE UNIQUE INDEX user_role_assignments_branch_active_uq ON "authorization".user_role_assignments(tenant_membership_id, role_id, company_id, branch_id) WHERE status = 'ACTIVE' AND branch_id IS NOT NULL;
CREATE INDEX user_role_assignments_evaluation_idx ON "authorization".user_role_assignments(tenant_id, tenant_membership_id, status, valid_from, valid_until);
CREATE INDEX user_role_assignments_role_fk_idx ON "authorization".user_role_assignments(role_id);
CREATE INDEX sessions_user_active_idx ON identity.sessions(user_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX sessions_membership_active_idx ON identity.sessions(tenant_id, tenant_membership_id, expires_at) WHERE tenant_membership_id IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX sessions_device_active_idx ON identity.sessions(tenant_id, device_id, expires_at) WHERE device_id IS NOT NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX session_refresh_tokens_parent_uq ON identity.session_refresh_tokens(parent_token_id) WHERE parent_token_id IS NOT NULL;
CREATE UNIQUE INDEX session_refresh_tokens_replacement_uq ON identity.session_refresh_tokens(replacement_token_id) WHERE replacement_token_id IS NOT NULL;
CREATE INDEX session_refresh_tokens_session_family_expiry_idx ON identity.session_refresh_tokens(session_id, token_family_id, expires_at);
CREATE INDEX security_events_user_occurred_idx ON identity.security_events(user_id, occurred_at DESC);
CREATE INDEX security_events_tenant_occurred_idx ON identity.security_events(tenant_id, occurred_at DESC);
CREATE INDEX security_events_code_recorded_idx ON identity.security_events(event_code, server_recorded_at DESC);
CREATE UNIQUE INDEX onboarding_operations_tenant_result_uq ON tenancy.onboarding_operations(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX onboarding_operations_company_result_uq ON tenancy.onboarding_operations(company_id) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX onboarding_operations_branch_result_uq ON tenancy.onboarding_operations(branch_id) WHERE branch_id IS NOT NULL;
CREATE UNIQUE INDEX onboarding_operations_membership_result_uq ON tenancy.onboarding_operations(tenant_membership_id) WHERE tenant_membership_id IS NOT NULL;
CREATE INDEX onboarding_operations_status_updated_id_idx ON tenancy.onboarding_operations(status, updated_at, id);
CREATE INDEX sync_operations_tenant_identity_idx ON sync.sync_operations(tenant_id, aggregate_type, aggregate_id, id);
CREATE INDEX sync_operations_tenant_status_committed_idx ON sync.sync_operations(tenant_id, sync_status, committed_at_server, id);
CREATE INDEX sync_operations_company_fk_idx ON sync.sync_operations(tenant_id, company_id) WHERE company_id IS NOT NULL;
CREATE INDEX sync_operations_branch_fk_idx ON sync.sync_operations(tenant_id, company_id, branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX sync_operations_session_fk_idx ON sync.sync_operations(tenant_id, session_id) WHERE session_id IS NOT NULL;
CREATE INDEX sync_operations_parent_fk_idx ON sync.sync_operations(tenant_id, parent_operation_id) WHERE parent_operation_id IS NOT NULL;
CREATE INDEX sync_operations_causation_fk_idx ON sync.sync_operations(tenant_id, causation_id) WHERE causation_id IS NOT NULL;
CREATE INDEX outbox_tenant_status_available_idx ON sync.outbox_entries(tenant_id, sync_status, available_at, id);
CREATE INDEX outbox_retry_pending_idx ON sync.outbox_entries(next_attempt_at, id) WHERE next_attempt_at IS NOT NULL AND acknowledged_at IS NULL;
CREATE INDEX audit_tenant_recorded_idx ON audit.audit_events(tenant_id, server_recorded_at DESC, id);
CREATE INDEX audit_tenant_resource_recorded_idx ON audit.audit_events(tenant_id, resource_type, resource_id, server_recorded_at DESC);
CREATE INDEX audit_tenant_actor_recorded_idx ON audit.audit_events(tenant_id, actor_type, actor_id, server_recorded_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX audit_operation_recorded_idx ON audit.audit_events(operation_id, server_recorded_at, id) WHERE operation_id IS NOT NULL;
CREATE INDEX audit_correlation_recorded_idx ON audit.audit_events(correlation_id, server_recorded_at, id);

CREATE FUNCTION audit.reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER security_events_append_only_row_guard
BEFORE UPDATE OR DELETE ON identity.security_events
FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
CREATE TRIGGER security_events_append_only_truncate_guard
BEFORE TRUNCATE ON identity.security_events
FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_append_only_mutation();
CREATE TRIGGER audit_events_append_only_row_guard
BEFORE UPDATE OR DELETE ON audit.audit_events
FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
CREATE TRIGGER audit_events_append_only_truncate_guard
BEFORE TRUNCATE ON audit.audit_events
FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_append_only_mutation();

CREATE FUNCTION sync.guard_sync_operation_immutable_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.tenant_id, NEW.company_id, NEW.branch_id, NEW.source_kind, NEW.device_id, NEW.installation_id,
         NEW.session_id, NEW.actor_type, NEW.actor_id, NEW.aggregate_type, NEW.aggregate_id,
         NEW.operation_type, NEW.idempotency_key, NEW.expected_version, NEW.authority_policy,
         NEW.parent_operation_id, NEW.causation_id, NEW.correlation_id, NEW.schema_version,
         NEW.payload, NEW.payload_checksum, NEW.occurred_at_local, NEW.recorded_at_local)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.company_id, OLD.branch_id, OLD.source_kind, OLD.device_id, OLD.installation_id,
         OLD.session_id, OLD.actor_type, OLD.actor_id, OLD.aggregate_type, OLD.aggregate_id,
         OLD.operation_type, OLD.idempotency_key, OLD.expected_version, OLD.authority_policy,
         OLD.parent_operation_id, OLD.causation_id, OLD.correlation_id, OLD.schema_version,
         OLD.payload, OLD.payload_checksum, OLD.occurred_at_local, OLD.recorded_at_local) THEN
    RAISE EXCEPTION 'SyncOperation immutable fields changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_operations_immutable_guard
BEFORE UPDATE ON sync.sync_operations
FOR EACH ROW EXECUTE FUNCTION sync.guard_sync_operation_immutable_fields();

CREATE FUNCTION sync.guard_outbox_operation_coherence()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source sync.sync_operations%ROWTYPE;
BEGIN
  SELECT * INTO source FROM sync.sync_operations
    WHERE tenant_id = NEW.tenant_id AND id = NEW.operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OutboxEntry requires its SyncOperation';
  END IF;
  IF ROW(NEW.operation_type, NEW.schema_version, NEW.payload_checksum, NEW.correlation_id, NEW.causation_id)
     IS DISTINCT FROM
     ROW(source.operation_type, source.schema_version, source.payload_checksum, source.correlation_id, source.causation_id) THEN
    RAISE EXCEPTION 'OutboxEntry metadata diverges from SyncOperation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER outbox_entries_operation_coherence_guard
BEFORE INSERT OR UPDATE ON sync.outbox_entries
FOR EACH ROW EXECUTE FUNCTION sync.guard_outbox_operation_coherence();

ALTER TABLE tenancy.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE "authorization".user_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.sync_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.outbox_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenants_tenant_isolation ON tenancy.tenants
  FOR ALL TO pos_app, pos_worker, pos_platform_app
  USING (id = platform.current_tenant_id())
  WITH CHECK (id = platform.current_tenant_id());
CREATE POLICY companies_tenant_isolation ON organization.companies
  FOR ALL TO pos_app, pos_worker, pos_platform_app
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY branches_tenant_isolation ON organization.branches
  FOR ALL TO pos_app, pos_worker, pos_platform_app
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY tenant_memberships_tenant_isolation ON tenancy.tenant_memberships
  FOR ALL TO pos_app, pos_worker, pos_platform_app
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY user_role_assignments_tenant_isolation ON "authorization".user_role_assignments
  FOR ALL TO pos_app, pos_worker, pos_platform_app
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY security_events_tenant_isolation ON identity.security_events
  FOR ALL TO pos_app, pos_worker, pos_platform_app
  USING (tenant_id IS NOT NULL AND tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = platform.current_tenant_id());
CREATE POLICY sync_operations_tenant_isolation ON sync.sync_operations
  FOR ALL TO pos_app, pos_worker, pos_platform_app
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY outbox_entries_tenant_isolation ON sync.outbox_entries
  FOR ALL TO pos_app, pos_worker, pos_platform_app
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY audit_events_tenant_isolation ON audit.audit_events
  FOR ALL TO pos_app, pos_worker, pos_platform_app
  USING (tenant_id IS NOT NULL AND tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = platform.current_tenant_id());

CREATE POLICY sessions_tenant_context ON identity.sessions
  FOR SELECT TO pos_app
  USING (tenant_id IS NOT NULL AND tenant_id = platform.current_tenant_id());
CREATE POLICY sessions_identity_select ON identity.sessions
  FOR SELECT TO pos_platform_app USING (true);
CREATE POLICY sessions_identity_insert ON identity.sessions
  FOR INSERT TO pos_platform_app WITH CHECK (true);
CREATE POLICY sessions_identity_update ON identity.sessions
  FOR UPDATE TO pos_platform_app USING (true) WITH CHECK (true);
CREATE POLICY security_events_platform_context ON identity.security_events
  FOR ALL TO pos_platform_app
  USING (tenant_id IS NULL)
  WITH CHECK (tenant_id IS NULL);
CREATE POLICY audit_events_platform_context ON audit.audit_events
  FOR ALL TO pos_platform_app
  USING (tenant_id IS NULL)
  WITH CHECK (tenant_id IS NULL);

ALTER TABLE tenancy.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE organization.companies FORCE ROW LEVEL SECURITY;
ALTER TABLE organization.branches FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.tenant_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE "authorization".user_role_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.security_events FORCE ROW LEVEL SECURITY;
ALTER TABLE sync.sync_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE sync.outbox_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA identity, tenancy, organization, "authorization", sync, audit FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA identity, tenancy, organization, "authorization", sync, audit FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA identity, tenancy, organization, "authorization", sync, audit FROM PUBLIC;
GRANT USAGE ON SCHEMA platform, identity, tenancy, organization, "authorization", sync, audit TO pos_app, pos_worker, pos_platform_app;
GRANT USAGE ON SCHEMA identity, tenancy, organization, "authorization", sync, audit TO pos_platform_admin;
GRANT EXECUTE ON FUNCTION platform.current_tenant_id() TO pos_app, pos_worker, pos_platform_app;
GRANT EXECUTE ON FUNCTION platform.is_uuid_v7(uuid) TO pos_app, pos_worker, pos_platform_app, pos_schema_owner;

GRANT SELECT ON identity.users TO pos_app;
GRANT SELECT ON tenancy.tenants, organization.companies, organization.branches, tenancy.tenant_memberships TO pos_app;
GRANT SELECT ON "authorization".roles, "authorization".permissions, "authorization".role_permission_grants, "authorization".authorization_policy_versions TO pos_app;
GRANT SELECT, INSERT, UPDATE ON "authorization".user_role_assignments TO pos_app;
GRANT SELECT ON identity.sessions TO pos_app;
GRANT SELECT, INSERT ON sync.sync_operations, sync.outbox_entries TO pos_app;
GRANT UPDATE (sync_status, received_at_server, committed_at_server, version) ON sync.sync_operations TO pos_app;
GRANT UPDATE (sync_status, attempt_count, last_attempt_at, next_attempt_at, last_error_code, acknowledged_at, updated_at, version) ON sync.outbox_entries TO pos_app;
GRANT SELECT, INSERT ON audit.audit_events, identity.security_events TO pos_app;

GRANT SELECT ON tenancy.tenants, organization.companies, organization.branches, tenancy.tenant_memberships TO pos_worker;
GRANT SELECT ON "authorization".roles, "authorization".permissions, "authorization".role_permission_grants, "authorization".authorization_policy_versions, "authorization".user_role_assignments TO pos_worker;
GRANT SELECT ON sync.sync_operations, sync.outbox_entries TO pos_worker;
GRANT UPDATE (sync_status, received_at_server, committed_at_server, version) ON sync.sync_operations TO pos_worker;
GRANT UPDATE (sync_status, attempt_count, last_attempt_at, next_attempt_at, last_error_code, acknowledged_at, updated_at, version) ON sync.outbox_entries TO pos_worker;
GRANT SELECT, INSERT ON audit.audit_events, identity.security_events TO pos_worker;

GRANT SELECT, INSERT ON identity.users, identity.user_credentials, identity.mfa_factors, identity.sessions, identity.session_refresh_tokens TO pos_platform_app;
GRANT UPDATE (email, email_normalized, phone, phone_normalized, full_name, status, updated_at, version) ON identity.users TO pos_platform_app;
GRANT UPDATE (status, failed_attempt_count, locked_until, rotated_at, last_used_at, revoked_at, retained_until, version) ON identity.user_credentials TO pos_platform_app;
GRANT UPDATE (secret_reference, status, verified_at, last_used_at, revoked_at, retained_until, version) ON identity.mfa_factors TO pos_platform_app;
GRANT UPDATE (tenant_id, tenant_membership_id, device_id, expires_at, last_reauthenticated_at, mfa_status, authorization_policy_version_id, offline_valid_until, revoked_at, revoked_by_actor_type, revoked_by_actor_id, revocation_reason, version) ON identity.sessions TO pos_platform_app;
GRANT UPDATE (consumed_at, replacement_token_id, revoked_at, revocation_reason, reuse_detected_at, retained_until) ON identity.session_refresh_tokens TO pos_platform_app;
GRANT SELECT, INSERT ON identity.security_events TO pos_platform_app;
GRANT SELECT, INSERT ON tenancy.onboarding_operations TO pos_platform_app;
GRANT UPDATE (tenant_id, company_id, branch_id, owner_user_id, tenant_membership_id, status, reason_code, license_reference, requested_plan, effective_plan, pricing_policy_version, tax_policy_version, rounding_policy_version, authorization_policy_version_id, required_action, updated_at, completed_at, cancelled_at, version) ON tenancy.onboarding_operations TO pos_platform_app;
GRANT SELECT, INSERT, UPDATE ON tenancy.tenants, organization.companies, organization.branches, tenancy.tenant_memberships, "authorization".user_role_assignments TO pos_platform_app;
GRANT SELECT ON "authorization".roles, "authorization".permissions, "authorization".role_permission_grants, "authorization".authorization_policy_versions TO pos_platform_app;
GRANT SELECT, INSERT ON sync.sync_operations, sync.outbox_entries TO pos_platform_app;
GRANT UPDATE (sync_status, received_at_server, committed_at_server, version) ON sync.sync_operations TO pos_platform_app;
GRANT UPDATE (sync_status, attempt_count, last_attempt_at, next_attempt_at, last_error_code, acknowledged_at, updated_at, version) ON sync.outbox_entries TO pos_platform_app;
GRANT SELECT, INSERT ON audit.audit_events TO pos_platform_app;

GRANT SELECT (id, email, email_normalized, phone, phone_normalized, full_name, status, created_at, updated_at, version) ON identity.users TO pos_platform_admin;
GRANT SELECT ON tenancy.tenants, organization.companies, organization.branches, tenancy.tenant_memberships TO pos_platform_admin;
GRANT SELECT ON "authorization".roles, "authorization".permissions, "authorization".role_permission_grants, "authorization".authorization_policy_versions, "authorization".user_role_assignments TO pos_platform_admin;
GRANT SELECT ON identity.sessions, identity.security_events, tenancy.onboarding_operations, sync.outbox_entries TO pos_platform_admin;
GRANT SELECT (id, tenant_id, company_id, branch_id, source_kind, device_id, installation_id, session_id, actor_type, actor_id, aggregate_type, aggregate_id, operation_type, idempotency_key, expected_version, authority_policy, parent_operation_id, causation_id, correlation_id, schema_version, payload_checksum, sync_status, occurred_at_local, recorded_at_local, received_at_server, committed_at_server, version) ON sync.sync_operations TO pos_platform_admin;
GRANT SELECT (id, tenant_id, company_id, branch_id, actor_type, actor_id, session_id, device_id, action_code, resource_type, resource_reference_kind, resource_id, operation_id, correlation_id, causation_id, schema_version, reported_at, server_recorded_at, result, reason_code, reviewer_actor_type, reviewer_actor_id, approver_actor_type, approver_actor_id, evidence_checksum, payload_checksum) ON audit.audit_events TO pos_platform_admin;

REVOKE UPDATE, DELETE, TRUNCATE ON identity.security_events, audit.audit_events FROM pos_app, pos_worker, pos_platform_app, pos_platform_admin;
REVOKE SELECT ON identity.user_credentials, identity.mfa_factors, identity.session_refresh_tokens FROM pos_app, pos_worker, pos_platform_admin;
REVOKE SELECT (verifier) ON identity.user_credentials FROM pos_app, pos_worker, pos_platform_admin;
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA identity, tenancy, organization, "authorization", sync, audit FROM pos_app, pos_worker, pos_platform_app, pos_platform_admin;

ALTER FUNCTION platform.current_tenant_id() OWNER TO pos_schema_owner;
ALTER FUNCTION audit.reject_append_only_mutation() OWNER TO pos_schema_owner;
ALTER FUNCTION sync.guard_sync_operation_immutable_fields() OWNER TO pos_schema_owner;
ALTER FUNCTION sync.guard_outbox_operation_coherence() OWNER TO pos_schema_owner;

CREATE SCHEMA cash AUTHORIZATION pos_schema_owner;

CREATE TABLE cash.cash_registers (
  id uuid PRIMARY KEY CONSTRAINT cash_registers_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  code text NOT NULL CONSTRAINT cash_registers_code_ck CHECK (btrim(code) <> ''),
  code_normalized text NOT NULL CONSTRAINT cash_registers_code_normalized_ck CHECK (btrim(code_normalized) <> ''),
  name text NOT NULL CONSTRAINT cash_registers_name_ck CHECK (btrim(name) <> ''),
  currency_code char(3) NOT NULL,
  status text NOT NULL CONSTRAINT cash_registers_status_ck CHECK (status IN ('ACTIVE','RETIRED')),
  created_at timestamptz NOT NULL,
  retired_at timestamptz NULL,
  version integer NOT NULL CONSTRAINT cash_registers_version_ck CHECK (version > 0),
  CONSTRAINT cash_registers_code_normalized_uq UNIQUE (tenant_id, company_id, branch_id, code_normalized),
  CONSTRAINT cash_registers_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT cash_registers_tenant_company_branch_id_uq UNIQUE (tenant_id, company_id, branch_id, id)
);

CREATE TABLE cash.cash_shifts (
  id uuid PRIMARY KEY CONSTRAINT cash_shifts_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  cash_register_id uuid NOT NULL,
  origin_device_id uuid NOT NULL,
  opened_by_actor_type text NOT NULL CONSTRAINT cash_shifts_opened_actor_type_ck CHECK (opened_by_actor_type IN ('USER','DEVICE')),
  opened_by_actor_id text NOT NULL CONSTRAINT cash_shifts_opened_actor_id_ck CHECK (btrim(opened_by_actor_id) <> ''),
  opened_at timestamptz NOT NULL,
  business_date date NOT NULL,
  timezone_id text NOT NULL CONSTRAINT cash_shifts_timezone_id_ck CHECK (btrim(timezone_id) <> ''),
  utc_offset_minutes smallint NOT NULL,
  currency_code char(3) NOT NULL,
  status text NOT NULL CONSTRAINT cash_shifts_status_ck CHECK (status IN ('OPEN','CLOSING','CLOSED')),
  closed_by_actor_type text NULL CONSTRAINT cash_shifts_closed_actor_type_ck CHECK (closed_by_actor_type IN ('USER','DEVICE')),
  closed_by_actor_id text NULL,
  closed_at timestamptz NULL,
  opening_idempotency_key text NOT NULL CONSTRAINT cash_shifts_opening_idempotency_key_ck CHECK (btrim(opening_idempotency_key) <> ''),
  opening_request_checksum text NOT NULL CONSTRAINT cash_shifts_opening_request_checksum_ck CHECK (btrim(opening_request_checksum) <> ''),
  closing_idempotency_key text NULL,
  closing_request_checksum text NULL,
  last_movement_sequence integer NOT NULL DEFAULT 0 CONSTRAINT cash_shifts_last_movement_sequence_ck CHECK (last_movement_sequence >= 0),
  version integer NOT NULL CONSTRAINT cash_shifts_version_ck CHECK (version > 0),
  created_at timestamptz NOT NULL,
  server_recorded_at timestamptz NULL,
  CONSTRAINT cash_shifts_closed_pair_ck CHECK ((closed_by_actor_type IS NULL) = (closed_by_actor_id IS NULL)),
  CONSTRAINT cash_shifts_register_fk FOREIGN KEY (tenant_id, company_id, branch_id, cash_register_id) REFERENCES cash.cash_registers (tenant_id, company_id, branch_id, id),
  CONSTRAINT cash_shifts_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT cash_shifts_tenant_company_branch_id_uq UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT cash_shifts_opening_idempotency_uq UNIQUE (tenant_id, origin_device_id, opening_idempotency_key),
  CONSTRAINT cash_shifts_closing_idempotency_uq UNIQUE (tenant_id, origin_device_id, closing_idempotency_key)
);
CREATE UNIQUE INDEX cash_shifts_incompatible_idx
  ON cash.cash_shifts (tenant_id, branch_id, cash_register_id, origin_device_id)
  WHERE status IN ('OPEN','CLOSING');

CREATE TABLE cash.cash_movements (
  id uuid PRIMARY KEY CONSTRAINT cash_movements_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  cash_register_id uuid NOT NULL,
  cash_shift_id uuid NOT NULL,
  shift_sequence integer NOT NULL CONSTRAINT cash_movements_shift_sequence_ck CHECK (shift_sequence > 0),
  movement_type text NOT NULL CONSTRAINT cash_movements_movement_type_ck CHECK (movement_type IN (
    'OPENING_FLOAT','CASH_SALE','CASH_PAYMENT','CHANGE_GIVEN','CASH_REFUND',
    'CASH_REVERSAL_COMPENSATION','CASH_WITHDRAWAL','CASH_DEPOSIT','COURIER_COLLECTION',
    'CASH_EXPENSE','CASH_ADJUSTMENT_POSITIVE','CASH_ADJUSTMENT_NEGATIVE','TRANSFER_TO_SAFE',
    'TRANSFER_FROM_SAFE','CLOSING_TRANSFER','OTHER_AUTHORIZED'
  )),
  direction text NOT NULL CONSTRAINT cash_movements_direction_ck CHECK (direction IN ('IN','OUT')),
  amount numeric(19,6) NOT NULL CONSTRAINT cash_movements_amount_ck CHECK (amount > 0),
  currency_code char(3) NOT NULL,
  status text NOT NULL CONSTRAINT cash_movements_status_ck CHECK (status IN ('CREATED','PENDING_APPROVAL','APPROVED','POSTED','REJECTED','FAILED','CANCELLED')),
  reference_type text NOT NULL CONSTRAINT cash_movements_reference_type_ck CHECK (btrim(reference_type) <> ''),
  reference_id uuid NULL,
  original_cash_movement_id uuid NULL,
  reason_code text NOT NULL CONSTRAINT cash_movements_reason_code_ck CHECK (btrim(reason_code) <> ''),
  evidence_reference text NULL,
  actor_type text NOT NULL CONSTRAINT cash_movements_actor_type_ck CHECK (actor_type IN ('USER','DEVICE')),
  actor_id text NULL,
  approved_by_actor_type text NULL CONSTRAINT cash_movements_approved_actor_type_ck CHECK (approved_by_actor_type IN ('USER','DEVICE')),
  approved_by_actor_id text NULL,
  business_date date NOT NULL,
  occurred_at timestamptz NOT NULL,
  device_reported_at timestamptz NOT NULL,
  origin_device_id uuid NOT NULL,
  idempotency_key text NOT NULL CONSTRAINT cash_movements_idempotency_key_ck CHECK (btrim(idempotency_key) <> ''),
  request_checksum text NOT NULL CONSTRAINT cash_movements_request_checksum_ck CHECK (btrim(request_checksum) <> ''),
  correlation_id uuid NOT NULL,
  version integer NOT NULL CONSTRAINT cash_movements_version_ck CHECK (version > 0),
  created_at timestamptz NOT NULL,
  server_recorded_at timestamptz NULL,
  CONSTRAINT cash_movements_approved_pair_ck CHECK ((approved_by_actor_type IS NULL) = (approved_by_actor_id IS NULL)),
  CONSTRAINT cash_movements_shift_fk FOREIGN KEY (tenant_id, company_id, branch_id, cash_shift_id) REFERENCES cash.cash_shifts (tenant_id, company_id, branch_id, id),
  CONSTRAINT cash_movements_register_fk FOREIGN KEY (tenant_id, company_id, branch_id, cash_register_id) REFERENCES cash.cash_registers (tenant_id, company_id, branch_id, id),
  CONSTRAINT cash_movements_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT cash_movements_shift_sequence_uq UNIQUE (tenant_id, cash_shift_id, shift_sequence),
  CONSTRAINT cash_movements_idempotency_uq UNIQUE (tenant_id, origin_device_id, idempotency_key)
);
CREATE INDEX cash_movements_shift_status_idx ON cash.cash_movements (tenant_id, cash_shift_id, status);

CREATE TABLE cash.cash_counts (
  id uuid PRIMARY KEY CONSTRAINT cash_counts_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  cash_register_id uuid NOT NULL,
  cash_shift_id uuid NOT NULL,
  count_type text NOT NULL CONSTRAINT cash_counts_count_type_ck CHECK (count_type IN ('PARTIAL','CLOSING','CORRECTION')),
  status text NOT NULL CONSTRAINT cash_counts_status_ck CHECK (status IN ('IN_PROGRESS','COMPLETED','ABORTED')),
  blind_mode boolean NULL,
  started_shift_version integer NOT NULL CONSTRAINT cash_counts_started_shift_version_ck CHECK (started_shift_version > 0),
  movement_cutoff_sequence integer NOT NULL CONSTRAINT cash_counts_movement_cutoff_sequence_ck CHECK (movement_cutoff_sequence >= 0),
  calculation_policy_version uuid NOT NULL,
  calculation_checksum text NOT NULL CONSTRAINT cash_counts_calculation_checksum_ck CHECK (char_length(calculation_checksum) = 64),
  expected_amount numeric(19,6) NULL CONSTRAINT cash_counts_expected_amount_ck CHECK (expected_amount IS NULL OR expected_amount >= 0),
  counted_amount numeric(19,6) NULL CONSTRAINT cash_counts_counted_amount_ck CHECK (counted_amount IS NULL OR counted_amount >= 0),
  difference_amount numeric(19,6) NULL,
  difference_type text NULL CONSTRAINT cash_counts_difference_type_ck CHECK (difference_type IS NULL OR difference_type IN ('SHORTAGE','EXACT','OVERAGE')),
  severity text NULL,
  currency_code char(3) NOT NULL,
  denomination_breakdown_status text NOT NULL CONSTRAINT cash_counts_denomination_breakdown_status_ck CHECK (denomination_breakdown_status IN ('PROVIDED','NOT_PROVIDED')),
  tolerance_policy_version uuid NOT NULL,
  tolerance_policy_checksum text NOT NULL CONSTRAINT cash_counts_tolerance_policy_checksum_ck CHECK (char_length(tolerance_policy_checksum) = 64),
  supersedes_cash_count_id uuid NULL,
  started_by_actor_type text NOT NULL CONSTRAINT cash_counts_started_actor_type_ck CHECK (started_by_actor_type IN ('USER','DEVICE')),
  started_by_actor_id text NOT NULL CONSTRAINT cash_counts_started_actor_id_ck CHECK (btrim(started_by_actor_id) <> ''),
  started_at timestamptz NOT NULL,
  completed_by_actor_type text NULL CONSTRAINT cash_counts_completed_actor_type_ck CHECK (completed_by_actor_type IN ('USER','DEVICE')),
  completed_by_actor_id text NULL,
  completed_at timestamptz NULL,
  aborted_by_actor_type text NULL CONSTRAINT cash_counts_aborted_actor_type_ck CHECK (aborted_by_actor_type IN ('USER','DEVICE')),
  aborted_by_actor_id text NULL,
  aborted_at timestamptz NULL,
  abort_reason_code text NULL,
  origin_device_id uuid NOT NULL,
  start_idempotency_key text NOT NULL CONSTRAINT cash_counts_start_idempotency_key_ck CHECK (btrim(start_idempotency_key) <> ''),
  start_request_checksum text NOT NULL CONSTRAINT cash_counts_start_request_checksum_ck CHECK (btrim(start_request_checksum) <> ''),
  completion_idempotency_key text NULL,
  completion_request_checksum text NULL,
  correlation_id uuid NOT NULL,
  version integer NOT NULL CONSTRAINT cash_counts_version_ck CHECK (version > 0),
  created_at timestamptz NOT NULL,
  server_recorded_at timestamptz NULL,
  CONSTRAINT cash_counts_completed_pair_ck CHECK ((completed_by_actor_type IS NULL) = (completed_by_actor_id IS NULL)),
  CONSTRAINT cash_counts_aborted_pair_ck CHECK ((aborted_by_actor_type IS NULL) = (aborted_by_actor_id IS NULL)),
  CONSTRAINT cash_counts_shift_fk FOREIGN KEY (tenant_id, company_id, branch_id, cash_shift_id) REFERENCES cash.cash_shifts (tenant_id, company_id, branch_id, id),
  CONSTRAINT cash_counts_supersedes_fk FOREIGN KEY (tenant_id, supersedes_cash_count_id) REFERENCES cash.cash_counts (tenant_id, id),
  CONSTRAINT cash_counts_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT cash_counts_tenant_company_branch_id_uq UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT cash_counts_start_idempotency_uq UNIQUE (tenant_id, origin_device_id, start_idempotency_key),
  CONSTRAINT cash_counts_completion_idempotency_uq UNIQUE (tenant_id, origin_device_id, completion_idempotency_key),
  CONSTRAINT cash_counts_supersedes_uq UNIQUE (tenant_id, supersedes_cash_count_id)
);
CREATE UNIQUE INDEX cash_counts_one_completed_closing_idx
  ON cash.cash_counts (tenant_id, cash_shift_id)
  WHERE count_type = 'CLOSING' AND status = 'COMPLETED';

CREATE TABLE cash.cash_count_denominations (
  id uuid PRIMARY KEY CONSTRAINT cash_count_denominations_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  cash_count_id uuid NOT NULL,
  line_number integer NOT NULL CONSTRAINT cash_count_denominations_line_number_ck CHECK (line_number > 0),
  denomination_code text NOT NULL CONSTRAINT cash_count_denominations_denomination_code_ck CHECK (btrim(denomination_code) <> ''),
  denomination_value numeric(19,6) NOT NULL CONSTRAINT cash_count_denominations_denomination_value_ck CHECK (denomination_value > 0),
  quantity integer NOT NULL CONSTRAINT cash_count_denominations_quantity_ck CHECK (quantity > 0),
  line_amount numeric(19,6) NOT NULL CONSTRAINT cash_count_denominations_line_amount_ck CHECK (line_amount > 0),
  currency_code char(3) NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT cash_count_denominations_formula_ck CHECK (line_amount = denomination_value * quantity),
  CONSTRAINT cash_count_denominations_count_fk FOREIGN KEY (tenant_id, cash_count_id) REFERENCES cash.cash_counts (tenant_id, id),
  CONSTRAINT cash_count_denominations_line_number_uq UNIQUE (tenant_id, cash_count_id, line_number),
  CONSTRAINT cash_count_denominations_denomination_code_uq UNIQUE (tenant_id, cash_count_id, denomination_code)
);

CREATE TABLE cash.cash_difference_reviews (
  id uuid PRIMARY KEY CONSTRAINT cash_difference_reviews_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  cash_shift_id uuid NOT NULL,
  cash_count_id uuid NOT NULL,
  status text NOT NULL CONSTRAINT cash_difference_reviews_status_ck CHECK (status IN ('REVIEW_REQUIRED','ACCEPTED','ESCALATED','RESOLVED')),
  severity text NULL,
  tolerance_policy_version uuid NOT NULL,
  tolerance_policy_checksum text NOT NULL CONSTRAINT cash_difference_reviews_tolerance_checksum_ck CHECK (char_length(tolerance_policy_checksum) = 64),
  requires_segregation boolean NULL,
  created_at timestamptz NOT NULL,
  resolved_at timestamptz NULL,
  version integer NOT NULL CONSTRAINT cash_difference_reviews_version_ck CHECK (version > 0),
  correlation_id uuid NOT NULL,
  CONSTRAINT cash_difference_reviews_count_fk FOREIGN KEY (tenant_id, company_id, branch_id, cash_count_id) REFERENCES cash.cash_counts (tenant_id, company_id, branch_id, id),
  CONSTRAINT cash_difference_reviews_shift_fk FOREIGN KEY (tenant_id, company_id, branch_id, cash_shift_id) REFERENCES cash.cash_shifts (tenant_id, company_id, branch_id, id),
  CONSTRAINT cash_difference_reviews_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT cash_difference_reviews_count_uq UNIQUE (tenant_id, cash_count_id)
);

CREATE TABLE cash.cash_difference_review_actions (
  id uuid PRIMARY KEY CONSTRAINT cash_difference_review_actions_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  cash_difference_review_id uuid NOT NULL,
  action_type text NOT NULL CONSTRAINT cash_difference_review_actions_action_type_ck CHECK (action_type IN ('CREATED','ACCEPTED','ESCALATED','RESOLVED')),
  from_status text NOT NULL,
  to_status text NOT NULL,
  reason_code text NOT NULL CONSTRAINT cash_difference_review_actions_reason_code_ck CHECK (btrim(reason_code) <> ''),
  note text NULL,
  evidence_reference text NULL,
  actor_type text NOT NULL CONSTRAINT cash_difference_review_actions_actor_type_ck CHECK (actor_type IN ('USER','DEVICE')),
  actor_id text NULL,
  authorization_policy_version text NOT NULL CONSTRAINT cash_difference_review_actions_authorization_policy_version_ck CHECK (btrim(authorization_policy_version) <> ''),
  idempotency_key text NOT NULL CONSTRAINT cash_difference_review_actions_idempotency_key_ck CHECK (btrim(idempotency_key) <> ''),
  request_checksum text NOT NULL CONSTRAINT cash_difference_review_actions_request_checksum_ck CHECK (btrim(request_checksum) <> ''),
  occurred_at timestamptz NOT NULL,
  origin_device_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  server_recorded_at timestamptz NULL,
  CONSTRAINT cash_difference_review_actions_review_fk FOREIGN KEY (tenant_id, cash_difference_review_id) REFERENCES cash.cash_difference_reviews (tenant_id, id),
  CONSTRAINT cash_difference_review_actions_idempotency_uq UNIQUE (tenant_id, origin_device_id, idempotency_key)
);

CREATE FUNCTION cash.guard_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER cash_movements_no_update BEFORE UPDATE ON cash.cash_movements FOR EACH ROW EXECUTE FUNCTION cash.guard_append_only();
CREATE TRIGGER cash_movements_no_delete BEFORE DELETE ON cash.cash_movements FOR EACH ROW EXECUTE FUNCTION cash.guard_append_only();
CREATE TRIGGER cash_difference_review_actions_no_update BEFORE UPDATE ON cash.cash_difference_review_actions FOR EACH ROW EXECUTE FUNCTION cash.guard_append_only();
CREATE TRIGGER cash_difference_review_actions_no_delete BEFORE DELETE ON cash.cash_difference_review_actions FOR EACH ROW EXECUTE FUNCTION cash.guard_append_only();

ALTER TABLE cash.cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash.cash_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash.cash_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash.cash_count_denominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash.cash_difference_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash.cash_difference_review_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_registers_tenant_isolation ON cash.cash_registers
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY cash_shifts_tenant_isolation ON cash.cash_shifts
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY cash_movements_tenant_isolation ON cash.cash_movements
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY cash_counts_tenant_isolation ON cash.cash_counts
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY cash_count_denominations_tenant_isolation ON cash.cash_count_denominations
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY cash_difference_reviews_tenant_isolation ON cash.cash_difference_reviews
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());
CREATE POLICY cash_difference_review_actions_tenant_isolation ON cash.cash_difference_review_actions
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

ALTER TABLE cash.cash_registers FORCE ROW LEVEL SECURITY;
ALTER TABLE cash.cash_shifts FORCE ROW LEVEL SECURITY;
ALTER TABLE cash.cash_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE cash.cash_counts FORCE ROW LEVEL SECURITY;
ALTER TABLE cash.cash_count_denominations FORCE ROW LEVEL SECURITY;
ALTER TABLE cash.cash_difference_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE cash.cash_difference_review_actions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA cash FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA cash FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cash FROM PUBLIC;
GRANT USAGE ON SCHEMA cash TO pos_app, pos_worker, pos_platform_admin;

GRANT SELECT, INSERT ON cash.cash_registers TO pos_app, pos_worker;
GRANT SELECT, INSERT, UPDATE ON cash.cash_shifts TO pos_app, pos_worker;
GRANT SELECT, INSERT ON cash.cash_movements TO pos_app, pos_worker;
GRANT SELECT, INSERT ON cash.cash_counts TO pos_app, pos_worker;
GRANT SELECT, INSERT ON cash.cash_count_denominations TO pos_app, pos_worker;
GRANT SELECT, INSERT ON cash.cash_difference_reviews TO pos_app, pos_worker;
GRANT SELECT, INSERT ON cash.cash_difference_review_actions TO pos_app, pos_worker;

GRANT SELECT ON cash.cash_registers, cash.cash_shifts, cash.cash_movements, cash.cash_counts,
  cash.cash_count_denominations, cash.cash_difference_reviews, cash.cash_difference_review_actions
  TO pos_platform_admin;

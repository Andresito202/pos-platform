\set ON_ERROR_STOP on

SELECT 'POSTGRES_VERSION=' || version();
DROP SCHEMA IF EXISTS poc CASCADE;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'physical_poc_owner') THEN
    CREATE ROLE physical_poc_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'physical_poc_app') THEN
    CREATE ROLE physical_poc_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'physical_poc_worker') THEN
    CREATE ROLE physical_poc_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'physical_poc_test_executor') THEN
    CREATE ROLE physical_poc_test_executor LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$roles$;

GRANT physical_poc_owner, physical_poc_app, physical_poc_worker TO physical_poc_test_executor;
CREATE SCHEMA poc AUTHORIZATION physical_poc_owner;
SET ROLE physical_poc_owner;

CREATE FUNCTION poc.current_tenant_id()
RETURNS uuid LANGUAGE plpgsql STABLE AS $function$
DECLARE raw_value text;
BEGIN
  raw_value := current_setting('app.tenant_id', true);
  IF raw_value IS NULL OR btrim(raw_value) = '' THEN RETURN NULL; END IF;
  RETURN raw_value::uuid;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END
$function$;

CREATE FUNCTION poc.is_uuid_v7(value uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $function$
  SELECT value::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$function$;

CREATE FUNCTION poc.decimal_6(value text)
RETURNS numeric(19,6) LANGUAGE plpgsql IMMUTABLE STRICT AS $function$
BEGIN
  IF value !~ '^(0|[1-9][0-9]{0,12})\.[0-9]{6}$' THEN
    RAISE EXCEPTION 'invalid canonical decimal scale 6' USING ERRCODE = '22023';
  END IF;
  RETURN value::numeric(19,6);
END
$function$;

CREATE FUNCTION poc.decimal_10(value text)
RETURNS numeric(19,10) LANGUAGE plpgsql IMMUTABLE STRICT AS $function$
BEGIN
  IF value !~ '^(0|[1-9][0-9]{0,8})\.[0-9]{10}$' THEN
    RAISE EXCEPTION 'invalid canonical decimal scale 10' USING ERRCODE = '22023';
  END IF;
  RETURN value::numeric(19,10);
END
$function$;

CREATE FUNCTION poc.decimal_2(value text)
RETURNS numeric(19,2) LANGUAGE plpgsql IMMUTABLE STRICT AS $function$
BEGIN
  IF value !~ '^(0|[1-9][0-9]{0,16})\.[0-9]{2}$' THEN
    RAISE EXCEPTION 'invalid canonical decimal scale 2' USING ERRCODE = '22023';
  END IF;
  RETURN value::numeric(19,2);
END
$function$;

CREATE FUNCTION poc.reject_update_delete()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END
$function$;

CREATE FUNCTION poc.reject_truncate()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION '% cannot be truncated', TG_TABLE_NAME USING ERRCODE = '55000';
END
$function$;

CREATE TABLE poc.tenants (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  name text NOT NULL
);

-- Test harness for the R1 limit contract; this is not a product licensing table.
CREATE TABLE poc.test_limit_contract (
  sample_id integer PRIMARY KEY,
  limit_type text NOT NULL CHECK (limit_type IN ('FINITE','UNLIMITED','NOT_APPLICABLE')),
  limit_value numeric(19,6),
  CHECK (
    (limit_type = 'FINITE' AND limit_value IS NOT NULL AND limit_value >= 0)
    OR (limit_type IN ('UNLIMITED','NOT_APPLICABLE') AND limit_value IS NULL)
  )
);

CREATE TABLE poc.companies (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES poc.tenants(id) ON DELETE RESTRICT
);

CREATE TABLE poc.branches (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES poc.companies(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.devices (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  UNIQUE (tenant_id, company_id, branch_id, id),
  FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES poc.branches(tenant_id, company_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.units_of_measure (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  code text NOT NULL UNIQUE,
  dimension text NOT NULL CHECK (dimension IN ('COUNT','MASS','VOLUME','LENGTH')),
  precision_scale smallint NOT NULL CHECK (precision_scale BETWEEN 0 AND 6)
);

CREATE TABLE poc.products (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  base_unit_id uuid NOT NULL,
  name text NOT NULL,
  lot_controlled boolean NOT NULL,
  expiration_controlled boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (NOT expiration_controlled OR lot_controlled),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES poc.companies(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (base_unit_id) REFERENCES poc.units_of_measure(id) ON DELETE RESTRICT
);

CREATE TABLE poc.product_variants (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  product_id uuid NOT NULL,
  variant_code text NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (tenant_id, company_id, product_id, id),
  UNIQUE (tenant_id, company_id, product_id, variant_code),
  FOREIGN KEY (tenant_id, company_id, product_id) REFERENCES poc.products(tenant_id, company_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.pricing_versions (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  product_id uuid NOT NULL,
  version_number bigint NOT NULL CHECK (version_number >= 1),
  amount numeric(19,6) NOT NULL CHECK (amount >= 0),
  priority integer NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  status text NOT NULL CHECK (status IN ('PUBLISHED','SUPERSEDED','REVOKED')),
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  expected_parent_version bigint NOT NULL,
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  UNIQUE (tenant_id, company_id, product_id, version_number),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, product_id) REFERENCES poc.products(tenant_id, company_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.tax_versions (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  version_number bigint NOT NULL CHECK (version_number >= 1),
  rate numeric(19,10) NOT NULL CHECK (rate >= 0),
  priority integer NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  status text NOT NULL CHECK (status IN ('PUBLISHED','SUPERSEDED','REVOKED')),
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  UNIQUE (tenant_id, company_id, version_number),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES poc.companies(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.inventory_lots (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  product_id uuid NOT NULL,
  batch_code text,
  received_date date NOT NULL,
  expiration_date date,
  status text NOT NULL CHECK (status IN ('ACTIVE','BLOCKED','DEPLETED','EXPIRED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (expiration_date IS NULL OR expiration_date >= received_date),
  UNIQUE (tenant_id, company_id, product_id, id),
  FOREIGN KEY (tenant_id, company_id, product_id) REFERENCES poc.products(tenant_id, company_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.inventory_policy_versions (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  version_number bigint NOT NULL CHECK (version_number >= 1),
  negative_stock_allowed boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('PUBLISHED','SUPERSEDED','REVOKED')),
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, version_number),
  FOREIGN KEY (tenant_id, company_id) REFERENCES poc.companies(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.stock_balances (
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  lot_id uuid,
  on_hand_quantity numeric(19,6) NOT NULL,
  reserved_quantity numeric(19,6) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (tenant_id, company_id, branch_id, product_id),
  FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES poc.branches(tenant_id, company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, company_id, product_id) REFERENCES poc.products(tenant_id, company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, company_id, product_id, lot_id) REFERENCES poc.inventory_lots(tenant_id, company_id, product_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.sales (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  origin_device_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','SUSPENDED','READY_FOR_PAYMENT','PAYMENT_IN_PROGRESS','COMPLETED','CANCELLED','EXPIRED')),
  business_date date NOT NULL,
  currency_code char(3) NOT NULL,
  payable_amount numeric(19,6) NOT NULL CHECK (payable_amount >= 0),
  pricing_snapshot jsonb NOT NULL CHECK (jsonb_typeof(pricing_snapshot) = 'object'),
  tax_snapshot jsonb NOT NULL CHECK (jsonb_typeof(tax_snapshot) = 'object'),
  idempotency_key text NOT NULL,
  request_checksum text NOT NULL CHECK (request_checksum ~ '^[0-9a-f]{64}$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, company_id, branch_id, id),
  UNIQUE (tenant_id, origin_device_id, idempotency_key),
  FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES poc.branches(tenant_id, company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, company_id, branch_id, origin_device_id) REFERENCES poc.devices(tenant_id, company_id, branch_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.sale_items (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  product_id uuid NOT NULL,
  variant_id uuid,
  unit_id uuid NOT NULL,
  quantity numeric(19,6) NOT NULL CHECK (quantity > 0),
  unit_price numeric(19,6) NOT NULL CHECK (unit_price >= 0),
  tax_rate numeric(19,10) NOT NULL CHECK (tax_rate >= 0),
  line_total numeric(19,6) NOT NULL CHECK (line_total >= 0),
  UNIQUE (tenant_id, sale_id, line_number),
  FOREIGN KEY (tenant_id, company_id, branch_id, sale_id) REFERENCES poc.sales(tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, company_id, product_id) REFERENCES poc.products(tenant_id, company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, company_id, product_id, variant_id) REFERENCES poc.product_variants(tenant_id, company_id, product_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (unit_id) REFERENCES poc.units_of_measure(id) ON DELETE RESTRICT
);

CREATE TABLE poc.payment_groups (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  currency_code char(3) NOT NULL,
  expected_amount numeric(19,6) NOT NULL CHECK (expected_amount >= 0),
  UNIQUE (tenant_id, company_id, branch_id, id),
  UNIQUE (tenant_id, sale_id),
  FOREIGN KEY (tenant_id, company_id, branch_id, sale_id) REFERENCES poc.sales(tenant_id, company_id, branch_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.payments (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  payment_group_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('CASH','CARD','TRANSFER','QR')),
  expected_amount numeric(19,6) NOT NULL CHECK (expected_amount > 0),
  confirmed_amount numeric(19,6) NOT NULL DEFAULT 0 CHECK (confirmed_amount >= 0),
  currency_code char(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('CREATED','PENDING','PARTIALLY_CONFIRMED','CONFIRMED','FAILED','CANCELLED','REVIEW_REQUIRED')),
  idempotency_key text NOT NULL,
  request_checksum text NOT NULL CHECK (request_checksum ~ '^[0-9a-f]{64}$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, company_id, branch_id, payment_group_id) REFERENCES poc.payment_groups(tenant_id, company_id, branch_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.payment_attempts (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL CHECK (status IN ('CREATED','PROCESSING','PENDING','CONFIRMED','DECLINED','FAILED','UNKNOWN_OUTCOME')),
  provider_type text,
  provider_reference text,
  evidence_checksum text CHECK (evidence_checksum IS NULL OR evidence_checksum ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, payment_id, attempt_number),
  UNIQUE (tenant_id, provider_type, provider_reference),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES poc.payments(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.sync_operations (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  origin_device_id uuid NOT NULL,
  device_sequence bigint NOT NULL CHECK (device_sequence > 0),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL CHECK (poc.is_uuid_v7(aggregate_id)),
  idempotency_key text NOT NULL,
  payload_checksum text NOT NULL CHECK (payload_checksum ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('LOCAL_PENDING','READY_TO_SYNC','SERVER_ACCEPTED','SERVER_REJECTED','CONFLICT','REVIEW_REQUIRED')),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, origin_device_id, device_sequence),
  UNIQUE (tenant_id, origin_device_id, idempotency_key),
  FOREIGN KEY (tenant_id, company_id, branch_id, origin_device_id) REFERENCES poc.devices(tenant_id, company_id, branch_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.outbox_entries (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  origin_device_id uuid NOT NULL,
  device_sequence bigint NOT NULL CHECK (device_sequence > 0),
  state text NOT NULL CHECK (state IN ('PENDING','SENDING','ACKNOWLEDGED','RETRY_SCHEDULED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz,
  UNIQUE (tenant_id, operation_id),
  UNIQUE (tenant_id, origin_device_id, device_sequence),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES poc.sync_operations(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.inbox_entries (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  payload_checksum text NOT NULL CHECK (payload_checksum ~ '^[0-9a-f]{64}$'),
  result_code text NOT NULL,
  result_checksum text NOT NULL CHECK (result_checksum ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL,
  UNIQUE (tenant_id, operation_id),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES poc.sync_operations(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.sync_checkpoints (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  device_id uuid NOT NULL,
  stream_name text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('UPLOAD','DOWNLOAD')),
  contiguous_sequence bigint NOT NULL CHECK (contiguous_sequence >= 0),
  last_operation_id uuid,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (tenant_id, device_id, stream_name, direction),
  FOREIGN KEY (tenant_id, last_operation_id) REFERENCES poc.sync_operations(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.inventory_movements (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  lot_id uuid,
  movement_type text NOT NULL CHECK (movement_type IN ('SALE_OUT','RECEIPT_IN','POSITIVE_ADJUSTMENT','NEGATIVE_ADJUSTMENT','WASTE')),
  direction text NOT NULL CHECK (direction IN ('IN','OUT')),
  quantity numeric(19,6) NOT NULL CHECK (quantity > 0),
  reason_code text,
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, operation_id, id),
  FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES poc.branches(tenant_id, company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, company_id, product_id) REFERENCES poc.products(tenant_id, company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, company_id, product_id, lot_id) REFERENCES poc.inventory_lots(tenant_id, company_id, product_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, operation_id) REFERENCES poc.sync_operations(tenant_id, id) ON DELETE RESTRICT,
  CHECK (movement_type <> 'WASTE' OR (direction = 'OUT' AND reason_code IS NOT NULL))
);

CREATE TABLE poc.audit_events (
  id uuid PRIMARY KEY CHECK (poc.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid,
  branch_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL CHECK (poc.is_uuid_v7(resource_id)),
  operation_id uuid,
  actor_type text NOT NULL,
  actor_id uuid,
  result text NOT NULL CHECK (result IN ('SUCCESS','REJECTED','CONFLICT')),
  evidence_checksum text CHECK (evidence_checksum IS NULL OR evidence_checksum ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES poc.sync_operations(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE poc.test_results (
  name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL
);

CREATE FUNCTION poc.test_assert(p_name text, p_condition boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $function$
BEGIN
  INSERT INTO poc.test_results VALUES(p_name,COALESCE(p_condition,false),p_detail)
  ON CONFLICT(name) DO UPDATE SET passed=EXCLUDED.passed,detail=EXCLUDED.detail;
END
$function$;

CREATE FUNCTION poc.test_expect_error(p_name text, p_sql text, p_states text[] DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $function$
DECLARE actual_state text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    PERFORM poc.test_assert(p_name,false,'statement unexpectedly succeeded');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
    PERFORM poc.test_assert(p_name,p_states IS NULL OR actual_state=ANY(p_states),'sqlstate='||actual_state);
  END;
END
$function$;

CREATE FUNCTION poc.complete_sale(
  p_sale_id uuid, p_item_id uuid, p_operation_id uuid, p_outbox_id uuid, p_audit_id uuid,
  p_tenant_id uuid, p_company_id uuid, p_branch_id uuid, p_device_id uuid, p_product_id uuid,
  p_variant_id uuid, p_unit_id uuid, p_quantity text, p_amount text, p_rate text,
  p_idempotency_key text, p_checksum text, p_device_sequence bigint, p_fail_step text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $function$
BEGIN
  INSERT INTO poc.sales VALUES (
    p_sale_id, p_tenant_id, p_company_id, p_branch_id, p_device_id, 'COMPLETED', DATE '2026-08-14', 'COP',
    poc.decimal_6(p_amount), '{"schema_version":1,"pricing_version":1}',
    '{"schema_version":1,"tax_version":1}', p_idempotency_key, p_checksum, 1, clock_timestamp()
  );
  IF p_fail_step = 'SALE' THEN RAISE EXCEPTION 'injected after sale'; END IF;
  INSERT INTO poc.sale_items VALUES (
    p_item_id, p_tenant_id, p_company_id, p_branch_id, p_sale_id, 1, p_product_id, p_variant_id, p_unit_id,
    poc.decimal_6(p_quantity), poc.decimal_6(p_amount), poc.decimal_10(p_rate), poc.decimal_6(p_amount)
  );
  INSERT INTO poc.sync_operations VALUES (
    p_operation_id, p_tenant_id, p_company_id, p_branch_id, p_device_id, p_device_sequence, 'SALE', p_sale_id,
    p_idempotency_key, p_checksum, 'READY_TO_SYNC', clock_timestamp()
  );
  INSERT INTO poc.audit_events VALUES (
    p_audit_id, p_tenant_id, p_company_id, p_branch_id, 'SALE_COMPLETED', 'SALE', p_sale_id,
    p_operation_id, 'USER', NULL, 'SUCCESS', p_checksum, clock_timestamp()
  );
  IF p_fail_step = 'AUDIT' THEN RAISE EXCEPTION 'injected after audit'; END IF;
  INSERT INTO poc.outbox_entries VALUES (
    p_outbox_id, p_tenant_id, p_operation_id, p_device_id, p_device_sequence, 'PENDING', 0, clock_timestamp()
  );
  IF p_fail_step = 'OUTBOX' THEN RAISE EXCEPTION 'injected after outbox'; END IF;
END
$function$;

CREATE FUNCTION poc.record_inventory(
  p_movement_id uuid, p_operation_id uuid, p_outbox_id uuid, p_audit_id uuid,
  p_tenant_id uuid, p_company_id uuid, p_branch_id uuid, p_device_id uuid,
  p_product_id uuid, p_lot_id uuid, p_policy_id uuid, p_type text, p_direction text,
  p_quantity text, p_reason text, p_idempotency_key text, p_checksum text, p_sequence bigint,
  p_fail_step text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $function$
DECLARE current_amount numeric(19,6); next_amount numeric(19,6); allow_negative boolean;
BEGIN
  SELECT negative_stock_allowed INTO STRICT allow_negative FROM poc.inventory_policy_versions
   WHERE tenant_id=p_tenant_id AND company_id=p_company_id AND id=p_policy_id AND status='PUBLISHED';
  INSERT INTO poc.sync_operations VALUES (
    p_operation_id,p_tenant_id,p_company_id,p_branch_id,p_device_id,p_sequence,'INVENTORY_MOVEMENT',p_movement_id,
    p_idempotency_key,p_checksum,'READY_TO_SYNC',clock_timestamp()
  );
  INSERT INTO poc.inventory_movements VALUES (
    p_movement_id,p_tenant_id,p_company_id,p_branch_id,p_product_id,p_lot_id,p_type,p_direction,
    poc.decimal_6(p_quantity),p_reason,p_operation_id,clock_timestamp()
  );
  IF p_fail_step = 'MOVEMENT' THEN RAISE EXCEPTION 'injected after movement'; END IF;
  INSERT INTO poc.stock_balances(tenant_id,company_id,branch_id,product_id,lot_id,on_hand_quantity,reserved_quantity,version)
  VALUES(p_tenant_id,p_company_id,p_branch_id,p_product_id,p_lot_id,0,0,1)
  ON CONFLICT (tenant_id,company_id,branch_id,product_id) DO NOTHING;
  SELECT on_hand_quantity INTO current_amount FROM poc.stock_balances
   WHERE tenant_id=p_tenant_id AND company_id=p_company_id AND branch_id=p_branch_id AND product_id=p_product_id
   FOR UPDATE;
  next_amount := current_amount + CASE WHEN p_direction='IN' THEN poc.decimal_6(p_quantity) ELSE -poc.decimal_6(p_quantity) END;
  IF next_amount < 0 AND NOT allow_negative THEN RAISE EXCEPTION 'negative stock rejected by policy' USING ERRCODE='23514'; END IF;
  UPDATE poc.stock_balances SET on_hand_quantity=next_amount,lot_id=p_lot_id,version=version+1
   WHERE tenant_id=p_tenant_id AND company_id=p_company_id AND branch_id=p_branch_id AND product_id=p_product_id;
  INSERT INTO poc.audit_events VALUES (
    p_audit_id,p_tenant_id,p_company_id,p_branch_id,'INVENTORY_RECORDED','INVENTORY_MOVEMENT',p_movement_id,
    p_operation_id,'USER',NULL,'SUCCESS',p_checksum,clock_timestamp()
  );
  INSERT INTO poc.outbox_entries VALUES(p_outbox_id,p_tenant_id,p_operation_id,p_device_id,p_sequence,'PENDING',0,clock_timestamp());
  IF p_fail_step = 'OUTBOX' THEN RAISE EXCEPTION 'injected after outbox'; END IF;
END
$function$;

CREATE FUNCTION poc.confirm_payment(
  p_payment_id uuid, p_attempt_id uuid, p_operation_id uuid, p_outbox_id uuid, p_audit_id uuid,
  p_tenant_id uuid, p_company_id uuid, p_branch_id uuid, p_device_id uuid,
  p_provider_type text, p_provider_reference text, p_checksum text, p_sequence bigint, p_expected_version bigint,
  p_fail_step text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql AS $function$
DECLARE affected integer; payment_amount numeric(19,6);
BEGIN
  SELECT expected_amount INTO STRICT payment_amount FROM poc.payments WHERE tenant_id=p_tenant_id AND id=p_payment_id FOR UPDATE;
  UPDATE poc.payments SET status='CONFIRMED', confirmed_amount=expected_amount, version=version+1
   WHERE tenant_id=p_tenant_id AND id=p_payment_id AND version=p_expected_version AND status IN ('CREATED','PENDING');
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN RETURN false; END IF;
  INSERT INTO poc.payment_attempts VALUES(
    p_attempt_id,p_tenant_id,p_payment_id,1,'CONFIRMED',p_provider_type,p_provider_reference,p_checksum,clock_timestamp()
  );
  INSERT INTO poc.sync_operations VALUES(
    p_operation_id,p_tenant_id,p_company_id,p_branch_id,p_device_id,p_sequence,'PAYMENT',p_payment_id,
    'payment-confirm-'||p_payment_id::text,p_checksum,'READY_TO_SYNC',clock_timestamp()
  );
  INSERT INTO poc.audit_events VALUES(
    p_audit_id,p_tenant_id,p_company_id,p_branch_id,'PAYMENT_CONFIRMED','PAYMENT',p_payment_id,p_operation_id,
    'PROVIDER_ADAPTER',NULL,'SUCCESS',p_checksum,clock_timestamp()
  );
  IF p_fail_step = 'AUDIT' THEN RAISE EXCEPTION 'injected after audit'; END IF;
  INSERT INTO poc.outbox_entries VALUES(p_outbox_id,p_tenant_id,p_operation_id,p_device_id,p_sequence,'PENDING',0,clock_timestamp());
  RETURN true;
END
$function$;

CREATE FUNCTION poc.receive_operation(
  p_inbox_id uuid, p_tenant_id uuid, p_operation_id uuid, p_payload_checksum text,
  p_result_code text, p_result_checksum text
) RETURNS text LANGUAGE plpgsql AS $function$
DECLARE prior poc.inbox_entries%ROWTYPE;
BEGIN
  SELECT * INTO prior FROM poc.inbox_entries WHERE tenant_id=p_tenant_id AND operation_id=p_operation_id;
  IF FOUND THEN
    IF prior.payload_checksum <> p_payload_checksum THEN RAISE EXCEPTION 'payload checksum mismatch' USING ERRCODE='23505'; END IF;
    RETURN prior.result_code;
  END IF;
  INSERT INTO poc.inbox_entries VALUES(p_inbox_id,p_tenant_id,p_operation_id,p_payload_checksum,p_result_code,p_result_checksum,clock_timestamp());
  RETURN p_result_code;
END
$function$;

CREATE FUNCTION poc.advance_checkpoint(
  p_tenant_id uuid, p_device_id uuid, p_stream text, p_sequence bigint, p_operation_id uuid, p_expected_version bigint
) RETURNS boolean LANGUAGE plpgsql AS $function$
DECLARE affected integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM poc.inbox_entries WHERE tenant_id=p_tenant_id AND operation_id=p_operation_id
  ) THEN RAISE EXCEPTION 'durable inbox result required' USING ERRCODE='23503'; END IF;
  UPDATE poc.sync_checkpoints SET contiguous_sequence=p_sequence,last_operation_id=p_operation_id,version=version+1
   WHERE tenant_id=p_tenant_id AND device_id=p_device_id AND stream_name=p_stream AND direction='UPLOAD'
     AND version=p_expected_version AND p_sequence=contiguous_sequence+1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected=1;
END
$function$;

CREATE FUNCTION poc.publish_price(
  p_id uuid,p_tenant_id uuid,p_company_id uuid,p_product_id uuid,p_version bigint,p_amount text,p_priority integer,
  p_from timestamptz,p_until timestamptz,p_checksum text,p_expected_parent bigint
) RETURNS void LANGUAGE plpgsql AS $function$
DECLARE current_version bigint;
BEGIN
  PERFORM 1 FROM poc.products WHERE tenant_id=p_tenant_id AND company_id=p_company_id AND id=p_product_id FOR UPDATE;
  SELECT COALESCE(max(version_number),0) INTO current_version FROM poc.pricing_versions
   WHERE tenant_id=p_tenant_id AND company_id=p_company_id AND product_id=p_product_id;
  IF current_version <> p_expected_parent THEN RAISE EXCEPTION 'expected version conflict' USING ERRCODE='40001'; END IF;
  IF EXISTS (SELECT 1 FROM poc.pricing_versions WHERE tenant_id=p_tenant_id AND company_id=p_company_id
    AND product_id=p_product_id AND status='PUBLISHED' AND priority=p_priority
    AND tstzrange(valid_from,valid_until,'[)') && tstzrange(p_from,p_until,'[)'))
  THEN RAISE EXCEPTION 'pricing priority/validity conflict' USING ERRCODE='23P01'; END IF;
  INSERT INTO poc.pricing_versions VALUES(
    p_id,p_tenant_id,p_company_id,p_product_id,p_version,poc.decimal_6(p_amount),p_priority,p_from,p_until,
    'PUBLISHED',p_checksum,p_expected_parent
  );
END
$function$;

CREATE INDEX sales_branch_date_idx ON poc.sales(tenant_id, branch_id, business_date);
CREATE INDEX inventory_product_branch_idx ON poc.inventory_movements(tenant_id, product_id, branch_id, created_at);
CREATE INDEX payments_group_idx ON poc.payments(tenant_id, payment_group_id);
CREATE INDEX outbox_pending_idx ON poc.outbox_entries(tenant_id, state, next_attempt_at, device_sequence);
CREATE INDEX inbox_operation_idx ON poc.inbox_entries(tenant_id, operation_id);

CREATE TRIGGER audit_no_update_delete BEFORE UPDATE OR DELETE ON poc.audit_events FOR EACH ROW EXECUTE FUNCTION poc.reject_update_delete();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON poc.audit_events FOR EACH STATEMENT EXECUTE FUNCTION poc.reject_truncate();
CREATE TRIGGER movements_no_update_delete BEFORE UPDATE OR DELETE ON poc.inventory_movements FOR EACH ROW EXECUTE FUNCTION poc.reject_update_delete();
CREATE TRIGGER facts_no_delete BEFORE DELETE ON poc.sales FOR EACH ROW EXECUTE FUNCTION poc.reject_update_delete();
CREATE TRIGGER payments_no_delete BEFORE DELETE ON poc.payments FOR EACH ROW EXECUTE FUNCTION poc.reject_update_delete();
CREATE TRIGGER operations_no_delete BEFORE DELETE ON poc.sync_operations FOR EACH ROW EXECUTE FUNCTION poc.reject_update_delete();
CREATE TRIGGER outbox_no_delete BEFORE DELETE ON poc.outbox_entries FOR EACH ROW EXECUTE FUNCTION poc.reject_update_delete();
CREATE TRIGGER inbox_no_update_delete BEFORE UPDATE OR DELETE ON poc.inbox_entries FOR EACH ROW EXECUTE FUNCTION poc.reject_update_delete();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'companies','branches','devices','products','product_variants','pricing_versions','tax_versions',
    'inventory_lots','inventory_policy_versions','stock_balances','sales','sale_items','payment_groups','payments','payment_attempts',
    'sync_operations','outbox_entries','inbox_entries','sync_checkpoints','inventory_movements','audit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE poc.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE poc.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON poc.%I USING (tenant_id = poc.current_tenant_id()) WITH CHECK (tenant_id = poc.current_tenant_id())', table_name);
  END LOOP;
END
$rls$;

RESET ROLE;
GRANT USAGE ON SCHEMA poc TO physical_poc_app, physical_poc_worker, physical_poc_test_executor;
GRANT EXECUTE ON FUNCTION poc.current_tenant_id(), poc.is_uuid_v7(uuid), poc.decimal_6(text), poc.decimal_10(text), poc.decimal_2(text) TO physical_poc_app, physical_poc_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA poc TO physical_poc_app, physical_poc_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA poc TO physical_poc_app, physical_poc_worker;
GRANT SELECT, INSERT, UPDATE ON poc.test_results TO physical_poc_test_executor;
REVOKE UPDATE, DELETE, TRUNCATE ON poc.audit_events FROM physical_poc_app, physical_poc_worker;
REVOKE UPDATE, DELETE, TRUNCATE ON poc.inventory_movements FROM physical_poc_app, physical_poc_worker;
REVOKE DELETE, TRUNCATE ON poc.sales, poc.payments, poc.sync_operations, poc.outbox_entries, poc.inbox_entries FROM physical_poc_app, physical_poc_worker;
REVOKE UPDATE ON poc.inbox_entries FROM physical_poc_app, physical_poc_worker;
REVOKE CREATE ON SCHEMA poc FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA poc FROM PUBLIC;

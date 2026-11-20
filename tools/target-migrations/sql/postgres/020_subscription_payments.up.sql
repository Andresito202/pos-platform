CREATE SCHEMA payments AUTHORIZATION pos_schema_owner;
REVOKE ALL ON SCHEMA payments FROM PUBLIC;
CREATE TABLE payments.payment_groups (
  id uuid PRIMARY KEY CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,company_id uuid NOT NULL,branch_id uuid NOT NULL,
  collection_subject_type text NOT NULL CHECK (collection_subject_type='SUBSCRIPTION_QUOTE'),
  collection_subject_id uuid NOT NULL REFERENCES subscriptions.license_quotes(id) ON DELETE NO ACTION,
  currency_code char(3) NOT NULL CHECK (currency_code='COP'),
  expected_payable_amount numeric(19,6) NOT NULL CHECK (expected_payable_amount>0),
  idempotency_key text NOT NULL,request_checksum text NOT NULL CHECK (request_checksum ~ '^[a-f0-9]{64}$'),
  correlation_id uuid NOT NULL CHECK (platform.is_uuid_v7(correlation_id)),causation_id uuid NULL,created_at timestamptz NOT NULL,
  UNIQUE(tenant_id,company_id,branch_id,id),UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,collection_subject_type,collection_subject_id),
  FOREIGN KEY(tenant_id,company_id,branch_id) REFERENCES organization.branches(tenant_id,company_id,id) ON DELETE NO ACTION
);
CREATE TABLE payments.payments (
  id uuid PRIMARY KEY CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,company_id uuid NOT NULL,branch_id uuid NOT NULL,payment_group_id uuid NOT NULL,
  payment_method text NOT NULL CHECK (payment_method='QR'),
  expected_amount numeric(19,6) NOT NULL CHECK (expected_amount>0),
  confirmed_amount numeric(19,6) NOT NULL DEFAULT 0 CHECK (confirmed_amount>=0 AND confirmed_amount<=expected_amount),
  currency_code char(3) NOT NULL CHECK (currency_code='COP'),
  status text NOT NULL CHECK (status IN ('CREATED','PENDING','PARTIALLY_CONFIRMED','CONFIRMED','FAILED','CANCELLED','REVIEW_REQUIRED')),
  authority_type text NOT NULL CHECK (authority_type='EXTERNAL_PROVIDER_AUTHORITATIVE'),
  origin_device_id uuid NULL CHECK (origin_device_id IS NULL),operator_actor_type text NOT NULL CHECK (operator_actor_type='SYSTEM'),operator_actor_id uuid NULL CHECK (operator_actor_id IS NULL),
  idempotency_key text NOT NULL,request_checksum text NOT NULL CHECK (request_checksum ~ '^[a-f0-9]{64}$'),
  correlation_id uuid NOT NULL CHECK (platform.is_uuid_v7(correlation_id)),causation_id uuid NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version>=1),created_at timestamptz NOT NULL,confirmed_at timestamptz NULL,server_recorded_at timestamptz NOT NULL,
  UNIQUE(tenant_id,company_id,branch_id,id),UNIQUE(tenant_id,payment_group_id),UNIQUE(tenant_id,payment_group_id,id),
  UNIQUE NULLS NOT DISTINCT(tenant_id,origin_device_id,idempotency_key),
  FOREIGN KEY(tenant_id,company_id,branch_id,payment_group_id) REFERENCES payments.payment_groups(tenant_id,company_id,branch_id,id) ON DELETE NO ACTION,
  CHECK (status<>'CONFIRMED' OR (confirmed_amount=expected_amount AND confirmed_at IS NOT NULL))
);
CREATE TABLE payments.payment_attempts (
  id uuid PRIMARY KEY CHECK (platform.is_uuid_v7(id)),tenant_id uuid NOT NULL,company_id uuid NOT NULL,branch_id uuid NOT NULL,payment_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number>=1),payment_method text NOT NULL CHECK (payment_method='QR'),
  provider_configuration_version_id uuid NULL,provider_code text NOT NULL CHECK (provider_code='FACTUS_PAY'),
  provider_reference_type text NOT NULL CHECK (provider_reference_type='COLLECTION'),provider_reference text NOT NULL,
  integration_id uuid NOT NULL,
  amount numeric(19,6) NOT NULL CHECK (amount>0),currency_code char(3) NOT NULL CHECK (currency_code='COP'),
  status text NOT NULL CHECK (status IN ('CREATED','PENDING','PROCESSING','REQUIRES_ACTION','CONFIRMED','DECLINED','FAILED','EXPIRED','CANCELLED','UNKNOWN','REVIEW_REQUIRED')),
  authority_type text NOT NULL CHECK (authority_type='EXTERNAL_PROVIDER_AUTHORITATIVE'),intent_reference text NOT NULL,
  manual_confirmation_actor_id uuid NULL CHECK (manual_confirmation_actor_id IS NULL),
  evidence_schema_version integer NOT NULL DEFAULT 1,evidence_snapshot jsonb NULL,evidence_checksum text NULL CHECK (evidence_checksum IS NULL OR evidence_checksum ~ '^[a-f0-9]{64}$'),
  error_code text NULL,retry_classification text NULL,idempotency_key text NOT NULL,request_checksum text NOT NULL CHECK (request_checksum ~ '^[a-f0-9]{64}$'),
  correlation_id uuid NOT NULL CHECK (platform.is_uuid_v7(correlation_id)),causation_id uuid NULL,version bigint NOT NULL DEFAULT 1 CHECK (version>=1),
  initiated_at timestamptz NOT NULL,provider_reported_at timestamptz NULL,confirmed_at timestamptz NULL,server_recorded_at timestamptz NOT NULL,
  UNIQUE(tenant_id,payment_id,attempt_number),UNIQUE(tenant_id,provider_code,provider_reference_type,provider_reference),
  FOREIGN KEY(tenant_id,company_id,branch_id,payment_id) REFERENCES payments.payments(tenant_id,company_id,branch_id,id) ON DELETE NO ACTION,
  FOREIGN KEY(tenant_id,company_id,integration_id) REFERENCES integrations.external_integrations(tenant_id,company_id,id) ON DELETE NO ACTION,
  CHECK(status<>'CONFIRMED' OR (confirmed_at IS NOT NULL AND evidence_snapshot IS NOT NULL AND evidence_checksum IS NOT NULL))
);
CREATE TABLE payments.payment_allocations (
  id uuid PRIMARY KEY CHECK (platform.is_uuid_v7(id)),tenant_id uuid NOT NULL,payment_group_id uuid NOT NULL REFERENCES payments.payment_groups(id) ON DELETE NO ACTION,
  payment_id uuid NOT NULL REFERENCES payments.payments(id) ON DELETE NO ACTION,
  collection_subject_type text NOT NULL CHECK(collection_subject_type='SUBSCRIPTION_QUOTE'),
  collection_subject_id uuid NOT NULL REFERENCES subscriptions.license_quotes(id) ON DELETE NO ACTION,
  amount numeric(19,6) NOT NULL CHECK(amount>0),currency_code char(3) NOT NULL CHECK(currency_code='COP'),
  allocation_sequence integer NOT NULL CHECK(allocation_sequence=1),created_at timestamptz NOT NULL,
  UNIQUE(tenant_id,payment_id,allocation_sequence),
  FOREIGN KEY(tenant_id,payment_group_id) REFERENCES payments.payment_groups(tenant_id,id) ON DELETE NO ACTION,
  FOREIGN KEY(tenant_id,payment_group_id,payment_id) REFERENCES payments.payments(tenant_id,payment_group_id,id) ON DELETE NO ACTION
);
CREATE FUNCTION payments.guard_subscription_sources() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='payment_groups' THEN
    IF NOT EXISTS(SELECT 1 FROM subscriptions.license_quotes q WHERE q.id=NEW.collection_subject_id
      AND q.merchant_tenant_id=NEW.tenant_id AND q.merchant_company_id=NEW.company_id AND q.currency_code=NEW.currency_code
      AND q.expires_at>clock_timestamp() AND NEW.expected_payable_amount=q.total_minor::numeric/power(10::numeric,q.currency_exponent))
    THEN RAISE EXCEPTION 'subscription quote financial binding mismatch'; END IF;
  ELSIF TG_TABLE_NAME='payments' THEN
    IF NEW.status<>'CREATED' OR NEW.confirmed_amount<>0 OR NOT EXISTS(SELECT 1 FROM payments.payment_groups g
      WHERE g.id=NEW.payment_group_id AND g.tenant_id=NEW.tenant_id AND g.expected_payable_amount=NEW.expected_amount AND g.currency_code=NEW.currency_code)
    THEN RAISE EXCEPTION 'subscription payment initial source mismatch'; END IF;
  ELSIF TG_TABLE_NAME='payment_attempts' THEN
    IF NEW.status<>'CREATED' OR NOT EXISTS(SELECT 1 FROM payments.payments p JOIN payments.payment_groups g ON g.id=p.payment_group_id
      JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id WHERE p.id=NEW.payment_id AND p.tenant_id=NEW.tenant_id
      AND p.expected_amount=NEW.amount AND p.currency_code=NEW.currency_code AND q.integration_id=NEW.integration_id AND q.provider_reference=NEW.provider_reference)
    THEN RAISE EXCEPTION 'subscription attempt reference mismatch'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM payments.payments p JOIN payments.payment_groups g ON g.id=p.payment_group_id
      WHERE p.id=NEW.payment_id AND p.tenant_id=NEW.tenant_id AND p.payment_group_id=NEW.payment_group_id AND p.status='CONFIRMED'
      AND p.confirmed_amount=NEW.amount AND p.currency_code=NEW.currency_code AND g.collection_subject_id=NEW.collection_subject_id)
    THEN RAISE EXCEPTION 'subscription allocation not covered by confirmed payment'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION payments.guard_subscription_sources() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payments.guard_subscription_sources() TO pos_platform_app;
CREATE TRIGGER subscription_group_source BEFORE INSERT ON payments.payment_groups FOR EACH ROW EXECUTE FUNCTION payments.guard_subscription_sources();
CREATE TRIGGER subscription_payment_source BEFORE INSERT ON payments.payments FOR EACH ROW EXECUTE FUNCTION payments.guard_subscription_sources();
CREATE TRIGGER subscription_attempt_source BEFORE INSERT ON payments.payment_attempts FOR EACH ROW EXECUTE FUNCTION payments.guard_subscription_sources();
CREATE TRIGGER subscription_allocation_source BEFORE INSERT ON payments.payment_allocations FOR EACH ROW EXECUTE FUNCTION payments.guard_subscription_sources();
CREATE TRIGGER subscription_payment_group_immutable BEFORE UPDATE OR DELETE ON payments.payment_groups FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
CREATE TRIGGER subscription_payment_allocation_immutable BEFORE UPDATE OR DELETE ON payments.payment_allocations FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
CREATE TRIGGER subscription_payment_immutable BEFORE UPDATE ON payments.payments FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('status,confirmed_amount,confirmed_at,server_recorded_at,version');
CREATE TRIGGER subscription_payment_state BEFORE UPDATE OF status ON payments.payments FOR EACH ROW EXECUTE FUNCTION integrations.guard_state_transition('status','DEFAULT','CREATED>PENDING,PENDING>CONFIRMED,PENDING>REVIEW_REQUIRED');
CREATE TRIGGER subscription_attempt_immutable BEFORE UPDATE ON payments.payment_attempts FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('status,evidence_snapshot,evidence_checksum,error_code,retry_classification,provider_reported_at,confirmed_at,server_recorded_at,version');
CREATE TRIGGER subscription_attempt_state BEFORE UPDATE OF status ON payments.payment_attempts FOR EACH ROW EXECUTE FUNCTION integrations.guard_state_transition('status','DEFAULT','CREATED>PENDING,PENDING>CONFIRMED,PENDING>REVIEW_REQUIRED');
CREATE TRIGGER subscription_payment_no_delete BEFORE DELETE ON payments.payments FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
CREATE TRIGGER subscription_attempt_no_delete BEFORE DELETE ON payments.payment_attempts FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['payment_groups','payments','payment_attempts','payment_allocations'] LOOP
    EXECUTE format('ALTER TABLE payments.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE payments.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY central_only ON payments.%I FOR ALL TO pos_platform_app USING (true) WITH CHECK (true)',table_name);
    EXECUTE format('CREATE POLICY owner_read ON payments.%I FOR SELECT TO pos_schema_owner USING (true)',table_name);
    EXECUTE format('GRANT SELECT,INSERT ON payments.%I TO pos_platform_app',table_name);
    EXECUTE format('GRANT SELECT ON payments.%I TO pos_platform_admin',table_name);
    EXECUTE format('CREATE TRIGGER subscription_payment_no_truncate BEFORE TRUNCATE ON payments.%I FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_append_only_mutation()',table_name);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA payments TO pos_platform_app,pos_platform_admin;
REVOKE ALL ON ALL TABLES IN SCHEMA payments FROM PUBLIC,pos_app,pos_worker,pos_reporting;
GRANT UPDATE(status,confirmed_amount,confirmed_at,server_recorded_at,version) ON payments.payments TO pos_platform_app;
GRANT UPDATE(status,evidence_snapshot,evidence_checksum,error_code,retry_classification,provider_reported_at,confirmed_at,server_recorded_at,version) ON payments.payment_attempts TO pos_platform_app;

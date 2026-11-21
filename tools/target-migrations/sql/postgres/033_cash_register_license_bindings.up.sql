-- A master can exist before device activation. Its paid capacity reservation
-- belongs to Licensing and cannot be released while artifacts can be offline.
CREATE TABLE licensing.cash_register_bindings (
    register_id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    company_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    license_id uuid NOT NULL REFERENCES licensing.licenses(id) ON DELETE NO ACTION,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (tenant_id,company_id,branch_id,register_id)
        REFERENCES cash.cash_registers(tenant_id,company_id,branch_id,id) ON DELETE NO ACTION
);
CREATE INDEX cash_register_binding_capacity_idx
    ON licensing.cash_register_bindings(license_id,register_id);

-- No arbitrary choice among conflicting histories. Missing masters or multiple
-- licenses for one register abort the whole migration and require reconciliation.
INSERT INTO licensing.cash_register_bindings(register_id,tenant_id,company_id,branch_id,license_id)
SELECT DISTINCT (allocation->>'register_id')::uuid,a.tenant_id,a.company_id,
    (allocation->>'branch_id')::uuid,a.license_id
FROM licensing.license_activations a
CROSS JOIN LATERAL jsonb_array_elements(a.request_payload->'allocations') allocation;

INSERT INTO licensing.cash_register_bindings(register_id,tenant_id,company_id,branch_id,license_id)
SELECT DISTINCT resource_id,tenant_id,company_id,branch_id,(new_value->>'licenseId')::uuid
FROM audit.audit_events e
WHERE action_code='CASH_REGISTER_CREATE' AND resource_type='CASH_REGISTER' AND result='SUCCEEDED'
  AND new_value ? 'licenseId'
  AND payload_checksum=encode(sha256(convert_to(new_value::text,'UTF8')),'hex')
  AND NOT EXISTS (SELECT 1 FROM licensing.cash_register_bindings b WHERE b.register_id=e.resource_id
      AND b.tenant_id=e.tenant_id AND b.company_id=e.company_id AND b.branch_id=e.branch_id
      AND b.license_id=(e.new_value->>'licenseId')::uuid);

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM licensing.cash_register_bindings b
        LEFT JOIN licensing.licenses l ON l.id=b.license_id AND l.tenant_id=b.tenant_id
        LEFT JOIN payments.payments p ON l.commercial_reference='SUBSCRIPTION_PAYMENT:'||p.id::text
        LEFT JOIN payments.payment_groups g ON g.id=p.payment_group_id AND g.collection_subject_type='SUBSCRIPTION_QUOTE'
        LEFT JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id
            AND q.tenant_id=b.tenant_id AND q.company_id=b.company_id AND q.plan_id=l.plan_id
        WHERE q.id IS NULL
    ) THEN RAISE EXCEPTION 'CASH_REGISTER_BINDING_HISTORY_RECONCILIATION_REQUIRED'; END IF;
END $$;

ALTER TABLE licensing.cash_register_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE licensing.cash_register_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_register_binding_tenant ON licensing.cash_register_bindings TO pos_platform_app
    USING(tenant_id=platform.current_tenant_id()) WITH CHECK(tenant_id=platform.current_tenant_id());
CREATE POLICY cash_register_binding_owner ON licensing.cash_register_bindings TO pos_schema_owner
    USING(true) WITH CHECK(true);
CREATE POLICY cash_register_binding_worker ON licensing.cash_register_bindings FOR SELECT TO pos_worker
    USING(tenant_id=platform.current_tenant_id());
REVOKE ALL ON licensing.cash_register_bindings FROM PUBLIC,pos_app,pos_reporting,pos_platform_admin;
GRANT SELECT,INSERT ON licensing.cash_register_bindings TO pos_platform_app;
GRANT SELECT ON licensing.cash_register_bindings TO pos_worker;

CREATE FUNCTION licensing.guard_cash_register_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE capacity bigint; reserved bigint;
BEGIN
    IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CASH_REGISTER_BINDING_IMMUTABLE'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('license-capacity:'||NEW.license_id::text,0));
    SELECT q.included_registers::bigint+q.additional_registers INTO capacity
    FROM licensing.licenses l
    JOIN payments.payments p ON l.commercial_reference='SUBSCRIPTION_PAYMENT:'||p.id::text AND p.status='CONFIRMED'
    JOIN payments.payment_groups g ON g.id=p.payment_group_id AND g.collection_subject_type='SUBSCRIPTION_QUOTE'
    JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id AND q.plan_id=l.plan_id
    WHERE l.id=NEW.license_id AND l.tenant_id=NEW.tenant_id
        AND q.tenant_id=NEW.tenant_id AND q.company_id=NEW.company_id;
    IF capacity IS NULL OR capacity<1 THEN RAISE EXCEPTION 'CASH_REGISTER_BINDING_LICENSE_SCOPE_REJECTED'; END IF;
    -- Existing reservations are immutable. A replay does not consume a slot.
    IF EXISTS(SELECT 1 FROM licensing.cash_register_bindings WHERE register_id=NEW.register_id) THEN RETURN NEW; END IF;
    SELECT count(*) INTO reserved FROM licensing.cash_register_bindings WHERE license_id=NEW.license_id;
    IF reserved>=capacity THEN RAISE EXCEPTION 'CASH_REGISTER_CAPACITY_EXHAUSTED'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER cash_register_binding_guard BEFORE INSERT OR UPDATE OR DELETE
    ON licensing.cash_register_bindings FOR EACH ROW EXECUTE FUNCTION licensing.guard_cash_register_binding();
CREATE TRIGGER cash_register_binding_no_truncate BEFORE TRUNCATE ON licensing.cash_register_bindings
    FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_append_only_mutation();
REVOKE ALL ON FUNCTION licensing.guard_cash_register_binding() FROM PUBLIC;

CREATE FUNCTION licensing.require_activation_register_bindings() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.request_payload->'allocations') a
        WHERE NOT EXISTS (
            SELECT 1 FROM licensing.cash_register_bindings b
            WHERE b.register_id=(a->>'register_id')::uuid AND b.branch_id=(a->>'branch_id')::uuid
                AND b.license_id=NEW.license_id AND b.tenant_id=NEW.tenant_id AND b.company_id=NEW.company_id
        )
    ) THEN RAISE EXCEPTION 'CASH_REGISTER_LICENSE_BINDING_CONFLICT'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER license_activation_register_binding_guard BEFORE INSERT ON licensing.license_activations
    FOR EACH ROW EXECUTE FUNCTION licensing.require_activation_register_bindings();
REVOKE ALL ON FUNCTION licensing.require_activation_register_bindings() FROM PUBLIC;

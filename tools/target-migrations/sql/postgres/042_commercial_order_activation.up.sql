-- Both the activation authority and the cash register trigger resolve the
-- same committed order, exact license unit, active company and valid period.
CREATE FUNCTION licensing.current_paid_commercial_order(p_license_id uuid)
RETURNS TABLE(tenant_id uuid, company_id uuid, trade_name text, paid_order jsonb, plan_version bigint)
LANGUAGE sql SET search_path=pg_catalog AS $source$
  SELECT l.tenant_id,co.id,co.trade_name,r.payload->'paidOrder',e.source_plan_version
  FROM licensing.licenses l
  JOIN licensing.commercial_provisioning_receipts r
    ON r.idempotency_key=encode(sha256(convert_to('provision:'||
      substring(l.commercial_reference from '^COMMERCIAL_ORDER:(.*):[0-9]+:[0-9a-f]{16}$'),'UTF8')),'hex')
    AND r.tenant_id=l.tenant_id AND l.id=ANY(r.license_ids)
    AND r.fulfillment='ISSUED' AND cardinality(r.license_ids)=r.license_units
    AND r.payload->>'orderId'=r.order_id AND lower(r.payload->>'tenantId')=l.tenant_id::text
    AND lower(r.payload->>'planId')=l.plan_id::text
    AND l.commercial_reference='COMMERCIAL_ORDER:'||r.order_id||':'||(array_position(r.license_ids,l.id)-1)::text
      ||':'||left(r.payload_hash,16)
  JOIN organization.companies co ON co.tenant_id=l.tenant_id
    AND co.id::text=lower(r.payload->'paidOrder'->>'companyId') AND co.status='ACTIVE'
  JOIN tenancy.tenants t ON t.id=l.tenant_id AND t.status='ACTIVE'
  JOIN licensing.license_entitlements e ON e.license_id=l.id AND e.capability_code='CASH_REGISTER' AND e.enabled
  WHERE l.id=p_license_id AND l.tenant_id=platform.current_tenant_id()
    AND l.policy_version='COMMERCIAL_ORDER_V1' AND l.contract_status='ACTIVE'
    AND l.not_before<=clock_timestamp() AND nullif(btrim(r.payload->'paidOrder'->>'paymentReference'),'') IS NOT NULL
    AND jsonb_typeof(r.payload->'paidOrder'->'paidAt')='string'
    AND ((l.deployment_mode='LOCAL_PERPETUAL' AND l.expires_at IS NULL AND r.payload->'paidOrder'->>'billingInterval'='PERPETUAL')
      OR (l.deployment_mode='HYBRID' AND l.expires_at>clock_timestamp()
        AND r.payload->'paidOrder'->>'billingInterval' IN ('MONTHLY','ANNUAL')))
  FOR SHARE OF co,t
$source$;
REVOKE ALL ON FUNCTION licensing.current_paid_commercial_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION licensing.current_paid_commercial_order(uuid) TO pos_platform_app;

CREATE FUNCTION licensing.guard_paid_commercial_order_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
BEGIN
  IF (OLD.payload ? 'paidOrder' OR NEW.payload ? 'paidOrder') AND (
      (to_jsonb(OLD)-ARRAY['fulfillment','license_ids']) IS DISTINCT FROM
        (to_jsonb(NEW)-ARRAY['fulfillment','license_ids']) OR OLD.fulfillment <> 'QUEUED'
      OR NEW.fulfillment <> 'ISSUED' OR cardinality(OLD.license_ids) <> 0
      OR cardinality(NEW.license_ids) <> NEW.license_units
      OR (SELECT count(DISTINCT id) FROM unnest(NEW.license_ids) AS id) <> NEW.license_units
  ) THEN RAISE EXCEPTION 'COMMERCIAL_PAID_ORDER_RECEIPT_IMMUTABLE'; END IF;
  RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION licensing.guard_paid_commercial_order_receipt() FROM PUBLIC;
CREATE TRIGGER commercial_paid_order_receipt_guard
  BEFORE UPDATE ON licensing.commercial_provisioning_receipts
  FOR EACH ROW EXECUTE FUNCTION licensing.guard_paid_commercial_order_receipt();

CREATE OR REPLACE FUNCTION licensing.guard_cash_register_binding() RETURNS trigger
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
    IF capacity IS NULL AND EXISTS (
        SELECT 1 FROM licensing.current_paid_commercial_order(NEW.license_id) receipt
        WHERE receipt.company_id=NEW.company_id AND receipt.tenant_id=NEW.tenant_id
    ) THEN capacity:=1; END IF;
    IF capacity IS NULL OR capacity<1 THEN RAISE EXCEPTION 'CASH_REGISTER_BINDING_LICENSE_SCOPE_REJECTED'; END IF;
    -- Existing reservations are immutable. A replay does not consume a slot.
    IF EXISTS(SELECT 1 FROM licensing.cash_register_bindings WHERE register_id=NEW.register_id) THEN RETURN NEW; END IF;
    SELECT count(*) INTO reserved FROM licensing.cash_register_bindings WHERE license_id=NEW.license_id;
    IF reserved>=capacity THEN RAISE EXCEPTION 'CASH_REGISTER_CAPACITY_EXHAUSTED'; END IF;
    RETURN NEW;
END $$;

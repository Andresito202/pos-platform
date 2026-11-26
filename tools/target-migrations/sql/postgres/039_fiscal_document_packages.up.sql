CREATE TABLE fiscal.document_package_offers (
  document_count integer PRIMARY KEY CHECK (document_count > 0),
  provider_cost_cop bigint CHECK (provider_cost_cop >= 0),
  sale_price_cop bigint NOT NULL CHECK (sale_price_cop > 0),
  margin_cop bigint GENERATED ALWAYS AS (sale_price_cop - provider_cost_cop) STORED,
  validity_days integer CHECK (validity_days > 0),
  published boolean NOT NULL DEFAULT false,
  CHECK (NOT published OR (provider_cost_cop IS NOT NULL AND validity_days IS NOT NULL))
);
INSERT INTO fiscal.document_package_offers (document_count, sale_price_cop) VALUES
  (150, 169000), (400, 190000), (1600, 220000), (2500, 260000),
  (5000, 290000), (10000, 390000), (15000, 440000), (20000, 490000),
  (35000, 820000), (50000, 1100000), (80000, 1700000), (120000, 2160000);

CREATE TABLE fiscal.document_package_purchases (
  id uuid PRIMARY KEY CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  tax_id text NOT NULL CHECK (btrim(tax_id) <> ''),
  payment_reference uuid NOT NULL UNIQUE,
  acquired integer NOT NULL REFERENCES fiscal.document_package_offers(document_count),
  provider_cost_cop bigint NOT NULL CHECK (provider_cost_cop >= 0),
  sale_price_cop bigint NOT NULL CHECK (sale_price_cop > 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  consumed integer NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES organization.companies(tenant_id, id),
  CHECK (reserved::bigint + consumed <= acquired),
  CHECK (expires_at > starts_at)
);

CREATE TABLE fiscal.document_package_reservations (
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  purchase_id uuid NOT NULL,
  document_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('RESERVED','CONSUMED','RELEASED')),
  PRIMARY KEY (tenant_id, company_id, document_id),
  FOREIGN KEY (tenant_id, company_id, purchase_id) REFERENCES fiscal.document_package_purchases(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, document_id) REFERENCES fiscal.electronic_documents(tenant_id, company_id, id)
);
CREATE TABLE fiscal.document_package_movements (
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  request_id uuid NOT NULL,
  purchase_id uuid NOT NULL,
  document_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('RESERVE','CONSUME','RELEASE')),
  result_state text NOT NULL CHECK (result_state IN ('RESERVED','CONSUMED','RELEASED')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, company_id, request_id),
  FOREIGN KEY (tenant_id, company_id, purchase_id) REFERENCES fiscal.document_package_purchases(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, document_id) REFERENCES fiscal.document_package_reservations(tenant_id, company_id, document_id)
);
CREATE TABLE fiscal.document_package_alerts (
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  purchase_id uuid NOT NULL,
  threshold_percent integer NOT NULL CHECK (threshold_percent IN (20,10,5)),
  available_at_alert integer NOT NULL CHECK (available_at_alert >= 0),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, company_id, purchase_id, threshold_percent),
  FOREIGN KEY (tenant_id, company_id, purchase_id) REFERENCES fiscal.document_package_purchases(tenant_id, company_id, id)
);

ALTER TABLE fiscal.document_package_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal.document_package_offers FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_package_offers_central ON fiscal.document_package_offers TO pos_platform_app USING (true) WITH CHECK (true);
DO $setup$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['document_package_purchases','document_package_reservations','document_package_movements','document_package_alerts']
  LOOP
    EXECUTE format('ALTER TABLE fiscal.%I ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('ALTER TABLE fiscal.%I FORCE ROW LEVEL SECURITY', relation);
    EXECUTE format(
      'CREATE POLICY fiscal_package_company ON fiscal.%I TO pos_schema_owner,pos_platform_app
       USING (tenant_id=platform.current_tenant_id() AND company_id::text=current_setting(''app.company_id'',true))
       WITH CHECK (tenant_id=platform.current_tenant_id() AND company_id::text=current_setting(''app.company_id'',true))', relation);
  END LOOP;
END;
$setup$;

CREATE POLICY fiscal_package_owner_company_evidence ON organization.companies
  FOR SELECT TO pos_schema_owner
  USING (tenant_id=platform.current_tenant_id()
    AND id::text=current_setting('app.company_id',true));

CREATE POLICY fiscal_package_owner_document_evidence ON fiscal.electronic_documents
  FOR SELECT TO pos_schema_owner
  USING (tenant_id=platform.current_tenant_id()
    AND company_id::text=current_setting('app.company_id',true));

CREATE FUNCTION fiscal.check_document_package_holder() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
BEGIN
  IF NEW.reserved <> 0 OR NEW.consumed <> 0 OR NOT EXISTS (
    SELECT 1 FROM organization.companies c WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.company_id
      AND c.status='ACTIVE' AND c.tax_id_normalized=NEW.tax_id
  ) OR NOT EXISTS (
    SELECT 1 FROM fiscal.document_package_offers offer
    WHERE offer.document_count=NEW.acquired AND offer.published
      AND offer.provider_cost_cop=NEW.provider_cost_cop
      AND offer.sale_price_cop=NEW.sale_price_cop
      AND NEW.expires_at-NEW.starts_at=make_interval(days=>offer.validity_days)
  ) THEN
    RAISE EXCEPTION 'FISCAL_PACKAGE_HOLDER_REJECTED';
  END IF;
  RETURN NEW;
END;
$body$;
CREATE TRIGGER document_package_holder_guard BEFORE INSERT ON fiscal.document_package_purchases
  FOR EACH ROW EXECUTE FUNCTION fiscal.check_document_package_holder();

CREATE VIEW fiscal.document_package_balances WITH (security_invoker=true) AS
SELECT id, tenant_id, company_id, tax_id, acquired, acquired AS assigned, reserved, consumed,
  CASE WHEN clock_timestamp() >= starts_at AND clock_timestamp() < expires_at THEN acquired-reserved-consumed ELSE 0 END AS available,
  CASE WHEN clock_timestamp() >= expires_at THEN acquired-reserved-consumed ELSE 0 END AS expired,
  starts_at, expires_at
FROM fiscal.document_package_purchases;

-- Only Central's trusted fiscal workflow may call this after establishing tenant/company.
-- A purchase row is the serialization point for all documents funded by that package.
CREATE FUNCTION fiscal.apply_document_package_movement(p_purchase uuid, p_document uuid, p_request uuid, p_action text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE
  quota fiscal.document_package_purchases%ROWTYPE;
  existing fiscal.document_package_movements%ROWTYPE;
  reservation fiscal.document_package_reservations%ROWTYPE;
  next_state text;
BEGIN
  IF p_document IS NULL OR p_request IS NULL OR p_action IS NULL OR p_action NOT IN ('RESERVE','CONSUME','RELEASE') THEN
    RAISE EXCEPTION 'FISCAL_PACKAGE_ACTION_REJECTED';
  END IF;
  SELECT * INTO quota FROM fiscal.document_package_purchases WHERE id=p_purchase FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FISCAL_PACKAGE_NOT_AVAILABLE'; END IF;

  SELECT * INTO existing FROM fiscal.document_package_movements WHERE request_id=p_request;
  IF FOUND THEN
    IF existing.purchase_id<>p_purchase OR existing.document_id<>p_document OR existing.action<>p_action THEN
      RAISE EXCEPTION 'FISCAL_PACKAGE_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN existing.result_state;
  END IF;

  IF p_action<>'RELEASE' AND NOT EXISTS (
    SELECT 1 FROM organization.companies c WHERE c.tenant_id=quota.tenant_id AND c.id=quota.company_id
      AND c.status='ACTIVE' AND c.tax_id_normalized=quota.tax_id
  ) THEN
    RAISE EXCEPTION 'FISCAL_PACKAGE_HOLDER_REJECTED';
  END IF;

  SELECT * INTO reservation FROM fiscal.document_package_reservations WHERE document_id=p_document;
  IF FOUND AND reservation.purchase_id<>p_purchase THEN RAISE EXCEPTION 'FISCAL_PACKAGE_DOCUMENT_CONFLICT'; END IF;

  IF p_action='RESERVE' AND (reservation.state IS NULL OR reservation.state='RELEASED') THEN
    IF clock_timestamp() < quota.starts_at OR clock_timestamp() >= quota.expires_at
       OR quota.acquired <= quota.reserved+quota.consumed THEN
      RAISE EXCEPTION 'FISCAL_PACKAGE_QUOTA_UNAVAILABLE';
    END IF;
    next_state := 'RESERVED';
    INSERT INTO fiscal.document_package_reservations (tenant_id,company_id,purchase_id,document_id,state)
    VALUES (quota.tenant_id,quota.company_id,quota.id,p_document,next_state)
    ON CONFLICT (tenant_id,company_id,document_id) DO UPDATE SET state=excluded.state
      WHERE document_package_reservations.purchase_id=excluded.purchase_id AND document_package_reservations.state='RELEASED';
    IF NOT FOUND THEN RAISE EXCEPTION 'FISCAL_PACKAGE_DOCUMENT_CONFLICT'; END IF;
    UPDATE fiscal.document_package_purchases SET reserved=reserved+1 WHERE id=quota.id RETURNING * INTO quota;
  ELSIF reservation.state='RESERVED' AND p_action IN ('CONSUME','RELEASE') THEN
    IF NOT EXISTS (
      SELECT 1 FROM fiscal.electronic_documents doc
      WHERE doc.id=p_document AND doc.tenant_id=quota.tenant_id AND doc.company_id=quota.company_id
        AND ((p_action='CONSUME' AND doc.status='ACCEPTED' AND doc.legal_identifier IS NOT NULL)
          OR (p_action='RELEASE' AND doc.status IN ('DRAFT','READY','VOIDED_BEFORE_SUBMISSION')))
    ) THEN
      RAISE EXCEPTION 'FISCAL_PACKAGE_DOCUMENT_EVIDENCE_REQUIRED';
    END IF;
    next_state := CASE WHEN p_action='CONSUME' THEN 'CONSUMED' ELSE 'RELEASED' END;
    UPDATE fiscal.document_package_reservations SET state=next_state WHERE document_id=p_document;
    UPDATE fiscal.document_package_purchases
       SET reserved=reserved-1, consumed=consumed+CASE WHEN p_action='CONSUME' THEN 1 ELSE 0 END
       WHERE id=quota.id RETURNING * INTO quota;
  ELSE
    RAISE EXCEPTION 'FISCAL_PACKAGE_TRANSITION_REJECTED';
  END IF;

  INSERT INTO fiscal.document_package_movements (tenant_id,company_id,request_id,purchase_id,document_id,action,result_state)
    VALUES (quota.tenant_id,quota.company_id,p_request,quota.id,p_document,p_action,next_state);
  IF p_action='RESERVE' THEN
    INSERT INTO fiscal.document_package_alerts (tenant_id,company_id,purchase_id,threshold_percent,available_at_alert)
    SELECT quota.tenant_id,quota.company_id,quota.id,level,quota.acquired-quota.reserved-quota.consumed
    FROM unnest(ARRAY[20,10,5]) AS level
    WHERE (quota.acquired-quota.reserved-quota.consumed)::bigint*100 <= quota.acquired::bigint*level
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN next_state;
END;
$body$;

REVOKE ALL ON FUNCTION fiscal.apply_document_package_movement(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fiscal.check_document_package_holder() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fiscal.apply_document_package_movement(uuid,uuid,uuid,text) TO pos_platform_app;
GRANT SELECT,INSERT,UPDATE ON fiscal.document_package_offers TO pos_platform_app;
GRANT SELECT,INSERT ON fiscal.document_package_purchases TO pos_platform_app;
GRANT SELECT ON fiscal.document_package_reservations, fiscal.document_package_movements,
  fiscal.document_package_alerts, fiscal.document_package_balances TO pos_platform_app;

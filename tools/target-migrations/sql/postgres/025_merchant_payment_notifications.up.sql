-- QR-002: Durable UNVERIFIED Nequi Negocios SMS observations, NOT bank settlement.
-- Deployment is NOT permitted until the exact bridge is enrolled and its
-- merchant consent is present. No SMS-body, amounts or banking credentials.
-- The application MUST derive the scope from an authenticated device proof.
CREATE TABLE payments.merchant_notification_bridge_consents (
 tenant_id uuid NOT NULL,
 company_id uuid NOT NULL,
 installation_id uuid NOT NULL,
 granted_by uuid NOT NULL,
 granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz,
 PRIMARY KEY(tenant_id,company_id,installation_id),
 FOREIGN KEY (tenant_id,company_id) REFERENCES organization.companies(tenant_id,id),
 FOREIGN KEY (installation_id) REFERENCES identity.device_registry(installation_id),
 CHECK(revoked_at IS NULL OR revoked_at>=granted_at)
);

CREATE TABLE payments.merchant_payment_notification_inbox (
 id uuid PRIMARY KEY CHECK(platform.is_uuid_v7(id)),
 tenant_id uuid NOT NULL,
 company_id uuid NOT NULL,
 source_installation_id uuid NOT NULL,
 source text NOT NULL DEFAULT 'NEQUI_NEGOCIOS_SHARED_SMS'
   CHECK(source='NEQUI_NEGOCIOS_SHARED_SMS'),
 message_sha256 text NOT NULL CHECK(message_sha256 ~ '^[a-f0-9]{64}$'),
 observed_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL,
 sender_label text NOT NULL CHECK(char_length(sender_label) BETWEEN 1 AND 64),
 status text NOT NULL DEFAULT 'UNVERIFIED' CHECK(status='UNVERIFIED'),
 bank_confirmed boolean NOT NULL DEFAULT false CHECK(bank_confirmed=false),
 sale_confirmed boolean NOT NULL DEFAULT false CHECK(sale_confirmed=false),
 requires_independent_reconciliation boolean NOT NULL DEFAULT true
   CHECK(requires_independent_reconciliation=true),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,company_id,source_installation_id,message_sha256),
 FOREIGN KEY (tenant_id,company_id) REFERENCES organization.companies(tenant_id,id),
 FOREIGN KEY (tenant_id,company_id,source_installation_id)
   REFERENCES payments.merchant_notification_bridge_consents(tenant_id,company_id,installation_id),
 CHECK(observed_at<=received_at+interval '5 minutes'),
 CHECK(received_at<=created_at+interval '5 minutes')
);
CREATE INDEX merchant_notification_company_recent
 ON payments.merchant_payment_notification_inbox(tenant_id,company_id,received_at DESC,id DESC);

-- Consent can only be revoked, never edited/reissued in place.
-- Re-enrollment requires a new security-approved installation identity.
CREATE FUNCTION payments.guard_merchant_notice_consent()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guard$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.tenant_id,NEW.company_id,NEW.installation_id,NEW.granted_by,NEW.granted_at)
    IS DISTINCT FROM
    ROW(OLD.tenant_id,OLD.company_id,OLD.installation_id,OLD.granted_by,OLD.granted_at)
    OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'merchant notice consent cannot be modified or regranted';
  END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM identity.device_registry d
     WHERE d.installation_id=NEW.installation_id
       AND d.tenant_id=NEW.tenant_id AND d.company_id=NEW.company_id
       AND d.status='ACTIVE') THEN
    RAISE EXCEPTION 'merchant notice consent device not active for company';
 END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER merchant_notice_consent_guard
 BEFORE INSERT OR UPDATE ON payments.merchant_notification_bridge_consents
 FOR EACH ROW EXECUTE FUNCTION payments.guard_merchant_notice_consent();

-- Ingest and revocation serialize on the consent row. A bridge disabled by
-- Administration must NOT insert an additional notification after revocation.
CREATE FUNCTION payments.guard_merchant_notice_intake()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM payments.merchant_notification_bridge_consents c
     JOIN identity.device_registry d ON d.installation_id=c.installation_id
       AND d.tenant_id=c.tenant_id AND d.company_id=c.company_id
     WHERE c.tenant_id=NEW.tenant_id AND c.company_id=NEW.company_id
       AND c.installation_id=NEW.source_installation_id
       AND c.revoked_at IS NULL AND d.status='ACTIVE'
     FOR SHARE OF c,d) THEN
    RAISE EXCEPTION 'merchant notice bridge has no active consent';
 END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER merchant_notice_intake_guard
 BEFORE INSERT ON payments.merchant_payment_notification_inbox
 FOR EACH ROW EXECUTE FUNCTION payments.guard_merchant_notice_intake();

CREATE TRIGGER merchant_notice_inbox_immutable
 BEFORE UPDATE OR DELETE ON payments.merchant_payment_notification_inbox
 FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
CREATE TRIGGER merchant_notice_consent_no_delete
 BEFORE DELETE ON payments.merchant_notification_bridge_consents
 FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();

DO $setup$ DECLARE object text; BEGIN
 FOREACH object IN ARRAY ARRAY['merchant_notification_bridge_consents',
                              'merchant_payment_notification_inbox'] LOOP
  EXECUTE format('ALTER TABLE payments.%I ENABLE ROW LEVEL SECURITY',object);
  EXECUTE format('ALTER TABLE payments.%I FORCE ROW LEVEL SECURITY',object);
  EXECUTE format($policy$CREATE POLICY merchant_notice_company_scope ON payments.%I
    FOR ALL TO pos_platform_app
    USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
       AND company_id=nullif(current_setting('app.company_id',true),'')::uuid)
    WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
       AND company_id=nullif(current_setting('app.company_id',true),'')::uuid)$policy$,object);
  -- SECURITY DEFINER guards run as pos_schema_owner; FORCE RLS still
  -- applies, so allow ONLY a company-scoped read of the consent row.
  IF object='merchant_notification_bridge_consents' THEN
    EXECUTE format($owner$CREATE POLICY merchant_notice_guard_owner_read ON payments.%I
      FOR SELECT TO pos_schema_owner
      USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
         AND company_id=nullif(current_setting('app.company_id',true),'')::uuid)$owner$,object);
  END IF;
  EXECUTE format('CREATE TRIGGER merchant_notice_no_truncate BEFORE TRUNCATE ON payments.%I FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_append_only_mutation()',object);
  EXECUTE format('REVOKE ALL ON payments.%I FROM PUBLIC,pos_app,pos_worker,pos_reporting',object);
 END LOOP;
END $setup$;
REVOKE ALL ON FUNCTION payments.guard_merchant_notice_consent() FROM PUBLIC;
REVOKE ALL ON FUNCTION payments.guard_merchant_notice_intake() FROM PUBLIC;
GRANT USAGE ON SCHEMA payments TO pos_platform_app;
-- ONLY an authenticated Central admin may insert consent. The store API
-- rejects calls unless the trusted server provides an explicit write gate.
GRANT SELECT,INSERT,UPDATE ON payments.merchant_notification_bridge_consents TO pos_platform_app;
GRANT SELECT,INSERT ON payments.merchant_payment_notification_inbox TO pos_platform_app;

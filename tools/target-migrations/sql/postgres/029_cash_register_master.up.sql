CREATE SCHEMA cash AUTHORIZATION pos_schema_owner;

CREATE TABLE cash.cash_registers (
    id uuid PRIMARY KEY
        CHECK (platform.is_uuid_v7(id)),

    tenant_id uuid NOT NULL,
    company_id uuid NOT NULL,
    branch_id uuid NOT NULL,

    code text NOT NULL
        CHECK (char_length(btrim(code)) BETWEEN 1 AND 64),

    code_normalized text NOT NULL
        CHECK (char_length(btrim(code_normalized)) BETWEEN 1 AND 64),

    name text NOT NULL
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),

    currency_code text NOT NULL
        CHECK (currency_code ~ '^[A-Z]{3}$'),

    status text NOT NULL
        CHECK (status IN ('ACTIVE', 'RETIRED')),

    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    retired_at timestamptz NULL,

    version bigint NOT NULL DEFAULT 1
        CHECK (version >= 1),

    CONSTRAINT cash_register_branch_fk
        FOREIGN KEY (tenant_id, company_id, branch_id)
        REFERENCES organization.branches (tenant_id, company_id, id)
        ON DELETE NO ACTION,

    CONSTRAINT cash_register_code_uq
        UNIQUE (tenant_id, company_id, branch_id, code_normalized),

    CONSTRAINT cash_register_scope_uq
        UNIQUE (tenant_id, company_id, branch_id, id),

    CONSTRAINT cash_register_retirement_ck
        CHECK (
            (status = 'ACTIVE' AND retired_at IS NULL)
            OR
            (status = 'RETIRED' AND retired_at IS NOT NULL
             AND retired_at >= created_at)
        )
);

ALTER TABLE cash.cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash.cash_registers FORCE ROW LEVEL SECURITY;

CREATE POLICY cash_register_tenant_isolation
ON cash.cash_registers
FOR ALL TO pos_platform_app
USING (tenant_id = platform.current_tenant_id())
WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY cash_register_worker_read
ON cash.cash_registers
FOR SELECT TO pos_worker
USING (tenant_id = platform.current_tenant_id());

REVOKE ALL ON SCHEMA cash FROM PUBLIC;
REVOKE ALL ON cash.cash_registers FROM PUBLIC;

GRANT USAGE ON SCHEMA cash TO pos_platform_app, pos_worker;
GRANT SELECT, INSERT, UPDATE ON cash.cash_registers TO pos_platform_app;
GRANT SELECT ON cash.cash_registers TO pos_worker;

CREATE FUNCTION cash.guard_cash_register_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'CASH_REGISTER_DELETE_FORBIDDEN';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
    THEN
        RAISE EXCEPTION 'CASH_REGISTER_IMMUTABLE_FIELD';
    END IF;

    IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'CASH_REGISTER_VERSION_CONFLICT';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE TRIGGER cash_register_mutation_guard
BEFORE UPDATE OR DELETE ON cash.cash_registers
FOR EACH ROW
EXECUTE FUNCTION cash.guard_cash_register_mutation();

REVOKE ALL ON FUNCTION cash.guard_cash_register_mutation()
FROM PUBLIC;

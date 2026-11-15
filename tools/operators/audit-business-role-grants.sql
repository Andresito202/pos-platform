-- Read-only BUSINESS grant drift audit. Never provisions, rewrites or revokes grants.
-- Source: docs/product/roles.md and docs/security/permission-matrix.md.
-- Execute ONLY against a database selected by the operator with:
--   psql -X -v ON_ERROR_STOP=1 -f tools/operators/audit-business-role-grants.sql
-- A successful run means no enumerated forbidden grants/assignment scopes exist
-- in THIS database at THIS instant. It is NOT a BUSINESS login or E2E certification.
-- Do not pipe this through a privileged migration runner or add test grants.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT current_database() AS audited_database,
       current_user AS audited_sql_role,
       transaction_timestamp() AS audited_at;

-- Explain currently effective BUSINESS grants; this query does not infer a role
-- from a user-supplied UI label or from the local development bridge.
SELECT r.code AS business_role,
       r.version AS role_version,
       p.code AS effective_permission,
       g.grant_version,
       g.valid_from,
       g.valid_until
  FROM "authorization".roles r
  JOIN "authorization".role_permission_grants g ON g.role_id = r.id
  JOIN "authorization".permissions p ON p.id = g.permission_id
 WHERE r.scope_type = 'BUSINESS'
   AND r.status = 'ACTIVE'
   AND g.status = 'ACTIVE'
   AND p.status = 'ACTIVE'
   AND g.valid_from <= transaction_timestamp()
   AND (g.valid_until IS NULL OR g.valid_until > transaction_timestamp())
 ORDER BY r.code, r.version, p.code, g.grant_version;

-- Deliberately test only prohibitions explicitly agreed in the four-role
-- commercial policy. Do NOT infer that all other grants are approved.
-- A legitimate additional capability requires a separate policy decision.
DO $business_grant_audit$
DECLARE
    offending RECORD;
BEGIN
    SELECT r.code AS role_code,
           r.version AS role_version,
           p.code AS permission_code,
           g.grant_version
      INTO offending
      FROM "authorization".roles r
      JOIN "authorization".role_permission_grants g ON g.role_id = r.id
      JOIN "authorization".permissions p ON p.id = g.permission_id
     WHERE r.scope_type = 'BUSINESS'
       AND r.status = 'ACTIVE'
       AND g.status = 'ACTIVE'
       AND p.status = 'ACTIVE'
       AND g.valid_from <= transaction_timestamp()
       AND (g.valid_until IS NULL OR g.valid_until > transaction_timestamp())
       AND (
           (r.code IN ('OWNER', 'GENERAL_ADMIN', 'BRANCH_MANAGER', 'SUPERVISOR')
            AND p.code IN ('SALES_SALE_CREATE',
                           'PAYMENTS_PAYMENT_REGISTER',
                           'PAYMENTS_TRANSFER_REPORT',
                           'CASH_SHIFT_OPEN',
                           'CASH_SHIFT_CLOSE'))
           OR
           (r.code = 'SUPERVISOR'
            AND p.code IN ('CATALOG_PRODUCT_REGISTER',
                           'CUSTOMERS_CUSTOMER_REGISTER',
                           'INVENTORY_STOCK_RECEIVE',
                           'INVENTORY_STOCK_ADJUST'))
           OR
           (r.code = 'CASHIER'
            AND p.code IN ('CATALOG_PRODUCT_REGISTER',
                           'INVENTORY_STOCK_RECEIVE',
                           'INVENTORY_STOCK_ADJUST',
                           'LICENSE_PLAN_MANAGE'))
           OR
           (r.code IN ('OWNER', 'GENERAL_ADMIN', 'BRANCH_MANAGER',
                       'SUPERVISOR', 'CASHIER')
            AND p.code = 'LICENSE_PLAN_MANAGE')
       )
     ORDER BY r.code, p.code
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
          'BUSINESS_GRANT_SEPARATION_VIOLATION: role=% version=% permission=% grant_version=%',
          offending.role_code, offending.role_version,
          offending.permission_code, offending.grant_version;
    END IF;

    -- Business assignment table must never point to a PLATFORM-scoped role.
    SELECT a.id AS assignment_id, r.code AS role_code, r.scope_type
      INTO offending
      FROM "authorization".user_role_assignments a
      JOIN "authorization".roles r ON r.id = a.role_id
     WHERE a.status = 'ACTIVE'
       AND r.scope_type <> 'BUSINESS'
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
          'BUSINESS_ASSIGNMENT_PLATFORM_ROLE: assignment=% role=% scope=%',
          offending.assignment_id, offending.role_code, offending.scope_type;
    END IF;
END;
$business_grant_audit$;

SELECT 'BUSINESS_GRANT_STATIC_POLICY_AUDIT_PASSED' AS outcome;
COMMIT;

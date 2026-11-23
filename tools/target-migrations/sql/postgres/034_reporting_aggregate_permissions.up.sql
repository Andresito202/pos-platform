-- REP-001: catalog of branch-scoped aggregate reporting permissions.
-- Codes are available for explicit Central SAS grants. This migration does NOT
-- attach them to GENERAL_ADMIN, SUPERVISOR, CASHIER, or PLATFORM_OWNER roles.
INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES
('01900000-0000-7005-8000-000000000001','REPORTING_SALES_AGGREGATE_READ','REPORTING','Branch aggregate of completed sales','ACTIVE',now()),
('01900000-0000-7005-8000-000000000002','REPORTING_CASH_AGGREGATE_READ','REPORTING','Branch aggregate of open/closing cash shifts','ACTIVE',now()),
('01900000-0000-7005-8000-000000000003','REPORTING_PAYMENTS_AGGREGATE_READ','REPORTING','Branch aggregate of confirmed payments','ACTIVE',now())
ON CONFLICT (code) DO NOTHING;

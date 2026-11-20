INSERT INTO "authorization".roles
(id,code,name,scope_type,version,status,created_at)
VALUES
('01900000-0000-7000-8000-000000000001','PLATFORM_OWNER','Superadministrador global','PLATFORM',1,'ACTIVE',now()),
('01900000-0000-7000-8000-000000000002','GENERAL_ADMIN','Administrador','BUSINESS',1,'ACTIVE',now()),
('01900000-0000-7000-8000-000000000003','SUPERVISOR','Supervisor','BUSINESS',1,'ACTIVE',now()),
('01900000-0000-7000-8000-000000000004','CASHIER','Cajero','BUSINESS',1,'ACTIVE',now());
INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000001','AUDIT_EVENT_READ','AUDIT','AUDIT_EVENT_READ','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000002','BAKERY_PRODUCTION_EXECUTE','BAKERY','BAKERY_PRODUCTION_EXECUTE','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000003','BAKERY_PRODUCTION_READ','BAKERY','BAKERY_PRODUCTION_READ','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000004','BAKERY_RECIPE_MANAGE','BAKERY','BAKERY_RECIPE_MANAGE','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000005','CASH_REGISTER_MANAGE','CASH','CASH_REGISTER_MANAGE','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000006','CASH_SHIFT_CLOSE','CASH','CASH_SHIFT_CLOSE','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000007','CASH_SHIFT_OPEN','CASH','CASH_SHIFT_OPEN','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000008','CATALOG_PRODUCT_READ','CATALOG','CATALOG_PRODUCT_READ','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000009','CATALOG_PRODUCT_REGISTER','CATALOG','CATALOG_PRODUCT_REGISTER','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000010','CUSTOMERS_CUSTOMER_READ','CUSTOMERS','CUSTOMERS_CUSTOMER_READ','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000011','CUSTOMERS_CUSTOMER_REGISTER','CUSTOMERS','CUSTOMERS_CUSTOMER_REGISTER','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000012','FISCAL_DOCUMENT_ISSUE','FISCAL','FISCAL_DOCUMENT_ISSUE','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000013','HARDWARE_CONFIGURE','HARDWARE','HARDWARE_CONFIGURE','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000014','HARDWARE_PRINT','HARDWARE','HARDWARE_PRINT','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000015','HARDWARE_READ','HARDWARE','HARDWARE_READ','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000016','INVENTORY_STOCK_ADJUST','INVENTORY','INVENTORY_STOCK_ADJUST','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000017','INVENTORY_STOCK_READ','INVENTORY','INVENTORY_STOCK_READ','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000018','INVENTORY_STOCK_RECEIVE','INVENTORY','INVENTORY_STOCK_RECEIVE','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000019','LICENSE_ISSUE','LICENSE','LICENSE_ISSUE','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000020','LICENSE_PLAN_MANAGE','LICENSE','LICENSE_PLAN_MANAGE','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000021','LICENSE_REVOKE','LICENSE','LICENSE_REVOKE','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000022','PAYMENTS_PAYMENT_CANCEL','PAYMENTS','PAYMENTS_PAYMENT_CANCEL','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000023','PAYMENTS_PAYMENT_READ','PAYMENTS','PAYMENTS_PAYMENT_READ','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000024','PAYMENTS_PAYMENT_REGISTER','PAYMENTS','PAYMENTS_PAYMENT_REGISTER','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000025','PAYMENTS_PROVIDER_CONFIGURE','PAYMENTS','PAYMENTS_PROVIDER_CONFIGURE','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000026','PAYMENTS_TRANSFER_CONFIRM','PAYMENTS','PAYMENTS_TRANSFER_CONFIRM','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000027','PAYMENTS_TRANSFER_REPORT','PAYMENTS','PAYMENTS_TRANSFER_REPORT','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000028','SALES_RECEIPT_READ','SALES','SALES_RECEIPT_READ','ACTIVE',now());

INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES ('01900000-0000-7001-8000-000000000029','SALES_SALE_CREATE','SALES','SALES_SALE_CREATE','ACTIVE',now());

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000001',id,'01900000-0000-7001-8000-000000000020',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='PLATFORM_OWNER' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000002',id,'01900000-0000-7001-8000-000000000019',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='PLATFORM_OWNER' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000003',id,'01900000-0000-7001-8000-000000000021',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='PLATFORM_OWNER' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000004',id,'01900000-0000-7001-8000-000000000005',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000005',id,'01900000-0000-7001-8000-000000000015',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000006',id,'01900000-0000-7001-8000-000000000013',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000007',id,'01900000-0000-7001-8000-000000000028',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000008',id,'01900000-0000-7001-8000-000000000023',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000009',id,'01900000-0000-7001-8000-000000000022',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000010',id,'01900000-0000-7001-8000-000000000026',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000011',id,'01900000-0000-7001-8000-000000000025',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000012',id,'01900000-0000-7001-8000-000000000017',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000013',id,'01900000-0000-7001-8000-000000000018',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000014',id,'01900000-0000-7001-8000-000000000016',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000015',id,'01900000-0000-7001-8000-000000000008',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000016',id,'01900000-0000-7001-8000-000000000009',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000017',id,'01900000-0000-7001-8000-000000000010',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000018',id,'01900000-0000-7001-8000-000000000011',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000019',id,'01900000-0000-7001-8000-000000000001',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000020',id,'01900000-0000-7001-8000-000000000012',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000021',id,'01900000-0000-7001-8000-000000000004',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000022',id,'01900000-0000-7001-8000-000000000002',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000023',id,'01900000-0000-7001-8000-000000000003',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='GENERAL_ADMIN' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000024',id,'01900000-0000-7001-8000-000000000028',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='SUPERVISOR' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000025',id,'01900000-0000-7001-8000-000000000023',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='SUPERVISOR' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000026',id,'01900000-0000-7001-8000-000000000022',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='SUPERVISOR' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000027',id,'01900000-0000-7001-8000-000000000026',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='SUPERVISOR' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000028',id,'01900000-0000-7001-8000-000000000008',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='SUPERVISOR' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000029',id,'01900000-0000-7001-8000-000000000010',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='SUPERVISOR' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000030',id,'01900000-0000-7001-8000-000000000017',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='SUPERVISOR' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000031',id,'01900000-0000-7001-8000-000000000003',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='SUPERVISOR' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000032',id,'01900000-0000-7001-8000-000000000014',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='CASHIER' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000033',id,'01900000-0000-7001-8000-000000000007',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='CASHIER' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000034',id,'01900000-0000-7001-8000-000000000006',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='CASHIER' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000035',id,'01900000-0000-7001-8000-000000000029',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='CASHIER' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000036',id,'01900000-0000-7001-8000-000000000028',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='CASHIER' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000037',id,'01900000-0000-7001-8000-000000000024',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='CASHIER' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000038',id,'01900000-0000-7001-8000-000000000023',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='CASHIER' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000039',id,'01900000-0000-7001-8000-000000000027',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='CASHIER' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000040',id,'01900000-0000-7001-8000-000000000008',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='CASHIER' AND version=1 AND status='ACTIVE';

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT '01900000-0000-7002-8000-000000000041',id,'01900000-0000-7001-8000-000000000010',1,'ACTIVE',now(),now()
FROM "authorization".roles
WHERE code='CASHIER' AND version=1 AND status='ACTIVE';
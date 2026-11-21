INSERT INTO "authorization".permissions
(id,code,module,description,status,created_at)
VALUES (
    '01900000-0000-7004-8000-000000000001',
    'TENANT_INITIALIZE',
    'TENANCY',
    'Initialize commercial tenant',
    'ACTIVE',
    now()
);

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT
    '01900000-0000-7004-8000-000000000002',
    r.id,
    p.id,
    1,
    'ACTIVE',
    now(),
    now()
FROM "authorization".roles r
CROSS JOIN "authorization".permissions p
WHERE r.code='PLATFORM_OWNER'
    AND r.scope_type='PLATFORM'
    AND r.version=1
    AND r.status='ACTIVE'
    AND p.code='TENANT_INITIALIZE'
    AND p.status='ACTIVE';
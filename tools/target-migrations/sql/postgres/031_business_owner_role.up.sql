INSERT INTO "authorization".roles
(id,code,name,scope_type,version,status,created_at)
VALUES
(
    '01900000-0000-7000-8000-000000000005',
    'OWNER',
    'Propietario del negocio',
    'BUSINESS',
    1,
    'ACTIVE',
    now()
);

INSERT INTO "authorization".role_permission_grants
(id,role_id,permission_id,grant_version,status,valid_from,created_at)
SELECT
    ('01900000-0000-7003-8000-' ||
     lpad(row_number() OVER (ORDER BY p.code)::text,12,'0'))::uuid,
    owner_role.id,
    p.id,
    1,
    'ACTIVE',
    now(),
    now()
FROM "authorization".roles owner_role
JOIN "authorization".roles admin_role
    ON admin_role.code='GENERAL_ADMIN'
    AND admin_role.version=1
    AND admin_role.status='ACTIVE'
JOIN "authorization".role_permission_grants g
    ON g.role_id=admin_role.id
    AND g.status='ACTIVE'
    AND g.grant_version=1
JOIN "authorization".permissions p
    ON p.id=g.permission_id
    AND p.status='ACTIVE'
WHERE owner_role.code='OWNER'
    AND owner_role.version=1
    AND owner_role.status='ACTIVE'
    AND p.code NOT LIKE 'LICENSE_%';
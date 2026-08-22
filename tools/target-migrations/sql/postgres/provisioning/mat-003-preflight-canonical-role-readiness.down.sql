REVOKE SELECT (migration_id, status, checksum)
ON platform.target_migration_executions
FROM pos_platform_admin;

REVOKE USAGE ON SCHEMA platform
FROM pos_platform_admin;

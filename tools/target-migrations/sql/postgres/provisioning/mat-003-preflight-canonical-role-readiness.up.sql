GRANT USAGE ON SCHEMA platform
TO pos_platform_admin;

GRANT SELECT (migration_id, status, checksum)
ON platform.target_migration_executions
TO pos_platform_admin;

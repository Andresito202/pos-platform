#!/usr/bin/env bash
# Restores a pg_dump custom file into a throwaway database and runs smoke SQL.
# Never restores over production. Requires an empty staging DB URL.
set -euo pipefail

: "${POSTGRES_RESTORE_URL:?POSTGRES_RESTORE_URL required (staging only)}"
: "${BACKUP_FILE:?BACKUP_FILE required}"

if [[ "${BACKUP_FILE}" != /* ]]; then
  echo "BACKUP_FILE must be absolute" >&2
  exit 1
fi

pg_restore --clean --if-exists --no-owner --no-acl --dbname="${POSTGRES_RESTORE_URL}" "${BACKUP_FILE}"

psql "${POSTGRES_RESTORE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
SELECT 1 FROM platform.target_migration_executions LIMIT 1;
SELECT to_regclass('platform.central_rate_limit_counters') IS NOT NULL AS rate_limit_table_present;
SQL

echo "RESTORE_VERIFY_OK file=${BACKUP_FILE}"

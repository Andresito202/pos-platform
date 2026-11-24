#!/usr/bin/env bash
# Restore only into an explicitly isolated, fresh verification database.
set -euo pipefail

: "${POSTGRES_RESTORE_URL:?loopback isolated PostgreSQL required}"
: "${BACKUP_FILE:?absolute logical backup path required}"
[[ "${BACKUP_FILE}" == /* && -f "${BACKUP_FILE}" && ! -L "${BACKUP_FILE}" ]]

# Reject URI options, alternate target hosts and identifiers outside the drill namespace.
node --input-type=module <<'JS'
const u = new URL(process.env.POSTGRES_RESTORE_URL);
if (!["postgres:", "postgresql:"].includes(u.protocol) ||
    !["127.0.0.1", "[::1]"].includes(u.hostname) || !u.port ||
    !/^\/pos_restore_[a-z0-9_]{1,40}$/.test(u.pathname) || u.search || u.hash) {
  throw new Error("POSTGRES_RESTORE_TARGET_NOT_ISOLATED");
}
JS
db="${POSTGRES_RESTORE_URL}"
empty="$(psql -XAt -v ON_ERROR_STOP=1 --dbname="${db}" -c "
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname <> 'public'
      AND nspname NOT IN ('information_schema', 'pg_catalog') AND nspname NOT LIKE 'pg_%'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace
  )")"
[[ "${empty}" == t ]] || { echo "RESTORE_TARGET_NOT_EMPTY" >&2; exit 1; }

started=$SECONDS
pg_restore --list "${BACKUP_FILE}" > /dev/null
pg_restore --exit-on-error --single-transaction --dbname="${db}" "${BACKUP_FILE}"

verified="$(psql -XAt -v ON_ERROR_STOP=1 --dbname="${db}" <<'SQL'
SELECT EXISTS (
  SELECT 1 FROM platform.target_migration_executions
  WHERE migration_id = '037_central_rate_limit_counters' AND status = 'APPLIED'
) AND to_regclass('platform.central_rate_limit_counters') IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'platform' AND c.relrowsecurity AND c.relforcerowsecurity);
SQL
)"
[[ "${verified}" == t ]] || { echo "RESTORE_VERIFY_FAILED" >&2; exit 1; }
printf 'RESTORE_VERIFY_OK restore_verification_seconds=%s\n' "$((SECONDS - started))"

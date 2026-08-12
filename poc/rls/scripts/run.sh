#!/usr/bin/env bash
set -euo pipefail

POC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIR="${POC_ROOT}/results"
EVIDENCE_FILE="${RESULTS_DIR}/evidence.txt"
COMPOSE=(docker compose -f "${POC_ROOT}/compose.yaml")

mkdir -p "${RESULTS_DIR}"
: > "${EVIDENCE_FILE}"

export RLS_POC_POSTGRES_PASSWORD="${RLS_POC_POSTGRES_PASSWORD:-$(openssl rand -hex 24)}"

log() {
  printf '%s\n' "$*" | tee -a "${EVIDENCE_FILE}"
}

run_logged() {
  "$@" 2>&1 | sed -E 's/[[:space:]]+$//' | tee -a "${EVIDENCE_FILE}"
}

cleanup_on_error() {
  status=$?
  if [[ ${status} -ne 0 ]]; then
    log "POC_RESULT=FAIL exit_code=${status}"
  fi
  exit "${status}"
}
trap cleanup_on_error ERR

log "POC_RUN_STARTED_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "GIT_HEAD=$(git -C "${POC_ROOT}/../.." rev-parse HEAD)"
run_logged "${COMPOSE[@]}" up -d --wait
log "POSTGRES_IMAGE=$("${COMPOSE[@]}" images --format json | tr -d '\n')"
run_logged "${COMPOSE[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d rls_poc < "${POC_ROOT}/sql/00-setup.sql"
run_logged "${COMPOSE[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d rls_poc < "${POC_ROOT}/sql/01-seed.sql"

log "FUNCTIONAL_SESSION_USER=rls_poc_test_executor_non_superuser"
log "FUNCTIONAL_CURRENT_ROLE=rls_poc_app_or_rls_poc_worker_or_explicit_test_target"
run_logged "${COMPOSE[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U rls_poc_test_executor -d rls_poc < "${POC_ROOT}/sql/02-tests.sql"
run_logged "${COMPOSE[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d rls_poc < "${POC_ROOT}/sql/03-introspection.sql"

log "=== Backup and restore ==="
run_logged "${COMPOSE[@]}" exec -T postgres pg_dump -U postgres -d rls_poc -Fc -f /tmp/rls_poc.dump
run_logged "${COMPOSE[@]}" exec -T postgres pg_dumpall -U postgres --roles-only -f /tmp/rls_poc-roles.sql
run_logged "${COMPOSE[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'DROP DATABASE IF EXISTS rls_poc_restore'
run_logged "${COMPOSE[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'CREATE DATABASE rls_poc_restore'
run_logged "${COMPOSE[@]}" exec -T postgres pg_restore -U postgres -d rls_poc_restore /tmp/rls_poc.dump

restore_check="$("${COMPOSE[@]}" exec -T postgres psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d rls_poc_restore -c "SELECT count(*) = 4 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='poc' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity;")"
policy_check="$("${COMPOSE[@]}" exec -T postgres psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d rls_poc_restore -c "SELECT count(*) = 4 FROM pg_policies WHERE schemaname='poc';")"
role_dump_check="$("${COMPOSE[@]}" exec -T postgres sh -c "grep -c 'CREATE ROLE rls_poc_' /tmp/rls_poc-roles.sql")"

log "RESTORE_RLS_FORCE_ALL_TABLES=${restore_check}"
log "RESTORE_POLICY_COUNT_OK=${policy_check}"
log "ROLE_DEFINITIONS_IN_SEPARATE_GLOBAL_DUMP=${role_dump_check}"

if [[ "${restore_check}" != "t" || "${policy_check}" != "t" || "${role_dump_check}" -lt 5 ]]; then
  log "POC_RESULT=FAIL backup_restore_validation"
  exit 1
fi

run_logged "${COMPOSE[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U rls_poc_app -d rls_poc_restore -c "BEGIN; SET LOCAL app.tenant_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; SELECT count(*) AS restored_tenant_a_rows FROM poc.test_sales; COMMIT;"

log "PG_DUMP_SCOPE=database objects/data/policies/grants; cluster roles require pg_dumpall --roles-only or infrastructure automation"
log "POC_RESULT=PASS"
log "POC_RUN_FINISHED_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
trap - ERR

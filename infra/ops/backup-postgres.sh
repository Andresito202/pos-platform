#!/usr/bin/env bash
# Automated logical backup of Central PostgreSQL (pg_dump).
# Operator-run / cron. Does not provision cloud storage or publish infra.
set -euo pipefail

: "${POSTGRES_BACKUP_URL:?POSTGRES_BACKUP_URL required (prefer pos_platform_admin or dedicated backup role)}"
: "${BACKUP_DIR:?BACKUP_DIR required (absolute)}"

if [[ "${BACKUP_DIR}" != /* ]]; then
  echo "BACKUP_DIR must be absolute" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/postgres-${STAMP}.dump"
TMP="${TARGET}.tmp"

pg_dump --format=custom --no-owner --no-acl --file="${TMP}" "${POSTGRES_BACKUP_URL}"
chmod 600 "${TMP}"
mv "${TMP}" "${TARGET}"

# Retention: keep last N dumps (default 14). Does not delete offsite copies.
KEEP="${BACKUP_KEEP:-14}"
mapfile -t FILES < <(ls -1t "${BACKUP_DIR}"/postgres-*.dump 2>/dev/null || true)
if ((${#FILES[@]} > KEEP)); then
  for ((i=KEEP; i<${#FILES[@]}; i++)); do
    rm -f "${FILES[$i]}"
  done
fi

echo "BACKUP_OK path=${TARGET}"

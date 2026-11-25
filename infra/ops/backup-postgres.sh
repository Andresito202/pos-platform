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

KEEP="${BACKUP_KEEP:-14}"
if [[ ! "${KEEP}" =~ ^[1-9][0-9]{0,3}$ ]]; then
  echo "BACKUP_KEEP must be an integer from 1 to 9999" >&2
  exit 1
fi
exec 9>"${BACKUP_DIR}/.postgres-backup.lock"
flock -n 9
umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/postgres-${STAMP}.dump"
TMP="$(mktemp "${BACKUP_DIR}/.postgres-dump.XXXXXXXX")"
trap 'rm -f -- "${TMP}"' EXIT
[[ ! -e "${TARGET}" ]]

pg_dump --format=custom --file="${TMP}" "${POSTGRES_BACKUP_URL}"
pg_restore --list "${TMP}" > /dev/null
chmod 600 "${TMP}"
mv "${TMP}" "${TARGET}"

# Retention: keep last N dumps (default 14). Does not delete offsite copies.
mapfile -t FILES < <(ls -1t "${BACKUP_DIR}"/postgres-*.dump 2>/dev/null || true)
if ((${#FILES[@]} > KEEP)); then
  for ((i=KEEP; i<${#FILES[@]}; i++)); do
    rm -f "${FILES[$i]}"
  done
fi

printf 'BACKUP_OK utc=%s bytes=%s\n' "${STAMP}" "$(wc -c < "${TARGET}")"

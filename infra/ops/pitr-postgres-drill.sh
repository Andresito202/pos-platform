#!/usr/bin/env bash
# Replays a verified plain PG base backup and archived WAL in a private socket.
set -euo pipefail
umask 077
: "${PITR_BASE_BACKUP:?base backup path required}"
: "${PITR_WAL_ARCHIVE:?WAL archive directory required}"
: "${PITR_DRILL_PARENT:?existing drill parent required}"
: "${PITR_TARGET_UTC:?recovery target required}"
: "${PITR_INCIDENT_UTC:?reference incident timestamp required}"
: "${PITR_DB_USER:?restore verification role required}"
: "${PITR_DATABASE:?restore verification database required}"
for directory in "$PITR_BASE_BACKUP" "$PITR_WAL_ARCHIVE" "$PITR_DRILL_PARENT"; do
  [[ "$directory" =~ ^/[a-zA-Z0-9_./-]+$ && -d "$directory" ]]
done
for timestamp in "$PITR_TARGET_UTC" "$PITR_INCIDENT_UTC"; do
  [[ "$timestamp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
  date -u -d "$timestamp" +%s >/dev/null
done
started=$SECONDS
pg_verifybackup "$PITR_BASE_BACKUP"
[[ ! -e "$PITR_BASE_BACKUP/standby.signal" && ! -e "$PITR_BASE_BACKUP/recovery.signal" ]]
[[ -z "$(find "$PITR_BASE_BACKUP" -type l -print -quit)" ]]
drill="$(mktemp -d "$PITR_DRILL_PARENT/postgres-pitr.XXXXXXXX")"
pgdata="$drill/data"
mkdir "$pgdata" "$drill/socket"
cp -a "$PITR_BASE_BACKUP/." "$pgdata"
chmod 700 "$pgdata"
: > "$pgdata/postgresql.auto.conf"
touch "$pgdata/recovery.signal"
cat > "$drill/postgresql.conf" <<CONFIG
listen_addresses = ''
unix_socket_directories = '$drill/socket'
unix_socket_permissions = 0700
archive_mode = off
hot_standby = on
restore_command = 'cp -- "$PITR_WAL_ARCHIVE/%f" "%p"'
recovery_target_time = '$PITR_TARGET_UTC'
recovery_target_action = 'pause'
hba_file = '$drill/pg_hba.conf'
CONFIG
printf 'local all all trust\n' > "$drill/pg_hba.conf"
trap 'pg_ctl -D "$pgdata" -m fast -w stop >/dev/null 2>&1 || true' EXIT
pg_ctl -D "$pgdata" -l "$drill/postgres.log" -o "-c config_file=$drill/postgresql.conf" -w start

replayed=""
for attempt in {1..60}; do
  replayed="$(psql -XAt -v ON_ERROR_STOP=1 -h "$drill/socket" -U "$PITR_DB_USER" -d "$PITR_DATABASE" -c "
    SELECT extract(epoch FROM pg_last_xact_replay_timestamp())::bigint
    WHERE pg_is_in_recovery() AND pg_get_wal_replay_pause_state()='paused'
      AND to_regclass('platform.target_migration_executions') IS NOT NULL
  ")"
  [[ "$replayed" =~ ^[0-9]+$ ]] && break
  sleep 1
done
[[ "$replayed" =~ ^[0-9]+$ ]] || { echo PITR_TARGET_NOT_VERIFIED >&2; exit 1; }
incident="$(date -u -d "$PITR_INCIDENT_UTC" +%s)"
target="$(date -u -d "$PITR_TARGET_UTC" +%s)"
(( replayed <= target && target <= incident ))
printf 'PITR_VERIFY_OK restore_verification_seconds=%s observed_replay_gap_seconds=%s\n' "$((SECONDS - started))" "$((incident - replayed))"

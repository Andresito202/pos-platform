# Backups, RPO/RTO y recuperación — preparación comercial 2026-11-24

## Alcance

Materializa **hooks operativos** sobre capacidades existentes. No contrata almacenamiento offsite ni declara RPO/RTO medidos en producción.

| Capa | Mecanismo | Script / API |
|---|---|---|
| SQLite local | `LocalDatabase.createVerifiedBackup` / `restoreFromBackup` (RT-002) | `infra/ops/backup-sqlite.mjs`, `restore-sqlite-verify.mjs` |
| PostgreSQL Central | `pg_dump` custom + `pg_restore` en staging | `infra/ops/backup-postgres.sh`, `restore-postgres-verify.sh` |

## Objetivos documentados (no medidos)

| Métrica | Objetivo comercial inicial | Evidencia actual |
|---|---|---|
| RPO local (SQLite) | ≤ 15 min (cron de backup verificado) | Script listo; **no** RUNTIME_VERIFIED en campo |
| RPO Central (Postgres) | ≤ 15 min lógico; PITR cuando infra pagada lo autorice | Script listo; PITR **DOCUMENTED** pendiente de proveedor |
| RTO nodo POS | ≤ 60 min (restore + re-provisión Device Trust) | Restore verificado en CI Windows histórico; ensayo DR pendiente |
| RTO Central | ≤ 120 min (restore staging → cutover autorizado) | Verify script; ensayo DR pendiente |

## DR checklist (operador)

1. Backup SQLite previo a migración / actualización.
2. Backup Postgres diario + retención local `BACKUP_KEEP` (default 14).
3. Ensayo mensual: restore a directorio/DB **staging**, `RESTORE_VERIFY_OK`.
4. Tras restore local: **no** reutilizar identidad de Device Trust desde backup (DEC-022); re-enrolar.
5. Seal sticky de licencia puede sobrevivir wipe de datos; wipe completo de máquina exige recuperación Central.

## Lo que no hace este cambio

- No publica buckets S3/GCS.
- No debilita RLS ni abre `pos_app` a dumps.
- No simula tiempos de restore.

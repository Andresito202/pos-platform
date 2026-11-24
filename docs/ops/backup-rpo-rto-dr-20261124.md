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

## Ensayo aislado

- PostgreSQL lógico. Ejecutar el backup con un rol autorizado para leer todos los datos respaldados. El dump conserva ownership y grants de objetos. Provisionar primero los roles del clúster mediante el mecanismo de migraciones existente. El verificador exige loopback, puerto explícito y una base vacía de la forma `pos_restore_<id>`. No emite DROP. La salida incluye tiempo de restauración y comprobación.
- SQLite. Usar el CLI como operador con el servicio detenido para respetar el writer exclusivo. Desde el checkout, `pnpm --filter @pos-platform/database-sqlite exec node --import tsx ../../infra/ops/backup-sqlite.mjs --data-dir /abs/caja`. Invocar el verificador con el mismo loader y `--backup /abs/backup.db --target-dir /abs/drills`. Crea un destino nuevo en cada ensayo. La edad del artefacto y el tiempo de verificación son mediciones distintas de RPO y RTO comercial.
- PITR. El PostgreSQL administrado conserva la responsabilidad del archive WAL en producción. El ensayo portable usa una copia base íntegra en formato plano, manifiesto verificable y WAL archivado compatible. Ejecutar `bash infra/ops/pitr-postgres-drill.sh` con binarios del mismo PostgreSQL major, usuario sin privilegios del sistema y las variables requeridas por el script. La instancia de ensayo sólo escucha en un socket privado, se pausa en el objetivo y se detiene al terminar. El intervalo desde el último commit reproducido hasta el incidente se reporta por separado del tiempo del ensayo.
- El objetivo de 15 minutos depende del archivado continuo y de su monitorización. El dump diario satisface retención lógica adicional. Registrar el resultado de restauración, corte de WAL, muestra de datos, comprobaciones de negocio y recuperación de dispositivos antes de fijar compromisos.

## Arranque de Central y observabilidad

La imagen incluye las herramientas de migración existentes. Aprovisionar PostgreSQL mediante el procedimiento de target migrations y ejecutar el target `postgres:commercial:apply -- --central-rate-limit` con el rol migrador y el manifiesto de repositorio requeridos. Central usa un rol de aplicación separado. Compose de ensayo lee contraseñas y provisiones desde montajes. Preparar `server.crt` y `server.key` para el nombre TLS del entorno, legibles para UID 10001. En la configuración de Central usar `CENTRAL_DATABASE_URL_FILE`, `D3_ENROLLMENT_TRANSPORT_TOKEN_FILE` y `D3_ISSUER_PRIVATE_KEY_FILE` con rutas absolutas a los montajes. En un entorno comercial añadir las provisiones y preflights requeridos por GLOBAL, BUSINESS, licencias y SCM. Conservar las protecciones de SCM.

Activar `OTEL_ENABLE_API=1` y fijar `OTEL_EXPORTER_OTLP_ENDPOINT` en el collector aprobado mediante HTTPS. HTTP se admite en loopback para el ensayo. El exportador envía trazas y métricas OTLP protobuf. Usar `infra/ops/commercial-alerts.prometheus.yml` con el backend Prometheus y el Alertmanager del entorno. Verificar sintaxis y evaluación allí antes de habilitar notificaciones. Firewall, WAF y el receptor de alertas dependen de la infraestructura seleccionada.

## Compatibilidad de ramas

| PR | Relación con `fa3e78a5` | Acción |
| --- | --- | --- |
| #127 | HEAD `3506ab01` es ancestro | Reutilizar canal, contratos y gates SCM. |
| #134 | HEAD `ab0841a0` es divergente | Conservar su límite de login y Turnstile al integrar. Revisar el árbol antes de combinar. |
| #135 | HEAD `d257e512` es divergente | Reconciliar el manifiesto de Central, el router y la migración de puente. La credencial GLOBAL del portal requiere este puente desplegado. |
| #136 | HEAD `64d4430e` es divergente | Mantener shell y contratos Android en su PR. Reconciliar el arranque de Central y la numeración antes de integrar. |
| #137 | Base directa `fa3e78a5` | Reutilizar el limitador PostgreSQL y el ledger 037. |
| #138 | HEAD `653e610b` depende de #136 | Mantener R8 e integridad Android en sus ramas. |
| Portal #1 | HEAD `28b1803`, repositorio separado | k6 usa el GET de catálogo protegido por GLOBAL. Las credenciales y el servicio del portal se provisionan aparte. |

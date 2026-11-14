# Montaje Windows y runner comercial — 2026-10-26

Base local `a2d858c9cb58ad7693a513268f864446cb4349d5`; remoto inicial
`c24df8b1576a158f8c7dfed6a78c4aa5f1b4ee42`. Rama única y PR #96 draft.
Se conserva el WIP y `docs/product/oracleJdk-27/` sin rastrear.

## Cierres que no se reconstruyen

PKCE, contraseña/MFA, DPAPI, provisión SAS HTTPS, transición de raíz y el
recorrido V2 → SSA/SAS → renovación → dashboard de laboratorio permanecen
materializados en los commits anteriores. No se vuelven a presentar sus pruebas
como nuevas. Cambiar una frontera de montaje exige sólo la regresión afectada.

## Materialización de este corte

`main.ts` instancia `WindowsCommercialRuntime` antes del canal autenticado si
existe `POS_WINDOWS_COMMERCIAL_PROVISION_FILE`. Configuración administrada con
perfil `CAMACHO_WINDOWS_COMMERCIAL_V2`, entorno, registro Windows/RP/origen,
audiencia, raíz pública DeviceTrust/huella y claves operacionales verificadas.
Cada timeout, retención y cadencia se recibe explícitamente; no hay valores
productivos seleccionados. Sin archivo, no se monta; sin DEV-003, se deniega.

El transporte de despliegue usa TLS del sistema, origen y rutas fijas,
redirects prohibidos, cancelación/deadline total, UTF-8 y límites de tamaño.
`CAMACHO_COMMERCIAL_HTTP_V2` usa el access en `x-commercial-business-access`
junto a la prueba independiente en Authorization. No acepta el header aislado,
URLs arbitrarias ni overrides de CA. No cambia el token ni afirma ser DPoP.

La custodia DPAPI y la renovación existentes se reutilizan. El Service registra
conexiones sólo después de `session.recover` ACTIVE. Su lifecycle revisa el access
con cadencia/lead time configurados, renueva únicamente conexiones vinculadas,
aborta al perder canal y espera las operaciones antes de destruir la custodia.
No se entregan secretos a Electron main/preload/React ni se cambia el diseño.

Decisión expresa del propietario, 2026-10-26: **adoptar el bloqueo global RBAC**
ya medido, con timeout obligatorio, sin UPDATE general RBAC ni DDL productivo en
esta sesión. Se registra en el runner canónico la sucesión 008–016, usando sus
artefactos definitivos, lock global de migración, checksums, predecesores y ledger
existentes. APPLIED se confirma en la misma transacción que DDL/smoke.

- 014 extiende `identity.session_refresh_tokens`, conservando filas legacy.
- 015 añade contador SAS y función fija de lectura; rechaza lock_timeout cero.
  El down rechaza borrar watermarks antes de retirar la función.
- 016 materializa el binding/código nativo en Identity, con consumo irreversible,
  RLS central y grants por columnas; no crea clientes, credenciales o permisos.

Los archivos experimentales `proposals/` permanecen intactos y no son entradas del
runner. No se aplica DDL en bases comerciales. La tabla refresh conserva su
frontera Identity central de 001 (grants), sin imponerle otro modelo RLS.

CLI preparado: `pnpm --filter @pos-platform/target-migrations postgres:commercial:apply`.
Exige POSTGRES_MIGRATOR_URL, POSTGRES_EXPECTED_DATABASE, REPOSITORY_COMMIT exacto,
POSTGRES_MIGRATION_LOCK_TIMEOUT_MS y POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS.
No presupone base productiva, password, servidor ni timeout del operador.

## Evidencia y límites

11 PASS del montaje/lifecycle/transporte (9 nuevos y 2 regresiones bootstrap
afectadas), 3 PASS PostgreSQL físico temporal del runner. Las pruebas observan
main real con NODE_ENV=production y canal autenticado llegando al coordinador;
DEV-003 ausente se deniega antes de red. PostgreSQL verifica aplicación
concurrente/idempotente, predecesor ausente, timeout obligatorio, privilegios y
rollback/FAILED. No es prueba positiva de login productivo.

Fallos corregidos: roles perdidos al reiniciar tmpfs; BOM en SQL nuevo;
expectativa RLS impropia sobre la tabla central legacy; UUIDv4 en el driver
privilegiado, que exige v7. Tres bases aleatorias vacías del fallo inicial se
eliminaron por nombre exacto sólo en el contenedor tmpfs. Una ejecución devolvió
exit 1 pese a 3 aserciones PASS: se conservó como discrepancia; repetición verbose
y JSON final terminaron exit 0. No se omite ese fallo ni se declara CI verde.

Pendientes de este corte: composición Central productiva y logout/revocación
nativa completa; no se confunden con infraestructura externa. Después se
requieren parámetros y despliegue auténticos Central/DEV-003, instalación y
certificación humana. No licencias/caché hasta cerrar técnicamente este frente.

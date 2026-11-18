# Activación canónica y recepción Windows — evidencia local

Recuperación: el trabajo de 16 archivos estaba conservado en el commit local
`0aeafc073d001453ed67fc6bf40ca0ead67c1b78` sobre remoto `6f94fd29`, árbol limpio.
No se restauró ni reconstruyó ese WIP. Se respaldó su snapshot íntegro en
`C:/Users/Usuario/.codex/backups/pos-licensing-1793211322519/committed-wip.zip`,
junto a evidencia y manifest. No se tocó `oracleJdk-27/`. La enumeración de
ignorados encontró directorios generados/dependencias y límites de longitud de
Windows; no se borraron archivos para resolverlo.

## Código terminado de este incremento

022 continúa el runner canónico con target optativo `--license-activations`;
AUTHENTICATION y los SQL cerrados previos no cambian. Se termina el artefacto
022 del WIP todavía no desplegado. Tablas canónicas Licensing: claves públicas
LICENSE, activaciones DEV-003 y revocaciones append-only, RLS forzada y ledger.
Runtime sin permiso para insertar/actualizar claves. Una función SECURITY DEFINER
acotada toma FOR SHARE sin conceder UPDATE de trust al runtime.

Asignación: GLOBAL real, credencial/contraseña/MFA/grant revalidados, pago
CONFIRMED y contrato existentes, tenant/empresa/DEV-003 actuales, sucursal activa,
idempotencia, cuota compartida por licencia y versión monotónica. Se guardan IDs
de Cash; no se crean cajas, se cuentan dispositivos ni se fabrican grants.
Se deriva el contexto RLS desde la licencia persistida, nunca desde un tenant
aportado como prueba por el cliente. Auditoría/transacción con rollback.

`/v1/platform/licenses/allocate` guarda PENDING; no permite usar una licencia.
`/v1/licensing/activations/resolve` exige DeviceProof nueva para esa ruta exacta,
consume 012 y vuelve a validar el binding antes de firmar capacidad V2. Si falla
la emisión, la proof gastada no se recupera: reintentar requiere una nueva.
La clave debe coincidir con la pública LICENSE registrada y el ambiente/ventana.

`/v1/platform/licenses/revoke-activation` exige LICENSE_REVOKE, no sólo ISSUE.
Revocación firmada V1 separada del artefacto de capacidad, persistencia y auditoría
atómicas. Las descargas posteriores entregan su evidencia firmada a la misma
credencial; replay/idempotencia no duplican efectos.

Service Windows: operación cerrada de firma bajo la misma custodia DPAPI,
descarga opcional desde el origen administrado, pins LICENSE instalados por
operador, validación de firma/scope/versión y reemplazo atómico de archivo público.
No acepta claves de red como nueva confianza. Poll sin solapamiento, deadline,
cancelación y drenaje al detener. No se expuso IPC, secreto o firma libre a main,
preload o React. La revocación recibida se aplica al lifecycle y auditoría SQLite;
el gate conserva la denegación tras reinicio e incluso antes de la primera apertura.

La política central representa tres días de gracia como duración explícita
ELAPSED_24_HOURS y perpetuo sin vencimiento. Su referencia, features offline y
políticas contractuales admitidas son dependencias administradas, no defaults de
producción. Soporte/servicios externos no se deducen del derecho perpetuo.

## Ejecuciones observadas

```powershell
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm --filter @pos-platform/central-authority exec vitest run tests/subscription-quotes-physical.test.ts -t 'FACTUS API:|capacity:' --reporter=json --outputFile=../../artifacts/licensing/2026-10-28/capacity-final.json
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/commercial-device-credential.test.ts -t 'license download:' --reporter=json --outputFile=../../artifacts/licensing/2026-10-28/windows-capacity-download-final.json
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/license-capacity.test.ts --reporter=json --outputFile=../../artifacts/licensing/2026-10-28/capacity-gate-regression.json
pnpm --filter @pos-platform/central-authority exec vitest run tests/central-certification-preflight.test.ts
pnpm --filter @pos-platform/central-authority run deployment:preflight
pnpm --filter @pos-platform/central-authority run typecheck
pnpm --filter @pos-platform/pos-local-service run typecheck
pnpm --filter @pos-platform/contracts run typecheck
pnpm --filter @pos-platform/target-migrations run typecheck
pnpm --filter @pos-platform/pos-local-service run build:artifact
pnpm architecture:check
pnpm ci:repository-policy
git diff --check
```

- Central: **2 PASS, 0 FAIL, 4 filtradas**. El caso FACTUS es dependencia de
  fixtures TLS/Payments, no una operación con FACTUS auténtico. Nuevo escenario:
  runner real/idempotente, GLOBAL auténtico de laboratorio, cuotas y concurrencia,
  tenant/empresa/credencial, caducidad/replay/manipulación de proof, rollback de
  activación por fallo de auditoría, HTTPS cerrado, firma, recepción/gate SQLite,
  recuperación, expiración, permiso separado de revocación y revocación concurrente.
- Windows: **1 PASS, 39 filtradas**, DPAPI y SQLite reales; transport doble
  explícito para probar el receptor, nunca presentado como Central auténtica.
  Pins, cuerpo/ruta firmados, archivo atómico, rollback de versión, firma alterada,
  cancelación, auditoría fallida/revertida, revocación idempotente y recuperación.
- Gate existente afectado: **4 PASS**. Preflight nuevo: **2 PASS**.
- TypeScript de los cuatro proyectos, build Service win32-x64, arquitectura
  (16 casos y ARCH-003) y política locales: PASS. No se repitió el login Electron,
  MFA/contraseña completos ni suites de ventas/caja/hardware.

`capacity-final.json` SHA-256:
`31825e48bdd3a17eb983d801e9c249669c17c85ae02f8ecc8490811901b32ce9`.
`windows-capacity-download-final.json` SHA-256:
`b9626fb518033ba63d899777160fb989bf994baa42cb66e761ae141b46d00869`.
Service build: `324c6d3119fbf9b526270efd206e9fa0fb3c856fcf2108e82c3ae84cc38f6e73`.
Los informes y fallos iniciales se conservan en artifacts/licensing/2026-10-28.

Correcciones observadas: FOR SHARE sin privilegio UPDATE sobre claves (se resuelve
con función acotada); contexto RLS derivado de licencia y contexto GLOBAL separado;
fixture/origen de despliegue y sintaxis del fixture. Un fallo ECONNREFUSED fue del
contenedor temporal detenido: se reinició ese contenedor tmpfs, sin volúmenes ni
bases comerciales. No se alteró WinNAT ni se atribuyó ese fallo al código.

## Límites explícitos

Esto no certifica una persona, un VPS, una instalación comercial ni pagos reales.
El montaje nativo opcional está implementado; la prueba nueva Windows del receptor
usa un transport doble, mientras Central se prueba con HTTPS/PostgreSQL físicos
temporales por separado. No se declara un nuevo E2E humano por combinar resultados.

La liberación/reasignación de un ID de caja permanece conservadora: no se reciclan
derechos offline sólo porque un dispositivo cambie o una activación se revoque.
La renovación comercial debe conservar el contrato/historial y disponer de términos
aceptados; este incremento no inventa pagos de renovación ni cambia licencias
históricas. Las operaciones fiscales/correo siguen sin montarse sin políticas y
servicios autorizados. Los precios preproductivos de la nueva misión aún requieren
el siguiente incremento de catálogo V2; no se introducen como constantes React.

Procedimiento y matriz por bloqueo externo:
[central-vps-certification-runbook-2026-10-28.md](central-vps-certification-runbook-2026-10-28.md).
Preflight real de esta consola: todos los parámetros operativos inspeccionados
ausentes; CONFIGURADO Y VERIFICADO no equivale a una cuenta declarada por chat.
Estado: IMPLEMENTADO SIN PROVISIONAR. CI no ejecutado; PR #96 Draft, sin merge.

# Fronteras comerciales de autorización — 2026-10-22

Base `da02815`, misma rama activa. No modifica grants, credenciales, sesiones, migraciones ni reglas de autorización. Se añade evidencia focalizada a `commercial-ipc.test.ts`, reutilizando el handler real, SSA/snapshot de fixtures y SQLite temporal.

`pnpm --filter @pos-platform/pos-local-service exec vitest run tests/commercial-ipc.test.ts -t 'role boundary'`: **11/11**, 35 omitidas. Log local `artifacts/android-runtime/2026-10-22/role-boundaries-tests.log`.

Ocho escenarios de catálogo: sin grant de registro (solo venta/lectura operativa), tenant/empresa/sucursal ajenos, rol retirado, asignación vencida, snapshot vencido y snapshot ausente. Todos rechazan sin producto, fiscal, operación o outbox. El contrato tampoco acepta actor, permisos o aprobación afirmados en el payload. Dos pruebas adicionales ejecutan cada una cuatro escenarios para recepción y ajuste: grant ausente, otra sucursal, rol retirado y asignación vencida; no crean movimientos, saldos, operación ni outbox. La primera ejecución del fixture usó INACTIVE para role_status, que el contrato rechazó; corregido a RETIRED sin cambiar el esquema.

Se clasifican `IDENTIFIER_MISMATCH` y `INVALID_FISCAL_ATTRIBUTES` como VALIDATION en el handler existente; antes los dos desenlaces nuevos caían en INTERNAL. TypeScript y fronteras/política verificados antes de publicar.

La matriz funcional de cajero/supervisor/administrador no se convierte en asignaciones productivas. La autoridad central debe emitir los grants efectivos. No hay en este incremento workflow de aprobación de ajuste, elevación de descuento, autoaprobación, devolución de venta ni permisos nuevos: no se declara probado un flujo ausente. Los casos de uso existentes siguen exigiendo su permiso; estos tests demuestran denegaciones, no emisión central de roles. D-21 (reserva) y D-22 (reversión) no se cierran por esta evidencia.

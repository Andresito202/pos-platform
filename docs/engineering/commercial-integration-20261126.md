# Integración comercial de Camacho POS Colombia

Base POS `7aa8be16`. Base Portal `92a2f3d3`. Ambas ramas `main`
conservan sus revisiones iniciales. La validación se realiza en PR en borrador.

| PR | Base del cambio | HEAD revisado | Contrato o migración | Dependencia para integrar |
| --- | --- | --- | --- | --- |
| POS #143 | POS main | `0f65fb19` | Activación, PKCE y artefactos SSA/SAS | Central HTTPS y validación de login Android físico |
| POS #144 | POS #143 | `ac3f8741` | Sync canónico y DeviceProof | Credencial de enrolamiento del #143 |
| POS #145 | POS main | `41dad7bd` | Puertos de estado y artefactos FACTUS | Validación documental por proveedor y credenciales por ambiente |
| POS #146 | POS main | `c41e6472` | PostgreSQL 039, compras, reservas, movimientos y alertas | FACTUS y Portal deben vincular el pago confirmado y el documento al registro central |
| POS #148 | POS main | `9f40d2a0` | Readiness de Central Sync | Rol y esquema de Sync, DNS y HTTPS de staging |
| POS #149 | POS main | `86ace4be` | Confirmación de transferencia, FACTUS Pay y auditoría local | Mantener habilitación del proveedor condicionada |
| Portal #1 | Portal main | `a07f948` | Base del portal y rotación de secretos en compilación | Contención del historial y validación del entorno desplegado |
| Portal #3 | Portal #1 | `050f216a` | Prisma `20261126180000_subscription_price_proposals` | La migración inserta propuestas, conservando contratos vigentes |
| Portal #4 | Portal #1 | `bfa14183` | Webhook transaccional y recibo de aprovisionamiento | Contrato `CommercialProvisioningResponseSchema` de Central. Falta el acuse autorizado de activación |

El orden probado en POS fue #143 → #144 → #145 → #146 → #148 → #149.
El orden probado en Portal fue #1 → #3 → #4. Git pudo combinar las ramas
en esos órdenes. #3 y #4 editaron el mismo archivo de pruebas de la API
en puntos distintos y conservaron ambos casos. La escritura transaccional
del webhook se conserva en #4. En POS, #145 recupera estados del proveedor
en el flujo fiscal local y #146 controla saldo en PostgreSQL; falta la
conexión funcional entre esos dos flujos.

El PR POS #103 parte de `feat/android-commercial-runtime`. El ensayo contra
POS main produjo 32 conflictos (25 de contenido, 6 de modificación contra
borrado y 1 de alta en ambas ramas). Los archivos afectados incluyen
runtimes de Central retirados, composición comercial, contratos IPC,
renderer y migraciones. El QR dinámico y la atestiguación manual ya existen
en la base. La recuperación de avisos Android y Nequi/Bre-B requiere una
integración selectiva con las autoridades actuales de empresa, sucursal y
dispositivo. Un aviso firmado conserva su condición de no verificado.

## Evidencia de las ramas combinadas

- POS. Typechecks de servicio local y adaptadores. Pasaron 60 pruebas del
  adaptador FACTUS y 37 del caso de uso fiscal. Pasaron las suites afectadas
  de Caja, FACTUS Pay, sesión Android, licencias y Sync offline.
- PostgreSQL 16.14 local. Se aplicaron 001–004, 028 y 039. El gate de Sync
  comprobó venta SQLite → Inbox PostgreSQL → ACK, persistencia, recuperación,
  aislamiento, replay e idempotencia. Pasó la prueba física de la migración
  039 con competencia por la última unidad.
- Portal. Las siete migraciones Prisma se aplicaron a una base independiente
  y pasaron 38 pruebas de la API, incluido el webhook, el catálogo y el
  registro de aprovisionamiento de Central.
- Readiness de Sync. Se observaron HTTP 200 con esquema y permisos, HTTP 503
  con esquema ausente, y HTTP 503 al detener PostgreSQL manteniendo HTTP 200
  en liveness.

La evidencia anterior corresponde a PostgreSQL local y respuestas de
proveedor controladas en las suites. La aceptación comercial requiere
validar los recorridos conectados en staging, incluida la activación firmada
desde el Portal, el cobro real, la emisión fiscal real y los equipos físicos.
El escaneo histórico del Portal sigue bloqueando su liberación.

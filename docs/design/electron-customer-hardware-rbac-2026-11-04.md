# Clientes y Hardware — RBAC de interfaz y contratos existentes

Fecha de auditoría: 2026-11-04. Rama: `feat/android-commercial-runtime`.

## Alcance
Se revisaron los handlers existentes de `useCustomerDirectory.ts`, `CustomerPanel.tsx`, `HardwarePanel.tsx`, `hardware-service.ts`, `packages/contracts/src/hardware.ts` y la navegación de `App.tsx`. No se cambiaron autenticación, sesiones, SCM, DPAPI, MFA, SSA/SAS, permisos canónicos, ni backend. No se agregaron botones.

## Matriz comprobada por lectura de código

| Control existente | Operación | Permiso efectivo frontend | Backend |
| --- | --- | --- | --- |
| Alta adquiriente | `customer.register` | `CUSTOMERS_CUSTOMER_REGISTER` | Cliente validado por el servicio; idempotencia y validación DIAN permanecen |
| Alta de novedades al registrar | `customer.marketing.subscribe` | `CUSTOMERS_CUSTOMER_REGISTER` | Segundo acto separado del alta de cliente; requiere opt-in explícito |
| Buscar / consultar adquiriente | `customer.find` / `customer.get` | `CUSTOMERS_CUSTOMER_READ` | Alcance definido por sesión y servicio |
| Consultar preferencia | `customer.marketing.get` | `CUSTOMERS_CUSTOMER_READ` | Lectura de preferencia existente |
| Suscribir / dar de baja | `customer.marketing.subscribe/unsubscribe` | `CUSTOMERS_CUSTOMER_REGISTER` | Mutaciones con clave de idempotencia, auditadas por backend |
| Diagnosticar / listar dispositivos y trabajos | `hardware.command` `diagnose/list` | `HARDWARE_READ` | `hardware-service.ts` autoriza `HARDWARE_READ` |
| Asociar impresora/caja | `hardware.command` `associate` | `HARDWARE_CONFIGURE` | `hardware-service.ts` autoriza `HARDWARE_CONFIGURE` |
| Encolar prueba/recibo | `hardware.command` `enqueue` con `PRINT_TEST/PRINT_RECEIPT` | `HARDWARE_PRINT` | `hardware-service.ts` autoriza `HARDWARE_PRINT`; impresión física no implícita |
| Abrir cajón | `hardware.command` `enqueue` con `DRAWER_OPEN` | `HARDWARE_DRAWER_OPEN` | Requiere permiso específico, motivo y perfil verificado |
| Ejecutar trabajo pendiente | `hardware.command` `dispatch` | Se muestra solo a quien tenga `HARDWARE_PRINT` o `HARDWARE_DRAWER_OPEN` | Backend consulta el tipo verdadero del job y **revalida el permiso específico** antes de E/S; la UI no puede deducir tipo desde un ID libre |

## Cambios de código
- `CustomerPanel`: mantiene los campos compartidos de documento e identificación para buscar o registrar, pero reserva los campos fiscales de alta, el formulario de registro y el opt-in para permiso de escritura; oculta la búsqueda sin permiso de lectura; oculta mutaciones de marketing al usuario solo lectura.
- `HardwarePanel`: recibe el conjunto de permisos existente desde `App`, evitando una segunda carga independiente de capacidades. Cada grupo de botones se muestra por su permiso atómico correspondiente; los estados `busy`, `reason`, `binding` y `confirm` siguen imponiendo sus restricciones originales.
- `App.tsx`: navega a Hardware con cualquiera de `HARDWARE_READ`, `HARDWARE_CONFIGURE`, `HARDWARE_PRINT` o `HARDWARE_DRAWER_OPEN`. No da permisos nuevos; solo descubre una superficie si Central concedió explícitamente la capacidad.
- `CustomerHardware.permissions.test.tsx`: **6 casos nuevos escritos**, cubriendo separación read/register, diagnóstico-only, configuración, impresión-only y ausencia de escalada entre impresión y cajón.

## Restricciones y pruebas
No se ejecutó Electron real ni Vitest en esta revisión. GitHub Actions puede mostrar estados verdes asociados a un workflow que no ejecuta suites; no convertir ese estado en aprobación técnica. Verificar TypeScript, tests del renderer, pruebas de autorización IPC y Electron por sesiones reales cuando exista entorno de ejecución. El servicio vuelve a validar `dispatch` por clase de job aun cuando un usuario pueda ingresar cualquier identificador. No se alteró la política de reintento de hardware en estado incierto ni la auditoría.

El PR #99 continúa destinado a la certificación del login Windows y debe mantenerse independiente de este trabajo.

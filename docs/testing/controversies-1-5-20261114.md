# Validación de controversias 1–5 — 2026-11-14

## Identidad y conservación del trabajo

- Checkout original: `apps/pos-desktop` y `apps/pos-local-service` en el mismo repositorio.
- Rama: `cursor/commercial-design-review-0d11`; PR #106; sin rama nueva, merge a main ni force-push.
- HEAD local inicial: `e205e09b20ef8fa9123522c42e6f4a9b9dc85797`.
- HEAD remoto recibido y base de esta entrega: `869aa265faeedcc1a07df7a96af0a8a503f9f3f1`.
- Había nueve archivos rastreados modificados y un informe sin rastrear del trabajo anterior.
  Se conservaron en stash `823a6ff02926033480ef6a7adf0e8eac43bef34f`, se avanzó por
  fast-forward y se reaplicaron. Se reconciliaron dos conflictos de texto: comentario
  del mapa de permisos y anexos del documento ROLE-UX. Se conservaron ambos anexos.
  No se borró el stash ni se descartaron cambios desconocidos.
- La restricción funcional del supervisor ya estaba en el remoto (`0e5d1225`), con
  pruebas añadidas en `ec40d860`; este trabajo las ejecuta y amplía, no las atribuye
  como nueva implementación. El único delta del bridge frente a la base es comentario.
- SHA final: el commit de esta entrega, indicado en Git/PR y en la respuesta de entrega.
  Las pruebas corresponden al contenido de código incluido, no a un CI remoto observado.

## Resultados finales observados

Linux x64, Node 24.22.1; corepack pnpm 9.15.0; instalación frozen-lockfile sin cambiar
manifiestos/lockfile. Vitest 4.1.12, TypeScript 6.0.3, Vite desktop 6.4.5.

| Bloque | Resultado | Alcance |
|---|---|---|
| Desktop Vitest | 324 PASS / 37 archivos / exit 0 | Render en jsdom, navegación, acciones, IPC construido, CSV, pagos y licencias con dobles |
| Servicio: batería seleccionada | 246 PASS / 14 archivos / exit 0 | Roles, sesiones, handlers, SQLite, pagos, caja, inventario, espera y DesignReview |
| Configuración del servicio | 20 PASS / 1 archivo / exit 0 | Incluye rechazo de login local fuera de development; no concede confianza comercial |
| Dominio RBAC | 47 PASS / exit 0 | Permisos, ámbitos y vigencias |
| Proyección de asignaciones | 16 PASS / exit 0 | Contrato de asignaciones; no inventario de usuarios reales de Central |
| Central seleccionado | 27 PASS + 7 SKIP / exit 0 | Pruebas unitarias; prueba física de suscripciones omitida sin POSTGRES_TEST_URL |
| Repositorio de sesión GLOBAL | 12 PASS / exit 0 | Consultas/decisiones con doble SQL; no PostgreSQL real |
| Adaptador fiscal e ítems | 72 PASS / exit 0 | Serialización y rechazos; no Factus externo ni certificación normativa |
| Typecheck Desktop, servicio y Central | PASS / exit 0 | Scripts declarados; desktop incluye main y renderer |
| Build desktop por cuatro etapas | PASS / exit 0 | main, entry, preload y renderer; no ejecución Windows |
| Arquitectura | 16 PASS y ARCH-003 PASS | Comandos declarados por el target, ejecutados directamente |
| Política del repositorio y diff-check | PASS | No modifica SQLite, outbox, migraciones, contratos ni controles SCM |
| E2E Windows seleccionado | 5 SKIP / exit 0 | Windows/DPAPI/named pipes no disponibles |
| E2E Electron Linux boot + real-channel | 1 FAIL, 8 no ejecutadas / exit 1 | Sin servidor X/$DISPLAY; también EPERM en socket DBus. Se detuvo al primer fallo |

No sumar intentos anteriores o tests filtrados a los resultados finales.
Las salidas de ejecución y comandos exactos se conservan en
[controversies-1-5-20261114-output.txt](controversies-1-5-20261114-output.txt).

## Verificación de roles

| Rol local | Evidencia ejecutada | Límite |
|---|---|---|
| Cajero | Puede crear venta/cobro; denegado registro de catálogo. Flujo real handler/SQLite desde apertura hasta comprobante/cierre, pago idempotente y reapertura de DB | Sin Electron, banco, hardware ni provisión BUSINESS/contrato de licencia real |
| Supervisor | Handler + casos de uso reales rechazan registrar producto/cliente, recibir/ajustar stock, crear venta, abrir/cerrar turno y registrar efectivo | Confirmación/cancelación manual de pagos conservadas; no equivale a autorizaciones completas de devoluciones/arqueos |
| Administrador | Conserva cuatro permisos de escritura; crea producto y recibe stock en SQLite. Rechazo de venta, apertura/cierre y cobro | No acredita panel completo de compras, usuarios o todas las funciones objetivo |
| Superadministrador local | Permisos efectivos exactamente AUDIT_EVENT_READ; denegados venta/turnos/cobro, sin LICENSE_PLAN_MANAGE | No hay sesión GLOBAL comercial en esta prueba |
| Los cuatro | Denegación por otra conexión, expiración y logout; registro de sesiones prueba carreras/desconexión/reutilización de ID | Revocación global/offline requiere autoridad/proyección comercial reales |

En las pruebas de denegación se validan payloads con schemas y se llama al handler
con casos de uso reales. Los stores ausentes fuerzan fallo si se alcanza una escritura
no autorizada. Son pruebas directas, no transporte real. Las pruebas de integración
adicionales sí usan stores y SQLite temporales originales.

El flujo positivo local usa gate de autenticación de prueba (no contraseña humana),
la proyección LOCAL existente y CommercialComponent real. No genera grants de
producción, ni prueba compra de licencia. La contraseña y bloqueo scrypt se prueban
por separado en las suites específicas. El fixture histórico de CommercialComponent
no instancia todo el arranque/licenciamiento productivo: no se promueve a E2E.

## Correcciones y fallos conservados

1. **Formularios fuera de responsabilidad:** se conservaron y validaron los cambios
   locales anteriores en CatalogPanel/InventoryPanel/CustomerPanel. Usuarios lectores
   ya no ven alta, importación, ajustes ni edición de marketing. Las consultas se
   mantienen y el backend sigue siendo la autoridad. Antes del cambio se observaron
   tres fallos UI y cinco de permisos sobre e205e09b, documentados por separado.
2. **Typecheck de licencias:** fixture omitía `idempotent`; otra aserción accedía a
   un `unknown`. Se añade el campo y se valida el payload con
   LicenseAllocationRequestSchema. No se cambia el contrato para hacer pasar tests.
   Se corrige además la afirmación prematura del informe anterior sobre typecheck.
3. **Arnés de roles obsoleto:** la evaluación del objeto de permisos del host mostró
   seis grants sobrantes en supervisor, diez en administrador y LICENSE_PLAN_MANAGE
   en superadministrador. Ahora el host de pruebas reutiliza la proyección LOCAL
   probada; continúa firmando exclusivamente fixtures efímeros de laboratorio.
   Role-isolation exige Caja solo a Cajero, no hardware por defecto y auditoría local
   al superadmin. No transforma esas firmas de arnés en autoridad Central.
4. **E2E login obsoleto:** el componente usa input Usuario y carece del encabezado
   antiguo. La prueba ahora usa fill y el nombre accesible actual. Corrección por
   contraste con el componente; ejecución Windows aún SKIP, no se afirma validación
   dinámica de estas interacciones en Windows.
5. **Preparación DesignReview bloqueada:** falló el socket auxiliar del CLI tsx
   (`listen EPERM`). La prueba ejecuta el mismo script en proceso Node mediante
   `--import tsx`, sin cambiar el canal POS ni retirar controles. Dos pruebas PASS:
   preparación durable y separación de IDs, artefactos de confianza y catálogo entre
   dos raíces temporales. No acredita rutas/reparse points de un PC Windows real.
6. **Intento de comando:** `pnpm test ... --maxWorkers` fue interpretado por pnpm
   como opciones propias. Se corrigió a `pnpm run test ...`; no fue fallo del producto.
7. En el trabajo previo, el wrapper build invocó pnpm global 11 y Nx no pudo abrir
   sockets. Se utilizan corepack 9.15.0 y las mismas etapas/validadores declarados.

## Estado de las controversias

| Controversia | Cierre ejecutable en este entorno | Pendiente preciso |
|---|---|---|
| 1 — Supervisor | PASS del mapa, handler/casos de uso y UI de consulta | E2E Windows con login/canal real |
| 2 — Cuatro espacios y perfiles técnicos | PASS local y motor de scopes/vigencias; contratos separados | Auditar grants reales de OWNER/GENERAL_ADMIN/BRANCH_MANAGER/SUPERVISOR/CASHIER en Central; no se aprovisionaron ni renombraron |
| 3 — Local versus GLOBAL | PASS de ausencia de autoridad GLOBAL local; unitarias Central/SQL | Sesión GLOBAL real MFA, revocación, contratación de cuatro empresas, pago confirmado, activación y aislamiento persistido |
| 4 — DesignReview | Mismo árbol de apps; preparación/SQLite temporal y restricciones development probadas | Checkout/dist real del PC, PowerShell, ACL/DPAPI/SCM, ventanas y capturas 1024/1366/1920 |
| 5 — Readiness histórico | Caja existente compila; pruebas funcionales de núcleo, CSV, cantidades, persistencia y fiscal de laboratorio | Flujo gráfico completo de venta, hardware, factura externa y modalidades sectoriales; no se implementan en este bloque |

No declarar controversias 1–5 certificadas integralmente. Tampoco reabrir certificación
externa: los pendientes anteriores son pruebas de producto y dependencias de entorno.

## Operaciones excepcionales y GLOBAL

El catálogo permission-codes.ts materializa CASH_SHIFT_OPEN/CLOSE,
PAYMENTS_PAYMENT_CANCEL/TRANSFER_CONFIRM y otros permisos actuales. No contiene
las familias conceptuales sales.return.request/approve/execute,
payments.refund.*, inventory.adjustment.request/approve/execute ni permisos
completos de arqueo. CANCEL_PAYMENT no equivale a devolver dinero ni anular venta.
No se añadieron grants o endpoints para aparentar cumplimiento.

Rutas inspeccionadas en global-administration-http.ts y main.ts:

| Etapa | Evidencia | Nivel máximo observado aquí |
|---|---|---|
| Login/sesión GLOBAL | /v1/platform/login/begin, login/complete, session, logout; GlobalAdministrationSessions exige cookie, CSRF, origen y fuentes activas | IMPLEMENTED; dependencias unitarias TESTED, login físico no |
| Ofertas y cotización | license-offers/list,catalog,save,publish; quotes/issue | IMPLEMENTED; escenario físico SKIP |
| Cobro de suscripción | subscription-collection-runtime y Payments existentes | IMPLEMENTED por inspección; sin cobro real |
| Emisión y asignación | licenses/issue, allocate, assignment-context; guard de sesión GLOBAL y pago en servicios existentes | Unitarias parciales TESTED; no END_TO_END |
| Revocación/lectura de activaciones | licenses/revoke-activation, activations | Unitarias parciales TESTED; sin dispositivo real |
| Alta completa de empresa, renovación y suspensión comercial | No hay rutas específicas con estos nombres en el dispatcher GLOBAL inspeccionado | Flujo completo NO ACREDITADO; no se deduce ausencia de todo código en otros owners |

La prueba de cuatro asignaciones en frontend permanece incluida en los 324 PASS:
usa dobles, no demuestra aislamiento RLS de cuatro empresas ni concesión sectorial.

## Reproducción y dependencias externas

Desde la raíz, usar `corepack pnpm` (9.15.0). Los logs incluyen comandos completos.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @pos-platform/pos-desktop typecheck
corepack pnpm --filter @pos-platform/pos-desktop test
corepack pnpm --filter @pos-platform/pos-local-service typecheck
corepack pnpm --filter @pos-platform/pos-local-service run test src/commercial/local-operator-authorization.test.ts src/security/local-operator-session-registry.test.ts src/security/local-operator-password.test.ts src/security/local-operator-password-gate.test.ts tests/commercial-ipc.test.ts tests/inventory.test.ts tests/payment.test.ts tests/cash.test.ts tests/waiting-cart.test.ts tests/prepare-commercial-design-review.test.ts tests/authorization-snapshot.test.ts tests/authorization-snapshot-store.test.ts tests/audit-read-authorization.test.ts tests/sale-cash-register-binding.test.ts --maxWorkers 1 --testTimeout 20000
corepack pnpm --filter @pos-platform/pos-local-service run test tests/config.test.ts
corepack pnpm --filter @pos-platform/pos-desktop build:main
corepack pnpm --filter @pos-platform/pos-desktop build:entry
corepack pnpm --filter @pos-platform/pos-desktop build:preload
corepack pnpm --filter @pos-platform/pos-desktop build:renderer
```

En Windows disponible, construir antes y ejecutar:

```powershell
corepack pnpm --filter @pos-platform/pos-desktop run test:e2e local-operator-live.spec.ts unauthenticated-startup.spec.ts
foreach ($role in 'CAJERO','SUPERVISOR','ADMINISTRADOR','SUPERADMINISTRADOR') {
  $env:POS_E2E_ROLE = $role
  corepack pnpm --filter @pos-platform/pos-desktop run test:e2e role-isolation.spec.ts
  if ($LASTEXITCODE -ne 0) { throw "Role E2E failed: $role" }
}
Remove-Item Env:POS_E2E_ROLE
```

Estas specs son laboratorio Windows; no certifican login humano BUSINESS. Para la
prueba física Central, se requiere POSTGRES_TEST_URL de servidor de pruebas aislado,
OpenSSL y dependencias del harness; ejecutar subscription-quotes-physical.test.ts
solo allí. No apuntar a producción: crea/aplica esquema y datos de prueba.
Para Central productivo: parámetros verificados, identidades/grants reales, claves
operativas, MFA y dispositivos; no se suplanta esa evidencia con seeds.

El intento gráfico Linux no se reintenta sin corregir el entorno X/DBus. No se baja
seguridad SCM/DPAPI ni se sustituye el transporte para obtener un PASS.

## Archivos modificados respecto de 869aa265

- `apps/pos-desktop/e2e/ROLE-UX-CONSOLIDATION.md`
- `apps/pos-desktop/e2e/local-operator-live.spec.ts`
- `apps/pos-desktop/e2e/role-isolation.spec.ts`
- `apps/pos-desktop/renderer/src/components/CatalogPanel.tsx`
- `apps/pos-desktop/renderer/src/components/CustomerPanel.tsx`
- `apps/pos-desktop/renderer/src/components/InventoryPanel.tsx`
- `apps/pos-desktop/tests/renderer/AdminPanels.test.tsx`
- `apps/pos-desktop/tests/renderer/App.test.tsx`
- `apps/pos-desktop/tests/renderer/platform-fulfillment.test.tsx`
- `apps/pos-local-service/e2e-host/real-service-host.ts`
- `apps/pos-local-service/src/commercial/local-operator-authorization.test.ts`
- `apps/pos-local-service/src/security/local-operator-development-bridge.ts`
- `apps/pos-local-service/tests/commercial-ipc.test.ts`
- `apps/pos-local-service/tests/config.test.ts`
- `apps/pos-local-service/tests/prepare-commercial-design-review.test.ts`
- `docs/product/backlog.md`
- `docs/product/roles-modules-verification-20261113.md`
- `docs/testing/controversies-1-5-20261114-output.txt`
- `docs/testing/controversies-1-5-20261114.md`

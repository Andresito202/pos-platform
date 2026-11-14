# Consolidación visual/funcional por roles — evidencia

> **Revisión visual NO certificada para producción.** No certifica login
> BUSINESS/SSA/SAS, capacidad comercial Central ni readiness operativo.

**Base:** `cursor/commercial-design-review-0d11`  
**PR:** #106 — consolidación hacia `main`, pendiente de integración  
**Alcance actual:** separación de Caja y supervisión en permisos locales y navegación, revisión de transferencias conectada al hook existente y limpieza de controles no operativos.  
**No tocado:** licenciamiento, autenticación comercial BUSINESS/SSA/SAS, reglas de negocio, keys.

## Matriz real de permisos locales (backend)

Fuente: `apps/pos-local-service/src/security/local-operator-development-bridge.ts`  
Los permisos del servicio autorizan. El rol local limita y ordena las pantallas ya autorizadas; no concede permisos. La sesión comercial sin rol local conserva sus capacidades firmadas y requiere revisión específica de sus asignaciones en Central.

| Permiso | CAJERO | SUPERVISOR | ADMINISTRADOR | SUPERADMINISTRADOR |
| --- | --- | --- | --- | --- |
| CASH_SHIFT_OPEN / CLOSE | sí | no | no | no |
| SALES_SALE_CREATE | sí | no | no | no |
| SALES_RECEIPT_READ | sí | sí | sí | no |
| PAYMENTS_PAYMENT_REGISTER | sí | no | no | no |
| PAYMENTS_PAYMENT_READ | sí | sí | sí | no |
| PAYMENTS_TRANSFER_REPORT | sí | no | no | no |
| PAYMENTS_TRANSFER_CONFIRM / PAYMENTS_PAYMENT_CANCEL | no | sí | sí | no |
| CATALOG_PRODUCT_READ | sí | sí | sí | no |
| CATALOG_PRODUCT_REGISTER | no | no | sí | no |
| CUSTOMERS_CUSTOMER_READ | sí | sí | sí | no |
| CUSTOMERS_CUSTOMER_REGISTER | no | no | sí | no |
| INVENTORY_STOCK_READ | no | sí | sí | no |
| INVENTORY_STOCK_RECEIVE / ADJUST | no | no | sí | no |
| AUDIT_EVENT_READ | no | no | sí | sí |
| FISCAL_DOCUMENT_ISSUE | no | no | no | no |
| LICENSE_PLAN_MANAGE | no | no | no | no |
| HARDWARE_READ | no | no | no | no |

### Inicio visual (si el permiso correspondiente existe)

| Rol | Pantalla inicial | Notas |
| --- | --- | --- |
| CAJERO | Caja y ventas | Sin Dashboard ni Inventario administrativo |
| SUPERVISOR | Inventario | Sin Caja ni carrito; revisión de transferencias separada |
| ADMINISTRADOR | Dashboard | Sin Caja ni carrito; conserva revisión y control |
| SUPERADMINISTRADOR | Dashboard / Auditoría | Sólo superficies con `AUDIT_EVENT_READ`; sin simular licencias/empresas |

Logout o cambio de usuario: `activeScreen` + `visitedScreens` se restablecen.

## Archivos recuperados / integrados

| Origen | Qué se tomó |
| --- | --- |
| `feat/caja-denominaciones-20261104` | CSS de denominaciones, payment-method layout, cash summary |
| `feat/brand-camacho-pos-2026-11-04` | `camacho-pos-colombia-login.png`, symbol/apilado/android, `login-waves.svg`, entrada branded |
| Árbol actual design-review | SalePanel funcional, logos Nequi/Daviplata en `public/payment-denominations/logos/`, billetes/monedas |
| Worktree `pos-platform-caja` | No accesible en este entorno Linux |

No se fusionaron ramas completas. No se sustituyeron componentes funcionales por placeholders.

## Correcciones de Caja / cobro

- Precios/payable/coberturas en COP humano (`$3.500`); exacto en `data-amount` y payloads backend.
- Cantidad por `unit_precision` de la presentación (`defaultQuantityInput` / display).
- Imágenes de billetes/monedas con `object-fit: contain`.
- Logos Nequi y Daviplata visibles en bloque de transferencia manual (no habilitan QR/tarjeta/crédito).
- CSP: `img-src 'self' data:` (sin debilitar script/default).
- Caja design-review: `POS_DESIGN_REVIEW_REGISTER_ID` → preload `posDesktopHints` → prefills el input (sin IPC nuevo de permisos).
- Se retiraron de Caja los botones reservados para tarjeta, QR integrado y crédito, y el botón siempre deshabilitado de balanza. No se eliminó ningún adapter de hardware ni método conectado.

## Catálogo / imágenes

- No hay fotografías de producto verificadas en las ramas auditadas.
- `ProductAvatar` permanece como fallback simbólico profesional (sin fingir foto real).

## Resultados históricos de pruebas (Linux agente; anteriores a esta corrección)

| Prueba | Resultado observado |
| --- | --- |
| `pnpm --filter @pos-platform/pos-desktop typecheck` | PASS |
| `pnpm --filter @pos-platform/pos-desktop build` | PASS (login PNG empaquetado; CSP con img-src) |
| `pnpm --filter @pos-platform/pos-desktop test` | **264 PASS / 0 FAIL** |
| Restricciones locales (`local-operator-authorization.test.ts`) | Ejecutar en este entorno junto al paquete local-service |
| E2E Windows Electron real | **NO EJECUTADO aquí** (entorno Linux) |
| Capturas 1024 / 1366 / 1920 | **PENDIENTE Windows** |
| CSS responsive breakpoints | Implementados en `commercial-precision.css` (1024 / 1366 / 600) |

### E2E Linux previo (no ocultar)

Documentado en `ROLE-PREVIEW.md`: 6 PASS / 5 SKIP / 5 FAIL (native-custody MODULE_IMPORT; real-channel disconnect/timeouts). Ese estado no se declara resuelto por estas pruebas unitarias.

## Pasos reproducibles (Windows)

```powershell
pnpm install --frozen-lockfile
pnpm --filter @pos-platform/pos-desktop build
pwsh -File tools/operators/open-commercial-design-review.ps1
```

Login local real:

| Usuario | Rol esperado | Inicio esperado |
| --- | --- | --- |
| `cajero.local` | CAJERO | Caja y ventas |
| `supervisor.local` | SUPERVISOR | Inventario |
| `admin.local` | ADMINISTRADOR | Dashboard |
| `superadmin.local` | SUPERADMINISTRADOR | Dashboard / Auditoría |

Tras login, el launcher imprime `DESIGN_REVIEW_REGISTER_ID`; Electron también lo precarga si `POS_DESIGN_REVIEW_REGISTER_ID` está en el proceso.

## Errores / pendientes

1. E2E Electron Windows + capturas por rol y anchos 1024/1366/1920: pendiente del entorno Windows de revisión (`C:\Proyectos\pos-platform-design-review`).
2. Fallos E2E Linux previos de canal/custody: siguen abiertos; no certificados como PASS.
3. Sin imágenes fotográficas de catálogo verificadas: fallback simbólico a propósito.
4. Superadministrador local **no** gestiona licencias/empresas (correcto: no hay permiso ni superficie simulada).
5. Commit/push: **retenidos** hasta verificación explícita de este paquete de cambios.

## Criterio final

No basta «Servicio local: conectado». En Windows debe verse:

1. Identidad Camacho (logo login + marca lateral).
2. Denominaciones COP con imágenes contenidas.
3. Logos Nequi/Daviplata en transferencia manual.
4. Navegación inicial distinta por rol, autorizada sólo por permisos backend.
5. Flujo real caja → carrito → cobro (sin confirmaciones simuladas).


## Corrección de separación de roles — 2026-11-10

Base remota: `8d929231f7689465760de1d6b7c1d84d9234d045`. Cambio en la misma rama, sin crear otra.

- Causa: SUPERVISOR heredaba todos los permisos de CAJERO y ADMINISTRADOR heredaba SUPERVISOR; App abría SalePanel incluso con permisos de consulta/confirmación de pagos. La navegación sólo ordenaba pantallas.
- Corrección: capacidades locales de supervisión explícitas; Caja exige SALES_SALE_CREATE; las pantallas locales se limitan por rol. Se espera la consulta inicial de identidad antes de montar áreas operativas.
- TransferReviewPanel reutiliza useCommercialSale, payment.get, payment.transfer.confirm y payment.cancel. No duplica casos de uso ni crea otro POS. Conserva expected_version, idempotencia y resolución de resultados inciertos del hook existente.
- La consulta todavía requiere la referencia técnica del pago. No se ha implementado una bandeja de pendientes ni una notificación bancaria. El importe mostrado se etiqueta como reportado, no recibido.
- La limpieza textual y de controles no constituye un rediseño comercial terminado.

### Pruebas observadas en esta sesión

Se reprodujo antes de corregir: 1 fallo de navegación de administrador y 2 fallos de permisos supervisor/administrador. Después:

| Comando desde paquete correspondiente | Resultado |
|---|---|
| `vitest run --config vitest.config.ts` (desktop) | 31 archivos, 273 pruebas PASS, exit 0 |
| `vitest run src/commercial/local-operator-authorization.test.ts src/security/local-operator-session-registry.test.ts src/security/local-operator-password.test.ts src/security/local-operator-password-gate.test.ts` (local-service) | 4 archivos, 19 pruebas PASS, exit 0 |
| `tsc -p tsconfig.renderer.json` (desktop) | PASS, exit 0 |
| `tsc -p tsconfig.json` (local-service) | PASS, exit 0 |
| `vite build` (desktop) | Renderer compilado, exit 0; no equivale al build completo de Electron |

Incluye petición directa sale.create: el handler y CreateSaleUseCase reales rechazan supervisor, administrador y superadministrador antes de acceder a los stores. Incluye consulta/confirmación/cancelación de transferencia y versión del backend sin crear una venta desde supervisión.

Entorno de validación: snapshot de fuentes remotas y dependencias disponibles en caché, con Vitest 4.1.11 y Vite 6.4.3 (el repositorio declara 4.1.12 y 6.4.5). No se ejecutó una instalación limpia con frozen-lockfile; no se modificó lockfile para disimularlo.

Intento visual Chromium/Playwright: BLOQUEADO al iniciar navegador, process_singleton_posix socket() Operation not permitted. No hay capturas validadas, ni PASS responsive, ni E2E Windows de este incremento. No se retiraron los controles SCM ni se certificó BUSINESS.


## Ajuste RBAC del Supervisor — 2026-11-13

El rol local SUPERVISOR conserva consulta de catálogo/clientes/inventario y revisión de pagos, pero deja de recibir CATALOG_PRODUCT_REGISTER, CUSTOMERS_CUSTOMER_REGISTER, INVENTORY_STOCK_RECEIVE e INVENTORY_STOCK_ADJUST. El rol ADMINISTRADOR conserva esos cuatro permisos explícitamente. Cambio en `local-operator-development-bridge.ts` y prueba de regresión en `local-operator-authorization.test.ts`. **Pruebas añadidas, no ejecutadas ni certificadas en esta intervención.** No modifica los grants firmados BUSINESS de Central, que requieren auditoría propia.

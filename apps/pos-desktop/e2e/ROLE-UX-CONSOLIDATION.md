# Consolidación visual/funcional por roles — evidencia

> **Revisión visual NO certificada para producción.** No certifica login
> BUSINESS/SSA/SAS, capacidad comercial Central ni readiness operativo.

**Base:** `cursor/commercial-design-review-0d11`  
**PR:** #106 (base comercial; no `main`)  
**Alcance:** navegación por rol (solo orden visual), identidad COP/denominaciones/logos, Caja legible, fallback de catálogo.  
**No tocado:** licenciamiento, autenticación comercial BUSINESS/SSA/SAS, reglas de negocio, keys.

## Matriz real de permisos locales (backend)

Fuente: `apps/pos-local-service/src/security/local-operator-development-bridge.ts`  
Los permisos autorizan. El rol sólo ordena la UX.

| Permiso | CAJERO | SUPERVISOR | ADMINISTRADOR | SUPERADMINISTRADOR |
| --- | --- | --- | --- | --- |
| CASH_SHIFT_OPEN / CLOSE | sí | sí | sí | no |
| SALES_SALE_CREATE | sí | sí | sí | no |
| SALES_RECEIPT_READ | sí | sí | sí | no |
| PAYMENTS_PAYMENT_REGISTER / READ | sí | sí | sí | no |
| PAYMENTS_TRANSFER_REPORT | sí | sí | sí | no |
| PAYMENTS_TRANSFER_CONFIRM / CANCEL | no | sí | sí | no |
| CATALOG_PRODUCT_READ | sí | sí | sí | no |
| CATALOG_PRODUCT_REGISTER | no | sí | sí | no |
| CUSTOMERS_CUSTOMER_READ | sí | sí | sí | no |
| CUSTOMERS_CUSTOMER_REGISTER | no | sí | sí | no |
| INVENTORY_STOCK_READ / RECEIVE / ADJUST | no | sí | sí | no |
| AUDIT_EVENT_READ | no | no | sí | sí |
| FISCAL_DOCUMENT_ISSUE | no | no | no | no |
| LICENSE_PLAN_MANAGE | no | no | no | no |
| HARDWARE_READ | no | no | no | no |

### Inicio visual (si el permiso correspondiente existe)

| Rol | Pantalla inicial | Notas |
| --- | --- | --- |
| CAJERO | Caja y ventas | Sin Dashboard ni Inventario administrativo |
| SUPERVISOR | Inventario | Superficie operativa ya implementada |
| ADMINISTRADOR | Dashboard | No abre carrito automáticamente |
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
- Métodos no implementados siguen deshabilitados.

## Catálogo / imágenes

- No hay fotografías de producto verificadas en las ramas auditadas.
- `ProductAvatar` permanece como fallback simbólico profesional (sin fingir foto real).

## Resultados de pruebas (Linux agente)

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

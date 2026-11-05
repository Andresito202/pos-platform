# Auditoría de superficies Electron por permisos — 2026-11-04

## Alcance y origen

Lectura estática de `apps/pos-desktop/renderer/src/App.tsx`, `useAuthorizationCapabilities.ts`, `SalePanel.tsx`, `InventoryPanel.tsx`, `CatalogPanel.tsx`, `CustomerPanel.tsx`, `HardwarePanel.tsx`, `AdministrativeControlPanel.tsx`, `OperationPanel.tsx`, `docs/product/roles.md` y `docs/security/permission-matrix.md`. Rama de trabajo `feat/android-commercial-runtime`. No es una certificación E2E, una prueba en Electron real, ni prueba de emisión Central de los roles conceptuales.

Prohibido cambiar login, SCM, DPAPI, enlace de sesión, snapshots SSA/SAS, grants, migraciones o contratos mientras continúa la certificación del login PR #99. No introducir roles o permisos ficticios para representar pantallas planeadas. El backend es la autoridad; el renderer sólo adapta la presentación a las capacidades efectivas recibidas.

## 1. Matriz ejecutable de navegación

| Pantalla `App.tsx` | Condición actual de visibilidad | Límite conocido |
| --- | --- | --- |
| Caja y ventas | Cualquiera de `CASH_SHIFT_OPEN`, `CASH_SHIFT_CLOSE`, `SALES_SALE_CREATE`, `PAYMENTS_PAYMENT_REGISTER`, `PAYMENTS_TRANSFER_REPORT`, `PAYMENTS_TRANSFER_CONFIRM`, `PAYMENTS_PAYMENT_READ`, `PAYMENTS_PAYMENT_CANCEL` | El panel interno deshabilita acciones según grants; se debe comprobar que ningún bloque ajeno se muestre como acción ejecutable. |
| Facturación electrónica | `FISCAL_DOCUMENT_ISSUE` | No equiparar permiso fiscal con permiso de modificar terceros; el servicio valida emisión. |
| Catálogo | `CATALOG_PRODUCT_READ` o `CATALOG_PRODUCT_REGISTER` | Importación CSV y registro deben respetar `CATALOG_PRODUCT_REGISTER`; lectura separada. |
| Inventario | `INVENTORY_STOCK_READ`, `INVENTORY_STOCK_RECEIVE` o `INVENTORY_STOCK_ADJUST` | Recepción, ajuste y lectura se verifican con permisos independientes. |
| Clientes | `CUSTOMERS_CUSTOMER_READ` o `CUSTOMERS_CUSTOMER_REGISTER` | Separar registro y consulta, sin inferir permisos fiscales. |
| Comprobantes | `SALES_RECEIPT_READ` | Solo consultar recibos emitidos/autorizados por el servicio. |
| Impresora y cajón | `HARDWARE_READ` | Controles de configurar, imprimir y abrir cajón usan grants adicionales; los campos sin grant deben revisarse en UX. |
| Dashboard administrativo | `AUDIT_EVENT_READ` | Acoplamiento incorrecto entre auditoría y métricas. No otorgar permiso inventado. Revisar autorización por métrica backend antes de habilitar dashboard autónomo. |
| Auditoría administrativa | `AUDIT_EVENT_READ` | Reutiliza lectura auditada real y scope de sesión. |
| Reportes, usuarios, roles, empresa, sucursales, dispositivos, configuración, licencias, planes, superadministrador, soporte | `requiredPermissions: []` | Ocultas porque `hasAny()` retorna false con lista vacía; la interfaz planeada NO es una función ejecutable. No activar con permisos arbitrarios. |
| Herramientas técnicas / `OperationPanel` | Antes disponible bajo `details` para cualquier sesión `ready` | Se restringió el render a `import.meta.env.DEV`; el formulario técnico no debe distribuirse en compilación comercial. |

El catálogo canónico en `packages/contracts/src/permission-codes.ts` define **23 códigos**, no la totalidad de la matriz conceptual de `docs/security/permission-matrix.md`. Los nombres `OWNER`, `GENERAL_ADMIN`, `BRANCH_MANAGER`, `CASHIER`, `INVENTORY_OPERATOR`, `PLATFORM_OWNER` etc. están documentados como perfiles; su disponibilidad efectiva depende de asignaciones y snapshots emitidos por Central.

## 2. Orden de trabajo aprobado y restricciones

1. **Caja y ventas**: inventariar controles de abrir/cerrar turno, vender, consultar catálogo, cobrar, transferir, cancelar, comprobantes y emisión fiscal. Cada acción requiere su grant backend propio. No bloquear operaciones de caja por reglas sólo visuales y no exponer controles administrativos al cajero.
2. **Inventario**: conservar formularios de entrada y ajuste separados y razones auditables; adaptar visibilidad de secciones al permiso específico, manteniendo posibilidad de combinaciones de grants no asociadas a roles fijos.
3. **Administración de sucursal**: no mostrar funciones globales. Una pantalla operativa real requiere endpoint, permiso atómico publicado por Central y alcance verificado por backend; no activar las pantallas `plannedScreens` vacías.
4. **Administración general y OWNER**: distinguir analítica comercial de auditoría; reutilizar `admin.metrics.get` únicamente cuando autorice los datos de esa sesión. No convertir `AUDIT_EVENT_READ` en grant universal de dashboard.
5. **Plataforma GLOBAL**: no introducir editor de licencias o administrador global dentro de una sesión BUSINESS de Electron. La documentación del proyecto coloca la contratación, planes, renovaciones y administración GLOBAL en la web. Respetar esa separación.

## 3. Pruebas pendientes, sin claims falsos

- Unitarias/renderer: probar combinaciones mínimas de grants, grants aislados, grants múltiples, ninguno, expirado, denegado, recuperación e invalidación; pantalla activa cuando cambian capacidades y navegación de vuelta.
- UI: para cada componente, comprobar que no aparece control con efecto si carece de permiso; ausencia de controles técnicos en build comercial; campos de sólo lectura y estados vacíos legibles.
- Backend: probar denegación en servicio aunque se invoque IPC directamente, con empresa/sucursal/rol inválidos, snapshot retirado, scope ajeno, expiración y revocación.
- Electron real, **sólo después de la certificación del login**: cuenta humana por perfil, logout, revocación durante sesión, offline autorizado, reinicio de proceso y persistencia de scope; sin grants falsos ni bypass.
- Evidencia exigible: SHA exacto, comando ejecutado, entorno, resultado, omitidas, logs y pruebas físicas separadas de mocks.

## 4. Estado real de este incremento

- **IMPLEMENTED (revisión de código)**: `App.tsx` condiciona `OperationPanel` a `import.meta.env.DEV` para su exclusión de la build comercial.
- **DOCUMENTED**: auditoría y orden de corrección por superficies.
- **NOT TESTED** en esta sesión: no se ejecutó compilación Vite/Electron, Vitest, Playwright ni sesión humana. No declarar certificación.
- **PENDIENTE**: corregir mezclas restantes solo tras contrastar los contratos de backend y validar pruebas. No habilitar pantallas planificadas que carecen de permisos efectivos.

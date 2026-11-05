# Barrido RBAC, botones, recursos visuales y tablas — Electron
Fecha de revisión: 2026-11-04. Rama: `feat/android-commercial-runtime`.

## Fuente y límites de esta revisión

Inspección estática en GitHub sobre `App.tsx`, `SalePanel.tsx`, `InventoryPanel.tsx`, `CatalogPanel.tsx`, `CustomerPanel.tsx`, `FiscalPanel.tsx`, `ReceiptPanel.tsx`, `HardwarePanel.tsx`, `AdministrativeControlPanel.tsx`, `OperationPanel.tsx`, `App.css`, `commercial-precision.css`, `permission-codes.ts`, `docs/product/roles.md`, `docs/security/permission-matrix.md`, `docs/design/role-based-navigation.md` y `docs/testing/cash-denomination-ui-2026-11-04.md`.

No se han abierto sesiones humanas, ejecutado Electron local ni inspeccionado píxel a píxel capturas nuevas en este barrido. La existencia de un selector CSS no demuestra visualmente su correcto renderizado. Los roles documentados no son grants efectivos hasta que Central los emita; el frontend no puede deducir permisos únicamente del nombre del rol. No tocar SCM, DPAPI, autorización Central, login, sesionado, snapshots ni el PR #99 en curso.

## 1. Roles documentados frente al runtime

| Perfil | Vista objetivo según documentación | Confirmación ejecutable actual |
| --- | --- | --- |
| CASHIER | Venta, cobro, caja propia, consulta operativa de producto y comprobante | `App.tsx` muestra pantallas por `CASH_SHIFT_*`, `SALES_SALE_CREATE`, `PAYMENTS_*`, `CATALOG_PRODUCT_READ`, `SALES_RECEIPT_READ`. La emisión real de esos grants para CASHIER depende de Central. |
| INVENTORY_OPERATOR | Consultar existencias, recibir, ajustar cuando esté autorizado | `INVENTORY_STOCK_READ/RECEIVE/ADJUST` controlan visibilidad de cada formulario en `InventoryPanel`; el backend decide si el usuario puede ejecutar el caso de uso en su ámbito. |
| BRANCH_MANAGER | Operación, inventario y reportes de su sucursal | Solo las capacidades existentes dan acceso a pantallas operativas. `reports`, `users`, `branches` aún no tienen permiso ejecutable de pantalla; no inferir acceso a otra sucursal. |
| GENERAL_ADMIN | Gestión delegada del negocio y sucursales | Mismas restricciones: no activar `plannedScreens` sin endpoint y grant autorizado. |
| OWNER | Gestión de su negocio, datos, reportes y configuración | No implica `PLATFORM_OWNER` ni acceso a datos de otros tenants. El dashboard operativo actual utiliza `AUDIT_EVENT_READ`, decisión que requiere separar autoridad por métricas del derecho a leer eventos. |
| SUPERVISOR | Autorizaciones excepcionales y revisión según política | Definido en documentación, pero no habilitar botones de aprobación sin caso de uso, workflow y permisos ejecutables. |
| PLATFORM_OWNER / BILLING_ADMIN / SUPPORT_AGENT / SECURITY_ADMIN | Administración GLOBAL, licencias, cobros y soporte restringido | No mostrar estas herramientas automáticamente por sesión BUSINESS de Electron. La autoridad global y sus operaciones contractuales corresponden a la web según la decisión de producto. |
| PURCHASING_OPERATOR, PREPARATION_OPERATOR, COURIER, CUSTOMER | Flujos especializados de compra, preparación, reparto y cliente | Documentados como diseño funcional; no son pantallas ejecutables de Electron actualmente. |

`packages/contracts/src/permission-codes.ts` tiene 23 códigos de permisos canónicos, no todos los permisos conceptuales de la matriz de producto. El POS navega por permisos efectivos entregados por el backend y no por una comparación local de nombre de rol.

## 2. Inventario de botones por estado

| Superficie | Acciones conectadas | Acciones previstas/incompletas | Hallazgo |
| --- | --- | --- | --- |
| Caja y ventas | Abrir/cerrar turno, buscar catálogo, crear venta, cobrar efectivo, registrar/confirmar/cancelar transferencia, consultar estado, leer comprobante y emisión fiscal con permisos | Tarjeta integrada, QR integrado, crédito/fiado, balanza hardware se muestran deshabilitados | Los botones deshabilitados no significan integración terminada. Los iconos de métodos están en SVG y referenciados por `new URL(..., import.meta.url)`. |
| Inventario | Entrada, ajuste, lectura por handler `useInventoryAdmin` | No se añaden nuevas operaciones | Ya se corrigió la visibilidad separada por `INVENTORY_STOCK_RECEIVE`, `INVENTORY_STOCK_ADJUST` y `INVENTORY_STOCK_READ`. |
| Catálogo | Consulta, alta de producto, previsualización/confirmación CSV | No se introducen permisos extra | Corregido: selector CSV requiere `CATALOG_PRODUCT_REGISTER`, no `CATALOG_PRODUCT_READ`. |
| Clientes | Alta/búsqueda y gestión disponible en `useCustomerDirectory` | Flujos avanzados sólo con contrato | Revisar UI para datos personales: no exponer información ajena a ámbito. |
| Hardware | Diagnóstico, asociaciones, encolar impresión y apertura de cajón mediante `hardware.command` | Dispositivo físico/capacidad depende de driver y permisos | Exige `HARDWARE_READ/CONFIGURE/PRINT/DRAWER_OPEN` según acción, pero deben comprobarse campos deshabilitados sin grant. |
| Dashboard | Consulta métricas con `admin.metrics.get` | Separación de métricas/roles en navegación | Dashboard y auditoría siguen compartiendo visibilidad por `AUDIT_EVENT_READ`. No inferir un nuevo grant; necesita reconciliación contractual. |
| Auditoría | `audit.event.list`, filtros y paginación | — | El renderer usa tabla real y alcance calculado en servicio. |
| Usuarios, roles, sucursales, licencias, soporte, plataforma | Pantallas planificadas, no funcionales en el shell BUSINESS | Su implementación requiere permisos y handlers verificables | Los `requiredPermissions: []` mantienen estas pantallas ocultas. No activarlas por estética. |
| Diagnóstico técnico | `OperationPanel` permite IPC técnico | No debe aparecer en producción | Restringido a `import.meta.env.DEV`; no es autoridad ni consola comercial. |

## 3. Iconos y fotografías

- **Presentes en Git**: `payment-icons/banknote.svg`, `landmark.svg`, `credit-card.svg`, `qr-code.svg`, `notebook-pen.svg` y `LICENSE.lucide.txt`. `SalePanel` los incluye en los botones de medios de pago.
- **Ausentes del árbol Git**: `apps/pos-desktop/renderer/public/payment-denominations/billetes/*.png` y `.../monedas/*.png`. `SalePanel` busca las imágenes bajo `./payment-denominations/`, pero el `onError` oculta cada imagen no encontrada. La documentación indica que el paquete está en un ZIP local y no se publicó a GitHub. **No se puede declarar integración visual o distribución comercial de las fotografías**.
- Nequi/DaviPlata: no confundir iconos genéricos de transferencia con marcas oficiales integradas. La aprobación de logotipos y la integración bancaria son asuntos separados.
- No introducir imágenes generadas de billetes colombianos ni inventar recursos monetarios. Si se recupera el ZIP original, verificar derechos/atribución, rutas, peso de archivos, integridad, inclusión en build y renderización real.

## 4. Tablas, distribución, espaciado y campos difíciles

- `CatalogPanel` tiene dos tablas: previsualización CSV y lista de productos con precios e ID; `AdministrativeControlPanel` tiene tabla de auditoría con 6 columnas.
- Las tres utilizan `pos-table-scroll` + `pos-data-table`, con `overflow-x:auto`; las tablas no deben comprimirse hasta ocultar importes o encabezados. Ajuste CSS incorporado: `overflow-wrap:anywhere` en celdas generales, protección de columnas numéricas, `min-width:0` de contenedores y anchura acotada en inputs de filtros de auditoría.
- Se requiere comprobar en renderizador real: 320, 600, 800, 1100 y >=1440px; zoom 200%; etiquetas y nombres extensos; números largos y negativos; celdas vacías; paginación; navegación por teclado, foco visible y sin desplazamiento horizontal de toda la aplicación.
- `commercial-precision.css` y `App.css` comparten selectores. Cualquier cambio visual posterior necesita prueba de cascada en Electron; las media queries para tarjetas administrativas y barra de auditoría tienen diferentes puntos de quiebre.
- El estado `disabled` está diferenciado visualmente en CSS, pero **disabled por permiso**, **disabled por datos incompletos**, **disabled por petición en curso** y **funcionalidad aún inexistente** no deben confundirse en la interfaz final.

## 5. Qué queda para conectar sin inventar

1. Resolver visibilidad y acciones dentro de **Caja y ventas** con los permisos atómicos existentes; preservar tests históricos para transferencias y cajas.
2. Completar inspección visual de **Inventario**, **Catálogo** y **Clientes** contra datos realistas: la revisión de CSS no prueba ausencia de desalineaciones a nivel de píxel.
3. Diseñar el acceso a métricas por permisos reales, sin convertir `AUDIT_EVENT_READ` en autorización universal para el dashboard.
4. Revisar **Hardware** con permiso de solo lectura y sin grants de configuración/impresión/cajón: no confundir control deshabilitado con control visible permitido.
5. Verificar una a una las pantallas administrativas planificadas y su endpoint real. Sólo habilitar al existir contrato, grant efectivo, backend y pruebas de aislamiento.
6. Verificar paquetes de imágenes originales y sus rutas en la compilación. Los SVG disponibles pueden usarse; las fotografías PNG están fuera de Git y no pueden darse por instaladas.
7. Al terminar el login P0, probar las sesiones **reales** de cada rol provisionado por Central, salida/revocación, desconexión, cambio de scope, sucursal ajena y Electron físico. Tests jsdom no equivalen a certificación humana.

## 6. Evidencia de los cambios de este barrido

- `CatalogPanel.tsx`: permiso de importación CSV cambiado de `CATALOG_PRODUCT_READ` a `CATALOG_PRODUCT_REGISTER` sin alterar `loadCsv`, `previewCatalogCsv`, `confirmCatalogCsv` ni el backend.
- `commercial-precision.css`: reglas de robustez de tablas y filtros existentes; ninguna tabla ni columna inventada.
- Estado de prueba al crear este informe: GitHub Actions indicó `success` para `126e403e` (CSV). El resultado de CSS y de este mismo documento deberá consultarse por SHA; no se ejecutó Electron real.

**No declarar que la separación de roles, el inventario de botones o la alineación visual están certificados hasta ejecutar pruebas específicas.**

## 7. Continuación incremental sin conflicto con PR #99

- `CatalogPanel.tsx`: el bloque CSV existente se muestra solo con `CATALOG_PRODUCT_REGISTER`. No se cambió importación, parsing, confirmación, autorización backend ni contratos.
- `CatalogPanel.permissions.test.tsx`: dos escenarios añadidos para usuario de solo lectura y usuario con registro; se conserva el test de `App.tsx` sin modificar porque PR #99 también toca `App.test.tsx`.
- La ejecución GitHub Actions observada para `dbb0d5bb` figura como `success`, **pero su único job fue Strix AI penetration test con el paso “Report that the scan did not run”; instalación y ejecución Strix omitidas**. Por tanto ese estado verde **no acredita typecheck, Vitest, Playwright ni seguridad**. Las pruebas nuevas quedan como **NOT EXECUTED** hasta ver ejecución real de la suite en un entorno con dependencias.
- No se ha cambiado el frontend de login ni archivos del PR #99.

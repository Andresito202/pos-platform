# Diagnóstico quirúrgico de runtime, autorización y seguridad — 2026-10-08

## Alcance

Auditoría del estado real de la rama `claude/pos-camacho-bloque-4c-ld43py`.
No sustituye evidencia de ejecución de CI. Los runners de GitHub siguen siendo un bloqueo de infraestructura y no se consideran prueba de producto.

## Regla de autoridad

La autoridad de datos y autorización permanece en backend:

`renderer -> preload allowlist -> IPC contract -> local service -> use case -> permission evaluation -> scoped store`

El renderer no puede conceder permisos, identidad, tenant, company, branch, actor ni precio. Los contratos IPC rechazan identidad afirmada por el llamador y el servicio reconstruye el contexto desde la sesión/snapshot verificado.

## Estado materializado

### Auditoría

Implementado:
- `SqliteAuditStore`
- `ListAuditEventsUseCase`
- contrato `audit.event.list`
- hook renderer
- panel read-only con filtros y paginación
- filtros temporales Desde/Hasta añadidos en esta revisión.

La consulta exige autorización backend y usa el scope efectivo. El renderer no recibe payload JSON sensible.

Estado: **IMPLEMENTED / CALLER_REACHABLE**. Runtime/E2E pendiente de evidencia CI.

### Métricas administrativas

Implementado:
- `SqliteAdminMetricsStore`
- `GetAdminMetricsUseCase`
- contrato `admin.metrics.get`
- hook renderer
- panel de seguimiento.

Corrección de seguridad realizada en esta revisión:
- no se reutiliza `SALES_RECEIPT_READ` para entregar agregados administrativos de ventas;
- no se reutiliza `CASH_SHIFT_OPEN` para leer métricas de caja;
- esos grants operativos no equivalen a permiso de lectura administrativa agregada;
- ambas métricas quedan fail-closed hasta que la autoridad central publique los permisos administrativos canónicos correspondientes;
- inventario continúa usando `INVENTORY_STOCK_READ`, porque ese permiso sí es una lectura operativa existente y la consulta permanece limitada a tenant/company/branch.

Esto evita que un cajero u operador obtenga agregados de toda la sucursal simplemente porque posee un permiso operativo.

Estado: **IMPLEMENTED / FAIL-CLOSED**. No se declara runtime probado.

## Saltos de lógica detectados

### 1. Permiso operativo usado como permiso administrativo — CORREGIDO

Antes:
- ventas administrativas dependían de `SALES_RECEIPT_READ`;
- caja administrativa dependía de `CASH_SHIFT_OPEN`.

Riesgo:
- la matriz de permisos permite a CASHIER consultar/reimprimir sus comprobantes y operar su caja;
- eso no autoriza a consultar un agregado de ventas de toda la sucursal ni el estado agregado de todos los turnos.

Corrección:
- ventas y caja agregadas no se entregan hasta disponer de grants administrativos canónicos.

### 2. Matriz conceptual vs códigos SAS — PENDIENTE CENTRAL

`docs/security/permission-matrix.md` define 14 roles y 126 permisos conceptuales, pero reconoce que la representación canónica transportada por SAS es la forma estable de `STABLE_CODE` y que la alineación del resto de la matriz es tarea pendiente de D6.

No se deben inventar equivalencias como:
- `tenant.owner.change` -> `TENANT_OWNER_CHANGE`;
- `security.permission.change` -> `SECURITY_PERMISSION_CHANGE`;
- `license.plan.change` -> `LICENSE_PLAN_CHANGE`.

Solo se pueden usar códigos ya demostrados por contratos/casos de uso o por un paquete central de autorización publicado.

### 3. Catálogo físico de roles/permisos — EXISTE ESQUEMA, FALTA PUBLICACIÓN/GRANTS

La migración central ya define:
- `authorization.roles`;
- `authorization.permissions`;
- `authorization.role_permission_grants`;
- `authorization.user_role_assignments`;
- `authorization.authorization_policy_versions`.

Por tanto, el diagnóstico histórico que afirmaba que no existían físicamente esas tablas está desactualizado.

Lo que todavía no está materializado es el paquete central publicado que contenga de forma verificable:
- los 14 roles;
- los permisos canónicos;
- sus grants versionados;
- asignaciones de negocio;
- versión de política;
- proceso para emitir el SAS correspondiente.

No se debe resolver sembrando roles silenciosamente en la migración 001, porque el propio manifest separa el bootstrap físico del paquete técnico de autorización.

### 4. Panel administrativo — PARCIAL Y FAIL-CLOSED

El panel ya es navegable y las funciones reales de auditoría/métricas hablan con el backend.

Pero las superficies:
- Usuarios
- Roles
- Empresa
- Sucursales
- Dispositivos
- Licencias
- Planes
- Superadmin
- Reportes

no deben conectarse directamente a SQLite/PostgreSQL desde Electron.

Su siguiente materialización requiere contratos/use-cases de la autoridad propietaria de cada dato.

## Seguridad de fuentes internas y externas

### Renderer / HTML

Amenazas consideradas:
- modificar DOM;
- alterar botones;
- llamar IPC directamente;
- falsificar tenant/company/branch;
- falsificar actor;
- cambiar precio;
- alterar cantidades;
- saltarse una pestaña oculta.

Mitigación:
- el renderer no es autoridad;
- preload mantiene allowlist;
- contratos estrictos rechazan identidad afirmada;
- backend reconstruye scope;
- cada use-case evalúa permiso;
- los stores filtran por scope.

Conclusión: ocultar una pantalla nunca se considera control de seguridad.

### Snapshots de autorización

El SAS es la frontera de confianza:
- firma Ed25519;
- binding a usuario, instalación y dispositivo;
- secuencia monotónica;
- expiración;
- estado de rol y permiso;
- scope tenant/company/branch.

Un archivo local no constituye autoridad por sí mismo.

### Fuentes externas

No se debe aceptar un callback, payload de proveedor, integración fiscal, pago o sincronización como verdad local por el solo hecho de venir de una fuente externa.

La regla debe ser:
1. verificar autenticidad/firma cuando el protocolo lo exija;
2. validar esquema;
3. validar identidad del proveedor;
4. validar referencia/idempotencia;
5. validar tenant y recurso esperado;
6. validar estado/transición;
7. persistir únicamente el resultado normalizado permitido;
8. auditar la decisión;
9. nunca permitir que datos externos cambien actor, rol, tenant o permisos.

Los payloads externos tampoco pueden modificar directamente tablas de autorización.

## Backend/frontend: mismo idioma

Cada pantalla debe tener esta cadena verificable:

`UI -> IPC method -> contract schema -> request handler -> use case -> authorization decision -> domain/store -> response schema -> UI`

Si falta un eslabón, la pantalla no se declara materializada.

El frontend puede representar estado y navegación; no puede decidir:
- autorización;
- identidad;
- scope;
- precio;
- importe;
- licencia;
- estado fiscal;
- resultado de pago;
- aprobación administrativa.

## Instalación y versionamiento

La instalación de un cliente no debe recibir un rol implícito desde el instalador.

El instalador identifica la versión del producto y el dispositivo/installation binding. La autorización efectiva llega desde la autoridad central mediante el mecanismo de snapshot definido por DEC-011.

Los cambios funcionales de producto deben pasar por:
1. versión de producto;
2. artefacto de instalación correspondiente;
3. política de compatibilidad/migración;
4. despliegue controlado;
5. evidencia de actualización;
6. rollback definido cuando aplique.

No se debe convertir una mejora de versión en cambios directos y opacos sobre una instalación existente.

## Orden real de ejecución

1. **A — Cerrar catálogo canónico de permisos** sin inventar códigos.
2. **B — Auditoría**: cerrar autorización, filtros, scope y evidencia E2E.
3. **C — Métricas**: cerrar únicamente métricas con permisos canónicos y pruebas negativas por rol.
4. **D — Superadmin**: materializar servicio central de licencias/cuentas/planes antes de conectar UI.
5. **E — Administración del negocio**: usuarios, roles, empresa, sucursales y dispositivos desde autoridad central.
6. **F — Reportes**: únicamente sobre fuentes persistidas y permisos de lectura reales.
7. **Matriz de roles x negocio**: verificar las 18 modalidades de negocio contra las capacidades reales, sin inventar productos.
8. **Instalador/versionado**: separar versión, artefacto, migración y política de actualización.
9. **Auditoría externa**: integraciones fiscales/pagos/sync y pruebas de payload adulterado.
10. **GitHub Actions**: último; ejecutar todo el conjunto cuando el runner vuelva a provisionar jobs.

## Criterio de cierre

Un bloque solo se cierra cuando existe:
- implementación;
- contrato;
- caller real;
- autorización;
- prueba positiva;
- prueba negativa;
- scope isolation;
- documentación actualizada;
- evidencia de ejecución.

No se considera cerrado por tener una pantalla, un botón o un archivo.


## 2026-10-08 — catálogo canónico ejecutable materializado

La auditoría de código encontró **18 códigos de permiso actualmente demostrados por casos de uso backend ejecutables**. Se centralizaron en `packages/contracts/src/permission-codes.ts` y los casos de uso existentes ahora consumen esa fuente común.

Códigos materializados:

- `SALES_SALE_CREATE`
- `SALES_RECEIPT_READ`
- `INVENTORY_STOCK_READ`
- `INVENTORY_STOCK_RECEIVE`
- `INVENTORY_STOCK_ADJUST`
- `CATALOG_PRODUCT_READ`
- `CATALOG_PRODUCT_REGISTER`
- `CUSTOMERS_CUSTOMER_READ`
- `CUSTOMERS_CUSTOMER_REGISTER`
- `PAYMENTS_PAYMENT_READ`
- `PAYMENTS_PAYMENT_REGISTER`
- `PAYMENTS_PAYMENT_CANCEL`
- `PAYMENTS_TRANSFER_REPORT`
- `PAYMENTS_TRANSFER_CONFIRM`
- `CASH_SHIFT_OPEN`
- `CASH_SHIFT_CLOSE`
- `FISCAL_DOCUMENT_ISSUE`
- `AUDIT_EVENT_READ`

Esto **no convierte la matriz conceptual de permisos en grants ejecutables**. La matriz contiene acciones adicionales que todavía requieren publicación autoritativa desde Central Authority. No se fabricaron equivalencias entre nombres conceptuales como `tenant.owner.change` y códigos ejecutables no demostrados.

### Corrección de seguridad derivada

La navegación administrativa ya no reutiliza permisos operativos de caja/ventas/inventario para habilitar superficies administrativas. Las pantallas administrativas/plataforma cuyo permiso canónico aún no está materializado permanecen no navegables; no reciben una autorización ficticia.

El Dashboard administrativo queda actualmente limitado por `AUDIT_EVENT_READ`, y sus métricas individuales continúan fallando cerrado. En particular, ventas y caja agregadas permanecen ausentes hasta que Central Authority publique permisos administrativos específicos para esas lecturas.

### Verificación de alineación del catálogo

Se añadió `apps/pos-local-service/tests/permission-catalog.test.ts` para comprobar que el conjunto de permisos consumidos por los casos de uso ejecutables coincide exactamente con `CANONICAL_PERMISSION_CODES`, sin duplicados. Esta prueba es estructural y no sustituye ejecución real del runner.

### Criterio de cierre de este bloque

- **IMPLEMENTED:** catálogo común de los 18 permisos ejecutables existentes.
- **IMPLEMENTED:** casos de uso backend alineados a esa fuente.
- **IMPLEMENTED:** navegación sin reutilización de grants operativos para administración.
- **PENDING:** publicación central de roles/grants para los permisos restantes de la matriz.
- **PENDING:** API/servicio administrativo central para Usuarios, Roles, Empresa, Sucursales, Dispositivos, Licencias y Superadmin.
- **PENDING:** pruebas CI/runtime; los runners de GitHub Actions continúan fallando antes del primer step.

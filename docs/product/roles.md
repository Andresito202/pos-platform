# Roles del sistema

La autorización combinará roles, empresa, sucursal, caja, turno, dispositivo y propiedad del recurso.

## Correspondencia de roles comerciales y perfiles técnicos (2026-11-13)

Esta sección fija la **política objetivo de presentación y separación de funciones**. No afirma que Central haya aprovisionado grants firmados ni altera el modelo existente de `roles`, `permissions` y `role_permission_grants`. El código local de desarrollo no es autorización BUSINESS/GLOBAL.

| Rol visible principal | Perfiles técnicos relacionados | Alcance y límite |
| --- | --- | --- |
| Superadministrador | `PLATFORM_OWNER` | Plataforma/GLOBAL: empresas, licencias, planes, dispositivos. Nunca Caja/carrito ni acceso automático a datos comerciales del cliente. |
| Administrador | `OWNER`, `GENERAL_ADMIN`, `BRANCH_MANAGER` | Administración de negocio: `OWNER` para su empresa; `GENERAL_ADMIN` según delegación; `BRANCH_MANAGER` solamente en sucursales asignadas. No obtiene Caja/carrito por pertenecer a este grupo. |
| Supervisor | `SUPERVISOR` | Supervisar, consultar y autorizar excepciones permitidas; no registrar ventas/cobros, abrir o cerrar turnos como cajero, crear productos/clientes ni recibir/ajustar inventario por defecto. |
| Cajero | `CASHIER` | Operación de ventas, carrito, cobro, comprobantes y turno propio; sin gestión administrativa. |

**No son equivalencias automáticas de privilegios.** La autoridad Central emite permisos atómicos por usuario y contexto (tenant, empresa, sucursal, instalación, dispositivo, sesión, estado y vigencia). La interfaz filtra vistas después de recibir capacidades verificadas; los handlers y casos de uso aplican el control efectivo. Ningún rol textual por sí solo concede un permiso, y la licencia habilita módulos pero no autoriza a un empleado.

### Perfiles de apoyo, capacidades y audiencias fuera de los cuatro espacios principales

- `BILLING_ADMIN`, `SUPPORT_AGENT`, `SECURITY_ADMIN`: perfiles internos de plataforma y soporte, no nuevas pantallas comerciales principales ni acceso implícito a datos/ventas de clientes. Soporte excepcional: autorización limitada, temporal y auditable.
- `INVENTORY_OPERATOR`, `PURCHASING_OPERATOR`, `PREPARATION_OPERATOR`: especializaciones del negocio que no se equiparan a Supervisor ni conceden automáticamente un quinto espacio comercial; su activación/UX y asignación requieren definición explícita antes de exponerlas.
- `COURIER` y `CUSTOMER`: actores de funcionalidades de domicilios o portal, no perfiles de acceso administrativo a POS Desktop. No pueden heredar permisos de Cajero, Supervisor o Administrador.

### Contratos y pruebas exigidas para aplicar esta política

1. Auditar en Central la asignación real de roles y grants, sin inventar seeds ni renombrar roles de base de datos para satisfacer la UI.
2. Para cada usuario comprobar conjuntamente: identidad, pertenencia al tenant/empresa/sucursal, permisos activos, licencia, vigencia y revocación; no inferir permiso por nombre visible.
3. Denegar en backend `sale.create`, cobros y turnos a Superadministrador/Administrador/Supervisor; denegar escritura de catálogo, clientes e inventario al Supervisor y Cajero, conservando consultas legítimas.
4. Probar rutas de presentación y llamadas directas forjadas contra handlers/casos de uso, tanto con sesión local de pruebas como con credenciales comerciales BUSINESS/GLOBAL cuando su emisor esté disponible.
5. Ejecutar las pruebas pendientes de controversia 1 (`local-operator-authorization.test.ts` y typecheck) y añadir las de identidad/asignación por ámbito. **No declarar ejecutadas las suites por la mera presencia de tests.**

## Roles de la plataforma

### PLATFORM_OWNER

Propietario técnico y comercial de la plataforma.

Puede administrar:

- clientes comerciales;
- licencias;
- planes;
- dispositivos;
- versiones;
- módulos;
- soporte;
- activaciones;
- suspensiones.

No tendrá acceso automático e ilimitado a información comercial sensible de los clientes.

### BILLING_ADMIN

Administra pagos, renovaciones, planes y estados de suscripción.

### SUPPORT_AGENT

Atiende incidencias mediante acceso temporal, autorizado, limitado y auditado.

### SECURITY_ADMIN

Administra incidentes, revocación de sesiones, dispositivos y controles críticos.

## Roles del negocio

### OWNER

Propietario del negocio.

Puede administrar:

- empresa;
- sucursales;
- usuarios;
- permisos;
- información comercial;
- QR de recaudo;
- configuración fiscal;
- seguridad;
- reportes;
- inventario global.

Los cambios críticos exigen reautenticación y segundo factor.

### GENERAL_ADMIN

Administra la operación general delegada por el propietario, salvo restricciones críticas.

### BRANCH_MANAGER

Administra una sucursal específica:

- caja;
- ventas;
- inventario;
- compras;
- usuarios operativos;
- reportes de sede.

### SUPERVISOR

Autoriza:

- descuentos;
- anulaciones;
- devoluciones;
- diferencias de caja;
- operaciones excepcionales.

### CASHIER

Puede:

- abrir y cerrar su turno;
- vender;
- cobrar;
- suspender ventas;
- recuperar ventas;
- reimprimir;
- asociar clientes;
- solicitar autorización.

No puede modificar:

- costos;
- QR;
- información fiscal;
- licencias;
- permisos;
- precios sin autorización;
- datos de otras sucursales.

### INVENTORY_OPERATOR

Administra recepción, movimientos, conteos, lotes, vencimientos y ajustes autorizados.

### PURCHASING_OPERATOR

Administra proveedores, órdenes de compra y recepciones.

### PREPARATION_OPERATOR

Prepara pedidos internos o de domicilio sin acceso a información financiera innecesaria.

### COURIER

Solo accede a:

- turno;
- pedidos asignados;
- ruta;
- estado de pago;
- QR autorizado;
- PIN de entrega;
- incidencias;
- recaudo propio.

### CUSTOMER

Accede exclusivamente a catálogo público, carrito, pedidos, direcciones, pagos y seguimiento.

## Principio obligatorio

Ocultar botones en el frontend no constituye seguridad. Todos los permisos se validan en el backend.

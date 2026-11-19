# Roles del sistema

La autorización combinará roles, empresa, sucursal, caja, turno, dispositivo y propiedad del recurso.

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

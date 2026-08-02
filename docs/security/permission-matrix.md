# Matriz de permisos

## Principios

1. Los permisos se validan siempre en backend.
2. Un rol no implica acceso a todas las empresas o sucursales.
3. La autorización debe considerar:
   - tenant;
   - empresa;
   - sucursal;
   - caja;
   - turno;
   - dispositivo;
   - propiedad del recurso.
4. Las acciones críticas requieren motivo, auditoría y, cuando corresponda, reautenticación o aprobación.
5. El proveedor de la plataforma no obtiene acceso automático a datos comerciales del cliente.

## Roles

- PLATFORM_OWNER
- BILLING_ADMIN
- SUPPORT_AGENT
- SECURITY_ADMIN
- OWNER
- GENERAL_ADMIN
- BRANCH_MANAGER
- SUPERVISOR
- CASHIER
- INVENTORY_OPERATOR
- PURCHASING_OPERATOR
- PREPARATION_OPERATOR
- COURIER
- CUSTOMER

## Convenciones

- Sí: permitido directamente.
- Condicional: requiere contexto, autorización adicional o política.
- Solo lectura: puede consultar, pero no modificar.
- No: prohibido.

## Plataforma y licencias

| Acción | PLATFORM_OWNER | BILLING_ADMIN | SUPPORT_AGENT | SECURITY_ADMIN | OWNER |
|---|---:|---:|---:|---:|---:|
| Crear tenant | Sí | No | No | No | No |
| Crear empresa | Sí | No | No | No | No |
| Activar licencia | Sí | Sí | No | No | No |
| Suspender licencia | Sí | Sí | No | No | No |
| Cambiar plan | Sí | Sí | No | No | Solicitar |
| Activar módulo | Sí | Sí | No | No | Solicitar |
| Revocar dispositivo | Sí | No | Condicional | Sí | Condicional |
| Consultar estado técnico | Sí | Solo lectura | Sí | Sí | Solo su empresa |
| Acceder a ventas del cliente | No por defecto | No | Temporal y autorizado | Solo incidente | Sí |
| Crear acceso temporal de soporte | Sí | No | No | Sí | Autorizar |

## Empresa y sucursales

| Acción | OWNER | GENERAL_ADMIN | BRANCH_MANAGER | SUPERVISOR | CASHIER |
|---|---:|---:|---:|---:|---:|
| Editar nombre comercial | Sí | Condicional | No | No | No |
| Cambiar razón social | Reautenticación | No | No | No | No |
| Cambiar NIT | Reautenticación reforzada | No | No | No | No |
| Crear sucursal | Sí | Sí | No | No | No |
| Editar sucursal | Sí | Sí | Solo asignada | No | No |
| Desactivar sucursal | Sí | Condicional | No | No | No |
| Cambiar dirección | Reautenticación | Condicional | Solicitar | No | No |
| Cambiar QR de recaudo | Reautenticación reforzada | Rol financiero | No | No | No |
| Consultar todas las sucursales | Sí | Sí | Solo asignadas | Solo asignadas | Solo propia |

## Usuarios y permisos

| Acción | OWNER | GENERAL_ADMIN | BRANCH_MANAGER | SUPERVISOR | CASHIER |
|---|---:|---:|---:|---:|---:|
| Crear usuario | Sí | Sí | Solo sede | No | No |
| Desactivar usuario | Sí | Sí | Solo sede | No | No |
| Asignar rol global | Sí | Condicional | No | No | No |
| Asignar rol de sede | Sí | Sí | Condicional | No | No |
| Cambiar permisos críticos | Reautenticación | Condicional | No | No | No |
| Restablecer contraseña | Sí | Sí | Solo sede | No | Solo propia |
| Revocar sesión | Sí | Sí | Solo sede | No | Solo propia |

## Productos y precios

| Acción | OWNER | GENERAL_ADMIN | BRANCH_MANAGER | SUPERVISOR | INVENTORY_OPERATOR | CASHIER |
|---|---:|---:|---:|---:|---:|---:|
| Crear producto | Sí | Sí | Sí | Condicional | Sí | No |
| Editar producto | Sí | Sí | Sí | Condicional | Condicional | No |
| Desactivar producto | Sí | Sí | Condicional | No | Condicional | No |
| Cambiar precio | Sí | Sí | Condicional | Autorizar | No | No |
| Consultar costo | Sí | Sí | Condicional | Condicional | Sí | No |
| Aplicar descuento | Sí | Sí | Sí | Sí | No | Dentro de límite |
| Superar límite de descuento | Sí | Sí | Sí | Autorizar | No | No |

## Inventario

| Acción | OWNER | GENERAL_ADMIN | BRANCH_MANAGER | SUPERVISOR | INVENTORY_OPERATOR | CASHIER |
|---|---:|---:|---:|---:|---:|---:|
| Consultar stock | Sí | Sí | Sí | Sí | Sí | Operativo |
| Registrar recepción | Sí | Sí | Sí | Sí | Sí | No |
| Ajuste positivo | Sí | Sí | Condicional | Autorizar | Condicional | No |
| Ajuste negativo | Sí | Sí | Condicional | Autorizar | Condicional | No |
| Registrar merma | Sí | Sí | Sí | Sí | Sí | Condicional |
| Trasladar inventario | Sí | Sí | Condicional | Autorizar | Sí | No |
| Ver kardex | Sí | Sí | Sí | Sí | Sí | No |
| Eliminar movimiento | No | No | No | No | No | No |

## Compras

| Acción | OWNER | GENERAL_ADMIN | BRANCH_MANAGER | PURCHASING_OPERATOR | SUPERVISOR | CASHIER |
|---|---:|---:|---:|---:|---:|---:|
| Crear compra | Sí | Sí | Sí | Sí | Condicional | No |
| Recibir compra | Sí | Sí | Sí | Sí | Sí | No |
| Anular compra | Sí | Sí | Condicional | Solicitar | Autorizar | No |
| Editar costo | Sí | Sí | Condicional | Sí | Condicional | No |
| Consultar proveedores | Sí | Sí | Sí | Sí | Sí | No |

## Caja y ventas

| Acción | OWNER | GENERAL_ADMIN | BRANCH_MANAGER | SUPERVISOR | CASHIER |
|---|---:|---:|---:|---:|---:|
| Abrir caja propia | Sí | Sí | Sí | Sí | Sí |
| Cerrar caja propia | Sí | Sí | Sí | Sí | Sí |
| Abrir caja ajena | Sí | Sí | Condicional | Condicional | No |
| Registrar venta | Sí | Sí | Sí | Sí | Sí |
| Suspender venta | Sí | Sí | Sí | Sí | Sí |
| Recuperar venta | Sí | Sí | Sí | Sí | Sí |
| Anular venta | Sí | Sí | Condicional | Sí | No |
| Devolver venta | Sí | Sí | Condicional | Sí | Solicitar |
| Reimprimir recibo | Sí | Sí | Sí | Sí | Sí, auditado |
| Abrir cajón manualmente | Sí | Sí | Condicional | Autorizar | Condicional |
| Registrar ingreso de caja | Sí | Sí | Sí | Sí | Dentro de política |
| Registrar egreso de caja | Sí | Sí | Condicional | Autorizar | Dentro de límite |
| Eliminar cierre | No | No | No | No | No |

## Reportes

| Acción | OWNER | GENERAL_ADMIN | BRANCH_MANAGER | SUPERVISOR | CASHIER |
|---|---:|---:|---:|---:|---:|
| Ver ventas de empresa | Sí | Sí | No | No | No |
| Ver ventas de sucursal | Sí | Sí | Sí | Sí | Solo propias |
| Ver utilidad | Sí | Sí | Condicional | No | No |
| Ver costos | Sí | Sí | Condicional | Condicional | No |
| Exportar información | Sí | Condicional | Condicional | No | No |
| Ver auditoría | Sí | Condicional | Solo sede | Condicional | No |

## Domicilios

| Acción | OWNER | GENERAL_ADMIN | BRANCH_MANAGER | PREPARATION_OPERATOR | COURIER | CUSTOMER |
|---|---:|---:|---:|---:|---:|---:|
| Activar módulo | Solicitar/proveedor | No | No | No | No | No |
| Ver pedidos de empresa | Sí | Sí | No | No | No | No |
| Ver pedidos de sede | Sí | Sí | Sí | Asignados | Asignados | Propios |
| Preparar pedido | Sí | Sí | Sí | Sí | No | No |
| Asignar domiciliario | Sí | Sí | Sí | Condicional | No | No |
| Confirmar recogida | No | No | No | No | Sí | No |
| Mostrar QR del negocio | No | No | No | No | Sí, solo lectura | Escanear |
| Confirmar pago manual | Sí | Sí | Sí | No | No | No |
| Confirmar entrega con PIN | No | No | No | No | Sí | Entregar PIN |
| Modificar QR | Reautenticación | Rol financiero | No | No | No | No |
| Ver ubicación del domiciliario | Sí | Sí | Sí | Condicional | Propia | Pedido propio |

## Regla crítica

La matriz es una referencia de producto. Cada permiso deberá convertirse posteriormente en permisos atómicos, políticas y pruebas negativas.

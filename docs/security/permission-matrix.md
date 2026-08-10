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

## Permisos atómicos

Los permisos de producto descritos en esta matriz se descomponen en permisos atómicos verificables por backend.

Convención conceptual:

`dominio.recurso.acción`

Ejemplos:

- `sales.sale.create`;
- `sales.sale.cancel`;
- `sales.refund.request`;
- `sales.refund.approve`;
- `sales.refund.execute`;
- `payments.reversal.request`;
- `payments.reversal.approve`;
- `payments.reversal.execute`;
- `cash.expense.register`;
- `inventory.adjustment.request`;
- `inventory.adjustment.approve`;
- `inventory.adjustment.execute`;
- `inventory.waste.record`;
- `inventory.transfer.request`;
- `inventory.transfer.approve`;
- `inventory.transfer.dispatch`;
- `inventory.transfer.receive`;
- `inventory.conflict.review`;
- `inventory.compensation.execute`;
- `security.permission.change`;
- `tenant.owner.change`;
- `license.plan.change`.

Reglas:

1. Un permiso agregado de interfaz no sustituye permisos atómicos de backend.
2. Solicitar, aprobar y ejecutar una operación crítica deben poder separarse.
3. Ningún permiso permite acceso implícito a otro tenant.
4. Un permiso no elimina requisitos adicionales de MFA, reautenticación, estado contractual o política ABAC.
5. La ausencia de un permiso atómico produce denegación explícita.
6. Los permisos efectivos deben poder auditarse.
7. Los permisos administrativos críticos deben evitar privilegios implícitos por pertenencia a un rol demasiado amplio.

## Políticas ABAC

La autorización efectiva combina RBAC con atributos contextuales.

Atributos conceptuales mínimos:

- `tenant_id`;
- `company_id`;
- `branch_id`;
- `actor_id`;
- `role`;
- permisos atómicos;
- estado de sesión;
- estado de MFA;
- reautenticación reciente cuando corresponda;
- recurso afectado;
- propietario o alcance del recurso;
- estado de la operación;
- monto o nivel de riesgo cuando corresponda;
- dispositivo;
- canal;
- modalidad de licencia;
- política versionada.

Reglas:

1. `tenant_id` debe coincidir entre actor, recurso y operación.
2. El aislamiento de tenant prevalece sobre cualquier rol.
3. El alcance por empresa y sucursal debe validarse cuando aplique.
4. Un actor no puede aprobar su propia solicitud cuando la política exige segregación de funciones.
5. Las operaciones sensibles pueden exigir MFA o reautenticación adicional.
6. Los atributos de alto riesgo deben evaluarse en backend.
7. Las políticas deben ser deterministas y versionables.
8. Una política ABAC no puede ampliar derechos fuera de los permisos atómicos disponibles.
9. Una denegación no debe revelar información de otro tenant.
10. Las decisiones críticas deben ser auditables mediante código de razón estable.

## Segregación de funciones

Las operaciones de alto impacto deben permitir separación entre solicitud, aprobación y ejecución.

Aplicaciones mínimas:

| Operación | Solicitar | Aprobar | Ejecutar |
|---|---|---|---|
| Refund | `sales.refund.request` | `sales.refund.approve` | `sales.refund.execute` |
| Reversal | `payments.reversal.request` | `payments.reversal.approve` | `payments.reversal.execute` |
| Ajuste crítico de inventario | `inventory.adjustment.request` | `inventory.adjustment.approve` | `inventory.adjustment.execute` |
| Traslado de inventario | `inventory.transfer.request` | `inventory.transfer.approve` | `inventory.transfer.dispatch` / `inventory.transfer.receive` |
| Compensación de inventario | Revisión autorizada | `inventory.conflict.review` | `inventory.compensation.execute` |
| Cambio de permisos críticos | `security.permission.change` | Política reforzada | Aplicación controlada |
| Cambio de propietario | Solicitud autorizada | Reautenticación/MFA | Aplicación auditada |
| Cambio de plan/licencia | Solicitud autorizada | Política comercial | Aplicación autoritativa |

Reglas:

1. La misma persona no debe completar todas las etapas cuando la política exija segregación.
2. Las excepciones requieren autorización reforzada y auditoría.
3. Las transiciones deben conservar actor, momento, motivo y `correlation_id`.
4. La separación de funciones no debe implementarse únicamente en frontend.

## Pruebas negativas mínimas

Cada módulo crítico debe probar como mínimo:

1. usuario sin permiso atómico;
2. usuario con rol válido pero fuera de tenant;
3. usuario con tenant válido pero sucursal fuera de alcance;
4. sesión revocada;
5. MFA requerido y ausente;
6. reautenticación requerida y ausente;
7. actor intentando aprobar su propia solicitud cuando no está permitido;
8. actor intentando ejecutar sin aprobación previa;
9. acceso por identificador de recurso perteneciente a otro tenant;
10. manipulación de `tenant_id`, `company_id` o `branch_id`;
11. intento de elevar permisos desde frontend;
12. operación crítica con estado incompatible;
13. recurso inexistente sin filtrar información sensible;
14. permiso correcto pero política ABAC denegada;
15. bypass de autorización por operación offline;
16. replay de una aprobación o ejecución ya consumida;
17. intento de acceso después de revocación de sesión;
18. intento de cambio crítico sin auditoría obligatoria.

## Contrato de decisión de autorización

Toda autorización sensible debe poder producir una decisión estructurada con:

- `allowed`;
- `reason_code`;
- `tenant_id`;
- `actor_id`;
- `permission`;
- `resource_type`;
- `resource_id` opcional;
- `policy_version`;
- `correlation_id`;
- `evaluated_at`.

Códigos de razón conceptuales pueden incluir:

- `ALLOW`;
- `PERMISSION_DENIED`;
- `TENANT_MISMATCH`;
- `BRANCH_SCOPE_DENIED`;
- `SESSION_REVOKED`;
- `MFA_REQUIRED`;
- `REAUTH_REQUIRED`;
- `SELF_APPROVAL_DENIED`;
- `INVALID_OPERATION_STATE`;
- `POLICY_DENIED`;
- `RESOURCE_NOT_ACCESSIBLE`.

## Regla crítica

La matriz es una referencia de producto. Cada permiso deberá convertirse posteriormente en permisos atómicos, políticas y pruebas negativas.

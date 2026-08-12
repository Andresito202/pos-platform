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
| Cambiar QR de recaudo | Reautenticación reforzada | Condicional con `payments.provider.configure` | No | No | No |
| Consultar todas las sucursales | Sí | Sí | Solo asignadas | Solo asignadas | Solo propia |

## Usuarios y permisos

| Acción | OWNER | GENERAL_ADMIN | BRANCH_MANAGER | SUPERVISOR | CASHIER |
|---|---:|---:|---:|---:|---:|
| Crear usuario | Sí | Sí | Solo sede | No | No |
| Desactivar usuario | Sí | Sí | Solo sede | No | No |
| Asignar rol de negocio a nivel tenant o empresa | Sí | Condicional | No | No | No |
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

## Recepción y proveedores

| Acción | OWNER | GENERAL_ADMIN | BRANCH_MANAGER | PURCHASING_OPERATOR | SUPERVISOR | CASHIER |
|---|---:|---:|---:|---:|---:|---:|
| Registrar GoodsReceipt confirmado | Sí | Sí | Sí | Sí | Sí | No |
| Consultar GoodsReceipt | Sí | Sí | Sí | Sí | Sí | No |
| Consultar proveedores | Sí | Sí | Sí | Sí | Sí | No |

No existe permiso para anular o editar un GoodsReceipt confirmado. Los errores de inventario utilizan los permisos separados de ajuste, revisión y compensación; los permisos de PurchaseOrder se definirán únicamente al abordar `PUR-001`.

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
| Realizar arqueo propio | Sí | Sí | Sí | Sí | Sí |
| Abandonar arqueo propio | Sí | Sí | Sí | Sí | Sí, auditado |
| Consultar arqueo | Sí | Sí | Sí | Sí | Solo propio |
| Revisar diferencia | Sí | Sí | Sí | Sí | No sobre diferencia propia crítica |
| Aceptar diferencia material | Sí | Sí | Condicional | Sí | No sobre diferencia propia crítica |
| Eliminar cierre | No | No | No | No | No |

`Devolver venta` representa el ciclo comercial de `SaleReturn`: CASHIER solo solicita mediante `sales.return.request`; aprobación, ejecución y revisión exigen los permisos `sales.return.*` correspondientes y las políticas de alcance/riesgo. Ningún rol obtiene por esta fila autorización implícita para Refund, Reversal, CashMovement, InventoryMovement o efecto fiscal.

## Operaciones financieras de Payments

| Acción | OWNER | GENERAL_ADMIN | BRANCH_MANAGER | SUPERVISOR |
|---|---:|---:|---:|---:|
| Registrar Settlement | Sí | Sí | Condicional | Condicional |
| Consultar Settlement | Sí | Sí | Solo alcance | Solo alcance |
| Revisar Settlement | Sí | Sí | Condicional | Condicional |
| Iniciar Reconciliation | Sí | Sí | Solo alcance | Solo alcance |
| Consultar Reconciliation | Sí | Sí | Solo alcance | Solo alcance |
| Revisar o resolver diferencias | Reforzado | Reforzado | Condicional | Condicional |
| Cerrar Reconciliation | Reforzado | Reforzado | Condicional | Condicional |
| Reabrir Reconciliation | Reforzado | Reforzado | No por defecto | No por defecto |
| Configurar proveedor | Reforzado | Condicional | No | No |

La tabla no crea roles financieros. Cada celda exige el permiso atómico correspondiente y evaluación ABAC de tenant, company, branch, importe, estado, fuente, sesión, dispositivo y riesgo. `Reforzado` incluye motivo y auditoría append-only y puede exigir reautenticación, MFA y segregación de funciones según política.

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
| Modificar QR | Reautenticación | Condicional con `payments.provider.configure` | No | No | No | No |
| Ver ubicación del domiciliario | Sí | Sí | Sí | Condicional | Propia | Pedido propio |

## Permisos atómicos

Los permisos de producto descritos en esta matriz se descomponen en permisos atómicos verificables por backend.

Convención conceptual:

`dominio.recurso.acción`

Ejemplos:

- `sales.sale.create`;
- `sales.sale.cancel`;
- `sales.return.request`;
- `sales.return.approve`;
- `sales.return.execute`;
- `sales.return.review`;
- `sales.return.read`;
- `payments.refund.request`;
- `payments.refund.approve`;
- `payments.refund.execute.cash`;
- `payments.refund.execute.external`;
- `payments.refund.override_method`;
- `payments.refund.override_distribution`;
- `payments.refund.review`;
- `payments.refund.read`;
- `payments.reversal.request`;
- `payments.reversal.approve`;
- `payments.reversal.execute`;
- `payments.settlement.record`;
- `payments.settlement.read`;
- `payments.settlement.review`;
- `payments.reconciliation.start`;
- `payments.reconciliation.read`;
- `payments.reconciliation.review`;
- `payments.reconciliation.resolve`;
- `payments.reconciliation.close`;
- `payments.reconciliation.reopen`;
- `payments.provider.configure`;
- `cash.expense.register`;
- `cash.shift.open`;
- `cash.shift.close`;
- `cash.count.start`;
- `cash.count.complete`;
- `cash.count.abort`;
- `cash.count.correct`;
- `cash.count.read`;
- `cash.difference.review`;
- `cash.difference.accept`;
- `cash.difference.escalate`;
- `cash.difference.resolve`;
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
- `purchasing.goods_receipt.confirm`;
- `purchasing.goods_receipt.read`;
- `suppliers.supplier.read`;
- `security.permission.change`;
- `tenant.owner.change`;
- `license.plan.change`;
- `pricing.policy.read`;
- `pricing.policy.create_draft`;
- `pricing.policy.publish`;
- `pricing.policy.schedule`;
- `pricing.policy.revoke`;
- `pricing.policy.supersede`;
- `tax.rule.read`;
- `tax.rule.create_draft`;
- `tax.rule.publish`;
- `tax.rule.schedule`;
- `tax.rule.revoke`;
- `tax.rule.supersede`;
- `cash.policy.read`;
- `cash.policy.create_draft`;
- `cash.policy.publish`;
- `cash.policy.schedule`;
- `cash.policy.revoke`;
- `cash.policy.supersede`;
- `inventory.policy.read`;
- `inventory.policy.create_draft`;
- `inventory.policy.publish`;
- `inventory.policy.schedule`;
- `inventory.policy.revoke`;
- `inventory.policy.supersede`;
- `authorization.policy.read`;
- `authorization.policy.create_draft`;
- `authorization.policy.publish`;
- `authorization.policy.schedule`;
- `authorization.policy.revoke`;
- `authorization.policy.supersede`;
- `payments.provider_configuration.read`;
- `payments.provider_configuration.create_draft`;
- `payments.provider_configuration.publish`;
- `payments.provider_configuration.schedule`;
- `payments.provider_configuration.revoke`;
- `payments.provider_configuration.supersede`;
- `fiscal.configuration.read`;
- `fiscal.configuration.create_draft`;
- `fiscal.configuration.publish`;
- `fiscal.configuration.schedule`;
- `fiscal.configuration.revoke`;
- `fiscal.configuration.supersede`.

Reglas:

1. Un permiso agregado de interfaz no sustituye permisos atómicos de backend.
2. Solicitar, aprobar y ejecutar una operación crítica deben poder separarse.
3. Ningún permiso permite acceso implícito a otro tenant.
4. Un permiso no elimina requisitos adicionales de MFA, reautenticación, estado contractual o política ABAC.
5. La ausencia de un permiso atómico produce denegación explícita.
6. Los permisos efectivos deben poder auditarse.
7. Los permisos administrativos críticos deben evitar privilegios implícitos por pertenencia a un rol demasiado amplio.
8. No existe un permiso universal `configuration.manage`; cada lifecycle se autoriza en el dominio propietario.
9. `payments.provider.configure` protege el cambio sensible de conexión o referencia secreta y no sustituye permisos de lifecycle de `payments.provider_configuration.*`.
10. Restaurar comportamiento usa el permiso `supersede` específico del dominio para publicar una versión nueva; ningún permiso permite mutar o reactivar una versión histórica.

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
| SaleReturn | `sales.return.request` | `sales.return.approve` | `sales.return.execute` |
| Refund | `payments.refund.request` | `payments.refund.approve` | `payments.refund.execute.cash` / `payments.refund.execute.external` |
| Reversal | `payments.reversal.request` | `payments.reversal.approve` | `payments.reversal.execute` |
| Resolución de diferencia | Revisión con `payments.reconciliation.review` | Política reforzada | `payments.reconciliation.resolve` |
| Cierre de Reconciliation | `payments.reconciliation.close` | Política reforzada cuando aplique | Cierre auditado |
| Reapertura de Reconciliation | `payments.reconciliation.reopen` | Reautenticación/MFA según política | Reapertura versionada |
| Configuración de proveedor | `payments.provider.configure` | Segregación según riesgo | Aplicación auditada sin exponer secretos |
| Publicación/revocación de política de dominio | Permisos `publish` / `revoke` específicos enumerados en esta matriz | Reautenticación/MFA y actor distinto según riesgo | Versión inmutable y auditoría append-only |
| Sustitución de configuración fiscal/proveedor | `fiscal.configuration.supersede` / `payments.provider_configuration.supersede` | Segregación y permiso sensible adicional cuando cambie referencia secreta | Nueva versión; nunca edición histórica |
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
5. `sales.return.*` no concede permisos `payments.refund.*` o `payments.reversal.*`; cada módulo autoriza y audita su propio efecto.
6. SaleReturn puede exigir reautenticación, MFA o aprobación superior por importe, condición física, operación fuera de ventana, self-approval, sucursal, dispositivo o riesgo de fraude.
7. Cerrar o reabrir Reconciliation, aceptar o resolver diferencias y configurar proveedor requieren motivo y auditoría append-only; la política puede exigir reautenticación, MFA y actores distintos.
8. Los permisos de Settlement o Reconciliation no conceden `payments.provider.configure`, `payments.reversal.*`, acceso cross-tenant ni autoridad para modificar Payment histórico.
9. Lectura, draft, publicación, programación, revocación y sustitución de configuraciones son acciones independientes; un rol existente solo las obtiene por grants explícitos y scope válido.

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

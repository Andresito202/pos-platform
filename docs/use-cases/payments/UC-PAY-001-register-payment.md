# UC-PAY-001: Registrar pago individual

## Objetivo

Registrar un cobro asociado a una venta, pedido, devolución comercial o cuenta por cobrar, respetando el ciclo de vida del medio de pago, la autorización, la idempotencia, la caja, el modo offline y el aislamiento multiempresa.

En este dominio `Payment` representa fondos recibidos o por recibir de clientes. No representa cuentas por pagar ni pagos a proveedores; esa capacidad financiera permanece diferida y utilizará un agregado separado.

---

## Actor principal

Según el medio y el canal:

- cajero;
- supervisor;
- administrador autorizado;
- servicio de pagos;
- POS local;
- aplicación de pedidos;
- integración externa autenticada.

---

## Actores secundarios

- cliente;
- domiciliario;
- proveedor de pagos;
- módulo de caja;
- módulo de ventas;
- módulo de auditoría;
- motor de licencias;
- servicio de sincronización.

---

## Precondiciones generales

1. El usuario o servicio está autenticado.
2. El tenant y la empresa están activos.
3. La sucursal pertenece a la empresa.
4. La licencia permite la operación.
5. El medio de pago está habilitado.
6. La venta, pedido o cuenta por cobrar existe.
7. La operación no está anulada ni cerrada de forma incompatible.
8. El usuario posee el permiso requerido.
9. El dispositivo está autorizado cuando corresponda.
10. Existe una política monetaria y de redondeo vigente.
11. La moneda coincide con la operación.
12. La solicitud contiene una `idempotency_key`.

---

## Entrada

- `payment_id`;
- `idempotency_key`;
- `sale_id`, `order_id` o `receivable_id`;
- `payment_method`;
- `amount`;
- `currency`;
- `branch_id`;
- `cash_register_id` opcional;
- `cash_shift_id` opcional;
- `device_id`;
- `customer_id` opcional;
- `provider_id` opcional;
- `external_reference` opcional;
- `reported_at` opcional;
- `evidence_reference` opcional;
- `metadata` controlada;
- `correlation_id`.

El contexto de `tenant_id` y `company_id` se deriva de la sesión, licencia o identidad técnica autorizada. No se acepta como autoridad un valor libre enviado por el frontend.

---

## Salida

- `payment_id`;
- `status`;
- `amount`;
- `currency`;
- `confirmed_amount`;
- `pending_amount`;
- `payment_method`;
- `external_reference`;
- `cash_movement_id` opcional;
- `sale_payment_status`;
- `requires_confirmation`;
- `requires_reconciliation`;
- `created_at`;
- `pricing_pipeline_version`;
- `tax_policy_version`;
- `rounding_policy_version`;
- `audit_reference`.

---

## Permisos iniciales

### Efectivo

- `payments.cash.register`;
- caja abierta propia;
- turno activo.

### Transferencia o QR manual

- `payments.transfer.report`;
- `payments.transfer.confirm`, para confirmar.

### Tarjeta o proveedor externo

- credencial técnica válida;
- firma o autenticidad del proveedor;
- permiso de integración.

### Crédito

- `credit.sale.use`;
- cliente identificado;
- cupo disponible;
- política de crédito vigente.

---

## Validaciones comunes

1. El importe debe ser mayor que cero.
2. La moneda debe coincidir con la venta, pedido o cuenta por cobrar.
3. El pago no puede pertenecer a otro tenant.
4. La sucursal debe coincidir con la operación.
5. El medio debe estar habilitado para la empresa y canal.
6. La referencia externa debe cumplir el formato definido.
7. La misma referencia no puede reutilizarse de forma incompatible.
8. La solicitud repetida no puede crear un segundo pago.
9. Un pago rechazado o cancelado no cubre la venta.
10. Un pago reportado no equivale a confirmado.
11. El valor confirmado acumulado no puede exceder el total pagadero sin una política explícita.
12. La operación no puede encontrarse anulada.
13. El método debe ser compatible con el modo offline actual.
14. El estado inicial debe corresponder al método.
15. La sesión y el dispositivo no pueden estar revocados.

---

## Flujo principal general

1. El actor inicia el registro del pago.
2. El sistema valida la estructura de la solicitud.
3. Deriva tenant, empresa, sucursal, usuario y dispositivo.
4. Verifica licencia, módulo y medio habilitado.
5. Localiza la venta, pedido o cuenta por cobrar.
6. Verifica propiedad y estado.
7. Consulta pagos existentes asociados.
8. Comprueba la `idempotency_key`.
9. Comprueba referencias externas duplicadas.
10. Calcula el saldo pendiente.
11. Valida el importe solicitado.
12. Determina el flujo específico según `payment_method`.
13. Crea el pago con el estado inicial correspondiente.
14. Registra datos del actor y dispositivo.
15. Ejecuta el flujo específico del medio.
16. Actualiza la cobertura derivada de la operación.
17. Registra auditoría.
18. Guarda eventos críticos mediante outbox.
19. Confirma la transacción.
20. Devuelve el estado real del pago.
21. Procesos secundarios continúan sin bloquear la operación principal.
22. La impresión o notificación no cambia la validez financiera.

---

# Flujo por medio de pago

## 1. Efectivo

### Precondiciones adicionales

- caja abierta;
- turno activo;
- cajero autorizado;
- sucursal y terminal correctas.

### Entrada adicional

- `amount_received`;
- `change_amount`;
- denominaciones opcionales.

### Flujo

1. Se valida el turno.
2. Se valida el total pagadero.
3. Se valida el `payable_amount` y el snapshot de redondeo ya congelados.
4. Se verifica que el valor recibido cubra el importe.
5. Se calcula el cambio.
6. Se crea el pago en `CONFIRMED`.
7. Se registra el movimiento de caja.
8. Pago y movimiento se guardan atómicamente.
9. La conciliación queda pendiente para cierre o arqueo.
10. Se actualiza el estado de pago de la venta.

### Reglas

- El efectivo incrementa el efectivo esperado.
- El cambio no es un egreso comercial independiente.
- No se permite registrar efectivo sin caja abierta.
- La impresión fallida no revierte el pago.
- El redondeo queda separado del descuento.

---

## 2. Transferencia o QR estático

### Entrada adicional

- entidad financiera;
- referencia;
- cuenta o QR destino versionado;
- fecha reportada;
- evidencia opcional.

### Flujo

1. Se valida que el QR o cuenta pertenezca al negocio.
2. Se valida la referencia.
3. Se crea el `Payment` como `PENDING` y se registra el reporte como evidencia inmutable del `PaymentAttempt`.
4. No se considera cobertura confirmada.
5. Se notifica al usuario autorizado para verificar.
6. La venta queda `PAYMENT_PENDING` o según política.
7. El pago deberá pasar por `UC-PAY-003`.

### Reglas

- Una captura no confirma el pago.
- El domiciliario solo reporta.
- El cajero confirma únicamente con permiso explícito.
- Una referencia repetida genera alerta.
- Sin Internet no se inventa confirmación bancaria.

---

## 3. Tarjeta o proveedor externo

### Flujo

1. Se crea el pago en `CREATED`.
2. Se envía la solicitud al proveedor.
3. El pago pasa a `PENDING`.
4. El proveedor responde de forma autenticada.
5. El `PaymentAttempt` puede pasar a:
   - `PROCESSING`, conservando por separado la evidencia de autorización cuando todavía no exista confirmación financiera;
   - `CONFIRMED`;
   - `DECLINED`;
   - `FAILED`.
   El `Payment` agregado permanece `PENDING` mientras no exista resultado concluyente y deriva únicamente uno de los estados permitidos por `PaymentStatus`.
6. Los callbacks se procesan idempotentemente.
7. Una confirmación válida puede cubrir la venta.
8. La liquidación y conciliación ocurren después.

### Reglas

- El frontend no confirma el pago.
- La referencia del proveedor debe ser única.
- Un timeout no implica rechazo automático.
- Una respuesta tardía debe poder procesarse.
- Un webhook repetido no duplica caja ni ventas.

---

## 4. Crédito del cliente

### Precondiciones adicionales

- cliente identificado;
- cuenta de crédito activa;
- cupo suficiente;
- permiso o autorización;
- política de mora vigente.

### Flujo

1. Se valida el cliente.
2. Se calcula el saldo y cupo.
3. Se crea una cuenta por cobrar o movimiento de crédito.
4. No se crea ingreso de efectivo.
5. La venta puede quedar comercialmente cubierta por crédito.
6. Los pagos posteriores se registran como pagos reales separados.

### Reglas

- Crédito no equivale a efectivo.
- No incrementa caja.
- Debe registrar límite, saldo y vencimiento.
- Debe poder bloquearse por mora o cupo.
- Los abonos son operaciones independientes.

---

## Estados iniciales por método

| Método | Estado inicial normal |
|---|---|
| CASH | CONFIRMED |
| BANK_TRANSFER manual | PENDING, con reporte en el intento |
| STATIC_QR | PENDING, con reporte en el intento |
| CARD | CREATED o PENDING |
| DIGITAL_WALLET con API | CREATED o PENDING |
| CUSTOMER_CREDIT | Cuenta por cobrar, no dinero confirmado |

---

## Estado derivado de la venta

Después de registrar el pago, el sistema recalcula:

- `UNPAID`;
- `PARTIALLY_PAID`;
- `PAYMENT_PENDING`;
- `PAID`;
- `PAYMENT_FAILED`;
- `PARTIALLY_REFUNDED`;
- `REFUNDED`.

Este estado no puede editarse manualmente.

---

## Operación offline

### Permitido

- efectivo confirmado localmente;
- crédito autorizado con datos sincronizados;
- registro de transferencia como `Payment=PENDING`, con el reporte conservado en el intento;
- persistencia local e inclusión en outbox.

### No permitido

- confirmación bancaria inventada;
- liquidación;
- conciliación externa;
- consulta en línea inexistente;
- cambio de QR o cuenta.

### Flujo offline

1. Se valida la licencia local.
2. Se crea el identificador global.
3. Se procesa el medio permitido.
4. Se persiste localmente.
5. Se crea evento de sincronización.
6. Al recuperar Internet se envía idempotentemente.
7. Los conflictos se marcan para revisión.

---

## Idempotencia

La combinación de:

- `payment_id`;
- `idempotency_key`;
- proveedor;
- referencia externa;
- tenant;
- empresa;

debe impedir duplicados.

Una repetición válida devuelve el resultado original.

Una repetición con contenido diferente bajo la misma clave debe rechazarse como conflicto.

---

## Transacción

Para efectivo, dentro de una misma transacción deben registrarse:

- pago;
- asignación a venta;
- movimiento de caja;
- estado derivado;
- auditoría;
- evento de outbox.

Para medios externos, la creación del pago y su estado inicial deben ser atómicos; la confirmación posterior es otra transición auditada.

---

## Persistencia conceptual afectada

- `payments`;
- `payment_allocations`;
- `cash_movements`, cuando aplica;
- `credit_transactions`, cuando aplica;
- `audit_events`;
- `outbox_events`;
- proyección del estado de pago de la venta.

No se deben modificar directamente movimientos históricos.

---

## Eventos

Según el método y resultado:

- `PaymentInitiated`;
- `PaymentReported`;
- `PaymentAuthorizationRecorded`;
- `PaymentConfirmed`;
- `PaymentAttemptDeclined`;
- `PaymentFailed`;
- `CashMovementRecorded`;
- `CreditTransactionCreated`;
- `PaymentAllocationCreated`;
- `SalePaymentStatusChanged`.

---

## Auditoría

Debe registrar:

- actor;
- rol;
- empresa;
- sucursal;
- caja;
- turno;
- dispositivo;
- importe;
- medio;
- estado inicial;
- referencia externa protegida;
- fecha;
- IP cuando aplique;
- correlación;
- resultado;
- errores relevantes.

No se almacenarán secretos ni credenciales completas en logs.

---

## Excepciones

- venta inexistente;
- venta anulada;
- venta, pedido o cuenta por cobrar cerrada;
- importe inválido;
- caja cerrada;
- dispositivo revocado;
- licencia restringida;
- medio deshabilitado;
- referencia duplicada;
- proveedor no disponible;
- timeout;
- sesión expirada;
- conflicto de idempotencia;
- saldo insuficiente para crédito;
- acceso entre tenants;
- configuración monetaria inválida.

---

## Recuperación ante fallos

### Fallo antes del commit

No debe persistirse un pago parcial.

### Fallo después de confirmación local

La recuperación debe devolver el pago existente mediante idempotencia.

### Fallo de impresión

El pago permanece válido.

### Fallo de sincronización

El pago queda localmente confirmado o reportado según el método y permanece en outbox.

### Respuesta tardía del proveedor

Debe procesarse usando el identificador y referencia originales.

---

## Invariantes

1. Un pago confirmado no se elimina.
2. Reportar no equivale a confirmar.
3. El efectivo exige caja abierta.
4. El crédito no incrementa efectivo.
5. El domiciliario no confirma transferencias.
6. La suma de pagos confirmados determina la cobertura.
7. Una solicitud repetida no duplica pago ni caja.
8. Una referencia externa no se reutiliza de forma incompatible.
9. El frontend no determina la validez financiera.
10. Los pagos de otro tenant son inaccesibles.
11. Los estados siguen la máquina definida.
12. La impresión no controla la validez del pago.
13. La operación offline no inventa confirmaciones externas.
14. Toda transición crítica queda auditada.
15. El estado de pago de la venta es derivado.

---

## Criterios de aceptación

1. Un pago en efectivo válido se registra junto al movimiento de caja.
2. Una transferencia manual queda `Payment=PENDING` con evidencia de reporte, no `CONFIRMED`.
3. Un pago con la misma `idempotency_key` no se duplica.
4. Una referencia externa repetida genera conflicto.
5. Un cajero sin caja abierta no puede registrar efectivo.
6. Un pago de otro tenant no puede consultarse ni asignarse.
7. Una falla de impresión no revierte el pago.
8. Una venta offline en efectivo puede sincronizarse posteriormente sin duplicarse.
9. El crédito genera cuenta por cobrar y no efectivo.
10. El estado de pago de la venta se recalcula automáticamente.

---

## Pruebas mínimas

- efectivo exacto;
- efectivo con cambio;
- efectivo sobre venta con redondeo ya congelado;
- caja cerrada;
- transferencia reportada;
- QR estático;
- tarjeta pendiente;
- proveedor rechazado;
- timeout;
- crédito válido;
- crédito sin cupo;
- pago parcial;
- pago superior;
- solicitud duplicada;
- referencia externa duplicada;
- venta anulada;
- dispositivo revocado;
- licencia restringida;
- operación offline;
- sincronización repetida;
- aislamiento entre tenants;
- rollback transaccional.

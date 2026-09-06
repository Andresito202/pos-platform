# UC-CASH-001: Abrir turno de caja

## Actor principal

Cajero, supervisor o administrador autorizado.

## Precondiciones

- Usuario autenticado.
- Caja física activa.
- Dispositivo autorizado.
- Licencia operativa.
- No existe un turno incompatible sobre la caja, conforme a la sección «Turno incompatible».
- El usuario tiene permiso.

## Entrada

- cash_register_id;
- opening_amount;
- observación opcional;
- idempotency_key.

## Flujo principal

1. El usuario selecciona la caja.
2. El sistema valida empresa, sucursal, dispositivo y permiso.
3. El sistema verifica que la caja no tenga un turno incompatible, es decir, ninguno en estado `OPEN` ni `CLOSING`.
4. El usuario registra la base inicial.
5. El sistema valida que el valor sea no negativo.
6. Se crea el turno.
7. Se registra un movimiento de apertura.
8. Se registra auditoría.
9. Se emite CashShiftOpened.
10. El POS queda habilitado para ventas.

## Turno incompatible

Definición normativa. Un `CashShift` es **incompatible** con una nueva apertura cuando pertenece a la misma caja —identificada por tenant, sucursal y `cash_register_id`— y se encuentra en estado `OPEN` o `CLOSING`.

- `OPEN` y `CLOSING` son estados **activos**: el efectivo del cajón está bajo la custodia de ese turno, y cualquier apertura nueva sobre esa caja es incompatible.
- `CLOSED` **no** genera incompatibilidad. Una caja cuyo último turno está cerrado admite una apertura nueva.
- **La identidad del dispositivo no interviene.** Una apertura originada en otro terminal sobre una caja con turno activo es igualmente incompatible. `origin_device_id` registra procedencia, idempotencia, auditoría y trazabilidad; no expresa propiedad ni exclusividad sobre la caja.
- Una `CashRegister` representa **un único cajón físico de efectivo**. Un comercio que necesite dos terminales con efectivo independiente debe provisionar dos `CashRegister` distintas.
- **La idempotencia es un eje independiente de la incompatibilidad.** El reintento de la misma solicitud, con la misma clave y el mismo contenido, devuelve el resultado ya conocido: no es una segunda apertura y no se evalúa como incompatibilidad.

## Frontera transaccional

La comprobación de turno incompatible, la creación de `CashShift`, el movimiento de apertura, la auditoría, el resultado idempotente y la outbox se ejecutan en una sola transacción.

Debe existir una restricción que impida más de un turno abierto o en cierre por tenant, sucursal y caja. La verificación previa no sustituye esa protección contra concurrencia.

## Excepciones

- Caja inactiva.
- Caja abierta por otro usuario.
- Licencia restringida.
- Dispositivo no autorizado.
- Solicitud repetida.

## Postcondiciones

- Existe un turno abierto.
- La base está separada de ventas.
- La operación es idempotente.

## Pruebas mínimas

- apertura correcta;
- segunda apertura desde el mismo dispositivo;
- segunda apertura desde otro dispositivo;
- base negativa;
- dispositivo ajeno;
- usuario sin permiso;
- repetición de solicitud.

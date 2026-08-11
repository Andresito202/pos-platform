# UC-CASH-001: Abrir turno de caja

## Actor principal

Cajero, supervisor o administrador autorizado.

## Precondiciones

- Usuario autenticado.
- Caja física activa.
- Dispositivo autorizado.
- Licencia operativa.
- No existe otro turno abierto incompatible.
- El usuario tiene permiso.

## Entrada

- cash_register_id;
- opening_amount;
- observación opcional;
- idempotency_key.

## Flujo principal

1. El usuario selecciona la caja.
2. El sistema valida empresa, sucursal, dispositivo y permiso.
3. El sistema verifica que la caja no tenga un turno abierto incompatible.
4. El usuario registra la base inicial.
5. El sistema valida que el valor sea no negativo.
6. Se crea el turno.
7. Se registra un movimiento de apertura.
8. Se registra auditoría.
9. Se emite CashShiftOpened.
10. El POS queda habilitado para ventas.

## Frontera transaccional

La comprobación de turno incompatible, la creación de `CashShift`, el movimiento de apertura, la auditoría, el resultado idempotente y la outbox se ejecutan en una sola transacción.

Debe existir una restricción que impida más de un turno abierto incompatible por tenant, sucursal, caja y terminal. La verificación previa no sustituye esa protección contra concurrencia.

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
- segunda apertura;
- base negativa;
- dispositivo ajeno;
- usuario sin permiso;
- repetición de solicitud.

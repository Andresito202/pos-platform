# UC-CASH-002: Cerrar turno de caja

## Actor principal

Cajero o usuario autorizado.

## Precondiciones

- Existe un turno abierto.
- El usuario tiene acceso al turno.
- Las operaciones locales críticas están persistidas.

## Entrada

- cash_shift_id;
- counted_amount;
- desglose opcional por denominación;
- observación;
- idempotency_key.

## Flujo principal

1. El sistema bloquea nuevas operaciones incompatibles sobre el turno.
2. Calcula efectivo esperado.
3. Separa:
   - base inicial;
   - ventas en efectivo;
   - ingresos;
   - egresos;
   - retiros;
   - devoluciones;
   - recaudos de domiciliarios.
4. El usuario registra el valor contado.
5. El sistema calcula la diferencia.
6. Si supera el umbral, exige observación o autorización.
7. Se cierra el turno.
8. Se registra auditoría.
9. Se emite CashShiftClosed.
10. Se actualiza el dashboard.

## Excepciones

- Turno inexistente o cerrado.
- Operaciones pendientes que impiden cierre.
- Diferencia superior al límite sin autorización.
- Solicitud repetida.

## Postcondiciones

- El turno queda inmutable.
- Se conservan esperado, contado y diferencia.
- No se elimina el cierre.

## Pruebas mínimas

- cierre sin diferencia;
- cierre con diferencia;
- cierre duplicado;
- usuario ajeno;
- pagos electrónicos excluidos del efectivo;
- devoluciones y retiros.

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
- referencia de autorización opcional cuando la política la exige;
- expected_version;
- idempotency_key;
- correlation_id.

## Flujo principal

1. El sistema bloquea nuevas operaciones incompatibles sobre el turno.
2. Congela la secuencia de corte y calcula efectivo esperado exclusivamente desde CashMovement `POSTED`.
3. Separa:
   - base inicial;
   - ventas en efectivo;
   - ingresos;
   - egresos;
   - retiros;
   - devoluciones;
   - recaudos de domiciliarios.
4. El usuario registra el valor contado y, cuando corresponda, denominaciones cuya suma debe coincidir.
5. El sistema crea CashCount `CLOSING` completado y calcula la diferencia sin crear movimientos automáticos.
6. Si existe cualquier diferencia, crea CashDifferenceReview; si supera el umbral, exige observación o una referencia de autorización válida conforme a política y segregación de funciones.
7. Se enlaza el conteo de cierre y se cierra el turno.
8. Se registra auditoría.
9. Se emiten CashCountCompleted, CashDifferenceDetected cuando aplique y CashShiftClosed.
10. Se actualiza el dashboard.

## Frontera transaccional y concurrencia

1. El cierre obtiene lock o valida `expected_version` sobre `CashShift`.
2. La versión usada para calcular el efectivo esperado incluye todos los movimientos aceptados hasta el corte.
3. Transición `OPEN -> CLOSING`, corte de movimientos, CashCount, denominaciones, esperado, diferencia, Review/acción de autorización cuando aplique, enlace del conteo, transición a `CLOSED`, auditoría, resultado idempotente y outbox se confirman en una sola transacción.
4. Una operación concurrente incompatible falla o se reintenta contra la nueva versión; no se inserta silenciosamente después del cierre.
5. Un reintento devuelve el mismo cierre y no crea otro conteo ni otro evento financiero.

## Excepciones

- Turno inexistente o cerrado.
- Operaciones pendientes que impiden cierre.
- Diferencia superior al límite sin autorización.
- Denominaciones que no suman el valor contado.
- Conflicto de versión o movimiento concurrente durante el cierre.
- Solicitud repetida.

## Postcondiciones

- El turno queda inmutable.
- Se conserva un CashCount de cierre inmutable con corte, esperado, contado, diferencia, denominaciones y política aplicada.
- No se elimina el cierre.

## Pruebas mínimas

- cierre sin diferencia;
- cierre con diferencia;
- cierre duplicado;
- usuario ajeno;
- pagos electrónicos excluidos del efectivo;
- devoluciones y retiros.
- denominaciones inconsistentes;
- diferencia crítica con y sin aprobación segregada;
- movimiento concurrente durante cierre;
- reintento que retorna el mismo CashCount.

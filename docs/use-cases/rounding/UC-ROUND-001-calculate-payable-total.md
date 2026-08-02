# UC-ROUND-001: Calcular total pagadero

## Objetivo

Normalizar el total monetario de una venta y aplicar la política de redondeo correspondiente al medio de pago, sin alterar precios, impuestos ni descuentos.

## Actor principal

Motor comercial o servicio de pagos.

## Precondiciones

- Precio, promociones, descuentos e impuestos ya calculados.
- Moneda conocida.
- Medios de pago seleccionados o propuestos.
- Política de redondeo vigente.

## Entrada

- currency;
- calculated_total;
- payment_allocations;
- rounding_policy;
- cash_rounding_mode;
- electronic_rounding_mode;
- configuration_version;
- correlation_id.

## Salida

- calculated_total;
- normalized_total;
- cash_rounding_base;
- rounding_mode;
- rounding_adjustment;
- payable_total;
- payment_allocations_normalized;
- explanation;
- configuration_version.

## Configuración predeterminada para COP

- precisión interna: 2 decimales;
- total electrónico: pesos enteros;
- efectivo: NEAREST_50;
- transferencia: NONE después de normalizar a peso entero;
- tarjeta: NONE después de normalizar a peso entero;
- QR: NONE después de normalizar a peso entero.

## Flujo principal

1. El sistema recibe el total calculado.
2. Valida moneda y política.
3. Normaliza el total comercial a la unidad monetaria operativa.
4. Identifica la porción cubierta electrónicamente.
5. Identifica el saldo cubierto en efectivo.
6. Aplica redondeo solamente al saldo en efectivo.
7. Calcula el ajuste.
8. Verifica que la suma de pagos y ajuste cuadre exactamente.
9. Produce una explicación.
10. Devuelve los valores para congelarlos en la venta.

## Modos de redondeo

- NONE;
- NEAREST_50;
- UP_TO_50;
- DOWN_TO_50;
- NEAREST_100;
- UP_TO_100;
- DOWN_TO_100.

## Reglas

1. El redondeo se aplica una sola vez.
2. No se redondea cada línea.
3. No se modifica el precio unitario.
4. No se modifica silenciosamente el impuesto.
5. El ajuste no es descuento.
6. El ajuste debe registrarse por separado.
7. El pago electrónico se expresa en pesos enteros.
8. El efectivo se redondea al múltiplo configurado.
9. En pagos mixtos, solo se redondea el saldo en efectivo.
10. La suma de pagos más ajuste debe coincidir con el total pagadero.
11. El mismo contexto y versión deben producir el mismo resultado.
12. El cajero no puede cambiar la política sin permiso.
13. Una política inválida impide confirmar la venta.
14. El sistema no puede crear una diferencia de caja sin registrarla.

## Ejemplo de pago en efectivo

Total calculado:

- $4.042,50.

Normalización:

- $4.043.

Redondeo efectivo:

- $4.050.

Resultado:

- calculated_total: $4.042,50;
- normalized_total: $4.043;
- rounding_adjustment: $7;
- payable_total: $4.050.

## Ejemplo de pago mixto

Total calculado:

- $10.042,50.

Transferencia:

- $8.000.

Saldo normalizado:

- $2.043.

Efectivo:

- $2.050.

Ajuste:

- $7.

## Empates

La política de empate debe estar definida explícitamente.

Para `NEAREST_50`, el comportamiento en el punto medio debe ser versionado y probado. No se dependerá del redondeo por defecto del lenguaje.

## Excepciones

- moneda no soportada;
- pago electrónico con fracciones no normalizadas;
- asignaciones superiores al total;
- saldo negativo;
- política inexistente;
- suma inconsistente;
- configuración desactualizada.

## Postcondiciones

- Existe un total pagadero exacto.
- El ajuste está separado y auditado.
- Caja y pagos pueden conciliarse.

## Eventos

La evaluación ordinaria no requiere evento persistente.

Al confirmar pueden emitirse:

- `RoundingAdjustmentApplied`;
- `PaymentAllocationValidated`.

## Pruebas mínimas

- total exacto;
- efectivo hacia abajo;
- efectivo hacia arriba;
- punto medio;
- múltiplo exacto;
- transferencia;
- tarjeta;
- QR;
- pago mixto;
- varios pagos electrónicos;
- saldo negativo;
- suma inconsistente;
- misma entrada y versión;
- política distinta por empresa.

# UC-ROUND-001: Calcular total pagadero

## Objetivo

Obtener de forma determinista el total pagadero de una operación comercial aplicando, después de la resolución fiscal, la política de redondeo comercial versionada correspondiente, sin alterar precios, descuentos, bases imponibles ni impuestos.

## Actor principal

Motor comercial autorizado.

## Precondiciones

- Precio, promociones y descuentos ya resueltos.
- Base imponible determinada.
- Impuestos exactos calculados.
- Impuestos normalizados conforme a la política fiscal aplicable.
- Residuos fiscales conciliados.
- iscal_total_amount disponible.
- Moneda conocida.
- Política de redondeo comercial vigente y autorizada.
- Versión y checksum de política disponibles cuando correspondan.

## Entrada

- tenant_id derivado;
- company_id derivado;
- branch_id;
- currency;
- fiscal_total_amount;
- exact_fiscal_total;
- fiscal_rounding_adjustment;
- fiscal_residuals;
- rounding_policy;
- rounding_policy_version;
- rounding_policy_checksum opcional;
- pricing_snapshot_id;
- tax_snapshot_id;
- occurred_at;
- correlation_id.

## Salida

- fiscal_total_amount;
- rounding_policy;
- rounding_policy_version;
- rounding_policy_checksum opcional;
- commercial_rounding_adjustment;
- payable_amount;
- resolution_explanation;
- rounding_snapshot.

## Política predeterminada para COP

Cuando la configuración comercial de la empresa habilite redondeo a múltiplos de 50 para COP, la política normativa será:

NEAREST_50_HALF_AWAY_FROM_ZERO_V1

La política:

- opera sobre el iscal_total_amount global del documento;
- es independiente del medio de pago;
- se aplica una sola vez;
- utiliza decimal exacto;
- conserva separado el ajuste comercial;
- no modifica impuestos;
- no modifica descuentos;
- no modifica precios unitarios;
- debe quedar versionada y congelada en el snapshot.

## Flujo principal

1. El sistema recibe el iscal_total_amount después de la normalización y conciliación fiscal.
2. Valida moneda, empresa, versión y política de redondeo comercial.
3. Verifica que la política esté autorizada para el contexto.
4. Obtiene la política versionada aplicable.
5. Aplica la política al iscal_total_amount global.
6. Calcula commercial_rounding_adjustment.
7. Obtiene un único payable_amount.
8. Verifica que el redondeo comercial no haya modificado impuestos, descuentos ni precios.
9. Produce explicación, versión y checksum cuando corresponda.
10. Congela el resultado dentro del snapshot antes de registrar pagos.

## Orden obligatorio

1. calcular importes comerciales;
2. calcular descuentos;
3. determinar base imponible;
4. calcular impuestos exactos;
5. normalizar impuestos fiscalmente;
6. conciliar residuos fiscales;
7. obtener iscal_total_amount;
8. aplicar redondeo comercial;
9. obtener payable_amount;
10. congelar snapshot.

## Independencia del medio de pago

El payable_amount se determina antes de registrar pagos.

No se permite que una misma venta produzca totales distintos únicamente por cambiar entre efectivo, tarjeta, transferencia, QR, pago mixto u otro medio de pago.

Los medios de pago distribuyen o satisfacen el payable_amount; no determinan el precio ni la política de redondeo comercial de una venta ya congelada.

## Ajuste comercial

commercial_rounding_adjustment = payable_amount - fiscal_total_amount

El ajuste comercial:

- vive a nivel de documento;
- se registra explícitamente;
- no es descuento;
- no es impuesto;
- no es refund;
- no es diferencia de caja;
- no se distribuye como residuo fiscal;
- no puede ocultar inconsistencias de conciliación.

## Separación fiscal y comercial

El redondeo fiscal ocurre antes del comercial.

El redondeo fiscal:

- normaliza componentes tributarios;
- puede producir residuos fiscales;
- concilia esos residuos según la política fiscal aplicable.

El redondeo comercial:

- ocurre después de obtener iscal_total_amount;
- opera sobre el total fiscal global;
- no modifica componentes tributarios;
- produce commercial_rounding_adjustment y payable_amount.

El incremento de 50 pertenece al redondeo comercial y no participa en la distribución de residuos fiscales.

## Regla de redondeo

Para NEAREST_50_HALF_AWAY_FROM_ZERO_V1, los empates se resuelven alejándose de cero.

La implementación no debe depender de la función de redondeo predeterminada del lenguaje.

Los importes negativos conservan la simetría definida por la política.

## Pagos

Los pagos ocurren después de determinar y congelar payable_amount.

El medio de pago no puede provocar un nuevo cálculo del redondeo comercial de la venta congelada.

## Devoluciones y refunds

Una devolución usa el snapshot original y la versión de política aplicada a la venta.

Una devolución completa conserva la simetría del ajuste original.

Las devoluciones parciales usan la política versionada de asignación definida en DEC-006.

Un refund no recalcula pricing ni sustituye la política original por una versión posterior.

## Snapshot

Antes de registrar pagos debe quedar congelada, como mínimo:

- iscal_total_amount;
- exact_fiscal_total;
- iscal_rounding_adjustment;
- commercial_rounding_adjustment;
- payable_amount;
- política de redondeo;
- versión de política;
- checksum;
- pricing_snapshot_id;
- 	ax_snapshot_id.

Una vez congelado el snapshot no puede modificarse destructivamente.

## Operación offline

Una operación offline solo puede aplicar la política cuando dispone de configuración, versión, checksum y datos fiscales requeridos.

Al sincronizar:

- no se sustituye silenciosamente el resultado original;
- se valida versión y checksum;
- se verifica determinismo;
- no se reescribe un snapshot válido por existir una política posterior.

## Reglas

1. El redondeo comercial se aplica una sola vez.
2. No se redondea cada línea comercial al múltiplo de 50.
3. No se redondea cada impuesto al múltiplo de 50.
4. No se redondea por medio de pago.
5. No se aplica redondeo comercial después de registrar pagos.
6. No se modifica el precio unitario.
7. No se modifican descuentos.
8. El redondeo comercial no modifica impuestos.
9. El ajuste comercial se registra por separado.
10. El mismo contexto, versión y política producen el mismo resultado.
11. Los empates siguen HALF_AWAY_FROM_ZERO.
12. Los importes negativos conservan simetría.
13. El cajero no puede cambiar una política congelada.
14. Una política inválida o incompleta impide confirmar la resolución.
15. Un checksum incompatible produce error explícito.
16. El ajuste comercial no puede cuadrar diferencias de caja.
17. Los residuos fiscales se concilian antes del redondeo comercial.
18. El incremento de 50 no participa en residuos fiscales.
19. Las devoluciones usan la versión original.
20. Un refund no recalcula pricing original.
21. El resultado debe ser auditable y reconstruible.

## Excepciones

- moneda no compatible;
- política inexistente;
- política no autorizada;
- versión inexistente o expirada;
- checksum incompatible;
- datos fiscales incompletos;
- iscal_total_amount inconsistente;
- snapshot incompatible ya congelado;
- intento de modificar histórico;
- configuración desactualizada;
- acceso cruzado entre tenants.

## Postcondiciones

- Existe un único payable_amount.
- El resultado es independiente del medio de pago.
- El ajuste fiscal permanece separado del comercial.
- Los impuestos permanecen inalterados por el redondeo comercial.
- El resultado puede congelarse y reconstruirse.
- Los pagos posteriores pueden conciliarse contra el importe pagadero.

## Pruebas mínimas

### Matemáticas

- múltiplo exacto positivo;
- empate positivo;
- valor positivo por debajo y por encima de la mitad;
- múltiplo exacto negativo;
- empate negativo;
- valor negativo por debajo y por encima de la mitad absoluta;
- cero;
- simetría;
- idempotencia.

### Integración fiscal

- redondeo fiscal antes del comercial;
- redondeo comercial no modifica impuesto;
- residuo fiscal positivo;
- residuo fiscal negativo;
- empate de residuos;
- múltiples impuestos sin mezclar residuos;
- ajuste comercial separado.

### Medios de pago

- efectivo conserva el mismo payable_amount;
- tarjeta conserva el mismo payable_amount;
- transferencia conserva el mismo payable_amount;
- QR conserva el mismo payable_amount;
- pago mixto conserva el mismo payable_amount;
- cambiar medio de pago no recalcula total.

### Snapshots y versionado

- snapshot congelado;
- misma entrada y versión produce mismo resultado;
- versión diferente queda identificada;
- checksum correcto;
- checksum incompatible;
- intento de modificar snapshot congelado.

### Devoluciones

- devolución completa;
- devolución parcial;
- devoluciones parciales acumuladas;
- última devolución absorbe residuo pendiente;
- refund sin recalcular pricing.

### Offline

- operación offline válida;
- checksum offline diferente;
- versión offline expirada;
- sincronización conserva snapshot válido.
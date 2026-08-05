# DEC-006 — Política versionada de redondeo NEAREST_50 y conciliación fiscal

## Estado

`IN_PROGRESS`

## Prioridad

`P0`

## Contexto

`DEC-003` definió el orden general y versionado del cálculo comercial mediante `PRICING_PIPELINE_V1`.

Dentro de ese pipeline quedaron separados:

1. precio base;
2. precio promocional;
3. promociones;
4. cupones;
5. descuentos;
6. base imponible;
7. impuestos;
8. redondeo fiscal;
9. redondeo comercial;
10. total exigible;
11. snapshot definitivo.

Sin embargo, `DEC-003` dejó pendiente una decisión específica sobre:

- la definición exacta de `NEAREST_50`;
- el comportamiento cuando un importe está exactamente a mitad de dos múltiplos;
- el tratamiento de importes negativos;
- la normalización de fracciones monetarias;
- la distribución determinista de residuos;
- la conciliación entre total fiscal y total exigible;
- devoluciones;
- refunds;
- reversals;
- operación offline;
- interoperabilidad entre versiones.

Sin una política cerrada, dos dispositivos o servicios podrían calcular resultados diferentes para la misma venta.

Ejemplo:

```text
importe previo:
10.025 COP

múltiplos cercanos:
10.000 COP
10.050 COP
```

La distancia a ambos múltiplos es:

```text
25 COP
```

Si un componente redondea hacia arriba y otro hacia abajo, se generan diferencias en:

- total exigible;
- caja;
- pagos;
- documentos;
- devoluciones;
- conciliación;
- sincronización;
- auditoría;
- reportes;
- impuestos.

---

# Decisión

La política oficial será versionada como:

```text
NEAREST_50_HALF_AWAY_FROM_ZERO_V1
```

Esta política:

1. redondea al múltiplo de `50` más cercano;
2. cuando existe empate exacto, se aleja de cero;
3. aplica simétricamente a importes positivos y negativos;
4. utiliza decimal exacto;
5. nunca utiliza `float`;
6. separa redondeo fiscal de redondeo comercial;
7. conserva el valor previo y el ajuste;
8. distribuye residuos con un algoritmo determinista;
9. persiste la versión aplicada;
10. no recalcula operaciones históricas.

---

# Nombre normativo

El identificador completo será:

```text
NEAREST_50_HALF_AWAY_FROM_ZERO_V1
```

Alias humano:

```text
redondeo al múltiplo de 50 más cercano,
con empate alejándose de cero
```

No se utilizará el nombre ambiguo:

```text
NEAREST_50
```

sin especificar versión y regla de empate.

---

# Alcance

Esta decisión define:

- unidad de redondeo;
- función matemática;
- regla de empate;
- importes positivos;
- importes negativos;
- cero;
- precisión monetaria;
- normalización;
- separación fiscal y comercial;
- ajuste de redondeo;
- distribución de residuos;
- conciliación por línea;
- total fiscal;
- total exigible;
- pagos;
- devoluciones;
- refunds;
- reversals;
- cancelaciones;
- operación offline;
- versionado;
- auditoría;
- errores;
- escenarios;
- pruebas;
- invariantes.

No define:

- tarifas tributarias;
- bases imponibles específicas por país;
- obligación legal de aplicar redondeo comercial;
- denominaciones monetarias disponibles físicamente;
- reglas completas de cambio en efectivo;
- integración con autoridades fiscales;
- diseño físico definitivo;
- endpoints finales;
- interfaz de usuario;
- estrategia contable definitiva.

---

# Documentos relacionados

Esta decisión debe alinearse con:

- `docs/adr/DEC-003-pricing-calculation-order.md`;
- `docs/adr/DEC-002-payment-compensation-policy.md`;
- `docs/domain/commercial-engine.md`;
- `docs/domain/business-rules.md`;
- `docs/use-cases/sales/UC-SALES-001-complete-sale.md`;
- `docs/use-cases/sales/UC-SALES-002-manage-sale-lifecycle.md`;
- `docs/use-cases/payments/UC-PAY-001-register-payment.md`;
- `docs/use-cases/payments/UC-PAY-002-register-mixed-payment.md`;
- `docs/use-cases/payments/UC-PAY-004-refund-payment.md`;
- `docs/use-cases/payments/UC-PAY-005-reconcile-payment.md`;
- `docs/use-cases/cash/UC-CASH-003-cash-operations.md`;
- `docs/product/backlog.md`.

Esta decisión desbloquea documentalmente:

- `TAX-003`;
- parte de `SALES-003`;
- reglas físicas de pricing;
- conciliación fiscal;
- conciliación de caja.

---

# Objetivos

1. Obtener el mismo resultado en todos los componentes.
2. Eliminar ambigüedad en empates.
3. Soportar valores positivos y negativos.
4. Evitar errores de punto flotante.
5. Conservar el total fiscal exacto.
6. Separar ajuste fiscal de ajuste comercial.
7. Evitar modificar impuestos mediante redondeo comercial.
8. Permitir conciliación por línea y por documento.
9. Mantener devoluciones simétricas.
10. Mantener snapshots históricos.
11. Soportar operación offline.
12. Permitir evolución versionada.
13. Evitar diferencias entre frontend y backend.
14. Evitar diferencias entre dispositivos.
15. Definir pruebas reproducibles.

---

# Principios

1. El backend es autoridad del total.
2. El frontend solo previsualiza.
3. Todo cálculo monetario usa decimal exacto.
4. El redondeo fiscal ocurre antes del comercial.
5. El redondeo comercial no modifica impuestos.
6. El total exigible no depende del medio de pago.
7. Un pago no altera el pricing.
8. Un refund no recalcula la venta original.
9. Una devolución usa el snapshot original.
10. Una operación histórica no cambia por una versión nueva.
11. Todo ajuste queda explícito.
12. Todo residuo queda asignado.
13. Todo empate tiene resultado único.
14. Cero permanece cero.
15. Los importes negativos usan una regla simétrica.
16. No se ocultan diferencias.
17. Las correcciones posteriores son operaciones nuevas.
18. La versión del algoritmo queda persistida.
19. Los resultados offline deben poder reproducirse.
20. Una moneda puede desactivar esta política mediante configuración.

---

# Terminología

## Importe bruto

Valor antes de descuentos, impuestos y redondeos.

```text
gross_amount
```

## Importe neto comercial

Valor después de descuentos comerciales y antes de impuestos.

```text
commercial_net_amount
```

## Base imponible

Valor sobre el cual se calcula un impuesto.

```text
taxable_base_amount
```

## Impuesto calculado sin normalizar

Resultado matemático exacto previo al redondeo fiscal.

```text
tax_unrounded_amount
```

## Impuesto fiscal normalizado

Valor de impuesto después de aplicar la precisión fiscal correspondiente.

```text
tax_rounded_amount
```

## Total fiscal

Suma del valor neto y los impuestos fiscalmente normalizados.

```text
fiscal_total_amount
```

## Ajuste fiscal

Diferencia generada por normalización fiscal.

```text
fiscal_rounding_adjustment
```

## Total previo al redondeo comercial

Total fiscal antes de aplicar `NEAREST_50`.

```text
commercial_rounding_input
```

## Total exigible

Importe final que la venta debe cubrir.

```text
payable_amount
```

## Ajuste comercial de redondeo

Diferencia entre total exigible y total fiscal.

```text
commercial_rounding_adjustment
```

Fórmula:

```text
commercial_rounding_adjustment =
payable_amount
- fiscal_total_amount
```

---

# Unidad monetaria mínima

Toda moneda debe declarar una unidad mínima de cálculo.

Ejemplos conceptuales:

```text
COP:
1 peso

USD:
0,01 dólar

EUR:
0,01 euro
```

La política `NEAREST_50_HALF_AWAY_FROM_ZERO_V1` se expresa en unidades monetarias mínimas.

Para COP:

```text
increment = 50 pesos
```

No significa:

```text
50 centavos
```

---

# Representación monetaria

Los importes se representan mediante:

```text
Decimal
```

o:

```text
minor units enteras
```

según la implementación.

## Permitido

```text
Decimal("10025")
```

```text
10025 minor units
```

## Prohibido

```text
10025.0 float
```

```text
double
```

```text
binary floating point
```

---

# Precisión interna

La precisión interna debe ser suficiente para:

- tarifas porcentuales;
- impuestos compuestos;
- distribución proporcional;
- cantidades por peso;
- conversiones;
- residuos.

## Regla

No se redondea prematuramente únicamente para simplificar la implementación.

---

# Definición matemática

Sea:

```text
x
```

el importe que se desea redondear.

Sea:

```text
q = 50
```

el incremento.

Se calcula:

```text
scaled = x / q
```

La función de redondeo será:

```text
round_half_away_from_zero(scaled)
```

Luego:

```text
rounded =
round_half_away_from_zero(x / 50)
× 50
```

---

# HALF_AWAY_FROM_ZERO

## Definición

Cuando la parte fraccionaria absoluta es menor que `0,5`:

```text
se aproxima hacia cero
```

Cuando es mayor que `0,5`:

```text
se aproxima alejándose de cero
```

Cuando es exactamente `0,5`:

```text
se aproxima alejándose de cero
```

---

# Fórmula conceptual

Para:

```text
x >= 0
```

```text
rounded =
floor((x + 25) / 50)
× 50
```

Para:

```text
x < 0
```

```text
rounded =
ceil((x - 25) / 50)
× 50
```

Esta fórmula es conceptual.

La implementación debe usar aritmética decimal o entera exacta.

---

# Regla de empate

## Positivo

```text
10.025
```

está exactamente entre:

```text
10.000
10.050
```

Resultado:

```text
10.050
```

## Negativo

```text
-10.025
```

está exactamente entre:

```text
-10.000
-10.050
```

Resultado:

```text
-10.050
```

## Principio

El empate se resuelve:

```text
alejándose de cero
```

---

# Motivo de la regla de empate

Se descartan reglas dependientes de:

- paridad;
- signo implícito;
- lenguaje;
- base de datos;
- configuración regional;
- implementación estándar no controlada.

`HALF_AWAY_FROM_ZERO` ofrece:

- simetría;
- explicación operativa simple;
- reproducibilidad;
- tratamiento predecible de devoluciones;
- independencia de `banker's rounding`.

---

# Alternativas matemáticas descartadas

## HALF_UP

Puede producir interpretaciones diferentes para valores negativos.

Algunas implementaciones entienden:

```text
-10.025
→ -10.000
```

otras:

```text
-10.025
→ -10.050
```

Se descarta el nombre sin semántica completa.

## HALF_EVEN

También conocido como redondeo bancario.

Ejemplo:

```text
10.025
```

podría ir al múltiplo cuyo cociente sea par.

Se descarta porque:

- es difícil de explicar en caja;
- no coincide con la política comercial escogida;
- puede resultar sorprendente;
- aumenta riesgo de implementaciones divergentes.

## HALF_TOWARD_ZERO

Se descarta porque sesga los empates hacia cero.

## ALWAYS_UP

Se descarta porque no representa el múltiplo más cercano.

## ALWAYS_DOWN

Se descarta por el mismo motivo.

---

# Tabla principal para importes positivos

| Importe | Inferior | Superior | Resultado |
|---:|---:|---:|---:|
| 10.000 | 10.000 | 10.000 | 10.000 |
| 10.001 | 10.000 | 10.050 | 10.000 |
| 10.024 | 10.000 | 10.050 | 10.000 |
| 10.025 | 10.000 | 10.050 | 10.050 |
| 10.026 | 10.000 | 10.050 | 10.050 |
| 10.049 | 10.000 | 10.050 | 10.050 |
| 10.050 | 10.050 | 10.050 | 10.050 |
| 10.074 | 10.050 | 10.100 | 10.050 |
| 10.075 | 10.050 | 10.100 | 10.100 |
| 10.076 | 10.050 | 10.100 | 10.100 |

---

# Tabla principal para importes negativos

| Importe | Cercano a cero | Alejado de cero | Resultado |
|---:|---:|---:|---:|
| -10.000 | -10.000 | -10.000 | -10.000 |
| -10.001 | -10.000 | -10.050 | -10.000 |
| -10.024 | -10.000 | -10.050 | -10.000 |
| -10.025 | -10.000 | -10.050 | -10.050 |
| -10.026 | -10.000 | -10.050 | -10.050 |
| -10.049 | -10.000 | -10.050 | -10.050 |
| -10.050 | -10.050 | -10.050 | -10.050 |
| -10.074 | -10.050 | -10.100 | -10.050 |
| -10.075 | -10.050 | -10.100 | -10.100 |
| -10.076 | -10.050 | -10.100 | -10.100 |

---

# Cero

```text
round_nearest_50(0)
=
0
```

No se genera ajuste.

---

# Valores menores que 50

## Positivos

| Importe | Resultado |
|---:|---:|
| 1 | 0 |
| 24 | 0 |
| 25 | 50 |
| 26 | 50 |
| 49 | 50 |

## Negativos

| Importe | Resultado |
|---:|---:|
| -1 | 0 |
| -24 | 0 |
| -25 | -50 |
| -26 | -50 |
| -49 | -50 |

---

# Ajuste comercial

Para un importe:

```text
10.024
```

Resultado:

```text
payable_amount = 10.000
```

Ajuste:

```text
commercial_rounding_adjustment =
10.000 - 10.024
=
-24
```

Para:

```text
10.025
```

Resultado:

```text
payable_amount = 10.050
```

Ajuste:

```text
commercial_rounding_adjustment =
10.050 - 10.025
=
25
```

---

# Rango del ajuste

Con incremento de `50`, el ajuste comercial pertenece normalmente al intervalo:

```text
-24 <= adjustment <= 25
```

para importes expresados en pesos enteros.

## Regla

El extremo positivo incluye `25` por la política de empate alejándose de cero.

Para importes negativos, el rango algebraico sigue siendo consistente respecto del resultado.

---

# Propiedad de idempotencia

Debe cumplirse:

```text
round_nearest_50(
    round_nearest_50(x)
)
=
round_nearest_50(x)
```

Aplicar el algoritmo dos veces no cambia el resultado.

---

# Propiedad de simetría

Debe cumplirse:

```text
round_nearest_50(-x)
=
-round_nearest_50(x)
```

Ejemplo:

```text
round(10.025)
=
10.050
```

```text
round(-10.025)
=
-10.050
```

---

# Propiedad de múltiplo

Todo resultado debe satisfacer:

```text
rounded mod 50 = 0
```

cuando la moneda usa unidades enteras compatibles.

---

# Monotonicidad

Para:

```text
a <= b
```

debe cumplirse:

```text
round(a) <= round(b)
```

---

# Invariantes matemáticas iniciales

1. El resultado es múltiplo de 50.
2. Cero permanece cero.
3. El algoritmo es idempotente.
4. El algoritmo es simétrico respecto de cero.
5. El algoritmo es monótono.
6. Un empate positivo se aleja de cero.
7. Un empate negativo se aleja de cero.
8. No se utiliza `float`.
9. La versión queda persistida.
10. El ajuste queda explícito.
11. El valor previo no se elimina.
12. Una venta histórica no se recalcula.
13. Un refund no cambia la política original.
14. Una devolución usa la versión original.
15. Un dispositivo offline usa la versión sincronizada.

---

# Separación entre redondeo fiscal y redondeo comercial

## Regla principal

El redondeo fiscal y el redondeo comercial son operaciones distintas.

```text
tax rounding
!=
commercial rounding
```

## Redondeo fiscal

Normaliza:

- bases imponibles;
- impuestos por línea;
- impuestos por documento;
- residuos tributarios;
- precisión legal.

## Redondeo comercial

Ajusta:

```text
fiscal_total_amount
```

hacia:

```text
payable_amount
```

según una política comercial como:

```text
NEAREST_50_HALF_AWAY_FROM_ZERO_V1
```

---

# Orden obligatorio

El orden será:

```text
1. calcular importes comerciales;
2. calcular descuentos;
3. determinar base imponible;
4. calcular impuestos exactos;
5. normalizar impuestos fiscalmente;
6. conciliar residuos fiscales;
7. obtener fiscal_total_amount;
8. aplicar redondeo comercial;
9. obtener payable_amount;
10. congelar snapshot.
```

## Prohibición

No se aplica redondeo comercial:

- antes de impuestos;
- sobre cada línea por separado;
- sobre cada impuesto por separado;
- sobre cada medio de pago;
- después de registrar pagos;
- para ocultar una diferencia de caja.

---

# Total fiscal

Se define:

```text
fiscal_total_amount =
commercial_net_amount
+ total_tax_rounded_amount
+ authorized_fiscal_charges
- authorized_fiscal_credits
```

Debe conservar:

- moneda;
- precisión;
- versión fiscal;
- reglas tributarias;
- residuos asignados.

---

# Total exigible

Se define:

```text
payable_amount =
apply_commercial_rounding(
    fiscal_total_amount,
    commercial_rounding_policy_version
)
```

## Regla

El total exigible:

- no modifica impuestos;
- no modifica bases;
- no modifica descuentos;
- no modifica precios;
- no depende del medio de pago;
- no depende del efectivo entregado;
- no depende del cambio.

---

# Ajuste comercial separado

Debe persistirse como:

```text
commercial_rounding_adjustment
```

y cumplir:

```text
payable_amount =
fiscal_total_amount
+ commercial_rounding_adjustment
```

## Ejemplo

```text
fiscal_total_amount = 10.024
payable_amount = 10.000
commercial_rounding_adjustment = -24
```

## Otro ejemplo

```text
fiscal_total_amount = 10.025
payable_amount = 10.050
commercial_rounding_adjustment = 25
```

---

# Naturaleza del ajuste

El ajuste comercial no es:

- impuesto;
- descuento;
- promoción;
- cargo;
- propina;
- costo;
- pago;
- refund;
- cambio en efectivo.

Es una categoría propia:

```text
COMMERCIAL_ROUNDING_ADJUSTMENT
```

---

# Representación contable

La decisión no fija la cuenta contable definitiva.

Debe permitir distinguir:

- ajuste favorable al cliente;
- ajuste favorable a la empresa;
- ajuste positivo;
- ajuste negativo;
- motivo;
- política;
- versión;
- documento;
- fecha.

## Regla

No se registra dentro del impuesto.

---

# Política habilitada por moneda

Cada moneda puede declarar:

```text
commercial_rounding_enabled
```

y:

```text
commercial_rounding_policy_version
```

Ejemplo:

```text
currency = COP
enabled = true
policy = NEAREST_50_HALF_AWAY_FROM_ZERO_V1
```

Ejemplo:

```text
currency = USD
enabled = false
```

---

# Política habilitada por empresa

La empresa puede desactivar la política cuando:

- dispone de denominaciones exactas;
- existe obligación regulatoria;
- el canal requiere importe exacto;
- la moneda no es compatible;
- la configuración comercial no la autoriza.

## Restricción

No puede cambiarse silenciosamente durante una venta.

---

# Congelación de política

Cuando inicia la fase de pago, el snapshot debe conservar:

- política;
- versión;
- incremento;
- moneda;
- precisión;
- valor previo;
- valor final;
- ajuste;
- fecha;
- autoridad.

## Regla

Un cambio administrativo posterior no modifica la venta.

---

# Aplicación por canal

La política puede depender de:

- empresa;
- sucursal;
- canal;
- moneda;
- tipo de documento;
- regulación.

## Restricción

La política elegida debe quedar resuelta antes de recibir pagos.

---

# Independencia del medio de pago

No se permite:

```text
efectivo:
redondear a 50

tarjeta:
no redondear
```

dentro de la misma venta ya congelada.

## Motivo

Eso haría que el precio dependa del pago.

## Regla

El pricing produce un único:

```text
payable_amount
```

antes de los pagos.

---

# Excepción de canal separada

Si una organización necesita importes distintos por canal:

```text
POS efectivo
e-commerce
tarjeta
domicilio
```

debe resolverse como una política comercial previa al pago.

No como una mutación posterior basada en el medio elegido.

---

# Pagos

## Cobertura

La cobertura se calcula sobre:

```text
payable_amount
```

No sobre:

```text
fiscal_total_amount
```

## Fórmula

```text
coverage =
confirmed_payment_amount
/
payable_amount
```

---

# Pago inferior

Un pago inferior se determina contra:

```text
payable_amount
```

Ejemplo:

```text
fiscal_total = 10.024
payable = 10.000
confirmed_payment = 9.950
```

Resultado:

```text
shortfall = 50
```

No:

```text
shortfall = 74
```

---

# Sobrepago

El sobrepago también se determina contra:

```text
payable_amount
```

Ejemplo:

```text
payable = 10.000
confirmed_payment = 10.050
```

Resultado:

```text
overpayment = 50
```

El sobrepago no modifica:

- fiscal total;
- impuestos;
- pricing;
- ajuste comercial.

---

# Pago mixto

Cada componente cubre parte del mismo:

```text
payable_amount
```

## Regla

No se redondea por componente.

Ejemplo incorrecto:

```text
cash_component → round 50
card_component → exact
```

## Correcto

```text
sale_payable_amount = 10.050

cash = 5.000
card = 5.050
```

---

# Cambio en efectivo

El cambio se calcula:

```text
cash_received
- cash_component_payable
```

## Regla

No se vuelve a aplicar `NEAREST_50` al cambio salvo una política específica distinta.

---

# Cierre de caja

Caja debe conservar:

- fiscal total;
- payable amount;
- commercial adjustment;
- pagos confirmados;
- cambio;
- sobrepago;
- diferencia.

## Prohibición

No se usa el ajuste comercial para cuadrar una diferencia de caja.

---

# Distribución de residuos fiscales

## Problema

Los impuestos calculados por línea pueden producir fracciones.

Ejemplo:

```text
line_1_tax = 19,345
line_2_tax = 19,345
```

Suma exacta:

```text
38,690
```

Según precisión fiscal:

```text
38,69
```

o en pesos enteros:

```text
39
```

La suma de redondeos individuales puede no coincidir con el total fiscal del documento.

---

# Principio de conciliación fiscal

Debe cumplirse:

```text
sum(line_tax_rounded)
=
document_tax_rounded
```

cuando la regulación exige igualdad documental.

## Regla

La diferencia se distribuye explícitamente.

---

# Residuo fiscal

Se define:

```text
fiscal_residual =
document_tax_rounded
- sum(initial_line_tax_rounded)
```

Puede ser:

- positivo;
- negativo;
- cero.

---

# Algoritmo de distribución

La política oficial será:

```text
LARGEST_REMAINDER_THEN_LINE_ID_V1
```

Este algoritmo ya es compatible con `DEC-003`.

---

# LARGEST_REMAINDER_THEN_LINE_ID_V1

## Entrada

Para cada línea:

- importe exacto;
- importe truncado o inicialmente normalizado;
- residuo absoluto;
- signo;
- `line_id`;
- moneda;
- precisión.

## Orden

Cuando deben asignarse unidades mínimas positivas:

1. mayor residuo;
2. mayor impacto elegible;
3. menor `line_id` canónico.

Cuando deben retirarse unidades mínimas:

1. menor residuo favorable;
2. mayor importe elegible;
3. menor `line_id` canónico.

---

# Regla de desempate

El desempate final será:

```text
line_id ASC
```

usando representación canónica estable.

## Prohibición

No se desempata por:

- orden visual;
- orden de llegada;
- índice del frontend;
- timestamp local;
- dirección de memoria;
- orden de base de datos sin cláusula explícita.

---

# Unidad de distribución

La distribución usa la unidad fiscal mínima.

Ejemplos:

```text
1 peso
0,01 USD
0,01 EUR
```

No usa:

```text
50 pesos
```

El incremento de `50` pertenece al redondeo comercial, no al fiscal.

---

# Distribución por impuesto

Cuando existen impuestos múltiples:

- IVA;
- impuesto al consumo;
- impuesto local;
- retención;
- sobretasa;

cada impuesto conserva:

- base;
- tarifa;
- importe exacto;
- importe normalizado;
- residuo;
- distribución.

## Regla

No se mezclan residuos de impuestos distintos.

---

# Distribución por línea

Una línea puede recibir varias asignaciones:

```text
line_tax_adjustment
```

cada una vinculada al impuesto correspondiente.

## Invariante

La suma de asignaciones debe cerrar el residuo documental.

---

# Distribución de descuentos

Cuando un descuento de orden se distribuye entre líneas, debe usar un algoritmo versionado.

La política recomendada continúa siendo:

```text
LARGEST_REMAINDER_THEN_LINE_ID_V1
```

## Regla

El redondeo comercial no participa en esa distribución.

---

# Total por línea

La línea puede conservar:

```text
line_gross_amount
line_discount_amount
line_taxable_base_amount
line_tax_exact_amount
line_tax_rounded_amount
line_fiscal_residual_adjustment
line_fiscal_total_amount
```

## Regla

No se asigna `commercial_rounding_adjustment` a líneas salvo requerimiento documental explícito.

---

# Ajuste comercial a nivel documento

La política predeterminada será:

```text
commercial_rounding_adjustment
→ document level
```

## Motivo

El ajuste se aplica al total fiscal global.

No representa un cambio de precio de una línea específica.

---

# Documentos que exigen distribución comercial

Si una integración exige que la suma de líneas sea igual a `payable_amount`, debe existir una proyección documental separada.

No debe modificar:

- snapshot fiscal;
- bases;
- impuestos;
- precio unitario histórico.

---

# Proyección documental comercial

Puede producir:

```text
display_rounding_allocation
```

con reglas:

- deterministas;
- reversibles;
- versionadas;
- no fiscales;
- solo de presentación documental.

## Regla

No sustituye `commercial_rounding_adjustment`.

---

# Importes con fracciones inferiores a un peso

## Normalización

Antes de aplicar `NEAREST_50`, el importe debe estar normalizado a la unidad monetaria aceptada por la política.

Ejemplo:

```text
10.024,50 COP
```

Si la unidad comercial es:

```text
1 peso
```

primero se obtiene un importe entero según la política fiscal o monetaria correspondiente.

Luego se aplica:

```text
NEAREST_50_HALF_AWAY_FROM_ZERO_V1
```

---

# Normalización previa

La secuencia será:

```text
exact fiscal total
→ fiscal precision normalization
→ currency minor-unit normalization
→ NEAREST_50 commercial rounding
```

## Prohibición

No se aplica directamente `NEAREST_50` sobre un valor binario aproximado.

---

# Fracciones monetarias no representables

Cuando una fracción no puede representarse en la moneda:

- se normaliza según política fiscal;
- se registra el ajuste;
- se conserva el valor exacto;
- se persiste la versión.

---

# Ejemplo con fracción

Valor exacto:

```text
10.024,50
```

Normalización monetaria `HALF_AWAY_FROM_ZERO` a peso entero:

```text
10.025
```

Redondeo comercial:

```text
10.050
```

Debe conservarse:

```text
exact_fiscal_total = 10.024,50
minor_unit_normalized_total = 10.025
payable_amount = 10.050
```

---

# Ejemplo sin fracción

```text
exact_fiscal_total = 10.024
minor_unit_normalized_total = 10.024
payable_amount = 10.000
```

---

# Importes negativos

## Casos

Pueden aparecer en:

- devolución;
- nota crédito;
- reversal;
- refund;
- ajuste compensatorio;
- corrección.

## Regla

La misma función matemática se aplica al signo negativo.

---

# Devolución completa

Una devolución completa debe reproducir el ajuste de la venta original.

Ejemplo de venta:

```text
fiscal_total = 10.025
payable = 10.050
adjustment = 25
```

Devolución completa:

```text
fiscal_total = -10.025
payable = -10.050
adjustment = -25
```

## Invariante

Debe cumplirse:

```text
full_return_payable
=
-original_payable
```

---

# Devolución parcial

Una devolución parcial no recalcula la venta completa con reglas actuales.

Debe usar:

- snapshot original;
- líneas elegibles;
- impuestos originales;
- descuentos distribuidos;
- versión original;
- ajuste comercial pendiente por restituir.

---

# Problema del ajuste comercial en devolución parcial

Venta:

```text
fiscal_total = 10.025
payable = 10.050
adjustment = 25
```

Una devolución parcial puede no representar exactamente la mitad del ajuste.

## Regla

El ajuste comercial se restituye mediante una política de asignación versionada.

---

# Política de asignación de ajuste en devoluciones

El algoritmo será:

```text
PROPORTIONAL_COMMERCIAL_ROUNDING_RETURN_V1
```

---

# PROPORTIONAL_COMMERCIAL_ROUNDING_RETURN_V1

## Base

El ajuste original se distribuye según el valor fiscal elegible devuelto.

```text
return_rounding_share =
original_commercial_rounding_adjustment
× returned_fiscal_eligible_amount
/ original_fiscal_eligible_amount
```

## Normalización

El resultado se normaliza a la unidad monetaria mínima.

Los residuos se asignan con:

```text
LARGEST_REMAINDER_THEN_LINE_ID_V1
```

---

# Límite acumulado

Debe cumplirse:

```text
sum(returned_rounding_adjustments)
<=
original_rounding_adjustment
```

en valor absoluto y respetando signo.

## Última devolución

La última devolución elegible recibe el residuo pendiente.

---

# Invariante de devolución completa acumulada

Cuando toda la venta ha sido devuelta:

```text
sum(partial_return_payable_amounts)
=
-original_payable_amount
```

considerando:

- refunds;
- compensaciones;
- reversals;
- ajustes pendientes.

---

# Refund

Un refund:

- no recalcula pricing;
- no ejecuta de nuevo `NEAREST_50`;
- usa el importe elegible de devolución;
- conserva versión original;
- no modifica el pago original.

---

# Reversal

Un reversal completo de la operación financiera no cambia el snapshot comercial.

Debe revertir el importe financiero correspondiente al:

```text
payable_amount
```

o a la porción autorizada.

---

# Cancelación antes de completar

Si la venta todavía no congeló snapshot:

```text
no existe ajuste definitivo
```

Si ya congeló snapshot pero no completó efectos:

- se conserva la evidencia;
- se anula mediante transición;
- no se elimina el cálculo;
- no se reutiliza silenciosamente.

---

# Nota crédito

Una nota crédito debe conservar:

- referencia a venta;
- versión de pricing;
- versión fiscal;
- versión de redondeo;
- fiscal total negativo;
- payable amount negativo;
- ajuste negativo;
- motivo.

---

# Invariantes fiscales y comerciales

1. El redondeo fiscal ocurre antes del comercial.
2. El redondeo comercial no modifica impuestos.
3. El ajuste comercial vive a nivel documento.
4. El total exigible se obtiene antes de pagos.
5. Los pagos cubren `payable_amount`.
6. Un medio de pago no cambia el total.
7. Los residuos fiscales se distribuyen explícitamente.
8. El residuo fiscal no usa incremento de 50.
9. Los impuestos múltiples no mezclan residuos.
10. La devolución completa es simétrica.
11. La devolución parcial usa snapshot original.
12. El refund no recalcula pricing.
13. El reversal no reescribe el snapshot.
14. La última devolución absorbe el residuo pendiente.
15. El ajuste comercial no oculta diferencias de caja.

---

# Versionado del algoritmo

## Regla principal

Toda política de redondeo debe tener un identificador inmutable.

Para esta decisión:

```text
NEAREST_50_HALF_AWAY_FROM_ZERO_V1
```

## Prohibición

No se modifica el comportamiento de una versión existente.

Si cambia cualquiera de estos elementos:

- incremento;
- regla de empate;
- precisión previa;
- tratamiento de negativos;
- política de devolución;
- distribución de residuos;
- alcance por moneda;
- reglas offline;

debe crearse una nueva versión.

---

# Snapshot de redondeo

Toda venta congelada debe conservar:

- `rounding_policy_code`;
- `rounding_policy_version`;
- `rounding_increment`;
- `rounding_mode`;
- `currency`;
- `currency_minor_unit`;
- `exact_fiscal_total`;
- `minor_unit_normalized_total`;
- `payable_amount`;
- `commercial_rounding_adjustment`;
- `fiscal_rounding_adjustment`;
- `distribution_algorithm`;
- `return_allocation_algorithm`;
- `calculated_at`;
- `pricing_snapshot_id`;
- `tax_snapshot_id`.

---

# Inmutabilidad

Una vez congelado el snapshot:

- no se cambia la versión;
- no se cambia el incremento;
- no se cambia el ajuste;
- no se recalcula con una política nueva;
- no se reemplaza por una configuración actual;
- no se elimina el valor exacto previo.

---

# Compatibilidad entre versiones

Una implementación nueva debe poder:

- leer snapshots antiguos;
- reproducir resultados antiguos;
- validar importes históricos;
- procesar devoluciones con la versión original;
- conciliar operaciones offline antiguas.

## Regla

No se exige que una versión nueva produzca el mismo resultado que una antigua.

Se exige que ambas sean reproducibles.

---

# Registro de políticas

Debe existir conceptualmente un catálogo:

```text
RoundingPolicyRegistry
```

con:

- código;
- versión;
- incremento;
- modo;
- moneda;
- precisión;
- estado;
- vigencia;
- checksum;
- implementación compatible.

---

# Checksum de política

La definición material de la política puede publicar un checksum.

Debe cubrir:

- parámetros;
- fórmula;
- regla de empate;
- algoritmos auxiliares;
- versión.

## Propósito

Detectar que dos nodos declaran la misma versión, pero ejecutan implementaciones distintas.

---

# Implementación de referencia

Debe existir una implementación de referencia con vectores de prueba.

Como mínimo:

- positivos;
- negativos;
- empates;
- cero;
- extremos;
- fracciones;
- devoluciones;
- residuos;
- operación offline.

---

# Vectores de conformidad

Cada componente debe ejecutar los mismos vectores:

- backend;
- frontend;
- worker;
- dispositivo local;
- proceso de sincronización;
- migrador;
- conciliador.

## Regla

Un componente que no supera los vectores no puede declarar soporte de la versión.

---

# Autoridad del cálculo

## Backend central

Es autoridad cuando la operación está conectada.

## Motor local autorizado

Puede ser autoridad provisional offline cuando:

- tiene política sincronizada;
- checksum válido;
- versión soportada;
- reloj y configuración vigentes;
- permisos suficientes.

## Frontend

Nunca es autoridad final.

Puede:

- previsualizar;
- explicar;
- comparar;
- mostrar el ajuste.

No puede:

- congelar una versión no autorizada;
- elegir arbitrariamente la regla;
- corregir diferencias alterando el total.

---

# Operación offline

## Requisitos

Para calcular offline deben estar sincronizados:

- moneda;
- política;
- versión;
- incremento;
- precisión;
- tarifas;
- reglas fiscales;
- algoritmo de residuos;
- checksum;
- vigencia.

## Si falta información

La operación debe:

- bloquearse;
- quedar en revisión;
- usar una política explícitamente autorizada de contingencia.

No debe inventar resultados.

---

# Vigencia offline

La política puede declarar:

- `valid_from`;
- `valid_until`;
- `grace_period`;
- `offline_allowed`.

## Regla

Una política expirada no se extiende silenciosamente.

---

# Operación creada offline

Debe conservar:

- versión;
- checksum;
- dispositivo;
- fecha local;
- fecha confiable disponible;
- política;
- importes exactos;
- ajuste;
- estado de sincronización.

---

# Sincronización de operación offline

Al sincronizar:

1. validar tenant;
2. validar empresa;
3. validar moneda;
4. validar versión;
5. validar checksum;
6. recalcular con la misma versión;
7. comparar importes;
8. registrar discrepancias;
9. conservar evidencia local;
10. decidir aceptación o revisión.

---

# Recalculo de verificación

El servidor puede recalcular para verificar.

Debe usar:

```text
la misma versión original
```

No la versión vigente actual.

---

# Discrepancia offline

Si:

```text
local_payable_amount
!=
server_recalculated_payable_amount
```

la operación pasa a:

```text
ROUNDING_REVIEW_REQUIRED
```

## Prohibición

No se reemplaza silenciosamente el total local si ya hubo:

- pago;
- impresión;
- entrega;
- movimiento de inventario;
- documento fiscal.

---

# Clasificación de discrepancias

- versión desconocida;
- checksum diferente;
- precisión diferente;
- moneda diferente;
- residuo diferente;
- regla de empate diferente;
- datos de entrada diferentes;
- corrupción;
- implementación defectuosa.

---

# Resultados de sincronización

- `ACCEPTED`;
- `REJECTED`;
- `REVIEW_REQUIRED`;
- `COMPENSATION_REQUIRED`;
- `UNSUPPORTED_VERSION`.

---

# Idempotencia

Toda operación crítica debe usar:

```text
idempotency_key
```

## Casos

- congelar snapshot;
- completar venta;
- recalcular verificación;
- registrar devolución;
- asignar residuo;
- conciliar offline.

## Regla

```text
misma clave + mismas entradas
→ mismo resultado
```

```text
misma clave + entradas diferentes
→ conflicto
```

---

# Concurrencia

## Riesgos

- dos cierres de venta;
- dos versiones aplicadas;
- cambio de política durante pago;
- devolución concurrente;
- asignación duplicada de residuo;
- sincronización repetida.

## Reglas

1. Se utiliza `expected_version`.
2. El snapshot se congela una sola vez.
3. La devolución valida saldo elegible.
4. El residuo pendiente se protege.
5. Un timeout no implica fallo definitivo.
6. Una respuesta tardía valida el estado actual.

---

# Auditoría

Toda aplicación debe registrar:

- actor;
- empresa;
- sucursal;
- dispositivo;
- documento;
- política;
- versión;
- entrada;
- salida;
- ajuste;
- fecha;
- correlation ID;
- idempotency key;
- motivo;
- autoridad.

---

# Explicabilidad

La interfaz debe poder mostrar:

```text
Total fiscal: 10.024
Ajuste de redondeo: -24
Total a pagar: 10.000
```

## Regla

No debe mostrar únicamente:

```text
Total: 10.000
```

si la política requiere trazabilidad del ajuste.

---

# Documentos comerciales

El ticket o factura debe poder mostrar:

- total fiscal;
- ajuste;
- total exigible;
- moneda;
- política cuando aplique.

La obligación exacta depende de regulación y configuración.

---

# Reportes

Los reportes deben distinguir:

- ventas antes de ajuste;
- ajustes positivos;
- ajustes negativos;
- total exigible;
- pagos;
- diferencias de caja.

## Prohibición

No se mezcla el ajuste comercial con descuentos.

---

# Conciliación

Debe verificarse:

```text
fiscal_total
+ commercial_rounding_adjustment
=
payable_amount
```

y:

```text
confirmed_payments
- refunds
- reversals
=
net_financial_coverage
```

---

# Conciliación fiscal

Debe cumplirse:

```text
sum(line_tax_rounded)
=
document_tax_rounded
```

según la política fiscal aplicable.

---

# Conciliación comercial

Debe cumplirse:

```text
document_fiscal_total
+ document_commercial_adjustment
=
document_payable_amount
```

---

# Conciliación de devoluciones

Debe cumplirse acumuladamente:

```text
original_payable_amount
+ sum(return_payable_amounts)
=
remaining_payable_effect
```

con signos coherentes.

---

# Casos de importes muy grandes

La implementación debe evitar:

- overflow;
- pérdida de precisión;
- truncamiento silencioso;
- conversión a `float`.

## Regla

Los límites máximos se validan antes del cálculo.

---

# Casos de importes muy pequeños

Para importes menores al incremento:

- puede resultar cero;
- puede resultar 50;
- depende de la mitad exacta.

## Riesgo

Una venta positiva podría redondearse a cero.

## Regla

La política comercial puede declarar:

```text
minimum_positive_payable_amount
```

si el negocio necesita impedirlo.

---

# Mínimo positivo

Si existe:

```text
minimum_positive_payable_amount
```

debe aplicarse después de evaluar la política de redondeo y antes de congelar snapshot.

## Restricción

No forma parte de `NEAREST_50_HALF_AWAY_FROM_ZERO_V1`.

Es una regla adicional versionada.

---

# Importes negativos pequeños

Una nota crédito negativa puede redondearse a cero.

Ejemplo:

```text
-24
→ 0
```

## Regla

Si esto no es aceptable, debe configurarse una política de mínimo negativo separada.

---

# Moneda no compatible

La política se rechaza cuando:

- el incremento no es múltiplo de la unidad mínima;
- la moneda no usa escala compatible;
- la regulación prohíbe ajuste comercial;
- el canal exige exactitud distinta.

---

# Error de configuración

Ejemplos:

```text
increment = 0
```

```text
increment < 0
```

```text
currency_minor_unit incompatible
```

```text
policy version unknown
```

Resultado:

```text
ROUNDING_CONFIGURATION_INVALID
```

---

# Errores funcionales

- `ROUNDING_POLICY_NOT_FOUND`;
- `ROUNDING_POLICY_VERSION_UNSUPPORTED`;
- `ROUNDING_POLICY_CHECKSUM_MISMATCH`;
- `ROUNDING_CONFIGURATION_INVALID`;
- `ROUNDING_INCREMENT_INVALID`;
- `ROUNDING_CURRENCY_INCOMPATIBLE`;
- `ROUNDING_AMOUNT_OUT_OF_RANGE`;
- `ROUNDING_PRECISION_INVALID`;
- `ROUNDING_SNAPSHOT_ALREADY_FROZEN`;
- `ROUNDING_VERSION_CONFLICT`;
- `ROUNDING_RESIDUAL_ALLOCATION_FAILED`;
- `ROUNDING_RETURN_ALLOCATION_FAILED`;
- `ROUNDING_OFFLINE_POLICY_EXPIRED`;
- `ROUNDING_OFFLINE_DATA_INCOMPLETE`;
- `ROUNDING_OFFLINE_CONFLICT`;
- `ROUNDING_REVIEW_REQUIRED`.

---

# Seguridad

## Permisos

Se requieren permisos para:

- crear política;
- activar versión;
- desactivar política;
- cambiar configuración empresarial;
- forzar revisión;
- compensar discrepancias.

## Prohibiciones

El cajero no puede:

- cambiar incremento;
- cambiar versión;
- eliminar ajuste;
- modificar snapshot;
- elegir regla de empate;
- alterar residuos;
- aprobar conflicto propio.

---

# Multiempresa

Toda política se resuelve dentro de:

- tenant;
- empresa;
- moneda;
- canal;
- vigencia.

## Regla

Una configuración de una empresa no afecta otra.

---

# Migración

## Datos heredados

Las ventas existentes pueden tener:

- total ya redondeado;
- total exacto desconocido;
- política no identificada;
- ajuste mezclado con descuento;
- importe alterado manualmente.

## Clasificación

- `EXACT`;
- `INFERRED`;
- `AMBIGUOUS`;
- `UNRESOLVED`.

## Regla

No se inventa una versión original sin evidencia.

---

# Política heredada desconocida

Cuando no puede determinarse:

```text
legacy_rounding_policy = UNKNOWN
```

Debe conservarse:

- total registrado;
- pagos;
- documentos;
- evidencia;
- nivel de confianza.

---

# Migración de ajustes

Si existe diferencia entre:

```text
fiscal_total inferido
```

y:

```text
payable registrado
```

puede registrarse como:

```text
legacy_commercial_rounding_adjustment
```

solo con evidencia suficiente.

---

# Compatibilidad con DEC-003

`DEC-003` permanece autoridad sobre el orden del pipeline.

`DEC-006` concreta:

- empate;
- incremento;
- negativos;
- fracciones;
- residuos;
- devoluciones;
- versionado.

## Regla

`DEC-006` no cambia el orden de `PRICING_PIPELINE_V1`.

---

# Compatibilidad con DEC-002

`DEC-002` permanece autoridad sobre:

- pago inferior;
- sobrepago;
- fallo parcial;
- compensaciones.

## Regla

Todos esos cálculos usan:

```text
payable_amount
```

producido por esta política.

---

# Consecuencias para TAX-003

`TAX-003` deberá:

- formalizar precisión fiscal;
- definir normalización por impuesto;
- implementar distribución de residuos;
- persistir ajustes;
- validar conciliación documental.

---

# Consecuencias para SALES-003

`SALES-003` deberá:

- congelar versión;
- persistir snapshot;
- exponer ajuste;
- validar payable;
- soportar devolución;
- soportar offline;
- aplicar idempotencia.

---

# Consecuencias para TECH-002

El diseño físico deberá soportar:

- política;
- versión;
- checksum;
- importe exacto;
- importe normalizado;
- ajuste fiscal;
- ajuste comercial;
- payable;
- residuos;
- devoluciones;
- auditoría.

---

# Invariantes de versionado y operación

1. Una versión publicada no cambia.
2. Una venta conserva su versión.
3. Una devolución usa la versión original.
4. Un nodo offline usa una versión sincronizada.
5. El checksum detecta divergencias.
6. El backend verifica con la misma versión.
7. Una discrepancia no se oculta.
8. El frontend no es autoridad.
9. El snapshot se congela una sola vez.
10. Toda operación crítica es idempotente.
11. Toda transición crítica usa versión esperada.
12. Todo ajuste queda auditado.
13. Toda empresa queda aislada.
14. Una migración ambigua no inventa política.
15. `DEC-006` no altera el orden de `DEC-003`.

---

# Escenarios de aceptación

## Escenario 1 — Múltiplo exacto positivo

Entrada:

```text
10.000
```

Resultado:

```text
10.000
```

Ajuste:

```text
0
```

---

## Escenario 2 — Positivo por debajo de la mitad

Entrada:

```text
10.024
```

Resultado:

```text
10.000
```

Ajuste:

```text
-24
```

---

## Escenario 3 — Empate positivo

Entrada:

```text
10.025
```

Resultado:

```text
10.050
```

Ajuste:

```text
25
```

---

## Escenario 4 — Positivo por encima de la mitad

Entrada:

```text
10.026
```

Resultado:

```text
10.050
```

Ajuste:

```text
24
```

---

## Escenario 5 — Múltiplo exacto negativo

Entrada:

```text
-10.000
```

Resultado:

```text
-10.000
```

Ajuste:

```text
0
```

---

## Escenario 6 — Negativo por debajo de la mitad absoluta

Entrada:

```text
-10.024
```

Resultado:

```text
-10.000
```

Ajuste:

```text
24
```

---

## Escenario 7 — Empate negativo

Entrada:

```text
-10.025
```

Resultado:

```text
-10.050
```

Ajuste:

```text
-25
```

---

## Escenario 8 — Negativo por encima de la mitad absoluta

Entrada:

```text
-10.026
```

Resultado:

```text
-10.050
```

Ajuste:

```text
-24
```

---

## Escenario 9 — Cero

Entrada:

```text
0
```

Resultado:

```text
0
```

No se genera ajuste.

---

## Escenario 10 — Importe positivo menor que 25

Entrada:

```text
24
```

Resultado:

```text
0
```

Debe quedar explícito que una venta positiva podría resultar con total exigible cero si no existe una política mínima adicional.

---

## Escenario 11 — Importe positivo igual a 25

Entrada:

```text
25
```

Resultado:

```text
50
```

El empate se aleja de cero.

---

## Escenario 12 — Importe negativo igual a -25

Entrada:

```text
-25
```

Resultado:

```text
-50
```

El empate se aleja de cero.

---

## Escenario 13 — Simetría

Entradas:

```text
10.075
-10.075
```

Resultados:

```text
10.100
-10.100
```

Debe cumplirse:

```text
round(-x) = -round(x)
```

---

## Escenario 14 — Idempotencia

Entrada:

```text
10.025
```

Primera aplicación:

```text
10.050
```

Segunda aplicación:

```text
10.050
```

---

## Escenario 15 — Fiscal antes de comercial

Datos:

```text
commercial_net_amount = 8.424
tax_rounded_amount = 1.600
```

Resultado fiscal:

```text
fiscal_total_amount = 10.024
```

Resultado comercial:

```text
payable_amount = 10.000
```

El impuesto permanece:

```text
1.600
```

---

## Escenario 16 — Redondeo no modifica impuesto

Datos:

```text
fiscal_total = 10.025
tax_total = 1.600
```

Resultado:

```text
payable = 10.050
commercial_adjustment = 25
tax_total = 1.600
```

El ajuste no se incorpora al impuesto.

---

## Escenario 17 — Pago exacto

Datos:

```text
payable = 10.050
confirmed_payment = 10.050
```

Resultado:

```text
covered = true
shortfall = 0
overpayment = 0
```

---

## Escenario 18 — Pago inferior

Datos:

```text
fiscal_total = 10.024
payable = 10.000
confirmed_payment = 9.950
```

Resultado:

```text
shortfall = 50
```

No se compara contra `10.024`.

---

## Escenario 19 — Sobrepago

Datos:

```text
payable = 10.000
confirmed_payment = 10.050
```

Resultado:

```text
overpayment = 50
```

El pricing no cambia.

---

## Escenario 20 — Pago mixto

Datos:

```text
payable = 10.050
cash = 5.000
card = 5.050
```

Resultado:

```text
covered = true
```

No se redondean componentes individualmente.

---

## Escenario 21 — Devolución completa

Venta:

```text
fiscal_total = 10.025
payable = 10.050
adjustment = 25
```

Devolución:

```text
fiscal_total = -10.025
payable = -10.050
adjustment = -25
```

Debe cumplirse:

```text
return_payable = -original_payable
```

---

## Escenario 22 — Devoluciones parciales acumuladas

Venta:

```text
payable = 10.050
```

Se realizan varias devoluciones parciales.

Resultado final, al devolver toda la venta:

```text
sum(return_payable_amounts) = -10.050
```

La última devolución absorbe el residuo pendiente.

---

## Escenario 23 — Refund sin recalcular pricing

Una venta histórica usó:

```text
NEAREST_50_HALF_AWAY_FROM_ZERO_V1
```

Existe una versión posterior activa.

Resultado:

- el refund usa el snapshot original;
- no usa la versión nueva;
- no recalcula el total;
- no modifica el pago original.

---

## Escenario 24 — Residuo fiscal positivo

Datos:

```text
document_tax_rounded = 101
sum(initial_line_tax_rounded) = 100
```

Residuo:

```text
1
```

Resultado:

- se asigna una unidad fiscal mínima;
- se utiliza `LARGEST_REMAINDER_THEN_LINE_ID_V1`;
- la suma final queda en `101`.

---

## Escenario 25 — Residuo fiscal negativo

Datos:

```text
document_tax_rounded = 99
sum(initial_line_tax_rounded) = 100
```

Residuo:

```text
-1
```

Resultado:

- se retira una unidad fiscal mínima;
- la selección es determinista;
- la suma final queda en `99`.

---

## Escenario 26 — Empate de residuos

Dos líneas tienen el mismo residuo.

Resultado:

```text
menor line_id canónico
```

recibe primero la asignación.

No se usa el orden visual.

---

## Escenario 27 — Fracción monetaria

Datos:

```text
exact_fiscal_total = 10.024,50
```

Normalización a peso entero:

```text
10.025
```

Redondeo comercial:

```text
10.050
```

Se conservan los tres valores.

---

## Escenario 28 — Operación offline válida

El dispositivo tiene:

- versión soportada;
- checksum correcto;
- política vigente;
- reglas fiscales completas.

Resultado:

- calcula localmente;
- congela snapshot;
- sincroniza;
- el servidor reproduce el mismo resultado;
- la operación se acepta.

---

## Escenario 29 — Checksum offline diferente

El dispositivo declara la misma versión, pero checksum distinto.

Resultado:

```text
ROUNDING_POLICY_CHECKSUM_MISMATCH
```

La operación no se acepta silenciosamente.

---

## Escenario 30 — Versión offline expirada

La política está expirada y no existe gracia válida.

Resultado:

```text
ROUNDING_OFFLINE_POLICY_EXPIRED
```

La operación se bloquea o pasa a revisión según configuración autorizada.

---

## Escenario 31 — Reintento idempotente

Se congela el mismo snapshot dos veces con:

```text
misma idempotency_key
mismas entradas
```

Resultado:

- se devuelve el mismo snapshot;
- no se duplica;
- no se recalcula con otra versión.

---

## Escenario 32 — Conflicto de idempotencia

Misma clave con importes distintos.

Resultado:

```text
ROUNDING_VERSION_CONFLICT
```

o conflicto de idempotencia equivalente.

---

## Escenario 33 — Cambio de política durante pago

La venta congeló:

```text
V1
```

El administrador activa:

```text
V2
```

Resultado:

- la venta continúa usando `V1`;
- el pago no modifica la versión;
- la operación histórica permanece estable.

---

## Escenario 34 — Ajuste no cuadra caja

Datos:

```text
payable = 10.000
confirmed_payments = 9.950
```

Resultado:

```text
cash_difference = -50
```

No se modifica el ajuste comercial para ocultar la diferencia.

---

## Escenario 35 — Moneda incompatible

Configuración:

```text
minor_unit = 0,01
increment = 0,005
```

Resultado:

```text
ROUNDING_CURRENCY_INCOMPATIBLE
```

---

# Pruebas mínimas

## Unitarias matemáticas

1. Cero.
2. Múltiplo exacto positivo.
3. Múltiplo exacto negativo.
4. Positivo antes de mitad.
5. Positivo en mitad.
6. Positivo después de mitad.
7. Negativo antes de mitad.
8. Negativo en mitad.
9. Negativo después de mitad.
10. Valor `24`.
11. Valor `25`.
12. Valor `26`.
13. Valor `-24`.
14. Valor `-25`.
15. Valor `-26`.
16. Idempotencia.
17. Simetría.
18. Monotonicidad.
19. Resultado múltiplo de 50.
20. Importe máximo permitido.
21. Importe mínimo permitido.
22. Rechazo de `float`.
23. Incremento cero.
24. Incremento negativo.
25. Moneda incompatible.

## Unitarias fiscales

1. Impuesto exacto.
2. Impuesto con fracción.
3. Residuo positivo.
4. Residuo negativo.
5. Residuo cero.
6. Empate de residuos.
7. Múltiples impuestos.
8. Líneas exentas.
9. Base negativa.
10. Nota crédito.
11. Suma por líneas.
12. Suma documental.
13. Distribución estable.
14. Reejecución determinista.
15. `line_id` canónico.

## Unitarias comerciales

1. Ajuste positivo.
2. Ajuste negativo.
3. Ajuste cero.
4. Total exigible.
5. Pago exacto.
6. Pago inferior.
7. Sobrepago.
8. Pago mixto.
9. Cambio en efectivo.
10. Venta que redondea a cero.
11. Política desactivada.
12. Política por canal.
13. Snapshot congelado.
14. Cambio de versión.
15. Precio no alterado.

## Devoluciones

1. Devolución completa positiva.
2. Devolución completa negativa.
3. Devolución parcial.
4. Dos devoluciones parciales.
5. Última devolución con residuo.
6. Refund parcial.
7. Reversal completo.
8. Reversal parcial.
9. Nota crédito.
10. Versión original.
11. Ajuste ya restituido.
12. Exceso de devolución.
13. Devolución concurrente.
14. Reintento idempotente.
15. Venta completamente devuelta.

## Offline

1. Política válida.
2. Política faltante.
3. Versión desconocida.
4. Checksum diferente.
5. Política expirada.
6. Gracia válida.
7. Gracia expirada.
8. Datos fiscales incompletos.
9. Resultado local igual.
10. Resultado local diferente.
11. Sincronización duplicada.
12. Timeout.
13. Respuesta tardía.
14. Operación ya pagada.
15. Compensación requerida.

## Integración

1. Pricing completo.
2. Impuestos.
3. Redondeo fiscal.
4. Redondeo comercial.
5. Snapshot.
6. Registro de pago.
7. Pago mixto.
8. Cierre de venta.
9. Ticket.
10. Caja.
11. Refund.
12. Reversal.
13. Devolución.
14. Conciliación.
15. Reporte.
16. Operación offline.
17. Sincronización.
18. Auditoría.
19. Multiempresa.
20. Migración.

## Concurrencia

1. Dos congelaciones simultáneas.
2. Cambio de versión concurrente.
3. Pago y cambio de política.
4. Dos devoluciones.
5. Dos asignaciones de residuo.
6. Dos sincronizaciones.
7. Reintento tras timeout.
8. Respuesta tardía.
9. Conflicto de versión.
10. Doble refund.

## Seguridad

1. Cajero cambia versión.
2. Cajero cambia incremento.
3. Cajero elimina ajuste.
4. Cajero modifica snapshot.
5. Usuario cruza empresa.
6. Dispositivo usa política ajena.
7. Checksum manipulado.
8. Residuo manipulado.
9. Refund no autorizado.
10. Revisión autoaprobada.

---

# Criterios de aceptación

`DEC-006` se considera cerrada cuando:

1. existe un identificador normativo de política;
2. está definida la unidad de redondeo;
3. está definida la fórmula exacta;
4. está definida la regla de empate;
5. están definidos importes positivos;
6. están definidos importes negativos;
7. está definido cero;
8. está prohibido `float`;
9. está definida la precisión interna;
10. está definida la normalización monetaria;
11. está separado el redondeo fiscal;
12. está separado el redondeo comercial;
13. está definido `fiscal_total_amount`;
14. está definido `payable_amount`;
15. está definido `commercial_rounding_adjustment`;
16. el ajuste no modifica impuestos;
17. el total se determina antes de pagos;
18. están definidos pago inferior y sobrepago;
19. está definido pago mixto;
20. están definidos residuos fiscales;
21. está definido `LARGEST_REMAINDER_THEN_LINE_ID_V1`;
22. está definido el desempate por `line_id`;
23. están definidos impuestos múltiples;
24. está definido el ajuste a nivel documento;
25. están definidas fracciones monetarias;
26. está definida devolución completa;
27. está definida devolución parcial;
28. está definido `PROPORTIONAL_COMMERCIAL_ROUNDING_RETURN_V1`;
29. está definido el límite acumulado;
30. está definido refund;
31. está definido reversal;
32. está definida nota crédito;
33. está definido el versionado;
34. está definido el checksum;
35. están definidos vectores de conformidad;
36. está definida autoridad del cálculo;
37. está definida operación offline;
38. está definida sincronización;
39. está definida idempotencia;
40. está definida concurrencia;
41. está definida auditoría;
42. está definida explicabilidad;
43. están definidos reportes;
44. está definida conciliación;
45. están definidos errores;
46. está definida seguridad;
47. está definida multiempresa;
48. está definida migración;
49. están definidos escenarios;
50. están definidas pruebas;
51. existe coherencia con `DEC-003`;
52. existe coherencia con `DEC-002`;
53. están definidas consecuencias para `TAX-003`;
54. están definidas consecuencias para `SALES-003`;
55. el backlog adjunta evidencia verificable.

---

# Alternativas descartadas

## Usar redondeo del lenguaje

Descartado porque diferentes lenguajes y librerías pueden usar reglas distintas.

## Usar HALF_EVEN

Descartado por complejidad operativa y diferencia respecto de la política seleccionada.

## Redondear por medio de pago

Descartado porque haría que el total dependa del pago.

## Redondear cada línea a 50

Descartado porque alteraría precios, impuestos y promociones.

## Redondear cada impuesto a 50

Descartado porque mezclaría política comercial con fiscal.

## Recalcular devoluciones con versión vigente

Descartado porque rompería historia y simetría.

## Ocultar ajuste dentro de descuento

Descartado porque perdería trazabilidad.

## Reemplazar operación offline al sincronizar

Descartado porque podría reescribir una operación ya pagada o entregada.

---

# Consecuencias positivas

1. Resultado determinista.
2. Empates sin ambigüedad.
3. Soporte simétrico de negativos.
4. Reproducibilidad histórica.
5. Mejor conciliación.
6. Separación fiscal y comercial.
7. Devoluciones coherentes.
8. Operación offline verificable.
9. Mayor auditabilidad.
10. Menos diferencias entre componentes.
11. Menor riesgo de errores por `float`.
12. Mejor integración con caja y pagos.
13. Mejor soporte para pruebas.
14. Evolución versionada.
15. Trazabilidad de residuos.

---

# Costos y consecuencias negativas

1. Más campos de snapshot.
2. Más algoritmos versionados.
3. Mayor complejidad en devoluciones parciales.
4. Necesidad de vectores de conformidad.
5. Necesidad de soporte de versiones antiguas.
6. Mayor disciplina en offline.
7. Mayor complejidad de reportes.
8. Necesidad de conciliación explícita.
9. Necesidad de migrar datos ambiguos.
10. Mayor cantidad de pruebas.

Estas consecuencias se aceptan porque evitan diferencias financieras y fiscales difíciles de corregir en producción.

---

# Decisiones no cerradas por este documento

Esta decisión no cierra:

- tarifas tributarias por jurisdicción;
- cuentas contables;
- formato fiscal por país;
- denominaciones físicas;
- política de cambio;
- mínimo positivo;
- mínimo negativo;
- tablas físicas;
- endpoints;
- componentes visuales;
- `DEC-005`;
- `DEC-007`;
- `DEC-008`;
- `DEC-009`;
- `DEC-010`.

---

# Restricciones para implementación

La implementación no podrá:

- usar `float`;
- usar una regla de empate implícita;
- cambiar una versión publicada;
- redondear por medio de pago;
- redondear líneas comerciales a 50;
- modificar impuestos mediante ajuste comercial;
- recalcular ventas históricas;
- recalcular devoluciones con versión nueva;
- ocultar residuos;
- ocultar diferencias offline;
- aceptar checksum diferente;
- permitir cambios manuales del cajero;
- modificar el snapshot congelado;
- mezclar ajuste con descuento;
- omitir auditoría.

---

# Invariantes globales de DEC-006

1. La política oficial es `NEAREST_50_HALF_AWAY_FROM_ZERO_V1`.
2. El incremento es 50 unidades monetarias mínimas configuradas.
3. El empate se aleja de cero.
4. La función es simétrica.
5. La función es idempotente.
6. La función es monótona.
7. Cero permanece cero.
8. No se utiliza `float`.
9. El redondeo fiscal ocurre primero.
10. El redondeo comercial no modifica impuestos.
11. El total exigible se determina antes del pago.
12. Los pagos cubren `payable_amount`.
13. El ajuste comercial queda separado.
14. Los residuos quedan asignados.
15. El desempate usa `line_id` canónico.
16. Una venta conserva su versión.
17. Una devolución usa la versión original.
18. Un refund no recalcula pricing.
19. Un reversal no reescribe snapshot.
20. Una operación offline conserva checksum.
21. Una discrepancia offline no se oculta.
22. Toda operación crítica es idempotente.
23. Toda transición crítica usa versión esperada.
24. Toda empresa queda aislada.
25. Toda corrección posterior es una operación nueva.

---

# Estado del documento

Estado: `IN_PROGRESS`

Puede pasar a `DONE` cuando:

- se valide la fórmula;
- se validen positivos;
- se validen negativos;
- se validen empates;
- se validen fracciones;
- se valide separación fiscal y comercial;
- se validen residuos;
- se validen devoluciones;
- se valide operación offline;
- se validen vectores de conformidad;
- no existan contradicciones críticas;
- se confirme coherencia con `DEC-003`;
- se confirme coherencia con `DEC-002`;
- se adjunte evidencia al backlog;
- `DEC-006` se mueva a decisiones cerradas.

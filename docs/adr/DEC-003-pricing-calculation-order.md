# DEC-003 — Orden único y versionado de cálculo de precios

## Estado

`DONE`

## Prioridad

`P0`

## Contexto

El sistema necesita una única secuencia determinista para calcular el importe exigible de una venta.

Actualmente intervienen varios conceptos que pueden producir resultados distintos si se aplican en órdenes diferentes:

- precio base;
- precio promocional;
- promociones por línea;
- promociones por grupo;
- promociones globales;
- descuentos manuales;
- cupones;
- impuestos;
- redondeo comercial;
- redondeo fiscal;
- ajustes autorizados;
- devoluciones;
- pagos parciales.

Sin una política única y versionada pueden aparecer:

- totales distintos entre frontend y backend;
- diferencias entre POS y servidor;
- devoluciones calculadas con otra lógica;
- impuestos incorrectos;
- promociones acumuladas indebidamente;
- descuentos duplicados;
- inconsistencias offline;
- dificultades de conciliación;
- tickets imposibles de reconstruir;
- errores de auditoría;
- cambios retroactivos sobre ventas históricas.

Esta decisión define el orden conceptual obligatorio.

---

# Decisión

Toda venta deberá calcularse mediante una canalización determinista, versionada e inmutable.

La versión inicial aprobada será:

```text
PRICING_PIPELINE_V1
```

El orden general será:

```text
1. Captura del precio base versionado
2. Selección de precio promocional elegible
3. Aplicación de promociones automáticas por línea
4. Aplicación de promociones automáticas por grupo
5. Aplicación de promociones automáticas globales
6. Aplicación de cupones
7. Aplicación de descuentos manuales autorizados
8. Cálculo de base imponible
9. Cálculo de impuestos
10. Aplicación del redondeo fiscal obligatorio
11. Aplicación del redondeo comercial permitido
12. Cálculo del total exigible final
13. Congelación del snapshot de cálculo
```

Ninguna implementación podrá modificar este orden sin:

- crear una nueva versión de canalización;
- documentar la decisión;
- migrar contratos;
- añadir pruebas de regresión;
- conservar compatibilidad con ventas históricas.

---

# Alcance

Esta decisión define:

- orden de cálculo;
- autoridad de cada dato;
- prioridad entre precios;
- acumulación de promociones;
- acumulación de descuentos;
- aplicación de cupones;
- base de impuestos;
- redondeo;
- snapshots;
- versionado;
- reconstrucción;
- devoluciones;
- operación offline;
- idempotencia;
- auditoría;
- invariantes;
- consecuencias para ventas, precios e impuestos.

No define todavía:

- tablas físicas;
- migraciones;
- índices;
- tipos SQL;
- endpoints definitivos;
- componentes del frontend;
- motor específico de reglas;
- lenguaje de promociones;
- integración fiscal definitiva;
- estrategia contable definitiva.

---

# Documentos relacionados

Esta decisión debe mantenerse alineada con:

- `docs/use-cases/sales/UC-SALES-001-complete-sale.md`;
- `docs/use-cases/sales/UC-SALES-002-manage-sale-lifecycle.md`;
- `docs/use-cases/payments/UC-PAY-002-register-mixed-payment.md`;
- `docs/use-cases/payments/UC-PAY-004-refund-payment.md`;
- `docs/use-cases/payments/UC-PAY-005-reconcile-payment.md`;
- `docs/use-cases/cash/UC-CASH-003-cash-operations.md`;
- `docs/adr/DEC-002-payment-compensation-policy.md`;
- `docs/domain/business-rules.md`;
- `docs/domain/commercial-engine.md`;
- `docs/domain/glossary.md`;
- `docs/product/backlog.md`.

Esta decisión condiciona:

- `PRICE-002`;
- `SALES-003`;
- `TAX-003`;
- `TECH-002`;
- `TECH-003`;
- implementación del motor comercial;
- devoluciones;
- conciliación;
- operación offline.

---

# Objetivos

1. Obtener resultados deterministas.
2. Evitar doble descuento.
3. Evitar doble promoción.
4. Evitar diferencias entre canales.
5. Poder reconstruir una venta histórica.
6. Poder explicar cada importe.
7. Separar cálculo comercial y pago.
8. Separar cálculo comercial y caja.
9. Mantener impuestos auditables.
10. Versionar reglas.
11. Soportar devoluciones parciales.
12. Soportar operación offline.
13. Soportar múltiples monedas.
14. Soportar multiempresa.
15. Permitir evolución sin reescribir ventas históricas.

---

# Principios

1. El backend es la autoridad final del cálculo confirmado.
2. El frontend puede previsualizar, pero no decide el total final.
3. Toda venta conserva snapshot.
4. Una venta histórica no se recalcula con reglas nuevas.
5. Un precio promocional no sustituye destructivamente el precio base.
6. Una promoción no se representa como cambio manual de precio.
7. Un descuento manual requiere permiso.
8. Un cupón conserva identidad propia.
9. Los impuestos se calculan sobre una base explícita.
10. El redondeo se aplica una sola vez por etapa autorizada.
11. El total exigible no depende del medio de pago.
12. Un pago no altera el precio.
13. Un refund no recalcula retroactivamente la venta.
14. Una devolución usa el snapshot original.
15. Una regla offline conserva versión.
16. Toda excepción queda auditada.
17. El resultado debe ser reproducible.
18. Los cálculos monetarios no usan coma flotante binaria.
19. Toda moneda define precisión.
20. Toda regla tiene vigencia.
21. Toda promoción tiene prioridad explícita.
22. Toda acumulación debe estar autorizada.
23. Toda exclusión debe estar registrada.
24. Ningún componente puede producir un total negativo.

---

# Terminología

## Precio base

Precio comercial ordinario de una unidad antes de promociones, descuentos, impuestos y redondeo.

Debe estar asociado a:

- tenant;
- empresa;
- sucursal o alcance;
- producto;
- variante;
- presentación;
- lista de precios;
- moneda;
- vigencia;
- versión.

## Precio promocional

Precio alternativo temporal que puede sustituir el precio base como punto de partida comercial.

No es un descuento manual.

## Promoción

Regla automática que altera el valor comercial o la cantidad efectiva.

Ejemplos:

- porcentaje;
- importe fijo;
- `2x1`;
- `3x2`;
- combo;
- descuento por volumen;
- producto gratuito;
- promoción por categoría;
- promoción por cliente;
- promoción por horario.

## Cupón

Beneficio identificable presentado o asociado a una venta.

Debe conservar:

- código;
- campaña;
- regla;
- vigencia;
- límite;
- uso;
- actor;
- cliente cuando aplique.

## Descuento manual

Reducción explícita autorizada por un usuario.

Debe conservar:

- actor;
- permiso;
- motivo;
- valor;
- límite;
- aprobador cuando aplique.

## Base imponible

Importe sobre el cual se calcula un impuesto.

## Redondeo fiscal

Redondeo exigido por política tributaria o documental.

## Redondeo comercial

Ajuste permitido para facilitar cobro o manejo de efectivo.

## Snapshot de pricing

Registro inmutable de todas las entradas, reglas, exclusiones y resultados utilizados para calcular la venta.

---

# Autoridad de datos

## Precio base

La fuente autorizada es la lista de precios versionada aplicable a:

- tenant;
- empresa;
- sucursal;
- canal;
- producto;
- variante;
- presentación;
- moneda;
- fecha efectiva.

## Precio promocional

La fuente autorizada es una regla promocional activa y versionada.

## Promociones

La autoridad es el motor comercial central o la versión local autorizada.

## Descuentos manuales

La autoridad es una acción explícita de un actor con permiso.

## Impuestos

La autoridad es la política fiscal versionada aplicable al snapshot.

## Redondeo

La autoridad es la política versionada de moneda, empresa, canal y regulación.

## Regla

El cliente no puede enviar como verdad:

- precio final;
- descuento final;
- impuesto final;
- total final;
- prioridad de promoción;
- redondeo final.

Puede enviar una solicitud o previsualización, pero el servidor debe validar y reconstruir.

---

# Modelo conceptual de importes

Cada línea deberá poder conservar como mínimo:

- `base_unit_price`;
- `promotional_unit_price`;
- `effective_unit_price`;
- `quantity`;
- `gross_line_amount`;
- `automatic_line_discount`;
- `automatic_group_discount_allocated`;
- `automatic_order_discount_allocated`;
- `coupon_discount_allocated`;
- `manual_discount_allocated`;
- `taxable_base`;
- `tax_amount`;
- `fiscal_rounding_allocated`;
- `commercial_rounding_allocated`;
- `final_line_amount`.

A nivel de venta:

- `gross_amount`;
- `promotional_adjustment_amount`;
- `automatic_discount_amount`;
- `coupon_discount_amount`;
- `manual_discount_amount`;
- `taxable_amount`;
- `tax_amount`;
- `fiscal_rounding_amount`;
- `commercial_rounding_amount`;
- `payable_amount`.

---

# Invariantes monetarias

1. Todos los importes usan decimal exacto.
2. Todos los importes conservan moneda.
3. No se mezclan monedas en un mismo total sin conversión explícita.
4. Un importe no puede ser `NaN`.
5. Un importe no puede ser infinito.
6. La cantidad debe ser válida.
7. El precio unitario no puede ser negativo.
8. El descuento total no puede superar el importe elegible.
9. La base imponible no puede ser negativa.
10. El impuesto no puede ser negativo salvo documento correctivo autorizado.
11. El total exigible no puede ser negativo.
12. La suma de líneas y ajustes debe cuadrar con el total.
13. Los residuos de redondeo deben asignarse explícitamente.
14. Una venta confirmada conserva los importes originales.
15. Las reglas nuevas no modifican ventas históricas.

---

# Precisión monetaria

Cada moneda deberá definir:

- cantidad de decimales contables;
- cantidad de decimales de cálculo;
- unidad mínima de contabilización;
- unidad mínima de cobro;
- regla de redondeo;
- regla de empate;
- tolerancia permitida;
- tratamiento del efectivo.

## Regla

La precisión interna puede ser mayor que la precisión mostrada.

Ejemplo conceptual:

```text
precisión de cálculo: 6 decimales
precisión contable:   2 decimales
precisión de cobro:   0 decimales
```

La reducción de precisión debe ocurrir únicamente en etapas definidas.

---

# Prohibición de coma flotante binaria

No se permite utilizar tipos binarios como `float` o `double` para resultados monetarios definitivos.

Debe utilizarse:

- decimal exacto;
- entero en unidades mínimas;
- biblioteca monetaria equivalente;
- estrategia documentada.

Los cálculos intermedios deben evitar errores acumulativos.

---

# Versión de la canalización

Cada cálculo debe registrar:

- `pricing_pipeline_version`;
- `price_list_version`;
- `promotion_engine_version`;
- `tax_policy_version`;
- `rounding_policy_version`;
- `currency_policy_version`;
- `calculated_at`;
- `calculated_by`;
- `calculation_source`.

Versión inicial:

```text
PRICING_PIPELINE_V1
```

## Regla

Una nueva versión no sustituye retroactivamente la anterior.

Debe poder coexistir:

```text
PRICING_PIPELINE_V1
PRICING_PIPELINE_V2
PRICING_PIPELINE_V3
```

---

# Etapa 1 — Captura del precio base

## Propósito

Obtener el precio ordinario aplicable antes de promociones y descuentos.

## Selección

La selección debe considerar:

1. tenant;
2. empresa;
3. sucursal;
4. canal;
5. lista de precios;
6. producto;
7. variante;
8. presentación;
9. cliente o segmento;
10. moneda;
11. fecha efectiva;
12. prioridad.

## Reglas

1. Debe existir una única selección determinista.
2. Las reglas de prioridad deben estar versionadas.
3. Un empate no se resuelve arbitrariamente.
4. Un precio vencido no se aplica.
5. Un precio futuro no se aplica.
6. Un precio de otro tenant no se aplica.
7. La ausencia de precio genera error.
8. El precio seleccionado queda congelado en snapshot.
9. El precio base no se sobrescribe con el promocional.
10. La fuente queda registrada.

## Resultado

```text
base_unit_price
```

---

# Resolución de múltiples precios base

Si existen varias listas aplicables, la prioridad conceptual será:

```text
1. precio específico de contrato autorizado
2. precio específico de cliente autorizado
3. precio específico de sucursal
4. precio específico de canal
5. precio general de empresa
6. precio general de tenant
```

La existencia de una prioridad superior no implica automáticamente elegibilidad.

También deben validarse:

- vigencia;
- moneda;
- producto;
- presentación;
- cantidad;
- segmento;
- política.

## Prohibiciones

No se permite:

- elegir el menor precio sin política;
- elegir el último insertado;
- elegir por orden físico de base de datos;
- mezclar listas;
- aplicar un precio de otra moneda;
- aplicar un precio sin vigencia;
- aceptar el precio enviado por el frontend como autoridad.

---

# Etapa 2 — Selección de precio promocional

## Principio

El precio promocional puede reemplazar el precio base como precio unitario efectivo inicial.

No modifica el registro del precio base.

## Elegibilidad

Debe validar:

- promoción activa;
- periodo;
- horario;
- sucursal;
- canal;
- producto;
- variante;
- presentación;
- cantidad;
- cliente;
- segmento;
- cupo;
- límite de usos;
- moneda;
- exclusiones.

## Resultado

Si existe precio promocional válido:

```text
effective_unit_price = promotional_unit_price
```

Si no existe:

```text
effective_unit_price = base_unit_price
```

## Reglas

1. El precio promocional conserva identidad.
2. Debe conservarse el precio base original.
3. Debe registrarse el ahorro.
4. Debe registrarse la regla aplicada.
5. Debe registrarse la exclusión de reglas incompatibles.
6. Un precio promocional no puede ser negativo.
7. Un precio promocional no puede aplicarse fuera de vigencia.
8. Un empate debe resolverse por prioridad.
9. Si dos reglas tienen igual prioridad incompatible, se genera conflicto.
10. El resultado queda congelado en snapshot.

---

# Selección entre precios promocionales

La selección predeterminada será:

```text
mayor prioridad válida
→ si empatan, mayor beneficio permitido para el cliente
→ si persiste el empate, identificador determinista
```

La regla de desempate debe:

- estar versionada;
- quedar auditada;
- producir el mismo resultado en todos los nodos;
- evitar depender del orden de consulta.

## Restricción

El criterio “mayor beneficio” solo se aplica entre reglas ya declaradas compatibles y elegibles.

No convierte promociones incompatibles en acumulables.

---

# Etapa 3 — Promociones automáticas por línea

## Tipos

- porcentaje por línea;
- importe fijo por línea;
- precio por cantidad;
- descuento por volumen;
- producto gratuito;
- `2x1`;
- `3x2`;
- escalas;
- precio especial por unidad.

## Orden interno

Las promociones por línea se ordenan por:

```text
1. prioridad explícita
2. grupo de exclusión
3. regla de acumulación
4. identificador determinista
```

## Reglas

1. La promoción debe ser elegible.
2. La promoción debe ser compatible.
3. La promoción no puede exceder el importe elegible.
4. Un producto gratuito conserva precio base y descuento equivalente.
5. Una promoción por cantidad conserva unidades beneficiadas.
6. Las unidades gratuitas no desaparecen del inventario.
7. El descuento queda asociado a la línea.
8. La regla queda en snapshot.
9. La exclusión queda en snapshot.
10. Un reintento produce el mismo resultado.

---

# Promociones de unidades gratuitas

Ejemplo:

```text
3x2
```

Para tres unidades con precio efectivo de 10.000:

```text
importe bruto:          30.000
descuento promocional:  10.000
importe neto:           20.000
```

La unidad gratuita:

- sigue siendo una unidad vendida;
- consume inventario;
- conserva trazabilidad;
- participa en devoluciones;
- no se representa con precio base cero;
- se representa mediante descuento promocional asignado.

---

# Distribución del descuento por unidades gratuitas

El descuento debe distribuirse determinísticamente entre las unidades o líneas afectadas.

Opciones conceptuales:

- asignar a la unidad de menor precio;
- prorratear;
- asignar según la regla de campaña.

La campaña debe indicar el algoritmo.

Si no lo indica, la versión inicial utilizará:

```text
LOWEST_ELIGIBLE_UNIT_V1
```

## Regla

En devoluciones, la distribución original debe conservarse.

No se recalcula con los productos restantes.

---

# Etapa 4 — Promociones automáticas por grupo

## Definición

Promoción aplicada a un conjunto de líneas relacionadas.

Ejemplos:

- combo;
- categoría;
- marca;
- paquete;
- compra cruzada;
- cantidad agregada;
- surtido.

## Reglas

1. El grupo elegible debe identificarse.
2. Las líneas participantes deben quedar registradas.
3. La cantidad consumida por la promoción debe quedar registrada.
4. El beneficio debe distribuirse.
5. La distribución debe ser determinista.
6. El mismo componente no puede consumirse dos veces por reglas incompatibles.
7. Una línea puede participar en varias promociones solo si la política lo permite.
8. El snapshot debe conservar el grupo.
9. El snapshot debe conservar exclusiones.
10. La devolución usa la distribución original.

---

# Distribución de promociones de grupo

Algoritmo predeterminado:

```text
PROPORTIONAL_GROSS_ELIGIBLE_V1
```

Fórmula conceptual:

```text
line_weight = line_eligible_amount / total_group_eligible_amount
line_discount = group_discount * line_weight
```

Los residuos se asignan mediante un algoritmo determinista.

## Regla de residuo

La versión inicial utilizará:

```text
LARGEST_REMAINDER_THEN_LINE_ID_V1
```

Orden:

1. calcular importe ideal;
2. redondear a precisión interna;
3. calcular residuo;
4. ordenar por mayor residuo;
5. desempatar por identificador determinista;
6. asignar unidades mínimas restantes.

---

# Etapa 5 — Promociones automáticas globales

## Definición

Promoción aplicable al conjunto de la venta.

Ejemplos:

- descuento por total;
- descuento por cliente;
- descuento por horario;
- descuento por campaña;
- descuento por canal;
- beneficio por membresía.

## Base elegible

La base predeterminada será:

```text
importe posterior a promociones por línea y grupo
```

No incluirá:

- impuestos ya calculados;
- redondeos;
- importes excluidos;
- líneas no elegibles;
- cargos no descontables.

## Reglas

1. Debe existir una base explícita.
2. Las exclusiones deben conservarse.
3. El descuento global se distribuye entre líneas.
4. La distribución debe ser determinista.
5. No puede producir base negativa.
6. Debe respetar límites.
7. Debe respetar acumulación.
8. Debe conservar campaña y versión.
9. Debe poder reconstruirse.
10. Las devoluciones usan la asignación original.

---

# Distribución de promociones globales

Algoritmo predeterminado:

```text
PROPORTIONAL_NET_ELIGIBLE_V1
```

Fórmula conceptual:

```text
line_weight =
line_net_eligible_before_global_discount
/
total_net_eligible_before_global_discount
```

El descuento se distribuye según ese peso.

Los residuos usan:

```text
LARGEST_REMAINDER_THEN_LINE_ID_V1
```

---

# Reglas de acumulación

Toda promoción deberá declarar una política:

- `EXCLUSIVE`;
- `STACKABLE`;
- `STACKABLE_WITHIN_GROUP`;
- `STACKABLE_WITH_COUPON`;
- `STACKABLE_WITH_MANUAL_DISCOUNT`;
- `BEST_BENEFIT_ONLY`;
- `PRIORITY_WINS`.

## Regla predeterminada

Si la regla no declara acumulación:

```text
EXCLUSIVE
```

No se asumirá acumulación implícita.

---

# Grupos de exclusión

Las promociones incompatibles deben compartir un grupo de exclusión.

Ejemplos:

- `PRODUCT_PRICE_OVERRIDE`;
- `LINE_PERCENTAGE`;
- `BUNDLE`;
- `ORDER_PERCENTAGE`;
- `LOYALTY`;
- `COUPON`;
- `EMPLOYEE_DISCOUNT`.

Dentro de un grupo, la estrategia puede ser:

- mayor prioridad;
- mayor beneficio;
- primera elegible determinista;
- selección manual autorizada.

La estrategia debe quedar versionada.

---

# Resolución de promociones incompatibles

La versión inicial seguirá:

```text
1. descartar reglas no elegibles
2. agrupar reglas incompatibles
3. ordenar por prioridad
4. si existe empate, aplicar BEST_BENEFIT_VALID_V1
5. si persiste el empate, usar rule_id ascendente
6. registrar aplicadas y excluidas
```

## Prohibiciones

No se permite:

- aplicar todas por defecto;
- depender del orden de consulta;
- elegir aleatoriamente;
- ocultar reglas excluidas;
- recalcular después de pagar;
- cambiar una regla histórica.

---

# Snapshot de promociones

Debe conservar:

- `promotion_id`;
- `promotion_version`;
- tipo;
- prioridad;
- grupo de exclusión;
- política de acumulación;
- condiciones evaluadas;
- condiciones cumplidas;
- líneas elegibles;
- líneas excluidas;
- cantidades consumidas;
- beneficio bruto;
- distribución;
- residuos;
- algoritmo;
- versión de algoritmo;
- fecha;
- autoridad.

---

# Resultado acumulado hasta promociones automáticas

Después de las etapas 1 a 5 deberán estar disponibles:

```text
base_price_amount
promotional_price_adjustment
line_promotion_discount
group_promotion_discount
order_promotion_discount
```

El importe previo a cupones será:

```text
amount_before_coupons =
gross_amount
- promotional_price_adjustment
- line_promotion_discount
- group_promotion_discount
- order_promotion_discount
```

El resultado no puede ser negativo.

---

# Etapa 6 — Aplicación de cupones

## Propósito

Aplicar beneficios identificables mediante un código, campaña, cliente, membresía o mecanismo equivalente.

## Datos mínimos

Todo cupón aplicado debe conservar:

- `coupon_id`;
- código;
- campaña;
- versión;
- tenant;
- empresa;
- canal;
- cliente, cuando aplique;
- vigencia;
- límite de uso;
- uso acumulado;
- regla de acumulación;
- grupo de exclusión;
- importe máximo;
- líneas elegibles;
- actor;
- fecha;
- idempotency key.

## Validaciones

1. El cupón existe.
2. Pertenece al tenant.
3. Está activo.
4. Está dentro de vigencia.
5. Aplica al canal.
6. Aplica a la sucursal.
7. Aplica al cliente cuando corresponda.
8. No superó el límite global.
9. No superó el límite por cliente.
10. No fue consumido en una operación incompatible.
11. Cumple el importe mínimo.
12. Cumple las condiciones de productos.
13. Cumple las condiciones de cantidad.
14. Es compatible con promociones previas.
15. Es compatible con descuentos manuales.
16. Está expresado en la moneda correcta.
17. No produce importe negativo.
18. Conserva versión.

## Tipos conceptuales

- porcentaje sobre líneas elegibles;
- importe fijo;
- beneficio por categoría;
- beneficio por producto;
- beneficio por venta;
- envío gratuito;
- producto gratuito;
- saldo promocional;
- cupón de cliente;
- cupón de campaña;
- cupón de compensación comercial.

## Base predeterminada

La base del cupón será:

```text
amount_before_coupons
```

menos líneas o importes excluidos.

## Regla

El cupón no se aplica sobre:

- impuestos ya calculados;
- redondeos;
- cargos excluidos;
- importes no elegibles;
- otro cupón incompatible;
- valores ya consumidos por una regla exclusiva.

---

# Orden entre múltiples cupones

La política predeterminada será:

```text
1. descartar cupones no elegibles
2. agrupar incompatibilidades
3. ordenar por prioridad
4. aplicar según política de acumulación
5. desempatar por mayor beneficio válido
6. desempatar finalmente por coupon_id
```

## Regla predeterminada

Si un cupón no declara acumulación:

```text
EXCLUSIVE
```

## Prohibiciones

No se permite:

- aceptar cualquier cantidad de cupones;
- depender del orden de captura;
- permitir doble consumo;
- usar un cupón vencido;
- aplicar un cupón de otro tenant;
- modificar la regla histórica;
- recalcular el beneficio después de completar la venta.

---

# Consumo de cupones

## Reserva

Un cupón puede quedar reservado durante:

- construcción de la venta;
- suspensión;
- autorización;
- pago pendiente.

## Consumo definitivo

El cupón se consume cuando la política definida alcanza el evento autorizado.

La versión inicial utilizará:

```text
CONSUME_ON_SALE_COMPLETION_V1
```

## Liberación

La reserva debe liberarse cuando:

- la venta se cancela;
- la venta expira;
- la suspensión vence;
- el cupón deja de ser elegible;
- la operación falla definitivamente.

## Reglas

1. La reserva no equivale a consumo.
2. La misma unidad de uso no se reserva dos veces.
3. El consumo debe ser idempotente.
4. Una operación tardía debe verificar el estado actual.
5. Una venta completada conserva el consumo.
6. Una devolución no libera automáticamente el cupón.
7. La política de devolución define restitución o no.
8. Toda liberación queda auditada.

---

# Distribución del descuento de cupón

Cuando el beneficio afecta varias líneas se utiliza:

```text
PROPORTIONAL_NET_ELIGIBLE_V1
```

La base de peso será el importe neto elegible posterior a promociones automáticas.

Los residuos se asignan mediante:

```text
LARGEST_REMAINDER_THEN_LINE_ID_V1
```

## Restricción

La suma asignada debe coincidir exactamente con el beneficio aprobado.

Si no puede cuadrar sin exceder límites:

```text
PRICING_REVIEW_REQUIRED
```

---

# Cupón de importe fijo superior a la base

Ejemplo:

```text
base elegible: 20.000
cupón fijo:    30.000
```

Resultado predeterminado:

```text
beneficio aplicado: 20.000
beneficio no aplicado: 10.000
```

El excedente:

- no produce total negativo;
- no se convierte automáticamente en saldo;
- no se traslada a impuestos;
- no se consume salvo política explícita;
- queda registrado.

---

# Etapa 7 — Descuentos manuales autorizados

## Propósito

Permitir una reducción explícita iniciada por un actor autorizado después de promociones automáticas y cupones.

## Tipos

- porcentaje por línea;
- importe fijo por línea;
- porcentaje global;
- importe fijo global;
- ajuste comercial autorizado;
- compensación comercial;
- descuento de empleado;
- descuento de fidelización manual;
- corrección operativa autorizada.

## Datos mínimos

- `manual_discount_id`;
- venta;
- línea o alcance;
- tipo;
- valor solicitado;
- valor aprobado;
- moneda;
- actor;
- permiso;
- motivo;
- aprobador cuando aplique;
- límite;
- política;
- versión;
- fecha;
- idempotency key.

## Orden

Los descuentos manuales se aplican:

```text
después de promociones automáticas y cupones
antes de impuestos
```

salvo que una política fiscal exija otra clasificación explícita.

## Regla

Un descuento manual no puede modificar:

- precio base;
- precio promocional;
- reglas ya evaluadas;
- importes históricos;
- impuestos ya congelados;
- pagos.

Genera un ajuste separado y auditable.

---

# Límites de descuento manual

Los límites deben poder definirse por:

- rol;
- usuario;
- empresa;
- sucursal;
- canal;
- categoría;
- producto;
- margen;
- importe;
- porcentaje;
- periodo;
- cliente.

## Niveles conceptuales

- autorización directa;
- aprobación de supervisor;
- aprobación de administrador;
- operación prohibida.

## Reglas

1. El límite se evalúa sobre la base elegible.
2. El usuario no puede dividir operaciones para evadir el límite.
3. La acumulación diaria puede controlarse.
4. La acumulación por venta puede controlarse.
5. La aprobación conserva actor separado.
6. Un override requiere motivo.
7. La política aplicada queda congelada.

---

# Segregación de funciones en descuentos

La política puede exigir que:

- quien solicita no apruebe;
- quien fija el precio no apruebe el descuento;
- quien completa la venta no apruebe excepciones críticas;
- un descuento sobre margen mínimo requiera supervisor;
- un descuento extraordinario requiera propietario.

## Evidencia

Debe conservarse:

- solicitante;
- aprobador;
- ejecutor;
- permisos;
- motivo;
- valor solicitado;
- valor aprobado;
- límite normal;
- override;
- fechas.

---

# Compatibilidad del descuento manual

Todo descuento manual debe declarar compatibilidad con:

- precio promocional;
- promociones automáticas;
- cupones;
- descuentos de empleado;
- programas de fidelización;
- otras reducciones manuales.

## Regla predeterminada

Si no existe autorización explícita:

```text
NOT_STACKABLE
```

## Prohibiciones

No se permite:

- aplicar un descuento sin permiso;
- superar el importe elegible;
- aplicar sobre impuestos salvo política;
- ocultarlo como precio modificado;
- aceptar un valor enviado por frontend sin validación;
- modificarlo después de completar la venta.

---

# Distribución de descuento manual global

Algoritmo predeterminado:

```text
PROPORTIONAL_NET_AFTER_COUPONS_V1
```

Fórmula conceptual:

```text
line_weight =
line_net_eligible_after_coupons
/
total_net_eligible_after_coupons
```

Los residuos se asignan con:

```text
LARGEST_REMAINDER_THEN_LINE_ID_V1
```

---

# Resultado acumulado antes de impuestos

Después de la etapa 7:

```text
amount_before_tax =
gross_amount
- promotional_price_adjustment
- line_promotion_discount
- group_promotion_discount
- order_promotion_discount
- coupon_discount
- manual_discount
```

Debe cumplirse:

```text
amount_before_tax >= 0
```

---

# Etapa 8 — Determinación de la base imponible

## Principio

La base imponible se calcula después de descuentos comerciales aplicables y antes de impuestos.

## Regla general

```text
taxable_base =
commercial_amount_after_discounts
+ taxable_charges
- non_taxable_exclusions
```

La fórmula exacta depende de:

- tipo de impuesto;
- jurisdicción;
- producto;
- cliente;
- canal;
- documento;
- fecha;
- política fiscal.

## Restricción

Este documento define el orden conceptual, pero no sustituye la política tributaria especializada.

---

# Clasificación fiscal por línea

Cada línea debe conservar:

- categoría fiscal;
- impuesto aplicable;
- tarifa;
- condición de exención;
- base;
- unidad;
- fecha efectiva;
- versión;
- autoridad;
- motivo de exclusión.

## Posibles clasificaciones

- gravado;
- exento;
- excluido;
- tarifa cero;
- no sujeto;
- impuesto específico;
- impuesto incluido;
- impuesto adicional;
- retención;
- cargo fiscal.

## Regla

La clasificación fiscal no se deduce únicamente del nombre del producto.

Debe provenir de una regla versionada.

---

# Impuesto incluido en el precio

Cuando el precio incluye impuesto, debe separarse conceptualmente.

Fórmula:

```text
taxable_base =
tax_inclusive_amount
/
(1 + tax_rate)
```

```text
tax_amount =
tax_inclusive_amount
- taxable_base
```

## Reglas

1. La precisión interna debe ser suficiente.
2. El redondeo final ocurre en la etapa fiscal.
3. La suma debe reconstruir el importe incluido.
4. Los residuos deben asignarse.
5. La tarifa queda congelada.
6. Las devoluciones usan la tarifa original.

---

# Impuesto agregado al precio

Cuando el impuesto se agrega:

```text
tax_amount =
taxable_base * tax_rate
```

```text
line_total_before_rounding =
taxable_base + tax_amount
```

## Reglas

1. La base ya incluye los descuentos comerciales aplicables.
2. No se descuenta el impuesto con una promoción comercial ordinaria.
3. Los cargos fiscales se separan.
4. El resultado debe ser reproducible.
5. La política define nivel de redondeo.

---

# Impuestos múltiples

Una línea puede tener:

- impuestos acumulativos;
- impuestos excluyentes;
- impuestos compuestos;
- impuestos específicos;
- retenciones;
- cargos.

## Orden

Cada política debe declarar:

- prioridad;
- base;
- dependencia;
- acumulación;
- inclusión;
- redondeo.

## Regla

No se permite asumir que todos los impuestos se calculan sobre la misma base.

---

# Etapa 9 — Cálculo de impuestos

## Proceso

1. seleccionar política fiscal;
2. determinar clasificación;
3. determinar base;
4. aplicar exclusiones;
5. calcular impuestos;
6. aplicar reglas compuestas;
7. conservar resultados internos;
8. distribuir ajustes;
9. preparar redondeo fiscal;
10. congelar snapshot.

## Datos mínimos del resultado

- `tax_id`;
- tipo;
- tarifa;
- base;
- importe bruto;
- importe redondeado;
- nivel de cálculo;
- regla de redondeo;
- versión;
- autoridad;
- líneas relacionadas.

---

# Nivel de cálculo fiscal

La política debe definir si el impuesto se calcula:

- por unidad;
- por línea;
- por grupo;
- por venta;
- por documento.

## Regla

No se puede mezclar el nivel sin una estrategia explícita de reconciliación.

La versión inicial debe conservar simultáneamente:

- cálculo interno de alta precisión;
- importe asignado por línea;
- importe fiscal total;
- diferencias de distribución.

---

# Distribución del impuesto total

Cuando la autoridad fiscal determine un total global que debe distribuirse, se utilizará:

```text
PROPORTIONAL_TAXABLE_BASE_V1
```

Los residuos se asignan mediante:

```text
LARGEST_REMAINDER_THEN_LINE_ID_V1
```

## Invariante

```text
sum(line_tax_amounts) = total_tax_amount
```

---

# Exclusiones de base imponible

Pueden excluirse:

- líneas exentas;
- líneas no sujetas;
- cargos no gravables;
- depósitos;
- propinas, según política;
- valores de terceros;
- ajustes fiscales;
- importes prohibidos por regulación.

## Regla

Toda exclusión debe conservar:

- motivo;
- regla;
- versión;
- importe;
- línea;
- autoridad.

---

# Descuentos y base fiscal

## Principio

Los descuentos comerciales reducen la base cuando la política tributaria lo permite.

## Casos que requieren clasificación

- descuento financiado por el comercio;
- descuento financiado por proveedor;
- subsidio;
- cashback;
- cupón de tercero;
- saldo a favor;
- bonificación;
- producto gratuito;
- compensación comercial.

## Regla

La fuente económica del beneficio debe conservarse.

No todas las reducciones tienen necesariamente el mismo efecto fiscal.

---

# Cashback

Un cashback no debe confundirse automáticamente con un descuento.

Puede modelarse como:

- beneficio posterior;
- crédito;
- pago de tercero;
- saldo promocional;
- refund promocional.

## Regla

Si el cashback ocurre después de completar la venta:

- no recalcula automáticamente la base original;
- conserva operación separada;
- conserva patrocinador;
- conserva política fiscal;
- se concilia separadamente.

---

# Gift cards y saldos

Una gift card puede representar:

- medio de pago;
- pasivo;
- crédito;
- promoción;
- descuento, solo si la política lo define.

## Regla

No se clasifica automáticamente como descuento.

Debe separarse:

- precio;
- beneficio comercial;
- cobertura de pago;
- pasivo;
- impuesto.

---

# Cargos adicionales

Los cargos pueden incluir:

- servicio;
- entrega;
- empaque;
- manejo;
- financiamiento;
- recargo;
- tarifa;
- cargo regulado.

## Orden

Los cargos comerciales autorizados deben incorporarse antes de determinar su tratamiento fiscal.

Cada cargo debe declarar:

- si es gravable;
- si admite descuento;
- si admite cupón;
- si participa en promociones;
- si se redondea;
- si es reembolsable.

---

# Resultado previo al redondeo

Después de impuestos:

```text
pre_rounding_total =
amount_before_tax
+ tax_amount
+ authorized_non_tax_adjustments
```

Debe cumplirse:

```text
pre_rounding_total >= 0
```

---

# Snapshot fiscal

Debe conservar:

- política fiscal;
- versión;
- jurisdicción;
- clasificación por línea;
- tarifas;
- bases;
- exclusiones;
- importes internos;
- importes redondeados;
- nivel de cálculo;
- distribución;
- residuos;
- autoridad;
- fecha.

---

# Invariantes de cupones, descuentos e impuestos

1. Un cupón no se consume dos veces.
2. Una reserva de cupón no equivale a consumo.
3. Un cupón vencido no se aplica.
4. Un descuento manual requiere permiso.
5. Un descuento no modifica el precio base.
6. Un descuento no excede la base elegible.
7. La base imponible es explícita.
8. La tarifa fiscal queda versionada.
9. El impuesto se calcula después de descuentos aplicables.
10. Los impuestos múltiples conservan orden.
11. Los residuos se asignan explícitamente.
12. La suma de impuestos por línea cuadra con el total.
13. Un cashback posterior no reescribe la venta.
14. Una gift card no se trata automáticamente como descuento.
15. El resultado previo al redondeo no puede ser negativo.

---

# Etapa 10 — Redondeo fiscal obligatorio

## Propósito

Aplicar el redondeo exigido por la política fiscal, documental o monetaria antes de cualquier redondeo comercial.

## Autoridad

La regla debe provenir de:

- moneda;
- jurisdicción;
- política fiscal;
- tipo de documento;
- nivel de cálculo;
- fecha efectiva;
- versión.

## Niveles posibles

- por unidad;
- por línea;
- por impuesto;
- por documento;
- por total.

## Regla

La política debe declarar explícitamente el nivel.

No se permite aplicar simultáneamente varios niveles incompatibles sin una regla de reconciliación.

---

# Modos de redondeo fiscal

Modos conceptuales:

- `HALF_UP`;
- `HALF_DOWN`;
- `HALF_EVEN`;
- `FLOOR`;
- `CEILING`;
- `TRUNCATE`;
- `AWAY_FROM_ZERO`;
- regla regulatoria específica.

## Regla

El modo debe estar versionado.

No puede depender de:

- implementación local;
- lenguaje;
- base de datos;
- navegador;
- configuración regional;
- biblioteca predeterminada.

---

# Unidad de redondeo fiscal

Ejemplos:

```text
0.01
0.05
1
10
50
100
```

## Fórmula conceptual

```text
rounded_value =
round_to_unit(
    original_value,
    fiscal_rounding_unit,
    fiscal_rounding_mode
)
```

## Resultado

Debe conservarse:

- valor previo;
- valor posterior;
- diferencia;
- unidad;
- modo;
- política;
- versión.

---

# Diferencia de redondeo fiscal

```text
fiscal_rounding_amount =
fiscal_rounded_total
- pre_fiscal_rounding_total
```

## Reglas

1. La diferencia puede ser positiva o negativa.
2. Debe conservarse explícitamente.
3. No se oculta dentro del impuesto.
4. No se oculta dentro del precio.
5. Debe distribuirse si el documento requiere importes por línea.
6. La suma debe cuadrar con el total fiscal.
7. Una devolución usa la asignación original.

---

# Distribución del redondeo fiscal

Cuando el ajuste debe asignarse a líneas, el algoritmo inicial será:

```text
LARGEST_REMAINDER_THEN_LINE_ID_V1
```

## Elegibilidad

La política debe definir qué líneas pueden recibir residuos.

Puede excluir:

- líneas exentas;
- cargos;
- depósitos;
- líneas no reembolsables;
- importes de terceros.

## Invariante

```text
sum(line_fiscal_rounding_allocations)
=
fiscal_rounding_amount
```

---

# Relación con DEC-006

`DEC-006` cerrará específicamente:

- regla de empate para `NEAREST_50`;
- normalización de fracciones;
- tratamiento de valores exactamente intermedios;
- conciliación con total fiscal;
- comportamiento para importes negativos;
- comportamiento en devoluciones.

## Restricción

Esta decisión fija el orden:

```text
impuestos
→ redondeo fiscal
→ redondeo comercial
```

Pero no sustituye el cierre específico de `DEC-006`.

---

# Etapa 11 — Redondeo comercial permitido

## Propósito

Ajustar el importe cobrable por razones operativas, normalmente asociadas al efectivo.

## Regla principal

El redondeo comercial ocurre después del redondeo fiscal.

No modifica:

- precio base;
- promociones;
- descuentos;
- base imponible;
- impuesto calculado;
- documento fiscal original.

Genera un ajuste comercial explícito.

---

# Aplicabilidad del redondeo comercial

Puede depender de:

- moneda;
- país;
- empresa;
- sucursal;
- canal;
- medio de pago;
- importe;
- política;
- disponibilidad de denominaciones.

## Regla predeterminada

El total comercial base no depende del medio de pago.

Si se permite redondeo exclusivo para efectivo, debe modelarse como ajuste de cobro posterior y explícito.

No se recalcula el precio de la venta.

---

# Redondeo comercial y pagos mixtos

## Problema

Una venta puede pagarse parcialmente en efectivo y parcialmente con otros medios.

## Decisión

El redondeo comercial de efectivo se aplica únicamente al saldo cubierto en efectivo cuando la política lo permita.

No se aplica sobre:

- tarjeta;
- transferencia;
- crédito;
- wallet;
- gift card;
- saldo promocional;
- otros medios exactos.

## Ejemplo

```text
total fiscal:        10.030
tarjeta:              5.000
saldo efectivo:       5.030
redondeo efectivo:      -30
efectivo cobrado:     5.000
```

El ajuste:

- no cambia el total fiscal;
- no cambia la cobertura de tarjeta;
- queda relacionado con el componente en efectivo;
- conserva política y versión.

---

# Redondeo comercial positivo

Ejemplo:

```text
saldo efectivo: 5.020
unidad:              50
resultado:        5.050
ajuste:            +30
```

## Reglas

1. Debe estar permitido.
2. Debe comunicarse al usuario.
3. Debe conservarse explícitamente.
4. No puede ocultarse como precio.
5. Debe participar en caja.
6. Debe quedar auditado.
7. La devolución debe respetar la política original.

---

# Redondeo comercial negativo

Ejemplo:

```text
saldo efectivo: 5.030
unidad:              50
resultado:        5.000
ajuste:            -30
```

## Reglas

1. Debe estar permitido.
2. No puede crear total negativo.
3. No puede exceder el saldo efectivo.
4. Debe quedar separado.
5. No modifica impuestos.
6. Debe participar en caja.
7. Debe quedar auditado.

---

# Prohibiciones de redondeo comercial

No se permite:

- redondear dos veces;
- aplicar antes de impuestos;
- modificar el precio base;
- modificar el impuesto;
- ocultar el ajuste;
- usar una unidad de otra moneda;
- aplicar a medios exactos sin política;
- recalcular ventas históricas;
- depender del frontend;
- resolver diferencias fiscales con redondeo comercial.

---

# Etapa 12 — Cálculo del total exigible final

## Fórmula conceptual

```text
payable_amount =
pre_rounding_total
+ fiscal_rounding_amount
+ commercial_rounding_amount
```

Debe cumplirse:

```text
payable_amount >= 0
```

## Resultado

El total exigible es la obligación comercial final de la venta.

No debe confundirse con:

- importe pagado;
- cobertura confirmada;
- saldo pendiente;
- efectivo recibido;
- cambio;
- refund;
- reversal;
- liquidación;
- conciliación.

---

# Cobertura de pago

La cobertura se calcula separadamente.

```text
confirmed_coverage =
sum(confirmed_payment_components)
```

```text
outstanding_amount =
payable_amount
- confirmed_coverage
```

```text
overpayment_amount =
max(confirmed_coverage - payable_amount, 0)
```

## Regla

El pipeline de pricing termina antes de determinar cobertura.

Los pagos no alteran:

- precio;
- descuentos;
- impuestos;
- redondeo fiscal;
- snapshot comercial.

---

# Cambio en efectivo

Cuando:

```text
cash_received > cash_amount_due
```

```text
change_due =
cash_received - cash_amount_due
```

## Regla

El cambio:

- no es descuento;
- no es redondeo;
- no modifica el total exigible;
- genera salida de caja;
- queda vinculado al pago;
- debe ser exacto según política.

---

# Etapa 13 — Congelación del snapshot

## Momento

El snapshot se congela cuando la venta alcanza el punto comercial autorizado para completarse.

Puede existir antes una previsualización no definitiva.

## Snapshot definitivo

Debe contener:

- venta;
- líneas;
- cantidades;
- productos;
- variantes;
- presentaciones;
- precios base;
- precios promocionales;
- promociones aplicadas;
- promociones excluidas;
- cupones;
- descuentos manuales;
- impuestos;
- bases;
- redondeos;
- total;
- versiones;
- fechas;
- actores;
- algoritmos;
- residuos;
- autoridades;
- correlation ID.

---

# Inmutabilidad del snapshot

Después de completar la venta:

1. no se modifica;
2. no se recalcula;
3. no se sustituye;
4. no se normaliza con reglas nuevas;
5. no se corrige editando importes.

Las correcciones posteriores generan:

- devolución;
- refund;
- reversal;
- nota correctiva;
- ajuste;
- compensación;
- nuevo documento;
- nueva operación comercial.

---

# Identidad del cálculo

Cada cálculo definitivo debe tener:

- `pricing_calculation_id`;
- `sale_id`;
- `pricing_pipeline_version`;
- `calculation_hash`;
- `input_hash`;
- `calculated_at`;
- `calculated_by`;
- `source_node`;
- `correlation_id`.

## Regla

El hash no sustituye la persistencia del snapshot.

Sirve para:

- detectar cambios;
- comparar nodos;
- verificar sincronización;
- auditar reconstrucción;
- detectar manipulación.

---

# Reconstrucción histórica

El sistema debe poder explicar:

1. qué precio se eligió;
2. qué precio promocional aplicó;
3. qué promociones aplicaron;
4. cuáles se excluyeron;
5. qué cupones se consumieron;
6. qué descuentos manuales se aprobaron;
7. qué impuestos se calcularon;
8. qué redondeos se aplicaron;
9. cómo se distribuyeron residuos;
10. cómo se obtuvo el total.

## Regla

La reconstrucción debe usar el snapshot, no consultar reglas actuales.

---

# Previsualización versus cálculo definitivo

## Previsualización

Puede:

- ser temporal;
- cambiar;
- depender de datos locales;
- mostrar advertencias;
- quedar sin firma definitiva.

## Cálculo definitivo

Debe:

- ser validado por autoridad;
- conservar versiones;
- ser idempotente;
- congelar snapshot;
- producir total final;
- quedar auditado.

## Prohibición

Una previsualización no puede presentarse como total definitivo sin validación.

---

# Idempotencia del cálculo

## Clave

Toda solicitud definitiva debe incluir:

- `idempotency_key`;
- venta;
- versión esperada;
- hash de entradas;
- versión de pipeline.

## Regla

```text
misma clave + mismas entradas
→ mismo resultado
```

```text
misma clave + entradas diferentes
→ conflicto
```

## Prohibiciones

No se permite:

- recalcular con otra versión bajo la misma clave;
- modificar líneas después de congelar;
- reutilizar claves entre ventas;
- aceptar resultados parciales como definitivos.

---

# Concurrencia

## Riesgos

- dos cálculos definitivos simultáneos;
- cambio de precio durante cálculo;
- cupón consumido concurrentemente;
- promoción agotada;
- descuento manual aprobado tarde;
- inventario modificado;
- venta recuperada en otro nodo;
- operación offline tardía.

## Reglas

1. El cálculo usa `expected_version`.
2. Las reservas críticas deben verificarse.
3. El consumo de cupón debe ser transaccional.
4. El snapshot y la versión deben confirmarse conjuntamente.
5. Dos snapshots definitivos no pueden coexistir para la misma versión de venta.
6. Los locks no sustituyen idempotencia.
7. Una respuesta tardía debe validar estado actual.
8. Un conflicto genera error explícito.

---

# Operación offline

## Permitido

Puede calcularse offline cuando existe:

- lista de precios sincronizada;
- promociones sincronizadas;
- política fiscal sincronizada;
- política de redondeo sincronizada;
- versión de pipeline soportada;
- moneda válida;
- reloj dentro de tolerancia;
- dispositivo autorizado.

## Restricciones

No se permite offline:

- usar reglas vencidas desconocidas;
- aplicar campañas centrales sin snapshot;
- confirmar cupones sin reserva autorizada;
- consumir límites globales sin política;
- usar una versión no soportada;
- inventar precios;
- inventar impuestos.

---

# Snapshot local de reglas

Debe conservar:

- versión;
- fecha de emisión;
- fecha de vigencia;
- expiración;
- firma;
- autoridad;
- tenant;
- sucursal;
- canal;
- reglas incluidas;
- reglas excluidas;
- estado de sincronización.

## Regla

Una regla local expirada no se aplica silenciosamente.

Puede:

- bloquear;
- degradar;
- requerir aprobación;
- usar fallback autorizado;
- generar incidencia.

---

# Sincronización del cálculo offline

Al recuperar conexión:

1. autenticar dispositivo;
2. validar tenant;
3. validar versión de pipeline;
4. validar snapshot de reglas;
5. validar fecha;
6. validar idempotencia;
7. validar venta;
8. detectar conflictos;
9. conservar cálculo local;
10. aceptar, rechazar o revisar.

## Prohibición

No se reemplaza silenciosamente el cálculo local por otro central.

Si difieren:

- se conservan ambos;
- se compara;
- se clasifica;
- se genera incidencia;
- se define compensación.

---

# Política de discrepancias offline

Tipos:

- precio distinto;
- promoción distinta;
- cupón inválido;
- impuesto distinto;
- redondeo distinto;
- versión no soportada;
- reloj incorrecto;
- regla vencida;
- dato manipulado.

## Resultados posibles

- `ACCEPTED`;
- `ACCEPTED_WITH_WARNING`;
- `REJECTED`;
- `REVIEW_REQUIRED`;
- `COMPENSATION_REQUIRED`.

---

# Devoluciones

## Principio

Una devolución usa el snapshot original.

No recalcula con:

- precios actuales;
- promociones actuales;
- impuestos actuales;
- redondeos actuales;
- moneda actual;
- lista actual.

## Valor elegible

Debe derivarse de:

- línea original;
- cantidad original;
- descuentos asignados;
- impuestos asignados;
- redondeos asignados;
- devoluciones previas;
- refunds previos;
- política de elegibilidad.

---

# Devolución parcial

## Regla

El valor de una devolución parcial debe usar la asignación original por línea y unidad.

Puede requerirse un algoritmo de prorrateo cuando:

- la promoción fue global;
- el cupón fue global;
- el descuento manual fue global;
- el redondeo fue global;
- el impuesto fue global.

## Invariante

La suma acumulada devuelta no supera el importe original elegible.

---

# Devoluciones de promociones por cantidad

Ejemplo:

```text
3x2
```

La política debe definir el valor reembolsable por unidad.

La versión inicial conservará la asignación original generada por:

```text
LOWEST_ELIGIBLE_UNIT_V1
```

## Consecuencia

La unidad marcada como gratuita puede tener valor comercial asignado cero después del descuento.

No se recalcula la promoción con las unidades restantes.

---

# Devolución de combo

Debe conservarse:

- grupo original;
- líneas;
- cantidades;
- descuento distribuido;
- precio neto por línea;
- política de devolución.

## Políticas posibles

- devolución proporcional;
- devolución completa del combo;
- recálculo comercial como nueva operación correctiva;
- rechazo de devolución parcial.

## Regla

La política debe estar congelada en el snapshot.

---

# Devolución y cupones

La política debe definir:

- si el cupón se restituye;
- si se consume definitivamente;
- si se emite otro cupón;
- si el descuento reduce el refund;
- si una devolución parcial afecta elegibilidad futura.

## Regla predeterminada

```text
NO_AUTOMATIC_COUPON_REINSTATEMENT_V1
```

La restitución requiere regla explícita.

---

# Devolución y descuentos manuales

El descuento manual original permanece asignado.

No se elimina del cálculo original.

El valor elegible para devolución se basa en el importe neto original.

## Regla

Un supervisor no puede devolver el precio bruto ignorando el descuento, salvo compensación comercial separada y autorizada.

---

# Devolución e impuestos

La devolución debe usar:

- tarifa original;
- base original;
- asignación original;
- documento original;
- política correctiva aplicable.

## Restricción

No se usa automáticamente la tarifa fiscal vigente al momento de devolver.

Puede requerirse:

- nota crédito;
- documento correctivo;
- ajuste tributario;
- operación especializada.

---

# Devolución y redondeo

Debe conservarse la asignación original de:

- redondeo fiscal;
- redondeo comercial.

## Regla

No se recalcula el redondeo sobre el subconjunto devuelto sin una política correctiva explícita.

---

# Pagos parciales

El pricing se calcula completo antes de distribuir pagos.

## Regla

Una venta parcialmente pagada conserva:

- snapshot completo;
- total exigible;
- cobertura confirmada;
- saldo pendiente.

No se recalculan promociones por cada pago.

---

# Sobrepagos

Un sobrepago no modifica el pipeline.

Debe resolverse mediante:

- cambio;
- refund;
- crédito;
- saldo a favor;
- compensación.

## Regla

No se aplica un descuento retroactivo para ocultar el exceso.

---

# Cancelación antes de completar

Si la venta aún no está completada:

- el snapshot preliminar puede descartarse;
- las reservas se liberan;
- los cupones reservados se liberan;
- no se modifica una venta histórica;
- los pagos confirmados se compensan separadamente.

---

# Cancelación después de completar

El snapshot definitivo permanece.

La corrección se modela mediante:

- devolución;
- refund;
- reversal;
- void;
- documento correctivo;
- compensación.

---

# Auditoría obligatoria

Debe registrarse:

- entradas;
- reglas evaluadas;
- reglas aplicadas;
- reglas excluidas;
- prioridades;
- grupos de exclusión;
- acumulaciones;
- versiones;
- actores;
- aprobadores;
- algoritmos;
- residuos;
- importes;
- redondeos;
- errores;
- conflictos;
- origen;
- dispositivo;
- correlation ID.

---

# Permisos

## Cajero

Puede:

- solicitar cálculo;
- aplicar cupones permitidos;
- solicitar descuento manual dentro de límite;
- consultar explicación.

No puede:

- modificar precio base;
- cambiar tarifa;
- cambiar prioridad;
- alterar redondeo;
- aprobar override crítico;
- editar snapshot definitivo.

## Supervisor

Puede:

- aprobar descuentos;
- aprobar excepciones;
- resolver conflictos comerciales;
- autorizar campañas manuales permitidas;
- revisar auditoría.

## Administrador

Puede:

- configurar políticas;
- publicar versiones;
- aprobar excepciones críticas;
- invalidar reglas futuras;
- gestionar campañas;
- revisar incidencias.

---

# Errores funcionales

- `PRICING_BASE_PRICE_NOT_FOUND`;
- `PRICING_MULTIPLE_BASE_PRICES`;
- `PRICING_PROMOTION_CONFLICT`;
- `PRICING_COUPON_INVALID`;
- `PRICING_COUPON_EXPIRED`;
- `PRICING_COUPON_ALREADY_USED`;
- `PRICING_MANUAL_DISCOUNT_NOT_ALLOWED`;
- `PRICING_MANUAL_DISCOUNT_LIMIT_EXCEEDED`;
- `PRICING_TAX_POLICY_NOT_FOUND`;
- `PRICING_ROUNDING_POLICY_NOT_FOUND`;
- `PRICING_NEGATIVE_TOTAL`;
- `PRICING_VERSION_CONFLICT`;
- `PRICING_IDEMPOTENCY_CONFLICT`;
- `PRICING_OFFLINE_RULES_EXPIRED`;
- `PRICING_OFFLINE_CONFLICT`;
- `PRICING_REVIEW_REQUIRED`;
- `PRICING_SNAPSHOT_ALREADY_FROZEN`;
- `PRICING_PIPELINE_VERSION_UNSUPPORTED`.

---

# Invariantes de redondeo, snapshot y devolución

1. El redondeo fiscal ocurre antes del comercial.
2. Cada redondeo se aplica una sola vez.
3. El redondeo comercial no modifica impuestos.
4. El total exigible no depende del medio de pago.
5. La cobertura se calcula después del pricing.
6. Un snapshot definitivo es inmutable.
7. Una venta histórica no se recalcula.
8. La devolución usa el snapshot original.
9. Una devolución parcial no supera elegibilidad.
10. Un cupón no se restituye automáticamente.
11. Un sobrepago no modifica el precio.
12. Un pago parcial no recalcula promociones.
13. Una operación offline conserva versión.
14. Una discrepancia offline no se oculta.
15. Toda corrección posterior es una operación nueva.

---

# Ejemplos numéricos

## Ejemplo 1 — Precio base sin promociones

```text
Cantidad: 2
Precio base unitario: 10.000
Promociones: 0
Cupones: 0
Descuentos manuales: 0
Impuestos: 19 %
```

Cálculo:

```text
importe bruto:       20.000
base imponible:      20.000
impuesto:             3.800
total previo:        23.800
redondeo fiscal:          0
redondeo comercial:       0
total exigible:      23.800
```

## Ejemplo 2 — Precio promocional

```text
Precio base unitario:        10.000
Precio promocional unitario:  8.000
Cantidad: 2
```

Resultado:

```text
importe base:                    20.000
ajuste por precio promocional:   -4.000
importe comercial:               16.000
```

El precio base permanece en el snapshot.

## Ejemplo 3 — Promoción 3x2

```text
Cantidad: 3
Precio unitario efectivo: 10.000
```

Resultado:

```text
importe bruto:          30.000
descuento promocional:  10.000
importe neto:           20.000
```

La unidad beneficiada conserva identidad y consume inventario.

## Ejemplo 4 — Promoción global del 10 %

```text
Línea A neta elegible: 60.000
Línea B neta elegible: 40.000
Descuento global:      10.000
```

Distribución:

```text
Línea A: 6.000
Línea B: 4.000
```

## Ejemplo 5 — Cupón fijo

```text
Importe antes de cupón: 50.000
Cupón fijo:              8.000
```

Resultado:

```text
importe después de cupón: 42.000
```

## Ejemplo 6 — Cupón superior a la base

```text
Base elegible: 20.000
Cupón:         30.000
```

Resultado:

```text
beneficio aplicado:    20.000
beneficio no aplicado: 10.000
total:                      0
```

No se produce total negativo.

## Ejemplo 7 — Descuento manual

```text
Importe después de cupón: 100.000
Descuento manual:          15.000
```

Resultado:

```text
importe antes de impuestos: 85.000
```

Debe existir permiso y motivo.

## Ejemplo 8 — Impuesto agregado

```text
Base imponible: 100.000
Tarifa: 19 %
```

Resultado:

```text
impuesto:       19.000
total previo:  119.000
```

## Ejemplo 9 — Impuesto incluido

```text
Importe con impuesto incluido: 119.000
Tarifa: 19 %
```

Resultado:

```text
base imponible: 100.000
impuesto:        19.000
```

## Ejemplo 10 — Redondeo fiscal

```text
Total previo: 10.024
Unidad fiscal: 1
Modo: HALF_UP
```

Resultado:

```text
total fiscal: 10.024
```

Si la unidad fuera 50:

```text
total fiscal redondeado: 10.000
ajuste fiscal:              -24
```

La regla exacta de empate queda condicionada por `DEC-006`.

## Ejemplo 11 — Redondeo comercial en efectivo

```text
Total fiscal: 10.030
Unidad comercial: 50
Modo: permitido para efectivo
```

Resultado:

```text
total cobrable en efectivo: 10.000
ajuste comercial:              -30
```

El total fiscal permanece 10.030.

## Ejemplo 12 — Pago mixto

```text
Total exigible: 100.000
Tarjeta:         60.000
Saldo efectivo:  40.000
```

No se recalcula el pricing.

Solo se distribuye cobertura.

## Ejemplo 13 — Pago mixto con redondeo en efectivo

```text
Total fiscal: 100.030
Tarjeta:       60.000
Saldo efectivo:40.030
Redondeo efectivo: -30
```

Resultado:

```text
tarjeta:          60.000
efectivo cobrado: 40.000
ajuste comercial:    -30
```

## Ejemplo 14 — Devolución parcial con descuento global

Venta original:

```text
Línea A: 60.000
Línea B: 40.000
Descuento global: 10.000
```

Asignación original:

```text
Línea A: 6.000
Línea B: 4.000
```

Al devolver la línea B:

```text
valor comercial elegible:
40.000 - 4.000 = 36.000
```

No se recalcula el descuento global sobre la línea restante.

## Ejemplo 15 — Devolución de unidad gratuita

Promoción original:

```text
3x2
```

Distribución:

```text
Unidad 1: 10.000
Unidad 2: 10.000
Unidad 3:      0
```

Si se devuelve la unidad beneficiada:

```text
valor comercial elegible: 0
```

Cualquier compensación adicional debe modelarse como operación separada.

---

# Escenarios de aceptación

## Escenario 1 — Precio base único

Resultado:

- se selecciona una lista determinista;
- se conserva versión;
- se registra fuente;
- no se acepta el precio del frontend como autoridad.

## Escenario 2 — Dos precios base aplicables

Resultado:

- se aplica prioridad versionada;
- si no puede resolverse, se genera error;
- no se elige por orden de consulta.

## Escenario 3 — Dos promociones incompatibles

Resultado:

- se agrupan;
- se comparan prioridades;
- se aplica la regla autorizada;
- se registran aplicadas y excluidas.

## Escenario 4 — Promociones acumulables

Resultado:

- se aplican en orden explícito;
- ninguna excede la base elegible;
- el snapshot conserva cada etapa.

## Escenario 5 — Cupón duplicado

Resultado:

- la segunda solicitud no consume otra unidad;
- se devuelve el resultado existente o conflicto;
- queda auditado.

## Escenario 6 — Descuento manual sin permiso

Resultado:

- se rechaza;
- no se altera el precio;
- se registra intento.

## Escenario 7 — Descuento manual sobre límite

Resultado:

- requiere aprobación;
- no se divide para evadir límite;
- se conserva solicitante y aprobador.

## Escenario 8 — Impuesto incluido

Resultado:

- se separa base e impuesto;
- se conserva tarifa;
- la suma reconstruye el importe original.

## Escenario 9 — Impuesto múltiple

Resultado:

- se aplica orden declarado;
- cada impuesto conserva base;
- no se asume una base común.

## Escenario 10 — Redondeo fiscal

Resultado:

- se aplica una sola vez;
- se conserva diferencia;
- se distribuye residuo;
- la suma cuadra con el total fiscal.

## Escenario 11 — Redondeo comercial

Resultado:

- ocurre después del fiscal;
- no modifica impuestos;
- se limita al medio permitido;
- queda explícito.

## Escenario 12 — Venta offline con reglas vigentes

Resultado:

- se usa snapshot local autorizado;
- se conserva versión;
- se sincroniza de forma idempotente.

## Escenario 13 — Venta offline con reglas vencidas

Resultado:

- se bloquea, degrada o revisa según política;
- no se aplica silenciosamente una regla vencida.

## Escenario 14 — Discrepancia central y local

Resultado:

- se conservan ambos cálculos;
- no se sobrescribe;
- se genera incidencia;
- se determina aceptación o compensación.

## Escenario 15 — Devolución parcial

Resultado:

- usa asignación original;
- no recalcula promociones;
- no excede elegibilidad.

## Escenario 16 — Sobrepago

Resultado:

- el total no cambia;
- el exceso se resuelve separadamente;
- no se crea descuento retroactivo.

## Escenario 17 — Reintento idempotente

Resultado:

- misma clave y entradas devuelve mismo resultado;
- entradas distintas producen conflicto.

## Escenario 18 — Conflicto de versión

Resultado:

- el cálculo se rechaza;
- no se congela snapshot;
- se recupera estado actual.

---

# Pruebas mínimas

## Unitarias

1. Selección de precio base.
2. Resolución de prioridad.
3. Selección de precio promocional.
4. Promoción por línea.
5. Promoción por grupo.
6. Promoción global.
7. Resolución de incompatibilidades.
8. Distribución proporcional.
9. Asignación de residuos.
10. Validación de cupón.
11. Consumo de cupón.
12. Liberación de cupón.
13. Descuento manual.
14. Límite de descuento.
15. Base imponible.
16. Impuesto incluido.
17. Impuesto agregado.
18. Impuestos múltiples.
19. Redondeo fiscal.
20. Redondeo comercial.
21. Total exigible.
22. Pago mixto.
23. Devolución parcial.
24. Devolución de promoción por cantidad.
25. Snapshot.
26. Hash.
27. Idempotencia.
28. Conflicto de versión.

## Integración

1. Pricing completo de venta.
2. Venta con promociones múltiples.
3. Venta con cupón.
4. Venta con descuento manual.
5. Venta con impuestos.
6. Venta con redondeo fiscal.
7. Venta con redondeo comercial.
8. Venta con pago mixto.
9. Venta offline.
10. Sincronización offline.
11. Devolución parcial.
12. Refund.
13. Reversal.
14. Auditoría.
15. Multi-tenant.
16. Outbox.
17. Explicación del cálculo.
18. Reconstrucción histórica.

## Concurrencia

1. Dos cálculos definitivos.
2. Dos consumos de cupón.
3. Cambio de precio concurrente.
4. Cambio de promoción concurrente.
5. Aprobación tardía.
6. Venta recuperada en otro nodo.
7. Sincronización tardía.
8. Reintento después de timeout.
9. Snapshot congelado concurrentemente.
10. Conflicto de versión.

## Seguridad

1. Precio manipulado desde frontend.
2. Cupón de otro tenant.
3. Descuento sin permiso.
4. Tarifa manipulada.
5. Redondeo manipulado.
6. Versión no soportada.
7. Snapshot modificado.
8. Hash inconsistente.
9. Actor sin permiso.
10. Acceso entre tenants.

---

# Criterios de aceptación

`DEC-003` se considera cerrada cuando:

1. existe una canalización única;
2. la canalización está versionada;
3. está definido el precio base;
4. está definido el precio promocional;
5. están definidas promociones por línea;
6. están definidas promociones por grupo;
7. están definidas promociones globales;
8. están definidas reglas de acumulación;
9. están definidos grupos de exclusión;
10. está definida resolución de incompatibilidades;
11. están definidos cupones;
12. está definido consumo y liberación de cupones;
13. están definidos descuentos manuales;
14. están definidos límites y aprobaciones;
15. está definida la base imponible;
16. están definidos impuestos incluidos;
17. están definidos impuestos agregados;
18. están definidos impuestos múltiples;
19. está definido el orden fiscal;
20. está definido el redondeo fiscal;
21. está definido el redondeo comercial;
22. está definida la relación con `DEC-006`;
23. está definido el total exigible;
24. está separada la cobertura de pago;
25. está definido el snapshot;
26. está definida la reconstrucción histórica;
27. está definida idempotencia;
28. está definida concurrencia;
29. está definida operación offline;
30. están definidas discrepancias offline;
31. están definidas devoluciones;
32. están definidos ejemplos;
33. están definidas pruebas;
34. existe coherencia con `DEC-002`;
35. existe coherencia con `SALES-002`;
36. existe coherencia con `CASH-003`;
37. no se autoriza todavía diseño físico;
38. el backlog incluye evidencia verificable.

---

# Consecuencias para PRICE-002

`PRICE-002` deberá implementar o documentar:

- listas de precios;
- prioridades;
- vigencias;
- versiones;
- precios promocionales;
- reglas de selección;
- errores;
- snapshots;
- pruebas de determinismo.

No podrá cambiar el orden definido por `PRICING_PIPELINE_V1`.

---

# Consecuencias para SALES-003

`SALES-003` deberá:

- invocar la canalización;
- congelar snapshot;
- separar pricing de cobertura;
- conservar versiones;
- impedir totales arbitrarios;
- publicar eventos;
- integrar inventario;
- integrar pagos;
- integrar caja;
- soportar recuperación.

---

# Consecuencias para TAX-003

`TAX-003` deberá cerrar:

- regla `NEAREST_50`;
- empates;
- fracciones;
- importes negativos;
- devoluciones;
- conciliación fiscal.

Debe respetar el orden:

```text
impuestos
→ redondeo fiscal
→ redondeo comercial
```

---

# Consecuencias para TECH-002

El diseño físico deberá contemplar, sin definirse todavía aquí:

- snapshots;
- versiones;
- líneas;
- reglas aplicadas;
- reglas excluidas;
- asignaciones;
- residuos;
- cupones;
- descuentos;
- impuestos;
- redondeos;
- hashes;
- idempotencia;
- auditoría;
- multiempresa;
- local-first.

---

# Consecuencias para TECH-003

Los contratos API deberán distinguir:

- previsualización;
- cálculo definitivo;
- expected version;
- idempotency key;
- versión de pipeline;
- hash de entradas;
- errores;
- conflictos;
- resultados de revisión;
- explicación del cálculo.

No debe existir un endpoint que acepte un total final arbitrario.

---

# Riesgos residuales

1. `DEC-006` todavía no define empates de redondeo.
2. La política fiscal definitiva puede exigir variantes.
3. La separación catálogo/presentación de `DEC-004` puede modificar claves de selección.
4. `DEC-007` puede afectar autoridad offline.
5. La implementación física aún no está diseñada.
6. La regulación puede requerir documentos especializados.
7. Las promociones complejas pueden necesitar un motor formal.
8. El rendimiento debe medirse con catálogos reales.

---

# Decisiones no cerradas por este documento

Este documento no cierra:

- `DEC-004`;
- `DEC-005`;
- `DEC-006`;
- `DEC-007`;
- `DEC-008`;
- diseño físico;
- contratos API definitivos;
- motor de reglas;
- integración fiscal nacional definitiva.

---

# Restricciones arquitectónicas

Este documento no autoriza todavía:

- tablas definitivas;
- migraciones;
- índices;
- triggers;
- endpoints;
- implementación de promociones;
- implementación fiscal;
- implementación contable;
- cierre del modelo físico.

Todo diseño posterior deberá respetar:

- `PRICING_PIPELINE_V1`;
- snapshots inmutables;
- decimal exacto;
- versionado;
- idempotencia;
- auditoría;
- determinismo;
- multiempresa;
- local-first;
- reconstrucción histórica.

---

# Estado del documento

Estado: `DONE`

Puede pasar a `DONE` cuando:

- se valide estructura;
- se validen cercas Markdown;
- se revisen encabezados;
- se confirme coherencia con ventas;
- se confirme coherencia con pagos;
- se confirme coherencia con caja;
- se confirme coherencia con impuestos;
- no existan contradicciones críticas;
- el backlog adjunte esta evidencia;
- `DEC-003` se mueva a decisiones cerradas.

# UC-PROMO-002: Evaluar y aplicar promociones

## Objetivo

Determinar las promociones aplicables a una venta, resolver conflictos y calcular beneficios de forma determinista, explicable e idempotente.

## Actor principal

Sistema POS, aplicación de pedidos o servicio comercial autorizado.

## Precondiciones

- Precios base resueltos.
- Carrito válido.
- Empresa, sucursal y canal conocidos.
- Reglas de promoción sincronizadas y versionadas.
- Fecha y hora de evaluación conocidas.

## Entrada

- tenant_id derivado;
- company_id derivado;
- branch_id;
- sales_channel;
- customer_id opcional;
- customer_group_ids opcionales;
- items;
- resolved_prices;
- quantities;
- payment_method opcional;
- occurred_at;
- promotion_configuration_version;
- correlation_id.

## Salida

- eligible_promotions;
- applied_promotions;
- rejected_promotions opcionales;
- line_benefits;
- order_benefits;
- gross_total;
- promotional_discount_total;
- resulting_total;
- explanation;
- configuration_version.

## Flujo principal

1. El sistema valida tenant, empresa, sucursal y canal.
2. Obtiene promociones vigentes.
3. Descarta reglas:
   - futuras;
   - vencidas;
   - inactivas;
   - de otra sucursal;
   - de otro canal;
   - incompatibles con el cliente;
   - incompatibles con productos o cantidades.
4. Evalúa elegibilidad sin modificar el carrito.
5. Calcula beneficios candidatos.
6. Agrupa promociones incompatibles.
7. Aplica la política de combinación:
   - EXCLUSIVE;
   - STACKABLE;
   - BEST_PRICE;
   - PRIORITY_ORDER.
8. Calcula el resultado final.
9. Verifica que ningún ítem ni total quede negativo.
10. Produce una explicación detallada.
11. Devuelve beneficios y reglas aplicadas.
12. El consumidor congela el resultado en la venta.
13. Al confirmar la venta, registra consumo de promociones de forma idempotente.

## Orden conceptual

1. Resolver precios base.
2. Evaluar promociones de precio fijo.
3. Evaluar promociones por producto o cantidad.
4. Evaluar combos.
5. Evaluar promociones por subtotal o total.
6. Resolver compatibilidad.
7. Aplicar descuentos manuales autorizados.
8. Calcular impuestos según la base aplicable.

El orden definitivo debe estar versionado y cubierto por pruebas.

## Aplicación por línea

Cada beneficio debe conservar:

- promotion_id;
- promotion_version;
- item_id;
- original_amount;
- benefit_amount;
- resulting_amount;
- reason.

## Aplicación al total

Debe conservar:

- subtotal elegible;
- condición satisfecha;
- importe del beneficio;
- límite aplicado;
- regla responsable.

## Reglas de cantidad

Para promociones como `BUY_X_PAY_Y`:

- se agrupan únicamente artículos elegibles;
- se respeta presentación y variante cuando la regla lo exija;
- se aplican tantas veces como permita la cantidad;
- los sobrantes se cobran a precio normal;
- el algoritmo debe ser determinista.

## Mejor precio

En `BEST_PRICE`, el sistema debe comparar combinaciones permitidas y elegir el menor total válido.

No debe:

- aplicar todas las promociones indiscriminadamente;
- escoger de forma arbitraria;
- depender del orden accidental de consulta en base de datos.

## Promociones acumulables

Una regla `STACKABLE` solo se combina con otra cuando ambas lo permiten.

La compatibilidad debe evaluarse en ambos sentidos.

## Cambio del carrito

Las promociones deben reevaluarse cuando cambie:

- cantidad;
- producto;
- cliente;
- canal;
- sucursal;
- método de pago relevante;
- fecha u horario;
- precio base.

El sistema debe informar si una promoción deja de aplicar.

## Operación offline

El POS utilizará:

- reglas previamente sincronizadas;
- versión de configuración;
- fecha local controlada;
- validaciones de vigencia;
- registro de la versión aplicada.

Si la configuración está vencida o ausente, no debe inventar una promoción.

## Límites de uso

Al confirmar la venta:

1. Se valida nuevamente el límite.
2. Se consume de forma transaccional.
3. Una solicitud repetida no consume dos veces.
4. Si el límite se agotó, la venta debe reevaluarse o requerir autorización según política.

## Explicabilidad

El sistema debe poder mostrar:

- promoción aplicada;
- condición satisfecha;
- productos beneficiados;
- beneficio obtenido;
- promociones rechazadas por incompatibilidad;
- motivo de desempate.

## Reglas

1. La promoción no modifica el precio maestro.
2. El cálculo debe ser determinista.
3. La aplicación debe ser idempotente.
4. El beneficio no puede producir valores negativos.
5. El cajero no puede alterar manualmente una promoción automática.
6. Los descuentos manuales se registran por separado.
7. Las ventas históricas conservan snapshots.
8. La configuración de otra empresa nunca puede aplicarse.
9. El motor debe poder reconstruir el cálculo.
10. Los impuestos se calculan después de beneficios conforme a la política fiscal aplicable.

## Excepciones

- configuración ambigua;
- regla inválida;
- límite agotado;
- información offline vencida;
- carrito incompatible;
- conflicto de versión;
- error de cálculo;
- solicitud repetida.

## Postcondiciones

- Existe un conjunto único y explicable de promociones aplicadas.
- El carrito conserva precios base y beneficios por separado.
- La venta puede almacenar snapshots completos.

## Eventos

Durante evaluación ordinaria no es obligatorio persistir un evento.

Al confirmar pueden emitirse:

- `PromotionApplied`;
- `PromotionUsageConsumed`;
- `PromotionLimitReached`;
- `PromotionEvaluationFailed`.

## Pruebas mínimas

- porcentaje;
- valor fijo;
- 2x1;
- lleve 3 pague 2;
- segunda unidad;
- combo;
- compra mínima;
- dos promociones exclusivas;
- promociones acumulables;
- mejor precio;
- prioridad;
- cambio de cantidad;
- cambio de cliente;
- límite agotado;
- doble confirmación;
- venta offline;
- regla vencida;
- total no negativo;
- aislamiento entre tenants.

# UC-PRICE-002: Resolver precio aplicable a una venta

## Objetivo

Determinar de forma determinista, explicable y auditable el precio comercial inicial aplicable a un artículo dentro de un contexto de venta.

Este caso de uso resuelve las etapas de precio base versionado y precio promocional elegible que alimentan `PRICING_PIPELINE_V1`.

No ejecuta ni reordena promociones posteriores, cupones, descuentos manuales, impuestos o redondeos.
## Actor principal

Sistema POS, aplicación de pedidos o servicio comercial autorizado.

## Precondiciones

- Producto o presentación activa.
- Empresa y sucursal válidas.
- Canal reconocido.
- Fecha y hora de cálculo conocidas.
- Configuración de precios vigente.

## Entrada

- tenant_id derivado;
- company_id derivado;
- branch_id;
- product_id;
- variant_id opcional;
- presentation_id opcional;
- quantity;
- base_unit;
- sales_channel;
- customer_id opcional;
- customer_group_ids opcionales;
- occurred_at;
- currency;
- pricing_policy_version;
- correlation_id.

## Salida

- base_price;
- base_price_rule_id;
- base_price_list_id;
- promotional_price opcional;
- promotional_price_rule_id opcional;
- promotional_price_list_id opcional;
- effective_initial_unit_price;
- selected_price_kind;
- currency;
- resolution_reason;
- priority;
- valid_from;
- valid_until;
- pricing_policy_version;
- pricing_pipeline_version;
- resolved_at;
- comparison_candidates opcional;
- resolution_snapshot.

Valores conceptuales de `selected_price_kind`:

- `BASE`;
- `PROMOTIONAL`.

`pricing_pipeline_version` debe ser `PRICING_PIPELINE_V1` para esta versión del contrato.

`resolution_snapshot` conserva el precio base, el precio promocional cuando exista, reglas seleccionadas, vigencias, prioridades, contexto y versiones utilizadas.

El snapshot de resolución de precio no sustituye el snapshot comercial definitivo de la venta.
## Flujo principal

1. El sistema valida el contexto derivado de tenant, empresa y sucursal.
2. Normaliza cantidad, unidad y presentación.
3. Resuelve las listas de precios aplicables al contexto.
4. Obtiene reglas versionadas vigentes para el artículo.
5. Descarta reglas:
   - vencidas;
   - futuras;
   - pertenecientes a otro tenant o empresa;
   - pertenecientes a otra sucursal cuando el alcance no corresponda;
   - pertenecientes a otro canal;
   - pertenecientes a otro cliente o grupo;
   - fuera del rango de cantidad;
   - expresadas en otra moneda incompatible.
6. Ordena las candidatas mediante especificidad, prioridad y reglas deterministas de selección.
7. Detecta ambigüedades antes de seleccionar.
8. Selecciona exactamente un precio base versionado.
9. Conserva identidad, valor, lista, vigencia y versión del precio base.
10. Evalúa precios promocionales fijos elegibles únicamente en la etapa permitida por `PRICING_PIPELINE_V1`.
11. Si existe un precio promocional válido, selecciona uno mediante reglas deterministas sin perder el precio base original.
12. Calcula `effective_initial_unit_price` usando el precio promocional o, en su ausencia, el precio base.
13. Produce una explicación trazable de la resolución.
14. Construye `resolution_snapshot`.
15. Devuelve `pricing_policy_version` y `pricing_pipeline_version`.
16. Entrega el resultado como entrada de las etapas posteriores de `PRICING_PIPELINE_V1`.
## Relación con `PRICING_PIPELINE_V1`

Este caso de uso participa únicamente en las primeras etapas del pipeline normativo.

Orden normativo completo:

1. captura del precio base versionado;
2. selección de precio promocional elegible;
3. promociones automáticas por línea;
4. promociones por grupo;
5. promociones globales;
6. cupones;
7. descuentos manuales autorizados;
8. determinación de base imponible;
9. cálculo de impuestos;
10. redondeo fiscal obligatorio;
11. redondeo comercial permitido;
12. determinación del total exigible;
13. congelación del snapshot comercial definitivo.

`UC-PRICE-002` resuelve exclusivamente las etapas 1 y 2.

No puede adelantar, omitir, duplicar ni reordenar las etapas posteriores.

Las promociones distintas de un precio promocional fijo se procesan después.

Los impuestos se calculan después de promociones, cupones y descuentos conforme a `DEC-003`.

El redondeo fiscal y comercial se aplica después del cálculo de impuestos conforme a `DEC-003` y `DEC-006`.

La cobertura mediante pagos no forma parte de la resolución de precio.

## Especificidad inicial

Una regla más específica puede prevalecer sobre una general cuando la configuración lo indique.

Dimensiones posibles:

- cliente;
- grupo de cliente;
- sucursal;
- canal;
- presentación;
- variante;
- rango de cantidad;
- lista de precios.

## Ejemplo no normativo de prioridad

La siguiente lista solo ilustra una composición posible. No define precedencia automática, no autoriza herencia Branch/Company/Tenant/Platform y no reemplaza scope, prioridad, vigencia, versión de política, elegibilidad ni desempate explícitos de cada regla:

1. Contrato o precio específico de cliente.
2. Grupo de cliente.
3. Rango de cantidad.
4. Canal.
5. Sucursal.
6. Lista predeterminada.
7. Precio base.

Las promociones se evalúan después de resolver el precio comercial base, salvo reglas expresamente definidas como precio promocional fijo.

## Regla de desempate

No se elegirá silenciosamente una regla arbitraria.

Si dos reglas tienen:

- misma especificidad;
- misma prioridad;
- vigencia compatible;
- mismo contexto;

la configuración es ambigua y debe producir error administrativo.

No se desempata por timestamp, orden de inserción, orden de llegada ni last-write-wins.

## Congelación del precio

Cuando el artículo entra al carrito, el sistema debe conservar:

- importe;
- regla seleccionada;
- lista;
- versión;
- fecha de resolución;
- contexto;
- explicación.

## Cambio de precio durante una venta

Si el precio cambia después de agregar el artículo:

### Política predeterminada

Se conserva el precio congelado durante un periodo configurable o hasta confirmar la venta.

### Revalidación obligatoria

Puede exigirse cuando:

- expira la vigencia;
- cambia la cantidad y cruza un rango;
- cambia el cliente;
- cambia el canal;
- cambia la presentación;
- el supervisor solicita actualización.

El sistema debe informar al cajero; no debe cambiar silenciosamente el total.

## Sin precio disponible

El artículo no puede venderse automáticamente.

Opciones autorizadas:

- seleccionar otra lista;
- solicitar precio a supervisor;
- registrar precio excepcional con permiso y auditoría;
- impedir la venta.

## Precio excepcional

Debe registrar:

- usuario solicitante;
- aprobador;
- importe original;
- importe excepcional;
- motivo;
- vigencia limitada a la operación;
- auditoría.

No modifica la lista maestra.

## Reglas

1. La resolución debe ser determinista.
2. La salida debe ser explicable y reproducible con las mismas entradas y versiones.
3. El precio no puede obtenerse de otro tenant o empresa.
4. La interfaz no puede sustituir la autorización backend.
5. El precio base debe conservarse incluso cuando exista precio promocional.
6. Un precio promocional no modifica destructivamente el precio base.
7. Listas, reglas, prioridades, vigencias y versiones deben ser trazables.
8. Una ambigüedad nunca se resuelve mediante orden accidental de registros.
9. El cálculo monetario utiliza decimal exacto.
10. Floating point binario no constituye autoridad monetaria.
11. `UC-PRICE-002` no puede modificar `PRICING_PIPELINE_V1`.
12. Este caso no aplica promociones posteriores, cupones, descuentos manuales, impuestos ni redondeos.
13. El resultado contiene `resolution_snapshot`.
14. El snapshot no depende de configuración futura para interpretarse.
15. La caché no puede devolver reglas vencidas o incompatibles.
16. La operación offline solo usa datos previamente sincronizados y versionados.
17. Una configuración local desactualizada no puede inventar precios.
18. Mismos datos, contexto y versiones producen el mismo resultado.
19. Los errores utilizan códigos estables y auditables.
20. Un precio excepcional requiere autorización y auditoría y no modifica listas maestras.
## Postcondiciones

- Existe un único precio aplicable o un error explícito.
- El resultado puede congelarse en la operación.
- La regla seleccionada es trazable.

## Eventos

La resolución ordinaria no requiere necesariamente un evento de dominio persistente.

Pueden emitirse:

- `PriceResolutionFailed`;
- `PriceAmbiguityDetected`;
- `ExceptionalPriceAuthorized`.

## Pruebas mínimas

### Selección

- precio base;
- lista predeterminada;
- sucursal;
- canal;
- cliente;
- grupo de cliente;
- volumen;
- presentación;
- precio promocional elegible;
- precio promocional vencido;
- vigencia futura;
- regla vencida;
- dos reglas ambiguas;
- sin precio;
- precio excepcional.

### Determinismo

- mismas entradas y versiones producen el mismo resultado;
- distinto orden físico de candidatos produce el mismo resultado;
- empate no resuelto produce error explícito;
- cambio de prioridad versionada produce el resultado correspondiente;
- precio promocional no elimina precio base del snapshot.

### Pipeline

- resultado declara `PRICING_PIPELINE_V1`;
- no aplica promociones posteriores;
- no aplica cupones;
- no aplica descuentos manuales;
- no calcula impuestos;
- no aplica redondeo fiscal;
- no aplica redondeo comercial;
- puede alimentar la etapa posterior sin alterar el orden normativo.

### Consistencia y seguridad

- aislamiento entre tenants;
- aislamiento entre empresas;
- cambio durante carrito;
- venta offline;
- caché desactualizada;
- configuración incompatible;
- decimal exacto;
- rechazo de precio negativo;
- autorización backend para precio excepcional;
- snapshot reproducible.

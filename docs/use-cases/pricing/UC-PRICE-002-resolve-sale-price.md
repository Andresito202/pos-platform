# UC-PRICE-002: Resolver precio aplicable a una venta

## Objetivo

Determinar de forma determinista, explicable y auditable el precio aplicable a un artículo dentro de un contexto de venta.

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
- pricing_configuration_version;
- correlation_id.

## Salida

- resolved_price;
- currency;
- price_rule_id;
- price_list_id;
- resolution_reason;
- priority;
- valid_from;
- valid_until;
- comparison_candidates opcional;
- configuration_version.

## Flujo principal

1. El sistema valida el contexto del tenant y empresa.
2. Normaliza cantidad y presentación.
3. Obtiene reglas vigentes para el artículo.
4. Descarta reglas:
   - vencidas;
   - futuras;
   - de otra sucursal;
   - de otro canal;
   - de otro cliente o grupo;
   - fuera del rango de cantidad;
   - en otra moneda.
5. Ordena las candidatas según especificidad y prioridad configurada.
6. Detecta ambigüedades.
7. Selecciona una única regla.
8. Produce una explicación de resolución.
9. Devuelve el precio y la versión de configuración.
10. El consumidor congela el resultado en el carrito o venta según la política.

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

## Prioridad inicial recomendada

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
2. La salida debe ser explicable.
3. El precio no puede obtenerse de otra empresa.
4. La interfaz no puede sustituir la autorización backend.
5. El precio aplicado se conserva como snapshot.
6. La caché no puede devolver reglas vencidas.
7. La operación debe ser compatible con modo offline usando datos previamente sincronizados y versionados.
8. Una configuración desactualizada debe marcarse para sincronización, no inventar precios.

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

- precio base;
- sucursal;
- canal;
- cliente;
- grupo;
- volumen;
- presentación;
- vigencia futura;
- regla vencida;
- dos reglas ambiguas;
- sin precio;
- cambio durante carrito;
- venta offline;
- caché desactualizada;
- precio excepcional;
- aislamiento entre tenants.

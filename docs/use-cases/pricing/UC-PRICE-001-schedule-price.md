# UC-PRICE-001: Programar precio de venta

## Objetivo

Crear una regla de precio con alcance, prioridad y vigencia explícitos, sin sobrescribir el historial anterior.

## Actor principal

Propietario, administrador general, gerente de sucursal o usuario autorizado de precios.

## Precondiciones

- Usuario autenticado.
- Empresa activa.
- Producto, variante o presentación válidos.
- Moneda configurada.
- Permiso `pricing.price.manage`.
- Lista de precios activa.

## Entrada

- company_id derivado del contexto;
- product_id;
- variant_id opcional;
- presentation_id opcional;
- price_list_id;
- branch_id opcional;
- sales_channel opcional;
- customer_id opcional;
- customer_group_id opcional;
- minimum_quantity opcional;
- maximum_quantity opcional;
- amount;
- currency;
- priority;
- valid_from;
- valid_until opcional;
- reason;
- expected_pricing_policy_version;
- idempotency_key.

## Alcances admitidos

El precio puede aplicar a:

- toda la empresa;
- una sucursal;
- un canal;
- un cliente específico;
- un grupo de clientes;
- una presentación;
- una variante;
- un rango de cantidades;
- una combinación válida de los anteriores.

## Flujo principal

1. El usuario selecciona el artículo y alcance.
2. El sistema deriva tenant y empresa desde la sesión.
3. Valida producto, variante, presentación y lista.
4. Valida moneda, importe, fechas y cantidades.
5. Normaliza el intervalo de vigencia.
6. Busca reglas activas o programadas con alcance equivalente.
7. Detecta conflictos de prioridad y solapamiento.
8. Muestra el impacto estimado cuando corresponda.
9. El usuario confirma el cambio.
10. El sistema crea una nueva versión de precio.
11. No modifica ventas ni precios históricos.
12. Registra responsable, motivo y valores.
13. Emite `PriceScheduled`.
14. Cuando inicia la vigencia, emite `PriceActivated`.

## Validaciones

- `amount` no puede ser negativo.
- Un precio cero exige permiso o tipo compatible.
- `valid_until` debe ser posterior a `valid_from`.
- Las cantidades mínimas y máximas deben ser coherentes.
- La moneda debe coincidir con la lista.
- No puede existir una regla equivalente con igual prioridad y vigencia solapada.
- El producto debe pertenecer a la empresa.
- La sucursal debe pertenecer a la empresa.
- La presentación debe pertenecer al producto o variante.
- El canal debe ser reconocido.
- El precio no puede modificar costos históricos.

## Conflicto de vigencia

Cuando exista una regla equivalente:

### Reemplazo futuro

La nueva regla puede iniciar cuando termine la actual.

### Cierre controlado

El usuario autorizado puede terminar anticipadamente la vigencia actual y programar la nueva.

### Conflicto inválido

Si dos reglas equivalentes quedan activas simultáneamente con la misma prioridad, se rechaza la operación.

## Cambios inmediatos

Un cambio con vigencia inmediata debe:

- registrar motivo;
- mostrar sucursales y canales afectados;
- invalidar cachés de precios;
- notificar aplicaciones conectadas;
- no alterar carritos ya congelados, salvo política explícita.

## Precios por cantidad

Ejemplo:

- 1 a 5 unidades: $3.000;
- 6 a 11 unidades: $2.800;
- 12 o más: $2.600.

Los rangos no deben solaparse dentro del mismo alcance y prioridad.

## Postcondiciones

- Existe una regla de precio versionada.
- El historial anterior permanece disponible.
- Los consumidores pueden resolver la nueva regla cuando entre en vigencia.
- La acción queda auditada.

## Eventos

- `PriceScheduled`;
- `PriceActivated`;
- `PriceExpired`;
- `PriceChanged`.

## Pruebas mínimas

- precio general;
- precio por sucursal;
- precio por canal;
- precio por presentación;
- precio por cliente;
- precio por grupo;
- precio por cantidad;
- intervalo solapado;
- prioridad duplicada;
- importe negativo;
- vigencia futura;
- cambio inmediato;
- solicitud idempotente;
- acceso cruzado entre tenants.

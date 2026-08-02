# UC-TAX-001: Resolver impuestos aplicables

## Objetivo

Determinar de forma versionada, explicable y auditable los impuestos aplicables a cada línea y al total de una operación comercial.

## Actor principal

Motor comercial, POS, aplicación de pedidos o servicio de facturación autorizado.

## Precondiciones

- Empresa y sucursal activas.
- Producto, variante o presentación válidos.
- Configuración tributaria vigente.
- Jurisdicción y fecha conocidas.
- Precio base y beneficios comerciales resueltos.

## Entrada

- tenant_id derivado;
- company_id derivado;
- branch_id;
- product_id;
- variant_id opcional;
- presentation_id opcional;
- customer_id opcional;
- customer_tax_profile opcional;
- sales_channel;
- quantity;
- unit_price;
- discounts;
- promotional_benefits;
- occurred_at;
- currency;
- tax_configuration_version;
- correlation_id.

## Salida

- tax_category;
- applicable_tax_rules;
- taxable_base;
- tax_amounts;
- total_tax;
- price_includes_tax;
- exemption_reason opcional;
- resolution_explanation;
- configuration_version.

## Categorías conceptuales

- EXCLUDED;
- EXEMPT;
- TAXED;
- NOT_APPLICABLE.

## Flujo principal

1. El sistema valida tenant, empresa y sucursal.
2. Obtiene la configuración tributaria vigente.
3. Determina la categoría fiscal del producto.
4. Evalúa reglas específicas por:
   - producto;
   - categoría;
   - cliente;
   - sucursal;
   - canal;
   - fecha;
   - jurisdicción.
5. Calcula la base después de promociones y descuentos permitidos.
6. Determina si el impuesto está incluido o se adiciona.
7. Calcula cada componente tributario con precisión decimal.
8. Valida incompatibilidades.
9. Produce explicación y versión.
10. Devuelve el resultado para congelarlo en la venta.

## Reglas

1. Los porcentajes no se codifican en la interfaz.
2. Las tasas tienen vigencia.
3. La venta conserva snapshot tributario.
4. Los cambios posteriores no alteran documentos históricos.
5. Un producto EXCLUDED no genera impuesto.
6. Un producto EXEMPT debe conservar la razón aplicable.
7. El cálculo debe ser determinista.
8. No se usarán valores de otro tenant.
9. Las fracciones producidas se conservan internamente con Decimal.
10. La facturación fiscal utilizará el snapshot de la venta, no la configuración actual.
11. Las promociones y descuentos deben afectar la base conforme a la política fiscal aplicable.
12. Una configuración ambigua debe producir error administrativo, no una selección arbitraria.

## Precio con impuesto incluido

Cuando el precio incluye impuesto:

- se descompone base e impuesto;
- el total comercial no aumenta por volver a adicionar el mismo impuesto;
- la fórmula y precisión deben estar versionadas.

## Precio con impuesto adicional

Cuando el impuesto se adiciona:

- se calcula sobre la base aplicable;
- se suma al total calculado;
- se conserva por línea y por documento.

## Excepciones

- configuración inexistente;
- categoría fiscal inválida;
- dos reglas equivalentes;
- tasa vencida;
- producto sin configuración obligatoria;
- cliente con perfil incompatible;
- error de precisión;
- acceso cruzado entre tenants.

## Postcondiciones

- Existe un resultado tributario único y trazable.
- La operación puede almacenar snapshot completo.
- El sistema puede reconstruir el cálculo.

## Eventos

La resolución ordinaria no requiere evento persistente.

Pueden emitirse:

- `TaxResolutionFailed`;
- `TaxConfigurationAmbiguityDetected`;
- `TaxExemptionApplied`.

## Pruebas mínimas

- producto excluido;
- producto exento;
- impuesto incluido;
- impuesto adicional;
- descuento previo;
- promoción previa;
- cliente con excepción;
- regla vencida;
- dos reglas ambiguas;
- venta offline;
- aislamiento entre tenants;
- snapshot histórico.

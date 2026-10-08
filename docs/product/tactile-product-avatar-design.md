# Avatares internos del catálogo táctil

## Propósito

Los avatares son recursos visuales genéricos de interfaz. No representan productos inventados, no contienen nombre comercial, SKU, código de barras ni precio.

La identidad comercial del artículo sigue viniendo del catálogo confiable:

- nombre real;
- presentación real;
- precio activo real;
- unidad y precisión reales.

La tarjeta táctil sólo puede mostrar esos datos después de una consulta de catálogo.

## Familias soportadas

El resolver contempla exactamente los 18 tipos definidos en `docs/product/business-types.md`:

| Tipo de comercio | Avatar |
| --- | --- |
| Tienda de barrio | tienda |
| Minimercado | tienda |
| Supermercado pequeño/mediano | supermercado |
| Perecederos/venta por peso | perecederos |
| Carnicería | carnicería |
| Fruver/frutería/verdulería | fruver |
| Cacharrería/variedades | variedades |
| Papelería | papelería |
| Depósito de bebidas | bebidas |
| Licorera | licorera |
| Droguería | droguería |
| Ferretería | ferretería |
| Ropa | ropa |
| Calzado | calzado |
| Panadería | panadería |
| Mascotas | mascotas |
| Productos de aseo | aseo |
| Alimentos preparados | alimentos preparados |

## Regla de conexión

El componente acepta `businessType` explícito. Actualmente la sesión comercial no expone todavía un contrato ejecutable de perfil de comercio que permita obtener ese valor, por lo que la venta utiliza el avatar genérico y no adivina el sector a partir del nombre del producto.

Cuando exista el contrato de perfil de comercio, la conexión correcta será:

`perfil de comercio -> tipo canónico -> ProductAvatar`

No se debe introducir una matriz de productos de ejemplo para simular esa conexión.

## Regla de precio

El avatar jamás contiene precio. La tarjeta recibe `price_amount` desde `CatalogItemResult`. Una presentación sin precio activo permanece no vendible.

## Regla de cantidad

La unidad y precisión siguen viniendo de `CatalogItemResult`. La lectura de balanza no se simula: queda pendiente del adaptador real del Hardware Service.

## Regla de seguridad

El renderer no se convierte en autoridad de precio, total, cambio, stock o identidad. `sale.create` continúa recibiendo producto/presentación/cantidad y la capa confiable conserva el cálculo comercial.

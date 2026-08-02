# UC-CAT-004: Crear variante de producto

## Objetivo

Crear una combinación comercial específica sin duplicar el producto maestro.

## Ejemplos

- Camiseta / azul / talla M.
- Medicamento / 500 mg / caja de 20 tabletas.
- Pintura / blanca / galón.
- Bebida / sabor naranja / 400 ml.

## Actor principal

Usuario autorizado de catálogo.

## Precondiciones

- Producto maestro existente.
- Producto compatible con variantes.
- Atributos de variante previamente definidos o permitidos.
- Permiso `catalog.variant.create`.

## Entrada

- product_id;
- attribute_values;
- internal_reference opcional;
- active;
- idempotency_key.

## Flujo principal

1. El sistema obtiene el producto dentro de la empresa.
2. Valida los atributos permitidos.
3. Normaliza valores.
4. Construye una clave canónica de combinación.
5. Verifica que no exista una variante equivalente.
6. Crea la variante.
7. Registra auditoría.
8. Emite `ProductVariantCreated`.

## Reglas

1. Una combinación de atributos debe ser única dentro del producto.
2. El orden de los atributos no debe crear variantes duplicadas.
3. La variante puede tener códigos, precios e inventario específicos.
4. Los atributos históricos no se alteran en ventas cerradas.
5. No todos los productos necesitan variantes.
6. Una presentación no debe confundirse con una variante:
   - color o concentración: variante;
   - caja, bolsa o paca: presentación.
7. Desactivar una variante no elimina su historial.
8. Cambiar atributos estructurales puede requerir crear una nueva variante.

## Excepciones

- combinación existente;
- atributo no permitido;
- producto inactivo;
- producto incompatible;
- acceso no autorizado.

## Postcondiciones

- Existe una variante única y trazable.
- No se crea stock ni precio automáticamente salvo plantilla explícita.

## Eventos

- `ProductVariantCreated`.

## Pruebas mínimas

- color y talla;
- concentración;
- combinación duplicada con distinto orden;
- producto sin variantes;
- variante en otra empresa;
- solicitud repetida.

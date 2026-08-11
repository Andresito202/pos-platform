# UC-CAT-005: Crear presentación comercial

## Objetivo

Definir una forma concreta de comprar, almacenar o vender un producto.

## Ejemplos

- unidad;
- bolsa de 500 g;
- botella de 1 litro;
- caja de 24 unidades;
- paca de 12 bolsas;
- bulto de 50 kg.

## Actor principal

Usuario autorizado de catálogo o inventario.

## Precondiciones

- Producto activo.
- Variante válida cuando aplique.
- Unidad base definida.
- Permiso `catalog.presentation.create`.

## Entrada

- product_id;
- variant_id opcional;
- name;
- unit_id;
- contained_quantity;
- stock_mode;
- sales_enabled;
- purchasing_enabled;
- breakable;
- base_presentation_id opcional;
- conversion_factor opcional;
- idempotency_key.

## Flujo principal

1. El usuario define la presentación.
2. El sistema valida unidad, dimensión y factor.
3. Determina si controla inventario propio o convertido.
4. Verifica que no exista una presentación equivalente.
5. Comprueba ausencia de ciclos de conversión.
6. Crea la presentación.
7. Registra auditoría.
8. Emite `ProductPresentationCreated`.

## Reglas

1. `contained_quantity` debe ser mayor que cero.
2. El factor debe ser exacto y positivo.
3. La presentación debe tener una relación clara con la unidad base.
4. No puede existir una cadena circular.
5. Una presentación puede habilitarse solo para compra, solo para venta o ambas.
6. `breakable` indica posibilidad, no ejecuta automáticamente la apertura.
7. La creación no genera existencias.
8. El stock derivado no debe duplicar inventario real.
9. Cambiar el factor con movimientos existentes requiere migración controlada.
10. Una presentación desactivada conserva historial.

## StockMode

### INDEPENDENT

Mantiene saldo propio.

### CONVERTED_TO_BASE

Convierte movimientos a unidad base.

### DERIVED

Su disponibilidad se calcula desde otra presentación.

### NON_STOCK

No mantiene inventario.

## Excepciones

- factor cero o negativo;
- conversión circular;
- unidad incompatible;
- presentación duplicada;
- producto inactivo;
- cambio estructural inseguro.

## Postcondiciones

- Existe una presentación comercial válida.
- Puede recibir códigos y precios propios.
- No existe stock ficticio.

## Eventos

- `ProductPresentationCreated`.

## Pruebas mínimas

- unidad simple;
- caja de 24;
- paca de 12;
- presentación por peso;
- factor inválido;
- ciclo de conversión;
- duplicado;
- compra solamente.

# UC-CAT-001: Crear producto

## Objetivo

Registrar un nuevo producto maestro dentro del catálogo de una empresa sin crear todavía existencias ficticias.

## Actor principal

Propietario, administrador, gerente de sucursal u operador de inventario autorizado.

## Precondiciones

- Usuario autenticado.
- Empresa activa.
- Licencia operativa.
- Permiso `catalog.product.create`.
- Categoría válida cuando sea obligatoria.
- Unidades y atributos compatibles.

## Entrada

- company_id derivado del contexto;
- internal_code opcional;
- name;
- description opcional;
- category_id;
- brand_id opcional;
- product_type;
- stock_controlled;
- lot_controlled;
- expiration_controlled;
- serial_controlled;
- tax_category_id opcional;
- base_unit_id;
- business_attributes;
- idempotency_key.

## Flujo principal

1. El usuario inicia el registro.
2. El sistema deriva tenant y empresa desde la sesión.
3. Valida nombre, tipo, unidad base y controles seleccionados.
4. Verifica que el código interno no esté repetido dentro de la empresa.
5. Valida atributos especializados según el tipo de comercio.
6. Crea el producto en estado activo o borrador, según política.
7. Registra auditoría.
8. Emite `ProductCreated`.
9. Devuelve el identificador global del producto.

## Validaciones

- El nombre no puede estar vacío.
- El tipo de producto debe ser reconocido.
- Un servicio no controla inventario salvo configuración expresa.
- Un producto con vencimiento debe permitir lotes.
- Las unidades deben ser compatibles con su naturaleza.
- No se aceptan códigos internos duplicados.
- Los atributos regulatorios requeridos deben completarse cuando aplique.
- Los valores monetarios o cantidades no pueden ser negativos.

## Flujos alternativos

### Producto similar existente

El sistema informa posibles duplicados, pero no fusiona automáticamente.

### Código interno existente

Se rechaza la creación.

### Datos incompletos

Puede guardarse como borrador si la política lo permite. Un borrador no puede venderse.

### Solicitud repetida

La misma `idempotency_key` devuelve el producto ya creado.

## Postcondiciones

- Existe un producto maestro.
- No se genera stock automáticamente.
- No se crea precio implícito salvo política explícita.
- La acción queda auditada.

## Eventos

- `ProductCreated`.

## Pruebas mínimas

- producto estándar;
- producto por peso;
- servicio;
- producto con lotes y vencimiento;
- código interno duplicado;
- unidad incompatible;
- producto regulado incompleto;
- solicitud idempotente;
- acceso de otra empresa.

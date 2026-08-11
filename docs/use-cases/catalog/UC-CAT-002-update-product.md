# UC-CAT-002: Actualizar o desactivar producto

## Objetivo

Modificar datos permitidos de un producto sin alterar operaciones históricas.

## Actor principal

Usuario con permiso administrativo de catálogo.

## Precondiciones

- Usuario autenticado.
- Producto perteneciente a la empresa.
- Permiso `catalog.product.update` o `catalog.product.deactivate`.
- Producto no eliminado físicamente.

## Entrada

- product_id;
- campos permitidos;
- expected_version;
- reason cuando aplique;
- idempotency_key.

## Flujo de actualización

1. El sistema obtiene el producto dentro del tenant y empresa autorizados.
2. Verifica la versión actual para evitar sobrescrituras concurrentes.
3. Clasifica los campos como:
   - comerciales;
   - operativos;
   - sensibles;
   - inmutables.
4. Valida dependencias e impacto.
5. Aplica los cambios permitidos.
6. Incrementa la versión.
7. Registra valores anteriores y nuevos.
8. Emite `ProductUpdated`.

## Flujo de desactivación

1. El usuario solicita desactivar.
2. El sistema comprueba pedidos, ventas suspendidas y procesos abiertos.
3. Impide nuevas ventas y compras del producto.
4. Conserva stock, lotes, movimientos y ventas históricas.
5. Registra motivo y auditoría.
6. Emite `ProductDeactivated`.

## Campos normalmente editables

- nombre comercial;
- descripción;
- categoría;
- marca;
- imagen;
- atributos comerciales;
- estado operativo.

## Campos restringidos

- empresa propietaria;
- identificador global;
- historial de ventas;
- movimientos de inventario;
- snapshots históricos.

## Cambios de alto impacto

Requieren validación adicional:

- unidad base;
- control por lote;
- control por vencimiento;
- tipo de producto;
- estructura de variantes;
- política de stock.

No deben modificarse si producen inconsistencias con inventario existente. Puede requerirse una migración de producto.

## Reglas

1. Desactivar no elimina.
2. Las ventas anteriores conservan sus snapshots.
3. No se cambia directamente el precio desde este caso de uso.
4. No se cambia stock desde este caso de uso.
5. No se reutiliza el código interno de un producto desactivado sin política explícita.
6. Los cambios concurrentes deben detectarse mediante versión.

## Excepciones

- producto inexistente;
- producto de otra empresa;
- versión desactualizada;
- cambio incompatible con existencias;
- falta de permiso;
- producto referenciado por operación pendiente.

## Postcondiciones

- El producto queda actualizado o inactivo.
- Las operaciones históricas permanecen intactas.
- Existe auditoría completa.

## Eventos

- `ProductUpdated`;
- `ProductDeactivated`.

## Pruebas mínimas

- cambio de nombre;
- cambio de categoría;
- desactivación con stock;
- desactivación con venta suspendida;
- intento de cambiar unidad base con movimientos;
- conflicto de versión;
- acceso cruzado entre tenants.

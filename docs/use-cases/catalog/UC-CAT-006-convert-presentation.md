# UC-CAT-006: Convertir o fraccionar presentación

## Objetivo

Transformar existencias de una presentación en otra manteniendo cantidad, costo y trazabilidad.

## Ejemplo

Convertir:

- 1 paca de 12 bolsas;
- en 12 bolsas individuales.

## Actor principal

Operador de inventario, supervisor o administrador autorizado.

## Precondiciones

- Producto y presentaciones activas.
- Conversión configurada.
- Stock suficiente en origen.
- Sucursal e ubicación válidas.
- Permiso `inventory.presentation.convert`.
- Autorización adicional cuando la regla lo exija.

## Entrada

- branch_id;
- source_presentation_id;
- target_presentation_id;
- source_quantity;
- source_lot_id opcional;
- target_lot_policy;
- waste_quantity opcional;
- reason;
- idempotency_key.

## Flujo principal

1. El sistema obtiene la regla de conversión vigente.
2. Valida compatibilidad y factor.
3. Verifica saldo disponible en origen.
4. Calcula cantidad destino.
5. Calcula distribución de costo.
6. Inicia una transacción.
7. Registra salida de la presentación origen.
8. Registra entrada de la presentación destino.
9. Registra merma por separado cuando exista.
10. Conserva referencia común de transformación.
11. Actualiza proyecciones de stock.
12. Registra auditoría.
13. Emite eventos de inventario y conversión.
14. Confirma la transacción.

## Reglas

1. La conversión es atómica.
2. No se modifica stock directamente.
3. El costo total se conserva salvo merma documentada.
4. La merma no se oculta dentro del factor.
5. No se permiten cantidades negativas o cero.
6. La conversión respeta lote y vencimiento.
7. No se crean lotes sin política definida.
8. Una solicitud repetida no duplica movimientos.
9. No se permite conversión retrospectiva sobre periodos cerrados.
10. La presentación origen y destino no pueden ser iguales.
11. Los redondeos de cantidad deben usar la precisión de la unidad, no la monetaria.

## Manejo de lotes

- Puede conservarse el mismo lote lógico.
- Puede crearse un sublote derivado.
- La decisión debe configurarse por tipo de producto.
- La fecha de vencimiento no puede ampliarse por conversión.

## Excepciones

- stock insuficiente;
- factor inexistente;
- conversión vencida;
- lote bloqueado;
- producto vencido;
- autorización requerida;
- conflicto concurrente;
- solicitud duplicada.

## Postcondiciones

- Las existencias origen y destino son consistentes.
- El costo permanece trazable.
- La transformación puede reconstruirse desde los movimientos.

## Eventos

- `InventoryConversionStarted`;
- `InventoryDeducted`;
- `InventoryReceived`;
- `InventoryLossRecorded`, cuando aplique;
- `InventoryConversionCompleted`.

## Pruebas mínimas

- paca a unidades;
- conversión parcial;
- conservación de lote;
- sublote;
- merma;
- stock insuficiente;
- concurrencia;
- idempotencia;
- precisión decimal.

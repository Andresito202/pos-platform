# UC-PROMO-001: Crear o programar promoción

## Objetivo

Configurar una promoción comercial con condiciones, beneficios, alcance, prioridad, vigencia y política de combinación explícitos.

## Actor principal

Propietario, administrador general o usuario autorizado de promociones.

## Precondiciones

- Usuario autenticado.
- Empresa activa.
- Productos, categorías, clientes o canales involucrados válidos.
- Permiso `promotions.manage`.
- Configuración comercial vigente.

## Entrada

- company_id derivado del contexto;
- name;
- description opcional;
- promotion_type;
- conditions;
- benefits;
- branch_scope;
- sales_channels;
- customer_scope;
- product_scope;
- category_scope;
- minimum_quantity opcional;
- minimum_amount opcional;
- valid_from;
- valid_until opcional;
- days_of_week opcional;
- start_time opcional;
- end_time opcional;
- priority;
- stack_policy;
- usage_limits opcionales;
- status;
- reason;
- idempotency_key.

## Tipos iniciales

- PERCENTAGE_OFF;
- FIXED_AMOUNT_OFF;
- FIXED_PRICE;
- BUY_X_PAY_Y;
- BUY_X_GET_Y;
- SECOND_UNIT_DISCOUNT;
- BUNDLE_PRICE;
- MINIMUM_PURCHASE_DISCOUNT;
- CATEGORY_DISCOUNT;
- CUSTOMER_GROUP_DISCOUNT.

## Condiciones posibles

Una promoción puede depender de:

- producto;
- variante;
- presentación;
- categoría;
- cantidad;
- subtotal;
- cliente;
- grupo de clientes;
- sucursal;
- canal de venta;
- día;
- horario;
- método de pago;
- combinación de productos.

## Beneficios posibles

- porcentaje de descuento;
- valor fijo;
- precio fijo;
- unidades gratuitas;
- segunda unidad con descuento;
- precio de combo;
- descuento sobre categoría;
- descuento sobre total.

## StackPolicy

### EXCLUSIVE

No se combina con otras promociones.

### STACKABLE

Puede combinarse con promociones compatibles.

### BEST_PRICE

El sistema aplica la alternativa que produzca el menor total permitido.

### PRIORITY_ORDER

Las reglas se evalúan según prioridad y compatibilidad.

## Flujo principal

1. El usuario define nombre, condiciones y beneficio.
2. El sistema deriva tenant y empresa desde la sesión.
3. Valida referencias, fechas, horarios y canales.
4. Normaliza condiciones y beneficios.
5. Verifica que el beneficio no pueda producir importes negativos.
6. Detecta solapamientos y conflictos con otras promociones.
7. Simula ejemplos representativos cuando sea posible.
8. Muestra alcance e impacto estimado.
9. El usuario confirma.
10. El sistema crea una versión inmutable de la regla.
11. Registra auditoría.
12. Emite `PromotionCreated` o `PromotionScheduled`.
13. Al iniciar vigencia, emite `PromotionActivated`.

## Validaciones

- El nombre es obligatorio.
- La fecha final debe ser posterior a la inicial.
- Los porcentajes deben estar dentro del rango permitido.
- Los valores y cantidades deben ser positivos.
- Los productos deben pertenecer a la empresa.
- Las sucursales deben pertenecer a la empresa.
- Los canales deben ser reconocidos.
- `BUY_X_PAY_Y` exige `X > Y >= 0`.
- Una promoción de combo requiere todos sus componentes.
- Las condiciones no pueden ser imposibles o contradictorias.
- Los límites de uso no pueden ser negativos.
- La prioridad debe ser válida.
- La política de combinación debe ser explícita.

## Conflictos

### Solapamiento válido

Puede existir cuando las políticas de combinación permiten resolverlo.

### Solapamiento ambiguo

Se rechaza cuando dos reglas equivalentes tienen:

- misma prioridad;
- mismo alcance;
- misma vigencia;
- política incompatible.

### Promoción redundante

El sistema puede advertir cuando el beneficio nunca mejora el precio actual.

## Límites de uso

Pueden definirse por:

- venta;
- cliente;
- día;
- sucursal;
- campaña;
- cantidad total disponible.

Los contadores deben actualizarse de forma segura e idempotente.

## Cambios

Una promoción activa no debe editarse destructivamente.

Debe:

1. cerrarse o versionarse;
2. conservar el historial;
3. crear una nueva versión;
4. no alterar ventas anteriores.

## Postcondiciones

- Existe una promoción versionada.
- Su vigencia y alcance son explícitos.
- La regla puede evaluarse de forma determinista.
- La acción queda auditada.

## Eventos

- `PromotionCreated`;
- `PromotionScheduled`;
- `PromotionActivated`;
- `PromotionExpired`;
- `PromotionDeactivated`.

## Pruebas mínimas

- porcentaje;
- valor fijo;
- precio fijo;
- 2x1;
- lleve 3 pague 2;
- segundo producto con descuento;
- combo;
- compra mínima;
- sucursal;
- canal;
- cliente;
- horario;
- regla vencida;
- prioridad duplicada;
- condiciones contradictorias;
- beneficio negativo;
- solicitud repetida;
- aislamiento entre tenants.

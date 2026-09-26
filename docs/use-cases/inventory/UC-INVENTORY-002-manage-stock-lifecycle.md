# UC-INVENTORY-002: Gestionar ciclo operativo de inventario

## Objetivo

Definir el contrato operativo para reservas, salidas, ajustes, mermas, traslados, lotes, vencimientos y concurrencia de inventario en un entorno multi-tenant, multiempresa, multisucursal y local-first.

Este caso de uso complementa `UC-INVENTORY-001`, que cubre la recepción de mercancía.

No define todavía el modelo físico ni las transacciones SQL concretas.

## Actor principal

Usuario o proceso autorizado que ejecuta una operación de inventario.

## Actores secundarios

- tenant;
- empresa;
- sucursal;
- ubicación de inventario;
- POS;
- servicio central;
- sistema de sincronización;
- sistema de auditoría;
- sistema de observabilidad;
- módulo de ventas;
- módulo de compras;
- módulo de domicilios cuando corresponda.

## Precondiciones

- El tenant está identificado.
- La empresa y sucursal están identificadas cuando corresponda.
- La ubicación de inventario existe y pertenece al ámbito autorizado.
- El producto o presentación existe.
- El actor tiene permisos suficientes.
- La operación respeta el aislamiento multi-tenant.
- Las políticas aplicables de inventario están disponibles.
- Las operaciones críticas conservan `correlation_id`.
- Cuando exista operación offline, se dispone de la política local-first aplicable.

## Entrada

Según la operación:

- `tenant_id`;
- `company_id`;
- `branch_id`;
- `inventory_location_id`;
- `product_presentation_id`;
- `lot_id` opcional;
- `quantity`;
- `unit_of_measure`;
- `operation_type`;
- `reason_code` opcional;
- `reference_type` opcional;
- `reference_id` opcional;
- `source_location_id` opcional;
- `destination_location_id` opcional;
- `reservation_id` opcional;
- `expected_version` obligatorio para mutaciones de agregados existentes;
- `idempotency_key`;
- `correlation_id`;
- `occurred_at`;
- `connectivity_status`;
- `actor_id`;
- `operation_context`.

## Principios del caso de uso

1. `InventoryMovement` es el hecho operativo que explica toda variación de existencias.
2. `StockBalance` representa una proyección derivada y no sustituye el historial de movimientos.
3. Una corrección no elimina ni reescribe movimientos confirmados.
4. Los ajustes se registran mediante movimientos explícitos.
5. Las mermas se registran mediante movimientos explícitos y motivo.
6. Los traslados conservan origen, destino y trazabilidad.
7. Una reserva no equivale todavía a una salida definitiva.
8. Una reserva liberada no debe dejar consumo residual.
9. Una reserva consumida no puede consumirse nuevamente.
10. Los lotes deben conservar identidad propia cuando el producto lo requiera.
11. FEFO se aplica cuando existe vencimiento y la política lo exige.
12. FIFO u otra política configurada puede utilizarse cuando no existe vencimiento.
13. Ningún movimiento puede cruzar tenants.
14. Las operaciones deben ser idempotentes cuando exista riesgo de reintento.
15. La concurrencia no puede producir stock negativo por doble consumo cuando la política no lo permita.
16. La operación offline no puede ocultar conflictos de inventario.
17. Una sincronización posterior no debe duplicar movimientos.
18. Toda operación crítica debe quedar auditada.

## Reservas de inventario

Una reserva compromete cantidad disponible para una operación futura sin registrar todavía una salida definitiva.

Flujo:

1. El sistema identifica tenant, empresa, sucursal y ubicación.
2. Valida producto, presentación y lote cuando corresponda.
3. Determina cantidad disponible.
4. Evalúa reservas existentes.
5. Verifica que la nueva reserva no exceda la disponibilidad efectiva.
6. Crea `InventoryReservation`.
7. Registra referencia funcional, por ejemplo pedido o venta suspendida.
8. Incrementa la cantidad reservada de la proyección aplicable.
9. Conserva versión e idempotencia.
10. Audita la operación.

Estados conceptuales de una reserva:

- `ACTIVE`;
- `PARTIALLY_CONSUMED`;
- `CONSUMED`;
- `RELEASED`;
- `EXPIRED`;
- `CANCELLED`.

Reglas:

1. Una reserva activa reduce disponibilidad pero no existencia física.
2. Una reserva consumida no puede consumirse nuevamente.
3. Una reserva liberada no disminuye stock físico.
4. Una reserva expirada debe liberarse mediante transición explícita.
5. Una misma `idempotency_key` no crea reservas duplicadas.
6. Una reserva pertenece a un tenant y ubicación concretos.
7. Una reserva puede consumir varios lotes únicamente si la política lo permite y conserva trazabilidad.
8. La liberación debe conservar motivo y referencia original.

## Salidas de inventario

Una salida reduce existencias físicas mediante uno o más `InventoryMovement`.

Motivos conceptuales:

- venta;
- consumo interno;
- devolución a proveedor;
- merma;
- ajuste negativo;
- traslado de salida;
- baja autorizada.

Flujo:

1. Se valida identidad y ámbito.
2. Se determina la cantidad a consumir.
3. Se verifica disponibilidad efectiva.
4. Se resuelve lote mediante FEFO, FIFO o selección autorizada.
5. Se valida reserva cuando la salida deriva de una reserva.
6. Se genera movimiento negativo.
7. Se actualiza la proyección de saldo.
8. Se consume total o parcialmente la reserva asociada.
9. Se registra auditoría.
10. Se conserva idempotencia.

Reglas:

1. Una salida confirmada no se elimina.
2. Una corrección genera otro movimiento compensatorio.
3. No se permite consumir dos veces la misma reserva.
4. Una salida offline debe conservar identidad global para evitar duplicación al sincronizar.
5. No se debe producir stock negativo salvo política explícita y autorizada.
6. El movimiento debe conservar referencia a su causa funcional.

## Ajustes de inventario

Un ajuste corrige diferencias entre existencia registrada y existencia física sin reescribir el historial anterior.

Tipos conceptuales:

- `POSITIVE_ADJUSTMENT`;
- `NEGATIVE_ADJUSTMENT`.

Flujo:

1. Se identifica la diferencia.
2. Se exige `reason_code`.
3. Se valida autorización.
4. Puede exigirse aprobación separada según monto, producto o riesgo.
5. Se crea movimiento explícito.
6. Se actualiza proyección.
7. Se conserva evidencia previa y posterior.
8. Se audita.

Reglas:

1. Todo ajuste manual requiere motivo.
2. Un ajuste no modifica movimientos históricos.
3. Ajustes críticos pueden exigir segregación de funciones.
4. El conteo físico y el ajuste son conceptos distintos.
5. Una diferencia de inventario no se oculta mediante edición directa del saldo.

## Mermas

Una merma representa pérdida real de existencias por daño, deterioro, vencimiento, manipulación, pérdida u otra causa autorizada.

Flujo:

1. Se identifica producto, presentación, ubicación y lote cuando corresponda.
2. Se registra cantidad.
3. Se registra motivo.
4. Se valida autorización.
5. Se genera movimiento negativo.
6. Se conserva evidencia cuando la política lo requiera.
7. Se actualiza proyección.
8. Se audita.

Motivos conceptuales pueden incluir:

- `DAMAGED`;
- `EXPIRED`;
- `SPOILAGE`;
- `LOSS`;
- `BREAKAGE`;
- `QUALITY_REJECTION`;
- `OTHER_AUTHORIZED`.

Reglas:

1. Una merma no se registra como venta.
2. Una merma no se elimina del historial.
3. Una merma por vencimiento debe conservar referencia al lote.
4. Mermas sensibles pueden requerir aprobación.
5. El motivo debe ser obligatorio y auditable.

## Traslados

Un traslado mueve existencias entre ubicaciones autorizadas sin alterar la cantidad global del tenant salvo diferencias explícitas.

Estados conceptuales:

- `REQUESTED`;
- `APPROVED`;
- `IN_TRANSIT`;
- `RECEIVED`;
- `PARTIALLY_RECEIVED`;
- `CANCELLED`;
- `REJECTED`.

Flujo:

1. Se identifica origen y destino.
2. Se valida que ambos pertenezcan al ámbito autorizado.
3. Se valida disponibilidad en origen.
4. Se crea la solicitud de traslado.
5. Se aprueba cuando la política lo exige.
6. Se registra salida del origen.
7. Se registra estado `IN_TRANSIT`.
8. El destino confirma recepción.
9. Se registra entrada en destino.
10. Las diferencias se registran explícitamente.
11. Se conserva vínculo entre movimientos.
12. Se audita.

Reglas:

1. Un traslado no se representa como edición directa de dos saldos.
2. Salida y entrada deben conservar una identidad común de traslado.
3. Una recepción parcial no se oculta.
4. Una pérdida en tránsito genera ajuste o incidencia explícita.
5. Un traslado no puede cruzar tenants.
6. La cancelación después de salida requiere operación compensatoria explícita.

## Lotes

Un lote representa existencias con origen y atributos comunes que requieren trazabilidad independiente.

Atributos conceptuales relevantes:

- `lot_id`;
- `product_presentation_id`;
- número o código de lote;
- fecha de recepción;
- fecha de fabricación opcional;
- fecha de vencimiento opcional;
- costo o referencia de costo;
- proveedor u origen opcional;
- estado;
- cantidad disponible;
- cantidad reservada.

Reglas:

1. `lot_id` no se reutiliza.
2. Los movimientos deben conservar `lot_id` cuando aplique.
3. Una reserva por lote debe consumirse del lote reservado salvo excepción autorizada.
4. Un lote vencido no puede seleccionarse para venta cuando la política lo prohíba.
5. La edición de fecha de vencimiento debe quedar auditada.
6. La corrección de identidad del lote no elimina historial.
7. Un mismo código de lote identifica una misma tanda en todas las
   sucursales: puede recibirse en varias, pero **con la misma fabricación y el
   mismo vencimiento**; si no coinciden, es conflicto y no se registra.
   Decisión del propietario del 2026-09-26. La fecha de recepción es de cada
   sucursal y puede diferir.

## Vencimientos

Los productos perecederos deben evaluarse contra la política de vencimiento aplicable.

Estados conceptuales derivados:

- `VALID`;
- `NEAR_EXPIRY`;
- `EXPIRED`;
- `BLOCKED`.

Reglas:

1. FEFO prioriza el lote con vencimiento válido más próximo.
2. Un lote vencido no se vende cuando la política lo prohíbe.
3. `NEAR_EXPIRY` puede generar alertas operativas.
   **Umbral vigente: 7 días** —vence hoy o en los siete días siguientes, ambos
   extremos incluidos—. Decisión del propietario del 2026-09-26, materializada
   en `NEAR_EXPIRY_DAYS` (`packages/contracts/src/ipc-commercial.ts`).
4. El vencimiento no elimina automáticamente el lote.
5. La baja de producto vencido se registra mediante merma o ajuste explícito.
6. El estado derivado de vencimiento no sustituye los movimientos de inventario.

## Concurrencia y control de versión

Las operaciones de inventario deben impedir doble consumo, pérdida de actualizaciones y sobrescritura silenciosa.

Reglas:

1. Toda mutación de un agregado existente exige `expected_version`.
2. Si la versión esperada no coincide con la versión vigente, la operación se rechaza o pasa a resolución explícita.
3. Una reserva concurrente no puede comprometer dos veces la misma disponibilidad.
4. Dos salidas concurrentes no pueden consumir la misma unidad lógica cuando la política no lo permita.
5. La actualización de `StockBalance` debe ser atómica respecto del movimiento confirmado.
6. Los reintentos con la misma `idempotency_key` no generan movimientos duplicados.
7. El orden de llegada no debe ocultar conflictos.
8. Una operación confirmada no se reemplaza por una versión tardía.
9. Los conflictos deben conservar evidencia suficiente para auditoría y sincronización.
10. El control de concurrencia debe aplicarse también a reservas, traslados y ajustes.

## Fronteras transaccionales

### Reserva

La creación o transición de `InventoryReservation`, la actualización de cantidades reservadas de `StockBalance`, la auditoría, el resultado idempotente y la outbox comparten una transacción.

### Consumo

El `InventoryMovement` de salida, el consumo total o parcial de la reserva, la actualización de `StockBalance`, la auditoría y la outbox comparten una transacción. Si cualquiera falla, no queda consumo parcial.

### Recepción, ajuste, merma y traslado

Cada hecho confirmado crea movimientos append-only y actualiza su proyección en la misma transacción local. Una integración externa o recepción en otra sucursal constituye otra operación idempotente enlazada, no una transacción distribuida simulada.

`expected_version` es obligatorio para toda mutación de reserva, saldo proyectado o traslado. Solo se omite en la creación de un hecho append-only cuya unicidad e idempotencia ya estén protegidas.

## Operación local-first y offline

Cuando el POS opera sin conectividad:

1. Se utilizan identificadores globalmente únicos.
2. Cada operación conserva `idempotency_key`.
3. Se registra localmente el movimiento pendiente.
4. Se actualiza la proyección local de forma atómica.
5. Se conserva la causalidad necesaria para sincronización.
6. No se elimina el hecho local aunque exista conflicto posterior.
7. Al recuperar conectividad, las operaciones pendientes se publican mediante el contrato de sincronización.
8. El servidor aplica deduplicación e idempotencia.
9. Los conflictos se resuelven según la autoridad de datos definida en `DEC-007`.
10. La resolución genera evidencia explícita.

Reglas:

1. Offline no significa ausencia de control de autorización.
2. Una operación local no puede inventar otro tenant, ubicación o producto.
3. El reloj local no constituye autoridad absoluta.
4. Los IDs generados localmente no se reutilizan.
5. Un reintento de sincronización no duplica movimientos.
6. Una operación ya aceptada centralmente debe producir respuesta idempotente.
7. El conflicto no se resuelve sobrescribiendo silenciosamente un movimiento confirmado.
8. Las decisiones locales que dependan de disponibilidad pueden requerir reconciliación posterior.
9. La política offline debe ser explícita por módulo.
10. La operación offline conserva auditoría pendiente de sincronización.

## Conflictos de inventario

Conflictos conceptuales:

- doble consumo;
- reserva concurrente;
- ajuste concurrente;
- traslado concurrente;
- movimiento duplicado;
- versión obsoleta;
- lote diferente;
- ubicación diferente;
- stock central menor que el esperado localmente;
- operación local sobre entidad revocada o deshabilitada;
- reloj inconsistente;
- referencia funcional duplicada.

Resultados conceptuales:

- `ACCEPTED`;
- `DUPLICATE`;
- `REJECTED`;
- `CONFLICT`;
- `REVIEW_REQUIRED`;
- `COMPENSATION_REQUIRED`.

Reglas:

1. `DUPLICATE` no crea un segundo efecto.
2. `CONFLICT` conserva ambas evidencias relevantes.
3. `REJECTED` debe indicar código estable de causa.
4. `COMPENSATION_REQUIRED` genera operación explícita; no edición destructiva.
5. Un conflicto de inventario no puede cruzar tenants.
6. La resolución debe ser determinista para la misma evidencia y política.
7. Los conflictos críticos deben quedar auditados.
8. Un conflicto no debe ocultarse modificando manualmente el saldo proyectado.

## Salida

El caso de uso puede devolver:

- `tenant_id`;
- `company_id`;
- `branch_id`;
- `inventory_location_id`;
- `movement_id` opcional;
- `reservation_id` opcional;
- `transfer_id` opcional;
- `lot_id` opcional;
- `operation_type`;
- `result`;
- `reason_code`;
- `quantity`;
- `previous_balance` opcional;
- `new_balance` opcional;
- `previous_reserved_quantity` opcional;
- `new_reserved_quantity` opcional;
- `version`;
- `idempotency_key`;
- `correlation_id`;
- `occurred_at`;
- `sync_status` opcional;
- `required_action` opcional.

La salida no debe incluir datos pertenecientes a otro tenant ni secretos.

## Flujos alternos

### Stock insuficiente

1. La operación no genera salida definitiva.
2. Se devuelve código estable.
3. No se modifica el historial previo.
4. La reserva o venta queda en el estado correspondiente.

### Versión obsoleta

1. Se rechaza la mutación.
2. Se conserva la versión vigente.
3. Se devuelve conflicto de concurrencia.
4. Puede requerirse recarga o resolución.

### Idempotencia repetida

1. Se identifica la operación original.
2. No se crea un nuevo movimiento.
3. Se devuelve el resultado ya confirmado.

### Lote vencido

1. El lote no se selecciona para venta cuando la política lo prohíbe.
2. Se conserva disponible para el flujo de baja o merma correspondiente.
3. Puede generarse alerta.

### Reserva ya consumida

1. No se consume nuevamente.
2. Se devuelve código estable.
3. Se registra intento conflictivo cuando corresponda.

### Traslado con recepción parcial

1. Se confirma únicamente la cantidad recibida.
2. El remanente permanece explícito.
3. No se corrige automáticamente la diferencia.
4. Puede abrirse incidencia o compensación.

### Conflicto offline

1. Se conserva la operación local.
2. Se conserva el estado central conocido.
3. Se clasifica el conflicto.
4. Se aplica la política definida en `DEC-007`.
5. Si no existe resolución automática segura, se marca `REVIEW_REQUIRED`.

## Puntos de auditoría

Deben auditarse como mínimo:

- creación de reserva;
- consumo de reserva;
- liberación de reserva;
- salida;
- ajuste;
- merma;
- traslado;
- recepción de traslado;
- cambio relevante de lote;
- operación sobre lote vencido;
- conflicto de concurrencia;
- operación rechazada por versión;
- duplicado detectado;
- compensación;
- resolución manual;
- override autorizado;
- operación offline reconciliada.

Cada evento debe conservar cuando corresponda:

- `tenant_id`;
- `company_id`;
- `branch_id`;
- `actor_id`;
- `inventory_location_id`;
- `movement_id`;
- `reservation_id`;
- `transfer_id`;
- `lot_id`;
- operación;
- estado anterior;
- estado nuevo;
- cantidad;
- motivo;
- `idempotency_key`;
- `correlation_id`;
- versión;
- momento efectivo.

## Puntos de observabilidad futura

Eventos conceptuales:

- `INVENTORY_RESERVATION_CREATED`;
- `INVENTORY_RESERVATION_RELEASED`;
- `INVENTORY_RESERVATION_CONSUMED`;
- `INVENTORY_MOVEMENT_RECORDED`;
- `INVENTORY_ADJUSTMENT_RECORDED`;
- `INVENTORY_WASTE_RECORDED`;
- `INVENTORY_TRANSFER_STARTED`;
- `INVENTORY_TRANSFER_RECEIVED`;
- `INVENTORY_CONFLICT_DETECTED`;
- `INVENTORY_DUPLICATE_DETECTED`;
- `INVENTORY_OFFLINE_OPERATION_ACCEPTED`;
- `INVENTORY_REVIEW_REQUIRED`.

Métricas conceptuales futuras:

- reservas activas;
- reservas expiradas;
- stock insuficiente;
- ajustes;
- mermas;
- traslados pendientes;
- conflictos;
- duplicados;
- operaciones offline;
- latencia de operación;
- diferencias de sincronización.

Reglas:

1. El dominio no importa SDKs de observabilidad.
2. Logging y métricas no sustituyen auditoría.
3. `tenant_id` y `correlation_id` deben propagarse.
4. Los IDs de alta cardinalidad no deben usarse indiscriminadamente como labels.
5. Un fallo de métricas no cambia el resultado de inventario.
6. No se registran secretos.

## Pruebas mínimas

El diseño debe permitir verificar como mínimo:

1. reserva válida;
2. reserva con stock insuficiente;
3. dos reservas concurrentes;
4. consumo total de reserva;
5. consumo parcial;
6. doble consumo;
7. liberación;
8. expiración;
9. salida válida;
10. salida sin stock;
11. salida con lote;
12. FEFO;
13. FIFO;
14. lote vencido;
15. lote próximo a vencer;
16. ajuste positivo;
17. ajuste negativo;
18. ajuste sin motivo;
19. ajuste crítico sin aprobación;
20. merma válida;
21. merma por vencimiento;
22. traslado válido;
23. traslado parcial;
24. traslado cancelado antes de salida;
25. traslado cancelado después de salida;
26. pérdida en tránsito;
27. versión correcta;
28. versión obsoleta;
29. idempotencia repetida;
30. movimiento duplicado;
31. operación offline válida;
32. reintento de sincronización;
33. conflicto offline;
34. doble consumo local-central;
35. reloj incorrecto;
36. aislamiento entre tenants;
37. ubicación fuera de tenant;
38. corrección mediante compensación;
39. conservación de historial;
40. `StockBalance` como proyección;
41. auditoría;
42. códigos de razón estables;
43. decisión determinista;
44. observabilidad futura sin alterar el resultado.

## Documentos normativos relacionados

- `docs/adr/ADR-003-local-first.md`;
- `docs/adr/DEC-007-local-first-data-authority.md`;
- `docs/architecture/conceptual-data-model.md`;
- `docs/domain/business-rules.md`;
- `docs/domain/glossary.md`;
- `docs/use-cases/inventory/UC-INVENTORY-001-receive-stock.md`.

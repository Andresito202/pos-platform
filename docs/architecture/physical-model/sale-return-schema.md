# TECH-002H: contrato físico documental de SaleReturn

## Estado y alcance

`CLOSED` dentro de `TECH-002` para `PHY-G08`.

Este documento cierra el contrato físico documental de la devolución comercial definido por `UC-SALES-002`. No contiene DDL, SQL ejecutable ni migraciones y no declara implementada la capacidad. La primera migración objetivo permanece en `NO-GO`.

Fuentes: `UC-SALES-002`, `UC-PAY-004`, `DEC-002`, `DEC-007`, modelo conceptual, ownership, reglas de negocio, glosario, catálogo de eventos, matriz de permisos, integración fiscal y convenciones físicas.

## Separación de conceptos y ownership

| Concepto | Propietario | Regla |
|---|---|---|
| `SaleReturn` y `SaleReturnLine` | Sales | devolución comercial total o parcial posterior a una Sale `COMPLETED` |
| `PARTIALLY_RETURNED` / `FULLY_RETURNED` | proyección de Sales | resultado acumulado derivado; nunca estado persistente de Sale ni SaleReturn |
| `Refund` | Payments | devolución financiera de valor confirmado y elegible |
| `Reversal` | Payments | reversión financiera cuando el estado y proveedor todavía lo permiten |
| `SaleCancellation` | Sales | cancelación o invalidación autorizada; no representa devolución posterior |
| movimiento de inventario | Inventory | único hecho autoritativo que cambia existencias |
| movimiento de caja | Cash Register | único hecho autoritativo que cambia efectivo esperado |
| corrección fiscal | Electronic Invoicing | documento fiscal nuevo, neutral a proveedor, relacionado con el original |

Sales no escribe tablas de Payments, Inventory, Cash Register o Electronic Invoicing. La relación se conserva mediante identidades, contratos y eventos. Una devolución comercial puede originar esos efectos, pero no demuestra por sí sola que hayan sido completados.

## Ubicación y autoridad

| Agregado | PostgreSQL central | SQLite local | Clasificación DEC-007 |
|---|---|---|---|
| SaleReturn | consolidado y verificador de elegibilidad acumulada | origen autorizado y copia de su resultado | `CENTRAL_REVIEW_REQUIRED` cuando exista conflicto; operación local parcialmente permitida por política |
| SaleReturnLine | consolidado con la misma autoridad del padre | origen autorizado y copia | misma autoridad que SaleReturn |
| proyección acumulada de Sale | reconstruible | reconstruible con advertencia de sincronización | `DERIVED_PROJECTION` |

SQLite solo permite crear una solicitud o confirmar localmente la fase autorizada por una política offline vigente, permisos no vencidos, dispositivo válido y snapshot suficiente de la venta. No puede autoaprobar una excepción, inventar elegibilidad central ni confirmar resultados de proveedor externo o autoridad fiscal.

## Agregado `sales.sale_returns` / `sales_sale_returns`

Propietario: Sales.

| Campo lógico | Regla |
|---|---|
| `id` | UUID v7 global, estable en local, API, outbox, inbox, auditoría y central |
| `tenant_id`, `company_id`, `branch_id` | obligatorios y coincidentes con la Sale original |
| `sale_id` | FK tenant-scoped a una Sale `COMPLETED`; la aplicación revalida estado y elegibilidad |
| `origin_device_id` | dispositivo que origina la operación; obligatorio para origen POS |
| `requested_by_actor_id` | actor autenticado que solicita |
| `approved_by_actor_id` | opcional; obligatorio al aprobar cuando la política lo exija y distinto del solicitante bajo segregación |
| `reason_code`, `reason_detail` | motivo estable y detalle opcional sanitizado |
| `status` | estado persistente tipado del ciclo de SaleReturn |
| `effective_at` | instante efectivo comercial; no decide autoridad ni conflictos |
| `currency_code` | ISO 4217, igual a la moneda inmutable de la venta |
| `original_sale_payable_amount` | snapshot del `payable_amount` original |
| `requested_return_amount` | suma solicitada exacta, no negativa |
| `approved_return_amount` | opcional hasta decisión; no supera solicitud ni saldo comercial elegible |
| `completed_return_amount` | suma comercial efectivamente completada; no implica Refund completado |
| `returned_tax_amount` | impuesto asociado a las líneas completadas según snapshot y política fiscal original |
| `pricing_pipeline_version`, `tax_policy_version`, `rounding_policy_version` | versiones originales requeridas para trazabilidad; no se sustituyen por configuración actual |
| `operation_id` | identidad global de la operación sincronizable |
| `idempotency_key` | identidad de intención dentro del tenant y tipo de operación |
| `request_checksum` | checksum del payload canónico |
| `expected_sale_version` | versión usada para detectar elegibilidad concurrente |
| `correlation_id`, `causation_id` | correlación transversal y causa original cuando aplique |
| `requested_at`, `approved_at`, `completed_at`, `created_at`, `updated_at` | evidencias temporales coherentes con el estado; no resuelven concurrencia |
| `version` | control optimista de transiciones |

Precios, bases, impuestos, descuentos, costos e importes comerciales de la devolución usan decimal exacto `numeric(19,6)` en PostgreSQL y texto decimal canónico de escala 6 en SQLite. Un importe fiscal/contable usa `(19,2)` solo después del punto de normalización versionado correspondiente. Nunca se convierten a `float`, `REAL` o `number` autoritativo.

Estados persistentes:

- `RETURN_REQUESTED`;
- `RETURN_UNDER_REVIEW`;
- `RETURN_APPROVED`;
- `RETURN_REJECTED`;
- `RETURN_EXECUTION_IN_PROGRESS`;
- `RETURN_PARTIALLY_COMPLETED`;
- `RETURN_COMPLETED`;
- `RETURN_FAILED`;
- `RETURN_REVIEW_REQUIRED`.

`PARTIALLY_RETURNED` y `FULLY_RETURNED` no pertenecen a esta lista: son proyecciones derivadas del acumulado de líneas completadas sobre Sale.

Restricciones documentales:

- `UNIQUE (tenant_id, id)` y FK compuesta a Sale por tenant, company y branch;
- `UNIQUE (operation_id)` y `UNIQUE (tenant_id, operation_type, idempotency_key)` en la frontera de operación;
- mismo idempotency key y checksum devuelve el resultado existente; checksum diferente produce conflicto;
- importes `>= 0`, moneda idéntica y sumas de cabecera iguales a la agregación exacta de líneas;
- ningún importe o cantidad acumulada supera el saldo elegible original;
- estados terminales `RETURN_REJECTED` y `RETURN_COMPLETED` no regresan a estados activos;
- una corrección posterior crea una operación compensatoria; no elimina ni reescribe hechos confirmados;
- sin hard delete ni cascadas desde Tenant, Sale, actor o dispositivo.

## `sales.sale_return_lines` / `sales_sale_return_lines`

Cada línea referencia exactamente una `SaleItem` de la Sale original y congela la evidencia usada para decidir la devolución.

| Campo lógico | Regla |
|---|---|
| `id`, `tenant_id`, `sale_return_id` | identidad UUID v7 y FK tenant-scoped al padre |
| `sale_item_id` | FK a una línea perteneciente a `sale_id` del padre |
| `presentation_id`, `lot_id` | referencias originales; lote opcional cuando el snapshot lo conserve |
| `unit_id` | unidad original de la cantidad vendida |
| `sold_quantity_snapshot` | cantidad vendida original |
| `previously_returned_quantity_snapshot` | acumulado conocido al evaluar |
| `requested_quantity`, `approved_quantity`, `completed_quantity` | cantidades exactas; cada una no supera la anterior ni la elegibilidad restante |
| `physical_condition` | `RESTOCKABLE`, `DAMAGED`, `EXPIRED`, `OPENED`, `QUARANTINE`, `DISCARDED`, `RETURN_TO_SUPPLIER` o `NOT_APPLICABLE` según `UC-SALES-002` |
| `inventory_resolution` | resolución comercial de retorno físico; no crea ni reemplaza InventoryMovement |
| `original_unit_price`, `original_discount_amount`, `original_taxable_amount`, `original_tax_amount`, `original_line_total` | snapshot monetario de SaleItem |
| `requested_return_amount`, `approved_return_amount`, `completed_return_amount`, `returned_tax_amount` | valores exactos atribuibles a esta línea |
| `pricing_snapshot_checksum`, `tax_snapshot_checksum` | evidencia de los snapshots originales cuando exista |
| `created_at`, `updated_at` | evidencia temporal, no autoridad de conflicto |

La cantidad usa decimal exacto de escala de la unidad. `UNIQUE (tenant_id, sale_return_id, sale_item_id)` impide duplicar la misma línea dentro de una devolución; la elegibilidad acumulada entre devoluciones se valida con lock/versionado sobre la Sale y sus retornos aceptados, no con timestamps.

Servicios o líneas sin retorno físico usan `NOT_APPLICABLE`; una política autorizada puede permitir devolución comercial sin restitución. No se inventa una política global de ventana, cambio, crédito o tratamiento de producto: SaleReturn conserva la referencia a la política aplicada y pasa a revisión cuando la evidencia no basta.

## Efectos separados y trazabilidad

La cadena de trazabilidad es:

```text
Sale -> SaleReturn -> Refund/Reversal -> InventoryMovement
                   -> CashMovement     -> ElectronicDocument adjustment
                   -> AuditEvent
```

Cada flecha significa referencia causal, no escritura directa ni obligatoriedad automática.

### Payments y caja

- Efectivo: un Refund confirmado por Payments puede solicitar un CashMovement de salida; requiere caja/turno válidos según política. Una devolución posterior al cierre no reabre ni modifica el turno original y puede requerir otro turno autorizado o revisión.
- Tarjeta, transferencia, QR o pago externo: la operación queda pendiente hasta resultado autenticado del proveedor. Nunca se presume capacidad de reversal ni éxito por solicitud o timeout.
- Crédito: restaurar saldo pertenece al módulo de crédito futuro y no se simula como efectivo.
- Pago mixto: Payments distribuye el Refund de forma determinista conforme a `UC-PAY-004`; Sales no elige ni sobrescribe componentes.
- Un Refund o Reversal conserva FK/referencia causal a SaleReturn cuando esta sea su origen, pero también puede existir sin devolución física cuando la política lo permita.

El futuro `PaymentProviderPort` pertenece a Payments. Este gate no lo crea ni acopla SaleReturn a un proveedor.

### Inventario

- Solo una línea físicamente recibida y clasificada según política puede causar restitución.
- `RESTOCKABLE` puede generar InventoryMovement de entrada a disponible.
- `DAMAGED`, `EXPIRED`, `OPENED`, `QUARANTINE`, `DISCARDED` o `RETURN_TO_SUPPLIER` generan el destino/movimiento explícito que Inventory autorice; nunca aumentan disponible por defecto.
- `NOT_APPLICABLE` y una devolución sin retorno físico no generan entrada.
- El movimiento referencia SaleReturnLine y conserva `operation_id`/idempotencia; no modifica movimientos ni saldos históricos.
- Una corrección crea un movimiento compensatorio nuevo.

### Fiscal

SaleReturn publica la consecuencia comercial y el snapshot fiscal original. Electronic Invoicing decide si corresponde nota crédito, ajuste u otro documento permitido para factura electrónica o documento POS electrónico. El documento correctivo tiene identidad y ciclo propios; estados pendientes, rechazados o inciertos no reescriben Sale ni SaleReturn. No existe acoplamiento directo con DIAN o un proveedor.

## Seguridad, fraude y autorización

Permisos atómicos de Sales:

- `sales.return.request`;
- `sales.return.approve`;
- `sales.return.execute`;
- `sales.return.review`;
- `sales.return.read`.

Refund utiliza `payments.refund.*` y Reversal `payments.reversal.*`. Ningún permiso de Sales concede permisos financieros, de inventario, caja o fiscalización.

La autorización deriva tenant, company y branch del contexto autenticado y valida su coincidencia con Sale; IDs del cliente no prueban acceso. Se aplican alcance de sucursal, dispositivo, sesión, permisos versionados, política ABAC, importe/riesgo y estado de la operación. La política puede exigir reautenticación/MFA, aprobación superior y que solicitante, aprobador y ejecutor sean distintos.

Controles obligatorios:

- venta inexistente, no completada o de otro tenant: denegación sin filtrar existencia cross-tenant;
- cantidad o importe superior al elegible: rechazo o revisión explícita;
- precio, impuesto, moneda o snapshot manipulados: conflicto y auditoría;
- replay local/central: deduplicación por operación, idempotencia y checksum;
- devolución o Refund duplicados: unicidad y elegibilidad acumulada;
- operación tardía tras cierre de caja: no inserta en el turno cerrado; aplica política autorizada o revisión;
- actor sin permiso, sesión revocada, dispositivo inválido o self-approval prohibido: denegación con código estable;
- no se registran PAN, secretos, tokens, credenciales fiscales ni payloads sensibles innecesarios.

## Frontera transaccional y local-first

### Origen local

Dentro de una transacción SQLite:

1. valida contexto cerrado, permiso offline vigente, licencia/dispositivo y snapshot de Sale;
2. reserva `operation_id`, idempotency key y checksum;
3. valida versión, líneas y elegibilidad local conocida;
4. inserta SaleReturn y líneas en el estado autorizado;
5. registra AuditEvent local y OutboxEntry;
6. confirma todo o revierte todo.

Si la Sale original aún no fue sincronizada, SaleReturn declara su `operation_id` como `causation_id` y queda `WAITING_FOR_DEPENDENCY` hasta que la causa sea aceptada. Si ya fue sincronizada, conserva su identidad y expected version central conocida.

### Recepción central

Dentro de una transacción PostgreSQL:

1. valida inbox, tenant, dispositivo, permiso, idempotencia, checksum y dependencia;
2. bloquea/verifica Sale y elegibilidad acumulada por SaleItem;
3. acepta la misma intención una vez, rechaza una imposibilidad o crea conflicto/revisión;
4. persiste resultado, auditoría, eventos y confirmación de inbox juntos.

Dos dispositivos devolviendo la misma cantidad nunca se resuelven por último timestamp. El servidor acepta únicamente cantidades todavía elegibles en el orden causal/autoritativo confirmado; una intención incompatible queda `CONFLICT`, `SERVER_REJECTED` o `REVIEW_REQUIRED` con evidencia. Un rechazo central no borra el hecho local: conserva resultado, detiene efectos dependientes no confirmados y exige revisión o compensación explícita. La recuperación reenvía la misma operación, key, checksum y payload.

## Auditoría, eventos y observabilidad futura

Cada solicitud, aprobación, rechazo, inicio, finalización parcial/completa, fallo, conflicto y revisión crea auditoría append-only con tenant, company, branch, actor, dispositivo, acción, SaleReturn, Sale original, motivo, resultado, instante local reportado, timestamp de servidor, `operation_id`, `correlation_id`, `causation_id`, policy version y checksum. Before/after se conserva para transiciones cuando corresponda, sin guardar secretos ni evidencia sensible completa.

Eventos de Sales:

- `SaleReturnRequested`;
- `SaleReturnApproved`;
- `SaleReturnRejected`;
- `SaleReturnStarted`;
- `SaleReturnPartiallyCompleted`;
- `SaleReturnCompleted`;
- `SaleReturnFailed`;
- `SaleReturnReviewRequired`.

Refund/Reversal emiten eventos propios de Payments. Inventory, Cash Register y Electronic Invoicing emiten sus eventos al confirmar sus respectivos hechos. Todos conservan causación y son idempotentes.

Los mismos puntos semánticos permiten instrumentar posteriormente inicio, aprobación, rechazo, confirmación, conflicto, retry, rechazo de sincronización, fallo financiero y cambio fiscal. Logs, métricas y trazas no sustituyen AuditEvent y este gate no crea puertos de observabilidad.

## Pruebas obligatorias posteriores

1. SaleReturn solo referencia Sale `COMPLETED` del mismo tenant/company/branch.
2. IDs libres no permiten descubrir ni devolver una Sale de otro tenant.
3. devolución parcial/total y acumulados no exceden cantidad ni valor elegibles;
4. reintento y replay no duplican SaleReturn, Refund, movimiento de inventario o caja;
5. dos dispositivos sobre la misma línea producen una única aceptación compatible y conflicto/revisión para el exceso;
6. estados persistentes no se mezclan con `PARTIALLY_RETURNED`/`FULLY_RETURNED`;
7. Refund/Reversal y SaleReturn conservan ownership y permisos separados;
8. snapshots originales sobreviven cambios posteriores de precio o impuesto;
9. importes y cantidades usan decimal exacto en ambos dialectos;
10. condición física determina si existe y a qué destino va el movimiento, sin mutar historial;
11. caja cerrada, proveedor externo incierto y fiscal rechazado conservan efectos separados y revisables;
12. operación local con causa pendiente espera dependencia y recupera sin duplicación;
13. self-approval, falta de reautenticación, permiso ausente y alcance de sucursal inválido se rechazan;
14. auditoría, outbox, causación y eventos conservan identidad y tenant.

## Migración heredada

Una devolución heredada se materializa como SaleReturn histórico solo si existe evidencia inequívoca de Sale, SaleItem, cantidad, tenant/company/branch, instante y resultado comercial. Refund, Reversal, InventoryMovement, CashMovement y efecto fiscal se migran únicamente con evidencia independiente; nunca se infieren por la mera existencia de la devolución.

Registros sin desglose de línea, pago mixto sin componentes, totales inconsistentes, retorno de inventario no demostrable, tenant no asignable o operación que parece anulación se preservan como evidencia y pasan a cuarentena/revisión. No se inventan idempotency keys históricas, estados, aprobadores, impuestos, condición física ni resultados externos.

## Condición de cierre

`PHY-G08` queda cerrado tras alinear modelo conceptual, estados/proyecciones, ownership, permisos, eventos, reglas, glosario, migración y trazabilidad con este contrato. El cierre no inicia `PHY-G09` ni autoriza DDL o migraciones; la primera migración mantiene su gate independiente `NO-GO`.

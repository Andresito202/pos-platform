# TECH-002 R2-B: contrato físico base de Sales

## Estado y alcance

`CLOSED` documentalmente dentro de `TECH-002 / R2-B`.

Este contrato materializa `Sale` y `SaleItem` sin DDL. Aplica `UC-SALES-001`, `UC-SALES-002`, `DEC-003`, `DEC-004`, `DEC-006`, `DEC-007`, `DEC-008`, las convenciones físicas y el contrato ya cerrado de `SaleReturn`. `SaleItem` es el nombre canónico; no se crea un alias físico `SaleLine`.

Sales conserva el hecho comercial histórico. Pricing y Tax producen resultados que Sales congela; Payments, Cash, Inventory y Electronic Invoicing conservan sus propios agregados y solo referencian la venta. Una venta completada nunca se recalcula con catálogo, precio, impuesto o política vigente posterior.

## Ubicación y autoridad

| Agregado | PostgreSQL / SQLite | Clase | Autoridad |
|---|---|---|---|
| Sale | `sales.sales` / `sales_sales` | `LOCAL_AUTHORITATIVE_SYNCED` para operación POS permitida | POS Local Service hasta aceptación central |
| SaleItem | `sales.sale_items` / `sales_sale_items` | detalle del agregado Sale | misma transacción y autoridad de Sale |

No se crea una tabla separada `SaleTotals`: los totales autoritativos y las referencias a snapshots pertenecen a Sale; el detalle reproducible pertenece a SaleItem. Una proyección de consulta puede derivarlos, pero no sustituye el hecho.

## `sales.sales` / `sales_sales`

| Columna | Tipo lógico | Regla |
|---|---|---|
| `id` | UUID v7 | PK global, mismo valor local/central |
| `tenant_id`, `company_id`, `branch_id` | UUID | scope obligatorio y FK compuestas |
| `cash_register_id`, `cash_shift_id` | UUID nullable | presentes cuando la operación exige caja; mismo tenant/branch |
| `origin_device_id`, `installation_id` | UUID | dispositivo/terminal POS e instalación autorizados; no se inventa agregado Terminal separado |
| `operator_actor_type`, `operator_actor_id` | actor | actor autorizado; la identidad se revalida, no se toma de UI |
| `customer_id` | UUID nullable | referencia tenant-aware cuando Customer sea admitido físicamente; venta anónima permitida |
| `channel` | texto estable | canal normativo, no nombre de hardware o proveedor |
| `status` | texto estable | solo estados persistentes aprobados |
| `business_date` | fecha | congelada al confirmar según sucursal |
| `timezone_id`, `utc_offset_minutes` | tiempo local | evidencia del contexto de negocio |
| `document_series`, `sale_number` | texto / entero | consecutivo humano no reutilizable; no es PK ni consecutivo fiscal |
| `currency_code` | CHAR(3) | una moneda para venta y grupo de pagos |
| `subtotal_amount`, `discount_amount`, `tax_amount` | dinero `(19,6)` | componentes exactos no negativos |
| `fiscal_total_amount` | dinero `(19,6)` | resultado previo al redondeo comercial |
| `commercial_rounding_adjustment` | dinero `(19,6)` | único ajuste documentario permitido |
| `payable_amount` | dinero `(19,6)` | total exigible congelado |
| `pricing_pipeline_version`, `pricing_policy_version` | versión | versión exacta aplicada |
| `promotion_policy_version` | versión nullable | solo cuando aplicó |
| `tax_policy_version`, `rounding_policy_version` | versión | versiones exactas aplicadas |
| `pricing_snapshot` | snapshot versionado | JSON inmutable con schema/checksum, no dumping ground |
| `tax_snapshot` | snapshot versionado | resultado tributario inmutable producido por Tax |
| `calculation_checksum` | checksum | entradas y resultado canónicos |
| `operation_id` | UUID v7 | FK 1:1 a `SyncOperation` para origen local sincronizable |
| `idempotency_key`, `request_checksum` | texto | idempotencia por tenant/dispositivo/operación |
| `correlation_id`, `causation_id` | UUID | causalidad; causation nullable solo para raíz |
| `version` | entero | concurrencia optimista |
| `created_at`, `completed_at`, `cancelled_at`, `expired_at` | instante | coherentes con lifecycle |
| `server_recorded_at` | instante nullable | aceptación central, no sustituye tiempo de negocio |

Estados permitidos: `DRAFT`, `SUSPENDED`, `READY_FOR_PAYMENT`, `PAYMENT_IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `EXPIRED`. Estados de devolución, pago, fiscalización o sync no se copian a `Sale.status`.

Constraints mínimos:

- `UNIQUE (tenant_id, id)` y candidate keys con company/branch para toda FK dependiente;
- FK compuestas a Branch, Device, Installation, caja/turno cuando existan y operación Sync;
- `UNIQUE (tenant_id, branch_id, document_series, sale_number)` y no reutilización;
- `UNIQUE (tenant_id, origin_device_id, idempotency_key)`; mismo checksum retorna el resultado y otro checksum entra en conflicto;
- todos los componentes monetarios usan representación exacta; `payable_amount` concilia con el pipeline y el único ajuste de redondeo;
- Sale completada conserva snapshots, versiones y checksum y no admite edición destructiva;
- `customer_id` no autoriza Customer ni entra a la primera migración mientras `CUST-001` siga diferido: el adaptador omite la FK/columna hasta admitir ese agregado, sin texto libre sustituto.

## `sales.sale_items` / `sales_sale_items`

| Columna | Tipo lógico | Regla |
|---|---|---|
| `id`, `tenant_id`, `sale_id` | UUID v7 / UUID | identidad y FK compuesta a Sale |
| `line_number` | entero positivo | único dentro de Sale |
| `product_id`, `variant_id`, `presentation_id` | UUID | identidad vendible; variant nullable |
| `product_name_snapshot`, `presentation_name_snapshot` | texto | nombres mostrables estrictamente necesarios |
| `identifier_snapshot` | texto nullable | código utilizado, no todos los identificadores del producto |
| `unit_id`, `unit_code_snapshot`, `unit_precision_snapshot` | referencia/snapshot | unidad y precisión aplicadas |
| `quantity` | decimal `(19,6)` | positiva y válida para la unidad |
| `unit_price_amount`, `gross_amount` | dinero `(19,6)` | precio y bruto congelados |
| `discount_amount`, `taxable_amount`, `tax_amount`, `line_total_amount` | dinero `(19,6)` | resultado exacto por línea |
| `pricing_resolution_snapshot` | snapshot versionado | candidatas, regla elegida, desempate y resultado necesarios |
| `tax_calculation_snapshot` | snapshot versionado | clasificación, tasas, bases, residuos y resultado necesarios |
| `lot_id` | UUID nullable | evidencia de asignación cuando Inventory la exige; no hace a Sales dueño del lote |
| `measurement_source_type`, `measurement_evidence_snapshot`, `measurement_evidence_checksum` | evidencia nullable | medición validada, con schema explícito y contenido allowlisted |

Constraints: `UNIQUE (tenant_id, sale_id, line_number)`, FKs tenant/company-aware a Product/Variant/Presentation/Unit, coherencia Product→Variant→Presentation, cantidades y dinero exactos, y conciliación de líneas con totales de Sale. El snapshot no copia descripción completa, atributos comerciales abiertos, stock actual, costo vigente ni datos específicos de un sector comercial.

## Productos pesables y hardware

La unidad y precisión de `ProductPresentation` determinan si la cantidad admite fracción. `quantity` sirve para unidad, masa, volumen y otras dimensiones aprobadas; Product no recibe campos universales de peso. Una medición futura entra por `MeasurementPort`, se valida contra unidad, precisión, tara, rango, dispositivo confiable y política aplicable, y Sales conserva solo cantidad validada y referencia/evidencia sanitizada.

Escáner, báscula, impresora, cajón y display son adapters externos al dominio. La impresión local ocurre después del commit y su fallo no invalida Sale. Ningún SDK, marca, modelo, PAN, secreto o payload de dispositivo se incorpora a estas tablas.

## Relaciones y fronteras transaccionales

- Sale `1:N` SaleItem.
- Sale `1:0..N` PaymentAllocation por el puerto de Payments; Sales no escribe Payments.
- Sale `1:0..N` InventoryMovement por referencia tipada; Inventory es propietario.
- Sale `1:0..N` SaleReturn y `1:0..N` ElectronicDocument; cada módulo conserva lifecycle propio.
- Pago confirmado no implica aceptación fiscal y aceptación fiscal no confirma pago.

Completar una venta local confirma, en un solo commit SQLite: Sale, items, snapshots, transición final, resultado idempotente, AuditEvent, `SyncOperation` y Outbox 1:1. Los movimientos de inventario y efectivo permitidos que sean efecto indispensable comparten la unidad de trabajo de aplicación mediante puertos propietarios; no se escriben tablas ajenas por acceso directo. Un proveedor remoto, fiscalización, impresión o sync nunca participa en una transacción distribuida.

La recepción central inserta Inbox, revalida tenant, dispositivo, licencia, autorización, cálculo y versiones, y acepta/rechaza con efectos en una transacción PostgreSQL. Un rechazo conserva el hecho local y produce revisión o compensación explícita.

## Seguridad, sync, auditoría y observabilidad futura

Servidor/POS Local Service deriva tenant, actor y permisos desde contexto confiable y recalcula totales a partir de entradas y snapshots autorizados. Renderer, PWA, sync, webhook y hardware son no confiables. RLS central y FKs compuestas respaldan `SEC-G01`; sesiones/revocación `SEC-G02`; RBAC/ABAC/MFA/reauth `SEC-G03`; device/license `SEC-G04`; firma/replay/idempotencia `SEC-G05`; AuditEvent append-only y señales antifraude `SEC-G06`; secretos/cifrado `SEC-G07`; validación de fronteras `SEC-G08`; recuperación `SEC-G09`; release fail-closed `SEC-G10`.

Puntos futuros: `LoggerPort` para fallos sanitizados, `MetricsPort` para latencia, volumen, discrepancias y conflictos, y `AuditPort` para creación, suspensión, recuperación, finalización y cancelación. No alteran decisiones de dominio.

## Pruebas futuras obligatorias

Incluyen aislamiento cross-tenant, FK company/branch/device, estados y concurrencia, idempotencia/checksum, exactitud y conciliación monetaria en ambos dialectos, snapshots históricos ante cambio de precio/impuesto, venta ponderada con precisión inválida/válida, input manipulado, offline y reenvío, efecto atómico con inventario/caja, pago y fiscalización independientes, y RLS sin contexto.

## Resultado

Sales base queda cerrado para R2-B sin DDL, Customer físico, hardware ni implementación. Las pruebas por dialecto y revisión R3 permanecen pendientes.

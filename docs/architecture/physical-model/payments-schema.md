# TECH-002 R2-B: contrato físico base de Payments

## Estado y alcance

`CLOSED` documentalmente dentro de `TECH-002 / R2-B`, sin DDL ni adapters.

Este contrato completa `PaymentGroup`, `Payment`, `PaymentAllocation`, `PaymentAttempt` y `Refund`; reutiliza el contrato cerrado de `Reversal`, `Settlement` y `Reconciliation`. `PAY-007` es la única autoridad de estados. Payments representa cobros de clientes, no pagos a proveedores. Pago aprobado, venta completada y documento fiscal aceptado son decisiones independientes.

## Ubicación, autoridad y neutralidad

| Agregado | PostgreSQL / SQLite | Autoridad |
|---|---|---|
| PaymentGroup, Payment, Allocation | `payments.*` / `payments_*` | por método y operación según `DEC-007` |
| PaymentAttempt | `payments.payment_attempts` / `payments_payment_attempts` | efectivo/manual local permitido; resultado remoto `EXTERNAL_PROVIDER_AUTHORITATIVE` |
| Refund | `payments.refunds` / `payments_refunds` | operación compensatoria; proveedor cuando sea remoto |
| Reversal, Settlement, Reconciliation | contrato `payment-financial-operations-schema.md` | según agregado y provider authority |

`payment_method` usa abstracciones de dominio como `CASH`, `CARD`, `TRANSFER`, `QR`, `CUSTOMER_CREDIT` cuando el caso de uso lo autoriza. `provider_code` y referencias externas identifican un adapter/configuración; no convierten Bold, Wompi, Mercado Pago, adquirentes, datáfonos o QR en entidades del core. Efectivo no requiere un proveedor ficticio.

## `payments.payment_groups` / `payments_payment_groups`

Columnas: `id`, `tenant_id`, `company_id`, `branch_id`, `collection_subject_type`, `collection_subject_id`, `currency_code`, `expected_payable_amount numeric(19,6)`, `idempotency_key`, `request_checksum`, `correlation_id`, `causation_id NULL`, `created_at`.

El status y la cobertura son proyecciones derivadas de allocations/pagos confirmados; no se persiste un alias mutable. Para Sale, la referencia se valida por puerto tenant/company/branch-aware. `UNIQUE (tenant_id, branch_id, collection_subject_type, collection_subject_id)` impide grupos paralelos salvo caso de uso futuro explícito.

## `payments.payments` / `payments_payments`

| Columna | Tipo lógico | Regla |
|---|---|---|
| `id`, `tenant_id`, `company_id`, `branch_id` | UUID v7 / UUID | identidad y scope |
| `payment_group_id` | UUID | FK compuesta |
| `payment_method` | texto estable | abstracción neutral |
| `expected_amount`, `confirmed_amount` | dinero `(19,6)` | exacto, no negativo |
| `currency_code` | CHAR(3) | igual al grupo |
| `status` | texto estable | solo `CREATED`, `PENDING`, `PARTIALLY_CONFIRMED`, `CONFIRMED`, `FAILED`, `CANCELLED`, `REVIEW_REQUIRED` |
| `authority_type` | texto estable | local, central o proveedor externo según operación |
| `origin_device_id`, `operator_actor_type`, `operator_actor_id` | identidad | contexto confiable |
| `idempotency_key`, `request_checksum` | texto | deduplicación |
| `correlation_id`, `causation_id` | UUID | trazabilidad |
| `version` | entero | concurrencia optimista |
| `created_at`, `confirmed_at`, `server_recorded_at` | instante | evidencia temporal |

`SETTLED`, `RECONCILED`, `REFUNDED`, `REVERSED` y `CHARGEDBACK` son proyecciones/otros agregados, nunca `Payment.status`. Constraints incluyen FKs tenant/company/branch-aware, `UNIQUE (tenant_id, origin_device_id, idempotency_key)` y conciliación de importes conforme a `PAY-007`.

## `payments.payment_allocations` / `payments_payment_allocations`

Columnas: `id`, `tenant_id`, `payment_group_id`, `payment_id`, `collection_subject_type`, `collection_subject_id`, `amount numeric(19,6)`, `currency_code`, `allocation_sequence`, `created_at`.

Constraints: grupo y Payment del mismo tenant/company/branch/moneda; importe positivo; `UNIQUE (tenant_id, payment_id, allocation_sequence)`; suma asignada no supera el efecto confirmado elegible. La referencia tipada evita acoplar Payments internamente a tablas ajenas y se valida mediante el puerto propietario.

## `payments.payment_attempts` / `payments_payment_attempts`

Columnas: `id`, `tenant_id`, `company_id`, `branch_id`, `payment_id`, `attempt_number`, `payment_method`, `provider_configuration_version_id NULL`, `provider_code NULL`, `provider_reference_type NULL`, `provider_reference NULL`, `amount numeric(19,6)`, `currency_code`, `status`, `authority_type`, `intent_reference NULL`, `manual_confirmation_actor_id NULL`, `evidence_schema_version`, `evidence_snapshot NULL`, `evidence_checksum NULL`, `error_code NULL`, `retry_classification NULL`, `idempotency_key`, `request_checksum`, `correlation_id`, `causation_id NULL`, `initiated_at`, `provider_reported_at NULL`, `confirmed_at NULL`, `server_recorded_at NULL`, `version`.

Los estados son exactamente los de `PaymentAttemptStatus` en `PAY-007`; no se crean aliases. Referencia externa es única por `(tenant_id, provider_code, provider_reference_type, provider_reference)` cuando está presente. El snapshot de evidencia es allowlisted, versionado, sanitizado y nunca contiene PAN completo, CVV/CVC, track data, PIN, API keys, tokens utilizables, firmas privadas ni payload bruto innecesario.

Un intento QR/remoto puede permanecer pendiente o con resultado incierto. Webhook y polling son entradas no confiables al adapter: verifican autenticidad, replay, provider reference, amount, currency, tenant/configuración y transición antes de producir el estado autoritativo. El frontend jamás envía éxito financiero autoritativo.

## `payments.refunds` / `payments_refunds`

Columnas: `id`, `tenant_id`, `company_id`, `branch_id`, `payment_id`, `sale_return_id NULL`, `requested_amount`, `completed_amount`, `currency_code`, `status`, `reason_code`, `requested_by_actor_id`, `approved_by_actor_id NULL`, `provider_configuration_version_id NULL`, `provider_reference NULL`, `evidence_snapshot NULL`, `idempotency_key`, `request_checksum`, `correlation_id`, `causation_id`, `version`, timestamps de solicitud/aprobación/finalización y `server_recorded_at NULL`.

Refund consume saldo confirmado elegible sin reescribir Payment o Sale. Sus estados son los de `RefundStatus`; aprobación, reverso técnico y devolución comercial no se fusionan. Importes exactos, segregación de funciones, idempotencia y evidencia son obligatorios.

`payments.refund_items` / `payments_refund_items` conserva `id`, `tenant_id`, `refund_id`, `payment_allocation_id`, `sale_return_line_id NULL`, `amount`, `currency_code` y `item_sequence`. FKs compuestas mantienen scope; `UNIQUE (tenant_id, refund_id, item_sequence)` y los acumulados no superan la elegibilidad confirmada. El detalle no copia estados, payloads ni snapshots completos de Sale.

## Fronteras transaccionales y fallos parciales

- crear grupo/pago/intento local: agregado, resultado idempotente, AuditEvent, `SyncOperation` y Outbox 1:1 en un commit;
- efectivo confirmado: Payment/Attempt/Allocation y CashMovement propietario se coordinan en una unidad de trabajo local, sin acceso directo entre repositories;
- transición autoritativa: lock/expected version, transición, evidencia, allocation/proyección aplicable, AuditEvent y outbox en un commit;
- Refund/Reversal: agregado compensatorio, consumo de elegibilidad, evidencia, audit/outbox en un commit;
- Settlement/Reconciliation siguen su contrato cerrado.

La llamada a proveedor nunca comparte transacción de base de datos. Antes de invocarla se persiste intención recuperable; timeout conserva identidad y resultado incierto. Callback tardío usa el mismo attempt/reference. Reintentar no crea otro cobro por conveniencia.

## Local-first y sync

Efectivo y transfer/QR manual reportado pueden originarse localmente cuando licencia, permiso, caja y policy lo permiten. Confirmación bancaria, captura remota, settlement y reconciliation requieren autoridad externa/central; offline no finge éxito. Cada comando sincronizable referencia un único `SyncOperation` y Outbox; central Inbox deduplica sin copiar payload. Payment no sincroniza bidireccionalmente por timestamp.

## Seguridad y observabilidad futura

Todas las fronteras revalidan tenant, actor, sesión, dispositivo, licencia, método, importe, moneda y transición. MFA/reauth/segregación aplican por riesgo; rate limiting, validación de webhook, allowlists de red/egress y referencias secretas opacas corresponden a `SEC-G02/03/07/08/09`. RLS/FKs cubren `SEC-G01`, autenticidad/replay `SEC-G04/05`, antifraude/audit `SEC-G06` y release `SEC-G10`.

`LoggerPort`, `MetricsPort` y `AuditPort` observarán intentos, latencia, timeout, duplicados, transiciones, refunds, conciliación y señales de fraude; nunca deciden el estado financiero.

## Pruebas futuras obligatorias

Cross-tenant, exactitud monetaria, estados/aliases prohibidos, pago mixto y asignación, idempotencia concurrente, referencia externa duplicada, timeout/callback tardío, webhook falso/replay, efectivo offline, QR sin confirmación inventada, provider mismatch, refund concurrente, PAN/CVV/secreto ausentes, pago confirmado independiente de fiscalización y equivalencia PostgreSQL/SQLite.

## Resultado

Payments base queda cerrado para R2-B y permanece neutral a proveedor. Customer Credit físico continúa diferido por `CUST-002`/`PAY-009`; el método no autoriza crear sus agregados anticipadamente. La política ya no está en el aire: `DEC-005` la ratificó —el crédito cubre la venta y la obligación se registra en un agregado separado—, pero ratificar no es materializar y la prohibición de adelantarse sigue vigente hasta que `CUST-002` exista.

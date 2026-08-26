# TECH-002I: contrato físico documental de Reversal, Settlement y Reconciliation

## Estado y alcance

`CLOSED` dentro de `TECH-002` para `PHY-G09`.

Este documento cierra únicamente el contrato físico documental de `Reversal`, `Settlement` y `Reconciliation`. No contiene DDL, SQL ejecutable ni migraciones y no declara implementadas estas capacidades. Al cerrar este gate, la primera migración objetivo permanecía en `NO-GO`; su evolución posterior se registra en `traceability.md` y `../../product/backlog.md`.

Fuentes: `UC-PAY-004`, `UC-PAY-005`, `PAY-007`, `DEC-002`, `DEC-007`, `DEC-008`, modelo conceptual, ownership, ciclo de pagos, reglas de negocio, glosario, catálogo de eventos, matriz de permisos, contratos de integración y convenciones físicas.

## Separación de conceptos y ownership

| Concepto | Propietario | Regla |
|---|---|---|
| `Payment`, `PaymentAttempt` | Payments | hechos financieros originales; no se reescriben para cuadrar liquidación o conciliación |
| `Reversal` | Payments | reversión técnica permitida por el proveedor o subsistema antes de liquidación definitiva |
| `Refund` | Payments | devolución financiera posterior; no es Reversal ni devolución comercial |
| `Settlement` | Payments | reconocimiento y liquidación de componentes financieros por una fuente |
| `Reconciliation` | Payments | ejecución que compara snapshots internos y externos y conserva diferencias |
| alcance o periodo | contexto inmutable de `Reconciliation` | snapshot de filtros, cortes y fuentes; no es agregado con máquina de estados propia |
| item de conciliación | Payments | resultado individual de matching; su estado no amplía `ReconciliationStatus` |
| incidencia de conciliación | Payments | investigación y resolución de una diferencia; conserva estados propios |
| `SaleReturn` | Sales | devolución comercial; no confirma Reversal, Refund ni Reconciliation |
| `CashMovement` | Cash Register | único hecho que cambia efectivo esperado |
| efecto fiscal | Electronic Invoicing | documento o corrección fiscal independiente del resultado financiero |

Payments no modifica retrospectivamente Sales, Cash Register, Inventory o Electronic Invoicing. Los módulos se relacionan por identidades globales, contratos y eventos con `correlation_id` y `causation_id`.

## Ubicación, autoridad y provider authority

| Agregado | PostgreSQL central | SQLite local | Clasificación DEC-007 |
|---|---|---|---|
| Reversal | consolida y valida; el proveedor o subsistema original decide el resultado externo | puede originar solicitud autorizada y conservar estado pendiente | `EXTERNAL_AUTHORITY` para resultado externo; nunca last-write-wins |
| Settlement | fuente consolidada y verificable con evidencia del proveedor, caja o banco | captura o importa evidencia permitida sin declararla conciliada | `CENTRAL_REVIEW_REQUIRED` cuando exista conflicto |
| Reconciliation | autoridad sobre ejecución, cierre y reapertura | puede preparar snapshots o resultados locales autorizados, sujetos a consolidación | `CENTRAL_REVIEW_REQUIRED` para cierre, reapertura y conflicto |

Un dispositivo, callback, archivo o timestamp no es autoridad por sí mismo. Una respuesta incierta permanece en un estado explícito y se resuelve mediante consulta autoritativa, evidencia autenticada o revisión. La identidad de proveedor, referencias externas y evidencia siempre se validan dentro del mismo tenant.

## Agregado `payments.reversals` / `payments_reversals`

| Campo lógico | Regla |
|---|---|
| `id` | UUID v7 global y estable |
| `tenant_id`, `company_id`, `branch_id` | obligatorios y coincidentes con Payment e intento originales |
| `payment_id`, `payment_attempt_id` | referencias tenant-scoped al origen; el intento es obligatorio cuando la reversión depende de una autorización concreta |
| `provider_id`, `provider_configuration_id` | referencias al proveedor y configuración efectiva del mismo tenant; nunca credenciales |
| `provider_operation_reference` | referencia externa normalizada; no concede autoridad sin evidencia |
| `requested_amount`, `completed_amount`, `currency_code` | importes exactos; completado no supera solicitado ni saldo reversible |
| `reason_code`, `reason_detail` | motivo estable y detalle opcional sanitizado |
| `status` | `REQUESTED`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`, `UNKNOWN` o `REVIEW_REQUIRED`, según `PAY-007` |
| `requested_by_actor_id`, `approved_by_actor_id` | actores y segregación exigidos por política |
| `provider_evidence_reference`, `provider_evidence_hash` | localizador seguro y huella de evidencia inmutable; nunca secreto o dato sensible de tarjeta |
| `provider_result_code` | resultado normalizado sin convertir mensajes libres en contrato |
| `operation_id`, `idempotency_key`, `request_checksum` | identidad sincronizable y deduplicación de intención |
| `correlation_id`, `causation_id` | trazabilidad causal |
| `requested_at`, `processing_at`, `completed_at`, `created_at`, `updated_at` | evidencia temporal; no resuelve autoridad o conflicto |
| `version` | control optimista de transiciones |

Invariantes:

- una Reversal solo existe si el proveedor o subsistema declara capacidad real y el estado original es reversible;
- después de liquidación definitiva la política normal es Refund;
- `COMPLETED` exige evidencia autoritativa y solo incrementa la proyección `reversed_amount` por el importe confirmado;
- `UNKNOWN` o una evidencia contradictoria no se convierte en éxito y genera consulta o incidencia;
- Reversal no elimina ni cambia el importe histórico de Payment, PaymentAttempt o Sale;
- el importe reversible se reserva y consume de forma concurrente e idempotente, sin doble consumo con Refund;
- una corrección genera nueva transición, intento o hecho compensatorio; no hard delete.

## Agregado `payments.settlements` / `payments_settlements`

| Campo lógico | Regla |
|---|---|
| `id`, `tenant_id`, `company_id` | identidad global y frontera obligatoria; `branch_id` es snapshot opcional solo para alcance de sede |
| `provider_id`, `provider_configuration_id`, `account_reference` | fuente y configuración tenant-scoped; la referencia no contiene secretos |
| `external_settlement_reference`, `batch_reference` | identidad externa normalizada y deduplicable dentro de fuente/tenant |
| `currency_code` | moneda única de todos los componentes del Settlement |
| `period_start`, `period_end`, `cutoff_at`, `timezone` | snapshot temporal de la fuente; no crea otra máquina de estados |
| `gross_amount` | bruto exacto reportado por la fuente |
| `fee_amount` | comisiones exactas, separadas del Payment |
| `withholding_amount` | retenciones exactas |
| `refunded_amount` | refunds incluidos en el reporte |
| `reversed_amount` | reversals incluidos en el reporte, con semántica explícita respecto del bruto |
| `chargeback_amount` | contracargos incluidos |
| `positive_adjustment_amount`, `negative_adjustment_amount` | ajustes en componentes separados |
| `net_amount` | resultado exacto reportado o calculado según política congelada |
| `gross_reversal_treatment` | declara `INCLUDES_LATER_REVERSED_OPERATIONS` o `ALREADY_NET_OF_REVERSALS` |
| `calculation_policy_version` | versión obligatoria de la política aplicada |
| `calculation_inputs_snapshot` | entradas exactas y normalizadas usadas en el cálculo, incluido el tratamiento del bruto |
| `calculated_net_amount` | resultado reproducible de la política, separado del neto reportado cuando difieran |
| `provider_evidence_reference`, `provider_evidence_hash` | evidencia original inmutable y verificable |
| `status` | estado tipado de `SettlementStatus` definido por `PAY-007` |
| `operation_id`, `idempotency_key`, `request_checksum`, `correlation_id`, `causation_id`, `version` | idempotencia, causalidad y concurrencia |

No existe fórmula universal implícita. La política versionada decide si `reversed_amount` se resta: cuando `gross_amount` ya viene neto de reversals, restarlo otra vez es inválido. Cada cálculo conserva política, entradas, tratamiento del bruto, evidencia y resultado. Ningún ajuste de Settlement modifica Payment histórico.

`SettlementItem` relaciona de forma tenant-scoped un Settlement con Payment, Refund, Reversal, Chargeback u otro componente autorizado; conserva importe aplicado, moneda, referencia de fuente y versión. Un pago puede participar en varios settlements únicamente por liquidación parcial explícita, y la suma aplicada no puede consumir dos veces el mismo importe.

## Agregado `payments.reconciliations` / `payments_reconciliations`

| Campo lógico | Regla |
|---|---|
| `id`, `tenant_id`, `company_id` | identidad global y aislamiento obligatorio |
| `branch_id` | opcional solo si el alcance congelado es de sede; siempre del mismo tenant/company |
| `status` | uno de los estados exactos y exclusivos definidos abajo |
| `scope_type`, `scope_snapshot` | turno, día operativo, lote, periodo bancario/contable o rango autorizado, con filtros exactos |
| `period_start`, `period_end`, `cutoff_at`, `timezone` | evidencia temporal congelada; no tiene estado propio |
| `source_snapshot`, `source_evidence_hashes` | fuentes, versiones, hashes y cortes usados en la ejecución |
| `matching_policy_version`, `tolerance_policy_version` | políticas deterministas aplicadas |
| `expected_amount`, `observed_amount`, `difference_amount`, `currency_code` | totales exactos reconstruibles desde items |
| `started_by_actor_id`, `closed_by_actor_id`, `reopened_by_actor_id` | actores de acciones críticas |
| `close_reason`, `reopen_reason` | motivos obligatorios cuando corresponda |
| `operation_id`, `idempotency_key`, `request_checksum`, `correlation_id`, `causation_id`, `version` | idempotencia, replay y concurrencia |
| `started_at`, `closed_at`, `reopened_at`, `created_at`, `updated_at` | auditoría temporal, nunca regla de last-write-wins |

Estados persistentes autoritativos de `ReconciliationStatus`:

- `CREATED`;
- `RUNNING`;
- `REVIEW_REQUIRED`;
- `PARTIALLY_RECONCILED`;
- `RECONCILED`;
- `FAILED`;
- `CANCELLED`;
- `CLOSED`;
- `REOPENED`.

`OPEN` y `PROCESSING` no son estados de Reconciliation. El periodo y el alcance son snapshots del agregado, no agregados con ciclo paralelo.

## Items e incidencias de conciliación

`ReconciliationItem` conserva la relación entre una entrada interna y evidencia externa, referencias, importes esperado/observado/diferencia, moneda, regla de matching, confianza explicable, decisión y versión. Sus estados permanecen separados:

- `MATCHED`;
- `MATCHED_WITH_TOLERANCE`;
- `UNMATCHED_INTERNAL`;
- `UNMATCHED_EXTERNAL`;
- `DIFFERENCE_DETECTED`;
- `REVIEW_REQUIRED`;
- `ADJUSTMENT_REQUIRED`;
- `EXCLUDED`.

`ReconciliationIncident` conserva severidad, responsable, evidencia, motivo, decisión, ajuste relacionado y auditoría append-only. Sus estados separados son:

- `OPEN`;
- `ASSIGNED`;
- `UNDER_REVIEW`;
- `WAITING_EXTERNAL_EVIDENCE`;
- `ADJUSTMENT_REQUIRED`;
- `RESOLVED`;
- `ACCEPTED_DIFFERENCE`;
- `REJECTED`;
- `CLOSED`.

Resolver o aceptar una incidencia nunca modifica Payment, Settlement, extracto o evidencia originales. Los ajustes son hechos separados y una diferencia material no se oculta mediante tolerancia genérica.

## Dinero exacto e integridad

Payment, Refund, Reversal y todos los componentes de Settlement (`gross`, fees, retenciones, refunded, reversed, chargeback, ajustes y net) usan `numeric(19,6)` en PostgreSQL y texto decimal canónico de escala 6 en SQLite. Tasas o factores autorizados usan `(19,10)`. `(19,2)` se reserva para un valor fiscal/contable normalizado por una etapa explícita y versionada; no es la representación universal del dominio financiero. Nunca se usa `float`, `REAL` ni `number` como valor autoritativo.

Toda reducción de escala conserva punto de redondeo, política/versión, entradas exactas, residuo cuando aplique y resultado. La evidencia del proveedor con dos decimales no obliga a reducir Payment o Settlement histórico.

Las sumas de cabecera deben coincidir exactamente con sus items bajo la política congelada. Toda relación usa `tenant_id` en claves y FKs compuestas; company, branch, proveedor, configuración, Payment y evidencia deben pertenecer al mismo tenant. No hay cascadas destructivas desde Tenant, Company, Branch, Payment, proveedor, actor o dispositivo.

Las identidades externas se deduplican por tenant, proveedor, tipo de fuente y referencia normalizada. Reutilizar una idempotency key con el mismo checksum devuelve el resultado existente; con contenido distinto produce conflicto auditable.

## Seguridad, fraude y permisos

Roles existentes autorizables por política: `OWNER`, `GENERAL_ADMIN`, `BRANCH_MANAGER` y `SUPERVISOR`. Ninguno obtiene acceso solo por nombre de rol: el backend evalúa permiso atómico, tenant, company, branch, recurso, estado, importe, riesgo, sesión, dispositivo y licencia.

Permisos:

- `payments.reversal.request`, `payments.reversal.approve`, `payments.reversal.execute`;
- `payments.settlement.record`, `payments.settlement.read`, `payments.settlement.review`;
- `payments.reconciliation.start`, `payments.reconciliation.read`, `payments.reconciliation.review`, `payments.reconciliation.resolve`, `payments.reconciliation.close`, `payments.reconciliation.reopen`;
- `payments.provider.configure`.

Cierre, reapertura, aceptación o resolución de diferencias y configuración de proveedor exigen motivo y auditoría append-only; la política puede exigir reautenticación reciente, MFA y segregación de funciones. Un actor no aprueba o resuelve su propia acción crítica cuando la política lo prohíbe. Credenciales, secretos de webhook y datos sensibles se almacenan fuera de estos agregados y nunca aparecen en logs, eventos o snapshots.

Señales de fraude mínimas: referencia externa reutilizada, importe o moneda incompatible, evidencia tardía o contradictoria, duplicado, volumen o frecuencia anómala, self-approval, cambio de configuración próximo a la operación y cierre con incidencias materiales. Una señal bloquea, eleva a revisión o exige control reforzado según política versionada; nunca convierte incertidumbre en éxito.

## Integraciones, replay e idempotencia

Las respuestas síncronas, webhooks, callbacks, archivos y consultas de estado ingresan por puertos de Payments. El adaptador futuro debe validar autenticidad, tenant/configuración, firma o mecanismo equivalente, vigencia temporal/nonce cuando aplique, referencia de proveedor y contenido antes de producir evidencia normalizada.

El inbox deduplica por identidad de evento del proveedor y checksum, conserva resultado de procesamiento y tolera reentrega. El outbox publica cambios confirmados dentro de la transacción local. Un evento duplicado no crea otra Reversal, Settlement, conciliación, item, incidencia o ajuste. Un evento tardío o contradictorio no reescribe un estado cerrado: genera revisión, reapertura autorizada o hecho compensatorio.

La configuración de capacidades del proveedor distingue, como datos versionados, soporte de reversal, refund, datos de settlement, reconciliation y webhooks. Una ausencia de capacidad nunca se simula. El proveedor sigue siendo autoridad sobre resultados externos; POS Platform es autoridad sobre sus decisiones internas y evidencia consolidada.

## Local-first, caja, inventario y fiscalización

- offline puede registrar una intención con identidad global, evidencia local, permisos vigentes y dispositivo válido; no puede confirmar por sí solo un resultado externo, cerrar/reabrir conciliaciones centrales ni configurar proveedores;
- la sincronización conserva `operation_id`, idempotencia, causalidad y versión; timestamps no resuelven conflictos;
- Reversal, Settlement y Reconciliation no crean ni modifican automáticamente `CashMovement`; cualquier efecto de efectivo pertenece a Cash Register y exige turno/política válidos;
- ninguna de estas operaciones modifica stock; cualquier restitución física pertenece a Inventory mediante `InventoryMovement`;
- un resultado financiero no corrige por sí solo un documento fiscal. Electronic Invoicing decide y conserva el documento correctivo relacionado sin alterar el original;
- provider settlement, abono bancario, cierre de caja, cierre fiscal y cierre de Reconciliation son hechos distintos.

## Eventos y auditoría

Eventos canónicos relevantes de Payments:

- `ReversalRequested`, `ReversalProcessing`, `ReversalCompleted`, `ReversalFailed`, `ReversalCancelled`, `ReversalReviewRequired`;
- `SettlementCreated`, `SettlementProcessing`, `SettlementPartiallyCompleted`, `SettlementCompleted`, `SettlementFailed`, `SettlementReviewRequired`;
- `ReconciliationStarted`, `ReconciliationPartiallyCompleted`, `ReconciliationCompleted`, `ReconciliationReviewRequired`, `ReconciliationClosed`, `ReconciliationReopened`, `ReconciliationFailed`.

No se mantienen aliases para el mismo hecho. Los eventos de items e incidencias pueden ser distintos porque representan hechos diferentes, pero no sustituyen eventos del agregado.

Cada transición y acción crítica conserva actor o sistema, tenant, recurso, estado anterior/nuevo, permiso y decisión de política, motivo, importe/moneda cuando aplique, versión, origen/dispositivo, evidencia referenciada, `operation_id`, idempotency key, correlation/causation e instante. La auditoría es append-only, no contiene secretos y no se borra por eliminación o suspensión del recurso.

## Migración heredada

El legado no autoriza inferir Reversal, Settlement o Reconciliation confirmados a partir de ventas, nombres, notas, fechas o diferencias de caja. La futura migración debe:

1. asignar identidades globales y tenant/company/branch explícitos;
2. preservar fuentes y archivos originales con hashes;
3. convertir solo hechos demostrables; lo ambiguo queda como snapshot importado o incidencia de revisión;
4. no fabricar referencias externas, evidencia de proveedor, políticas de cálculo ni estados finales;
5. reconstruir componentes monetarios separados sin `float` y documentar el tratamiento del bruto frente a reversals;
6. mantener Payment histórico inmutable y registrar ajustes posteriores como hechos separados;
7. validar ausencia de contaminación cross-tenant, duplicados y doble consumo antes de cualquier cutover.

## Pruebas contractuales mínimas para implementación posterior

- transiciones válidas e inválidas de los tres agregados según `PAY-007`;
- `OPEN` y `PROCESSING` rechazados como `ReconciliationStatus`;
- periodo/alcance congelado sin estado propio;
- Reversal no elegible, parcial, incierta, duplicada, tardía y cross-tenant;
- Settlement con bruto que incluye reversals y con bruto ya neto, sin doble descuento;
- reproducción exacta del cálculo desde política, inputs, evidencia y resultado;
- importes parciales sin doble settlement;
- matching determinista, tolerancia versionada, incidencias y cierre bloqueado;
- cierre, reapertura y resolución con permisos, motivo, MFA/reautenticación y segregación según política;
- webhook auténtico, inválido, duplicado, reordenado y contradictorio;
- operación offline que no amplía autoridad del dispositivo;
- ausencia de mutación de Payment, Sale, caja, inventario y documento fiscal;
- equivalencia de exactitud decimal y restricciones tenant-scoped en PostgreSQL y SQLite cuando las migraciones sean autorizadas.

## Resultado del gate

`PHY-G09` queda cerrado documentalmente porque estados, ownership, eventos, Settlement, Reconciliation, Reversal, dinero exacto, permisos, multi-tenant, replay, idempotencia, fraude, local-first, provider authority, auditoría y migración heredada tienen contrato coherente. Este cierre no autoriza DDL ni inicia `PHY-G10`.

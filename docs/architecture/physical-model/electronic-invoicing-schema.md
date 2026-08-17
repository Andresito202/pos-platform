# PHY-G12: agregados neutrales de Electronic Invoicing

## Estado y alcance

`PHY-G12` queda cerrado documentalmente mediante este contrato. El documento no contiene DDL, SQL ni migraciones y no autoriza la primera migración. En este cierre, `TECH-002` permaneció `IN_PROGRESS`, la primera migración permaneció `NO-GO`, los security gates continuaron sin evaluar y `PHY-G14` todavía no se había iniciado; su evolución posterior se registra en `traceability.md` y `backlog.md`.

El contrato define la persistencia conceptual neutral al proveedor de conexiones, documentos electrónicos, intentos técnicos, artefactos, incidencias, contingencia y conciliación fiscal. Factus, Siigo, Alegra, un SDK DIAN o cualquier proveedor concreto pertenecen a adaptadores futuros y no definen entidades, estados ni columnas del dominio.

## Ownership y frontera Tax / Electronic Invoicing

`Tax` es autoridad de:

- `TaxRule` y `TaxRuleVersion`;
- clasificación, tarifas y vigencia tributarias;
- cálculo y resultado tributarios;
- `TaxSnapshot` o snapshot tributario de la operación.

`Electronic Invoicing` es autoridad de:

- `FiscalConnection`;
- `FiscalEmissionConfiguration` y sus versiones;
- `ElectronicDocument`;
- `FiscalSubmissionAttempt`;
- `FiscalArtifact`;
- `FiscalIncident`;
- `FiscalReconciliation` y sus items;
- numeración, contingencia, evidencia de emisión y documentos correctivos.

`External Integrations` es autoridad de `ProviderRegistry`, la cuenta/conexión general `ExternalIntegration`, credenciales referenciadas, capabilities generales, discovery, mappings, rate-limit policy, webhook receipt y dispatch central hacia el proveedor. El contrato físico general está en `external-integrations-schema.md`.

Electronic Invoicing consume un snapshot tributario inmutable y no recalcula Tax. Tax no transmite documentos, no administra proveedor, numeración, contingencia ni aceptación externa. Sale, SaleReturn, Payment, Refund, Reversal, CashMovement e InventoryMovement conservan ownership independiente.

## Snapshots separados

Toda emisión conserva dos evidencias distintas:

1. `tax_snapshot_reference`: referencia inmutable al resultado tributario producido por Tax;
2. `fiscal_emission_snapshot_reference`: evidencia inmutable de configuración, versión, proveedor neutral, ambiente, numeración, capacidades y contingencia usadas por Electronic Invoicing.

No existe un `fiscal_snapshot` combinado. Cambiar una regla de Tax, configuración, conexión o proveedor no reescribe ninguno de los snapshots históricos.

## Ubicación y autoridad

PostgreSQL central es autoridad de aceptación fiscal externa consolidada, conexiones, secretos referenciados, conciliación y artefactos centrales. SQLite/WAL puede conservar intención fiscal local, snapshots, outbox, identidad del documento y estado operativo conocido cuando la modalidad y política lo permitan.

El POS local nunca inventa `ACCEPTED` o `REJECTED`. La autoridad externa se incorpora mediante respuesta síncrona verificable, polling, webhook validado o reconciliación. Una réplica local no amplía capacidades ni vigencias de configuración.

## Agregado `FiscalConnection`

Representa el perfil fiscal que habilita una `ExternalIntegration` para una identidad tributaria, configuración de emisión, numeración, certificados cuando apliquen y contingencia. No es la conexión general ni propietaria de credenciales. Identidad candidata UUID v7: `fiscal_connection_id`.

Atributos conceptuales mínimos:

```text
fiscal_connection_id
tenant_id
company_id
branch_id nullable
tax_identity_id
external_integration_id
fiscal_capabilities_snapshot
fiscal_configuration_version_reference
certificate_reference nullable
valid_from
valid_until nullable
version
created_at
updated_at
```

Reglas:

1. `tenant_id`, `company_id` y `branch_id` forman un scope coherente; Branch, si existe, pertenece a la misma Company y Tenant.
2. `external_integration_id` referencia mediante FK tenant/company-aware una integración general cuya capability `ELECTRONIC_INVOICING` está activa.
3. Provider, account identity, environment, general status/health, adapter version, credential binding y capabilities generales se leen de `ExternalIntegration`; no se duplican aquí.
4. Secretos, tokens y claves privadas no se almacenan en esta entidad. `certificate_reference` solo existe cuando el perfil fiscal exige material distinto de la credencial general y sigue `SEC-004`.
5. Una conexión inactiva o vencida no autoriza documentos nuevos.
6. Rotar credenciales o cambiar proveedor crea o referencia una versión nueva; no muta evidencia histórica.
7. Las capabilities fiscales se validan contra la integración, ambiente y versión; no se infieren por nombre comercial del proveedor.
8. La elegibilidad fiscal es una proyección derivada de `ExternalIntegration.ACTIVE`, capability fiscal activa, versión publicada, vigencia, mappings/rangos y certificado cuando aplique. No crea otro lifecycle general.

## Agregado `ElectronicDocument`

`ElectronicDocument` es el único nombre canónico del agregado central. “Documento fiscal” puede usarse como descripción narrativa, pero `FiscalDocument` no es una segunda entidad. Identidad candidata UUID v7: `electronic_document_id`; CUFE, CUDE, número, prefijo e identificadores de proveedor nunca son PK internas.

Atributos conceptuales mínimos:

```text
electronic_document_id
tenant_id
company_id
branch_id
source_type
source_id
source_version
document_type
status
currency
subtotal_amount
discount_amount
tax_amount
total_amount
tax_snapshot_reference
fiscal_emission_snapshot_reference
fiscal_connection_id
emission_configuration_version_id
canonical_payload_version
canonical_payload_checksum
internal_reference
prefix nullable
number nullable
provider_document_id nullable
provider_reference nullable
authority_reference nullable
legal_identifier nullable
provider_status_raw nullable
authority_status_raw nullable
uncertainty_reason nullable
original_electronic_document_id nullable
correction_source_reference nullable
issued_at nullable
accepted_at nullable
rejected_at nullable
last_reconciled_at nullable
version
created_at
updated_at
```

Reglas:

1. La identidad existe antes del primer envío.
2. Source y documento pertenecen al mismo Tenant, Company y Branch aplicables.
3. `source_type + source_id + document_type + intención lógica` participa en la unicidad de intención; una operación no crea accidentalmente dos documentos equivalentes.
4. Importes y moneda son exactos y coinciden con snapshots; Electronic Invoicing no recalcula ventas, precios, impuestos ni pagos.
5. `provider_status_raw` y `authority_status_raw` conservan evidencia externa sin convertirse en enums globales.
6. Prefijo, número, referencia del proveedor, referencia de autoridad y CUFE/CUDE u otro identificador legal son identidades diferentes y opcionales hasta que exista evidencia.
7. Un documento aceptado no se borra ni sobrescribe.
8. Una corrección es otro `ElectronicDocument` relacionado con el original y la operación causal.
9. Un Payment confirmado no implica aceptación fiscal y una aceptación fiscal no implica Payment confirmado.
10. `version` soporta compare-and-swap; un timestamp no resuelve concurrencia.

## Estados de `ElectronicDocument`

Estados persistentes autoritativos:

- `DRAFT`;
- `READY`;
- `QUEUED`;
- `SUBMITTING`;
- `ACCEPTED`;
- `REJECTED`;
- `UNKNOWN_OUTCOME`;
- `CONTINGENCY`;
- `VOIDED_BEFORE_SUBMISSION`.

`UNKNOWN_OUTCOME` significa que no existe evidencia suficiente para afirmar aceptación, rechazo o ausencia de procesamiento. `ACCEPTED` y `REJECTED` solo se alcanzan con evidencia autoritativa. `VOIDED_BEFORE_SUBMISSION` no anula Sale ni un documento aceptado.

No se mezclan en este estado:

- lifecycle técnico de `FiscalSubmissionAttempt`;
- lifecycle de `FiscalIncident`;
- lifecycle de `FiscalReconciliation`;
- valor original reportado por proveedor o autoridad.

## Entidad `FiscalSubmissionAttempt`

Representa una interacción técnica u operativa contra un proveedor para emitir, consultar, recuperar artefactos o ejecutar una operación correctiva autorizada. Identidad candidata UUID v7: `fiscal_submission_attempt_id`.

Atributos conceptuales mínimos:

```text
fiscal_submission_attempt_id
tenant_id
electronic_document_id
fiscal_connection_id
integration_dispatch_id
operation_type
attempt_number
status
transport_status
normalized_result nullable
request_id
idempotency_key
request_checksum
provider_operation_id nullable
provider_response_reference nullable
http_status nullable
provider_code_raw nullable
retry_classification nullable
error_code nullable
retry_after nullable
started_at nullable
completed_at nullable
correlation_id
causation_id
version
created_at
```

Estados persistentes:

- `CREATED`: intento persistido, aún no ejecutado;
- `IN_PROGRESS`: interacción externa activa;
- `COMPLETED`: interacción técnica finalizada con evidencia suficiente;
- `FAILED`: error técnico conocido;
- `UNKNOWN_OUTCOME`: no existe certeza sobre el resultado externo del intento;
- `CANCELLED`: cancelado antes de completarse cuando la política lo permite.

Reglas:

1. El estado técnico no representa el resultado fiscal del documento.
2. Un attempt `COMPLETED` puede tener `normalized_result` equivalente a aceptación o rechazo.
3. `ACCEPTED` y `REJECTED` no son estados técnicos del attempt.
4. `transport_status` conserva el resultado del transporte y permanece separado de `normalized_result`.
5. No existe un catálogo previo más amplio de `normalized_result`. Para este gate solo se reutilizan `ACCEPTED` y `REJECTED` como resultados normalizados ya autoritativos del documento; ante fallo técnico o incertidumbre el valor permanece ausente hasta contar con evidencia. No se crea una enum paralela ni valores adicionales.
6. Un retry técnico conserva `electronic_document_id`, intención e idempotencia. Crea un nuevo attempt numerado, no otro documento.
7. Un attempt histórico en `UNKNOWN_OUTCOME` no se reescribe cuando una consulta posterior resuelve el documento.
8. La combinación de documento, operación y `attempt_number` es única dentro del tenant.
9. `FiscalSubmissionAttempt` es el único owner autoritativo de attempt number, request/transporte, respuesta HTTP/provider, `Retry-After`, provider reference, resultado técnico, timestamps, incertidumbre, retry y reconciliación para toda operación fiscal.
10. `integration_dispatch_id` identifica obligatoriamente la intención central que originó el attempt. La FK tenant-aware apunta a `IntegrationDispatch` con `dispatch_class = 'FISCAL'`; la coherencia de Company se verifica contra el `ElectronicDocument`, `FiscalConnection` y dispatch referenciados. La implementación física usa el discriminador constante y la candidate key compuesta definidas en `external-integrations-schema.md` o un constraint equivalente igualmente verificable.
11. `UNIQUE (tenant_id, integration_dispatch_id, attempt_number)` ordena los retries del dispatch fiscal. `correlation_id` conserva trazabilidad extremo a extremo, pero no sustituye esta identidad.
12. Un dispatch fiscal no admite `IntegrationDispatchAttempt`. La FK discriminada impide que ambos tipos representen la misma interacción; no existe doble historial autoritativo.

## Entidad `FiscalArtifact`

Representa evidencia persistida o referenciada. Identidad candidata UUID v7: `fiscal_artifact_id`.

Atributos conceptuales mínimos:

```text
fiscal_artifact_id
tenant_id
electronic_document_id
fiscal_submission_attempt_id nullable
artifact_type
media_type
storage_reference
checksum_algorithm
checksum
size_bytes nullable
provider_reference nullable
authority_reference nullable
retention_policy_reference
immutable_evidence
created_at
```

`artifact_type` admite por catálogo versionado XML, PDF, application response, QR data, payload firmado, respuesta de proveedor u otro artefacto autorizado sin asumir que todos existen para cada proveedor.

El contenido sensible no se duplica en eventos o auditoría. La descarga exige autorización temporal y scope. No se fija un periodo legal sin política normativa aprobada. Purga o destrucción futura requieren política, evidencia y auditoría; nunca delete arbitrario.

“Activo” e “histórico” son clasificaciones derivadas de uso y retención, no estados persistentes adicionales de `FiscalArtifact`. Convertirse en evidencia histórica no cambia contenido, checksum ni identidad.

## Agregado `FiscalIncident`

Representa una situación persistente que requiere revisión y no un error técnico transitorio ordinario. Identidad candidata UUID v7: `fiscal_incident_id`.

Atributos conceptuales mínimos:

```text
fiscal_incident_id
tenant_id
company_id
branch_id nullable
electronic_document_id nullable
fiscal_submission_attempt_id nullable
fiscal_reconciliation_id nullable
incident_type
severity
status
summary_code
evidence_reference
assigned_reviewer_id nullable
resolution_type nullable
resolution_reason nullable
resolved_by nullable
resolved_at nullable
archived_at nullable
correlation_id
causation_id
version
created_at
updated_at
```

Estados persistentes:

- `OPEN`;
- `IN_REVIEW`;
- `RESOLVED`;
- `ARCHIVED`.

Rechazo, timeout, respuesta incierta, inconsistencia, provider mismatch, numeración, schema/version, contingencia, webhook inconsistente o reconciliation mismatch se expresan mediante `incident_type`. False positive, confirmación externa, error de operador, corrección de configuración u otra salida se expresan mediante `resolution_type` y `resolution_reason`, no mediante estados adicionales. `ARCHIVED` no elimina evidencia.

## Agregado `FiscalReconciliation`

Representa la comparación versionada entre estado interno y evidencia externa autoritativa. Identidad candidata UUID v7: `fiscal_reconciliation_id`.

Atributos conceptuales mínimos:

```text
fiscal_reconciliation_id
tenant_id
company_id
branch_id nullable
fiscal_connection_id
scope_snapshot
status
expected_state_snapshot
observed_state_snapshot
provider_evidence_reference
authority_evidence_reference nullable
discrepancy_summary nullable
started_by
reviewed_by nullable
closed_by nullable
resolution_reason nullable
started_at nullable
closed_at nullable
version
created_at
updated_at
```

Estados persistentes:

- `CREATED`;
- `RUNNING`;
- `REVIEW_REQUIRED`;
- `PARTIALLY_RECONCILED`;
- `RECONCILED`;
- `FAILED`;
- `CANCELLED`;
- `CLOSED`;
- `REOPENED`.

El periodo o alcance es `scope_snapshot`, no un agregado con máquina paralela. Electronic Invoicing conserva su propio tipo de estado; no comparte físicamente la enum de `Payments.Reconciliation`. Items e incidencias conservan lifecycle separado.

Cada item conceptual conserva como mínimo documento, estado esperado, estado observado, referencias de evidencia, discrepancia y resolución. Reconciliar no sobrescribe attempts, payloads, artefactos ni respuestas anteriores para “hacer cuadrar”.

### `FiscalReconciliationItem`

Item tenant-scoped que referencia una `FiscalReconciliation` y un `ElectronicDocument`. Conserva identidad UUID v7 candidata, estado esperado/observado, checksum de evidencia, discrepancia, resultado y referencia de incidencia. El resultado del item es clasificación de comparación y no crea una segunda máquina de estados ni altera directamente el documento.

## Resultado incierto, polling y webhook conceptual

Si el proveedor procesa una solicitud y la conexión cae antes del ACK:

1. el attempt pasa a `UNKNOWN_OUTCOME`;
2. el documento pasa a `UNKNOWN_OUTCOME` cuando tampoco existe certeza fiscal;
3. se persiste evidencia disponible y se abre incidencia o reconciliación según política;
4. no se crea otro documento ni se consume otro consecutivo automáticamente;
5. polling, consulta, webhook validado o reconciliación incorporan nueva evidencia;
6. el documento puede pasar a `ACCEPTED` o `REJECTED`;
7. el attempt histórico permanece incierto.

Contrato conceptual de recepción externa:

```text
provider_event_id
provider_identity
fiscal_connection_id
signature_metadata
received_at
raw_evidence_reference
verification_status
idempotency_key
processing_result
correlation_id
```

`provider_event_id` se deduplica dentro de conexión y tenant. Firma inválida se rechaza y puede producir `SecurityEvent` y `FiscalIncident`. Un webhook nunca modifica directamente entidades: pasa por validación, replay protection, autorización de conexión y caso de uso. La llegada antes o después de la respuesta síncrona produce el mismo resultado idempotente.

## Idempotencia e identidades

Fronteras candidatas:

- conexión: tenant + company + proveedor neutral + ambiente + idempotency key;
- preparación: tenant + source + tipo documental + intención lógica;
- attempt: documento + operación + attempt number;
- transmisión: documento + operación lógica + idempotency key;
- webhook: conexión + provider event id;
- polling: documento + consulta/ventana + identidad lógica;
- corrección: operación correctiva + documento original + tipo;
- conciliación: conexión + scope checksum + identidad de ejecución.

La misma clave con checksum diferente produce conflicto. Una referencia externa o respuesta duplicada no crea una segunda intención. Ninguna key puede deduplicar o colisionar entre tenants.

## Numeración e identificadores externos

Se mantienen separados:

- `electronic_document_id`: identidad interna global;
- `internal_reference`: referencia operativa propia;
- prefijo y número fiscales cuando hayan sido asignados;
- `provider_document_id` y `provider_reference`;
- `authority_reference`;
- CUFE, CUDE u otro `legal_identifier` cuando exista.

No se inventa numeración antes de asignación comprobable. Reserva, consumo, liberación o contingencia dependen de la versión de configuración y política aplicables. Un retry no consume una segunda numeración para la misma intención salvo decisión explícita, verificable y auditable.

## Contingencia

La contingencia requiere configuración y autorización previas, permiso, causa, inicio, responsable, evidencia y requisitos vigentes. No se activa automáticamente por un timeout individual.

El documento conserva snapshot de configuración, numeración aplicable, representación entregada y obligación posterior. Al recuperar conectividad se transmite o reconcilia sin doble emisión. El cierre conserva actor, evidencia y resultado. Este contrato no inventa causales, plazos ni reglas legales no cerradas.

## Documentos correctivos

`SaleReturn` puede causar una solicitud de evaluación fiscal. Sales no decide el tipo de documento correctivo. Electronic Invoicing determina, con política vigente, si corresponde nota crédito, nota débito u otro tipo permitido.

El correctivo:

- es otro `ElectronicDocument`;
- pertenece al mismo tenant y emisor;
- referencia el documento original;
- conserva source/correction causales;
- valida importes y cantidades elegibles acumulados;
- no modifica ni elimina el original;
- no nace únicamente por existir Refund o Reversal.

## Tenant isolation y seguridad

1. Todos los agregados y entidades son tenant-scoped.
2. Actor, source, conexión, secreto referenciado, documento, attempt, artefacto, incidente y conciliación deben pertenecer al mismo tenant.
3. `tenant_id` enviado por cliente no es autoridad.
4. Las FK futuras serán tenant-aware y RLS será defensa adicional solo después del PoC de `PHY-G14`.
5. Provider IDs, CUFE, NIT o prefijo no conceden acceso.
6. Credenciales, passwords, API keys, private keys, certificados privados y tokens permanecen fuera de tablas de negocio, logs, eventos y auditoría.
7. Cambiar proveedor, ambiente, resolución, numeración, certificado o referencia secreta exige controles reforzados según política.
8. Resolver incidentes, forzar reconciliación, cerrar o reabrir requieren permiso atómico, motivo y auditoría; pueden exigir MFA, reautenticación y segregación.
9. Renderer y PWA no reciben secretos ni payloads sensibles completos.

Gates aplicables: `SEC-G01`, `SEC-G03`, `SEC-G05`, `SEC-G06`, `SEC-G07`, `SEC-G08` y `SEC-G10`. Permanecen sin evidencia ejecutable y no obtienen `PASS` por este cierre documental.

## Permisos

Permisos atómicos mínimos:

- `fiscal.connection.read`;
- `fiscal.connection.configure`;
- `fiscal.document.read`;
- `fiscal.document.prepare`;
- `fiscal.document.issue`;
- `fiscal.document.retry`;
- `fiscal.artifact.read`;
- `fiscal.incident.read`;
- `fiscal.incident.review`;
- `fiscal.incident.resolve`;
- `fiscal.incident.archive`;
- `fiscal.reconciliation.read`;
- `fiscal.reconciliation.start`;
- `fiscal.reconciliation.review`;
- `fiscal.reconciliation.resolve`;
- `fiscal.reconciliation.close`;
- `fiscal.reconciliation.reopen`;
- `fiscal.contingency.start`;
- `fiscal.contingency.close`.

Estos permisos no conceden permisos de Tax, Sales, Payments, Cash Register o Inventory. Los permisos `fiscal.configuration.*` existentes gobiernan el lifecycle versionado de configuración y no sustituyen el cambio sensible de conexión o secreto.

## Auditoría y eventos

Auditoría append-only conserva actor/proceso, tenant, company/branch, recurso, source, documento, attempt, conexión/proveedor neutral, transición, razón, error, reviewer, correlación, causalidad, timestamp confiable y referencia de evidencia. No duplica secretos ni payloads sensibles.

Eventos canónicos pertenecen a Electronic Invoicing y conservan `tenant_id`, `event_id`, `occurred_at`, `correlation_id`, `causation_id`, versión y referencia de recurso. Se reutilizan los eventos definidos en `event-catalog.md`; ningún evento específico del proveedor entra al núcleo.

## Concurrencia

- Dos workers adquieren lease/compare-and-swap sobre la misma versión; solo uno inicia el attempt activo permitido.
- Webhook, polling y respuesta síncrona compiten mediante idempotencia, evidencia y transición válida, no por timestamp.
- Un retry que coincide con aceptación tardía no crea otro documento ni emite de nuevo después de confirmación.
- Dos correctivos concurrentes validan elegibilidad acumulada con versión y constraint conceptual.
- Cambiar configuración durante emisión no cambia el snapshot ya congelado.
- Reconciliación y actualización del proveedor conservan ambas evidencias y aplican una única transición autorizada.

## Restricciones e índices candidatos

Sin constituir DDL, la implementación posterior debe evaluar:

- unicidad tenant-scoped de identidad e intención fiscal;
- unicidad de documento + operación + attempt number;
- unicidad de conexión + provider event id;
- unicidad condicionada de numeración fiscal cuando exista;
- FK tenant-aware entre todos los recursos relacionados;
- checks de moneda e importes exactos no negativos según tipo;
- checks de relación correctiva no reflexiva;
- índices por tenant/company/branch, source, status, conexión, referencia externa, legal identifier, idempotency key, cola, incertidumbre e incidencia abierta;
- compare-and-swap mediante `version`;
- prohibición de delete destructivo para evidencia confirmada.

## Migración del legado avícola

La auditoría del legado no encontró documentos electrónicos, conexiones fiscales versionadas, CUFE/CUDE, resoluciones, numeración fiscal, attempts, artefactos XML/PDF, webhooks, incidencias o conciliaciones con semántica suficiente.

Clasificación:

- datos de venta y textos libres: `evidence only`;
- menciones de NIT, factura, resolución, QR o proveedor sin evidencia verificable: `ambiguous`;
- credenciales o secretos encontrados: `not migrable`, deben rotarse;
- documento histórico con artefacto y referencias verificables futuras: `migrable parcialmente` tras reconciliación;
- aceptación, timestamps, provider IDs, CUFE, numeración, versión, autor o estado ausentes: no se inventan.

No se transforma una Sale, anulación, SaleReturn, Refund, texto de auditoría o número comercial en `ElectronicDocument` aceptado. Lo ambiguo se conserva como evidencia o cuarentena.

## Pruebas futuras

### PostgreSQL

1. aislamiento tenant y FK tenant-aware;
2. source y documento del mismo tenant/company/branch;
3. intención fiscal única;
4. idempotency key con mismo y distinto checksum;
5. attempt number único y lifecycle válido;
6. deduplicación de webhook;
7. transiciones válidas de documento, attempt, incidente y reconciliación;
8. relación correctiva y elegibilidad acumulada;
9. permisos, scopes, MFA/reautenticación y segregación;
10. aislamiento de secretos;
11. concurrencia entre workers, polling y webhook;
12. PoC RLS futuro como evidencia separada.

### SQLite/WAL

1. intención fiscal persistida offline;
2. reinicio y recuperación de outbox;
3. snapshot tributario y snapshot de emisión separados;
4. no duplicación por reconexión;
5. resultado incierto preservado;
6. configuración vencida o revocada conocida;
7. POS local incapaz de inventar aceptación;
8. contingencia solo con autorización y evidencia disponibles.

### Integración

1. proveedor acepta y se pierde respuesta;
2. webhook duplicado;
3. webhook anterior a respuesta síncrona;
4. rechazo verificable;
5. timeout antes y después de transmitir;
6. query resuelve incertidumbre;
7. SaleReturn origina evaluación correctiva sin decidir el tipo;
8. ataque cross-tenant;
9. firma de webhook inválida;
10. credencial o configuración revocada;
11. segundo proveedor pasa la misma suite canónica;
12. artefactos mantienen checksum, autorización y retención.

## Observabilidad futura

Sin implementar puertos, deben existir puntos para issue requested, submission latency, accepted, rejected, uncertain, retry, webhook invalid, provider unavailable, reconciliation mismatch, contingency entered y correction generated. Métricas y logs no incluyen secretos, payloads completos ni identificadores sensibles innecesarios.

## Criterio de cierre de PHY-G12

El gate cierra documentalmente porque quedan definidos ownership, frontera Tax/Electronic Invoicing, conexión, documento, attempt, artefacto, incidente, conciliación, estados separados, correctivos, incertidumbre, idempotencia, numeración, neutralidad, local-first, tenancy, secretos, webhooks conceptuales, permisos, auditoría, eventos, concurrencia, migración y pruebas futuras.

Este cierre no declara implementación, seguridad aprobada, integración productiva, certificación DIAN, sandbox validado ni autorización para DDL/migraciones.

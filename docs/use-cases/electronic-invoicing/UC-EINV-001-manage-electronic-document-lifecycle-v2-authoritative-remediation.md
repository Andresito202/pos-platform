# UC-EINV-001 — gestionar ciclo de vida de un documento electrónico V2

## Estado

`AUTHORITATIVE_REMEDIATION_CANDIDATE / REVIEW_REQUIRED / IMPLEMENTATION_PENDING`.

Este caso de uso V2 incorpora el Modelo A aprobado en la propuesta V7: un `ElectronicDocument` mantiene identidad estable y puede crear una nueva `FiscalDocumentPreparation` únicamente antes de exposición externa. Reprepare, retry y documento correctivo son operaciones diferentes.

Este UC se interpreta junto con `docs/migration/sql003-authoritative-contract-remediation-index.md` §4. No autoriza SQL003 ni provider productivo y no puede interpretarse para introducir leases V1, provider identity sin scope o retries ciegos.

## Prioridad

`P1`; INT-006 sigue siendo gate P0 antes de materialización fiscal.

## Actores

- propietario/administrador autorizado;
- responsable fiscal autorizado;
- API central;
- worker fiscal;
- External Integrations/webhook processor;
- provider/autoridad aplicable;
- Audit;
- soporte temporal autorizado.

## Invariantes

1. Sale y ElectronicDocument son hechos separados.
2. `ElectronicDocument.logical_operation_key` es estable.
3. Configuración/payload/numeración pertenecen a `FiscalDocumentPreparation` por generation.
4. Provider identity/status pertenece a la preparation scoped por `external_integration_id`; authority/legal identity pertenece al document estable.
5. Una edición DRAFT de la preparation actual no crea otro documento ni otra generation.
6. Reprepare conserva documento e incrementa generation exactamente una vez.
7. Reprepare solo antes de exposición externa demostrablemente nula.
8. Retry conserva document+preparation+dispatch+internal_operation_id+idempotency root.
9. Timeout no significa rechazo ni no-envío.
10. UNKNOWN_OUTCOME falla cerrado.
11. Un correctivo crea otro ElectronicDocument y no sustituye reprepare.
12. Provider DTO/IDs no se convierten en autoridad de scope.
13. Ninguna falta de provider fiscal borra la obligación legal aplicable.
14. V1 no usa `lease_owner`, `lease_expires_at` ni reclaim automático por tiempo.

## A. Configurar perfil fiscal

1. autenticar/reautenticar actor según policy;
2. validar tenant/company y permisos;
3. seleccionar ExternalIntegration/adapter/environment ya definidos por External Integrations;
4. almacenar secretos únicamente en secret facility y conservar referencias opacas;
5. validar declaration/capability real del adapter;
6. crear/actualizar FiscalConnection y configuración/versiones;
7. publicar solo cuando contrato, vigencia, numeración/certificados/capabilities aplicables sean válidos;
8. auditar sin secretos.

Una configuración publicada no reescribe documentos/preparaciones históricas.

## B. Crear/preparar documento

Entrada conceptual:

```text
source_type
source_id
document_type
tenant/company/branch context
expected source version
idempotency / operation identity
```

Flujo:

1. validar source y scope;
2. calcular `logical_operation_key` estable;
3. resolver CREATE/replay idempotentemente;
4. seleccionar capability/configuración con precedencia BRANCH > COMPANY;
5. crear `ElectronicDocument` si no existe;
6. crear `FiscalDocumentPreparation` generation 1 DRAFT;
7. congelar source_version, correction material, importes, tax snapshot y fiscal snapshot;
8. construir canonical payload versionado y checksum;
9. resolver numeración según modalidad;
10. ejecutar validaciones internas;
11. FROZEN + ElectronicDocument READY;
12. Audit/evento.

Documento y preparation generation 1 pertenecen a la misma transacción y la futura invariante diferida impide confirmar uno sin la current preparation válida.

Misma key con una segunda fila/material incompatible = `CONFLICT`. Editar allowlisted material de la misma preparation DRAFT usa CAS, recalcula checksum y no incrementa generation.

## C. `REPREPARE_BEFORE_SUBMISSION`

Se ejecuta cuando la preparation quedó inválida antes del primer efecto externo, por ejemplo por downgrade/retiro de integration/capability/configuración.

Entrada:

```text
electronic_document_id
expected_document_version
expected_preparation_generation
new integration/connection/config/version
reason
actor
correlation_id
causation_id
```

Estados admitidos: `DRAFT|READY|QUEUED`.

Estados rechazados: `SUBMITTING|ACCEPTED|REJECTED|UNKNOWN_OUTCOME|CONTINGENCY|VOIDED_BEFORE_SUBMISSION`.

### Prueba de elegibilidad bajo fence

Debe confirmar simultáneamente:

- current generation exacta;
- cero `FiscalSubmissionAttempt` para esa generation;
- cero marca durable de claim `IntegrationDispatch.DISPATCHING + attempt IN_PROGRESS`;
- dispatch ausente o exactamente QUEUED sin attempt;
- cero artifacts;
- cero receipt fiscal ya correlacionado en cualquier processing status;
- cero receipt general 002 ya determinísticamente correlacionable al dispatch mediante selector provider/adapter versionado y allowlisted;
- si existe candidato potencialmente aplicable pero ambiguo/incompleto, fail-closed;
- cero reconciliation DOCUMENT RUNNING de esa generation;
- cero reconciliation CONNECTION RUNNING en la connection afectada;
- cero provider identity/status en current preparation;
- cero authority/legal IDs en document;
- cero transport/effect evidence;
- numbering actual no `CONSUMED|UNKNOWN_OUTCOME|BURNED` antes del command.

Si cualquier prueba es incompleta, el command falla cerrado y remite a incident/reconciliation. No se presume no-envío.

### Efecto atómico

1. cancelar dispatch QUEUED elegible;
2. preservar numeración reservada como RELEASED_WITHOUT_REUSE/BURNED sin retroceder cursor;
3. cancelar preparation histórica con actor/razón;
4. incrementar ElectronicDocument.preparation_generation exactamente en 1;
5. crear nueva preparation DRAFT con lineage N→N+1;
6. revalidar cadena old+new y hacer rebind exclusivamente en la nueva preparation;
7. regenerar snapshots/payload/checksum;
8. devolver document a DRAFT;
9. Audit/evento.

El command no crea successor/replacement y no es un retry.

La transacción debe terminar con exactamente una preparation para la new current generation y sin future generations durables.

## D. Congelar y encolar

1. validar preparation DRAFT actual;
2. freeze de material/configuración;
3. document -> READY;
4. al solicitar emisión, crear `IntegrationDispatch(FISCAL)` ligado a document+preparation+generation;
5. usar shape canónico:

```text
dispatch_class = FISCAL
resource_type = ELECTRONIC_DOCUMENT
internal_entity_type = ElectronicDocument
internal_entity_id = ElectronicDocument.id
payload_schema_version = preparation.canonical_payload_version
payload_checksum = preparation.canonical_payload_checksum
```

6. root:

```text
FISCAL_SUBMIT_DISPATCH_V1
+ tenant_id
+ integration_id
+ electronic_document_id
+ preparation_generation
+ SUBMIT_DOCUMENT
```

7. `internal_operation_id` = operation_id estable del primer enqueue aceptado para esa generation;
8. document -> QUEUED en la misma frontera coherente;
9. replay same root+checksum resuelve el mismo dispatch y no cambia `internal_operation_id`.

## E. Claim y transmitir

El claim V1 no es una lease temporal.

Primer envío:

1. worker revalida declaration/adapter/integration/capability/configuración;
2. toma fence document/preparation;
3. verifica current generation, preparation FROZEN y dispatch QUEUED;
4. bloquea dispatch y confirma que no existe otro attempt concurrente;
5. cambia `IntegrationDispatch.status` a `DISPATCHING`;
6. crea `FiscalSubmissionAttempt` para mismo dispatch/generation/root con attempt_number monotónico y lo deja `IN_PROGRESS`;
7. confirma CAS/versiones y commit;
8. obtiene secret/token fuera de tablas de negocio;
9. transforma payload al provider;
10. ejecuta HTTP fuera de ACID;
11. persiste resultado/evidence en nueva transacción;
12. actualiza attempt/document/dispatch conforme a autoridad real;
13. Audit/evento.

La combinación durable `DISPATCHING + attempt IN_PROGRESS` bloquea cualquier reprepare concurrente.

Un crash después del commit y antes/durante HTTP no se resuelve por expiración temporal; entra a recovery/reconciliation fail-closed.

## F. Resultado aceptado/rechazado

### Aceptado

- document ACCEPTED con authority/legal evidence;
- `authority_reference`/`legal_identifier` write-once cuando apliquen;
- provider identity/status se registra en la preparation expuesta y scoped a su integration;
- numeración de preparation CONSUMED cuando aplique;
- artifacts/referencias con checksum;
- timestamps/evidence.

### Rechazado

- document REJECTED con evidence autoritativa;
- provider status/IDs, si existen, permanecen en la preparation exacta;
- authority status raw sanitizado permanece en document cuando corresponda;
- códigos raw sanitizados + categoría normalizada;
- preparation/payload congelados conservados;
- no se sobrescribe Sale.

Un rechazo que requiera corrección genera otro ElectronicDocument cuando el caso correctivo lo autoriza; no reprepare del documento expuesto.

El dispatch puede quedar `SUCCEEDED` cuando la interacción técnica concluyó aunque el document termine `REJECTED`; dispatch success no equivale a acceptance fiscal.

## G. Timeout / resultado incierto

Si el request pudo salir o no puede demostrarse ausencia de efecto:

- attempt -> UNKNOWN_OUTCOME;
- document -> UNKNOWN_OUTCOME cuando corresponda;
- dispatch -> UNKNOWN_OUTCOME/RECONCILIATION_REQUIRED según evidence;
- no retry ciego;
- no reprepare;
- no segundo documento;
- no nueva numeración;
- conservar evidence e incident/reconciliation.

Un attempt UNKNOWN_OUTCOME permanece histórico aunque el document se resuelva después.

## H. Retry seguro

Retry solo sobre mismo document+preparation+dispatch.

Conserva:

- preparation generation;
- dispatch root;
- internal_operation_id;
- canonical payload/schema/checksum;
- numeración.

Crea nuevo attempt_number bajo lock.

Después de un outcome con evidencia suficiente para `SAFE_RETRY`, el mismo dispatch puede quedar `RETRY_SCHEDULED`. Cuando `next_attempt_at` sea elegible:

1. revalidar fence/capability/configuración;
2. confirmar document no UNKNOWN_OUTCOME/terminal;
3. confirmar dispatch RETRY_SCHEDULED y último outcome/evidence autorizando SAFE_RETRY;
4. `RETRY_SCHEDULED -> DISPATCHING`;
5. crear attempt #N IN_PROGRESS;
6. commit;
7. HTTP después.

`next_attempt_at` solo agenda; el tiempo no demuestra ausencia de efecto.

`started_at`, HTTP status, socket error o timeout aislados no autorizan retry. Misma root con payload schema/checksum/generation incompatible = CONFLICT.

## I. Webhook

El webhook entra primero a `ExternalWebhookReceipt`.

- tenant/company/integration se derivan de integration, no del payload;
- autenticidad/replay se validan según provider contract;
- correlación fiscal write-once liga receipt a document/preparation/generation/dispatch;
- cualquier receipt ya correlacionado bloquea reprepare sin importar processing status;
- un receipt general ya determinísticamente correlacionable se vincula bajo el mismo fence y bloquea reprepare aunque el linkage fiscal aún estuviera NULL;
- un candidato potencialmente aplicable pero ambiguo bloquea fail-closed hasta resolución;
- evidence tardía queda en generation histórica;
- duplicate webhook converge idempotentemente.

Una coincidencia por tenant/integration sola no es correlación determinista. No se correlaciona por timestamp.

Webhook nunca actualiza directamente Sale/Payment/Inventory.

## J. Late evidence cross-generation

Si un receipt/artifact/provider/authority evidence termina correlacionado con una generation histórica menor que la current:

1. persistir únicamente contra la preparation histórica exacta;
2. no reactivar preparation CANCELLED;
3. provider identity/status histórico solo puede enriquecerse de forma write-once/sanitizada y evidence-backed;
4. document current -> UNKNOWN_OUTCOME salvo evidencia autoritativa suficiente para estado legal más fuerte;
5. current dispatch QUEUED queda durable pero no puede reclamarse mientras document esté UNKNOWN_OUTCOME;
6. si current generation ya tiene attempt, abrir/relacionar incident multi-generation y no iniciar otro;
7. nunca reasignar evidence a current por timestamp o conveniencia.

Si una reconciliation posterior prueba ausencia de efecto externo en todas las generations históricas cuestionadas, un comando de resolución específico puede retirar la cuarentena conforme al contrato normativo, sin reprepare ni cambio de generation.

## K. Reconciliation V1

Fuentes permitidas:

- respuesta síncrona durable;
- webhook validado;
- artifact/evidence existente;
- evidencia manual/autoridad revisada.

V1 no inicia `QUERY_DOCUMENT_STATUS` HTTP. Si falta evidence concluyente, el document permanece UNKNOWN_OUTCOME/review required.

Estados de FiscalReconciliation permanecen separados. DOCUMENT reconciliation liga document+generation; CONNECTION reconciliation puede aplicar scope mayor.

Una reconciliation RUNNING aplicable bloquea reprepare.

## L. Query/retrieve futuros

`QUERY_DOCUMENT_STATUS` y `RETRIEVE_ARTIFACT` están diseñados pero no materializados en migration003 v1.

No se ejecutan usando SUBMIT_DOCUMENT. Una futura habilitación requiere capability/provider evidence, root, marca durable previa a HTTP, recovery explícito, rate limits, security y tests antes de cualquier llamada externa.

Una lease temporal futura solo puede existir si un contrato versionado define adquisición, expiración, reclaim y UNKNOWN_OUTCOME; V1 no la presupone.

## M. Nota/ajuste

1. recibir SaleReturn/corrección válida;
2. validar original ACCEPTED y elegibilidad acumulada;
3. determinar tipo permitido;
4. crear nuevo ElectronicDocument con source correctivo estable y original_electronic_document_id;
5. crear su preparation generation 1;
6. seguir prepare/submit/reconcile ordinario.

Refund/Reversal no implica automáticamente nota fiscal.

## N. Contingencia

1. validar policy/capability/permiso/reautenticación;
2. registrar causa/alcance/evidence;
3. crear preparation según modalidad autorizada;
4. preservar numeración/evidence;
5. entregar representación solo si policy lo permite;
6. posterior submission/reconciliation usa el mismo document/preparation;
7. cerrar con Audit.

Timeout individual no activa contingencia.

## O. Operar sin provider fiscal

Si no hay capacidad fiscal contratada/configurada y la operación comercial puede legalmente continuar:

- venta/pago/inventario/caja/ticket funcionan;
- no se crea dispatch/attempt fiscal;
- no se muestra acceptance/CUFE/etc inexistentes;
- UI expone riesgo de configuración cuando exista obligación legal.

## Idempotencia resumida

- document identity: logical_operation_key estable;
- preparation: document + preparation_generation;
- submit dispatch: root V1 document+generation+integration;
- internal operation identity: primer enqueue aceptado de esa generation;
- retry: mismo dispatch/root/internal_operation_id + attempt_number nuevo;
- webhook: integration + provider/dedup key + selector de correlación versionado cuando aplique;
- correctivo: source correctivo + original + type.

## Auditoría mínima

- configuración y publicación;
- document creado/preparado/frozen;
- reprepare old/new generation y razón;
- número reservado/consumido/liberado-no-reuse/burned;
- dispatch queued/cancelled/dispatching/retry-scheduled;
- attempt iniciado/finalizado;
- acceptance/rejection/unknown;
- webhook correlacionado o ambigüedad llevada a incident/reconciliation;
- late evidence/quarantine;
- reconciliation/incident;
- artifacts;
- correctivo/contingencia.

Nunca secrets/payload completo en Audit.

## Pruebas mínimas V2

1. create replay idempotente;
2. duplicate logical key con material incompatible;
3. documento sin preparation1 falla al commit;
4. preparation futura sin avance del document falla al commit;
5. DRAFT edit no incrementa generation;
6. reprepare DRAFT;
7. reprepare READY;
8. reprepare QUEUED unclaimed;
9. dispatch DISPATCHING bloquea;
10. cualquier attempt histórico bloquea reprepare;
11. pending webhook ya correlacionado bloquea;
12. general receipt determinísticamente correlacionable sin linkage fiscal bloquea;
13. candidato webhook ambiguo fail-closed;
14. processed/rejected/dead-letter receipt bloquea;
15. correlación tardía conserva old generation y activa cuarentena;
16. reconciliation RUNNING bloquea;
17. dos reprepares concurrentes;
18. worker first claim vs reprepare;
19. worker retry claim vs segundo worker produce un solo IN_PROGRESS;
20. webhook/correlator vs reprepare;
21. numbering no reuse aun cambiando config/connection/provider;
22. same root/internal_operation_id across retries;
23. root/schema/checksum mismatch conflict;
24. UNKNOWN_OUTCOME fail-closed;
25. dispatch SUCCEEDED + document REJECTED válido con rechazo concluyente;
26. query/retrieve no materializados;
27. cross-tenant/company/integration/generation;
28. second provider sin cambio de core;
29. secrets ausentes;
30. SQLite incapaz de inventar acceptance;
31. MAT-003 PASS no se interpreta como validación del target 10-table.

## Postcondición/gate

Este UC queda funcionalmente reconciliado como candidato, pero no se declara implementado. Requiere review independiente junto al manifest/physical/fence/index V2.

Solo `AUTHORITATIVE_CONTRACT_REVIEW = PASS` permite considerar una tarea posterior de SQL/descriptor 003. Ese PASS no autoriza automáticamente DDL, provider ni merge de implementación.

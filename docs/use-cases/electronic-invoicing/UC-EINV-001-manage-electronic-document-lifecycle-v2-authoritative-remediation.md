# UC-EINV-001 — gestionar ciclo de vida de un documento electrónico V2

## Estado

`AUTHORITATIVE_REMEDIATION_CANDIDATE / REVIEW_REQUIRED / IMPLEMENTATION_PENDING`.

Este caso de uso V2 incorpora el Modelo A aprobado en la propuesta V7: un `ElectronicDocument` mantiene identidad estable y puede crear una nueva `FiscalDocumentPreparation` únicamente antes de exposición externa. Reprepare, retry y documento correctivo son operaciones diferentes.

No autoriza SQL003 ni provider productivo.

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
4. Una edición DRAFT de la preparación actual no crea otro documento ni otra generation.
5. Reprepare conserva documento e incrementa generation exactamente una vez.
6. Reprepare solo antes de exposición externa demostrablemente nula.
7. Retry conserva document+preparation+dispatch+idempotency root.
8. Timeout no significa rechazo ni no-envío.
9. UNKNOWN_OUTCOME falla cerrado.
10. Un correctivo crea otro ElectronicDocument y no sustituye reprepare.
11. Provider DTO/IDs no se convierten en autoridad de scope.
12. Ninguna falta de provider fiscal borra la obligación legal aplicable.

## A. Configurar perfil fiscal

1. autenticar/reautenticar actor según policy;
2. validar tenant/company y permisos;
3. seleccionar ExternalIntegration/adapter/environment ya definidos por External Integrations;
4. almacenar secretos únicamente en secret facility y conservar referencias opacas;
5. validar declaración/capability real del adapter;
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

Misma key con una segunda fila/material incompatible = CONFLICT. Editar allowlisted material de la misma preparación DRAFT usa CAS, recalcula checksum y no incrementa generation.

## C. `REPREPARE_BEFORE_SUBMISSION`

Se ejecuta cuando la preparación quedó inválida antes del primer efecto externo, por ejemplo por downgrade/retiro de integration/capability/configuración.

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
- cero FiscalSubmissionAttempt;
- cero claim/lease;
- dispatch ausente o QUEUED sin claim/attempt;
- cero artifacts;
- cero receipt fiscal correlacionado en cualquier processing status;
- cero reconciliation DOCUMENT RUNNING de esa generation;
- cero reconciliation CONNECTION RUNNING en la conexión afectada;
- cero provider/authority/legal IDs;
- cero transport/effect evidence;
- numbering actual no CONSUMED/UNKNOWN_OUTCOME/BURNED antes del command.

Si cualquier prueba es incompleta, el command falla cerrado y remite a incident/reconciliation.

### Efecto atómico

1. cancelar dispatch QUEUED elegible;
2. preservar numeración reservada como RELEASED_WITHOUT_REUSE/BURNED sin retroceder cursor;
3. cancelar preparación histórica con actor/razón;
4. incrementar ElectronicDocument.preparation_generation exactamente en 1;
5. crear nueva preparación DRAFT con lineage;
6. revalidar cadena old+new y hacer rebind exclusivamente en la nueva preparación;
7. regenerar snapshots/payload/checksum;
8. devolver documento a DRAFT;
9. Audit/evento.

El command no crea successor/replacement y no es un retry.

## D. Congelar y encolar

1. validar preparación DRAFT actual;
2. freeze de material/configuración;
3. document -> READY;
4. al solicitar emisión, crear `IntegrationDispatch(FISCAL)` ligado a document+preparation+generation;
5. root:

```text
FISCAL_SUBMIT_DISPATCH_V1
+ tenant_id
+ integration_id
+ electronic_document_id
+ preparation_generation
+ SUBMIT_DOCUMENT
```

6. dispatch payload checksum debe coincidir con canonical checksum FROZEN;
7. document -> QUEUED en la misma frontera coherente.

## E. Claim y transmitir

1. worker revalida capability/configuración;
2. toma fence document/preparation;
3. verifica current generation y dispatch QUEUED;
4. persiste claim/lease y `FiscalSubmissionAttempt` CREATED;
5. cambia attempt a IN_PROGRESS/document a SUBMITTING según CAS;
6. commit;
7. obtiene secret/token fuera de tablas de negocio;
8. transforma payload al provider;
9. ejecuta HTTP fuera de ACID;
10. persiste resultado/evidence en nueva transacción;
11. actualiza attempt/document/dispatch de forma coherente;
12. Audit/evento.

La existencia del claim/attempt bloquea cualquier reprepare concurrente.

## F. Resultado aceptado/rechazado

### Aceptado

- document ACCEPTED;
- provider/authority/legal IDs write-once;
- numeración de preparation CONSUMED cuando aplique;
- artifacts/referencias con checksum;
- timestamps/evidence.

### Rechazado

- document REJECTED con evidence autoritativa;
- códigos raw sanitizados + categoría normalizada;
- preparation/payload congelados conservados;
- no se sobrescribe Sale.

Un rechazo que requiera corrección genera otro ElectronicDocument cuando el caso correctivo lo autoriza; no reprepare del documento expuesto.

## G. Timeout / resultado incierto

Si el request pudo salir o no puede demostrarse ausencia de efecto:

- attempt -> UNKNOWN_OUTCOME;
- document -> UNKNOWN_OUTCOME cuando corresponda;
- no retry ciego;
- no reprepare;
- no segundo documento;
- no nueva numeración;
- conservar evidence e incident/reconciliation.

Un attempt UNKNOWN_OUTCOME permanece histórico aunque el documento se resuelva después.

## H. Retry seguro

Retry solo sobre mismo document+preparation+dispatch.

Nuevo attempt_number, misma idempotency root.

`SAFE_RETRY` requiere evidencia durable/conclusiva conforme a transport/provider contract. `started_at`, HTTP status, socket error o timeout aislados no autorizan retry.

Misma root con payload checksum diferente = CONFLICT.

## I. Webhook

El webhook entra primero a `ExternalWebhookReceipt`.

- tenant/company/integration se derivan de integración, no del payload;
- autenticidad/replay se validan según provider contract;
- correlación fiscal write-once liga receipt a document/preparation/generation/dispatch;
- cualquier receipt correlacionado bloquea reprepare sin importar processing status;
- evidence tardía queda en generation histórica;
- duplicate webhook converge idempotentemente.

Webhook nunca actualiza directamente Sale/Payment/Inventory.

## J. Reconciliation V1

Fuentes permitidas:

- respuesta síncrona durable;
- webhook validado;
- artifact/evidence existente;
- evidencia manual/autoridad revisada.

V1 no inicia `QUERY_DOCUMENT_STATUS` HTTP. Si falta evidence concluyente, el documento permanece UNKNOWN_OUTCOME/review required.

Estados de FiscalReconciliation permanecen separados. DOCUMENT reconciliation liga document+generation; CONNECTION reconciliation puede aplicar scope mayor.

Una reconciliation RUNNING aplicable bloquea reprepare.

## K. Query/retrieve futuros

`QUERY_DOCUMENT_STATUS` y `RETRIEVE_ARTIFACT` están diseñados pero no materializados en migration003 v1.

No se ejecutan usando SUBMIT_DOCUMENT. Una futura habilitación requiere capability/provider evidence, root, claim durable, rate limits, security y tests antes de cualquier HTTP.

## L. Nota/ajuste

1. recibir SaleReturn/corrección válida;
2. validar original ACCEPTED y elegibilidad acumulada;
3. determinar tipo permitido;
4. crear nuevo ElectronicDocument con source correctivo estable y original_electronic_document_id;
5. crear su preparation generation 1;
6. seguir prepare/submit/reconcile ordinario.

Refund/Reversal no implica automáticamente nota fiscal.

## M. Contingencia

1. validar policy/capability/permiso/reautenticación;
2. registrar causa/alcance/evidence;
3. crear preparation según modalidad autorizada;
4. preservar numeración/evidence;
5. entregar representación solo si policy lo permite;
6. posterior submission/reconciliation usa el mismo documento/preparation;
7. cerrar con Audit.

Timeout individual no activa contingencia.

## N. Operar sin provider fiscal

Si no hay capacidad fiscal contratada/configurada y la operación comercial puede legalmente continuar:

- venta/pago/inventario/caja/ticket funcionan;
- no se crea dispatch/attempt fiscal;
- no se muestra acceptance/CUFE/etc inexistentes;
- UI expone riesgo de configuración cuando exista obligación legal.

## Idempotencia resumida

- document identity: logical_operation_key estable;
- preparation: document + preparation_generation;
- submit dispatch: root V1 document+generation+integration;
- retry: mismo dispatch root + attempt_number nuevo;
- webhook: integration + provider/dedup key;
- correctivo: source correctivo + original + type.

## Auditoría mínima

- configuración y publicación;
- document creado/preparado/frozen;
- reprepare old/new generation y razón;
- número reservado/consumido/liberado-no-reuse/burned;
- dispatch queued/cancelled/claimed;
- attempt iniciado/finalizado;
- acceptance/rejection/unknown;
- webhook correlacionado;
- reconciliation/incident;
- artifacts;
- correctivo/contingencia.

Nunca secrets/payload completo en Audit.

## Pruebas mínimas V2

1. create replay idempotente;
2. duplicate logical key con material incompatible;
3. DRAFT edit no incrementa generation;
4. reprepare DRAFT;
5. reprepare READY;
6. reprepare QUEUED unclaimed;
7. claimed dispatch bloquea;
8. cualquier attempt bloquea;
9. pending webhook bloquea;
10. processed/rejected/dead-letter receipt bloquea;
11. correlation tardía conserva old generation;
12. reconciliation RUNNING bloquea;
13. dos reprepares concurrentes;
14. worker vs reprepare;
15. webhook vs reprepare;
16. numbering no reuse;
17. same root across retries;
18. root mismatch/checksum conflict;
19. UNKNOWN_OUTCOME fail-closed;
20. query/retrieve no materializados;
21. cross-tenant/company/integration;
22. second provider sin cambio de core;
23. secrets ausentes;
24. SQLite incapaz de inventar acceptance.

## Postcondición/gate

Este UC queda funcionalmente reconciliado como candidato, pero no se declara implementado. Requiere review independiente junto al manifest/physical/fence V2. Solo `AUTHORITATIVE_CONTRACT_REVIEW = PASS` permite considerar una tarea posterior de SQL/descriptor 003.

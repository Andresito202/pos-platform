# INT-006 — índice de remediación contractual autoritativa V2

## Estado

`AUTHORITATIVE_REMEDIATION_BUNDLE_V2 / REVIEW_REQUIRED / NOT_FOR_SQL_MATERIALIZATION`.

Este índice define cómo debe interpretarse el bundle documental de remediación de INT-006 sin destruir ni truncar contratos históricos ya cerrados. La propuesta V7 fue integrada por PR #4 y obtuvo `PROPOSAL_REVIEW = PASS`; ese PASS autorizó únicamente esta remediación documental separada.

Hasta que este bundle reciba CI commit-scoped y revisión independiente satisfactoria, permanece candidato. SQL 003, descriptor 003, schema fiscal, runner/apply/down 003 y providers continúan prohibidos.

## 1. Regla de preservación

Los documentos históricos existentes permanecen íntegros en Git y siguen siendo autoridad para toda cláusula **no modificada** por este bundle. No se sustituyen por versiones abreviadas porque ello perdería detalle previamente cerrado sobre grants, RLS, sanitización, preflight MAT-003, constraints, lifecycle, apply/down, provider states, pruebas y seguridad.

Cuando una cláusula histórica contradiga expresamente una decisión V2 listada aquí, prevalece el overlay V2 correspondiente. Si no puede determinarse con certeza si existe contradicción, la interpretación falla cerrado y SQL 003 permanece bloqueado.

## 2. Bundle V2

| Área | Baseline histórico preservado | Overlay V2 candidato | Temas que el overlay puede sustituir |
|---|---|---|---|
| Manifest migration 003 | `third-target-migration-manifest.md` | `third-target-migration-manifest-v2-authoritative-remediation.md` | Modelo A, décima tabla `FiscalDocumentPreparation`, preparation generation, reprepare, retry root, operation scope v1, fence, vínculos por generation, apply/down afectados |
| Physical model fiscal | `../architecture/physical-model/electronic-invoicing-schema.md` | `../architecture/physical-model/electronic-invoicing-schema-v2-authoritative-remediation.md` | separación `ElectronicDocument`/`FiscalDocumentPreparation`, numeración histórica, attempts, reconciliation por generation, fence |
| Arquitectura fiscal | `../architecture/electronic-invoicing.md` | `../architecture/electronic-invoicing-v2-authoritative-remediation.md` | semántica de prepare/reprepare/retry, UNKNOWN_OUTCOME, operation catalog v1, provider neutrality asociada |
| Caso de uso | `../use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle.md` | `../use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle-v2-authoritative-remediation.md` | flujo `REPREPARE_BEFORE_SUBMISSION`, claim durable, retries, webhook/reconciliation y numeración por generation |
| Frontera External Integrations | `../architecture/physical-model/external-integrations-schema.md` + `../architecture/integration-contracts.md` | `../architecture/physical-model/fiscal-integration-fence-schema.md` | extensiones owned por migration 003 sobre dispatch/receipt para vincular preparación/generation y serializar evidencia |

## 3. Cláusulas V2 que sustituyen expresamente el baseline

Solo las siguientes familias cambian autoridad respecto del contrato histórico:

1. `ElectronicDocument` deja de ser owner de material/configuración/numeración mutable por preparación y conserva identidad lógica + lifecycle legal estable.
2. Migration 003 pasa de nueve a **diez tablas fiscales** por la incorporación de `fiscal.fiscal_document_preparations`.
3. `preparation_generation` inicia en 1, cambia exclusivamente mediante `REPREPARE_BEFORE_SUBMISSION` y nunca durante retries.
4. El material de cada generación —integration, connection, config/version, source version, snapshots, canonical payload/checksum y numeración— queda en `FiscalDocumentPreparation` y conserva historia append-only.
5. `REPREPARE_BEFORE_SUBMISSION` solo existe en `DRAFT|READY|QUEUED` y exige prueba durable de cero exposición bajo un fence común.
6. Cualquier attempt/claim, artifact, receipt fiscal correlacionado, identidad externa, `UNKNOWN_OUTCOME`, transport/effect evidence o reconciliation aplicable en vuelo bloquea reprepare.
7. Un dispatch `QUEUED` elegible se cancela en la misma transacción del reprepare; no se reutiliza para la nueva generation.
8. Numeración durable de una generación cancelada nunca vuelve al pool; permanece `RELEASED_WITHOUT_REUSE|BURNED` según policy y Audit.
9. Retry conserva documento + preparación + generation + dispatch + idempotency root y crea otro attempt.
10. Se elimina como requisito contractual la uniqueness por `(tenant,electronic_document,operation_type,idempotency_key)` que impedía retries válidos con root estable.
11. Migration 003 v1 materializa exclusivamente `SUBMIT_DOCUMENT`; `QUERY_DOCUMENT_STATUS` y `RETRIEVE_ARTIFACT` permanecen diseñados pero no materializados.
12. `IntegrationDispatch` fiscal y `ExternalWebhookReceipt` correlacionado reciben extensiones owned por 003 que fijan preparación/generation histórica.
13. La correlación webhook es write-once y todo receipt fiscal correlacionado bloquea reprepare independientemente de su `processing_status`.
14. `FiscalArtifact`, reconciliation/item e incident cuando aplique deben conservar la generation histórica correspondiente.
15. El orden de locks incorpora `FiscalDocumentPreparation` y el receipt correlacionado dentro del suffix fiscal; HTTP sigue siempre fuera de la transacción.

## 4. Cláusulas históricas preservadas

Salvo contradicción expresa con §3, permanecen vigentes y deben trasladarse a cualquier SQL futuro:

- tenant/company-aware FKs, UUID v7, `ON DELETE NO ACTION` y RLS FORCE;
- matriz de roles/grants y `DENY BY DEFAULT`;
- sanitización, límites de texto y protección contra secretos;
- `btree_gist` como dependencia compartida no destructiva;
- lifecycle de connection/configuration/version e inmutabilidad publicada;
- preflight histórico `DEBIT_NOTES` y su matriz física exacta;
- invariantes y hashes de migrations 001/002;
- transición FISCAL como último cambio estructural del apply 003;
- down 003 restringido a fresh/test sin historia fiscal;
- MAT-003 preflight/readiness existentes;
- provider states y ausencia de claims productivos;
- `SEC-G01..SEC-G10 = PLANNED / NOT_EVALUATED`;
- SQLite migration 003 = `NONE`;
- tests negativos y regresiones históricas no afectados por V2.

Una futura materialización deberá construir una especificación consolidada completa. No podrá tomar únicamente los overlays V2 e ignorar el baseline preservado.

## 5. Relación con PR #4 y WIP histórico

PR #4 está `MERGED / CLOSED` y su propuesta V7 es evidencia de diseño, no SQL. El WIP `wip/sql003-contract-gap-20260825@dd07f9d429df7b9a2c6dcacaffa39df737cffbbf` sigue `HISTORICAL_WIP / NOT_INTEGRABLE`; no se mergea ni cherry-pickea como conjunto.

Los overlays V2 absorben las decisiones contractuales necesarias sin reutilizar SQL/runner/tests preliminares del WIP.

## 6. Gate de esta remediación

Para declarar el bundle autoritativo cerrado se requiere sobre un HEAD exacto:

1. diff limitado al bundle documental/backlog;
2. CI TARGET completo `SUCCESS`;
3. migrations 001/002 y MAT-003 sin regresión;
4. SQL/descriptor/schema 003 ausentes;
5. revisión independiente del conjunto V2;
6. cero BLOCKER/HIGH/MEDIUM abiertos;
7. backlog y PR reconciliados.

Solo entonces podrá declararse:

`AUTHORITATIVE_CONTRACT_REVIEW = PASS`.

Ese PASS habilitará una **tarea posterior y separada** para diseñar/materializar SQL y descriptor 003. No constituye autorización automática de DDL ni de merge de esa tarea futura.

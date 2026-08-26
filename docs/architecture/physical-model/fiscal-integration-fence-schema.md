# PHY-G12X — extensión fiscal de External Integrations y fence por preparación

## Estado

`AUTHORITATIVE_REMEDIATION_CANDIDATE / MIGRATION_003_OWNED / REVIEW_REQUIRED / NO_SQL`.

Este contrato define únicamente la extensión que migration 003 necesita sobre objetos owned por `External Integrations` para enlazar una intención fiscal con una `FiscalDocumentPreparation` y serializar evidencia externa contra `REPREPARE_BEFORE_SUBMISSION`.

No reemplaza el contrato general `external-integrations-schema.md`, no modifica bytes de migration 002 y no transfiere ownership de `IntegrationDispatch` ni `ExternalWebhookReceipt` a Electronic Invoicing. Los campos, constraints, FKs, índices y guards descritos aquí son extensiones **owned por descriptor 003** y se retiran exclusivamente con un down 003 elegible.

## 1. Frontera de ownership

`External Integrations` continúa siendo owner de:

- `IntegrationDispatch` como intención central→provider;
- routing, estado agregado, retry scheduling y payload checksum del dispatch;
- `ExternalWebhookReceipt` como recepción durable, deduplicación, autenticidad/replay y procesamiento del webhook.

`Electronic Invoicing` continúa siendo owner de:

- `ElectronicDocument`;
- `FiscalDocumentPreparation` y `preparation_generation`;
- `FiscalSubmissionAttempt`;
- artifacts, incidents y reconciliation fiscales;
- lifecycle legal y evidencia fiscal normalizada.

Migration 003 solo agrega referencias físicas cruzadas que demuestran a qué preparación histórica pertenece un dispatch/receipt fiscal.

## 2. Extensión de `integrations.integration_dispatches`

Columnas nuevas 003:

```text
fiscal_document_preparation_id uuid NULL
fiscal_preparation_generation bigint NULL
```

Shape final:

- `dispatch_class='FISCAL'` exige ambas columnas NOT NULL, `internal_entity_type='ElectronicDocument'` y capability fiscal allowlisted;
- `dispatch_class='NON_FISCAL'` exige ambas columnas NULL;
- `fiscal_preparation_generation >= 1`;
- el `internal_entity_id` del dispatch debe ser exactamente el `ElectronicDocument.id` de la preparación referenciada;
- tenant/company/integration del dispatch deben coincidir con preparación y perfil fiscal.

FK/candidate conceptual 003:

```text
(tenant_id,
 company_id,
 integration_id,
 internal_entity_id,
 fiscal_preparation_generation,
 fiscal_document_preparation_id)
 -> fiscal.fiscal_document_preparations(
      tenant_id,
      company_id,
      external_integration_id,
      electronic_document_id,
      preparation_generation,
      id)
```

La candidate key de destino se materializa en 003. La FK usa `ON DELETE NO ACTION`.

### Idempotency root fiscal

```text
FISCAL_SUBMIT_DISPATCH_V1
+ tenant_id
+ integration_id
+ electronic_document_id
+ preparation_generation
+ operation_type=SUBMIT_DOCUMENT
```

`payload_checksum` del dispatch debe coincidir con `FiscalDocumentPreparation.canonical_payload_checksum` de la preparación FROZEN. Mismo root con checksum distinto falla `CONFLICT`.

Un reprepare crea otra generación y, por tanto, otro dispatch/root. Un retry no crea dispatch nuevo: conserva root/generation y agrega otro `FiscalSubmissionAttempt`.

### Lifecycle y claim

Un dispatch fiscal nace `QUEUED`. Antes de HTTP, el worker:

1. revalida capability/configuración;
2. toma el fence documento/preparación;
3. bloquea el dispatch;
4. verifica que la generation siga siendo la actual y FROZEN;
5. cambia el dispatch a su estado de claim permitido;
6. crea/persiste el `FiscalSubmissionAttempt` y claim/lease durable;
7. commit;
8. solo después ejecuta HTTP.

Un dispatch QUEUED sin claim/attempt puede ser cancelado atómicamente por reprepare. Cualquier otro estado, claim o attempt bloquea reprepare.

## 3. Extensión de `integrations.external_webhook_receipts`

Columnas nuevas 003:

```text
fiscal_electronic_document_id uuid NULL
fiscal_document_preparation_id uuid NULL
fiscal_preparation_generation bigint NULL
fiscal_integration_dispatch_id uuid NULL
fiscal_correlated_at timestamptz NULL
```

Shape de correlación:

- sin correlación fiscal: las cinco columnas son NULL;
- con correlación fiscal: las cinco son NOT NULL;
- `fiscal_preparation_generation >= 1`;
- el dispatch debe ser `FISCAL`, corresponder al mismo tenant/company/integration/document/preparation/generation;
- `fiscal_correlated_at` se fija una vez;
- los cuatro IDs/generation son write-once y nunca pueden moverse a otra preparación.

FKs 003:

- receipt → `IntegrationDispatch` FISCAL scoped;
- receipt → `ElectronicDocument` scoped;
- receipt → `FiscalDocumentPreparation` scoped por generation.

### Regla de cero exposición

**La mera existencia de un receipt fiscal correlacionado es evidencia externa y bloquea reprepare en cualquier `processing_status`.**

No se condiciona a que esté `PROCESSED` ni a que haya aplicado un resultado. Esto incluye, conforme al catálogo 002 vigente, `RECEIVED`, `REJECTED`, `PENDING`, `PROCESSING`, `PROCESSED`, `RETRY_SCHEDULED` y `DEAD_LETTER`.

El status del procesamiento explica qué hizo la plataforma con el webhook; no demuestra que el proveedor nunca recibió/procesó la intención.

### Ingesta correlacionable

Si el request permite resolver de forma determinista el dispatch/documento antes de persistir la correlación:

1. tenant/company/integration se derivan por la ruta/identidad de integración 002;
2. se resuelve el dispatch fiscal histórico;
3. se toma `ElectronicDocument -> FiscalDocumentPreparation -> IntegrationDispatch`;
4. se inserta el receipt con linkage fiscal;
5. commit;
6. procesamiento posterior continúa idempotente.

Así, reprepare y llegada de evidencia no pueden ganar simultáneamente.

### Ingesta inicialmente no correlacionable

Un webhook que no puede correlacionarse de forma segura se persiste como receipt general 002, sin inventar document/generation. Si luego aparece evidencia suficiente para correlacionarlo:

1. se resuelve el dispatch histórico;
2. se toma el mismo fence;
3. se bloquea el receipt;
4. se fijan las columnas fiscales una sola vez;
5. la evidencia queda ligada a la generación histórica del dispatch, aunque el documento tenga otra generación actual.

Una correlación tardía nunca cambia a “current generation” por conveniencia ni timestamp.

## 4. Fence canónico

La clave lógica del fence es:

```text
(tenant_id, electronic_document_id, preparation_generation)
```

No se crea una tabla `fence`. La serialización se apoya en row locks/CAS sobre `ElectronicDocument`, `FiscalDocumentPreparation` y los recursos relacionados.

Suffix de locks para evidencia fiscal:

```text
ElectronicDocument
-> FiscalDocumentPreparation
-> IntegrationDispatch
-> ExternalWebhookReceipt correlacionado
-> FiscalSubmissionAttempt
-> FiscalReconciliation
-> FiscalIncident
-> FiscalReconciliationItem
```

Cuando una operación requiere capability/configuración usa antes el prefijo universal definido en el manifest 003. Dentro de cada nivel: UUID ascendente.

Ningún HTTP ocurre mientras se mantienen estos locks.

## 5. Reprepare vs receipt/worker

`REPREPARE_BEFORE_SUBMISSION` debe reconsultar bajo el mismo fence, inmediatamente antes del commit:

- version/status del `ElectronicDocument`;
- `preparation_generation` actual;
- estado de la preparación;
- dispatch/claim;
- attempts;
- artifacts;
- receipts correlacionados en todos sus estados;
- reconciliations aplicables;
- provider/authority/legal identities y cualquier evidence flag.

Solo con cero exposición cancela un dispatch QUEUED elegible, cancela la preparación histórica y confirma generation+1.

Races esperadas:

- webhook gana primero → receipt durable → reprepare falla;
- reprepare gana primero → old dispatch/preparation quedan cancelados; una correlación tardía se liga a la generación histórica y no modifica la nueva;
- worker claim gana primero → attempt/lease durable → reprepare falla;
- reprepare gana primero → old dispatch CANCELLED → worker no puede reclamarlo.

## 6. Query/retrieve fuera de V1

Migration 003 v1 no materializa:

```text
QUERY_DOCUMENT_STATUS
RETRIEVE_ARTIFACT
```

Por tanto, este contrato no inventa dispatches o attempts para polling/query. Una futura capability de consulta deberá definir antes de HTTP:

- capability/provider declaration;
- root/idempotency propia;
- claim/lease durable;
- vínculo document/preparation/generation;
- rate limit;
- result normalization;
- interacción con UNKNOWN_OUTCOME;
- permisos/auditoría;
- pruebas negativas;
- soporte real del provider.

Hasta entonces, reconciliation v1 usa evidencia ya recibida, webhook validado, respuesta síncrona o evidencia manual/autoridad.

## 7. Constraints/guards/indexes 003

Nombres normativos candidatos:

```text
integration_dispatches_fiscal_preparation_ck
integration_dispatches_fiscal_preparation_fk
integration_dispatches_fiscal_preparation_idx
external_webhook_receipts_fiscal_correlation_ck
external_webhook_receipts_fiscal_dispatch_fk
external_webhook_receipts_fiscal_document_fk
external_webhook_receipts_fiscal_preparation_fk
external_webhook_receipts_fiscal_correlation_idx
external_webhook_receipts_fiscal_correlation_guard
```

El guard de receipt permite únicamente NULL→correlación válida una vez y cambios normales 002 de processing lifecycle; prohíbe rebind de fiscal IDs/generation.

El guard de dispatch prohíbe modificar preparation/generation después de insertar y valida el checksum/root en creación FISCAL.

## 8. RLS/grants

Las nuevas columnas heredan la RLS tenant-aware de las tablas 002; 003 no crea una policy que amplíe visibilidad.

- runtime que no procesa fiscal no recibe acceso adicional;
- `pos_worker` recibe solo columnas necesarias para claim/correlación fiscal;
- `pos_app` puede leer estado mínimo de su dispatch/receipt según contrato, pero no reasignar correlaciones;
- `pos_platform_admin` sigue read-only allowlisted;
- PUBLIC/reporting no reciben acceso;
- columnas futuras: DENY BY DEFAULT.

## 9. Apply/down ownership

Apply 003 agrega columnas/constraints/guards/indexes únicamente después de crear los owners fiscales necesarios y antes de habilitar FISCAL.

Down 003 elegible:

1. restaura primero el constraint 002 que bloquea FISCAL;
2. demuestra cero dispatch/receipt correlation fiscal;
3. retira FKs/guards/indexes/columnas 003;
4. solo después elimina tablas fiscales dependientes.

002 permanece byte-for-byte inmutable.

## 10. Criterios de review

Debe demostrarse, como mínimo:

- receipt pendiente vs reprepare serializa;
- receipt PROCESSED/REJECTED/dead-letter también bloquea;
- correlation tardía queda en generation histórica;
- worker claim vs reprepare serializa;
- same dispatch retries conservan root;
- different preparation genera root distinta;
- NON_FISCAL no admite columnas fiscales;
- cross-tenant/company/integration/generation falla;
- 001/002 validators siguen PASS;
- no SQL003/provider/security-state promotion.

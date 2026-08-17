# Contrato físico general de integraciones externas

## Estado y alcance

`CLOSED` como contrato físico documental. Este cierre no implementa adapters HTTP, no crea migration SQL, no verifica proveedores y no cambia `SEC-G01` a `SEC-G10`, que permanecen `PLANNED / NOT_EVALUATED`.

El módulo `External Integrations` es propietario de conexiones generales con ERP, plataformas contables y proveedores tecnológicos; descubrimiento, capabilities, mappings, ownership de recursos, dispatch central, rate limits, recepción durable de webhooks y evidencia de verificación. `Electronic Invoicing` conserva el ownership fiscal y referencia una integración general mediante `FiscalConnection`.

`ExternalIntegration` es el nombre canónico de la conexión general. No existe una entidad paralela `ProviderIntegration`. `ExternalReferenceMapping` es el mapping canónico; no existe `ProviderMapping`. `ElectronicDocument` permanece como único agregado canónico de documento electrónico.

## Ubicación, autoridad y dialectos

Las tablas pertenecen al schema PostgreSQL central `integrations`. No tienen contraparte SQLite porque credenciales, tokens, account identity, discovery remoto, health, rate limiting y dispatch a terceros son responsabilidades centrales. Un corte local futuro puede conservar identidad fiscal, intención, snapshots y estado conocido sin secretos, pero no replica estas tablas ni amplía autoridad.

| Contrato | Autoridad |
|---|---|
| ProviderRegistry / ProviderAdapterVersion | plataforma central, administrada y versionada |
| ExternalIntegration / CredentialBinding | tenant/company central; cambios sensibles autorizados |
| IntegrationCapability / ResourceOwnershipPolicy | configuración central publicada y revisada |
| DiscoveryRun / DiscoveryItem / ExternalReferenceMapping | central; evidencia externa bajo adapter y revisión humana cuando aplique |
| IntegrationDispatch | central; intención, routing, correlación y estado agregado central↔provider |
| IntegrationDispatchAttempt | central; attempts exclusivamente no fiscales |
| FiscalSubmissionAttempt | Electronic Invoicing; único owner de attempts fiscales |
| ExternalWebhookReceipt | evidencia de transporte append-only; procesamiento central idempotente |
| ProviderRateLimitPolicy | contrato externo/configuración central versionada |
| ProviderVerificationEvidence | evidencia central; nunca eleva estado sin evaluación formal |

Convención para toda tabla tenant-scoped de este documento: PK UUID v7 global; candidate key `UNIQUE (tenant_id, id)` y, cuando aplique, `(tenant_id, company_id, id)`; FKs compuestas tenant/company-aware; `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`; actor/contexto derivados del backend; índices por scope y estado; `RESTRICT/NO ACTION` o retiro/archivo en lugar de cascade destructivo. Las tablas globales de plataforma no usan tenant RLS, pero solo el rol administrativo versionado puede mutarlas.

## ProviderRegistry y versiones de adapter

`integrations.provider_registry` es un catálogo global administrado, no tenant-scoped y no editable por runtimes. Permite códigos conocidos `SIIGO`, `FACTUS`, `ALEGRA`, `THE_FACTORY_HKA`, `ODOO` y códigos futuros registrados; `OTHER` solo identifica una definición explícita aún no promovida y no autoriza un adapter genérico inseguro.

Columnas mínimas:

```text
provider_id uuid PK
provider_code text NOT NULL
display_name text NOT NULL
integration_class text NOT NULL
status text NOT NULL
official_reference_uri text NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
version bigint NOT NULL
```

`provider_code` usa formato estable uppercase `^[A-Z][A-Z0-9_]{1,63}$`, con `UNIQUE (provider_code)`. No es un enum PostgreSQL: agregar un proveedor exige registro administrado y adapter allowlisted, no rediseñar Company ni el dominio. `integration_class` admite inicialmente `ERP_ACCOUNTING`, `ELECTRONIC_DOCUMENT_PROVIDER`, `HYBRID` y `OTHER_REVIEW_REQUIRED`. `status` admite `ACTIVE`, `RETIRED` y `BLOCKED`; activar no significa que exista adapter productivo.

`integrations.provider_adapter_versions` separa implementación de verificación:

```text
provider_adapter_version_id uuid PK
provider_id uuid NOT NULL
adapter_code text NOT NULL
adapter_version text NOT NULL
contract_version integer NOT NULL
implementation_status text NOT NULL
verification_status text NOT NULL
released_at timestamptz NULL
retired_at timestamptz NULL
created_at timestamptz NOT NULL
```

- `implementation_status`: `DESIGNED`, `IMPLEMENTED`.
- `verification_status`: `NOT_EVALUATED`, `MOCK_TESTED`, `SANDBOX_VERIFIED`, `PRODUCTION_VERIFIED`, `CERTIFIED`.
- `UNIQUE (provider_id, adapter_code, adapter_version)`.
- `CERTIFIED` exige evidencia formal del proveedor o autoridad. Toda promoción de verification status ocurre en la misma frontera transaccional que inserta/revisa `ProviderVerificationEvidence`; la versión no mantiene una FK circular de “latest evidence”. `IMPLEMENTED` no promueve automáticamente verificación. Un fake de pruebas no se registra como provider adapter.
- FK Provider usa `ON DELETE RESTRICT`. Versiones usadas por integraciones o documentos no se borran; se retiran.

`integrations.provider_capability_declarations` registra qué capability declara cada versión del adapter, con `provider_id`, `provider_adapter_version_id`, `capability_code`, `support_status`, `official_reference_uri`, `verified_at`, `created_at` y `version`. `support_status` admite `SUPPORTED`, `UNSUPPORTED`, `UNVERIFIED`; `UNIQUE (provider_adapter_version_id, capability_code)`. Esta declaración global no activa la capability para una empresa: `IntegrationCapability` es la asignación efectiva por conexión.

`integrations.provider_platform_configurations` conserva configuración de nuestra plataforma, no credenciales del cliente: `id`, `provider_id`, `environment`, `configuration_type`, `configuration_schema_version`, `configuration_payload jsonb`, `status`, vigencia, timestamps y `version`. El payload es allowlisted por provider/type y no admite secretos. Para Siigo, `PARTNER_ID` vive aquí, global por ambiente del integrador; no se copia a cada tenant ni se confunde con `username/access_key`. `UNIQUE (provider_id, environment, configuration_type, configuration_schema_version)`; versiones publicadas no se editan ni borran.

## ExternalIntegration

`integrations.external_integrations` representa una cuenta/conexión externa general. Identidad UUID v7: `id`.

| Columna | PostgreSQL | Regla |
|---|---|---|
| `id` | `uuid` | PK global y UUID v7 |
| `tenant_id`, `company_id` | `uuid` | scope obligatorio y FK compuesta a Company |
| `branch_id` | `uuid NULL` | solo si el contrato oficial exige configuración realmente distinta por sucursal; FK compuesta al mismo tenant/company |
| `provider_id` | `uuid` | FK a ProviderRegistry |
| `provider_code_snapshot` | `text` | código congelado para evidencia; debe coincidir al crear |
| `provider_adapter_version_id` | `uuid` | versión allowlisted del adapter |
| `environment` | `text` | `SANDBOX`, `TEST`, `PRODUCTION` u otro ambiente registrado y validado por provider; no inventa sandbox |
| `status` | `text` | lifecycle normativo |
| `credential_binding_id` | `uuid NULL` | binding activo; nunca valor secreto |
| `configuration_version` | `bigint` | versión publicada de configuración no secreta |
| `provider_account_reference` | `text NULL` | identidad no secreta descubierta/validada |
| `last_health_check_at`, `last_success_at`, `last_failure_at` | `timestamptz NULL` | observación técnica; no reescribe lifecycle por sí sola |
| `activated_at`, `disabled_at` | `timestamptz NULL` | coherentes con estado |
| `created_at`, `updated_at` | `timestamptz` | timestamps centrales |
| `version` | `bigint` | optimistic concurrency, inicial 1 |

Constraints e índices:

- `UNIQUE (tenant_id, id)` y `UNIQUE (tenant_id, company_id, id)` para FKs dependientes;
- unique parcial de conexión activa por `(tenant_id, company_id, branch_id-normalized, provider_id, environment, provider_account_reference)` cuando la referencia exista; una segunda conexión requiere account identity distinta y revisión explícita;
- la semántica de `branch_id NULL` se implementa con índices parciales separados, no con igualdad NULL ambigua;
- FKs tenant-aware a Company, Branch y CredentialBinding; Provider/AdapterVersion globales mediante FKs directas;
- índices `(tenant_id, company_id, status, provider_id)`, `(provider_id, environment, status)`, health vencido y rotación requerida;
- RLS `ENABLE` + `FORCE`; tenant derivado de contexto autenticado, nunca del request;
- Company, Branch, Provider, AdapterVersion y CredentialBinding usan `ON DELETE RESTRICT/NO ACTION`; una integración con historia se deshabilita, no se borra en cascade;
- actor, permiso, motivo, versión previa/nueva y correlation ID se registran en Audit para configure, test, map, review, activate, disable, rotate y revalidate, sin secretos ni payloads completos.

### Lifecycle

Estados persistentes:

`CREATED`, `CREDENTIALS_CONFIGURED`, `AUTHENTICATED`, `DISCOVERING`, `DISCOVERY_COMPLETE`, `MAPPING_REQUIRED`, `READY_FOR_REVIEW`, `ACTIVE`, `DEGRADED`, `DISABLED`, `CREDENTIAL_ROTATION_REQUIRED`, `ERROR`.

Reglas:

1. `Connect` crea o configura referencias y nunca demuestra autenticación.
2. `Test connection` usa el secret central, valida identidad de cuenta y registra evidencia sanitizada; la UI “Connected” no cambia verification status.
3. `Discover` crea un `IntegrationDiscoveryRun`; un resultado incompleto no se presenta como configuración completa.
4. Si existen mappings obligatorios, el estado es `MAPPING_REQUIRED`; no puede saltar a `ACTIVE`.
5. `Review` valida provider/account/environment/capabilities/ownership/mappings y segregación de funciones.
6. `Activate` exige adapter compatible, credencial vigente, capabilities aprobadas y revisión; puede exigir MFA/reauthentication.
7. `DEGRADED` expresa health operacional, no revoca evidencia ni altera Sale/Payment/ElectronicDocument.
8. `Rotate credentials` crea un binding nuevo, prueba/revalida y luego retira el anterior; nunca vuelve a mostrar el secreto.
9. `DISABLED` impide nuevos dispatches, pero conserva mappings, documentos, attempts, receipts y auditoría.
10. Repetir comandos conserva idempotency key y request checksum; mismo key con checksum distinto es conflicto.

## CredentialBinding y lifecycle de tokens

`integrations.integration_credential_bindings` conserva solo referencias opacas:

```text
id uuid PK
tenant_id uuid
company_id uuid
integration_id uuid
credential_reference text
credential_kind text
generation integer
status text
activated_at timestamptz NULL
rotation_due_at timestamptz NULL
superseded_at timestamptz NULL
revoked_at timestamptz NULL
created_at timestamptz
version bigint
```

`UNIQUE (tenant_id, integration_id, generation)` y un único binding `ACTIVE` por integración mediante índice parcial. `credential_reference` no puede aparecer en payloads de Sync/Outbox/Audit ni llegar al renderer/PWA. El valor referenciado pertenece al mecanismo de `SEC-004`, scoped por tenant/company/provider/environment.

Se distinguen:

- credenciales de cliente long-lived: Siigo `username/access_key`, Factus `client_id/client_secret/username/password`, Alegra API email/API token;
- configuración de plataforma no secreta o secret-scoped propia: Siigo `Partner-Id` es configuración de plataforma común del integrador, no secreto por cliente;
- access tokens short-lived: se custodian en memoria/cache protegida o secret facility de corta duración, nunca como columna de negocio;
- refresh tokens: secreto rotatable central y provider-specific; si existe, se reemplaza/revoca según respuesta real;
- `expires_in`: se usa desde la respuesta efectiva; no se hard-codea como autoridad aunque ejemplos documentales muestren valores.

## IntegrationCapability

`integrations.integration_capabilities` declara capacidades por conexión y versión:

```text
id uuid PK
tenant_id uuid
company_id uuid
integration_id uuid
capability_code text
support_status text
ownership_policy_id uuid NULL
configuration_version bigint
effective_from timestamptz
effective_until timestamptz NULL
source_reference_uri text NULL
verified_at timestamptz NULL
created_at timestamptz
version bigint
```

Capabilities iniciales: `ELECTRONIC_INVOICING`, `ACCOUNTING`, `CUSTOMERS`, `PRODUCTS`, `INVENTORY`, `PURCHASES`, `PAYMENTS`, `CREDIT_NOTES`, `SUPPORT_DOCUMENTS`, `WEBHOOKS`, `REPORTING`. El código es catálogo extensible administrado, no columnas booleanas en Company.

`support_status` admite `SUPPORTED`, `UNSUPPORTED`, `UNVERIFIED`, `DISABLED`. `SUPPORTED` exige fuente oficial para diseño; activar productivamente exige además adapter implementado, configuración válida y evidencia aplicable. `UNIQUE (tenant_id, integration_id, capability_code, configuration_version)`. FK tenant-aware a ExternalIntegration y ownership policy. Retirar una capability cierra vigencia; no reescribe snapshots ni historia.

## ResourceOwnershipPolicy

`integrations.resource_ownership_policies` declara autoridad por recurso y operación:

```text
id uuid PK
tenant_id uuid
company_id uuid
integration_id uuid
resource_type text
operation_scope text
authority_type text
conflict_policy_code text NULL
policy_version bigint
status text
effective_from timestamptz
effective_until timestamptz NULL
created_at timestamptz
```

`authority_type` admite exactamente:

- `POS_AUTHORITATIVE`;
- `PROVIDER_AUTHORITATIVE`;
- `BIDIRECTIONAL_WITH_EXPLICIT_CONFLICT_POLICY`;
- `REFERENCE_ONLY`.

`BIDIRECTIONAL_WITH_EXPLICIT_CONFLICT_POLICY` exige `conflict_policy_code` publicado; los demás lo prohíben salvo metadata explicativa separada. No existe last-write-wins genérico. `UNIQUE (tenant_id, integration_id, resource_type, operation_scope, policy_version)`.

Baseline recomendado: Sale completada `POS_AUTHORITATIVE`; resultado legal/fiscal `PROVIDER_AUTHORITATIVE`; catálogos externos descubiertos `REFERENCE_ONLY`; sincronización bidireccional queda deshabilitada salvo caso de uso y policy explícita.

### Dos planos de autoridad

`ResourceOwnershipPolicy` gobierna exclusivamente el plano `CENTRAL POS PLATFORM ↔ EXTERNAL PROVIDER`. No reemplaza, extiende ni reutiliza `SyncOperation.authority_policy`, que gobierna el plano `LOCAL POS NODE ↔ CENTRAL PLATFORM` conforme a `DEC-007`. Los catálogos son independientes y no existe equivalencia 1:1 entre sus valores.

| Recurso/resultado | Local ↔ Central: `SyncOperation.authority_policy` | Central ↔ Provider: `ResourceOwnershipPolicy` |
|---|---|---|
| Sale completada | `APPEND_ONLY_SHARED` | `POS_AUTHORITATIVE` |
| Resultado legal/fiscal | la operación fiscal conserva `EXTERNAL_PROVIDER_AUTHORITATIVE` cuando aplique | `PROVIDER_AUTHORITATIVE` |
| Catálogo externo de referencia | policy local aplicable al dominio consumidor | `REFERENCE_ONLY` |

La respuesta fiscal o contable de un provider no transfiere ownership de Sale, Payment, Product, Customer, Tax o Inventory. Cada operación que cruza ambos planos conserva ambas decisiones de autoridad por separado; no traduce un valor al otro por similitud nominal.

## Discovery y mapping

`integrations.integration_discovery_runs` conserva una ejecución idempotente: scope tenant/company/integration, `discovery_type`, `status`, `idempotency_key`, `request_checksum`, adapter version, started/completed timestamps, counts, error code seguro, evidence reference y correlation ID. Estados: `CREATED`, `RUNNING`, `COMPLETED`, `PARTIAL`, `FAILED`, `CANCELLED`. `UNIQUE (tenant_id, integration_id, idempotency_key)`.

`integrations.integration_discovery_items` conserva por run el `resource_type`, external ID/code sanitizados, display reference allowlisted, provider checksum, proposed internal reference nullable, review status y metadata limitada. No almacena credenciales ni payload bruto. `UNIQUE (tenant_id, discovery_run_id, resource_type, external_id)`.

La discovery incluye solo recursos que el API oficial permita: empresa/cuenta, tipos documentales, rangos, impuestos, formas/métodos de pago, bodegas, vendedores, contactos/clientes, productos/items, cuentas y centros de costo. Nunca obliga al usuario a teclear IDs opacos que puedan descubrirse.

## ExternalReferenceMapping

`integrations.external_reference_mappings` prohíbe columnas como `product.siigo_id` o `customer.alegra_id`.

| Columna | Regla |
|---|---|
| `id`, `tenant_id`, `company_id`, `integration_id` | UUID v7 y FK tenant-aware |
| `resource_type` | recurso externo estable |
| `internal_entity_type`, `internal_entity_id` | referencia interna tipada; se valida por puerto propietario y mismo tenant/company |
| `external_id` | identidad externa opaca, nunca autoridad de acceso |
| `external_code` | nullable, para código visible cuando el proveedor lo distinga |
| `mapping_status` | `PROPOSED`, `VERIFIED`, `ACTIVE`, `CONFLICT`, `STALE`, `RETIRED` |
| `verified_at`, `verified_by_actor_id` | requeridos al verificar/activar |
| `provider_metadata` | `jsonb` allowlisted, schema-versioned, sanitizado y sin secretos |
| `created_at`, `updated_at`, `version` | historia y optimistic concurrency |

Constraints:

- `UNIQUE (tenant_id, integration_id, resource_type, internal_entity_type, internal_entity_id)` para un mapping vigente por recurso interno;
- `UNIQUE (tenant_id, integration_id, resource_type, external_id)` para impedir que una identidad externa apunte a dos internos;
- `external_code` no reemplaza `external_id`; su unicidad solo se activa por adapter/resource cuando el contrato oficial lo garantiza;
- misma identidad con asociación distinta pasa a `CONFLICT`, no sobrescribe;
- cross-tenant/company se rechaza antes de persistir y por FK/constraint cuando exista FK fuerte;
- índices por interno, externo, status y mappings pendientes/stale;
- ExternalIntegration, recursos canónicos e historia fiscal usan `RESTRICT/NO ACTION`; retirar un mapping no elimina evidencia ni entidades canónicas.

## IntegrationDispatch y reconciliación externa

`SyncOperation` transporta local↔central. No representa por sí sola una llamada a un tercero. `integrations.integration_dispatches` materializa la intención central↔provider y referencia la operación/domain event causal:

```text
id uuid PK
tenant_id uuid
company_id uuid
integration_id uuid
capability_code text
dispatch_class text
resource_type text
internal_operation_id uuid
internal_entity_type text
internal_entity_id uuid
provider_request_reference text
idempotency_key text
payload_schema_version integer
payload_checksum text
status text
retry_classification text NULL
next_attempt_at timestamptz NULL
last_reconciled_at timestamptz NULL
correlation_id uuid
causation_id uuid NULL
created_at timestamptz
updated_at timestamptz
version bigint
```

Estados: `QUEUED`, `DISPATCHING`, `SUCCEEDED`, `RETRY_SCHEDULED`, `UNKNOWN_OUTCOME`, `RECONCILIATION_REQUIRED`, `PERMANENT_FAILURE`, `DEAD_LETTER`, `CANCELLED`. `UNIQUE (tenant_id, integration_id, idempotency_key)`; el payload no contiene secretos. La misma key con checksum distinto es conflicto.

`dispatch_class` admite exactamente `FISCAL` y `NON_FISCAL`:

- `FISCAL` es obligatorio para `ELECTRONIC_INVOICING`, `CREDIT_NOTES`, `SUPPORT_DOCUMENTS` y cualquier operación cuyo lifecycle legal/fiscal pertenezca a `ElectronicDocument`/`FiscalConnection`; exige `internal_entity_type = 'ElectronicDocument'` y su attempt owner es exclusivamente `FiscalSubmissionAttempt`;
- `NON_FISCAL` cubre sincronización de customers, products, inventory, accounting, reporting y otros recursos no fiscales realmente habilitados; su attempt owner es `IntegrationDispatchAttempt`;
- un `CHECK` físico exige `dispatch_class = 'FISCAL'` cuando `capability_code IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','SUPPORT_DOCUMENTS')` o `internal_entity_type = 'ElectronicDocument'`, y prohíbe esas combinaciones en `NON_FISCAL`; una capability fiscal futura requiere ampliar primero esta allowlist/constraint versionada;
- la clasificación también se valida server-side contra capability/resource allowlisted. Un adapter o request no puede elegirla ni reclasificar una operación fiscal como no fiscal;
- existen candidate keys `UNIQUE (tenant_id, id, dispatch_class)` y `UNIQUE (tenant_id, company_id, id, dispatch_class)` para FKs discriminadas según el scope materializado por cada tipo de attempt.

`IntegrationDispatch` fiscal referencia el `ElectronicDocument`, conserva intención, routing, idempotencia, correlación y estado agregado de orquestación. No conserva attempt number, request/response HTTP, `Retry-After`, provider operation ID ni resultado técnico autoritativo por intento. Su estado avanza desde el resultado del owner fiscal sin copiar su historial.

`IntegrationDispatchAttempt` está limitado físicamente a dispatches `NON_FISCAL`. Conserva attempt number, request ID, transport/http status, provider operation/reference, retry-after, tiempos y diagnostic reference sanitizada para esas operaciones. Su FK incluye `(tenant_id, company_id, integration_dispatch_id, dispatch_class)` y su propia constraint fija `dispatch_class = 'NON_FISCAL'`; por tanto, no puede referenciar un dispatch fiscal. `UNIQUE (tenant_id, integration_dispatch_id, attempt_number)`. Timeout ambiguo produce `UNKNOWN_OUTCOME`; antes de reintentar un POST con efecto se consulta/reconcilia cuando el API lo permita.

Para un dispatch `FISCAL`, `FiscalSubmissionAttempt.integration_dispatch_id` usa la FK complementaria con discriminador fijo `FISCAL`. Un mismo dispatch fiscal puede originar varios attempts numerados, pero ninguno puede materializarse como `IntegrationDispatchAttempt`. Para una misma interacción fiscal externa no pueden existir dos registros autoritativos independientes de attempt.

## ExternalWebhookReceipt

`integrations.external_webhook_receipts` recibe durablemente antes de procesar:

```text
id uuid PK
tenant_id uuid
company_id uuid
integration_id uuid
provider_event_id text NULL
deduplication_key text
received_at timestamptz
payload_schema_version integer
payload_checksum text
payload_evidence_reference text NULL
authentication_verification_result text
replay_verification_result text
processing_status text
attempt_count integer
next_attempt_at timestamptz NULL
last_error_code text NULL
correlation_id uuid
processed_at timestamptz NULL
created_at timestamptz
version bigint
```

- tenant/company se derivan de una ruta/identidad opaca asociada a Integration; nunca del payload solamente;
- HTTPS obligatorio; firma, token, Basic, secret URL u otro mecanismo se usa únicamente si el proveedor lo documenta;
- `authentication_verification_result`: `VERIFIED`, `FAILED`, `UNSUPPORTED_BY_PROVIDER`, `UNVERIFIED_CONTRACT`;
- status: `RECEIVED`, `REJECTED`, `PENDING`, `PROCESSING`, `PROCESSED`, `RETRY_SCHEDULED`, `DEAD_LETTER`;
- `UNIQUE (tenant_id, integration_id, deduplication_key)`; provider event ID participa cuando exista, de otro modo se usa una identidad canónica documentada;
- payload size/depth limits, content type, schema, timestamp/nonce cuando existan, sanitización y procesamiento idempotente son obligatorios;
- el payload bruto se conserva solo como evidencia protegida y referenciada cuando sea necesario; no entra a Audit/logs.

## ProviderRateLimitPolicy

`integrations.provider_rate_limit_policies` versiona límites externos:

```text
id uuid PK
provider_id uuid
tenant_id uuid NULL
company_id uuid NULL
integration_id uuid NULL
endpoint_class text
request_limit integer NULL
window_seconds integer NULL
concurrency_limit integer NULL
retry_after_mode text
backoff_policy_code text
cooldown_seconds integer NULL
source_reference_uri text NULL
status text
valid_from timestamptz
valid_until timestamptz NULL
last_rate_limit_event_at timestamptz NULL
version bigint
```

Precedencia explícita: integration/account > company > tenant > provider default. Los scopes ausentes no se mezclan entre cuentas. Valores NULL significan `UNVERIFIED/PROVIDER_HEADER_DRIVEN` según `retry_after_mode`, no ilimitado. Headers efectivos como `Retry-After` y reset prevalecen para el evento; los límites no se hard-codean dispersos en negocio. `UNIQUE` por scope, endpoint class y versión vigente.

## ProviderVerificationEvidence

`integrations.provider_verification_evidence` conserva metadata y referencia inmutable a evidencia protegida:

```text
id uuid PK
provider_id uuid
provider_adapter_version_id uuid
integration_id uuid NULL
environment text
evidence_level text
test_suite_version text
source_commit text
executed_at timestamptz
authorized_account_reference text NULL
result text
evidence_reference text
evidence_checksum text
reviewed_by_actor_id uuid NULL
reviewed_at timestamptz NULL
expires_at timestamptz NULL
created_at timestamptz
```

`evidence_level`: `DOCUMENTED`, `IMPLEMENTED`, `MOCK_TESTED`, `SANDBOX_VERIFIED`, `PRODUCTION_VERIFIED`, `CERTIFIED`. `result`: `PASS`, `FAIL`, `BLOCKED`. Credenciales y payloads reales están prohibidos. La promoción requiere evaluación de autenticación, discovery, operación autorizada, parsing, status reconciliation, duplicate/idempotency, timeout ambiguo, rotación, leakage, cross-tenant, rate limiting, dead letter, audit sanitization y artefactos fiscales aplicables.

## Fronteras transaccionales y local-first

```text
transacción local
  -> SyncOperation + Outbox
  -> recepción central e Inbox
  -> IntegrationDispatch durable
  -> provider adapter
  -> resultado normalizado
  -> mapping/documento/proyección propietaria + reconciliación
```

La llamada HTTP nunca comparte la transacción local ni el commit central de la intención. Venta completada permanece POS-authoritative. Resultados legales/fiscales externos son provider-authoritative. Un requisito legal síncrono futuro debe documentar fuente, tipo documental, modo operativo y degradación; no se infiere de la disponibilidad del adapter.

## Seguridad y delete/history

- `SEC-G01`: RLS/FORCE, FKs tenant-aware, integración y mapping sin ambigüedad.
- `SEC-G03`: permisos atómicos para configure/test/discover/map/review/activate/disable/rotate/revalidate y segregación.
- `SEC-G05`: idempotencia, checksum, anti-replay, orden y resultado incierto.
- `SEC-G06`: Audit append-only sanitizado y causalidad.
- `SEC-G07`: secret manager, token lifecycle, rotación, revocación y pruebas de fuga.
- `SEC-G08`: schemas server-side, BOLA/IDOR, SSRF/egress allowlist, CORS aplicable, webhook y rate limiting.
- `SEC-G09`: TLS, destinos oficiales allowlisted, supply chain de adapters, backup/restore sin secretos.
- `SEC-G10`: promoción fail-closed por evidencia y sin claims falsos.

Ningún gate cambia a PASS por este documento. Registros fiscales, dispatch, attempts, mappings históricos, receipts, evidence y reconciliación usan `RESTRICT/NO ACTION`, retiro o archival; ningún cascade destructivo borra evidencia.

## Extensibilidad comercial

Las integraciones no añaden flags ni IDs de proveedor a Product, Sale, Inventory, Payment, Tax, Company o Customer. Minimercado, supermercado, avícola/alimentos, droguería, ferretería, floristería y retail general comparten el core; capacidades verticales siguen en módulos, policies, presentaciones y extensiones tipadas. Provider capabilities y business capabilities son catálogos distintos.

## Criterio de cierre

El contrato obtiene `PASS` documental si la revisión transversal confirma identidad, scope, FKs, uniques, delete policy, índices, lifecycle, ownership, secrets, dispatch, webhook, rate limits, evidencia, reconciliación fiscal y compatibilidad con migration 001. Este PASS no implementa ni verifica ningún provider y solo habilita diseñar una migration 002 aditiva independiente.

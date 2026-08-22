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

`integrations.provider_platform_configurations` conserva configuración de nuestra plataforma, no credenciales del cliente: `id`, `provider_id`, `environment`, `configuration_type`, `configuration_schema_version`, `configuration_payload jsonb`, `status`, `valid_from`, `valid_until`, `published_at`, timestamps, business `version` y `row_version`. El payload es allowlisted por provider/type y no admite secretos. Para Siigo, `PARTNER_ID` vive aquí, global por ambiente del integrador; no se copia a cada tenant ni se confunde con `username/access_key`. `UNIQUE (provider_id, environment, configuration_type, version)`; versiones publicadas no se editan ni borran. Para un mismo provider/environment/type, una exclusion constraint PostgreSQL con rango semiabierto impide que dos filas `PUBLISHED` se solapen; `valid_until NULL` significa extremo abierto y siempre se exige `valid_from < valid_until` cuando exista. Su contrato JSON normativo es objeto máximo 16 KiB/profundidad 4/array 32/string 2 KiB, con schema allowlisted por provider+type+version, unknown keys y claves secret-like rechazadas, sin JSON index; los detalles transversales están en el manifest 002.

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
| `configuration_version` | `bigint` | versión publicada de configuración no secreta |
| `provider_account_reference` | `text NULL` | identidad no secreta descubierta/validada |
| `last_health_check_at`, `last_success_at`, `last_failure_at` | `timestamptz NULL` | observación técnica; no reescribe lifecycle por sí sola |
| `activated_at`, `disabled_at` | `timestamptz NULL` | coherentes con estado |
| `created_at`, `updated_at` | `timestamptz` | timestamps centrales |
| `version` | `bigint` | optimistic concurrency, inicial 1 |

Constraints e índices:

- `UNIQUE (tenant_id, id)` y `UNIQUE (tenant_id, company_id, id)` para FKs dependientes;
- `UNIQUE (tenant_id, company_id, id, provider_id)` para dependientes que deban demostrar simultáneamente Integration y Provider, sin confiar en dos FKs independientes;
- unique parcial de conexión activa por `(tenant_id, company_id, branch_id-normalized, provider_id, environment, provider_account_reference)` cuando la referencia exista; una segunda conexión requiere account identity distinta y revisión explícita;
- la semántica de `branch_id NULL` se implementa con índices parciales separados, no con igualdad NULL ambigua;
- FKs tenant-aware a Company y Branch; Provider/AdapterVersion globales mediante FKs directas; no existe pointer ni FK inversa hacia CredentialBinding;
- índices `(tenant_id, company_id, status, provider_id)`, `(provider_id, environment, status)`, health vencido y rotación requerida;
- RLS `ENABLE` + `FORCE`; tenant derivado de contexto autenticado, nunca del request;
- Company, Branch, Provider y AdapterVersion usan `ON DELETE RESTRICT/NO ACTION`; CredentialBinding referencia a la integración en una sola dirección y una integración con historia se deshabilita, no se borra en cascade;
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
8. `Rotate credentials` crea un binding PENDING, asocia una referencia opaca, prueba/revalida fuera de la transacción y, al activar, cambia el ACTIVE anterior a SUPERSEDED/REVOKED y el nuevo a ACTIVE en una sola transacción; nunca vuelve a mostrar el secreto.
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

`IntegrationCredentialBinding` es el único owner del lifecycle y del binding activo. `UNIQUE (tenant_id, integration_id, generation)` y `integration_credential_bindings_active_uq(tenant_id,integration_id) WHERE status='ACTIVE'` garantizan **AT MOST ONE ACTIVE**; ExternalIntegration no conserva otro pointer. Cero ACTIVE es válido en `CREATED`, `CREDENTIALS_CONFIGURED`, `CREDENTIAL_ROTATION_REQUIRED`, `DISABLED` y `ERROR`. El servidor exige **EXACTLY ONE ACTIVE** antes de entrar o permanecer en `AUTHENTICATED`, `DISCOVERING`, `DISCOVERY_COMPLETE`, `MAPPING_REQUIRED`, `READY_FOR_REVIEW`, `ACTIVE` o `DEGRADED`. `credential_reference` no puede aparecer en payloads de Sync/Outbox/Audit ni llegar al renderer/PWA. El valor referenciado pertenece al mecanismo de `SEC-004`, scoped por tenant/company/provider/environment.

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

Capabilities iniciales: `ELECTRONIC_INVOICING`, `ACCOUNTING`, `CUSTOMERS`, `PRODUCTS`, `INVENTORY`, `PURCHASES`, `PAYMENTS`, `CREDIT_NOTES`, `DEBIT_NOTES`, `SUPPORT_DOCUMENTS`, `WEBHOOKS`, `REPORTING`. `DEBIT_NOTES` es una extensión documental aditiva owned por migration 003; SQL 002 permanece inmutable. El código es catálogo extensible administrado, no columnas booleanas en Company.

Una `ProviderCapabilityDeclaration` declara soporte de una versión de adapter; una `IntegrationCapability` configura ese soporte para una cuenta concreta. Una IntegrationCapability no puede ser efectiva como `SUPPORTED`, ni activar la integración ni originar dispatch, si el adapter seleccionado no declara el mismo código como `SUPPORTED`. El backend lo valida fail-closed bajo lock en la misma transacción; las FKs de adapter/integration, checks y uniques son complementos físicos, no una FK artificial entre scopes distintos.

El orden canónico universal es `ProviderCapabilityDeclaration -> ProviderAdapterVersion -> ExternalIntegration -> IntegrationCapability -> FiscalConnection -> FiscalEmissionConfiguration -> FiscalEmissionConfigurationVersion -> ElectronicDocument -> IntegrationDispatch -> FiscalSubmissionAttempt -> FiscalReconciliation -> FiscalIncident -> FiscalReconciliationItem`, con UUID/código ascendente dentro de cada nivel. Lo usan activación, downgrade, publicación/selección de configuración, preparación, numeración, enqueue, attempts, webhook/polling aplicado, reconciliation e incident resolution. Una operación puede omitir predecessors no consumidos, pero nunca adquirirlos tarde ni invertir niveles. La declaración se bloquea primero también en preparación/enqueue/publicación, de modo que `SUPPORTED -> UNSUPPORTED|UNVERIFIED` o retiro/bloqueo del adapter serializa contra operaciones nuevas. El downgrade cierra o degrada las `IntegrationCapability` efectivas en la misma transacción; un guard inverso impide commit si queda alguna efectiva.

`FiscalConnection FOR UPDATE` coordina create/publish/select de configuraciones COMPANY/BRANCH antes de consultar candidatos, por lo que la ausencia branch-specific no produce phantom. Downgrade y publicación usan el mismo prefijo: quien obtiene primero la declaración determina el resultado y el segundo revalida. Reconciliation histórica que solo aplica evidencia durable puede comenzar en el suffix documental; tráfico externo nuevo requiere el prefijo completo y una capability de consulta vigente.

El downgrade bloquea nuevas activaciones, publicaciones, documentos y dispatches, pero no borra ni reescribe documentos históricos, identificadores legales, attempts, artifacts o evidencia. Connection queda proyectada `REVALIDATION_REQUIRED`, sin columna/lifecycle duplicado. Reconciliation histórica sigue legible; nueva interacción externa requiere una capability de consulta vigente explícita o evidencia manual/autoridad. `DEBIT_NOTE` exige `DEBIT_NOTES`; la capability genérica `ELECTRONIC_INVOICING` no basta y no se presume soporte por provider.

`support_status` admite `SUPPORTED`, `UNSUPPORTED`, `UNVERIFIED`, `DISABLED`. `SUPPORTED` exige fuente oficial para diseño; activar productivamente exige además adapter implementado, configuración válida y evidencia aplicable. La `capability_scope_key` exacta es `(tenant_id, company_id, integration_id, capability_code)` y la business version es `UNIQUE (tenant_id, company_id, integration_id, capability_code, configuration_version)`. `effective_from/effective_until` usa intervalo semiabierto `[effective_from,effective_until)`; NULL superior significa open-ended y el CHECK exige `effective_until IS NULL OR effective_from < effective_until`.

PostgreSQL debe materializar el constraint NOT DEFERRABLE `integration_capabilities_effective_validity_excl` mediante `btree_gist`, con firma conceptual exacta `EXCLUDE USING gist (tenant_id WITH =, company_id WITH =, integration_id WITH =, capability_code WITH =, tstzrange(effective_from,effective_until,'[)') WITH &&)`. La exclusión aplica a todas las filas, no solo `SUPPORTED`, porque `support_status` es el resultado configurado dentro de la vigencia y no un lifecycle alternativo. Así existe como máximo una configuración efectiva por integration+capability en cualquier instante, incluidos intervalos cerrados, abiertos o programados. El índice GiST del constraint es implícito; un B-tree separado solo se justifica para FK y resolución ordenada por status/fecha. FK tenant-aware a ExternalIntegration y ownership policy. Retirar una capability cierra vigencia; no reescribe snapshots ni historia.

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

La `policy_scope_key` exacta es `(tenant_id, company_id, integration_id, resource_type, operation_scope)`; capability, provider y una dirección adicional no forman parte de esta identidad. `effective_from/effective_until` son las columnas de vigencia aprobadas y equivalen conceptualmente a `valid_from/valid_until`: intervalo semiabierto `[effective_from,effective_until)`, extremo superior NULL open-ended y CHECK `effective_until IS NULL OR effective_from < effective_until`. La business version es `UNIQUE (tenant_id, company_id, integration_id, resource_type, operation_scope, policy_version)`.

Para filas `PUBLISHED`, PostgreSQL debe materializar el constraint NOT DEFERRABLE `resource_ownership_policies_published_validity_excl` mediante `btree_gist`, con firma conceptual exacta `EXCLUDE USING gist (tenant_id WITH =, company_id WITH =, integration_id WITH =, resource_type WITH =, operation_scope WITH =, tstzrange(effective_from,effective_until,'[)') WITH &&) WHERE (status='PUBLISHED')`. La exclusión impide dos policies publicadas simultáneamente efectivas, incluidas combinaciones cerrado/cerrado, abierto/cerrado y programadas; intervalos adyacentes sí son válidos por la semántica `[)`. El índice GiST del constraint es implícito. El B-tree de lookup por integration/resource/status/fecha responde a FK y resolución de autoridad y no duplica la garantía temporal.

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

`integrations.integration_discovery_items` conserva por run el `resource_type`, external ID/code sanitizados, display reference allowlisted, provider checksum, proposed internal reference nullable, review status y metadata limitada. No almacena credenciales ni payload bruto. `UNIQUE (tenant_id, discovery_run_id, resource_type, external_id)`. `provider_metadata` es objeto máximo 32 KiB/profundidad 5/array 100/string 4 KiB, validado por el schema versionado del adapter+discovery/resource; unknown/secret-like keys y raw provider responses se rechazan.

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
| `supersedes_mapping_id` | referencia opcional a un mapping retirado del mismo tenant, company, integration y resource type |
| `provider_metadata` | `jsonb` allowlisted, schema-versioned, sanitizado y sin secretos |
| `created_at`, `updated_at`, `version` | historia y optimistic concurrency |

Constraints:

- `UNIQUE (tenant_id, integration_id, resource_type, internal_entity_type, internal_entity_id)` para un mapping vigente por recurso interno;
- `UNIQUE (tenant_id, integration_id, resource_type, external_id)` para impedir que una identidad externa apunte a dos internos;
- `external_code` no reemplaza `external_id`; su unicidad solo se activa por adapter/resource cuando el contrato oficial lo garantiza;
- misma identidad con asociación distinta pasa a `CONFLICT`, no sobrescribe;
- la candidate key `(tenant_id, company_id, integration_id, resource_type, id)` y la self-FK que incluye esas mismas columnas impiden reemplazos cross-tenant, cross-company, cross-integration o cross-resource-type;
- cross-tenant/company se rechaza antes de persistir y por FK/constraint cuando exista FK fuerte;
- índices por interno, externo, status y mappings pendientes/stale;
- ExternalIntegration, recursos canónicos e historia fiscal usan `RESTRICT/NO ACTION`; retirar un mapping no elimina evidencia ni entidades canónicas.

`provider_metadata` de mapping es objeto auxiliar máximo 16 KiB/profundidad 4/array 32/string 2 KiB. El schema pertenece al mapping contract por adapter+resource+schema version; claves desconocidas/secret-like se rechazan y el payload discovery/raw no se copia. No recibe GIN/JSON index.

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

- `FISCAL` es obligatorio para `ELECTRONIC_INVOICING`, `CREDIT_NOTES`, `DEBIT_NOTES`, `SUPPORT_DOCUMENTS` y cualquier operación cuyo lifecycle legal/fiscal pertenezca a `ElectronicDocument`/`FiscalConnection`; exige `internal_entity_type = 'ElectronicDocument'` y su attempt owner es exclusivamente `FiscalSubmissionAttempt`;
- `NON_FISCAL` cubre sincronización de customers, products, inventory, accounting, reporting y otros recursos no fiscales realmente habilitados; su attempt owner es `IntegrationDispatchAttempt`;
- el `CHECK` final owned por 003 exige `dispatch_class = 'FISCAL'` cuando `capability_code IN ('ELECTRONIC_INVOICING','CREDIT_NOTES','DEBIT_NOTES','SUPPORT_DOCUMENTS')` o `internal_entity_type = 'ElectronicDocument'`, y prohíbe esas combinaciones en `NON_FISCAL`; una capability fiscal futura requiere ampliar primero esta allowlist/constraint versionada;
- la clasificación también se valida server-side contra capability/resource allowlisted. Un adapter o request no puede elegirla ni reclasificar una operación fiscal como no fiscal;
- existen candidate keys `UNIQUE (tenant_id, id, dispatch_class)` y `UNIQUE (tenant_id, company_id, id, dispatch_class)` para FKs discriminadas según el scope materializado por cada tipo de attempt.

`IntegrationDispatch` fiscal referencia el `ElectronicDocument`, conserva intención, routing, idempotencia, correlación y estado agregado de orquestación. No conserva attempt number, request/response HTTP, `Retry-After`, provider operation ID ni resultado técnico autoritativo por intento. Su estado avanza desde el resultado del owner fiscal sin copiar su historial.

`IntegrationDispatchAttempt` está limitado físicamente a dispatches `NON_FISCAL`. Conserva attempt number, request ID, transport/http status, provider operation/reference, retry-after, tiempos y diagnostic reference sanitizada para esas operaciones. Su FK incluye `(tenant_id, company_id, integration_dispatch_id, dispatch_class)` y su propia constraint fija `dispatch_class = 'NON_FISCAL'`; por tanto, no puede referenciar un dispatch fiscal. `UNIQUE (tenant_id, integration_dispatch_id, attempt_number)`. Timeout ambiguo produce `UNKNOWN_OUTCOME`; antes de reintentar un POST con efecto se consulta/reconcilia cuando el API lo permita.

Para un dispatch `FISCAL`, `FiscalSubmissionAttempt.integration_dispatch_id` usa la FK complementaria con discriminador fijo `FISCAL`. Un mismo dispatch fiscal puede originar varios attempts numerados, pero ninguno puede materializarse como `IntegrationDispatchAttempt`. Para una misma interacción fiscal externa no pueden existir dos registros autoritativos independientes de attempt.

### Materialización progresiva 002/003

El contrato conceptual anterior no cambia, pero su materialización se divide dentro de Phase 1:

1. migration 002 crea exclusivamente External Integrations foundation. Su constraint temporal permite solo `dispatch_class = 'NON_FISCAL'`; por tanto, ninguna fila fiscal huérfana puede persistirse. Históricamente, sin embargo, ese constraint no clasifica `DEBIT_NOTES` como fiscal y puede permitir capability/dispatch `DEBIT_NOTES` dentro de `NON_FISCAL`. `IntegrationDispatchAttempt` mantiene además su discriminador permanente `NON_FISCAL`.
2. migration 003 mantiene primero el constraint 002 y ejecuta un preflight fail-closed basado únicamente en relaciones físicas exactas de 002: capabilities `DEBIT_NOTES`; dispatches `NON_FISCAL/DEBIT_NOTES`; attempts unidos por su FK al dispatch afectado; mappings con el mismo `(tenant_id,company_id,integration_id,resource_type,internal_entity_type,internal_entity_id)` del dispatch afectado; ownership referenciado por `IntegrationCapability.ownership_policy_id`; e integridad exacta del scope. `resource_type` aislado no enlaza mapping u ownership. `ProviderCapabilityDeclaration` y `provider_platform_configurations` son metadata global sin relación física hacia el uso histórico tenant/company y quedan fuera de la matriz bloqueante; ni `configuration_type` ni JSON se interpretan heurísticamente. Cualquier fila incompatible identificada por esa matriz bloquea antes de crear schema, tablas, guards, RLS, grants o constraints; no se convierte automáticamente en FISCAL ni se inventa owner fiscal, documento, numeración o evidencia. Solo el resultado zero-row permite continuar.
3. migration 003 crea el foundation fiscal, `FiscalSubmissionAttempt`, sus candidate keys y la FK discriminada fija `FISCAL`, y valida la estructura. Solo después reemplaza el constraint temporal por el final `FISCAL|NON_FISCAL`: habilitar `FISCAL` es el último cambio estructural de la transición.
4. migration 003 no puede habilitar `FISCAL` antes de que `FiscalSubmissionAttempt` exista y sea físicamente referenciable. Si owner, FK, preflight o constraint no pueden instalarse juntos, toda la migration falla; no existe ventana con dispatch fiscal sin owner.

Esta secuencia es `RECONCILIATION` de rollout, no cambio de ownership, replacement ni deprecación. Migration 002 no crea `FiscalConnection`, `ElectronicDocument`, `FiscalSubmissionAttempt`, `FiscalArtifact`, `FiscalIncident` o `FiscalReconciliation`.

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

### Dependencia compartida `btree_gist`

Las exclusiones temporales de plataforma, ownership, capabilities y rate limits dependen de `btree_gist`. Es infraestructura PostgreSQL compartida, no objeto destructivamente owned por migration 002. El runner la introspecta antes de mutar `integrations`; si falta, `pos_migrator` ejecuta `SET LOCAL ROLE pos_schema_owner` y este último puede instalarla solo con su CREATE de database y allowlist del servicio, sin escalar a superuser. Registra PREEXISTING o INSTALLED_BY_MIGRATION_PREREQUISITE; si la instala queda owned por `pos_schema_owner`, y si preexiste conserva owner. Ausencia sin privilegio/allowlist falla cerrado antes del body. Se validan operator classes requeridas para UUID/text/rangos. Down 002 nunca elimina la extensión y dump/restore debe preprovisionarla o restaurarla antes de verificar el catálogo.

`integrations.provider_rate_limit_policies` versiona límites externos:

```text
id uuid PK
provider_id uuid
scope_type text
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
published_at timestamptz NULL
version bigint
row_version bigint
```

`scope_type` es `PROVIDER|TENANT|COMPANY|INTEGRATION` y un CHECK obliga respectivamente a ninguna, una, dos o tres columnas scoped presentes; tenant nulo nunca es bypass. Toda fila contextual usa FK `tenant_id -> tenancy.tenants(id)`; COMPANY/INTEGRATION usa FK `(tenant_id,company_id)`; INTEGRATION usa la FK única `(tenant_id,company_id,integration_id,provider_id) -> external_integrations(tenant_id,company_id,id,provider_id)`, que impide combinar provider A con una integración de provider B. Las columnas nulas de scopes menores usan MATCH SIMPLE y el CHECK impide shapes parciales. Precedencia explícita: integration/account > company > tenant > provider default. Valores NULL significan `UNVERIFIED/PROVIDER_HEADER_DRIVEN` según `retry_after_mode`, no ilimitado. Headers efectivos como `Retry-After` y reset prevalecen para el evento; los límites no se hard-codean dispersos en negocio. Business `version` es única por scope+endpoint y `row_version` protege edición DRAFT. `valid_until NULL` es vigencia abierta y, cuando existe, `valid_from < valid_until`. Cuatro exclusion constraints PostgreSQL parciales, uno por scope, impiden overlap entre intervalos `PUBLISHED`; una publicación futura no es efectiva hasta `valid_from`. La tabla no guarda counters ni eventos runtime de alta frecuencia.

RLS `ENABLE/FORCE` separa policies globales y contextualizadas. `pos_app`/`pos_worker` solo leen las columnas mínimas de la configuración PUBLISHED global; nunca hacen DML global. `pos_app` puede administrar filas tenant/company/integration solo bajo `tenant_id = platform.current_tenant_id()` y grants de columna; `pos_worker` no hace DML. `pos_platform_app` administra global o contextual mediante policies separadas; `pos_platform_admin` es read-only allowlisted.

Los índices de FK son: Tenant parcial `WHERE tenant_id IS NOT NULL`, Company parcial `WHERE company_id IS NOT NULL` e Integration+Provider parcial `WHERE integration_id IS NOT NULL`; los predicados son inferibles por el lookup referencial y no dependen de filtrar `scope_type`. El lookup de precedencia empieza por provider. Todas las FKs usan NO ACTION.

## ProviderVerificationEvidence

`integrations.provider_verification_evidence` conserva metadata y referencia inmutable a evidencia protegida:

```text
id uuid PK
provider_id uuid
provider_adapter_version_id uuid
scope_type text
tenant_id uuid NULL
company_id uuid NULL
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
registered_by_actor_id uuid
reviewed_by_actor_id uuid NULL
reviewed_at timestamptz NULL
expires_at timestamptz NULL
created_at timestamptz
```

`scope_type` es `GLOBAL|INTEGRATION`: GLOBAL exige tenant/company/integration nulos e INTEGRATION exige los tres presentes. `evidence_level`: `DOCUMENTED`, `IMPLEMENTED`, `MOCK_TESTED`, `SANDBOX_VERIFIED`, `PRODUCTION_VERIFIED`, `CERTIFIED`. `result`: `PASS`, `FAIL`, `BLOCKED`. Credenciales y payloads reales están prohibidos. La promoción requiere evaluación de autenticación, discovery, operación autorizada, parsing, status reconciliation, duplicate/idempotency, timeout ambiguo, rotación, leakage, cross-tenant, rate limiting, dead letter, audit sanitization y artefactos fiscales aplicables.

RLS `ENABLE/FORCE`, grants de columna y permisos backend separan `REGISTER`, `REVIEW`, `APPROVE/PROMOTE` y `READ MINIMAL STATUS`. Runtime no registra, revisa ni promueve; `pos_worker` no accede a la tabla y `pos_app` solo puede leer estado mínimo INTEGRATION de su tenant. `pos_platform_app` usa policies global/contextual separadas. Para niveles con revisión independiente, `registered_by_actor_id` debe ser distinto del reviewer y del actor de promoción de su propia evidencia; `pos_platform_admin` es read-only y no ve account/evidence reference/checksum. Nada de esto cambia `SEC-G`, que permanece `PLANNED / NOT_EVALUATED`.

El manifest 002 contiene la matriz normativa exacta TABLE×ROLE×OPERATION×COLUMN SET de las 16 tablas. Todo repositorio usa listas explícitas; runtime no recibe DELETE/TRUNCATE/ownership. `pos_platform_app` conserva un solo rol físico, pero REGISTER, REVIEW y PROMOTE usan commands/repositories y permisos de aplicación distintos, actor/reviewer/promoter explícitos, prohibición de self-review/self-promotion y ausencia de generic update repository. Guards old/new protegen identidad, scopes, routing, idempotencia, checksum y hechos append-only; CHECK y RLS no se presentan como sustitutos de esos guards.

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

El contrato obtiene `PASS` documental si la revisión transversal confirma identidad, scope, FKs, uniques, delete policy, índices, lifecycle, ownership, secrets, dispatch, webhook, rate limits, evidencia, reconciliación fiscal y compatibilidad con migration 001. Este PASS no implementa ni verifica ningún provider. Habilita diseñar migration 002 para External Integrations foundation con dispatch exclusivamente `NON_FISCAL`; el foundation fiscal y la habilitación `FISCAL` pertenecen a migration 003.

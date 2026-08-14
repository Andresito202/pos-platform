# PHY-G10: versiones de configuración por dominio

## Estado y alcance

Contrato documental de `PHY-G10` para cerrar la persistencia conceptual de configuraciones versionadas por dominio.

Este documento no contiene DDL ni autoriza migraciones. Al cerrar este gate, `TECH-002` permanecía `IN_PROGRESS` y la primera migración permanecía `NO-GO`; su evolución posterior se registra en `traceability.md` y `../../product/backlog.md`.

Queda prohibido crear un agregado, tabla, servicio o clave-valor global llamado `Configuration`. Cada dominio conserva la identidad, versiones, reglas y autoridad de sus propias configuraciones. Si una implementación necesita metadatos técnicos de transporte, se denomina `ConfigurationDistribution`, pertenece a infraestructura y no se convierte en fuente de verdad de negocio.

## Autoridad y ownership

| Configuración | Propietario | Identidad o artefacto nativo | Consumidores principales |
|---|---|---|---|
| precios, promociones, descuentos y resolución comercial | Pricing | `PricingPolicy`/`PricingPolicyVersion`, `PriceList`, `ProductPrice`, `Promotion`/`PromotionVersion` | Sales, Reporting, Sync |
| reglas tributarias, clasificación, tasas, vigencia y cálculo | Tax | `TaxRule`/`TaxRuleVersion` | Pricing, Sales, Electronic Invoicing |
| redondeo comercial | Pricing | `RoundingPolicy`/`RoundingPolicyVersion` | Sales, Payments, Cash Register |
| reglas ABAC | Authorization | `AuthorizationPolicyVersion` y grants versionados existentes | todos los módulos autorizables |
| proveedor y capacidades de pago | Payments | `PaymentProviderConfiguration`/`PaymentProviderConfigurationVersion` | Payments, Sync |
| emisión fiscal | Electronic Invoicing | `FiscalEmissionConfiguration`/`FiscalEmissionConfigurationVersion` | Electronic Invoicing, Sync |
| conteo, tolerancia, clasificación de diferencias, aprobación y restricciones offline de caja | Cash Register | `CashPolicy`/`CashPolicyVersion` | Cash Register, Sync |
| FIFO/FEFO, vencimiento, stock negativo, reservas, restricciones offline y ajustes normativamente explícitos | Inventory | `InventoryPolicy`/`InventoryPolicyVersion` | Inventory, Sync |
| derechos, límites, vigencia y gracia | Licensing | `License`, `FeatureEntitlement`, `GraceAuthorization`, `LicenseRevocation` y artefactos firmados existentes | Authorization, Devices, Sync |
| activación, reemplazo, salud, confianza y administración del dispositivo | Devices | `Device`, `Installation`, `DeviceKey`, `DeviceManagementProfile`, solicitudes/respuestas de activación y políticas nativas existentes | Authorization, Licensing, Sync |

`Sync` distribuye referencias, versiones y snapshots verificables. No publica, amplía, corrige ni posee configuraciones de negocio.

## Contrato común de identidad y versión

Cuando un dominio necesita una configuración administrable, su modelo distingue:

1. una identidad estable de política o configuración, con `id`, `tenant_id` cuando aplique, propietario y alcance nativo; y
2. una versión inmutable publicada, con identidad global propia, número de versión monotónico dentro de la identidad estable, esquema de payload, vigencia, checksum, actor, motivo y relación de sustitución.

Los artefactos nativos ya aprobados que no siguen el par estable/versión no se duplican. En particular, Licensing, Devices y `AuthorizationPolicyVersion` conservan su modelo actual.

Toda identidad y versión multi-tenant lleva `tenant_id` o queda enlazada de manera no ambigua a un agregado que lo lleva. `company_id`, `branch_id`, `device_id`, `installation_id` y demás alcances nunca sustituyen la frontera de tenant. Una referencia entre configuración, versión, consumidor o snapshot debe pertenecer al mismo tenant.

## Ciclo de vida

Los estados persistentes comunes de una versión administrable son:

- `DRAFT`: todavía mutable bajo control de concurrencia, no consumible por operación;
- `PUBLISHED`: inmutable y elegible de acuerdo con vigencia y alcance;
- `SUPERSEDED`: reemplazada por una versión posterior, conservada para historia y replay;
- `REVOKED`: retirada explícitamente por una causa auditable y no elegible para nuevas operaciones.

`SCHEDULED`, `CURRENT` y `EXPIRED` son proyecciones temporales, no estados paralelos: se derivan de `PUBLISHED`, `valid_from`, `valid_until` y la evidencia temporal confiable. Los estados locales `CURRENT`, `STALE`, `EXPIRED`, `INCOMPATIBLE`, `REVOKED`, `MISSING` e `INVALID` definidos por `UC-SYNC-002` describen disponibilidad/evaluación de una réplica y no modifican el estado central.

Una versión publicada nunca se edita ni se reactiva. Corregir o restaurar comportamiento exige publicar otra versión, incluso si reutiliza un contenido semántico anterior. Por ello no existe un “rollback” que reescriba historia: la operación autorizable es `supersede` mediante nueva publicación.

## Vigencia, solapamientos y huecos

La vigencia usa el intervalo semiabierto `[valid_from, valid_until)`, con `valid_until` opcional. Se permite publicar una versión futura; será una proyección `SCHEDULED` hasta `valid_from`.

Dos versiones mutuamente excluyentes no pueden ser simultáneamente elegibles para la misma identidad, scope, prioridad y criterios. Si el dominio admite reglas combinables, la política versionada debe declarar composición y desempate deterministas.

Un hueco no activa una versión vencida, revocada ni un default implícito. El dominio debe producir una decisión explícita: denegar la acción, degradarla de forma segura o exigir revisión, según su caso de uso. La ausencia de una política offline requerida impide la operación offline correspondiente.

## Scopes y precedencia

No existe una precedencia universal `branch > company > tenant > platform`.

Cada versión declara explícitamente:

- scope permitido por su dominio;
- prioridad, si el dominio la reconoce;
- vigencia;
- versión de la política de resolución;
- criterios de elegibilidad y combinación;
- regla de desempate, cuando exista.

Pricing resuelve cada regla por esos datos. La lista orientativa de `UC-PRICE-002` no es autoridad automática de precedencia. Dos reglas elegibles con igual prioridad y sin desempate normativo producen `AMBIGUOUS_CONFIGURATION`; los timestamps, el orden de inserción y last-write-wins están prohibidos como desempate.

Los scopes autorizados son nativos: Pricing, Tax y redondeo parten de `tenant_id` y `company_id` y solo usan dimensiones comerciales ya reconocidas; Cash e Inventory parten de `tenant_id` y `company_id`, con `branch_id` opcional cuando la política se limite a una sucursal; Payments y Electronic Invoicing usan los alcances de cuenta, compañía, sucursal, ambiente o identidad fiscal ya definidos por sus contratos. Ningún dominio infiere alcance desde datos controlados por el cliente.

## Checksum canónico

El checksum se calcula sobre una serialización canónica, estable e independiente del motor, que incluye:

- dominio y tipo de configuración;
- identidad estable, identidad y número de versión;
- versión del esquema;
- tenant y scopes materiales;
- vigencia, prioridad, elegibilidad y composición;
- referencia a la versión sustituida;
- payload material ordenado de forma determinista;
- referencias opacas a secretos cuando formen parte de la selección, nunca el secreto.

Se excluyen timestamps de auditoría, nombres de presentación del actor, datos de transporte y valores secretos. Importes y tasas usan su representación decimal canónica; mapas y conjuntos se ordenan por claves normativas antes de serializar.

El checksum detecta cambio o corrupción, pero no prueba origen. La distribución a POS debe acompañarse de la firma o evidencia de autenticidad establecida en `DEC-008`; el cliente no puede recomputar una firma válida ni alterar derechos.

## Snapshot, historia y replay

Cada operación conserva evidencia suficiente para reproducir la decisión original sin consultar “la configuración actual”:

- referencia a identidad y versión aplicada;
- checksum y versión de esquema;
- scopes y entradas materiales;
- resultado calculado o decisión y `reason_code`;
- snapshot inmutable completo cuando el dato externo, fiscal, monetario o contractual sea necesario para auditoría.

Una venta conserva snapshots de pricing, promoción, impuesto y redondeo. `CashCount` conserva versiones/checksums de cálculo y tolerancia. Operaciones de inventario conservan la política aplicada y el resultado de selección o restricción. Payments conserva configuración de proveedor y evidencia externa. Los documentos electrónicos conservan por separado el snapshot tributario de la operación y el snapshot de emisión fiscal; está prohibido un `fiscal_snapshot` ambiguo.

Las nuevas versiones no reescriben operaciones históricas. Reporting y replay resuelven por la versión registrada, no por la vigente hoy.

## Disponibilidad y operación local-first

| Dominio | Autoridad central | Copia local | Conducta sin versión válida |
|---|---|---|---|
| Pricing/Tax/redondeo | obligatorio para publicar | snapshot firmado requerido para vender offline | impedir cálculo nuevo; no improvisar precio, impuesto ni redondeo |
| Authorization | backend central; credencial offline acotada | versión/evidencia firmada y vigente | deny por defecto |
| Payments proveedor | central/proveedor según dato | solo capacidades offline explícitas | no asumir autorización del proveedor |
| Electronic Invoicing | central y proveedor/DIAN según etapa | configuración y contingencia autorizadas | aplicar contingencia explícita o impedir emisión |
| Cash Register | dominio central | política vigente requerida para la acción offline | impedir la acción específica, sin perder registros ya capturados |
| Inventory | dominio central | política vigente requerida para mutaciones offline | impedir la mutación específica; no inventar stock |
| Licensing/Devices | autoridad contractual y artefactos firmados | evidencia firmada según `DEC-008` | decisión restrictiva; una activación nunca amplía derechos |

La recepción local es atómica: una versión se valida por tenant, firma, checksum, esquema, vigencia, secuencia y dependencias antes de reemplazar el snapshot utilizable. Una recepción parcial no cambia la versión efectiva. Revocaciones conocidas prevalecen incluso offline.

## Secretos y datos sensibles

Configuraciones de proveedor, emisión fiscal y dispositivos solo conservan identificadores opacos, versión de referencia y metadatos no sensibles. API keys, tokens, claves privadas, certificados utilizables y credenciales residen en el gestor definido por `SEC-004` o en el almacén seguro local aprobado.

Una lectura de configuración no revela secretos. Crear, publicar, revocar, sustituir o cambiar una referencia sensible exige autorización backend, reautenticación/MFA y segregación de funciones cuando la matriz lo indique, además de auditoría append-only.

## Autorización atómica

Cada dominio debe poder distinguir las acciones `read`, `create_draft`, `publish`, `schedule`, `revoke` y `supersede`. No se crea un rol nuevo ni un permiso universal `configuration.manage`.

Los permisos efectivos son específicos del dominio y se combinan con tenant membership, scope de Company/Branch, ABAC, estado de licencia, confianza del dispositivo y controles críticos. Tener permiso de lectura o edición de draft no autoriza publicar. Restaurar una conducta anterior usa `supersede`; no existe permiso para mutar una versión histórica.

## Auditoría y eventos

Toda creación de draft, publicación, programación, revocación, sustitución, rechazo por conflicto y cambio de referencia sensible registra actor, tenant, scope, versión anterior/nueva, motivo, correlación, timestamp confiable y checksum en auditoría append-only.

Los eventos son propiedad del dominio que cambió la configuración. No existe `ConfigurationChanged` global. Se reutilizan los eventos canónicos ya existentes de Pricing, Tax, Licensing y Devices; Cash Register, Inventory, Payments, Electronic Invoicing, redondeo y Authorization emiten eventos específicos solo para sus propias versiones. `ConfigurationDistribution` puede registrar entrega/aplicación técnica, pero no convertirla en publicación de negocio.

## Inventario físico conceptual

Este gate autoriza diseñar posteriormente, no crear ahora, los siguientes pares cuando el esquema físico reciba autorización independiente:

- `pricing_policies` / `pricing_policy_versions`;
- `rounding_policies` / `rounding_policy_versions`;
- `tax_rules` / `tax_rule_versions`;
- `payment_provider_configurations` / `payment_provider_configuration_versions`;
- `fiscal_emission_configurations` / `fiscal_emission_configuration_versions`;
- `cash_policies` / `cash_policy_versions`;
- `inventory_policies` / `inventory_policy_versions`.

`AuthorizationPolicyVersion`, grants, licencias, entitlements, gracia, revocaciones, dispositivos, instalaciones, claves y activaciones reutilizan los agregados ya aprobados. No se autoriza una tabla global de distribución ni una tabla global de payload JSON.

## Restricciones e índices candidatos

El diseño físico posterior deberá demostrar, en ambos dialectos:

1. unicidad tenant-aware de identidad estable y número de versión;
2. referencias compuestas o validación transaccional que impidan cross-tenant;
3. una sola relación lineal de sustitución dentro de la misma identidad;
4. inmutabilidad de versiones publicadas;
5. ausencia de solapamientos incompatibles y detección de ambigüedad;
6. búsqueda por tenant, scope, estado, vigencia y versión sin índices globales que filtren datos;
7. idempotencia de publicación y distribución;
8. checksum verificable con la misma serialización en PostgreSQL y SQLite;
9. no almacenar payloads libres cuando existen campos y reglas normativas;
10. no cascadas destructivas sobre versiones o snapshots históricos.

## Migración del legado avícola

La base heredada no contiene historia confiable de versiones de configuración. Sus valores simples pueden clasificarse como candidatos a un draft inicial, pero no se les inventarán autor, vigencia histórica, checksum previo, publicación ni decisiones pasadas.

Cada candidato exige tenant/company explícitos, revisión humana y publicación posterior con versión nueva. Credenciales encontradas se rotan y migran al gestor de secretos; no se copian a tablas de negocio. Valores ausentes, ambiguos o incompatibles van a cuarentena.

## Pruebas obligatorias para una implementación posterior

- aislamiento tenant y scopes Company/Branch;
- publicación idempotente e inmutabilidad posterior;
- versión futura, expiración, revocación, sustitución, hueco y solapamiento;
- rechazo de igual prioridad sin desempate;
- checksum canónico igual entre motores y rechazo de alteración;
- firma/autenticidad, replay y secuencia local;
- actualización local atómica y conservación de la última versión válida;
- conducta offline por dominio y revocación conocida;
- permisos atómicos, MFA/reautenticación y segregación;
- ausencia de secretos en respuestas, logs, auditoría y snapshots;
- reproducción histórica con la versión registrada;
- legado ambiguo en cuarentena, sin inventar historia.

## Prohibiciones explícitas

- `Configuration` global, key-value autoritativo o JSON libre como modelo de dominio;
- ownership de configuración por Sync;
- timestamps, orden de llegada o last-write-wins como resolución genérica;
- mutar, borrar o reactivar una versión publicada;
- defaults implícitos durante huecos;
- herencia automática de scope no declarada por la política;
- copiar secretos al snapshot o checksum;
- usar una configuración de otro tenant;
- reescribir hechos históricos después de publicar una versión nueva;
- interpretar la copia local como autoridad para ampliar permisos, licencia o capabilities.

## Criterio de cierre de PHY-G10

`PHY-G10` puede cerrarse documentalmente cuando ownership, identidad, lifecycle, scopes, vigencias, precedencia, checksums, snapshots, offline, secretos, autorización, auditoría, eventos, replay y migración legado estén alineados transversalmente, sin contradicciones materiales y sin crear DDL o código.

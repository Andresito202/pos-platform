# Matriz de integraciones con proveedores

## Estado y reglas de evidencia

Matriz documental verificada contra fuentes oficiales consultadas el 2026-08-17. No constituye implementación, certificación, partnership ni autorización productiva.

`DOCUMENTED != IMPLEMENTED`, `IMPLEMENTED != VERIFIED`, `VERIFIED != CERTIFIED` y `MOCK != integración real`. Todo comportamiento no demostrado por la fuente oficial revisada se marca `UNVERIFIED`.

Estados de implementación: `DESIGNED`, `IMPLEMENTED`. Estados de verificación: `NOT_EVALUATED`, `MOCK_TESTED`, `SANDBOX_VERIFIED`, `PRODUCTION_VERIFIED`, `CERTIFIED`.

## Resumen

| Provider | Implementation status | Verification status | Propósito principal | Capabilities verificadas oficialmente |
|---|---|---|---|---|
| SIIGO | `DESIGNED` | `NOT_EVALUATED` | ERP/contabilidad + ciclo comercial + facturación electrónica | `ACCOUNTING`, `CUSTOMERS`, `PRODUCTS`, `PURCHASES`, `PAYMENTS`, `CREDIT_NOTES`, `SUPPORT_DOCUMENTS`, `REPORTING`, `ELECTRONIC_INVOICING` |
| FACTUS | `DESIGNED` | `NOT_EVALUATED` | documentos electrónicos Colombia | `ELECTRONIC_INVOICING`, `CREDIT_NOTES`, `SUPPORT_DOCUMENTS`, reference tables, recepción y artefactos fiscales; `WEBHOOKS` queda `UNVERIFIED` |
| ALEGRA | `DESIGNED` | `NOT_EVALUATED` | ERP/contabilidad, ventas, contactos, items e inventario | `ACCOUNTING`, `CUSTOMERS`, `PRODUCTS`, `INVENTORY`, `PURCHASES`, `PAYMENTS`, `CREDIT_NOTES`, `WEBHOOKS`, facturas y estado fiscal colombiano |
| THE_FACTORY_HKA | `FUTURE / NOT_IMPLEMENTED` | `NOT_EVALUATED` | proveedor tecnológico de documentos electrónicos | Hub oficial anuncia facturación, recepción, salud/RIPS y nómina; detalle contractual `UNVERIFIED` para este corte |
| ODOO | `FUTURE / NOT_IMPLEMENTED` | `NOT_EVALUATED` | ERP extensible | External API oficial y API keys verificadas; capabilities concretas por instalación/módulos `UNVERIFIED` |

Ninguna fila significa adapter creado. HKA y Odoo son `FUTURE / NOT_IMPLEMENTED`.

## SIIGO

| Dimensión | Contrato verificado / decisión |
|---|---|
| Authentication model | `POST https://api.siigo.com/auth` con `username` y `access_key`; respuesta Bearer/JWT con `access_token`, `token_type` y `expires_in` |
| Customer-supplied credentials | API `username`, `access_key`, obtenidos en Siigo Nube → Alianzas → Mi Credencial API; no contraseña normal |
| Platform-supplied configuration | Header `Partner-Id`, nombre de nuestra aplicación/empresa integradora; el mismo valor se usa para las empresas integradas según contrato oficial. No es secreto por cliente |
| Token lifecycle | access token short-lived central; usar `expires_in` efectivo, renovar autenticando conforme al contrato; no persistir token como credencial inmutable |
| Environment model | producción `https://api.siigo.com`; ambiente sandbox general `UNVERIFIED`; la documentación indica que credenciales de prueba se solicitan a Siigo |
| Known base URL/endpoints | auth anterior; recursos bajo Siigo API v1, incluidos `/products`, `/customers`, `/invoices`, `/purchases`, `/credit-notes`, `/vouchers`, `/payment-receipts`, `/journals`, `/quotations`, `/purchase-support-documents` y endpoints de reportes |
| Discovery requirements | identidad de cuenta; tipos documentales; clientes; productos; impuestos; bodegas; usuarios/vendedores; formas/configuración de pago; catálogos requeridos por cada operación |
| Mapping requirements | todos los IDs/códigos externos viven en `ExternalReferenceMapping`; nunca en Product, Customer, Sale, Tax, Payment o Warehouse |
| Webhook status | `UNVERIFIED` en las fuentes oficiales revisadas |
| Rate-limit status | límites numéricos y headers `UNVERIFIED` en las fuentes oficiales revisadas; policy provider/account-scoped y header-driven hasta verificación |
| Idempotency approach | mecanismo nativo genérico `UNVERIFIED`; usar identidad POS, checksum, deduplicación interna y reconciliación por referencias consultables antes de retry ambiguo |
| Fiscal capabilities | facturas electrónicas y notas crédito verificadas; demás documentos solo si endpoint/contrato oficial y cuenta los habilitan |
| Evidence required for PASS | credenciales emitidas, auth real, discovery, operación autorizada, parsing, conciliación, duplicado, timeout ambiguo, rotación, leakage, cross-tenant, rate limit, dead letter, audit y artefactos/status aplicables |
| Official source/reference | [Introducción Siigo API](https://developers.siigo.com/docs/siigoapi/), [Autenticación](https://developers.siigo.com/docs/siigoapi/autenticacion/autenticacion), [Partner-Id](https://developers.siigo.com/docs/siigoapi/partner-id/), [Facturación electrónica](https://developers.siigo.com/docs/siigoapi/facturacion-electronica/) |
| Unverified items | sandbox self-service, webhook, firma de webhook, límites exactos, `Retry-After`, idempotency header general y certificación/partnership |

## FACTUS

| Dimensión | Contrato verificado / decisión |
|---|---|
| Authentication model | OAuth2 password grant: `grant_type=password`, `client_id`, `client_secret`, `username`, `password` |
| Customer-supplied credentials | los cuatro valores anteriores; custodia central mediante una única referencia opaca/versionada |
| Platform-supplied configuration | ninguna configuración global equivalente a Siigo `Partner-Id` verificada |
| Token lifecycle | respuesta incluye `access_token`, `refresh_token`, `expires_in`, `token_type`; refresh usa `grant_type=refresh_token`, client credentials y refresh token. Siempre obedecer `expires_in` retornado; no hard-codear ejemplos |
| Environment model | sandbox `https://api-sandbox.factus.com.co`; producción `https://api.factus.com.co` |
| Known base URL/endpoints | `/oauth/token`; V2 `/v2/bills/validate`; `/v2/numbering-ranges/dian`; endpoints oficiales para facturas, notas crédito/débito, documentos soporte/ajustes, PDF, XML, AttachedDocument, eventos, correo/representación, empresas, adquirientes, recepción y reference tables |
| Discovery requirements | empresa, rangos asociados al software, adquirientes y tablas de referencia aplicables |
| Mapping requirements | `numbering_range_id`, reference tables y provider IDs mediante mappings; `reference_code` usa una referencia POS inmutable/idempotente, no reemplaza IDs internos |
| Webhook status | `UNVERIFIED`; “suscripciones” en el índice oficial no demuestra por sí solo recepción webhook compatible con este contrato |
| Rate-limit status | fuente oficial actual: 80 requests/minuto por usuario, HTTP 429, `X-RateLimit-*` y `Retry-After`; se persiste como policy versionada, no constante de dominio |
| Idempotency approach | `reference_code` repetido devuelve la factura procesada según endpoint oficial; se combina con deduplicación/checksum internos. Timeout ambiguo requiere consulta/reconciliación antes de reenviar |
| Fiscal capabilities | facturas, notas crédito, notas débito, documentos soporte y ajustes, PDF/XML/AttachedDocument según tipo, eventos, recepción y legal status |
| Evidence required for PASS | suite real autorizada sandbox: auth/refresh/expiry, company/range/reference discovery, submit, artifacts/status, duplicate `reference_code`, timeout, rotation, leakage, isolation, 429/Retry-After, dead letter y audit |
| Official source/reference | [Factus API V2](https://developers.factus.com.co/), [Autenticación](https://developers.factus.com.co/autenticacion/auth), [Refresh token](https://developers.factus.com.co/autenticacion/refresh-token/), [Crear y validar](https://developers.factus.com.co/facturas/crear-y-validar/), [Rate limiting](https://developers.factus.com.co/limite-de-request), [Rangos asociados](https://developers.factus.com.co/rangos-de-numeracion/facturaci%C3%B3n/rangos-asociados-al-software/) |
| Unverified items | autenticidad de callbacks/webhooks, idempotency header distinto de `reference_code`, certificación y alcance exacto contratado por cliente |

## ALEGRA

| Dimensión | Contrato verificado / decisión |
|---|---|
| Authentication model | HTTP Basic, `Authorization: Basic base64(email:api_token)` |
| Customer-supplied credentials | API email y API token obtenidos en Configuración → API - Integraciones con otros sistemas; nunca contraseña normal de cuenta |
| Platform-supplied configuration | ninguna configuración global equivalente a `Partner-Id` verificada |
| Token lifecycle | API token long-lived hasta rotación/revocación; access/refresh tokens separados no aplican según fuente revisada |
| Environment model | base oficial `https://api.alegra.com/api/v1`; sandbox separado `UNVERIFIED`; el API explorer puede modificar la cuenta real |
| Known base URL/endpoints | `https://api.alegra.com/api/v1`; company, invoices, payments embebidos/recursos de pago, credit notes, contacts/clients, items, inventory adjustments, warehouses y warehouse transfers, bills, accounts, cost centers, journals, bank accounts y webhooks subscriptions según endpoints oficiales |
| Discovery requirements | company, numbering/templates, taxes, payment methods/accounts, warehouses, sellers, contacts, items, accounting accounts y cost centers según capabilities activadas |
| Mapping requirements | IDs de invoice/contact/item/tax/warehouse/account/cost center y demás referencias mediante `ExternalReferenceMapping` |
| Webhook status | `SUPPORTED` para suscripciones oficiales y entrega POST por HTTPS. Firma/auth del callback, event ID universal, timestamp/nonce y anti-replay nativo quedan `UNVERIFIED`; se aplica deduplicación propia |
| Rate-limit status | fuente oficial actual: 150 requests/minuto por usuario, HTTP 429 y headers `X-Rate-Limit-Limit`, `Remaining`, `Reset`; `Retry-After` `UNVERIFIED` |
| Idempotency approach | mecanismo nativo general `UNVERIFIED`; identidad/checksum POS, búsqueda/consulta y revisión antes de retry ambiguo |
| Fiscal capabilities | facturas Colombia exponen estados legales/emisión, PDF/XML/events; documentos soporte aparecen en bills. Estado comercial de Alegra y estado DIAN/legal se guardan por separado |
| Evidence required for PASS | cuenta autorizada, auth real, company/catalog discovery, operación permitida, fiscal/application status, artifacts, duplicate/timeout, webhook real si se activa, rotation, leakage, isolation, 429, dead letter y audit |
| Official source/reference | [Información general](https://developer.alegra.com/docs/informaci%C3%B3n-general), [Autenticación](https://developer.alegra.com/reference/autenticaci%C3%B3n), [Empresa](https://developer.alegra.com/reference/get_company-1), [Factura](https://developer.alegra.com/reference/get_invoices-id), [Notas crédito](https://developer.alegra.com/reference/get_credit-notes), [Contactos](https://developer.alegra.com/reference/post_contacts), [Traslados de bodega](https://developer.alegra.com/reference/get_warehouse-transfers), [Webhooks](https://developer.alegra.com/reference/descripci%C3%B3n-general), [Rate limiting](https://developer.alegra.com/reference/l%C3%ADmite-de-request), [Colombia](https://developer.alegra.com/reference/colombia) |
| Unverified items | sandbox dedicado, firma/autenticidad de callback, timestamp/nonce, idempotency key/header nativo, `Retry-After`, SLA y certificación/partnership |

## THE_FACTORY_HKA

| Dimensión | Decisión |
|---|---|
| Status | `FUTURE / NOT_IMPLEMENTED`; verification `NOT_EVALUATED` |
| Purpose/capabilities | hub oficial anuncia integración de documentos electrónicos, recepción, salud/RIPS y nómina; no se habilita ninguna capability por esta mención |
| Authentication/credentials/token/environment/endpoints | `UNVERIFIED` para este corte; no se crean credenciales ni adapter ficticios |
| Webhook/rate limit/idempotency | `UNVERIFIED` |
| Mapping | usaría los contratos generales sin nuevas columnas de dominio |
| Evidence required for PASS | contrato oficial vigente, credenciales autorizadas, ambiente permitido y toda la suite de aceptación aplicable |
| Official source/reference | [Hub oficial de APIs TFHKA Colombia](https://developers.thefactoryhka.com.co/) |

## ODOO

| Dimensión | Decisión |
|---|---|
| Status | `FUTURE / NOT_IMPLEMENTED`; verification `NOT_EVALUATED` |
| Purpose/capabilities | ERP extensible; capabilities reales dependen de versión, plan, módulos, instalación y access rights |
| Authentication | documentación oficial de Odoo 18 verifica XML-RPC y API keys; Odoo 19 documenta JSON-2 Bearer API key. La versión objetivo no se selecciona en este corte |
| Customer/platform configuration | dominio/base URL, database cuando aplique, identidad técnica dedicada y secret reference; forma exacta `UNVERIFIED` hasta seleccionar versión/deployment |
| Environment model | instalación específica; demo/test existe, pero no se declara sandbox contractual para el futuro adapter |
| Webhook/rate limit/idempotency | webhooks de Studio existen, pero el patrón concreto POS↔Odoo y sus garantías quedan `UNVERIFIED`; límites e idempotencia `UNVERIFIED` |
| Mapping | modelos/record IDs mediante `ExternalReferenceMapping`; nunca columnas `odoo_id` en core |
| Evidence required for PASS | versión/plan/deployment fijados, API/access rights, cuenta técnica, discovery de modelos, operaciones reales y suite completa de aceptación |
| Official source/reference | [Odoo 18 External API](https://www.odoo.com/documentation/18.0/developer/reference/external_api.html), [Odoo 19 JSON-2 API](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html), [Odoo webhooks](https://www.odoo.com/documentation/18.0/applications/studio/automated_actions/webhooks.html) |

## Regla de aceptación

Ningún provider obtiene PASS productivo por compilar, pasar unit tests/mocks, tener DTOs/documentación o mostrar `Connected`. `SANDBOX_VERIFIED` exige ejecución real autorizada en sandbox/test; `PRODUCTION_VERIFIED`, una cuenta productiva autorizada y operaciones controladas; `CERTIFIED`, evidencia formal externa. Las credenciales nunca se incorporan a esta matriz ni a sus evidencias.

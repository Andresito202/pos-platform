# TECH-002 R2-B: contrato físico base de Pricing

## Estado y alcance

`CLOSED` documentalmente dentro de `TECH-002 / R2-B`, sin DDL.

Pricing posee listas, precios de producto/presentación, políticas, promociones y redondeo comercial. Tax permanece independiente. `PriceChange` no es agregado ni tabla. El contrato no inventa `PriceRule` o `DiscountRule` genéricos: en el alcance aprobado, `ProductPrice` es la regla de precio; promociones versionadas y descuentos aplicados conservan sus contratos propios. Un workflow de solicitud/aprobación futuro requerirá caso de uso y agregado explícitos.

## Ubicación y autoridad

`PriceList`, `ProductPrice`, `PricingPolicy`, `PricingPolicyVersion`, `Promotion`, `PromotionVersion`, `PromotionConsumption`, `RoundingPolicy` y versiones son `CENTRAL_MASTER_REPLICATED`. SQLite conserva únicamente versiones publicadas necesarias para resolver ventas offline; nunca publica cambios maestros.

## Tablas base

### `pricing.price_lists` / `pricing_price_lists`

Columnas: `id`, `tenant_id`, `company_id`, `name`, `name_normalized`, `currency_code`, `status`, `version`, `created_at`, `retired_at NULL`.

Constraints: `UNIQUE (tenant_id, id)`, FK compuesta Company, `UNIQUE (tenant_id, company_id, name_normalized)`, estados `ACTIVE`/`RETIRED`, sin hard delete ni cambio de moneda después de ser referenciada.

### `pricing.product_prices` / `pricing_product_prices`

Columnas: `id`, `tenant_id`, `company_id`, `price_list_id`, `product_id`, `variant_id NULL`, `presentation_id NULL`, `branch_id NULL`, `sales_channel`, `minimum_quantity NULL`, `maximum_quantity NULL`, `amount numeric(19,6)`, `currency_code`, `priority`, `valid_from`, `valid_until NULL`, `status`, `pricing_policy_version_id`, `version`, `supersedes_product_price_id NULL`, `publication_idempotency_key`, `request_checksum`, `created_by_actor_type`, `created_by_actor_id`, `created_at`.

Reglas:

- scope y FKs son tenant/company-aware; Branch, Product, Variant y Presentation deben corresponder;
- al menos una identidad vendible válida y la resolución final apunta a Presentation concreta;
- importe no negativo, moneda igual a PriceList y rangos de cantidad/vigencia no vacíos;
- una versión publicada es inmutable; corregir/cerrar/publicar crea evidencia explícita y nunca reescribe una venta;
- equivalencia, solapamiento, prioridad y desempate se evalúan bajo `PricingPolicyVersion`;
- igual prioridad sin desempate normativo se rechaza como ambigüedad;
- `created_at`, `updated_at`, nivel Branch/Company/Tenant o last-write-wins no resuelven precedencia;
- `UNIQUE (tenant_id, company_id, publication_idempotency_key)` y checksum para reintentos.

### `pricing.pricing_policies` y `pricing.pricing_policy_versions`

La identidad estable contiene `id`, `tenant_id`, `company_id`, nombre y lifecycle. Cada versión inmutable contiene `id`, `tenant_id`, `pricing_policy_id`, `version_number`, `status`, `valid_from`, `valid_until NULL`, `resolution_algorithm`, `scope_rules`, `priority_rules`, `tie_break_rules`, `eligibility_rules`, `composition_rules`, `checksum`, `supersedes_version_id NULL`, actor, motivo y timestamps de publicación/revocación.

Los conjuntos de reglas se almacenan como snapshot con schema explícito y checksum solo cuando su estructura realmente es compuesta; los campos autoritativos de scope, prioridad, vigencia y lifecycle siguen en columnas. No existe precedencia global implícita.

Promotions y RoundingPolicy siguen el mismo lifecycle `DRAFT`, `PUBLISHED`, `SUPERSEDED`, `REVOKED` definido por el contrato común. `PromotionConsumption` es un hecho idempotente vinculado a Sale; no se fusiona con ProductPrice.

## Snapshot histórico de Sales

Pricing produce un `pricing_resolution_snapshot` versionado con identidad vendible, lista, precio candidato/elegido, scopes, prioridad, desempate, promociones/descuentos aplicados, importes, policy versions y checksum. Sales conserva el resultado; no copia todas las reglas ni consulta precios actuales al reimprimir, devolver o auditar.

## Publicación, sync y transacciones

Publicar confirma, en una transacción central: versión inmutable, cierre controlado de vigencia anterior cuando esté autorizado, detección de solapamientos bajo concurrencia, AuditEvent y evento/outbox de distribución. No usa provider externo ni transacción distribuida. El POS aplica un snapshot completo y verificable en una transacción SQLite; checkpoint no hace visible una versión parcial.

Pricing es `SERVER_AUTHORITATIVE`: el POS puede consumir una versión local vigente para ventas offline permitidas, pero no crear, mezclar ni extender reglas. Una versión vencida o dependencia ausente produce la decisión offline definida por policy; nunca fallback silencioso a timestamps.

## Seguridad y observabilidad futura

Tenant y company se derivan de contexto confiable; publicación exige permiso, ABAC, reautenticación/MFA cuando la política lo requiera, expected version, idempotencia y auditoría. No hay secretos. Parsing, schema validation, normalización, validación de negocio y autorización son etapas separadas. Puntos futuros: `LoggerPort`, `MetricsPort` y `AuditPort` para publicación, ambigüedad, invalidación/distribución y uso offline, sin alterar la resolución.

## Pruebas futuras obligatorias

Cross-tenant, scopes incompatibles, importes/decimales, intervalos, publicación concurrente, solapamiento y empate, idempotencia, historia inmutable, ausencia de `PriceChange`, no precedencia por timestamp, snapshot offline completo/expirado y aplicación atómica PostgreSQL/SQLite.

## Resultado

Pricing base queda cerrado para R2-B; promociones avanzadas no respaldadas, workflow de aprobación y reglas comerciales futuras permanecen fuera de la primera migración.

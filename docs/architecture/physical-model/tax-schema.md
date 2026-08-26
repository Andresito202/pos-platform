# TECH-002 R2-B: contrato físico base de Tax

## Estado y alcance

`CLOSED` documentalmente dentro de `TECH-002 / R2-B`, sin DDL.

Tax es autoridad de clasificación, reglas, tasas, vigencia, cálculo y `TaxSnapshot`. No posee resolución/numeración fiscal, proveedor, conexión ni `ElectronicDocument`. Pricing consume el resultado tributario dentro del pipeline y Electronic Invoicing consume el snapshot congelado por Sales sin recalcularlo.

## Ubicación y autoridad

`TaxClassification`, `TaxRule`, `TaxRuleVersion` y `TaxPolicyVersion` son `CENTRAL_MASTER_REPLICATED`. `TaxSnapshot` no es una tabla maestra separada: es un value object inmutable embebido/referenciado por la operación propietaria y con schema/version/checksum.

## `tax.tax_classifications` / `tax_tax_classifications`

Materializa el concepto normativo `tax_category` sin especialización legal no documentada.

Columnas: `id`, `tenant_id`, `company_id`, `code`, `code_normalized`, `name`, `status`, `valid_from`, `valid_until NULL`, `version`, `created_at`, `retired_at NULL`.

Constraints: `UNIQUE (tenant_id, id)`, FK Company, `UNIQUE (tenant_id, company_id, code_normalized)`, rango válido, estados `ACTIVE`/`RETIRED`, no reutilización silenciosa. Catalog referencia esta identidad mediante FK tenant/company-aware; no guarda tasa en Product.

## `tax.tax_rules` y `tax.tax_rule_versions`

La identidad estable contiene `id`, `tenant_id`, `company_id`, `code`, `name`, `status`, `created_at`, `retired_at NULL`.

Cada versión contiene: `id`, `tenant_id`, `company_id`, `tax_rule_id`, `version_number`, `tax_classification_id`, `jurisdiction_code`, `scope_type`, `scope_reference_id NULL`, `calculation_type`, `price_inclusion_mode`, `rate numeric(19,10)`, `priority`, `valid_from`, `valid_until NULL`, `tax_policy_version_id`, `legal_reference NULL`, `status`, `checksum`, `supersedes_version_id NULL`, `publication_idempotency_key`, `request_checksum`, actor, motivo y timestamps de publicación/revocación.

Reglas:

- FKs y scopes son tenant/company-aware; scope tipado se valida por el caso de uso sin FK polimórfica engañosa;
- tasa exacta y cálculo respetan `UC-TAX-001`; ninguna operación usa float;
- versión publicada inmutable, rango no vacío y sustitución explícita;
- dos reglas equivalentes no se solapan con igual prioridad sin resolución normativa;
- policy declara precedencia y desempate; timestamps o nivel organizacional no son autoridad implícita;
- `UNIQUE (tenant_id, company_id, publication_idempotency_key)`;
- referencia legal es evidencia, no lógica ejecutable ni afirmación regulatoria inventada;
- ningún campo contiene proveedor fiscal, resolución, prefijo, numeración, API key, certificado o estado de DIAN.

## TaxSnapshot

El snapshot por venta/línea conserva únicamente: schema version, rule/version/classification IDs y códigos mostrables requeridos, policy version, jurisdicción, inclusión, tasas exactas, bases, importes, residuos/ajustes, nivel de cálculo, vigencia evaluada, entradas relevantes, resultado y checksum. No conserva credenciales, respuestas de proveedor ni configuración fiscal completa.

Sales congela el snapshot al completar. Devoluciones usan el original. Electronic Invoicing lo consume junto con su propio snapshot fiscal; no lo modifica ni lo reemplaza con configuración actual.

## Publicación, sync y transacciones

Publicar una regla/versión, resolver solapamientos permitidos, registrar AuditEvent y emitir evento/outbox de distribución comparten una transacción central. El POS recibe versiones completas verificables y las activa atómicamente en SQLite. Tax es `SERVER_AUTHORITATIVE`; offline solo consume snapshots publicados, vigentes y admitidos por policy.

## Seguridad y observabilidad futura

La autoridad central deriva tenant/company/actor; valida schema, semántica, autorización, idempotencia y concurrencia. RLS/FKs cubren aislamiento adicional. Tax no almacena secretos. `LoggerPort`, `MetricsPort` y `AuditPort` observarán publicación, ambigüedad, resolución, discrepancia offline y consumo fiscal, sin cambiar resultados.

## Pruebas futuras obligatorias

Incluyen cross-tenant Catalog→Tax, tasas/decimales, scopes, solapamientos y prioridad, concurrencia/idempotencia, historia ante cambio tributario, TaxSnapshot reproducible, devolución con snapshot original, versión offline completa/vencida, ausencia de campos fiscales/proveedor y exactitud equivalente PostgreSQL/SQLite.

## Resultado

Tax base queda cerrado para R2-B y cierra la condición trasladada de Catalog sobre `tax_category_id`. Requisitos legales colombianos adicionales solo podrán entrar mediante decisión normativa posterior, sin modificar el core de Sales.

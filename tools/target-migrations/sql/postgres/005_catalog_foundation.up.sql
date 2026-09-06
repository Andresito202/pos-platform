-- Bloque 29: materializes the 5 Catalog aggregates designed in domain/
-- application by Bloque 27 (packages/domain/src/catalog/*) — CompanyScope
-- (tenant+company, never branch, per company-scope.ts's own doc comment:
-- Catalog is "compartido por empresa"). Column set mirrors B27's ACTUAL
-- domain fields exactly, not catalog-schema.md's wider aspirational
-- superset. This mirrors packages/database-sqlite's MIGRATION_009 field-
-- for-field so both engines stay semantically equivalent (B29 parity
-- requirement) — differences are PostgreSQL-native representation only
-- (uuid/numeric/timestamptz vs SQLite's TEXT-affinity canonical strings),
-- never a different business rule.

CREATE SCHEMA IF NOT EXISTS catalog;
REVOKE CREATE ON SCHEMA catalog FROM PUBLIC;

CREATE TABLE catalog.products (
  id uuid PRIMARY KEY CONSTRAINT catalog_products_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  internal_code text,
  name text NOT NULL CONSTRAINT catalog_products_name_ck CHECK (btrim(name) <> ''),
  description text,
  category_id uuid NOT NULL,
  brand_id uuid,
  product_type text NOT NULL CONSTRAINT catalog_products_product_type_ck
    CHECK (product_type IN ('STANDARD','WEIGHTED','SERVICE','COMPOSITE','PREPARED','RETURNABLE','REGULATED')),
  stock_controlled boolean NOT NULL,
  lot_controlled boolean NOT NULL,
  expiration_controlled boolean NOT NULL,
  serial_controlled boolean NOT NULL,
  tax_category_id uuid,
  base_unit_id uuid NOT NULL,
  variant_policy text NOT NULL CONSTRAINT catalog_products_variant_policy_ck
    CHECK (variant_policy IN ('NO_VARIANTS','OPTIONAL_VARIANTS','REQUIRED_VARIANTS')),
  status text NOT NULL CONSTRAINT catalog_products_status_ck CHECK (status IN ('DRAFT','ACTIVE','INACTIVE')),
  version bigint NOT NULL CONSTRAINT catalog_products_version_ck CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_products_expiration_requires_lot_ck CHECK (NOT expiration_controlled OR lot_controlled),
  CONSTRAINT catalog_products_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT catalog_products_tenant_company_id_uq UNIQUE (tenant_id, company_id, id)
);
CREATE UNIQUE INDEX catalog_products_internal_code_uq
  ON catalog.products (tenant_id, company_id, internal_code)
  WHERE internal_code IS NOT NULL;
ALTER TABLE catalog.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.products FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_products_tenant_isolation ON catalog.products
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

-- Idempotency-replay log: Product is the only Catalog aggregate with more
-- than one mutation (create/update/deactivate, B27) writing the SAME row —
-- unlike Variant/Presentation/Identifier/Conversion, which are create-only
-- and never mutate again. A plain "current row" lookup would return the
-- WRONG (drifted) result for an old update-idempotency-key replayed after
-- a LATER update changed the row. Same JSON-snapshot pattern
-- MIGRATION_009 uses in SQLite, itself reusing local_sync_outbox's own
-- established operation_json convention.
CREATE TABLE catalog.product_mutation_log (
  id uuid PRIMARY KEY CONSTRAINT catalog_product_mutation_log_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  operation text NOT NULL CONSTRAINT catalog_product_mutation_log_operation_ck CHECK (operation IN ('CREATE','UPDATE','DEACTIVATE')),
  idempotency_key text NOT NULL,
  product_id uuid NOT NULL,
  snapshot_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_product_mutation_log_uq UNIQUE (tenant_id, company_id, operation, idempotency_key)
);
ALTER TABLE catalog.product_mutation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.product_mutation_log FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_product_mutation_log_tenant_isolation ON catalog.product_mutation_log
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE TABLE catalog.product_variants (
  id uuid PRIMARY KEY CONSTRAINT catalog_product_variants_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  product_id uuid NOT NULL,
  attributes_json jsonb NOT NULL,
  canonical_key text NOT NULL CONSTRAINT catalog_product_variants_canonical_key_ck CHECK (btrim(canonical_key) <> ''),
  status text NOT NULL CONSTRAINT catalog_product_variants_status_ck CHECK (status IN ('ACTIVE','RETIRED')),
  version bigint NOT NULL CONSTRAINT catalog_product_variants_version_ck CHECK (version > 0),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_product_variants_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT catalog_product_variants_tenant_company_id_uq UNIQUE (tenant_id, company_id, id),
  CONSTRAINT catalog_product_variants_canonical_key_uq UNIQUE (tenant_id, company_id, product_id, canonical_key),
  CONSTRAINT catalog_product_variants_idempotency_uq UNIQUE (tenant_id, company_id, idempotency_key),
  CONSTRAINT catalog_product_variants_product_fk FOREIGN KEY (tenant_id, company_id, product_id)
    REFERENCES catalog.products (tenant_id, company_id, id)
);
ALTER TABLE catalog.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.product_variants FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_product_variants_tenant_isolation ON catalog.product_variants
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE TABLE catalog.product_presentations (
  id uuid PRIMARY KEY CONSTRAINT catalog_product_presentations_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  product_id uuid NOT NULL,
  variant_id uuid,
  name text NOT NULL CONSTRAINT catalog_product_presentations_name_ck CHECK (btrim(name) <> ''),
  internal_sku text,
  unit_id uuid NOT NULL,
  contained_quantity numeric(19,6) NOT NULL CONSTRAINT catalog_product_presentations_contained_quantity_ck CHECK (contained_quantity > 0),
  variable_quantity boolean NOT NULL,
  sales_enabled boolean NOT NULL,
  purchasing_enabled boolean NOT NULL,
  breakable boolean NOT NULL,
  stock_mode text NOT NULL CONSTRAINT catalog_product_presentations_stock_mode_ck
    CHECK (stock_mode IN ('INDEPENDENT','CONVERTED_TO_BASE','DERIVED','NON_STOCK')),
  status text NOT NULL CONSTRAINT catalog_product_presentations_status_ck CHECK (status IN ('ACTIVE','INACTIVE')),
  version bigint NOT NULL CONSTRAINT catalog_product_presentations_version_ck CHECK (version > 0),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_product_presentations_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT catalog_product_presentations_tenant_company_id_uq UNIQUE (tenant_id, company_id, id),
  CONSTRAINT catalog_product_presentations_idempotency_uq UNIQUE (tenant_id, company_id, idempotency_key),
  CONSTRAINT catalog_product_presentations_product_fk FOREIGN KEY (tenant_id, company_id, product_id)
    REFERENCES catalog.products (tenant_id, company_id, id),
  CONSTRAINT catalog_product_presentations_variant_fk FOREIGN KEY (tenant_id, company_id, variant_id)
    REFERENCES catalog.product_variants (tenant_id, company_id, id)
);
CREATE UNIQUE INDEX catalog_product_presentations_sku_uq
  ON catalog.product_presentations (tenant_id, company_id, internal_sku)
  WHERE internal_sku IS NOT NULL;
ALTER TABLE catalog.product_presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.product_presentations FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_product_presentations_tenant_isolation ON catalog.product_presentations
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE TABLE catalog.product_identifiers (
  id uuid PRIMARY KEY CONSTRAINT catalog_product_identifiers_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  product_id uuid NOT NULL,
  variant_id uuid,
  presentation_id uuid NOT NULL,
  identifier_type text NOT NULL CONSTRAINT catalog_product_identifiers_type_ck
    CHECK (identifier_type IN ('INTERNAL','EAN_8','EAN_13','UPC','PLU','SUPPLIER_CODE','SCALE_BARCODE','INTERNAL_QR','MANUAL_CODE')),
  raw_value text NOT NULL CONSTRAINT catalog_product_identifiers_raw_value_ck CHECK (btrim(raw_value) <> ''),
  normalized_value text NOT NULL CONSTRAINT catalog_product_identifiers_normalized_value_ck CHECK (btrim(normalized_value) <> ''),
  status text NOT NULL CONSTRAINT catalog_product_identifiers_status_ck CHECK (status IN ('ACTIVE','INACTIVE')),
  version bigint NOT NULL CONSTRAINT catalog_product_identifiers_version_ck CHECK (version > 0),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_product_identifiers_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT catalog_product_identifiers_natural_uq UNIQUE (tenant_id, company_id, identifier_type, normalized_value),
  CONSTRAINT catalog_product_identifiers_idempotency_uq UNIQUE (tenant_id, company_id, idempotency_key),
  CONSTRAINT catalog_product_identifiers_product_fk FOREIGN KEY (tenant_id, company_id, product_id)
    REFERENCES catalog.products (tenant_id, company_id, id),
  CONSTRAINT catalog_product_identifiers_variant_fk FOREIGN KEY (tenant_id, company_id, variant_id)
    REFERENCES catalog.product_variants (tenant_id, company_id, id),
  CONSTRAINT catalog_product_identifiers_presentation_fk FOREIGN KEY (tenant_id, company_id, presentation_id)
    REFERENCES catalog.product_presentations (tenant_id, company_id, id)
);
ALTER TABLE catalog.product_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.product_identifiers FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_product_identifiers_tenant_isolation ON catalog.product_identifiers
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE TABLE catalog.unit_conversions (
  id uuid PRIMARY KEY CONSTRAINT catalog_unit_conversions_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  product_id uuid NOT NULL,
  variant_id uuid,
  source_presentation_id uuid NOT NULL,
  target_presentation_id uuid NOT NULL,
  factor numeric(19,10) NOT NULL CONSTRAINT catalog_unit_conversions_factor_ck CHECK (factor > 0),
  reversible boolean NOT NULL,
  requires_authorization boolean NOT NULL,
  waste_policy text,
  cost_policy text,
  lot_policy text,
  valid_from timestamptz NOT NULL,
  status text NOT NULL CONSTRAINT catalog_unit_conversions_status_ck CHECK (status IN ('ACTIVE','INACTIVE')),
  version bigint NOT NULL CONSTRAINT catalog_unit_conversions_version_ck CHECK (version > 0),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_unit_conversions_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT catalog_unit_conversions_pair_uq UNIQUE (tenant_id, company_id, source_presentation_id, target_presentation_id),
  CONSTRAINT catalog_unit_conversions_idempotency_uq UNIQUE (tenant_id, company_id, idempotency_key),
  CONSTRAINT catalog_unit_conversions_not_same_presentation_ck CHECK (source_presentation_id <> target_presentation_id),
  CONSTRAINT catalog_unit_conversions_product_fk FOREIGN KEY (tenant_id, company_id, product_id)
    REFERENCES catalog.products (tenant_id, company_id, id),
  CONSTRAINT catalog_unit_conversions_variant_fk FOREIGN KEY (tenant_id, company_id, variant_id)
    REFERENCES catalog.product_variants (tenant_id, company_id, id),
  CONSTRAINT catalog_unit_conversions_source_fk FOREIGN KEY (tenant_id, company_id, source_presentation_id)
    REFERENCES catalog.product_presentations (tenant_id, company_id, id),
  CONSTRAINT catalog_unit_conversions_target_fk FOREIGN KEY (tenant_id, company_id, target_presentation_id)
    REFERENCES catalog.product_presentations (tenant_id, company_id, id)
);
ALTER TABLE catalog.unit_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.unit_conversions FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_unit_conversions_tenant_isolation ON catalog.unit_conversions
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

REVOKE ALL ON ALL TABLES IN SCHEMA catalog FROM PUBLIC;
GRANT USAGE ON SCHEMA catalog TO pos_app, pos_worker, pos_platform_admin;
GRANT SELECT, INSERT, UPDATE ON catalog.products TO pos_app, pos_worker;
GRANT SELECT, INSERT ON catalog.product_mutation_log TO pos_app, pos_worker;
GRANT SELECT, INSERT ON catalog.product_variants TO pos_app, pos_worker;
GRANT SELECT, INSERT ON catalog.product_presentations TO pos_app, pos_worker;
GRANT SELECT, INSERT ON catalog.product_identifiers TO pos_app, pos_worker;
GRANT SELECT, INSERT ON catalog.unit_conversions TO pos_app, pos_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA catalog TO pos_platform_admin;

REVOKE ALL ON ALL TABLES IN SCHEMA catalog FROM pos_app, pos_worker, pos_platform_admin;
REVOKE USAGE ON SCHEMA catalog FROM pos_app, pos_worker, pos_platform_admin;

DROP TABLE IF EXISTS catalog.unit_conversions;
DROP TABLE IF EXISTS catalog.product_identifiers;
DROP TABLE IF EXISTS catalog.product_presentations;
DROP TABLE IF EXISTS catalog.product_variants;
DROP TABLE IF EXISTS catalog.product_mutation_log;
DROP TABLE IF EXISTS catalog.products;
DROP SCHEMA IF EXISTS catalog;

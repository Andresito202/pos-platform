REVOKE ALL ON ALL TABLES IN SCHEMA inventory FROM pos_app, pos_worker, pos_platform_admin;
REVOKE USAGE ON SCHEMA inventory FROM pos_app, pos_worker, pos_platform_admin;

DROP TABLE IF EXISTS inventory.transfer_mutation_log;
DROP TABLE IF EXISTS inventory.transfer_lines;
DROP TABLE IF EXISTS inventory.transfers;
DROP TABLE IF EXISTS inventory.reservation_mutation_log;
DROP TABLE IF EXISTS inventory.reservations;
DROP TABLE IF EXISTS inventory.movements;
DROP SCHEMA IF EXISTS inventory;

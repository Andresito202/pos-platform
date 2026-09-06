-- Bloque 33: materializes the Inventory aggregates designed in
-- domain/application by Bloque 32 (packages/domain/src/inventory/*).
-- StockBalance is deliberately NOT a table here — B32 kept it a pure
-- computed value (fold over movements + reservations), not a persisted
-- projection; this migration only materializes what IS a real mutable
-- aggregate: InventoryMovement (append-only), InventoryReservation
-- (create/consume/release), InventoryTransfer + InventoryTransferLine
-- (request/dispatch/receipt/cancellation). Column set mirrors
-- packages/database-sqlite's MIGRATION_010 field-for-field (B33 parity
-- requirement) — differences are PostgreSQL-native representation only.
-- `presentation_id` gets a real FK to catalog.product_presentations
-- wherever it appears (defense in depth on top of B32's application-
-- level validateInventoryPresentation — "Catalog owns identity,
-- Inventory owns physical stock", B31) — this migration therefore
-- depends on 005_catalog_foundation, not just 001.

CREATE SCHEMA IF NOT EXISTS inventory;
REVOKE CREATE ON SCHEMA inventory FROM PUBLIC;

CREATE TABLE inventory.movements (
  id uuid PRIMARY KEY CONSTRAINT inventory_movements_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  inventory_location_id uuid NOT NULL,
  presentation_id uuid NOT NULL,
  lot_id uuid,
  movement_type text NOT NULL CONSTRAINT inventory_movements_type_ck
    CHECK (movement_type IN ('POSITIVE_ADJUSTMENT','NEGATIVE_ADJUSTMENT','WASTE','TRANSFER_OUT','TRANSFER_IN','RESERVATION_CONSUMPTION')),
  direction text NOT NULL CONSTRAINT inventory_movements_direction_ck CHECK (direction IN ('IN','OUT')),
  quantity numeric(19,6) NOT NULL CONSTRAINT inventory_movements_quantity_ck CHECK (quantity > 0),
  reason_code text,
  status text NOT NULL CONSTRAINT inventory_movements_status_ck CHECK (status = 'POSTED'),
  occurred_at timestamptz NOT NULL,
  reference_type text,
  reference_id text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movements_idempotency_uq UNIQUE (tenant_id, company_id, idempotency_key),
  CONSTRAINT inventory_movements_presentation_fk FOREIGN KEY (tenant_id, company_id, presentation_id)
    REFERENCES catalog.product_presentations (tenant_id, company_id, id)
);
CREATE INDEX inventory_movements_scope_idx
  ON inventory.movements (tenant_id, company_id, branch_id, inventory_location_id, presentation_id, lot_id);
ALTER TABLE inventory.movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.movements FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_movements_tenant_isolation ON inventory.movements
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE TABLE inventory.reservations (
  id uuid PRIMARY KEY CONSTRAINT inventory_reservations_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  inventory_location_id uuid NOT NULL,
  presentation_id uuid NOT NULL,
  lot_id uuid,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  quantity numeric(19,6) NOT NULL CONSTRAINT inventory_reservations_quantity_ck CHECK (quantity > 0),
  consumed_quantity numeric(19,6) NOT NULL CONSTRAINT inventory_reservations_consumed_quantity_ck CHECK (consumed_quantity >= 0),
  released_quantity numeric(19,6) NOT NULL CONSTRAINT inventory_reservations_released_quantity_ck CHECK (released_quantity >= 0),
  status text NOT NULL CONSTRAINT inventory_reservations_status_ck CHECK (status IN ('ACTIVE','PARTIALLY_CONSUMED','CONSUMED','RELEASED','EXPIRED')),
  expires_at timestamptz,
  version bigint NOT NULL CONSTRAINT inventory_reservations_version_ck CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_reservations_presentation_fk FOREIGN KEY (tenant_id, company_id, presentation_id)
    REFERENCES catalog.product_presentations (tenant_id, company_id, id)
);
CREATE INDEX inventory_reservations_scope_idx
  ON inventory.reservations (tenant_id, company_id, branch_id, inventory_location_id, presentation_id, lot_id);
ALTER TABLE inventory.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_reservations_tenant_isolation ON inventory.reservations
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

-- Idempotency-replay log: InventoryReservation has THREE mutation types
-- (create/consume/release) touching the SAME row — same
-- catalog.product_mutation_log pattern B29 established for Product,
-- reused here verbatim.
CREATE TABLE inventory.reservation_mutation_log (
  id uuid PRIMARY KEY CONSTRAINT inventory_reservation_mutation_log_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  operation text NOT NULL CONSTRAINT inventory_reservation_mutation_log_operation_ck CHECK (operation IN ('CREATE','CONSUME','RELEASE')),
  idempotency_key text NOT NULL,
  reservation_id uuid NOT NULL,
  snapshot_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_reservation_mutation_log_uq UNIQUE (tenant_id, company_id, operation, idempotency_key)
);
ALTER TABLE inventory.reservation_mutation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.reservation_mutation_log FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_reservation_mutation_log_tenant_isolation ON inventory.reservation_mutation_log
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE TABLE inventory.transfers (
  id uuid PRIMARY KEY CONSTRAINT inventory_transfers_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  source_branch_id uuid NOT NULL,
  source_location_id uuid NOT NULL,
  destination_branch_id uuid NOT NULL,
  destination_location_id uuid NOT NULL,
  status text NOT NULL CONSTRAINT inventory_transfers_status_ck
    CHECK (status IN ('REQUESTED','APPROVED','IN_TRANSIT','RECEIVED','PARTIALLY_RECEIVED','CANCELLED','REJECTED')),
  requested_by_actor_type text NOT NULL CONSTRAINT inventory_transfers_requested_actor_type_ck CHECK (requested_by_actor_type IN ('DEVICE','USER','SYSTEM')),
  requested_by_actor_id text NOT NULL,
  approved_by_actor_type text CONSTRAINT inventory_transfers_approved_actor_type_ck CHECK (approved_by_actor_type IS NULL OR approved_by_actor_type IN ('DEVICE','USER','SYSTEM')),
  approved_by_actor_id text,
  dispatched_by_actor_type text CONSTRAINT inventory_transfers_dispatched_actor_type_ck CHECK (dispatched_by_actor_type IS NULL OR dispatched_by_actor_type IN ('DEVICE','USER','SYSTEM')),
  dispatched_by_actor_id text,
  received_by_actor_type text CONSTRAINT inventory_transfers_received_actor_type_ck CHECK (received_by_actor_type IS NULL OR received_by_actor_type IN ('DEVICE','USER','SYSTEM')),
  received_by_actor_id text,
  requested_at timestamptz NOT NULL,
  approved_at timestamptz,
  dispatched_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  version bigint NOT NULL CONSTRAINT inventory_transfers_version_ck CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_transfers_locations_ck CHECK (source_location_id <> destination_location_id),
  CONSTRAINT inventory_transfers_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT inventory_transfers_tenant_company_id_uq UNIQUE (tenant_id, company_id, id)
);
ALTER TABLE inventory.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_transfers_tenant_isolation ON inventory.transfers
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE TABLE inventory.transfer_lines (
  id uuid PRIMARY KEY CONSTRAINT inventory_transfer_lines_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  transfer_id uuid NOT NULL,
  presentation_id uuid NOT NULL,
  lot_id uuid,
  requested_quantity numeric(19,6) NOT NULL CONSTRAINT inventory_transfer_lines_requested_quantity_ck CHECK (requested_quantity > 0),
  dispatched_quantity numeric(19,6) NOT NULL CONSTRAINT inventory_transfer_lines_dispatched_quantity_ck CHECK (dispatched_quantity >= 0),
  received_quantity numeric(19,6) NOT NULL CONSTRAINT inventory_transfer_lines_received_quantity_ck CHECK (received_quantity >= 0),
  CONSTRAINT inventory_transfer_lines_transfer_fk FOREIGN KEY (tenant_id, company_id, transfer_id)
    REFERENCES inventory.transfers (tenant_id, company_id, id),
  CONSTRAINT inventory_transfer_lines_presentation_fk FOREIGN KEY (tenant_id, company_id, presentation_id)
    REFERENCES catalog.product_presentations (tenant_id, company_id, id)
);
CREATE INDEX inventory_transfer_lines_transfer_idx ON inventory.transfer_lines (transfer_id);
ALTER TABLE inventory.transfer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.transfer_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_transfer_lines_tenant_isolation ON inventory.transfer_lines
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

-- Idempotency-replay log: InventoryTransfer has FOUR mutation types
-- (request/dispatch/receipt/cancellation) touching the SAME row, plus
-- its lines — the snapshot carries both.
CREATE TABLE inventory.transfer_mutation_log (
  id uuid PRIMARY KEY CONSTRAINT inventory_transfer_mutation_log_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  operation text NOT NULL CONSTRAINT inventory_transfer_mutation_log_operation_ck CHECK (operation IN ('REQUEST','DISPATCH','RECEIPT','CANCELLATION')),
  idempotency_key text NOT NULL,
  transfer_id uuid NOT NULL,
  snapshot_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_transfer_mutation_log_uq UNIQUE (tenant_id, company_id, operation, idempotency_key)
);
ALTER TABLE inventory.transfer_mutation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.transfer_mutation_log FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_transfer_mutation_log_tenant_isolation ON inventory.transfer_mutation_log
  FOR ALL TO pos_app, pos_worker
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

REVOKE ALL ON ALL TABLES IN SCHEMA inventory FROM PUBLIC;
GRANT USAGE ON SCHEMA inventory TO pos_app, pos_worker, pos_platform_admin;
GRANT SELECT, INSERT ON inventory.movements TO pos_app, pos_worker;
GRANT SELECT, INSERT, UPDATE ON inventory.reservations TO pos_app, pos_worker;
GRANT SELECT, INSERT ON inventory.reservation_mutation_log TO pos_app, pos_worker;
GRANT SELECT, INSERT, UPDATE ON inventory.transfers TO pos_app, pos_worker;
GRANT SELECT, INSERT, UPDATE ON inventory.transfer_lines TO pos_app, pos_worker;
GRANT SELECT, INSERT ON inventory.transfer_mutation_log TO pos_app, pos_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA inventory TO pos_platform_admin;

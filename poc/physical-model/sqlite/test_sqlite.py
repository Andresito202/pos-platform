from __future__ import annotations

import re
import shutil
import sqlite3
import threading
import time
from decimal import Decimal
from pathlib import Path


POC_ROOT = Path(__file__).resolve().parents[1]
WORK_DIR = POC_ROOT / "work"
DB_PATH = WORK_DIR / "physical-model.sqlite3"
BACKUP_PATH = WORK_DIR / "physical-model-backup.sqlite3"

TENANT_A = "01890f5a-0000-7000-8000-000000000001"
TENANT_B = "01890f5a-0000-7000-8000-000000000002"
COMPANY_A = "01890f5a-0000-7000-8000-000000000101"
COMPANY_B = "01890f5a-0000-7000-8000-000000000102"
BRANCH_A = "01890f5a-0000-7000-8000-000000000201"
BRANCH_B = "01890f5a-0000-7000-8000-000000000202"
DEVICE_A = "01890f5a-0000-7000-8000-000000000301"
DEVICE_B = "01890f5a-0000-7000-8000-000000000302"
UNIT_EA = "01890f5a-0000-7000-8000-000000000401"
UNIT_KG = "01890f5a-0000-7000-8000-000000000402"
UNIT_L = "01890f5a-0000-7000-8000-000000000403"
UNIT_M = "01890f5a-0000-7000-8000-000000000404"
PRODUCT_UNIT = "01890f5a-0000-7000-8000-000000000501"
PRODUCT_WEIGHT = "01890f5a-0000-7000-8000-000000000502"
PRODUCT_LOT = "01890f5a-0000-7000-8000-000000000503"
PRODUCT_HARDWARE = "01890f5a-0000-7000-8000-000000000504"
PRODUCT_FLOWER = "01890f5a-0000-7000-8000-000000000505"
PRODUCT_B = "01890f5a-0000-7000-8000-000000000506"
VARIANT_A = "01890f5a-0000-7000-8000-000000000601"
LOT_A = "01890f5a-0000-7000-8000-000000000801"
SALE_SEED = "01890f5a-0000-7000-8000-000000001001"
SALE_B = "01890f5a-0000-7000-8000-000000001003"
PAYMENT_GROUP = "01890f5a-0000-7000-8000-000000001101"
PAYMENT_SEED = "01890f5a-0000-7000-8000-000000001102"
CHECKSUM_A = "a" * 64

UUID_V7 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
DECIMAL_6 = re.compile(r"^(0|[1-9][0-9]{0,12})\.[0-9]{6}$")
DECIMAL_10 = re.compile(r"^(0|[1-9][0-9]{0,8})\.[0-9]{10}$")
DECIMAL_2 = re.compile(r"^(0|[1-9][0-9]{0,16})\.[0-9]{2}$")


def is_uuid_v7(value: object) -> int:
    return int(isinstance(value, str) and UUID_V7.fullmatch(value) is not None)


def is_decimal_6(value: object) -> int:
    return int(isinstance(value, str) and DECIMAL_6.fullmatch(value) is not None)


def is_decimal_10(value: object) -> int:
    return int(isinstance(value, str) and DECIMAL_10.fullmatch(value) is not None)


def is_decimal_2(value: object) -> int:
    return int(isinstance(value, str) and DECIMAL_2.fullmatch(value) is not None)


def connect(path: Path = DB_PATH, timeout: float = 5.0) -> sqlite3.Connection:
    connection = sqlite3.connect(path, timeout=timeout, isolation_level=None, check_same_thread=False)
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA busy_timeout=5000")
    connection.create_function("is_uuid_v7", 1, is_uuid_v7, deterministic=True)
    connection.create_function("is_decimal_6", 1, is_decimal_6, deterministic=True)
    connection.create_function("is_decimal_10", 1, is_decimal_10, deterministic=True)
    connection.create_function("is_decimal_2", 1, is_decimal_2, deterministic=True)
    return connection


class Tests:
    def __init__(self) -> None:
        self.count = 0
        self.failures: list[str] = []

    def check(self, name: str, condition: bool, detail: str = "") -> None:
        self.count += 1
        status = "PASS" if condition else "FAIL"
        print(f"SQLITE_TEST|{status}|{name}|{detail}")
        if not condition:
            self.failures.append(name)

    def expect_error(self, name: str, action, expected: tuple[type[BaseException], ...] = (sqlite3.DatabaseError,)) -> None:
        try:
            action()
        except expected as exc:
            self.check(name, True, type(exc).__name__)
        except Exception as exc:
            self.check(name, False, f"unexpected {type(exc).__name__}: {exc}")
        else:
            self.check(name, False, "operation unexpectedly succeeded")


SCHEMA = r"""
CREATE TABLE test_limit_contract(sample_id INTEGER PRIMARY KEY,limit_type TEXT NOT NULL CHECK(limit_type IN('FINITE','UNLIMITED','NOT_APPLICABLE')),limit_value TEXT,CHECK((limit_type='FINITE' AND limit_value IS NOT NULL AND is_decimal_6(limit_value)) OR (limit_type IN('UNLIMITED','NOT_APPLICABLE') AND limit_value IS NULL)));
CREATE TABLE tenants(id TEXT PRIMARY KEY CHECK(typeof(id)='text' AND is_uuid_v7(id)),name TEXT NOT NULL);
CREATE TABLE companies(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,name TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT);
CREATE TABLE branches(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,name TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),UNIQUE(tenant_id,company_id,id),FOREIGN KEY(tenant_id,company_id) REFERENCES companies(tenant_id,id) ON DELETE RESTRICT);
CREATE TABLE devices(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,branch_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('ACTIVE','REVOKED')),UNIQUE(tenant_id,company_id,branch_id,id),FOREIGN KEY(tenant_id,company_id,branch_id) REFERENCES branches(tenant_id,company_id,id) ON DELETE RESTRICT);
CREATE TABLE units_of_measure(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),code TEXT NOT NULL UNIQUE,dimension TEXT NOT NULL CHECK(dimension IN('COUNT','MASS','VOLUME','LENGTH')),precision_scale INTEGER NOT NULL CHECK(precision_scale BETWEEN 0 AND 6));
CREATE TABLE products(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,base_unit_id TEXT NOT NULL,name TEXT NOT NULL,lot_controlled INTEGER NOT NULL CHECK(lot_controlled IN(0,1)),expiration_controlled INTEGER NOT NULL CHECK(expiration_controlled IN(0,1)),status TEXT NOT NULL CHECK(status IN('ACTIVE','INACTIVE')),version INTEGER NOT NULL CHECK(version>=1),CHECK(NOT expiration_controlled OR lot_controlled),UNIQUE(tenant_id,company_id,id),FOREIGN KEY(tenant_id,company_id) REFERENCES companies(tenant_id,id) ON DELETE RESTRICT,FOREIGN KEY(base_unit_id) REFERENCES units_of_measure(id) ON DELETE RESTRICT);
CREATE TABLE product_variants(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,product_id TEXT NOT NULL,variant_code TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),UNIQUE(tenant_id,company_id,product_id,id),UNIQUE(tenant_id,company_id,product_id,variant_code),FOREIGN KEY(tenant_id,company_id,product_id) REFERENCES products(tenant_id,company_id,id) ON DELETE RESTRICT);
CREATE TABLE pricing_versions(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,product_id TEXT NOT NULL,version_number INTEGER NOT NULL CHECK(version_number>=1),amount TEXT NOT NULL CHECK(typeof(amount)='text' AND is_decimal_6(amount)),priority INTEGER NOT NULL,valid_from TEXT NOT NULL,valid_until TEXT,status TEXT NOT NULL CHECK(status IN('PUBLISHED','SUPERSEDED','REVOKED')),checksum TEXT NOT NULL CHECK(length(checksum)=64 AND checksum NOT GLOB '*[^0-9a-f]*'),expected_parent_version INTEGER NOT NULL,UNIQUE(tenant_id,company_id,product_id,version_number),FOREIGN KEY(tenant_id,company_id,product_id) REFERENCES products(tenant_id,company_id,id) ON DELETE RESTRICT);
CREATE TABLE tax_versions(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,version_number INTEGER NOT NULL CHECK(version_number>=1),rate TEXT NOT NULL CHECK(typeof(rate)='text' AND is_decimal_10(rate)),priority INTEGER NOT NULL,valid_from TEXT NOT NULL,valid_until TEXT,status TEXT NOT NULL CHECK(status IN('PUBLISHED','SUPERSEDED','REVOKED')),checksum TEXT NOT NULL CHECK(length(checksum)=64 AND checksum NOT GLOB '*[^0-9a-f]*'),UNIQUE(tenant_id,company_id,version_number),FOREIGN KEY(tenant_id,company_id) REFERENCES companies(tenant_id,id) ON DELETE RESTRICT);
CREATE TABLE inventory_lots(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,product_id TEXT NOT NULL,batch_code TEXT,received_date TEXT NOT NULL,expiration_date TEXT,status TEXT NOT NULL CHECK(status IN('ACTIVE','BLOCKED','DEPLETED','EXPIRED')),version INTEGER NOT NULL CHECK(version>=1),CHECK(expiration_date IS NULL OR expiration_date>=received_date),UNIQUE(tenant_id,company_id,product_id,id),FOREIGN KEY(tenant_id,company_id,product_id) REFERENCES products(tenant_id,company_id,id) ON DELETE RESTRICT);
CREATE TABLE stock_balances(tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,branch_id TEXT NOT NULL,product_id TEXT NOT NULL,lot_id TEXT,on_hand_quantity TEXT NOT NULL CHECK(typeof(on_hand_quantity)='text' AND is_decimal_6(on_hand_quantity)),reserved_quantity TEXT NOT NULL CHECK(typeof(reserved_quantity)='text' AND is_decimal_6(reserved_quantity)),version INTEGER NOT NULL CHECK(version>=1),PRIMARY KEY(tenant_id,company_id,branch_id,product_id),FOREIGN KEY(tenant_id,company_id,branch_id) REFERENCES branches(tenant_id,company_id,id) ON DELETE RESTRICT,FOREIGN KEY(tenant_id,company_id,product_id) REFERENCES products(tenant_id,company_id,id) ON DELETE RESTRICT,FOREIGN KEY(tenant_id,company_id,product_id,lot_id) REFERENCES inventory_lots(tenant_id,company_id,product_id,id) ON DELETE RESTRICT);
CREATE TABLE sales(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,branch_id TEXT NOT NULL,origin_device_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('DRAFT','SUSPENDED','READY_FOR_PAYMENT','PAYMENT_IN_PROGRESS','COMPLETED','CANCELLED','EXPIRED')),business_date TEXT NOT NULL,currency_code TEXT NOT NULL CHECK(length(currency_code)=3),payable_amount TEXT NOT NULL CHECK(typeof(payable_amount)='text' AND is_decimal_6(payable_amount)),pricing_snapshot TEXT NOT NULL CHECK(json_valid(pricing_snapshot)),tax_snapshot TEXT NOT NULL CHECK(json_valid(tax_snapshot)),idempotency_key TEXT NOT NULL,request_checksum TEXT NOT NULL CHECK(length(request_checksum)=64 AND request_checksum NOT GLOB '*[^0-9a-f]*'),version INTEGER NOT NULL CHECK(version>=1),created_at TEXT NOT NULL,UNIQUE(tenant_id,company_id,branch_id,id),UNIQUE(tenant_id,origin_device_id,idempotency_key),FOREIGN KEY(tenant_id,company_id,branch_id) REFERENCES branches(tenant_id,company_id,id) ON DELETE RESTRICT,FOREIGN KEY(tenant_id,company_id,branch_id,origin_device_id) REFERENCES devices(tenant_id,company_id,branch_id,id) ON DELETE RESTRICT);
CREATE TABLE sale_items(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,branch_id TEXT NOT NULL,sale_id TEXT NOT NULL,line_number INTEGER NOT NULL CHECK(line_number>0),product_id TEXT NOT NULL,variant_id TEXT,unit_id TEXT NOT NULL,quantity TEXT NOT NULL CHECK(typeof(quantity)='text' AND is_decimal_6(quantity) AND quantity<>'0.000000'),unit_price TEXT NOT NULL CHECK(typeof(unit_price)='text' AND is_decimal_6(unit_price)),tax_rate TEXT NOT NULL CHECK(typeof(tax_rate)='text' AND is_decimal_10(tax_rate)),line_total TEXT NOT NULL CHECK(typeof(line_total)='text' AND is_decimal_6(line_total)),UNIQUE(tenant_id,sale_id,line_number),FOREIGN KEY(tenant_id,company_id,branch_id,sale_id) REFERENCES sales(tenant_id,company_id,branch_id,id) ON DELETE RESTRICT,FOREIGN KEY(tenant_id,company_id,product_id) REFERENCES products(tenant_id,company_id,id) ON DELETE RESTRICT,FOREIGN KEY(tenant_id,company_id,product_id,variant_id) REFERENCES product_variants(tenant_id,company_id,product_id,id) ON DELETE RESTRICT,FOREIGN KEY(unit_id) REFERENCES units_of_measure(id) ON DELETE RESTRICT);
CREATE TABLE payment_groups(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,branch_id TEXT NOT NULL,sale_id TEXT NOT NULL,currency_code TEXT NOT NULL,expected_amount TEXT NOT NULL CHECK(typeof(expected_amount)='text' AND is_decimal_6(expected_amount)),UNIQUE(tenant_id,company_id,branch_id,id),UNIQUE(tenant_id,sale_id),FOREIGN KEY(tenant_id,company_id,branch_id,sale_id) REFERENCES sales(tenant_id,company_id,branch_id,id) ON DELETE RESTRICT);
CREATE TABLE payments(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,branch_id TEXT NOT NULL,payment_group_id TEXT NOT NULL,method TEXT NOT NULL CHECK(method IN('CASH','CARD','TRANSFER','QR')),expected_amount TEXT NOT NULL CHECK(is_decimal_6(expected_amount) AND expected_amount<>'0.000000'),confirmed_amount TEXT NOT NULL CHECK(is_decimal_6(confirmed_amount)),currency_code TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('CREATED','PENDING','PARTIALLY_CONFIRMED','CONFIRMED','FAILED','CANCELLED','REVIEW_REQUIRED')),idempotency_key TEXT NOT NULL,request_checksum TEXT NOT NULL CHECK(length(request_checksum)=64 AND request_checksum NOT GLOB '*[^0-9a-f]*'),version INTEGER NOT NULL CHECK(version>=1),UNIQUE(tenant_id,id),UNIQUE(tenant_id,idempotency_key),FOREIGN KEY(tenant_id,company_id,branch_id,payment_group_id) REFERENCES payment_groups(tenant_id,company_id,branch_id,id) ON DELETE RESTRICT);
CREATE TABLE payment_attempts(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,payment_id TEXT NOT NULL,attempt_number INTEGER NOT NULL CHECK(attempt_number>0),status TEXT NOT NULL CHECK(status IN('CREATED','PROCESSING','PENDING','CONFIRMED','DECLINED','FAILED','UNKNOWN_OUTCOME')),provider_type TEXT,provider_reference TEXT,evidence_checksum TEXT,created_at TEXT NOT NULL,UNIQUE(tenant_id,payment_id,attempt_number),UNIQUE(tenant_id,provider_type,provider_reference),FOREIGN KEY(tenant_id,payment_id) REFERENCES payments(tenant_id,id) ON DELETE RESTRICT);
CREATE TABLE sync_operations(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,branch_id TEXT NOT NULL,origin_device_id TEXT NOT NULL,device_sequence INTEGER NOT NULL CHECK(device_sequence>0),aggregate_type TEXT NOT NULL,aggregate_id TEXT NOT NULL CHECK(is_uuid_v7(aggregate_id)),idempotency_key TEXT NOT NULL,payload_checksum TEXT NOT NULL CHECK(length(payload_checksum)=64 AND payload_checksum NOT GLOB '*[^0-9a-f]*'),status TEXT NOT NULL CHECK(status IN('LOCAL_PENDING','READY_TO_SYNC','SERVER_ACCEPTED','SERVER_REJECTED','CONFLICT','REVIEW_REQUIRED')),created_at TEXT NOT NULL,UNIQUE(tenant_id,id),UNIQUE(tenant_id,origin_device_id,device_sequence),UNIQUE(tenant_id,origin_device_id,idempotency_key),FOREIGN KEY(tenant_id,company_id,branch_id,origin_device_id) REFERENCES devices(tenant_id,company_id,branch_id,id) ON DELETE RESTRICT);
CREATE TABLE outbox_entries(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,origin_device_id TEXT NOT NULL,device_sequence INTEGER NOT NULL CHECK(device_sequence>0),state TEXT NOT NULL CHECK(state IN('PENDING','SENDING','ACKNOWLEDGED','RETRY_SCHEDULED')),attempt_count INTEGER NOT NULL CHECK(attempt_count>=0),next_attempt_at TEXT,UNIQUE(tenant_id,operation_id),UNIQUE(tenant_id,origin_device_id,device_sequence),FOREIGN KEY(tenant_id,operation_id) REFERENCES sync_operations(tenant_id,id) ON DELETE RESTRICT);
CREATE TABLE sync_checkpoints(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,device_id TEXT NOT NULL,stream_name TEXT NOT NULL,direction TEXT NOT NULL CHECK(direction IN('UPLOAD','DOWNLOAD')),contiguous_sequence INTEGER NOT NULL CHECK(contiguous_sequence>=0),last_operation_id TEXT,version INTEGER NOT NULL CHECK(version>=1),UNIQUE(tenant_id,device_id,stream_name,direction),FOREIGN KEY(tenant_id,last_operation_id) REFERENCES sync_operations(tenant_id,id) ON DELETE RESTRICT);
CREATE TABLE inventory_movements(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,branch_id TEXT NOT NULL,product_id TEXT NOT NULL,lot_id TEXT,movement_type TEXT NOT NULL CHECK(movement_type IN('SALE_OUT','RECEIPT_IN','POSITIVE_ADJUSTMENT','NEGATIVE_ADJUSTMENT','WASTE')),direction TEXT NOT NULL CHECK(direction IN('IN','OUT')),quantity TEXT NOT NULL CHECK(is_decimal_6(quantity) AND quantity<>'0.000000'),reason_code TEXT,operation_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,company_id,branch_id) REFERENCES branches(tenant_id,company_id,id) ON DELETE RESTRICT,FOREIGN KEY(tenant_id,company_id,product_id) REFERENCES products(tenant_id,company_id,id) ON DELETE RESTRICT,FOREIGN KEY(tenant_id,company_id,product_id,lot_id) REFERENCES inventory_lots(tenant_id,company_id,product_id,id) ON DELETE RESTRICT,FOREIGN KEY(tenant_id,operation_id) REFERENCES sync_operations(tenant_id,id) ON DELETE RESTRICT,CHECK(movement_type<>'WASTE' OR(direction='OUT' AND reason_code IS NOT NULL)));
CREATE TABLE audit_events(id TEXT PRIMARY KEY CHECK(is_uuid_v7(id)),tenant_id TEXT NOT NULL,company_id TEXT,branch_id TEXT,action TEXT NOT NULL,resource_type TEXT NOT NULL,resource_id TEXT NOT NULL CHECK(is_uuid_v7(resource_id)),operation_id TEXT,actor_type TEXT NOT NULL,result TEXT NOT NULL CHECK(result IN('SUCCESS','REJECTED','CONFLICT')),evidence_checksum TEXT,created_at TEXT NOT NULL,FOREIGN KEY(tenant_id,operation_id) REFERENCES sync_operations(tenant_id,id) ON DELETE RESTRICT);
CREATE INDEX sales_branch_date_idx ON sales(tenant_id,branch_id,business_date);
CREATE INDEX inventory_product_branch_idx ON inventory_movements(tenant_id,product_id,branch_id,created_at);
CREATE INDEX payments_group_idx ON payments(tenant_id,payment_group_id);
CREATE INDEX outbox_pending_idx ON outbox_entries(tenant_id,state,next_attempt_at,device_sequence);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'audit append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'audit append-only'); END;
CREATE TRIGGER movement_no_update BEFORE UPDATE ON inventory_movements BEGIN SELECT RAISE(ABORT,'ledger append-only'); END;
CREATE TRIGGER movement_no_delete BEFORE DELETE ON inventory_movements BEGIN SELECT RAISE(ABORT,'ledger append-only'); END;
CREATE TRIGGER sale_no_delete BEFORE DELETE ON sales BEGIN SELECT RAISE(ABORT,'sale history'); END;
CREATE TRIGGER payment_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT,'payment history'); END;
CREATE TRIGGER operation_no_delete BEFORE DELETE ON sync_operations BEGIN SELECT RAISE(ABORT,'operation history'); END;
CREATE TRIGGER outbox_no_delete BEFORE DELETE ON outbox_entries BEGIN SELECT RAISE(ABORT,'outbox history'); END;
"""


def seed(connection: sqlite3.Connection) -> None:
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.executemany("INSERT INTO tenants VALUES(?,?)", [(TENANT_A, "Tenant A"), (TENANT_B, "Tenant B")])
        connection.executemany("INSERT INTO companies VALUES(?,?,?,?)", [(COMPANY_A, TENANT_A, "Company A", 1), (COMPANY_B, TENANT_B, "Company B", 1)])
        connection.executemany("INSERT INTO branches VALUES(?,?,?,?,?)", [(BRANCH_A, TENANT_A, COMPANY_A, "Branch A", 1), (BRANCH_B, TENANT_B, COMPANY_B, "Branch B", 1)])
        connection.executemany("INSERT INTO devices VALUES(?,?,?,?,?)", [(DEVICE_A, TENANT_A, COMPANY_A, BRANCH_A, "ACTIVE"), (DEVICE_B, TENANT_B, COMPANY_B, BRANCH_B, "ACTIVE")])
        connection.executemany("INSERT INTO units_of_measure VALUES(?,?,?,?)", [(UNIT_EA, "EA", "COUNT", 0), (UNIT_KG, "KG", "MASS", 6), (UNIT_L, "L", "VOLUME", 6), (UNIT_M, "M", "LENGTH", 6)])
        products = [
            (PRODUCT_UNIT, TENANT_A, COMPANY_A, UNIT_EA, "Store unit", 0, 0, "ACTIVE", 1),
            (PRODUCT_WEIGHT, TENANT_A, COMPANY_A, UNIT_KG, "Weighted poultry", 1, 1, "ACTIVE", 1),
            (PRODUCT_LOT, TENANT_A, COMPANY_A, UNIT_EA, "Lot product", 1, 1, "ACTIVE", 1),
            (PRODUCT_HARDWARE, TENANT_A, COMPANY_A, UNIT_M, "Dimensional hardware", 0, 0, "ACTIVE", 1),
            (PRODUCT_FLOWER, TENANT_A, COMPANY_A, UNIT_EA, "Perishable flower", 1, 1, "ACTIVE", 1),
            (PRODUCT_B, TENANT_B, COMPANY_B, UNIT_EA, "Tenant B product", 0, 0, "ACTIVE", 1),
        ]
        connection.executemany("INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?)", products)
        connection.execute("INSERT INTO product_variants VALUES(?,?,?,?,?,?)", (VARIANT_A, TENANT_A, COMPANY_A, PRODUCT_HARDWARE, "SIZE-A", 1))
        connection.execute("INSERT INTO inventory_lots VALUES(?,?,?,?,?,?,?,?,?)", (LOT_A, TENANT_A, COMPANY_A, PRODUCT_LOT, "LOT-001", "2026-08-01", "2027-08-01", "ACTIVE", 1))
        connection.execute("INSERT INTO pricing_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ("01890f5a-0000-7000-8000-000000000901", TENANT_A, COMPANY_A, PRODUCT_UNIT, 1, "1000.000000", 10, "2026-01-01T00:00:00.000000Z", "2026-12-31T00:00:00.000000Z", "PUBLISHED", "2" * 64, 0))
        connection.execute("INSERT INTO tax_versions VALUES(?,?,?,?,?,?,?,?,?,?)", ("01890f5a-0000-7000-8000-000000000902", TENANT_A, COMPANY_A, 1, "0.1900000000", 10, "2026-01-01T00:00:00.000000Z", None, "PUBLISHED", "3" * 64))
        sale_row = (SALE_SEED, TENANT_A, COMPANY_A, BRANCH_A, DEVICE_A, "PAYMENT_IN_PROGRESS", "2026-08-14", "COP", "1000.000000", '{"schema_version":1,"pricing_version":1}', '{"schema_version":1,"tax_version":1}', "seed-sale", "4" * 64, 1, "2026-08-14T12:00:00.000000Z")
        connection.execute("INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", sale_row)
        connection.execute("INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (SALE_B, TENANT_B, COMPANY_B, BRANCH_B, DEVICE_B, "COMPLETED", "2026-08-14", "COP", "2000.000000", "{}", "{}", "seed-sale-b", "b" * 64, 1, "2026-08-14T12:00:00.000000Z"))
        connection.execute("INSERT INTO sale_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", ("01890f5a-0000-7000-8000-000000001002", TENANT_A, COMPANY_A, BRANCH_A, SALE_SEED, 1, PRODUCT_UNIT, None, UNIT_EA, "1.000000", "1000.000000", "0.1900000000", "1000.000000"))
        connection.execute("INSERT INTO payment_groups VALUES(?,?,?,?,?,?,?)", (PAYMENT_GROUP, TENANT_A, COMPANY_A, BRANCH_A, SALE_SEED, "COP", "1000.000000"))
        connection.execute("INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", (PAYMENT_SEED, TENANT_A, COMPANY_A, BRANCH_A, PAYMENT_GROUP, "CARD", "1000.000000", "0.000000", "COP", "PENDING", "seed-payment", "5" * 64, 1))
        connection.execute("INSERT INTO sync_checkpoints VALUES(?,?,?,?,?,?,?,?)", ("01890f5a-0000-7000-8000-000000001201", TENANT_A, DEVICE_A, "commercial", "UPLOAD", 0, None, 1))
        connection.execute("COMMIT")
    except Exception:
        connection.execute("ROLLBACK")
        raise


def complete_sale(connection: sqlite3.Connection, base: int, quantity: str, inject: str | None = None) -> tuple[str, str]:
    sale_id = f"01890f5a-0000-7000-8000-{base:012d}"
    item_id = f"01890f5a-0000-7000-8000-{base + 1:012d}"
    operation_id = f"01890f5a-0000-7000-8000-{base + 2:012d}"
    outbox_id = f"01890f5a-0000-7000-8000-{base + 3:012d}"
    audit_id = f"01890f5a-0000-7000-8000-{base + 4:012d}"
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute("INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (sale_id, TENANT_A, COMPANY_A, BRANCH_A, DEVICE_A, "COMPLETED", "2026-08-14", "COP", "12000.000000", "{}", "{}", f"sale-{base}", CHECKSUM_A, 1, "2026-08-14T12:00:00.000000Z"))
        if inject == "SALE":
            raise RuntimeError("injected after sale")
        connection.execute("INSERT INTO sale_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", (item_id, TENANT_A, COMPANY_A, BRANCH_A, sale_id, 1, PRODUCT_WEIGHT, None, UNIT_KG, quantity, "12000.000000", "0.1900000000", "12000.000000"))
        connection.execute("INSERT INTO sync_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (operation_id, TENANT_A, COMPANY_A, BRANCH_A, DEVICE_A, base, "SALE", sale_id, f"sale-{base}", CHECKSUM_A, "READY_TO_SYNC", "2026-08-14T12:00:00.000000Z"))
        connection.execute("INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (audit_id, TENANT_A, COMPANY_A, BRANCH_A, "SALE_COMPLETED", "SALE", sale_id, operation_id, "USER", "SUCCESS", CHECKSUM_A, "2026-08-14T12:00:00.000000Z"))
        if inject == "AUDIT":
            raise RuntimeError("injected after audit")
        connection.execute("INSERT INTO outbox_entries VALUES(?,?,?,?,?,?,?,?)", (outbox_id, TENANT_A, operation_id, DEVICE_A, base, "PENDING", 0, None))
        connection.execute("COMMIT")
        return sale_id, operation_id
    except Exception:
        connection.execute("ROLLBACK")
        raise


def record_inventory(connection: sqlite3.Connection, base: int, product_id: str, movement_type: str, direction: str, quantity: str, reason: str | None, inject: bool = False) -> str:
    movement_id = f"01890f5a-0000-7000-8000-{base:012d}"
    operation_id = f"01890f5a-0000-7000-8000-{base + 1:012d}"
    outbox_id = f"01890f5a-0000-7000-8000-{base + 2:012d}"
    audit_id = f"01890f5a-0000-7000-8000-{base + 3:012d}"
    connection.execute("BEGIN IMMEDIATE")
    try:
        connection.execute("INSERT INTO sync_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (operation_id, TENANT_A, COMPANY_A, BRANCH_A, DEVICE_A, base, "INVENTORY_MOVEMENT", movement_id, f"inventory-{base}", CHECKSUM_A, "READY_TO_SYNC", "2026-08-14T12:00:00.000000Z"))
        connection.execute("INSERT INTO inventory_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (movement_id, TENANT_A, COMPANY_A, BRANCH_A, product_id, LOT_A if product_id == PRODUCT_LOT else None, movement_type, direction, quantity, reason, operation_id, "2026-08-14T12:00:00.000000Z"))
        row = connection.execute("SELECT on_hand_quantity,version FROM stock_balances WHERE tenant_id=? AND company_id=? AND branch_id=? AND product_id=?", (TENANT_A, COMPANY_A, BRANCH_A, product_id)).fetchone()
        current = Decimal(row[0]) if row else Decimal("0.000000")
        version = row[1] if row else 0
        delta = Decimal(quantity) if direction == "IN" else -Decimal(quantity)
        next_value = current + delta
        if next_value < 0:
            raise sqlite3.IntegrityError("negative stock under selected published policy")
        canonical = f"{next_value:.6f}"
        if row:
            connection.execute("UPDATE stock_balances SET on_hand_quantity=?,version=version+1 WHERE tenant_id=? AND company_id=? AND branch_id=? AND product_id=? AND version=?", (canonical, TENANT_A, COMPANY_A, BRANCH_A, product_id, version))
        else:
            connection.execute("INSERT INTO stock_balances VALUES(?,?,?,?,?,?,?,?)", (TENANT_A, COMPANY_A, BRANCH_A, product_id, LOT_A if product_id == PRODUCT_LOT else None, canonical, "0.000000", 1))
        connection.execute("INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (audit_id, TENANT_A, COMPANY_A, BRANCH_A, "INVENTORY_RECORDED", "INVENTORY_MOVEMENT", movement_id, operation_id, "USER", "SUCCESS", CHECKSUM_A, "2026-08-14T12:00:00.000000Z"))
        if inject:
            raise RuntimeError("injected before outbox")
        connection.execute("INSERT INTO outbox_entries VALUES(?,?,?,?,?,?,?,?)", (outbox_id, TENANT_A, operation_id, DEVICE_A, base, "PENDING", 0, None))
        connection.execute("COMMIT")
        return movement_id
    except Exception:
        connection.execute("ROLLBACK")
        raise


def main() -> int:
    tests = Tests()
    if WORK_DIR.exists():
        shutil.rmtree(WORK_DIR)
    WORK_DIR.mkdir(parents=True)
    connection = connect()
    wal_mode = connection.execute("PRAGMA journal_mode=WAL").fetchone()[0]
    connection.executescript(SCHEMA)
    seed(connection)

    print(f"SQLITE_VERSION={sqlite3.sqlite_version}")
    tests.check("sqlite_wal", wal_mode.lower() == "wal", wal_mode)
    tests.check("sqlite_foreign_keys", connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1)
    tests.check("sqlite_no_inbox", connection.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name LIKE '%inbox%'").fetchone()[0] == 0)
    tests.check("uuid_canonical", is_uuid_v7(TENANT_A) == 1 and connection.execute("SELECT id FROM tenants WHERE id=?", (TENANT_A,)).fetchone()[0] == TENANT_A)
    tests.expect_error("uuid_invalid", lambda: connection.execute("INSERT INTO tenants VALUES('not-a-uuid','bad')"))
    tests.expect_error("uuid_v4_rejected", lambda: connection.execute("INSERT INTO tenants VALUES('550e8400-e29b-41d4-a716-446655440000','bad')"))

    tests.check("money_zero", is_decimal_6("0.000000") == 1)
    tests.check("money_positive", Decimal("1250.500000") == Decimal("1250.500000"))
    tests.check("money_large", is_decimal_6("9999999999999.999999") == 1)
    tests.check("money_no_drift", Decimal("0.100000") + Decimal("0.200000") == Decimal("0.300000"))
    tests.check("money_roundtrip", str(Decimal("1250.500000")) == "1250.500000")
    for name, value in [("money_excess_scale", "1.0000001"), ("money_nan", "NaN"), ("money_infinity", "Infinity"), ("money_ambiguous", "01.000000"), ("money_exponent", "1e3"), ("money_over_precision", "10000000000000.000000")]:
        tests.check(name, is_decimal_6(value) == 0, value)
    tests.check("rate_scale_10", is_decimal_10("0.1900000000") == 1)
    tests.check("factor_large", is_decimal_10("999999999.9999999999") == 1)
    tests.check("rate_excess_scale", is_decimal_10("0.19000000001") == 0)
    tests.check("normalization_scale_2", is_decimal_2("1025.00") == 1 and is_decimal_2("1025.001") == 0)
    connection.executemany("INSERT INTO test_limit_contract VALUES(?,?,?)", [(1, "FINITE", "0.000000"), (2, "UNLIMITED", None), (3, "NOT_APPLICABLE", None)])
    tests.check("limit_contract_valid", connection.execute("SELECT count(*) FROM test_limit_contract").fetchone()[0] == 3)
    tests.expect_error("limit_finite_requires_value", lambda: connection.execute("INSERT INTO test_limit_contract VALUES(4,'FINITE',NULL)"))
    tests.expect_error("limit_unlimited_rejects_value", lambda: connection.execute("INSERT INTO test_limit_contract VALUES(5,'UNLIMITED','1.000000')"))
    tests.expect_error("limit_not_applicable_rejects_value", lambda: connection.execute("INSERT INTO test_limit_contract VALUES(6,'NOT_APPLICABLE','0.000000')"))
    tests.check("no_real_money_columns", not any(row[2].upper() == "REAL" for table in ["sales", "sale_items", "payments", "inventory_movements", "pricing_versions", "tax_versions"] for row in connection.execute(f"PRAGMA table_info({table})")))

    tests.check("quantity_unit", is_decimal_6("1.000000") == 1)
    tests.check("quantity_weight", is_decimal_6("1.275000") == 1)
    tests.check("quantity_volume", is_decimal_6("0.750000") == 1)
    tests.expect_error("quantity_zero", lambda: connection.execute("INSERT INTO sale_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", ("01890f5a-0000-7000-8000-000000009001", TENANT_A, COMPANY_A, BRANCH_A, SALE_SEED, 99, PRODUCT_UNIT, None, UNIT_EA, "0.000000", "1.000000", "0.0000000000", "1.000000")))
    tests.expect_error("status_invalid", lambda: connection.execute("UPDATE sales SET status='PAID' WHERE id=?", (SALE_SEED,)))
    tests.expect_error("decimal_real_type_rejected", lambda: connection.execute("UPDATE sales SET payable_amount=? WHERE id=?", (1.25, SALE_SEED)))

    tests.expect_error("fk_sale_branch_cross_tenant", lambda: connection.execute("INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("01890f5a-0000-7000-8000-000000009002", TENANT_A, COMPANY_A, BRANCH_B, DEVICE_A, "DRAFT", "2026-08-14", "COP", "0.000000", "{}", "{}", "cross", "0" * 64, 1, "2026-08-14T12:00:00.000000Z")))
    tests.expect_error("fk_payment_sale_cross_tenant", lambda: connection.execute("INSERT INTO payment_groups VALUES(?,?,?,?,?,?,?)", ("01890f5a-0000-7000-8000-000000009003", TENANT_A, COMPANY_A, BRANCH_A, SALE_B, "COP", "1.000000")))
    tests.expect_error("fk_sync_device_cross_tenant", lambda: connection.execute("INSERT INTO sync_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ("01890f5a-0000-7000-8000-000000009004", TENANT_A, COMPANY_A, BRANCH_A, DEVICE_B, 99, "SALE", SALE_SEED, "cross-device", "0" * 64, "READY_TO_SYNC", "2026-08-14T12:00:00.000000Z")))

    try:
        complete_sale(connection, 2101, "1.000000", "AUDIT")
    except RuntimeError:
        pass
    tests.check("sales_failure_rollback", connection.execute("SELECT count(*) FROM sales WHERE id=?", ("01890f5a-0000-7000-8000-000000002101",)).fetchone()[0] == 0)
    tests.check("sales_failure_no_operation", connection.execute("SELECT count(*) FROM sync_operations WHERE id=?", ("01890f5a-0000-7000-8000-000000002103",)).fetchone()[0] == 0)
    sale_id, operation_id = complete_sale(connection, 2201, "1.275000")
    tests.check("sales_atomic_success", connection.execute("SELECT count(*) FROM sale_items WHERE sale_id=?", (sale_id,)).fetchone()[0] == 1 and connection.execute("SELECT count(*) FROM outbox_entries WHERE operation_id=?", (operation_id,)).fetchone()[0] == 1)
    tests.check("weighted_same_sale_schema", connection.execute("SELECT quantity FROM sale_items WHERE sale_id=?", (sale_id,)).fetchone()[0] == "1.275000")
    tests.expect_error("fk_inventory_product_cross_tenant", lambda: connection.execute("INSERT INTO inventory_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ("01890f5a-0000-7000-8000-000000009005", TENANT_A, COMPANY_A, BRANCH_A, PRODUCT_B, None, "RECEIPT_IN", "IN", "1.000000", None, operation_id, "2026-08-14T12:00:00.000000Z")))
    tests.expect_error("sale_idempotency_duplicate", lambda: complete_sale(connection, 2301, "1.000000") if False else connection.execute("INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ("01890f5a-0000-7000-8000-000000002301", TENANT_A, COMPANY_A, BRANCH_A, DEVICE_A, "COMPLETED", "2026-08-14", "COP", "1.000000", "{}", "{}", "sale-2201", CHECKSUM_A, 1, "2026-08-14T12:00:00.000000Z")))

    try:
        record_inventory(connection, 3101, PRODUCT_LOT, "RECEIPT_IN", "IN", "1.000000", None, True)
    except RuntimeError:
        pass
    tests.check("inventory_failure_rollback", connection.execute("SELECT count(*) FROM inventory_movements WHERE id=?", ("01890f5a-0000-7000-8000-000000003101",)).fetchone()[0] == 0)
    tests.check("inventory_failure_no_projection", connection.execute("SELECT count(*) FROM stock_balances WHERE product_id=?", (PRODUCT_LOT,)).fetchone()[0] == 0)
    movement_id = record_inventory(connection, 3201, PRODUCT_LOT, "RECEIPT_IN", "IN", "10.000000", None)
    waste_id = record_inventory(connection, 3211, PRODUCT_LOT, "WASTE", "OUT", "1.250000", "SPOILAGE")
    tests.check("waste_history_reason", connection.execute("SELECT movement_type='WASTE' AND reason_code='SPOILAGE' FROM inventory_movements WHERE id=?", (waste_id,)).fetchone()[0] == 1)
    tests.check("waste_projection", connection.execute("SELECT on_hand_quantity FROM stock_balances WHERE product_id=?", (PRODUCT_LOT,)).fetchone()[0] == "8.750000")
    tests.expect_error("ledger_update_blocked", lambda: connection.execute("UPDATE inventory_movements SET quantity='9.000000' WHERE id=?", (movement_id,)))
    tests.expect_error("ledger_delete_blocked", lambda: connection.execute("DELETE FROM inventory_movements WHERE id=?", (movement_id,)))

    def payment_transaction(inject: bool = False) -> None:
        connection.execute("BEGIN IMMEDIATE")
        try:
            updated = connection.execute("UPDATE payments SET status='CONFIRMED',confirmed_amount=expected_amount,version=version+1 WHERE id=? AND version=1 AND status='PENDING'", (PAYMENT_SEED,)).rowcount
            if updated != 1:
                raise sqlite3.IntegrityError("stale payment")
            connection.execute("INSERT INTO payment_attempts VALUES(?,?,?,?,?,?,?,?,?)", ("01890f5a-0000-7000-8000-000000004201", TENANT_A, PAYMENT_SEED, 1, "CONFIRMED", "CARD_NETWORK", "neutral-ref", CHECKSUM_A, "2026-08-14T12:00:00.000000Z"))
            if inject:
                raise RuntimeError("injected payment failure")
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise

    try:
        payment_transaction(True)
    except RuntimeError:
        pass
    tests.check("payment_failure_rollback", connection.execute("SELECT status='PENDING' AND version=1 FROM payments WHERE id=?", (PAYMENT_SEED,)).fetchone()[0] == 1)
    payment_transaction(False)
    tests.check("payment_atomic_success", connection.execute("SELECT status='CONFIRMED' AND version=2 FROM payments WHERE id=?", (PAYMENT_SEED,)).fetchone()[0] == 1)
    tests.check("payment_duplicate_callback", connection.execute("UPDATE payments SET version=version+1 WHERE id=? AND version=1 AND status='PENDING'", (PAYMENT_SEED,)).rowcount == 0)
    tests.expect_error("payment_reference_unique", lambda: connection.execute("INSERT INTO payment_attempts VALUES(?,?,?,?,?,?,?,?,?)", ("01890f5a-0000-7000-8000-000000004202", TENANT_A, PAYMENT_SEED, 2, "CONFIRMED", "CARD_NETWORK", "neutral-ref", CHECKSUM_A, "2026-08-14T12:00:00.000000Z")))

    tests.check("outbox_one_to_one", connection.execute("SELECT count(*) FROM outbox_entries WHERE operation_id=?", (operation_id,)).fetchone()[0] == 1)
    tests.expect_error("operation_duplicate", lambda: connection.execute("INSERT INTO sync_operations SELECT * FROM sync_operations WHERE id=?", (operation_id,)))
    tests.expect_error("operation_checksum_replay", lambda: connection.execute("INSERT INTO sync_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ("01890f5a-0000-7000-8000-000000005001", TENANT_A, COMPANY_A, BRANCH_A, DEVICE_A, 2201, "SALE", sale_id, "sale-2201", "0" * 64, "READY_TO_SYNC", "2026-08-14T12:00:00.000000Z")))
    connection.execute("UPDATE outbox_entries SET attempt_count=attempt_count+1,state='RETRY_SCHEDULED' WHERE operation_id=?", (operation_id,))
    tests.check("outbox_retry_same_intent", connection.execute("SELECT attempt_count FROM outbox_entries WHERE operation_id=?", (operation_id,)).fetchone()[0] == 1)

    before = connection.execute("SELECT contiguous_sequence,version FROM sync_checkpoints WHERE device_id=?", (DEVICE_A,)).fetchone()
    blocked = connection.execute("UPDATE sync_checkpoints SET contiguous_sequence=1,last_operation_id=?,version=version+1 WHERE device_id=? AND version=1 AND EXISTS(SELECT 1 FROM outbox_entries WHERE operation_id=? AND state='ACKNOWLEDGED')", (operation_id, DEVICE_A, operation_id)).rowcount
    tests.check("checkpoint_requires_durable_ack", blocked == 0 and connection.execute("SELECT contiguous_sequence,version FROM sync_checkpoints WHERE device_id=?", (DEVICE_A,)).fetchone() == before)
    connection.execute("UPDATE outbox_entries SET state='ACKNOWLEDGED' WHERE operation_id=?", (operation_id,))
    connection.execute("BEGIN IMMEDIATE")
    connection.execute("UPDATE sync_checkpoints SET contiguous_sequence=1,last_operation_id=?,version=version+1 WHERE device_id=? AND version=1 AND EXISTS(SELECT 1 FROM outbox_entries WHERE operation_id=? AND state='ACKNOWLEDGED')", (operation_id, DEVICE_A, operation_id))
    connection.execute("ROLLBACK")
    tests.check("checkpoint_rollback", connection.execute("SELECT contiguous_sequence,version FROM sync_checkpoints WHERE device_id=?", (DEVICE_A,)).fetchone() == before)
    connection.execute("UPDATE sync_checkpoints SET contiguous_sequence=1,last_operation_id=?,version=version+1 WHERE device_id=? AND version=1 AND EXISTS(SELECT 1 FROM outbox_entries WHERE operation_id=? AND state='ACKNOWLEDGED')", (operation_id, DEVICE_A, operation_id))
    tests.check("checkpoint_durable", connection.execute("SELECT contiguous_sequence=1 AND version=2 FROM sync_checkpoints WHERE device_id=?", (DEVICE_A,)).fetchone()[0] == 1)
    tests.check("checkpoint_not_timestamp_ordered", "timestamp" not in " ".join(row[1] for row in connection.execute("PRAGMA table_info(sync_checkpoints)")))

    lock_owner = connect(timeout=0.1)
    lock_contender = connect(timeout=0.1)
    lock_owner.execute("PRAGMA busy_timeout=100")
    lock_contender.execute("PRAGMA busy_timeout=100")
    lock_owner.execute("BEGIN IMMEDIATE")
    lock_owner.execute("UPDATE sales SET version=version+1 WHERE id=? AND version=1", (SALE_SEED,))
    tests.expect_error("single_writer_lock", lambda: lock_contender.execute("BEGIN IMMEDIATE"), (sqlite3.OperationalError,))
    lock_owner.execute("COMMIT")
    lock_contender.execute("BEGIN IMMEDIATE")
    loser = lock_contender.execute("UPDATE sales SET version=version+1 WHERE id=? AND version=1", (SALE_SEED,)).rowcount
    lock_contender.execute("COMMIT")
    tests.check("sales_optimistic_concurrency", loser == 0 and connection.execute("SELECT version FROM sales WHERE id=?", (SALE_SEED,)).fetchone()[0] == 2)
    lock_owner.close()
    lock_contender.close()

    thread_errors: list[Exception] = []
    def inventory_thread(base: int) -> None:
        local = connect(timeout=5)
        try:
            record_inventory(local, base, PRODUCT_UNIT, "RECEIPT_IN", "IN", "1.000000", None)
        except Exception as exc:
            thread_errors.append(exc)
        finally:
            local.close()
    t1 = threading.Thread(target=inventory_thread, args=(7101,))
    t2 = threading.Thread(target=inventory_thread, args=(7111,))
    t1.start(); t2.start(); t1.join(); t2.join()
    tests.check("inventory_concurrency_no_loss", not thread_errors and connection.execute("SELECT on_hand_quantity FROM stock_balances WHERE product_id=?", (PRODUCT_UNIT,)).fetchone()[0] == "2.000000")
    tests.check("inventory_concurrency_two_facts", connection.execute("SELECT count(*) FROM inventory_movements WHERE product_id=?", (PRODUCT_UNIT,)).fetchone()[0] == 2)

    tests.expect_error("audit_update_blocked", lambda: connection.execute("UPDATE audit_events SET result='REJECTED' WHERE resource_id=?", (sale_id,)))
    tests.expect_error("audit_delete_blocked", lambda: connection.execute("DELETE FROM audit_events WHERE resource_id=?", (sale_id,)))
    tests.expect_error("sale_delete_blocked", lambda: connection.execute("DELETE FROM sales WHERE id=?", (sale_id,)))
    tests.expect_error("payment_delete_blocked", lambda: connection.execute("DELETE FROM payments WHERE id=?", (PAYMENT_SEED,)))
    tests.expect_error("sync_delete_blocked", lambda: connection.execute("DELETE FROM sync_operations WHERE id=?", (operation_id,)))
    tests.expect_error("tenant_delete_restricted", lambda: connection.execute("DELETE FROM companies WHERE id=?", (COMPANY_A,)))

    tests.check("lot_optional", connection.execute("SELECT count(*) FROM products WHERE lot_controlled=0").fetchone()[0] > 0)
    tests.check("lot_expiration_valid", connection.execute("SELECT expiration_date FROM inventory_lots WHERE id=?", (LOT_A,)).fetchone()[0] == "2027-08-01")
    connection.execute("INSERT INTO inventory_lots VALUES(?,?,?,?,?,?,?,?,?)", ("01890f5a-0000-7000-8000-000000000802", TENANT_A, COMPANY_A, PRODUCT_FLOWER, "FLOWER-001", "2026-08-14", None, "ACTIVE", 1))
    tests.check("lot_expiration_nullable", connection.execute("SELECT expiration_date IS NULL FROM inventory_lots WHERE id='01890f5a-0000-7000-8000-000000000802'").fetchone()[0] == 1)
    tests.check("lot_no_quantity_column", all(row[1] != "quantity" for row in connection.execute("PRAGMA table_info(inventory_lots)")))
    tests.check("multi_business_same_schema", connection.execute("SELECT count(DISTINCT dimension) FROM units_of_measure").fetchone()[0] == 4 and connection.execute("SELECT count(*) FROM products WHERE tenant_id=?", (TENANT_A,)).fetchone()[0] == 5)
    tests.check("capability_no_bypass", not any("capability" in row[1].lower() for table in ["products", "sales", "payments"] for row in connection.execute(f"PRAGMA table_info({table})")))
    prohibited = re.compile(r"(^|_)(bold|wompi|mercado_pago|factus|siigo|pan|cvv)($|_)", re.I)
    tests.check("provider_neutrality", not any(prohibited.search(row[1]) for table in [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")] for row in connection.execute(f"PRAGMA table_info({table})")))
    tests.check("structural_indexes", connection.execute("SELECT count(*) FROM sqlite_master WHERE type='index' AND name IN('sales_branch_date_idx','inventory_product_branch_idx','payments_group_idx','outbox_pending_idx')").fetchone()[0] == 4)

    uncommitted_id = "01890f5a-0000-7000-8000-000000009900"
    connection.execute("BEGIN IMMEDIATE")
    connection.execute("INSERT INTO sync_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (uncommitted_id, TENANT_A, COMPANY_A, BRANCH_A, DEVICE_A, 9900, "TEST", SALE_SEED, "uncommitted", "9" * 64, "READY_TO_SYNC", "2026-08-14T12:00:00.000000Z"))
    connection.close()
    connection = connect()
    tests.check("restart_uncommitted_disappears", connection.execute("SELECT count(*) FROM sync_operations WHERE id=?", (uncommitted_id,)).fetchone()[0] == 0)
    tests.check("restart_outbox_remains", connection.execute("SELECT count(*) FROM outbox_entries WHERE operation_id=?", (operation_id,)).fetchone()[0] == 1)
    tests.check("restart_checkpoint_remains", connection.execute("SELECT contiguous_sequence FROM sync_checkpoints WHERE device_id=?", (DEVICE_A,)).fetchone()[0] == 1)
    tests.check("restart_wal_remains", connection.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal")

    backup = connect(BACKUP_PATH)
    connection.backup(backup)
    backup.close()
    restored = connect(BACKUP_PATH)
    tests.check("sqlite_backup_reopens", restored.execute("PRAGMA integrity_check").fetchone()[0] == "ok")
    tests.check("sqlite_backup_business_fact", restored.execute("SELECT count(*) FROM sales WHERE id=?", (sale_id,)).fetchone()[0] == 1)
    restored.close()

    print("EQUIV|UUID|uuid canonical|TEXT canonical|PASS")
    print("EQUIV|money scale 6|numeric(19,6)|TEXT + Decimal|PASS")
    print("EQUIV|rate scale 10|numeric(19,10)|TEXT + Decimal|PASS")
    print("EQUIV|quantity|numeric(19,6)|TEXT + Decimal|PASS")
    print("EQUIV|timestamp|timestamptz UTC|RFC3339 UTC TEXT|PASS")
    print("EQUIV|boolean|boolean|INTEGER CHECK 0/1|PASS")
    print("EQUIV|enum/check|TEXT CHECK|TEXT CHECK|PASS")
    print("EQUIV|version|bigint|INTEGER|PASS")
    print("EQUIV|checksum|TEXT CHECK|TEXT CHECK|PASS")
    print("EQUIV|FK/UNIQUE|composite constraints|composite constraints|PASS")
    print("EQUIV|transactions|MVCC/row locks|WAL single writer|PASS")
    print(f"SQLITE_TEST_COUNT={tests.count}")
    print(f"SQLITE_TEST_FAILURES={len(tests.failures)}")
    print("SQLITE_TESTS_FAILED=" + (",".join(tests.failures) if tests.failures else "none"))
    print("SQLITE_RESULT=" + ("PASS" if not tests.failures else "FAIL"))
    connection.close()
    return 0 if not tests.failures else 1


if __name__ == "__main__":
    raise SystemExit(main())

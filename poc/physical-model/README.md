# TECH-002 R3 physical model PoC

Disposable and reproducible validation of the approved PostgreSQL 16 and SQLite/WAL physical patterns. It is not product DDL, a migration, an application repository, an API, or authorization to start the first migration.

## Scope

The PoC materializes only the minimum cross-domain subset needed to exercise:

- Tenant, Company, Branch, Device and AuditEvent;
- UnitOfMeasure, Product and ProductVariant;
- InventoryLot, InventoryMovement and StockBalance;
- Sale and SaleItem;
- PaymentGroup, Payment and PaymentAttempt;
- SyncOperation, OutboxEntry, central InboxEntry and SyncCheckpoint;
- minimal published Pricing and Tax versions and immutable sale snapshots.

The transaction-oriented SQL functions in the `poc` schema are test harnesses for approved transaction boundaries. They do not select stored procedures as the product architecture. No provider, capability code, real credential, customer data, fiscal regulation, or external-source table is included. `test_limit_contract` is likewise a harness table for the R1 finite/unlimited/not-applicable invariant, not a product licensing table.

## Prerequisites and isolation

- Docker Engine with Compose and access to the pinned PostgreSQL 16 image;
- Python 3.11+ with the standard-library `sqlite3` module;
- Git.

PostgreSQL has no published host port, uses an internal Compose network and stores data in tmpfs. The runner creates an ephemeral password in memory and never writes it to evidence. SQLite databases are synthetic disposable files under `work/` and run with WAL plus `foreign_keys=ON`.

## Run

From the repository root:

```powershell
python poc/physical-model/scripts/run.py
```

The command validates Compose syntax, executes PostgreSQL and SQLite suites, runs concurrency/failure/restart/backup checks, and writes `results/evidence.txt` plus `results/summary.md`.

Cleanup:

```powershell
python poc/physical-model/scripts/cleanup.py
```

## Interpretation

R3 may be reported `PASS` only when evidence ends with `R3_RESULT=PASS`, both dialect suites report zero failures, PostgreSQL is version 16, WAL/restart and backup/restore pass, and the executed equivalence matrix has no critical semantic break.

Evidence is partial for `SEC-G01`, `SEC-G05`, `SEC-G06`, `SEC-G08` and `SEC-G09`. It does not change any `SEC-Gxx` state. A checksum detects mismatch and deduplicates; it is not authenticity against an attacker controlling SQLite.

PostgreSQL `numeric(19,6)` and `numeric(19,10)` normalize input to their declared scale before a row constraint can inspect the original lexical representation. Therefore the PoC explicitly tests `poc_decimal_6(text)` and `poc_decimal_10(text)` as boundary validators before casting. This follows `physical-conventions.md`: future adapters/server validation remain mandatory, and direct unvalidated client input must never become authoritative SQL parameters.

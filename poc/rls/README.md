# PostgreSQL 16 RLS PoC (`PHY-G14`)

## Purpose

Disposable proof that PostgreSQL 16 can enforce tenant isolation with transaction-scoped context, `WITH CHECK`, composite tenant-aware foreign keys, `FORCE ROW LEVEL SECURITY`, separated runtime roles and an explicit global administration path.

This is not product DDL, a migration, a repository implementation or production security evidence. It uses synthetic UUIDs and no real credentials or data.

## Prerequisites

- Docker Engine with Compose;
- a Linux shell with `bash` and `openssl` (WSL2 is supported);
- the `postgres:16` image can be pulled;
- Git for evidence provenance.

PostgreSQL 16 is pinned by image digest and is not published to the host. The runner records the effective image and uses `psql`, `pg_dump`, `pg_restore` and `pg_dumpall` inside the container.

## Run

From the repository root in WSL/Linux:

```bash
bash poc/rls/scripts/run.sh
```

The runner creates an ephemeral password in memory unless `RLS_POC_POSTGRES_PASSWORD` is already defined. It writes the real command output to `results/evidence.txt`.

Cleanup:

```bash
bash poc/rls/scripts/cleanup.sh
```

## Security design under test

- `rls_poc_owner`: object owner, no login, no superuser, no `BYPASSRLS`;
- `rls_poc_app`: normal runtime, no superuser, no `BYPASSRLS`;
- `rls_poc_worker`: worker runtime, no superuser, no `BYPASSRLS`;
- `rls_poc_platform_admin`: explicit read-only global path with `BYPASSRLS`; it has no DML or DDL grants and must use a separate connection in a future implementation.
- `rls_poc_test_executor`: non-superuser, `NOINHERIT` harness identity allowed to assume the four PoC roles; it is not a production role.

All tenant tables use RLS plus `FORCE ROW LEVEL SECURITY`. Policies compare `tenant_id` with `poc.current_tenant_id()`. The helper returns `NULL` for a missing, empty or invalid context, so policy predicates fail closed instead of granting global access or raising an uncontrolled cast error.

`SET LOCAL app.tenant_id` is issued inside each transaction. Commit and rollback clear it. Functional tests connect as `rls_poc_test_executor`, never as `postgres`, and use `SET LOCAL ROLE` to exercise the exact non-owner, owner and controlled-admin permissions. Bootstrap, seeding and introspection alone use the container-local PostgreSQL administrator.

Composite constraints independently enforce:

```text
Company  (tenant_id, company_id)
Branch   (tenant_id, company_id, branch_id)
TestSale (tenant_id, company_id, branch_id, sale_id)
```

RLS remains a second barrier. Future repositories must still include explicit tenant predicates derived from authenticated context.

## Backup boundary

`pg_dump` preserves database objects, ownership references, grants, policies, `ENABLE RLS` and `FORCE RLS`, but PostgreSQL roles are cluster-global. The runner therefore validates the restored database and separately produces/checks `pg_dumpall --roles-only`. Production automation would need both database restore and controlled role provisioning.

## Interpretation

`PHY-G14` may pass only when `results/evidence.txt` ends in `POC_RESULT=PASS` and every fail-closed criterion is visible. This PoC is only partial evidence for `SEC-G01`; application context derivation, repositories, API/worker integration, SQLite isolation and full cross-tenant suites do not exist yet.

# PHY-G14 RLS PoC result

## Result

`PASS`

Execution completed on 2026-08-12 against commit `b8f5802d711d23f6117a619babeb9660df30682c` using PostgreSQL 16.14 (`postgres:16`) in an isolated Docker Compose network with no host port published.

The captured evidence contains 30 `PASS` notices, zero `FAIL` lines, `ALL_RUNTIME_TESTS_PASSED` and final marker `POC_RESULT=PASS`.

## Verified conclusions

- `rls_poc_app` and `rls_poc_worker` are non-owner runtime roles without superuser, `CREATEROLE` or `BYPASSRLS`.
- `rls_poc_owner` owns all four protected tables and is subject to RLS because both `ENABLE` and `FORCE ROW LEVEL SECURITY` are active.
- Missing, empty and invalid tenant context returns zero tenant-scoped rows.
- Tenant A and Tenant B cannot read or mutate each other's rows.
- `WITH CHECK` rejects an insert or tenant reassignment toward another tenant.
- Composite foreign keys reject cross-tenant Company/Branch and Branch/operational relationships independently of RLS.
- `SET LOCAL app.tenant_id` does not survive commit or rollback on the reused connection.
- Sequential worker jobs A/B and a failed/rolled-back A followed by B do not leak context.
- The controlled platform role has explicit read-only global access through `BYPASSRLS`, but no DML grants and cannot alter or disable RLS.
- Functional tests connected through the non-superuser `rls_poc_test_executor`; the PostgreSQL superuser was limited to bootstrap, seed, introspection and backup administration.
- Database dump/restore retained four protected tables with RLS/FORCE and four policies; five PoC role definitions, including the test harness role, were detected in the separate `pg_dumpall --roles-only` output.

## Boundary of the evidence

This proves the PostgreSQL 16 mechanism selected by `PHY-G14`; it does not prove application-derived tenant context, repository filtering, API/worker integration, SQLite isolation or all `SEC-G01` boundaries. `SEC-G01` therefore remains `PLANNED / NOT_EVALUATED`, `TECH-002` remains `IN_PROGRESS`, and the first migration remains `NO-GO` pending transversal review and explicit authorization.

Full command output: `poc/rls/results/evidence.txt`.

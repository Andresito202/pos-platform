# MAT-003 preflight canonical-role readiness — materialization review

- Branch: `architecture/physical-model`.
- Repository commit at materialization baseline: `ef1f05322252aa22428686a355be8735b6618ff5`.
- Reviewed scope: readiness module and CLI, focused test suite, exact provisioning UP/DOWN artifacts, package/export integration, tooling README, backlog and physical-model traceability.
- Defect remediated: `checkRoleReadiness()` previously returned operational `PASS` for observed `PARTIAL` or `UNEXPECTED` security states.
- Correction: only `MISSING` and `READY` are successful check results; `PARTIAL` and `UNEXPECTED` fail closed. Fresh direct `pos_platform_admin` postcheck accepts only the caller's exact valid `READY` or `MISSING` expectation.
- Validation: TypeScript typecheck PASS; SQLite `12/12`; PostgreSQL migrations `96/96`; MAT-003 preflight `17/17`; role-readiness `20/20`.
- Migration integrity: 001 UP `7f188dd5c14a33f223e4684ace877d588278081924ab4c7286eb105a7c829507`; 001 DOWN `383a26d046beb31975e0a5f00657aea00b9748de67f1188ca2fc7edfe765c0b7`; 002 UP `8b22fdbc76ff79178d3063541012d7f428ed6d538d9027edb7987ebbbe09a554`; 002 DOWN `91acc3576b784daa261fa8e125c32fed522c0c5be12dd8c8fc91ed0c60bb1cf6`.
- Governance: SQL 003 `ABSENT`; descriptor 003 `ABSENT`; migration 003 `NOT_MATERIALIZED`; canonical role `NOT_APPLIED / NOT_EXECUTED`; canonical MAT-003 preflight `BLOCKED / NOT_EXECUTED`.
- Known LOW, non-blocking: diagnostic evidence ordering does not use `related_id` as the final tie-breaker; intentionally not remediated in this closure.
- Review result: `MAT-003-PREFLIGHT-CANONICAL-ROLE-READINESS-MATERIALIZATION-REVIEW = PASS`.
- Commit traceability: git history identifies the commit containing this evidence; no amendment is required to embed the commit's own hash.

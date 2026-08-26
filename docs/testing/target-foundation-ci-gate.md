# TARGET foundation CI gate

## Purpose

This document records the minimum CI gate currently materialized for the POS Platform TARGET foundation. It is operational evidence for `TECH-004`; it is not a declaration that the full product CI/CD pipeline is complete.

## Scope

Workflow: `.github/workflows/target-foundation-validation.yml`

The gate validates only the executable foundation currently present in the repository:

- locked dependency installation with pnpm;
- TypeScript typecheck;
- SQLite migration validation;
- PostgreSQL migrations 001 and 002 on PostgreSQL 16.14;
- MAT-003 preflight tooling;
- MAT-003 canonical-role-readiness tooling.

The workflow uses `contents: read`, GitHub Actions pinned by commit SHA, Node.js 22.19.0, pnpm 9.15.0 and an ephemeral PostgreSQL 16.14 service. It does not require repository secrets for this validation path.

## First reviewed execution

- Branch: `architecture/physical-model`.
- Commit: `4671205f48bf6cb2e18e079c321ab119fce2465c` (`ci: validate TARGET foundation on PostgreSQL 16.14`).
- Pull request: #2 (`architecture/physical-model` -> `main`).
- GitHub Actions run: `32921877755`.
- Job: `TypeScript, SQLite and PostgreSQL 16.14`.
- Result: `COMPLETED / SUCCESS`.

All material steps completed successfully, including dependency installation, typecheck, SQLite validation, PostgreSQL migrations 001/002, MAT-003 preflight tooling and MAT-003 role-readiness tooling.

## Interpretation

This evidence promotes the minimum TARGET foundation CI gate to `MATERIALIZED / EXECUTED / PASS` for commit `4671205f48bf6cb2e18e079c321ab119fce2465c`.

It does **not** promote any of the following:

- `TECH-004` to `DONE`;
- the full CI/CD pipeline to complete;
- the NestJS/Fastify runtime to materialized;
- Electron/React/Vite or POS Local Service to materialized;
- SQL/descriptor 003 or migration 003 to materialized;
- SIIGO, FACTUS or ALEGRA adapters to evaluated or production-ready;
- `SEC-G01` through `SEC-G10` to evaluated or passed;
- POS Platform to production-ready.

Nx integration, linting, security scanning, license/SBOM controls, broader runtime tests, release controls and the integral product pipeline remain pending under `TECH-004` and the applicable security gates.

## Head-change rule

CI evidence is commit-scoped. Any later commit on `architecture/physical-model` must obtain a successful applicable run before that new HEAD can use `CI = PASS` as an integration gate. A historical successful run never substitutes validation of a changed HEAD.

## Main integration rule

A successful CI run is necessary but not sufficient for integration into `main`. The validated HEAD still requires final diff review and the PR integration gate. Merge into `main` requires separate explicit authorization and post-merge verification.

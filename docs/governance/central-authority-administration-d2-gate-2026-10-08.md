# D-2 — Central Authority administrative persistence gate

Status: BLOCKED_BY_MISSING_CANONICAL_PLATFORM_ACCOUNT_CONTRACT

Date: 2026-10-08

## Finding

The repository defines `PLATFORM_ACCOUNT` as an actor type and defines the physical runtime roles `pos_platform_app` and `pos_platform_admin`, but it does not define a canonical persistent Platform Account aggregate/table, lifecycle use case, credential/recovery contract, or administrative HTTP contract.

Therefore D-2 must not create a speculative `platform.accounts`, `platform_accounts`, bearer-token API, or direct Electron-to-PostgreSQL administration path.

## Evidence

- `packages/contracts/src/authorization.ts` defines `PLATFORM_ACCOUNT` as an actor type.
- Foundation defines `tenancy.onboarding_operations.actor_type` as `USER|PLATFORM_ACCOUNT`.
- `pos_platform_app` is the platform identity/onboarding database role.
- `pos_platform_admin` is explicitly read-only/BYPASSRLS inspection infrastructure.
- The repository search contains no canonical `platform_accounts` table or equivalent persistent aggregate.
- Licensing physical model exists in `docs/architecture/physical-model/device-licensing-schema.md`, but its PostgreSQL/SQLite tables remain outside the materialized Foundation migration and are explicitly gated.
- Onboarding stores `license_reference` and `requested_plan` as references/requests; those columns do not constitute a License or Plan aggregate.

## Required contract before physical materialization

D-2 can proceed only after the repository contains authoritative decisions for:

1. Platform Account identity and immutable identifier.
2. Authentication mechanism and credential lifecycle.
3. MFA/recovery lifecycle and security-event/audit semantics.
4. Platform Account status and revocation semantics.
5. Authorization of platform administrative commands.
6. Tenant-independent versus tenant-contextual administrative operations.
7. Actor attribution for administrative audit events.
8. Separation between `pos_platform_app` application access and `pos_platform_admin` inspection access.
9. License issuer identity and relationship to Platform Account.
10. Administrative API transport and request authentication, if an HTTP surface is required.

## Licensing boundary

The existing licensing model is sufficient to define the conceptual aggregate boundary:

`Tenant -> License -> FeatureEntitlement -> LicenseActivation`

A standalone Plan aggregate must not be introduced merely because the UI needs a "plan" screen. The current model treats requested/effective plan as licensing-contract data. Any Plan catalog requires an explicit authoritative contract first.

## Gate decision

- Platform Account persistence: NOT MATERIALIZABLE YET.
- Platform Account authentication: NOT MATERIALIZABLE YET.
- Administrative HTTP API: NOT MATERIALIZABLE YET.
- License persistence migration: NOT part of D-2 until its own migration contract/gate is closed.
- Electron Superadmin UI: BLOCKED until backend authority exists.
- No direct PostgreSQL access from Electron is permitted.

This is an intentional fail-closed gate, not an implementation omission.

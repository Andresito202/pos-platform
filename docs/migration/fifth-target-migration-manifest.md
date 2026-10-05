# Fifth target migration manifest — onboarding bootstrap hardening

## Identity

- Migration: `005_onboarding_bootstrap_hardening`
- Dependency: `004_device_trust`
- Owner: onboarding bootstrap hardening
- Existing migration `004_device_trust` remains immutable.
- Migration `001_central_foundation` remains immutable; this migration extends its onboarding table without changing 001 ownership.

## Physical changes

`tenancy.onboarding_operations` receives:

- `commercial_reference text NULL`
- non-empty value check when present
- partial unique index `onboarding_operations_commercial_reference_uq` for active onboarding identities

The migration also enables and forces RLS on `tenancy.onboarding_operations` for the pre-tenant bootstrap boundary.

Policies:

- `onboarding_operations_actor_select`
- `onboarding_operations_bootstrap_insert`
- `onboarding_operations_actor_update`

The policies bind pre-tenant reads/writes to `app.actor_id`; once a tenant is materialized, updates also require the transaction tenant context.

## Application contract

The onboarding application sets `app.actor_id` before idempotency lookup and sets `app.tenant_id` before tenant-scoped writes. It does not use BYPASSRLS or SECURITY DEFINER.

Initial configuration is restricted to the existing versioned onboarding policy references. No generic configuration table or JSON configuration persistence is introduced.

## Verification

The repository includes:

- migration descriptor and runner for 005
- artifact/descriptor tests
- physical RLS tests
- real PostgreSQL onboarding integration tests covering atomic creation, idempotent replay/concurrency, commercial-reference conflict, configuration allow-listing, owner reuse, audit and outbox persistence

# Commercial portal bridge — Central ↔ camacho-pos-comercial

## HEAD / PR

- pos-platform branch: `cursor/commercial-portal-bridge-4d5a`
- camacho-pos-comercial PR #1: `feat/commercial-platform-foundation`

## Authenticated API surface (Central)

| Method | Path | Auth |
|---|---|---|
| POST | `/v1/sessions/introspect` | Bearer commercial portal token |
| POST | `/v1/sessions/commercial-bridge/mint` | Bridge key **+** verified GLOBAL MFA |
| POST | `/v1/commercial/trial/issue` | Bridge key → issues **TRIAL 120h** + webhook |
| POST | `/v1/commercial/trial/expire-sweep` | Bridge key → revoke expired + notify CRM |
| POST | `/v1/commercial/provisioning` | Bridge key + `Idempotency-Key` |

## Reuse (no duplicate identity DB)

- Bridge key authenticates the **service hop only**. Mint requires a verified GLOBAL MFA session (cookie+CSRF+`LICENSE_ISSUE` via `GlobalAdministrationSessionGate`).
- Introspect keeps Bearer active only while the underlying `identity.sessions` row remains live (join in Postgres store; revoke → inactive).
- Durable PG tables (migration `038_commercial_portal_bridge`): bridge sessions, JTIs, trial grants (exact 120h, no grace), provisioning receipts.
- Main TLS mount always uses `PostgresCommercialPortalBridgeStore` + `PostgresCommercialLicenseIssuer` — never process-local memory.
- Trial/provisioning write `licensing.licenses` when `tenantId`+`planId` are supplied (`grace_policy_reference=NULL`, trial window exact 120h).
- Offline trial block: Local Service fail-closes on signed capacity expiry (`offline_grace_until=null`) + `TrustedClockGuard` (no fraudulent clock rollback); expire-sweep marks REVOKED and notifies CRM with `offlineGrace:false`.
- Provisioning: `ISSUED`+`licenseIds` only when licenses are written; queue ack alone is `QUEUED` (comercial must not FULFILL).

## Env

```bash
COMMERCIAL_BRIDGE_KEY=<≥32>
CENTRAL_TRIAL_WEBHOOK_KEY=<≥32>   # must match commercial CENTRAL_TRIAL_WEBHOOK_KEY
```

The production composition has no standalone test-authentication entrypoint. Test gates are isolated to tests.

Apply migration: commercial CLI `--commercial-portal-bridge`.

## Explicit non-claims

- Does not enable Factus PRODUCTION charges.
- Does not merge repositories or replace POS Local Service.
- Lab ExplicitTest headers are not product GLOBAL login.
- Provisioning without tenant/plan remains `QUEUED` (durable receipt); with tenant/plan it returns `ISSUED` + `licenseIds`.

## Migration reconciliation

038 reserves a distinct identifier from 036 BUSINESS login and 037 Central rate limits. Before deployment, inspect the migration ledger and database for any prior 036_commercial_portal_bridge application; if present, do not apply 038 until an explicit checksum-preserving adoption plan is reviewed. No production ledger was inspected during this reconciliation.

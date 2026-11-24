# Commercial portal bridge — Central ↔ camacho-pos-comercial

## HEAD / PR

- pos-platform branch: `cursor/commercial-portal-bridge-4d5a`
- camacho-pos-comercial PR #1: `feat/commercial-platform-foundation`

## Authenticated API surface (Central)

| Method | Path | Auth |
|---|---|---|
| POST | `/v1/sessions/introspect` | Bearer commercial portal token |
| POST | `/v1/sessions/commercial-bridge/mint` | `X-Central-Commercial-Bridge-Key` |
| POST | `/v1/commercial/trial/issue` | Bridge key → issues **TRIAL 120h** + webhook |
| POST | `/v1/commercial/trial/expire-sweep` | Bridge key → revoke expired + notify CRM |
| POST | `/v1/commercial/provisioning` | Bridge key + `Idempotency-Key` |

## Reuse (no duplicate identity DB)

- GLOBAL role for commercial admin is mint/introspect only — does not create a second user store.
- MFA / SSA / SAS / PostgreSQL Central identity remain owned by existing GLOBAL/BUSINESS portals.
- Offline trial block: Local Service continues to fail-closed on signed `expires_at` / revocation artifacts; expire-sweep records Central-side REVOKED and notifies commercial CRM.

## Env

```bash
COMMERCIAL_BRIDGE_KEY=<≥32>
CENTRAL_TRIAL_WEBHOOK_KEY=<≥32>   # must match commercial CENTRAL_TRIAL_WEBHOOK_KEY
```

Standalone (non-production): `pnpm --filter @pos-platform/central-authority commercial-bridge:standalone`

## Explicit non-claims

- Does not enable Factus PRODUCTION charges.
- Does not merge repositories or replace POS Local Service.
- Memory store is for bridge credentials/trials/provisioning queue until PG-backed adapters are authorized.

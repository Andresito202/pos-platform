# Wave 7 — FACTUS + FACTUS Pay closure evidence

Date: 2026-11-18  
Branch: `cursor/wave7-factus-1766`  
Base reference: `679bf293c27ec199f2eb3ae7840fc9eb337027e7`  
**Not merged to `main`.** No production charges or DIAN emissions.

## Scope delivered on this tip

### FACTUS (electronic invoicing path)
- OAuth2 adapter + credential deposit (already present) retained.
- Fiscal IPC (`fiscal.document.issue`, `fiscal.numbering.sync`) + FiscalPanel retained.
- Local ADMINISTRADOR now receives `FISCAL_DOCUMENT_ISSUE` so the Fiscal panel is reachable under local-operator auth (still fail-closed without deposited credential + `POS_FISCAL_ENVIRONMENT`).
- Catalog UI can send optional `fiscal_attributes` already accepted by IPC/store.

### FACTUS Pay (Caja)
- Wired existing `FactusPayClient` / credential store into CommercialComponent (distinct AAD).
- IPC: `payment.factus_pay.collect` | `verify` | `resume`.
- Caja UI: Generar QR / Verificar / Recuperar (after restart).
- Deposit CLI: `pnpm --filter @pos-platform/pos-local-service deposit-factus-pay-credential`.
- Confirm only after provider GET returns `paid` (no simulated confirmation as payment evidence).
- Inventory/sale completion via existing payment store transaction on verify.
- Webhook ingress: PG `018_factus_pay_webhook_inbox` + central handler/runtime (observation-only; does not confirm POS sale).

### Preserved
- Cash + transfer payment flows unchanged.
- Login, hardware, licenses, sector modules not redesigned.
- SCM commercial frozen; no Authenticode changes.

## Local test evidence (this environment)

| Suite | Command | Result |
|---|---|---|
| Factus Pay client/amount/collection | `vitest` in pos-local-service (3 files) | 7 passed |
| Payment + fiscal issuance/credential | `vitest` payment/fiscal-* | 94 passed |
| Fiscal adapters | `pnpm test:fiscal-adapters` | 177 passed, 2 skipped (sandbox env) |
| Contracts | `pnpm test:contracts` | 281 passed |
| Desktop IPC surface | preload-api + ipc-allowlist | 11 passed |
| Central webhook normalize/handler | factus-pay-*-tests | 12 passed |
| PG 018 descriptor | postgres-018-factus-pay.test | 3 passed |
| Typecheck | `pnpm typecheck` | PASS |
| Architecture | `pnpm architecture:check` | PASS |
| Repository policy | `pnpm ci:repository-policy` | PASS |

## Sandbox blockage (not invented)

No `FACTUS_SANDBOX_*` or `FACTUS_PAY_SANDBOX_*` credentials were available in this Cloud Agent environment (`list-available-secrets` empty; process env empty).

Therefore:
- `factus-sandbox.test.ts` remains skipped (`describe.skipIf`).
- No claim of `SANDBOX_VERIFIED` for issuance, status, artifact, or live FACTUS Pay collect/verify against the provider.
- Operator path: deposit credentials per `docs/testing/factus-sandbox-operator-custody-2026-11-17.md`, then run sandbox suites / exceptional gate.

## Claims level

| Capability | Claim |
|---|---|
| FACTUS Pay Caja wiring (IPC+UI+UC) | IMPLEMENTED + locally TESTED (fake transport) |
| FACTUS Pay provider sandbox | BLOCKED — no credentials |
| FACTUS issuance sandbox | BLOCKED — no credentials (prior historical SANDBOX_VERIFIED for config/ranges not re-run here) |
| Webhook authenticity + durable inbox | IMPLEMENTED + unit TESTED; runtime provision opt-in |
| Production / DIAN emission | NOT claimed |

## Defects corrected vs `679bf293`

1. Orphaned FactusPay client not exported/wired → connected through CommercialComponent + IPC + Caja.
2. Missing deposit CLI for Pay → added.
3. Fiscal panel unreachable under local ADMINISTRADOR → permission grant.
4. Catalog could not send fiscal attributes → UI/hook wiring.
5. No restart recovery for pending QR → `payment.factus_pay.resume` + store query.
6. Webhook PG 018 + central ingress missing on wave7 tip → recovered selectively.

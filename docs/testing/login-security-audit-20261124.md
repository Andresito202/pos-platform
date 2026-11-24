# Login security audit — 2026-11-24

Reference reviewed: `d69587cc` (main after PR #133). Branch: `cursor/login-security-audit-c53a`.

## Claim boundary

This document records a **static + unit-tested** security remediation. It does
**not** declare `RUNTIME_VERIFIED` or production certification. SCM commercial
remains gated. Offline cajero login is unchanged except clock-rollback fail-closed
on the local password budget.

## Demonstrated findings corrected

| Id | Severity | Fix |
| --- | --- | --- |
| B-RL-MEM | HIGH | BUSINESS login uses durable `spendDurableLoginBudget` (same ledger as GLOBAL) |
| PW-LOCK-DEAD | HIGH | Password verify writes `failed_attempt_count` / `locked_until` |
| CAPTCHA | MEDIUM | Optional `turnstile_secret_file` → server-side Turnstile on GLOBAL/BUSINESS begin |
| B-SESS-ACCUM | MEDIUM | BUSINESS issuer revokes prior `__Host-camacho_business` cookie |
| LOC-02 | MEDIUM | Local password gate fail-closes on clock rollback |
| CSRF-CMP | LOW | `timingSafeEqual` on login-complete CSRF compare |

## Gaps identified (contracts / product — not forged here)

| Id | Severity | Status |
| --- | --- | --- |
| COM-AUD-MISS | HIGH (gap) | No `camacho-pos-comercial` audience introspection endpoint at this HEAD |
| TRIAL-120 | INFO (gap) | `TRIAL` enum exists; no 120-hour duration/isolation/expiry contract |
| Android login | INFO | No Android auth surface under `apps/` / `packages/` |
| LOC-01 | HIGH (dev) | Dev bridge remains development-only; not removed (would break lab) |

### Contracts needed for trial 120h (identification only)

1. License grant with `contract_status=TRIAL`, explicit `valid_from`/`valid_until` = 120h wall clock from activation (trusted central clock).
2. Tenant/company data isolation: trial rows constrained by RLS + no cross-tenant promotion without paid fulfillment.
3. Fail-closed runtime gate: local SERVICE and BUSINESS reject commercial ops when trial expired (signed capacity / SAS must carry expiry).
4. No silent extension; renewal only via paid path / GLOBAL issuance.

### Contracts needed for commercial-portal session introspection

1. Audience constant `commercial-portal` on issued commercial access claims.
2. Central HTTPS introspect: cookie/bearer → active session + audience check; no password re-prompt when session valid.
3. Do not mount duplicate login; reuse Central session custody.

## Residual risk

- In-memory request `FixedWindowRateLimiter` remains for non-login HTTP flood shaping (single process). Login abuse is durable.
- Turnstile is **opt-in** via provision file; production must set `turnstile_secret_file`.
- Migration `036_business_login_abuse_budget` indexes BUSINESS ledger reasons; apply with `--login-abuse-budget`.
- No Windows real-operator login re-run in this environment.

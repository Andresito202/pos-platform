# SKIP — Real Electron role-home captures (CAJERO / SUPERVISOR / ADMINISTRADOR)

**Status:** SKIP — no role-home PNGs produced  
**Platform observed:** Linux x64 (`process.platform === "linux"`)  
**Date:** 2026-11-17  
**Constraint honored:** no `role-preview` / `visual-preview` entries; no fabricated role shells

## Requested captures (not created)

| Role | Home screen | Path |
|------|-------------|------|
| CAJERO | `sale-panel` | — |
| SUPERVISOR | inventory | — |
| ADMINISTRADOR | dashboard | — |

## What was attempted (empirical)

### A. `pos-local-service` `src/main.ts` + `NODE_ENV=development` + `POS_LOCAL_OPERATOR_AUTH_STORE`
- Same pattern as `e2e/local-operator-live.spec.ts` (Windows live login).
- **Result:** `runtime.start_failed` → `POS Local Service production runtime requires Windows`
- Source: `apps/pos-local-service/src/main.ts` (`platform !== "win32" && NODE_ENV !== "test"`).

### B. Same as A with `NODE_ENV=test` + auth store
- **Result:** `runtime.start_failed` → `LOCAL_OPERATOR_AUTH_DEVELOPMENT_ONLY`
- Source: `apps/pos-local-service/src/config.ts` (auth store requires `NODE_ENV === "development"`).
- **Contradiction:** Linux service boot needs `NODE_ENV=test`; local-operator password store needs `NODE_ENV=development`. Both cannot be true → password login path cannot start on Linux via `main.ts`.

### C. `main.ts` + `NODE_ENV=test` **without** auth store
- **Result:** `runtime.started` with `key_protection: TEST_ONLY`.
- **Missing:** `local_channel_endpoint` field (no channel published).
- Source: `LocalChannelComponent` is only mounted under `if (process.platform === "win32")` in `main.ts`.
- Desktop therefore has nothing to connect to for `local.operator.login`.

### D/E. Electron `apps/pos-desktop/dist/start.bundle.mjs` (production-entry)
- **Result:** immediate `POS_DESKTOP_PROVISIONING_FAILED` then quit.
- Cause chain in production path:
  1. `loadProductionDesktopProvisioning` → endpoint resolve throws on non-Windows: `production desktop bootstrap requires Windows named pipes`
  2. Channel secret root key requires Windows DPAPI: `local channel production secret requires Windows DPAPI`
  3. `loadOrCreateWindowsLocalChannelSecret` refuses non-Windows: `Windows channel provisioning requires Windows DPAPI`
- Sources: `packages/local-channel/src/windows-production.ts`, `apps/pos-desktop/src/production-entry.ts`.

### F/G. Packaged artifact `pos-local-service-0.0.0-linux-x64.tar.gz`
- `NODE_ENV=development`: same Windows runtime gate as A.
- `NODE_ENV=test`: starts like C, still **no** `local_channel_endpoint` / no local-operator registry.

### Linux-capable alternative checked (not used for captures)
- `e2e/real-channel-entry.mjs` + `e2e-host/real-service-host.ts` can use POSIX sockets under `NODE_ENV=test`.
- That harness **explicitly has no password-backed local operator registry**; it only stubs `local.operator.session` → `NO_SESSION` and activates a **test-signed SSA** (not CAJERO/SUPERVISOR/ADMINISTRADOR local-operator login).
- Using it would not satisfy “real local-operator login path” and must not be mislabeled as role-home evidence.

## Spec gates already documenting the same blocker

- `e2e/local-operator-live.spec.ts`: `test.skip(process.platform!=="win32","Physical Windows DPAPI/named-pipe login required")`
- `e2e/role-isolation.spec.ts`: Windows DPAPI/named-pipe required
- `e2e/unauthenticated-startup.spec.ts`: Windows DPAPI + named pipe required

## Precise SKIP reason (one line)

**SKIP:** Linux cannot run the real local-operator login → role-home path: production desktop entry fails closed without Windows DPAPI + named-pipe provisioning (`POS_DESKTOP_PROVISIONING_FAILED`); `pos-local-service` production/`development` runtime requires Windows; `NODE_ENV=test` can start the service binary but does not mount `LocalChannelComponent` nor allow `POS_LOCAL_OPERATOR_AUTH_STORE`; POSIX e2e host has no password operator registry. Capture requires physical Windows (DPAPI + named pipe + `local-operator-live` path).

## Non-claims

- Existing `bloque6-login-entry-real.png` is smoke/login-shell only (smoke-entry), **not** a role home and **not** evidence of authenticated CAJERO/SUPERVISOR/ADMINISTRADOR shells.
- No role-preview / visual-preview PNGs were generated as substitutes.

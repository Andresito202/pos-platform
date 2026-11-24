# Android commercial integration — progress

Branch: `cursor/android-commercial-integration-c53a` (from `main`, selective extract).
Base diagnosis: Android absent on `main`/PR #135; lab probes on `feat/android-commercial-runtime`.

## Block 1 — Runtime / APK shell

| Item | Status |
|---|---|
| Branch from current `main` | Done |
| Selective foundation (`android-service-foundation`, Keystore provider, hardware AAR, association prep) | Ported |
| `DEVICE_ENROLLMENT_LOCAL_KEY_MISMATCH` restored on enrollment (fail-closed) | Done |
| `CamachoCommercialDomains` contract | Ported |
| Commercial package `co.camachopos.colombia` (not renamed probe) | Done |
| Lab probes preserved under `tools/android-lab-probes/` (non-product) | Done |
| Yellow brand entry (informational; no credential form) | Done — Codex P1 |
| Pos shell modules gated (caja/catálogo/…) | Present, not navigable from entry |
| Commercial shell APK task (`commercialShellApk`) | Implemented + built unsigned |
| Embedded Node/SQLite engine in commercial APK | Pending (lab scripts reusable; not claimed) |

## Blocks 2–6

| Block | Status |
|---|---|
| 2 Login/roles/UI amarilla táctil | Entry amarilla informativa; login form removed until ceremony wired |
| 3 Caja/catálogo/offline | `PosShellActivity` tiles blocked without grants |
| 4 Hardware | AAR + `HardwareSurfaceGate`; drawer still unverified profile |
| 5 Central/FACTUS/Nequi/trial PR #135 | `TrialCapacityBridge` stub only; no device cable |
| 6 Security/aislamiento/update | Keystore + enrollment mismatch; APK update flow pending |

## Evidencia Block 1 (este entorno)

Comandos observados:

- `pnpm --filter @pos-platform/contracts exec vitest run tests/commercial-domains.test.ts` → PASS (1)
- `pnpm --filter @pos-platform/pos-local-service test --` android foundation suite → **20/20 PASS**
- `pnpm --filter @pos-platform/central-authority exec vitest run` android association/native → **4/4 PASS**
- `gradle commercialIdentityTest commercialShellApk` → **BUILD SUCCESSFUL**
- APK unsigned badging: `package: name='co.camachopos.colombia' minSdkVersion:'28' launchable-activity: EntryActivity`

Capturas de dispositivo M60WL: **no ejecutadas** aquí (sin ADB/dispositivo). Previews HTML/layout de tokens amarillos son referencia visual, **no** evidencia física.

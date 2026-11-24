# Android commercial integration — progress

Branch: `cursor/android-commercial-integration-c53a` · PR #136

## Completed in this wave

| Item | Evidence |
|---|---|
| Node/SQLite engine packaged via approved lab pipeline | `prepare-runtime` → verify → extract → NDK compile → `package-runtime-assets`; commercial `runtime-service.mjs` bundled from `AndroidCommercialHost` |
| Signed installable APK API 28 | `gradle commercialApk` → `camacho-pos-colombia.apk` (v2 signed, test PKCS12) |
| Real Local Service host | `AndroidCommercialHost` + `AndroidCommercialServiceControl` (`REQUEST` / license / stop) |
| Login UI Windows identity | Official `camacho-pos-colombia-login-entry.png`, navy stage, yellow CTA; calls `local.operator.login` (no mock success) |
| Caja/catálogo/inventario/clientes/turnos/carrito | `PosShellActivity` invokes real contracts via binder → engine |
| License / trial gate | `LicenseCapacityGate` wired when provision file present; zero offline grace |
| Fail-closed without provision | Host tests: `DEVICE_NOT_PROVISIONED` / `OPERATOR_STORE_UNAVAILABLE` |

## Not claimed

- Physical M60WL install/captures in this Cloud Agent (no KVM/`/dev/kvm` for emulator; no device ADB)
- Production Play signing
- BUSINESS SSA browser ceremony without deposited App Links + release cert
- Hardware PRINT/DRAWER physical pulse on device in this run

## Build

See `apps/pos-android/README.md`.

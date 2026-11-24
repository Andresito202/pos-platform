# Android commercial integration — progress

Branch: `cursor/android-commercial-integration-c53a` · PR #136

## Completed in this wave

| Item | Evidence |
|---|---|
| Node/SQLite engine packaged via approved lab pipeline | `prepare-runtime` → verify → extract → NDK compile → `package-runtime-assets`; commercial `runtime-service.mjs` from `AndroidCommercialHost` |
| BUSINESS entry (no local.operator commercial auth) | `EntryActivity` → App Links verify → PKCE prepare → `android.business.native_request` → browser V2 `?request=` → callback → token exchange → `session.activate` / `session.recover` |
| Commercial handler SSA-only | `AndroidCommercialHost` no longer passes local-operator into `CommercialRequestHandler` |
| IPC Zod fail-closed on Android | After host-only `android.business.*`, `IpcRequestSchema.safeParse`; unknown types → `INVALID_REQUEST`; authorization path unchanged |
| DeviceProof native-request client composition | `AndroidBusinessNativeCentralClient` (challenge → DeviceProof POST → selector); host uses it only when `resolveNativeCentral` supplies enrolled credential + HTTPS origin |
| Central reserved native routes | `main.ts` returns 503 `NATIVE_BUSINESS_ROUTE_NOT_ACTIVATED` / `ANDROID_ASSET_LINKS_NOT_PUBLISHED` (not a parallel stack) |
| App Links preparation | `docs/product/android-assetlinks-prepared-not-published.json` via `prepareAndroidAssociation` · status `NOT_PUBLISHED` |
| Functional surfaces | Caja, carrito/ventas, catálogo, inventario, clientes, pagos (efectivo/Nequi/FACTUS Pay), hardware, licencia/trial, capacidades |
| Hardware adapters reused | `UsbHostTransport` / `HardwareCore`; drawer gated until electrical profile verified |
| Trial 120h / zero grace (PR #135 connection) | `TrialCapacityBridge` + `OfflineExpiryPolicy` + `ANDROID_TRIAL_CAPACITY_POLICY`; gate remains `LicenseCapacityGate` (no mint in APK) |
| Signed APK | `gradle commercialApk` → v2-signed test PKCS12 · see integrity manifest |

## Explicit non-claims / M60WL + Central-deploy blockers

1. **OS App Links verification** on Android 9 (DAL must be published with release cert; metadata prepare ≠ OS verify).
2. **Central activation** of native-request / token handlers on migration 016 (routes reserved 503 until authorized activation + DeviceProof enrollment).
3. **Live CH340 / PRINT / drawer electrical** on the physical terminal.
4. **Install + operator observation** of BUSINESS login + sale on M60WL.

## Operator runbook

See `docs/product/android-m60wl-install-enroll-test.md`.

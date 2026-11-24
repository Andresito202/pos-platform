# Android commercial integration — progress

Branch: `cursor/android-commercial-integration-c53a` · PR #136

## Completed in this wave

| Item | Evidence |
|---|---|
| Node/SQLite engine packaged via approved lab pipeline | `prepare-runtime` → verify → extract → NDK compile → `package-runtime-assets`; commercial `runtime-service.mjs` from `AndroidCommercialHost` |
| BUSINESS entry (no local.operator commercial auth) | `EntryActivity` → App Links verify → PKCE prepare → `android.business.native_request` → browser V2 `?request=` → callback → token exchange → `session.activate` / `session.recover` |
| Commercial handler SSA-only | `AndroidCommercialHost` no longer passes local-operator into `CommercialRequestHandler` |
| Functional surfaces | Caja, carrito/ventas, catálogo, inventario, clientes, pagos (efectivo/Nequi/FACTUS Pay), hardware, licencia/trial, capacidades |
| Hardware adapters reused | `UsbHostTransport` / `HardwareCore` compiled into commercial APK; CH340/Gprinter VID/PID from lab profile; drawer gated until electrical profile verified |
| Trial 120h / zero grace | `TrialCapacityBridge` + `OfflineExpiryPolicy` aligned with PR #135; gate remains `LicenseCapacityGate` |
| Signed APK | `gradle commercialApk` → v2-signed test PKCS12 |

## Explicit non-claims / M60WL blockers only

These require the physical terminal (or live Central deployment), not more Cloud Agent scaffolds:

1. **OS App Links verification** on Android 9 for `central.camachoposcolombia.com/android/callback` (DAL must be published; metadata verify ≠ OS verify).
2. **DeviceProof enrollment + Central `POST /v1/commercial/native-requests` composition** for Android (allowlisted, not simulated; endpoint not mounted as production).
3. **Live CH340 weight stability / USB permission persistence** after reboot.
4. **Gprinter PRINT pulse and M60WL drawer electrical profile** confirmation (`M60WL_DRAWER_ELECTRICAL_PROFILE_UNVERIFIED` until verified).
5. **Install of the signed APK on the device** and operator observation of BUSINESS login + sale.

## Build / evidence

See `apps/pos-android/README.md`. After `commercialApk`, record SHA-256 of the signed APK and `tools/android-lab-probes/build/runtime-assets/runtime/files.json`.

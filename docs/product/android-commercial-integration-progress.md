# Android commercial integration — progress

Branch: `cursor/android-commercial-integration-c53a` · PR #136

## Completed

| Item | Evidence |
|---|---|
| Node/SQLite engine packaged | Lab pipeline → commercial `runtime-service.mjs` |
| BUSINESS entry (no local.operator commercial auth) | App Links → PKCE → DeviceProof native-request → browser → token → SSA assertions → `session.activate` |
| IPC Zod fail-closed on Android | `IpcRequestSchema.safeParse` after host-only `android.business.*` |
| Central commercial composition | `prepareCentralCommercialRuntime` mounts native-requests/token/login/assertions when `CENTRAL_COMMERCIAL_PROVISION_FILE` + SSA/SAS trust present; otherwise fail-closed 503 |
| Android registration | Provision `platform: ANDROID` + App Link package/fingerprint via `validateCommercialPosRegistration` |
| DeviceProof client composition | `createAndroidBusinessNativeCentralClient` + `AndroidBusinessNativeCentralClient` (challenges → native-requests → token → `/v1/business-session/assertions`) |
| App Links prep | `android-assetlinks-prepared-not-published.json` (`NOT_PUBLISHED`) |
| Trial 120h / zero grace | PR #135 observation + `LicenseCapacityGate` |
| M60WL runbook (API 28) | Safe `adb install -r` (no uninstall); App Links via `dumpsys` / VIEW intent (no Android 12+ pm commands) |
| Signed APK 0.3.2 | Integrity manifest · SHA-256 `b7668d36042edb472dd11b9dbe94145a48af3e19d4a75646dd9109125a6e387d` (supersedes eb1528ce APK) |
| Runtime / host integrity (API 28) | `AndroidRuntimeIntegrity` (debugger/Frida/root artifacts) gates BUSINESS ceremony; `verifyAndroidEmbeddedRuntimeIntegrity` checks `files.json` digests |

## Real blockers remaining (infra / hardware)

1. Live Central deploy with commercial provision + SSA/SAS keys + DB 008–016.
2. DAL published with the installed APK fingerprint + OS verify on M60WL Android 9.
3. DeviceProof enrollment on the physical terminal (`POS_ANDROID_COMMERCIAL_PROVISION_FILE` + Device Trust).
4. CH340 / PRINT / drawer electrical profile on M60WL.
5. Play production signing (out of scope for test PKCS12).

## Operator docs

- `docs/product/android-m60wl-install-enroll-test.md`
- `docs/product/android-commercial-integrity-manifest-20261124.json`
- `docs/product/android-commercial-apk-evidence-20261124.md`

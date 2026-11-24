# Android commercial APK evidence — 2026-11-24

PR #136 · branch `cursor/android-commercial-integration-c53a`

## Artifact

| Field | Value |
|---|---|
| Package | `co.camachopos.colombia` |
| versionName | `0.3.0-business-surfaces` |
| versionCode | 2 |
| minSdk | 28 |
| Signing | APK Signature Scheme v2 · test PKCS12 (`hardware-lab`) |
| APK SHA-256 | `14e0a8367915819944ba2d93936ee501ca90baa30483b3374a7134a43fdd585c` |
| Size | 73018194 bytes |
| Artifact copy | `/opt/cursor/artifacts/camacho-pos-colombia-signed.apk` |
| Runtime `files.json` SHA-256 | `b5478f231746700072b2af23c386f72e60b2abaefd25233daa08faf6154b30d8` |
| Commercial runtime bundle SHA-256 | `8ba2d43779b7247fd2e45352fc2618f363debf3b17b11ee6f26774a5529c8396` |

## Commands observed

```text
node tools/android-lab-probes/bundle-commercial-runtime.mjs
gradle -p apps/pos-android commercialApk
sha256sum apps/pos-android/build/commercial-apk/camacho-pos-colombia.apk
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/android-commercial-host.test.ts
gradle -p apps/pos-android commercialIdentityTest
pnpm architecture:check
```

## Results observed

- `commercialApk`: BUILD SUCCESSFUL · APK_VERIFIED v2 · package `co.camachopos.colombia`
- Host tests: 3 PASS
- Identity test: COMMERCIAL_IDENTITY_PASS
- ARCH-003: PASS (after removing unpacked runtime from the Android source/build scan path)

## Reproducibility notes

- Runtime inputs locked by `tools/android-lab-probes/runtime-input-lock.json` and `files.json` digests.
- Test PKCS12 only — not Play production signing.
- Physical install / App Links OS verify / CH340 pulse require M60WL.

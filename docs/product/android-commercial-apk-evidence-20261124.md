# Android commercial APK evidence — 2026-11-24

PR #136 · branch `cursor/android-commercial-integration-c53a`

## Artifact

| Field | Value |
|---|---|
| Package | `co.camachopos.colombia` |
| versionName | `0.3.1-native-central` |
| versionCode | 3 |
| minSdk | 28 |
| Signing | APK Signature Scheme v2 · test PKCS12 (`hardware-lab`) |
| APK SHA-256 | `336cb9e579a2c87d65d460d53ccdde2105c4fbe8b277c9cbaf78ba558009cdf6` |
| Size | 73022290 bytes |
| Artifact copy | `/opt/cursor/artifacts/camacho-pos-colombia-signed.apk` |
| Runtime `files.json` SHA-256 | see integrity manifest |
| Commercial runtime bundle SHA-256 | `f532741d2d5e3824a7f015e4371da71edd6787c12017a3ef263f309d392a67ad` |
| Integrity manifest | `docs/product/android-commercial-integrity-manifest-20261124.json` |

## Commands observed

```text
node tools/android-lab-probes/bundle-commercial-runtime.mjs
node tools/android-lab-probes/package-runtime-assets.mjs
bash apps/pos-android/scripts/prepare-commercial-assets.sh
gradle -p apps/pos-android commercialApk
sha256sum apps/pos-android/build/commercial-apk/camacho-pos-colombia.apk
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/android-commercial-host.test.ts
gradle -p apps/pos-android commercialIdentityTest
pnpm architecture:check
```

## Results observed

- `commercialApk`: BUILD SUCCESSFUL · APK_VERIFIED v2 · package `co.camachopos.colombia` · versionCode 3
- Host tests: 7 PASS (Zod unknown reject, native fail-closed, DeviceProof composition unit)
- Identity test: COMMERCIAL_IDENTITY_PASS
- ARCH-003: PASS (staging-runtime removed after packaging)

## Reproducibility notes

- Runtime inputs locked by `tools/android-lab-probes/runtime-input-lock.json` and `files.json` digests.
- Test PKCS12 only — not Play production signing.
- App Links artifact: `docs/product/android-assetlinks-prepared-not-published.json` (`NOT_PUBLISHED`).
- Physical install / App Links OS verify / CH340 pulse / Central native activation require M60WL + Central deploy.
- Operator runbook: `docs/product/android-m60wl-install-enroll-test.md`.

# Android commercial APK evidence — 2026-11-24 (PR #136)

## Artifact

| Field | Value |
|---|---|
| Package | `co.camachopos.colombia` |
| versionName | `0.3.2-central-composition` |
| versionCode | 4 |
| minSdk / targetSdk | 28 |
| APK path | `apps/pos-android/build/commercial-apk/camacho-pos-colombia.apk` |
| Artifact copy | `/opt/cursor/artifacts/camacho-pos-colombia-signed.apk` |
| APK SHA-256 | `b7668d36042edb472dd11b9dbe94145a48af3e19d4a75646dd9109125a6e387d` |
| Bytes | 73030482 |
| Signing | APK Signature Scheme v2 · test PKCS12 lab (`70856d4e…f224`) |
| Runtime `files.json` SHA-256 | `79c5a294eb02d1eb00a37ec3df59d69a403361a462a26b0e50e05033ca1513f0` |
| Bundle id | `5f71ab213cfab8c284fe0b94814845ec1fcd5a0e82a8ffd0ed76d3c64ed5b54e` |
| Commercial runtime bundle SHA-256 | `8fac015e6f7e8c687da54df5f41d6ef182cb7da0bc23bfdd34d2b2c588ca5df3` |
| Integrity manifest | `docs/product/android-commercial-integrity-manifest-20261124.json` |

## Traceability

- Prior signed APK (tree `eb1528ce`): SHA-256 `166b48e6875960fe1598aa1ae42bd3b664a18ac9a11b73a1db3f63c9015f6da9` · versionCode 3.
- This APK supersedes that build: Central commercial composition + DeviceProof native client + API 28 App Links guide + safe `adb install -r`.
- Build started from parent `d08f5ae1`; definitive HEAD / `apk_built_from_tree`: `238160656b3768e97e865b87ac397aa1b93713ab`.

## Build commands observed

```text
node tools/android-lab-probes/bundle-commercial-runtime.mjs
node tools/android-lab-probes/package-runtime-assets.mjs
gradle -p apps/pos-android commercialApk
```

## Observed results

- `commercialApk`: BUILD SUCCESSFUL · APK_VERIFIED v2 · package `co.camachopos.colombia` · versionCode 4 · versionName `0.3.2-central-composition`
- `pnpm architecture:check` / ARCH-003: PASS (after staging-runtime cleanup)
- Host unit tests `android-commercial-host.test.ts`: 8 passed (includes token→SSA assertions path)

## Not claimed

- Live Central deploy with commercial provision / SSA-SAS / DB 008–016
- DAL published + OS App Links verify on M60WL
- DeviceProof enrollment on physical terminal
- CH340 / PRINT / drawer electrical profile
- Play production signing
- Simulated BUSINESS login

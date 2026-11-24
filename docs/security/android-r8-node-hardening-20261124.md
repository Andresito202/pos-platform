# Android R8 / Node runtime hardening prep — 2026-11-24

Branch: `cursor/android-r8-hardening-c53a` (from PR #136 @ `64d4430e`).

## What shipped

| Item | Status |
|---|---|
| D8 dex (default `commercialApk`) | Unchanged — API 28 / M60WL compatible |
| Optional R8 `--release` | `-PcommercialR8Shrink=true` + `proguard/commercial-r8.pro` |
| Keep rules for host + JNI | Present; Node asset paths not obfuscated (assets copied verbatim) |
| `AndroidRuntimeIntegrity` | Already on #136 — root/Frida/debug fail-closed for BUSINESS |
| Embedded runtime `files.json` verify | Wired into `AndroidCommercialHost.start()`; `ANDROID_REQUIRE_RUNTIME_MANIFEST=1` / `ANDROID_COMMERCIAL_PACKAGED=1` fail-closed if missing |

## Explicitly not done

- Enabling R8 shrink by default (needs physical M60WL validation).
- Play App Signing / production keystore in Git.
- Google Play Integrity dependency.

## Operator note

Lab PKCS12 remains lab-only. Commercial upload key stays in secret manager outside the repo.

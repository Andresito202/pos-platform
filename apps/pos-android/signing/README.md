# Commercial release signing

Use an externally managed PKCS12 release key. Never commit keys or passwords. Set `CAMACHO_ANDROID_RELEASE_KEYSTORE`, `CAMACHO_ANDROID_RELEASE_ALIAS`, `CAMACHO_ANDROID_RELEASE_CERT_SHA256`, `CAMACHO_ANDROID_RELEASE_STORE_PASSWORD` and `CAMACHO_ANDROID_RELEASE_KEY_PASSWORD` through the trusted release environment. Run `gradle -p apps/pos-android commercialReleaseApk`. The certificate fingerprint must match the registered Central Android identity. No fallback key exists. Signing does not certify deployment or physical hardware.

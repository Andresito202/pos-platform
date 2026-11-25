# Commercial release signing

The CI unsigned APK is the release input. Never rebuild silently when signing.

Download the exact successful workflow artifact, unpack the APK, and verify its SHA-256 against the APK_SHA256 line in that run. Set CAMACHO_ANDROID_UNSIGNED_APK and CAMACHO_ANDROID_UNSIGNED_APK_SHA256 from those verified inputs. Use an externally managed PKCS12 release key with CAMACHO_ANDROID_RELEASE_KEYSTORE, CAMACHO_ANDROID_RELEASE_ALIAS, CAMACHO_ANDROID_RELEASE_CERT_SHA256, CAMACHO_ANDROID_RELEASE_STORE_PASSWORD and CAMACHO_ANDROID_RELEASE_KEY_PASSWORD supplied through a trusted environment. Never commit private keys or passwords.

Run gradle -p apps/pos-android commercialReleaseApk. Output is build/commercial-release/camacho-pos-colombia.apk. Existing output is rejected; preserve prior releases separately. The signer verifies the input digest before and after signing, enforces the explicitly approved certificate, verifies APK signatures v2 and v3, and prints the signed APK digest. CI compiles the signer without private credentials. It does not issue release signatures.

The registered Central Android certificate SHA-256 must be the same certificate, in uppercase colon-separated form. Central must publish the exact Android App Links association for co.camachopos.colombia at the configured commercial origin. A valid APK signature alone does not activate BUSINESS authorization. A first commercial identity or any key rotation requires explicit operator approval and secure backup; a previous production installation requires signer continuity. No test key or fallback identity is supported.

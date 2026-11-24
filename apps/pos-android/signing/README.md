# Firmado de prueba Android

Generar un PKCS12 de laboratorio (no producción):

```bash
keytool -genkeypair -keystore camacho-android-test.p12 -storetype PKCS12 \
  -storepass camacho-test-only -keypass camacho-test-only \
  -alias hardware-lab -keyalg RSA -keysize 2048 -validity 825 \
  -dname 'CN=Camacho POS Colombia Android Test, O=Camacho POS Colombia, C=CO'
export CAMACHO_LAB_APK_PASSWORD=camacho-test-only
gradle -p apps/pos-android commercialApk
```

El alias `hardware-lab` coincide con `SignApk.java` existente.

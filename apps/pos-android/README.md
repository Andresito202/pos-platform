# Camacho POS Colombia — Android comercial

Package: `co.camachopos.colombia` · minSdk 28 · M60WL.

## Build

```bash
# 1) Motor Node/SQLite (pipeline lab aprobado, sin Docker si ar/gpg/NDK están en host)
cd tools/android-lab-probes
node prepare-runtime.mjs
python3 verify-runtime-inputs.py build/runtime-inputs
python3 extract-runtime.py build/runtime-inputs build/runtime-root
python3 compile-runtime-addon.py . /ruta/android-ndk-r27d
# bundle commercial runtime-service into runtime-root/runtime-service.mjs (see CI notes)
node package-runtime-assets.mjs

# 2) Copiar assets al APK comercial
apps/pos-android/scripts/prepare-commercial-assets.sh

# 3) Firmar APK de prueba
export CAMACHO_LAB_APK_PASSWORD=...
gradle -p apps/pos-android commercialApk
```

Salida: `apps/pos-android/build/commercial-apk/camacho-pos-colombia.apk`.

## Runtime

El servicio embebido ejecuta `AndroidCommercialHost` sobre Local Service:
login operador real, `CommercialRequestHandler` cuando hay provisión,
licencias vía `LicenseCapacityGate` (sin gracia offline), hardware/sync
según provisión. Sin mocks.

Lab probes históricos: `tools/android-lab-probes/` (no producto).

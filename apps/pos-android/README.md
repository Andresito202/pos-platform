# Camacho POS Colombia — Android comercial

Package: `co.camachopos.colombia` · minSdk 28 · M60WL.

## Build

```bash
# 1) Motor Node/SQLite (pipeline lab aprobado)
cd tools/android-lab-probes
node prepare-runtime.mjs
python3 verify-runtime-inputs.py build/runtime-inputs
python3 extract-runtime.py build/runtime-inputs build/runtime-root
python3 compile-runtime-addon.py . /ruta/android-ndk-r27d
node bundle-commercial-runtime.mjs
node package-runtime-assets.mjs

# 2) Assets comerciales
apps/pos-android/scripts/prepare-commercial-assets.sh

# 3) APK firmada de prueba
export CAMACHO_LAB_APK_PASSWORD=camacho-test-only
gradle -p apps/pos-android commercialApk
sha256sum apps/pos-android/build/commercial-apk/camacho-pos-colombia.apk
```

Salida: `apps/pos-android/build/commercial-apk/camacho-pos-colombia.apk`.

## Runtime

- Entrada BUSINESS: App Links + DeviceProof native-request + SSA (`session.activate` / `session.recover`).
- `local.operator.login` no autoriza operaciones comerciales en este host.
- IPC comercial: `IpcRequestSchema` fail-closed tras mensajes host-only `android.business.*`.
- Contratos: caja, ventas/carrito, catálogo, inventario, clientes, pagos, hardware, licencia/trial 120h (PR #135).
- Hardware: `UsbHostTransport` existente; CH340/impresora por descubrimiento USB; cajón bloqueado sin perfil eléctrico verificado.
- Instalación M60WL: `docs/product/android-m60wl-install-enroll-test.md`.
- Integridad APK: `docs/product/android-commercial-integrity-manifest-20261124.json`.

Lab probes: `tools/android-lab-probes/` (no producto).

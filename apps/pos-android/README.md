# Camacho POS Colombia — Android comercial

Owner: POS Local Service + superficie Android. Continuidad desde el diagnóstico
sobre `feat/android-commercial-runtime` y `main` actual. **No** es un rename de
los probes de laboratorio.

## Separación lab vs producto

| Árbol | Package | Rol |
|---|---|---|
| `src/main` (este APK) | `co.camachopos.colombia` | Producto comercial Camacho POS Colombia |
| `tools/android-lab-probes/` | `co.camachopos.android.probe` / `.runtimeprobe` | Evidencia histórica de motor/SQLite/Keystore — **no** se distribuye como POS |

Los probes en `tools/android-lab-probes/` se conservan para reutilizar el motor Node/SQLite embebido,
scripts de empaquetado y verificadores. El APK comercial tiene aplicación,
manifest, branding amarillo aprobado y gates fail-closed propios.

## Bloque 1 — Runtime

- Host nativo Kotlin API 28 / M60WL.
- Servicio local no exportado + custodia Keystore (cuando el engine está empaquetado).
- Foundation TS: `AndroidServiceFoundation` / `AndroidKeystoreKeyProvider` en
  `pos-local-service` (DEC-020: sin outbox/comercio antes de local-security).
- Compilación APK shell comercial (`commercialShellApk`) sin fingir sesión ni venta.

## Bloques siguientes

2 Login/roles/UI amarilla táctil · 3 Caja/catálogo/offline · 4 Hardware ·
5 Central/FACTUS/Nequi/trial PR #135 · 6 Seguridad/aislamiento/expiración/update.

## Compilar shell comercial (Linux)

```bash
# Requiere JDK 17+, red para resolver aapt2/r8/android-all stub.
cd apps/pos-android
./gradlew commercialShellApk \
  -PsignerSource=../pos-local-service/native/android-hardware/host/tools/SignApk.java \
  -PprobeSigning=/ruta/al/keystore-lab.jks
```

Sin keystore de laboratorio el task empaqueta `unsigned` y detiene el firmado;
no inventa firmas ni publica a Play.

## Evidencia física previa

Las pruebas M60WL 2026-10-21/22 documentadas bajo `docs/testing/android-*-2026-10-*.md`
acreditan el motor lab. No se repiten aquí salvo certificación de la integración
nueva. Este árbol en `main`-based **no** afirma END_TO_END ni PRODUCTION.

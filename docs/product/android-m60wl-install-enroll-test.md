# M60WL — instalación, enrolamiento y pruebas (PR #136)

Package: `co.camachopos.colombia` · minSdk 28 (Android 9) · APK firmada de prueba (PKCS12 lab).

## 1. Precondiciones en el PC

1. APK firmada del HEAD definitivo de PR #136 (ver manifiesto de integridad).
2. `adb` con el M60WL en modo depuración USB (`adb devices` → `device`).
3. Central HTTPS alcanzable (`https://central.camachoposcolombia.com`) con:
   - `CENTRAL_COMMERCIAL_PROVISION_FILE` + SSA/SAS trust publicados
   - migraciones Identity 008–016 aplicadas
4. DAL publicada en `/.well-known/assetlinks.json` con el SHA-256 del firmante instalado (el JSON `android-assetlinks-prepared-not-published.json` es preparación; no acredita publicación).
5. Dispositivo enrolado Device Trust y aprovisionamiento local con `POS_CENTRAL_BASE_URL` + `POS_ANDROID_COMMERCIAL_PROVISION_FILE` (`CAMACHO_ANDROID_COMMERCIAL_V2`) (+ capacidad firmada trial 120h de PR #135 cuando exista).

## 2. Actualización segura (sin desinstalar)

Conservar datos, Keystore, identidad Device Trust y licencias locales:

```bash
# Verificar digests del manifiesto antes de instalar
sha256sum camacho-pos-colombia.apk

# Actualización in-place. NO usar adb uninstall.
adb install -r camacho-pos-colombia.apk

# Si -r falla por firma distinta, NO desinstalar a ciegas: detener y reconciliar
# el firmante. Borrar el paquete elimina Keystore/datos/licencias locales.

adb shell dumpsys package co.camachopos.colombia | grep -E 'versionName|versionCode|signatures|pkgFlags|dataDir'
```

Confirmar `versionName` / `versionCode` del manifiesto. Firma test ≠ Play production.

## 3. Enrolamiento DeviceProof

1. Completar enrolamiento Device Trust del M60WL contra `/v1/device-enrollment` con binding tenant/company/installation/device del aprovisionamiento.
2. Verificar en el servicio local: credencial ACTIVE, auditoría `DEVICE_ENROLLMENT_COMPLETED`, key local = public key certificada.
3. Sin este paso, el host no puede firmar DeviceProof hacia native-requests/token (fail-closed; no se simula).

## 4. App Links en Android 9 (API 28)

`pm get-app-links` / `pm verify-app-links` son de Android 12+ y **no** deben usarse como evidencia en M60WL.

### 4.1 Publicar DAL

Publicar `https://central.camachoposcolombia.com/.well-known/assetlinks.json` con:

- `package_name`: `co.camachopos.colombia`
- `sha256_cert_fingerprints`: fingerprint del APK instalado (no el de preparación si el release cambia)

### 4.2 Comprobaciones compatibles con API 28

```bash
# 1) Intent-filter autoVerify presente en el paquete instalado
adb shell dumpsys package co.camachopos.colombia | grep -A2 -E 'android.intent.action.VIEW|autoVerify|camachoposcolombia'

# 2) Estado de dominio / verificación del Intent Filter (Android 9)
adb shell dumpsys package d | grep -A20 'co.camachopos.colombia' || true
adb shell dumpsys package domain-preferred-apps | grep -A10 'co.camachopos.colombia' || true

# 3) Simular el callback HTTPS (debe abrir BusinessAuthorizationCallbackActivity, no el navegador)
adb shell am start -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE \
  -d 'https://central.camachoposcolombia.com/android/callback?code=TEST&state=TEST'

# 4) Log de verificación de App Links del Package Manager (si el OEM lo emite)
adb logcat -d | grep -iE 'IntentFilterIntentOp|Verification|digital.?asset|StatementService' | tail -50
```

El fetch HTTPS de `assetlinks.json` dentro de la app **no** acredita verificación OS. En Android 9 hay que observar dominio asociado / autoVerify en `dumpsys` y que el VIEW HTTPS abra la Activity de callback.

Si el dominio no queda verificado tras publicar DAL: reiniciar el terminal, esperar la reconsulta del Package Manager, o borrar datos de red/caché del sistema **sin** desinstalar la app comercial.

## 5. Login BUSINESS

1. Abrir Camacho POS Colombia → **Ingresar con BUSINESS**.
2. App verifica DAL → PKCE → `POST /v1/commercial/native-request-challenges` → DeviceProof `POST /v1/commercial/native-requests` → navegador `?request=` (43 chars).
3. Completar MFA BUSINESS en el navegador del sistema (`/v1/commercial/login` + authorize).
4. Callback App Link → DeviceProof `POST /v1/commercial/token` → `POST /v1/business-session/assertions` (SSA) → `session.activate`.
5. Sin provision commercial Central / DeviceProof / DAL, el acceso permanece fail-closed (no acceso falso).

## 6. Pruebas funcionales (sin simular hardware)

Con SSA activa y capacidad/licencia válida:

| Superficie | Acción | Resultado esperado |
|---|---|---|
| Caja / turnos | Abrir y cerrar turno | Contratos `cash.shift.*` |
| Ventas | Crear venta offline | `sale.create` + outbox |
| Catálogo / inventario / clientes | Listar / consultar | Contratos existentes |
| Pagos | Efectivo / transferencia / FACTUS Pay | Sin inventar montos |
| Licencia | Ver estado trial 120h | Grace offline 0; gate local |
| Capacidades | `authorization.capabilities.get` | Solo permisos del SAS |

## 7. Hardware (solo observación física)

No simular. En el M60WL:

1. Conectar balanza CH340 (`1A86:7523`) → permiso USB → lectura estable.
2. Impresora Gprinter (`6868:0500`) → comando PRINT.
3. Cajón: permanece bloqueado con `M60WL_DRAWER_ELECTRICAL_PROFILE_UNVERIFIED` hasta perfil eléctrico autorizado.

## 8. Evidencia a capturar

- Screenshot login BUSINESS (fail-closed o éxito real).
- Salida `dumpsys package` / dominio App Links en API 28.
- SHA-256 del APK instalado = manifiesto (tras `adb install -r`).
- Una venta offline + sync cuando Central esté disponible.
- Lectura CH340 / ticket impreso cuando el hardware esté conectado.

## Bloqueos reales restantes

- Publicación DAL en el host Central productivo y verificación OS en el M60WL.
- Despliegue Central con `CENTRAL_COMMERCIAL_PROVISION_FILE` + claves SSA/SAS + DB 008–016.
- Enrolamiento DeviceProof en el terminal físico.
- CH340 / PRINT / perfil eléctrico del cajón.
- Firma Play (fuera de alcance de esta APK de prueba).

# M60WL — instalación, enrolamiento y pruebas (PR #136)

Package: `co.camachopos.colombia` · minSdk 28 · APK firmada de prueba (PKCS12 lab).

## 1. Precondiciones en el PC

1. APK firmada del HEAD definitivo de PR #136 (ver manifiesto de integridad).
2. `adb` con el M60WL en modo depuración USB (device, no offline).
3. Central HTTPS alcanzable desde el terminal (`https://central.camachoposcolombia.com`).
4. DAL publicada en `/.well-known/assetlinks.json` con el SHA-256 del firmante **de release** (el artefacto `android-assetlinks-prepared-not-published.json` es preparación; `publication_status: NOT_PUBLISHED` hasta publicación real).
5. Dispositivo enrolado Device Trust (credencial ACTIVE) y aprovisionamiento local con `POS_CENTRAL_BASE_URL` + `POS_LICENSE_CAPACITY_PROVISION_FILE` cuando haya capacidad firmada (trial 120h de PR #135).

## 2. Instalación

```bash
# Verificar digests del manifiesto antes de instalar
sha256sum camacho-pos-colombia.apk

adb uninstall co.camachopos.colombia || true
adb install -r camacho-pos-colombia.apk
adb shell dumpsys package co.camachopos.colombia | rg -n 'versionName|versionCode|signatures|pkgFlags'
```

Confirmar `versionName` / `versionCode` del manifiesto. Firma test ≠ Play production.

## 3. Enrolamiento DeviceProof

1. Completar enrolamiento Device Trust del M60WL contra Central (ruta existente `/v1/device-enrollment`) con binding tenant/company/installation/device del aprovisionamiento.
2. Verificar en el servicio local: credencial ACTIVE, auditoría `DEVICE_ENROLLMENT_COMPLETED`, key local = public key certificada.
3. Sin este paso, `android.business.native_request` permanece `BUSINESS_NATIVE_REQUEST_UNAVAILABLE` (fail-closed; no se simula).

## 4. App Links

```bash
adb shell pm get-app-links co.camachopos.colombia
# Tras publicar DAL con el fingerprint real:
adb shell pm verify-app-links --re-verify co.camachopos.colombia
adb shell pm get-app-links co.camachopos.colombia
```

El fetch HTTPS de `assetlinks.json` en la app **no** acredita verificación OS. En Android 9 del M60WL hay que observar `verified` / dominio `central.camachoposcolombia.com`.

## 5. Login BUSINESS

1. Abrir Camacho POS Colombia → **Ingresar con BUSINESS**.
2. La app verifica DAL → prepara PKCE → registra native-request con DeviceProof → abre navegador con `?request=` (43 chars).
3. Completar MFA BUSINESS en el navegador del sistema.
4. El callback App Link vuelve a la app → canje `/v1/commercial/token` → `session.activate` con SSA.
5. Si Central aún no activó las rutas nativas, el mensaje debe ser fail-closed (no acceso falso).

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
- `adb shell pm get-app-links` post-verify.
- SHA-256 del APK instalado = manifiesto.
- Una venta offline + sync cuando Central esté disponible.
- Lectura CH340 / ticket impreso cuando el hardware esté conectado.

## No acreditado por este documento

- Publicación productiva de DAL.
- Emisor SSA/SAS productivo si las rutas Central siguen `NATIVE_BUSINESS_ROUTE_NOT_ACTIVATED`.
- Firma Play / MSIX.
- Cajón eléctrico sin perfil verificado.

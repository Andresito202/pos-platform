# PR #130 — acceso móvil sandbox FACTUS Pay (Android)

**HEAD base:** `ae6f08d9811071c17c3d9a9173957d4d81543595`  
**Rama:** `cursor/commercial-license-global-c53a` · PR #130 Draft

## Conclusión

`RUNTIME_VERIFIED` = **false**

El panel GLOBAL existente (`/platform` HTTPS + WebAuthn MFA) ya es el canal autenticado correcto para mostrar/recuperar el QR. **No** se declara operativo desde Android en este entorno: Central GLOBAL desplegado/alcanzable **no** está verificado aquí.

El simulador oficial FACTUS Pay es **solo cámara** (`Iniciar Cámara` / `getUserMedia`). **No** admite importar imagen. Con un único teléfono no se puede escanear un QR mostrado en la misma pantalla de forma fiable.

## Hallazgos de auditoría

| Tema | Hallazgo |
|---|---|
| Canal GLOBAL | `PlatformSubscriptionQuote` + `create`/`recover-collection` con sesión GLOBAL + MFA |
| Despliegue | Portal requiere origen HTTPS administrado de Central; no probado desde Android aquí |
| Simulador | Camera-only; sin gallery/file input en UI oficial |
| Lab vs comercial | `ephemeral_lab_service_issue` ≠ `global_quote_end_to_end` |

## Correcciones en este tip

1. **Windows ACL:** `hardenPrivateFilesystemPath` aplica `icacls /inheritance:r` + grant usuario actual; POSIX usa `0700`/`0600`. No se afirma aislamiento NTFS por chmod.
2. **CREATED/RECOVERED:** clasificación por GET previo auténtico (`NOT_FOUND` → POST); no por igualdad de dos GET.
3. **Evidencia separada:** `provider_paid_observed`, `ephemeral_lab_service_issue`, `global_quote_end_to_end`, `license_allocated`, `device_activated`, `runtime_verified`.
4. **GLOBAL recover QR:** `POST /v1/platform/subscription-quotes/recover-collection` + UI “Recuperar QR” / “Descargar QR PNG”.

## Procedimiento móvil (cuando Central HTTPS GLOBAL exista)

1. Abrir `https://<origen-central>/platform` en Android.
2. Login GLOBAL (contraseña + autenticador). MFA no se omite.
3. Abrir cotización o “Recuperar QR” de un pendiente.
4. “Descargar QR PNG” y mostrarlo en **otra superficie** (impresión, segunda pantalla, otro dispositivo).
5. En el mismo Android: https://pay-api-sandbox.factus.com.co/simulator → Iniciar Cámara → escanear → “Sin error (pago exitoso)”.
6. Volver al panel → “Verificar cobro y emitir licencia”.

## Bloqueos actuales

1. `GLOBAL_PORTAL_DEPLOYMENT_NOT_VERIFIED_FROM_ANDROID`
2. `FACTUS_SIMULATOR_CAMERA_ONLY_SINGLE_PHONE_GAP`
3. `PROVIDER_PAID_NOT_OBSERVED`
4. `global_quote_end_to_end=false`

Lab `pr130-lab-*` permanece fuera del bootstrap de producción (`main.ts` no lo importa).

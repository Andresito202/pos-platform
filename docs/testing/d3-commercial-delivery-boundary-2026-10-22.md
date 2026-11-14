# D3 — límite de implementación comercial (2026-10-22)

El propietario autorizó implementar los siete frentes. La autorización de desarrollo **no certifica** un despliegue, claves, un RP, un paquete Android o pruebas físicas de hardware.

## Estado comprobado en la rama
- `central-authority/src/main.ts` ya crea un servidor HTTPS con certificados leídos de archivos y expone health, session-trust y device-enrollment; **no** expone endpoints humanos de OAuth.
- Los códigos PKCE están implementados **solo para pruebas PostgreSQL aisladas**; 46 pruebas BUSINESS habían aprobado en Windows según salida aportada el 22-10-2026.
- El binding devuelto por el intercambio no es access/refresh ni credencial utilizable.
- No hay evidencia de un dominio RP/HTTPS real, asociación assetlinks para la firma de Android, custodia aprobada de claves de firma de access, ni ejecución E2E de Windows/Android.

## Secuencia de aprobación sin atajos
1. Definir códigos canónicos separados para **AUTHORIZATION_CODE_ISSUED / REDEEMED / REJECTED** y **ACCESS_ISSUED / REFRESH_ROTATED / REFRESH_REUSE_DETECTED**, incluyendo resultado/razón y migración canónica revisada. No registrar `SESSION_REVOKED` al emitir códigos.
2. Definir contrato de seguridad D3 versionado: issuer/audience, JWT o token opaco, confirmación de clave de dispositivo, validación de sesión y revocación, TTL, rotación/reuse de refresh con locks y unicidad, límites de abuso, y comportamiento offline. Aprobar formalmente antes de activar el flujo.
3. Provisionar servicios reales mediante responsable autorizado: dominio HTTPS controlado, RP WebAuthn, claves separadas DEVICE_TRUST/access, clientes nativos distintos, redirecciones exactas. **Nunca** subir secretos a Git.
4. Implementar transacciones de emisión/rotación y repositorios canónicos; después rutas HTTPS `/authorize`, `/token` y endpoints de MFA, con CSRF, PKCE y protección antiabuso. No abrir endpoint con stubs de aprobación.
5. Integrar Electron desde main process (navegador externo y listener loopback de un solo uso) y Android con App Link verificado, keystore y navegación restringida.
6. Certificar E2E: servidor con TLS real, PostgreSQL central, Windows real, Android 9+ y dispositivo físico, incluyendo sesiones revocadas, rotación, recuperación, offline, reinstalación y revocación de claves.

La función `inspectD3DeploymentEvidence` valida exclusivamente la consistencia **estructural** de un conjunto de datos de despliegue. `ready:true` no constituye aprobación criptográfica, certificación de DNS ni permiso para habilitar endpoints productivos. La central continúa sin rutas de login humano hasta conectar las autoridades, políticas y firmas reales.

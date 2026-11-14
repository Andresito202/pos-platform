# Cierre técnico del montaje Windows

Desde e1f9d4f98345eb3224844377a497c1a573673d01. Primera corrección Central:
186168ae. Evidencia anterior se conserva; este informe sustituye únicamente las
menciones a montaje Central, entrada main y logout nativo pendientes.

## Materializado y cerrado en este incremento

- Central usa el listener, Identity, 011/012 y contador SAS 015 existentes;
  montaje canónico probado con runner real. Véase central-commercial-deployment-2026-10-26.md.
- Desktop production-entry carga POS_WINDOWS_DESKTOP_COMMERCIAL_FILE, archivo
  público administrado CAMACHO_WINDOWS_DESKTOP_V2, con registration ELECTRON
  exacta, rp_id, webauthn_origin y attempt_timeout_ms obligatorio. Sin archivo
  no se monta la entrada. Sin confianza/enrolamiento el Service sigue denegando.
- Menú nativo Cuenta: iniciar/cambiar usuario, cancelar y cerrar. No cambia el
  diseño React ni el preload. Usa canal dedicado autenticado; antes de cambiar
  usuario recupera y cierra la sesión anterior. Tras activación React vuelve a
  resolver las capacidades del backend; main no concede permisos.
- Logout nativo comercial cerrado: payload IPC vacío, sesión del vínculo del
  servidor, firma REVOKE de CommercialProofV2, ruta fija /v1/commercial/revoke,
  token hash y binding exactos, nonce 012 y revocador BUSINESS/familias existente.
  La prueba de refresh no sirve para REVOKE. No es DPoP ni firma arbitraria.
- Service escribe BUSINESS_SESSION_CLOSED en auditoría append-only, invalida
  todos los vínculos de esa sesión y reemplaza custodia DPAPI por CLOSED antes
  de red. Conserva SSA/SAS y watermarks. Recuperar o activar nuevamente esa
  sesión queda denegado aun tras reinicio. Sin red informa SIGNED_OUT_LOCAL,
  nunca revocación central confirmada. No hay reintento automático de logout
  después de destruir la credencial; el operador puede revocar en Central.

## Pruebas observadas

Informes en artifacts/windows-p0/2026-10-26/:

| Informe | PASS | FAIL final | Alcance |
|---|---:|---:|---|
| central-deployment-final.json | 3 | 0 | Montaje canónico HTTPS, capability, budget SQL |
| commercial-runner-final.json | 3 | 0 | 008–016, concurrencia y rollback |
| native-revoke-central.json | 1 | 0 | Integración ampliada con logout V2, fallo auditoría/rollback y replay |
| native-logout-windows.json | 3 | 0 | DPAPI real, cierre online/offline, reinicio y fallo auditoría |
| desktop-account-final.json | 30 | 0 | Nueva entrada y regresiones directas main/callback/aislamiento |
| logout-ssa-store-regression.json | 48 | 0 | Store SSA directamente modificado: activación, integridad y watermarks |
| electron-account-final.json | 1 | 0 | Electron real + nuevo coordinador de cuenta + HTTPS + PostgreSQL + DPAPI + grants SQL + dashboard + renovación |

La integración Central ampliada incluye el primer caso de central-deployment;
no sumar esa repetición como cobertura distinta. No se repitieron suites de caja,
ventas, canal comercial completo ni Argon2id. TypeScript de los paquetes afectados,
build Desktop y build:artifact Service aprobaron. Arquitectura 16/16 y ARCH-003,
política del repositorio PASS. Artefacto Service SHA256:
46a86706a047b8716f820f7bb25b7761381b8ceaaf55b1799494b9d4406c1458.

Fallos conservados: fixture del rollback usaba el nombre conceptual del evento;
se corrigió a PLATFORM_SESSION_REVOKED antes del PASS. Primer E2E intentó captura
opcional con pantalla Windows no disponible; falló antes de autenticarse. Se
repitió solamente el mismo E2E sin capturas opcionales y aprobó. Esto no acredita
una inspección visual ni un autenticador físico. Los 212 casos filtrados del
archivo E2E no se ejecutaron.

## Aprovisionamiento pendiente, sin valores inventados

1. Operador y servidor Central auténticos; DNS/HTTPS y cadena TLS confiable para
   navegador y Windows. PostgreSQL con sslmode=verify-full y rol pos_platform_app.
2. Operador aplica el runner aprobado con pos_migrator, objetivo/SHA exactos y
   timeouts explícitos. Esta sesión sólo usa bases temporales; no aplica DDL
   comercial. Obtener schema_checksums con postgres:commercial:apply --manifest.
3. Proporcionar CAMACHO_CENTRAL_COMMERCIAL_V2 mediante
   CENTRAL_COMMERCIAL_PROVISION_FILE: registros reales de recipient, factor y
   membresía, rechazo Argon2id administrado, claves operacionales access/SSA/SAS
   distintas y ventanas, raíces públicas y pins verificados, publicaciones y
   todos los límites explícitos del schema central-commercial-provision.ts.
   La composición actual está acotada al factor/membresía configurados; no
   publica un catálogo multiempleado ni infiere identidad de UUIDs del cliente.
4. DEV-003 auténtico y claves públicas verificadas del dispositivo/instalación.
   Service: POS_WINDOWS_COMMERCIAL_PROVISION_FILE y provisión SSA/SAS existentes;
   custodia bajo la cuenta Windows administrada, sin secretos en main/renderer.
5. Desktop: archivo público CAMACHO_WINDOWS_DESKTOP_V2 coincidente con el registro
   Service/Central; no generar otra inscripción desde React. Proveer valores
   operativos aprobados, no copiar los valores temporales de los tests.
6. Instalar artefacto Service y Desktop; persona/autenticador físico: menú Cuenta
   → navegador HTTPS → contraseña/MFA → confirmar destino → BUSINESS → SSA/SAS
   → permisos efectivos → dashboard → renovación → logout → rechazo/reinicio.

IMPLEMENTED: sí. TESTED: integración temporal y Windows/DPAPI/Electron observados.
CERTIFICADO CON PERSONA: no. APTO PARA PRODUCCIÓN: no. Falta despliegue auténtico,
parámetros, aplicación operativa y certificación humana. PR #96 permanece Draft;
Actions no consultado ni disparado; CI exacto pendiente cuando se restablezca.

No reabrir PKCE, MFA, DPAPI, SAS/provisión/raíz o integración V2 sin defecto
demostrado. Siguiente orden autorizado: licencias (una caja), luego rendimiento.

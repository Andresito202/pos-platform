# Provisión comercial del laboratorio Windows — 2026-11-04

## Diferencia comprobada

El propietario ejecutó el preflight en Windows Server: configuración y TLS
válidos, confianza SSA/SAS presente; faltan las provisiones BUSINESS y GLOBAL.
`000001-authority-plan.json` sólo contiene perfil, entorno, origen, separación
de propósitos, claves públicas, fecha y marca de autoridad productiva. No
contiene políticas comerciales ni registro de cliente. No es una provisión.
La recuperación DPAPI del dispositivo figura `OS_BOUND`,
`dpapiSameIdentityRecovery=true`, `deviceRegistered=false` en el recibo histórico.
El alta humana MFA y la publicación ADMIN se conservan; no se repiten.

## Código independiente implementado

`tools/operators/windows-login-lab-commercial-provision.mts` recibe
`--validate|--publish --lab-root <raíz existente> --candidate <archivo explícito>`.
Exige Server 2022, administrador interactivo y custodia protegida de la autoridad.
No repara ACL, crea claves ni interpreta un JSON como prueba de autenticación.

Valida el contrato `CentralCommercialProvisionSchema` existente sin valores
por defecto. Sólo admite el laboratorio, PREPRODUCTION, RP/origen HTTPS 8443,
PostgreSQL TLS verify-full con pos_platform_app y rutas dentro de la autoridad.
Si el entorno guardado declara PGPASSFILE, reutiliza únicamente el archivo TLS
existente del laboratorio, sin imprimir ni cambiar contraseñas, y restaura la
variable del proceso al terminar.
Reutiliza `prepareCentralCommercialRuntime` para comprobar migraciones,
firmas, destinatario, membresía, factor y registro activo del dispositivo.
La validación usa una copia temporal exclusiva y estable dentro de la custodia,
eliminada al terminar. Sólo tras éxito publica ese archivo completo mediante
un enlace NTFS nuevo, sin reemplazar destinos; rechaza cambios de su copia de
validación. Una edición concurrente del candidato original no cambia la copia.
No sustituye archivos previos ni carga GLOBAL.
No inicia listeners, SCM, Electron ni una sesión; tampoco registra dispositivos.

No se ejecutó la validación completa contra la VM: todavía no existe el
candidato completo ni está demostrado el enrolamiento DEV-003. Las pruebas
locales verifican argumentos, esquema, ámbito, límites explícitos, separación
de archivos y errores sin secretos. También prueban archivos/enlaces temporales
reales: publicación, limpieza ante error, preservación y cambio de copia durante
validación. No prueban firmas ni PostgreSQL físicos.

## Propuesta única para el laboratorio: NO APROBADA / NO ACTIVADA

Estos son parámetros candidatos de una prueba humana acotada. No se cargan
desde este documento y no sustituyen una decisión de producción. Se proponen
para hacer observables renovación, expiración y límites de reintento con las
implementaciones existentes; no se presentan como valores normativos.

Referencia candidata: `CAMACHO_LAB_BUSINESS_POLICY_2026_11_04_V1`.
Cliente candidato: `CAMACHO_WINDOWS_SCM_LAB_V1`, ELECTRON, origen existente
`https://auth.camacho-pos.local:8443`, RP `auth.camacho-pos.local`.
Callback candidato: `http://127.0.0.1:54021/callback`, sólo después de comprobar
disponibilidad y registrarlo exactamente en Central y Electron. El puerto no
se prueba ni se cambia silenciosamente durante esta preparación.
El navegador externo, PKCE y retorno loopback se apoyan en
[RFC 8252](https://www.rfc-editor.org/rfc/rfc8252); las defensas de renovación
se contrastan con [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700).
Ninguno de esos textos aprueba los tiempos concretos de esta propuesta ni
convierte el protocolo propio CommercialProofV2 en DPoP.

```json
{
  "session_ms": 1800000,
  "mfa_age_ms": 120000,
  "reauthentication_ms": 900000,
  "context_age_ms": 30000,
  "mfa_challenge_ms": 120000,
  "handoff_ms": 30000,
  "browser_ms": 1800000,
  "browser_idle_ms": 600000,
  "refresh_family_ms": 1800000,
  "access_ms": 60000,
  "proof_skew_ms": 30000,
  "rotation_window_ms": 60000,
  "maximum_rotations": 10,
  "native_challenge_ms": 60000,
  "native_request_ms": 120000,
  "native_code_ms": 60000,
  "maximum_challenges_per_minute": 5,
  "maximum_login_attempts": 5,
  "http_maximum_body_bytes": 16384,
  "http_requests_per_minute": 60,
  "http_maximum_buckets": 1000,
  "sas_ms": 60000,
  "ssa_claim_age_ms": 30000,
  "ssa_offline_ms": 120000,
  "sql_lock_timeout_ms": 5000
}
```

Las ventanas de las claves se tomarán de artefactos existentes verificados;
no se extenderán ni se fabricarán. El riesgo de ventanas breves es más
reintentos/reautenticaciones en una VM con poca RAM. El bloqueo SQL global
mantiene su coste entre empresas y timeout explícito. El perfil no autoriza
operación offline prolongada ni amplía los 17 permisos ADMIN ya aprobados.

## Siguiente composición pendiente

1. Decisión específica sobre estos parámetros y cliente de laboratorio.
2. DEV-003: comprobar el registro actual y enrolar, si falta, la clave ya
   custodiada en SCM mediante activación canónica y prueba de posesión fresca.
   Un recibo anterior, UUID o clave pública no sustituyen ese paso.
3. Componer el candidato con el ámbito ADMIN real y confianza firmada que
   coincida con ese ámbito. No copiar destinatarios históricos incompatibles.
4. Validar/publicar con el nuevo operador y arrancar mediante Central y el
   coordinador Windows existentes. GLOBAL se aprovisiona por separado cuando
   exista su identidad/autorización real; no es una elevación de BUSINESS.
5. Ejecutar el login humano posterior y probar SSA/SAS, permisos, dashboard,
   renovación, logout y revocación. Hasta observarlo: NO CERTIFICADO.

No se han modificado login, contratos, migraciones, diseño, claves, permisos,
SCM, workflows ni oracleJdk-27. Se conserva el trabajo concurrente `.claude/`.

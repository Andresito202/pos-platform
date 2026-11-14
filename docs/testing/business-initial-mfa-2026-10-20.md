# MFA inicial BUSINESS — 2026-10-20

Continuidad posterior: [autoridad interna de sesión BUSINESS](business-session-authority-2026-10-20.md) materializa y prueba la persistencia de sesión en DB temporal desde la referencia de este flujo. El bloqueo productivo de políticas/prueba de acceso y la ausencia de login humano se conservan; el estado inferior describe el cierre anterior del MFA.

Base local/remota comprobada: `c51d3fed1e872a7938fc29ce662e8b94a4aeaf16`, rama `claude/pos-camacho-bloque-4c-ld43py`. Incremento autorizado: coordinación interna AUTHENTICATE; el commit que contiene este informe identifica el delta comprobado. Sin merge a main.

## Implementación y contrato interno

`BusinessInitialMfaFlow.begin` verifica la contraseña persistida mediante el repositorio y Argon2id existentes, resuelve el factor/material del usuario obtenido del servidor y emite el challenge existente con `purpose=AUTHENTICATE`, `session_id=NULL`, UV requerida y RP/origin/plazo proporcionados exclusivamente por configuración central. No recibe userId ni un booleano de contraseña verificada.

`complete` vuelve a verificar la contraseña: no se introduce un token de prelogin ni otro almacén de pruebas. `PostgresBusinessInitialWebAuthnTransaction` bloquea challenge, usuario, credencial PASSWORD y factor; revalida estado ACTIVE, verificación/no revocación del factor, versión/no bloqueo de PASSWORD, propósito/sesión, RP/origin y vencimiento. Resuelve material persistido con el repositorio existente y llama al verificador WebAuthn auténtico existente, con UV obligatoria. Ejecuta el CAS existente del contador, consumo único con nueva comprobación temporal y evento `PLATFORM_WEBAUTHN_ASSERTION_VERIFIED`, razón `BUSINESS_INITIAL_MFA`, en una transacción. Cualquier rechazo revierte; errores de persistencia se propagan después del rollback. No altera `REAUTHENTICATE/RECOVERY_APPROVAL`, su transacción GLOBAL ni sus verificadores.

Tras COMMIT, entrega `BusinessInitialMfaReceipt`: referencia de objeto congelada, registrada en un WeakMap privado de la instancia central. `takeForBusinessSession` la consume una sola vez y devuelve identidad derivada, credencial/versión, factor, challenge, correlación y fecha PostgreSQL. Copias, JSON, otra instancia y segundo consumo fallan. Un reinicio pierde la referencia y obliga a autenticar otra vez. **No es token, sesión ni autorización para emitirla.** No tiene transporte HTTP, persistencia, roles, tenant ni acceso SSA. La futura emisión debe revalidar identidad, membresía, dispositivo y revocación, aplicar vigencia aprobada a esta evidencia y crear su propia sesión de forma atómica. La operación de entrega actual no sustituye esa futura transacción; si el emisor falla, no permite reusar la referencia consumida.

## Evidencia observada

Windows, Node/Vitest del workspace, PostgreSQL físico 16.14 en localhost:55433. Base aleatoria exclusiva por ejecución con bootstrap + 001/009/010. Runtime `pos_platform_app`, sin superuser ni BYPASSRLS. El administrador únicamente prepara y elimina la DB temporal; no cambia roles ni bases persistentes. Teardown estricto sin FORCE; consulta posterior sin bases `pos_initial_mfa_test_%`.

Comando focalizado, con `POSTGRES_TEST_URL` apuntando al servidor local de fixtures:

```text
pnpm --filter @pos-platform/central-authority test -- tests/business-initial-mfa-physical.test.ts
Test Files 1 passed (1); Tests 23 passed (23); exit 0
```

Cobertura: éxito con firma real P-256/UV y cero sesiones creadas; contraseña incorrecta/procedencia falsa; contraseña requerida al completar; usuario/factor cruzados; replay; factor pendiente o revocado; material no resoluble; credencial incorrecta; firma alterada; RP/origen/challenge incorrectos; UV ausente; vencimiento; PASSWORD revocada; concurrencia del mismo challenge y de dos challenges sobre un contador; rollback por evento denegado, CAS sin fila y fallo de consumo posterior al avance; rechazo de desafíos ligados a sesión/GLOBAL/recuperación; entrega interna de un solo uso.

Typecheck de `@pos-platform/database-postgres` y `@pos-platform/central-authority`: ambos exit 0. `node tools/architecture/validate-boundaries.mjs`: ARCH-003 PASS, exit 0. No se repitieron pruebas comerciales, canal, SalePanel, transferencias ni la suite anterior de 12 casos Argon2id.

Salidas locales ignoradas: `artifacts/initial-mfa/2026-10-20/physical.log`, `*-types-final.log`, `boundaries.log`. Se conservan los tres intentos fallidos de fixture: plazo de 1 ms menor que la inserción; intento rechazado de modificar timestamps inmutables; espera basada en reloj del host que cruzó el vencimiento durante el commit y produjo rollback. Se corrigió únicamente el test: emisión con margen y espera al reloj PostgreSQL. La ejecución intermedia 22/22 también se conserva. Firma de autenticador software e identidades controladas: no persona real ni autenticador físico.

## Eslabón pendiente y decisiones que requieren aprobación

No existe todavía una autoridad completa y segura que cree y valide sesiones comerciales a partir de esta evidencia. El emisor SSA existente depende de un resolvedor autenticado inyectado; no autentica a un usuario por sí mismo. El runtime `main.ts` conserva health, session-trust y device-enrollment; este incremento no publica login/MFA/refresh ni marca MFA desde React. Las primitivas de persistencia y la lectura de sesiones no son prueba de posesión. Un UUID de `identity.sessions` no concede acceso.

Según [D3 ratificado](../governance/central-authority-administration-d3-gate-2026-10-08.md), siguen pendientes:

- **D3-01:** revisión del perfil/parámetros y formato KDF productivos con benchmark del entorno objetivo; el candidato del test no los aprueba.
- **D3-02 / configuración de WebAuthn:** RP/orígenes reales y política versionada de vigencia del challenge y de antigüedad máxima de la evidencia inicial; los valores de fixture no son política productiva.
- **D3-03:** ventanas versionadas de reautenticación y reglas aplicables a la sesión comercial/operaciones críticas, manteniendo la separación GLOBAL/BUSINESS.
- **D3-06:** vigencia de sesión, access y refresh; contrato aprobado de prueba de acceso/posesión, almacenamiento protegido, vinculación a sesión BUSINESS y contexto confiable de membresía/dispositivo; consumo de evidencia MFA, rotación/familia, reutilización y revocación sobre las tablas existentes. No se elige un formato de token por iniciativa técnica.
- **D3-07:** umbrales por cuenta/origen, ventanas, backoff, bloqueo/desbloqueo y respuesta anti-enumeración, respaldados por pruebas de carga/abuso.

Estas decisiones no se crean con este informe. Su aprobación permitirá implementar y probar el emisor/resolvedor comercial seguro y después conectar el POS. **Estado: MFA inicial interno IMPLEMENTED y TESTED en PostgreSQL temporal; no CALLER_REACHABLE, END_TO_END ni PRODUCTION. Login completo y sesión POS de persona real: pendientes.**

# Backlog maestro

> Los prefijos de proveedor se retiraron por solicitud del propietario. Las etiquetas históricas abreviadas se identifican por sus SHAs y PR; no son nombres completos de rama.

## Propósito y autoridad

Este archivo es la fuente normativa del **estado vigente del trabajo** de POS Platform: prioridad, dependencia, bloqueo, trabajo activo y orden inmediato.

No funciona como diario histórico exhaustivo. La cronología detallada permanece trazable en Git, commits, PRs y workflows. Un snapshot histórico no puede contradecir la cola actual.

Última reconciliación operativa: 2026-10-18. Los cierres históricos conservan su fecha y SHA.

## Jerarquía relacionada

- Estado y orden de trabajo: este backlog.
- Arquitectura/decisiones: `docs/adr/`.
- Módulos y ownership: `docs/architecture/module-map.md` + `docs/architecture/data-ownership.md`.
- Ramas/PR/merge: `docs/governance/repository-governance.md`.
- CI vigente: `docs/testing/target-foundation-ci-gate.md`.
- Seguridad: `docs/security/security-gates.md`.
- Migrations: manifests y tooling aprobados bajo `docs/migration/` y `tools/target-migrations/`.
- Remediación contractual vigente de INT-006: `docs/migration/sql003-authoritative-contract-remediation-index.md` y su bundle V2.

Si una fuente vigente contradice otra, la transición afectada se bloquea hasta reconciliación. No se elige una interpretación arbitraria.

## Cierre acotado e inmutable por evidencia — IPC/escritorio (2026-10-18)

**Decisión del propietario:** no repetir diagnósticos, recorridos o suites ya aprobados para reabrir el mismo trabajo sin un defecto nuevo y reproducible. La excepción es un cambio que afecte el contrato, una regresión documentada o el gate integral del nuevo HEAD candidato a `main`; no se transforma esta decisión en una exención de pruebas para funcionalidades nuevas.

- **Área cerrada en la línea activa:** endurecimiento de `ChannelBridge` (`message_type` debe coincidir con el canal IPC autorizado) y compatibilidad de `tests/main.test.ts` con el sobre canónico. Commits `4bb5bcc7`, `2ac4c7ac` y `1dd6a285`; PR #92, HEAD probado `1dd6a2850e4a456d63ce856a606a67a7f0a04bc9`.
- **Evidencia aportada desde Windows `C:\\Proyectos\\pos-platform`:** `git pull --ff-only` sin conflicto, `pnpm --filter @pos-platform/pos-desktop test` = **15 archivos / 161 pruebas aprobados, 0 fallidas**, exit 0; `pnpm --filter @pos-platform/pos-desktop typecheck` = ambos `tsc` sin errores, exit 0; `git status --short --branch` = sin cambios locales, en la rama activa. Prueba anterior sobre `2ac4c7ac` falló en dos fixtures desactualizadas; esa regresión quedó corregida y aprobada en `1dd6a285`. Ver comentarios de evidencia en PR #92.
- **Estado de este corte:** `MATERIALIZED / TESTED / CLOSED_FOR_REWORK`. No se vuelve a abrir el alcance anterior para mejoras especulativas ni se repiten sus 161 tests como tarea individual. **No significa** `END_TO_END`, Electron real certificado, CI exact-head ni integración en `main`; esos gates siguen abiertos donde corresponda.
- **Siguiente frente, sin reabrir RT-006:** `operation.confirm` es el slice técnico de actor `DEVICE` integrado históricamente y `OperationPanel` lo expone en el renderer. La identidad de transporte y el guard de canal IPC no constituyen por sí solos autorización de **usuario**. `SEC-G03` / administración central deben definir autoridad, alcance, política de exposición de la operación técnica y casos de rechazo para llamadas al canal correcto antes de cambiarla. No añadir un grant inexistente a los 18 permisos operativos, ni atribuir operaciones técnicas a un usuario ficticio; conservar idempotencia/outbox/auditoría RT-006. Este hallazgo queda **OPEN / REQUIRES_AUTHORIZATION_DESIGN**, separado del bloque IPC cerrado.
- **Prioridad de continuidad:** avanzar en los pendientes de administración central y seguridad y en el transporte/entorno aún no acreditado según la cola vigente; no revalidar módulos ajenos a cada cambio, y mantener la PR #92 sin merge hasta cumplir sus gates de integración.

## Continuidad incremental D3-R — recuperación de cuenta (2026-10-18)

**Regla del propietario:** no repetir bloques ya probados. Su evidencia permanece en los comentarios de PR #92, asociada al HEAD; ninguna ejecución de un nuevo bloque sustituye pruebas anteriores ni acredita CI.

- **D3-R1 / CLOSED_FOR_REWORK:** solicitud de recuperación `SYSTEM/EMAIL` sobre `identity.password_recovery_requests` (007) y evento `PLATFORM_RECOVERY_REQUESTED` en una transacción, sin nuevo esquema. `a8276782`: **4/4 pruebas unitarias aprobadas en Windows y typecheck exit 0**, transcript del propietario.
- **D3-R2 / CLOSED_FOR_REWORK:** verificación de hash SHA-256, expiración, bloqueo por intentos y rechazo de replay; `54a0f666`: **11/11 pruebas unitarias acumuladas aprobadas en Windows y typecheck exit 0**, transcript del propietario. No volver a solicitar estos tests como trabajo individual salvo defecto nuevo o cambio aplicable a sus contratos.
- **D3-R3 / PHYSICALLY_TESTED / CLOSED_FOR_REWORK:** `packages/database-postgres/tests/platform-password-recovery-physical.test.ts` aplica los SQL existentes 001/007 en una base temporal aislada y verifica cuatro casos físicos de PostgreSQL: persistencia con auditoría y RLS; una única verificación ganadora ante concurrencia; bloqueo al límite de intentos; rollback real al denegar la escritura de auditoría. **4/4 pruebas aprobadas en Windows con PostgreSQL 16.14, 0 fallidas, exit 0, HEAD de código `c8bd0ea9858be41263711917ca5a2de93a316b51` (2026-10-18 21:23 America/Bogota)**. El fallo previo de tres casos era una fuga de `SET ROLE` de la conexión inspectora del test y se corrigió solo en esa prueba. No repetirlas como trabajo independiente salvo defecto reproducible, cambio de alcance o gate de integración final. La ejecución de typecheck no se informó aún para este SHA; no se atribuye PASS exact-head.
- **D3-R4 / VERIFIER_AND_COMPLETION_TESTED / CLOSED_FOR_REWORK (solo delta técnico):** benchmarking Argon2id Windows/Linux anterior, con política productiva aún NO aprobada. En HEAD de código `9e2dbd5256934a72e56f7200a97547fa77ab49ef` se materializó generación y validación PHC Argon2id v19 con perfiles explícitos, comprobación compartida de `m/t/p` por clave, y operación interna `completeAssistedRecovery`: exige solicitud `VERIFIED`, hash correcto, vigencia, `support_verified=true`, usuario y credencial activos; sustituye credencial, revoca sesiones/refresh, consume token y escribe auditoría en una transacción. **Evidencia Windows 2026-10-18 21:59–22:00:** contratos typecheck exit 0; Central Authority typecheck sin errores visibles (sin exit numérico aportado); Argon2 5/5 tests PASS; database-postgres typecheck exit 0; completion unitarias 4/4 PASS exit 0; escenario físico nuevo 1/1 PASS exit 0, 4 tests de R3 intencionalmente omitidos; Git limpio. No repetir estos 10 casos como bloque individual. **La recuperación de plataforma NO está operativa ni aprobada para producción:** aún faltan un productor de `support_verified` respaldado por verificación reforzada real, MFA durable y autoridad de actor, selección productiva KDF, mover `argon2` a dependencies mediante pnpm, servicio y endpoints seguros con rate limiting e integración E2E. Nunca exponer el método basado solo en `support_verified`/correo; PR #92 permanece draft y fuera de main.
- **D3-R5.1 / UNIT_TESTED / PHYSICAL_NEGATIVE_TESTED / CLOSED_FOR_REWORK (solo escenarios probados):** `approveAssistedRecovery` materializado sobre tablas existentes: solicita estado `VERIFIED`, vigencia, una sesión global del aprobador distinta del beneficiario, MFA activo, reautenticación reciente, rol y permiso explícito `PLATFORM_RECOVERY_APPROVE`; aprobación y `PLATFORM_RECOVERY_APPROVED` auditados transaccionalmente con rollback. **Evidencia Windows:** 5/5 unitarias PASS exit 0 sobre `4a4c7558c28fb072f74e55eae9432be590c84fe5`, contratos typecheck 0 y PostgreSQL typecheck 0 reportado. **Evidencia física adicional, HEAD de código `d4510abffe5a865a3ce648c66ec5ce9a1fee8c84`, 2026-10-18 22:21:** `pnpm --filter @pos-platform/database-postgres typecheck` exit **0**; único caso `physically denies recovery approval without an explicit platform role or permission` **1/1 PASS, exit 0, 5 SKIPPED intencionales**, bajo PostgreSQL aislado con 001+007+008; Git limpio. Comprueba denegación y ausencia de marca/evento falsos, **no** aprobación física positiva. No repetir estas validaciones individualmente. No se creó ni concedió el permiso. Aún faltan autenticación WebAuthn real y garantía de procedencia: recuperación E2E NO habilitada.
- **D3-R5.2a / CHALLENGE_STORAGE_UNIT_AND_PHYSICALLY_TESTED / CLOSED_FOR_REWORK (solo 009 + repositorio):** challenge WebAuthn persistente materializado sobre migración incremental `009_webauthn_challenges` (dependencia 008, up/down y descriptor), tabla `identity.webauthn_challenges` con hash SHA-256, UUIDv7, user/factor/session/purpose/RP ID/origin, consumo irreversible por trigger, FORCE RLS, rollback que no borra evidencia. El repositorio genera desafío CSPRNG de 32 bytes, lo vincula a identidad/factor/sesión y consume atómicamente con `FOR UPDATE` y prueba verificada por callback. **Evidencia Windows / HEAD `60670ee54affb4378e4e274e026668d566580732`, 2026-10-18 ~23:00:** database-postgres typecheck exit 0; target-migrations typecheck sin errores visibles (no se mostró exit numérico); 7/7 pruebas unitarias repo PASS, exit 0; 4/4 pruebas de contrato/migración PASS, exit 0; 2/2 pruebas físicas PostgreSQL de concurrencia y expiración PASS, exit 0, seis tests históricos omitidos intencionalmente; Git limpio. **No repetir estas 13 pruebas como trabajo independiente.** El callback del test no prueba una firma WebAuthn; falta enlazar servicio criptográfico y credencial pública durable. `009` no fue aplicada en BD persistente/producción ni cuenta con runner productivo; solo fixture de BD temporal. NO habilitar sesión MFA, login o recuperación pública. SEC-G02/SEC-G03 pendientes.
- **D3-R5.2b / REAL_CRYPTO_TESTED / TYPES_NO_ERRORS_SHOWN / CLOSED_FOR_REWORK (verificador puro):** `webauthn:v1:<UUIDv7>` y `PostgresPlatformWebAuthnFactorReferenceRepository` usan `identity.mfa_factors` existente; `verifyPlatformWebAuthnAssertion` en Central Authority valida firma P-256 real, challenge, RP ID, origin, UV, COSE, contador e identidad/factor vinculado, sin emitir sesión. **Evidencia Windows, HEAD `65f535d91af2ce9abc3c257258cb5a18ad2d0372`, 2026-10-18 23:22:** `pnpm ... central-authority typecheck` sin errores visibles (sin exit numérico capturado); **8/8 tests criptográficos PASS exit 0** tras corregir TS2322 ArrayBuffer. Contratos 2/2 y factor 3/3 aprobados en HEAD anterior, y ninguno se alteró funcionalmente. Git limpio. **No reejecutar estas 13 pruebas individualmente** sin cambio de lógica. MFA E2E sigue bloqueado por material durable/CAS y emisión confiable de sesiones.
- **D3-R5.2c / UNIT_AND_PHYSICALLY_TESTED / CLOSED_FOR_REWORK (solo alcance validado):** migración 010 de material público WebAuthn 1:1 con `identity.mfa_factors`, guardas RLS/trigger de clave inmutable y contador CAS por valor+versión, repositorio canónico y prueba cruzada entre usuarios. **Evidencia Windows de 2026-10-18 ~23:44, HEAD `a5770e94d43fc2592cfadda1385df3048332233b`:** migración 010 **5/5 PASS exit 0** (incluida regresión regex PostgreSQL), tests físicos contra DB PostgreSQL aleatoria **2/2 PASS exit 0** de contador/CAS y aislamiento entre cuentas, ocho históricos omitidos intencionalmente, Git limpio. Unitarias CAS 5/5 y typechecks ya acreditados antes del fix. No volver a ejecutar estos escenarios aisladamente sin cambio de lógica. Las migraciones 009/010 solo se aplicaron al fixture temporal; producción y sesión MFA permanecen fuera de alcance.
- **D3-R5.2d / UNIT_AND_PHYSICALLY_TESTED / CLOSED_FOR_REWORK (solo delta probado):** la transacción de aserción WebAuthn reutiliza desafío 009, material 010, CAS del contador y `identity.security_events`, con bloqueo de challenge/sesión/material y rollback íntegro. Central Authority llama al verificador criptográfico P-256 existente mediante wrapper interno; no expone HTTP ni emite sesión o aprobación. **Evidencia Windows sobre HEAD `ea0772464d7da09891689c3725b2fe30b311a975`, noche de 2026-10-18 a 2026-10-19 (Bogotá):** contratos y database-postgres typecheck exit 0; central-authority typecheck sin errores visibles (código numérico no aportado); **7/7 pruebas unitarias transacción PASS exit 0**; **2/2 wrapper PASS exit 0**; **1/1 física PostgreSQL PASS exit 0** de contador + consumo de challenge + ledger en una transacción, 10 históricos SKIPPED por filtro intencional; git limpio. La prueba física utiliza callback artificial para aislar la transacción, **NO acredita autenticador real ni E2E**. No reejecutar estos diez tests como tarea independiente. Permanecen pendientes trusted enrollment (`verifyRegistrationResponse` y session binding), RP/origin/TTL/rate-limit productivos, `@simplewebauthn/server` en runtime y gates SEC-G02/G03. PR #92 DRAFT, main intacto, migraciones 009/010 solo ejecutadas en fixture temporal.
- **D3-R5.2e.1 / PURE_WEBAUTHN_REGISTRATION_VERIFIER_MATERIALIZED / UNIT_TESTED_5_5 / TYPECHECK_0_REPORTED:** Central Authority añadió `platform-webauthn-registration-verifier.ts`, que reutiliza `verifyRegistrationResponse` de `@simplewebauthn/server@14.0.3` y el fixture de compatibilidad ya existente. Exige challenge `ENROLL` CSPRNG de 32 bytes, factor nulo y sessionId no nula, RP ID + origin del servidor, credencial `public-key`, UV y algoritmo ES256; ante éxito devuelve **solo** ID de credencial, clave pública COSE, contador y metadatos de respaldo. No crea factor/sesión, no abre HTTP ni inserta en PostgreSQL. **Cinco pruebas nuevas 5/5 PASS, exit 0, verificadas en Windows 2026-10-19 00:08 COT** de registro real P-256 `none` attestation y rechazos de challenge/RP/origin/UV/contexto/attestation. Su salida por sí sola **NO certifica autenticación ni enrollment completo**: D3-R5.2e.2 requiere transacción que bloquee challenge 009 ligado a sesión GLOBAL realmente autenticada, verifique registro, inserte `identity.mfa_factors` y material 010 1:1 y anexe `PLATFORM_MFA_ENROLLED` con consumo irreversible y rollback; políticas TTL/rate-limit y `@simplewebauthn/server` runtime pendientes. La fase e.1 ya está UNIT_TESTED según la constancia de cierre de PR #92; TypeScript exit 0 fue reportado, pero sin comando completo visible; PR #92 DRAFT, main intacto.
- **D3-R5.2e.2 / INTERNAL_TRANSACTION_AND_BINDING_MATERIALIZED / UNIT_TESTED_11_11 / PHYSICAL_PASS_6_6 / TYPECHECK_NO_DIAGNOSTICS / NOT_INTEGRATED (2026-10-20):** En la misma rama se incorpora `PostgresPlatformWebAuthnEnrollmentTransaction` reutilizando `identity.sessions`, `identity.users`, `authorization.platform_role_assignments`, `identity.mfa_factors`, tablas 009/010 y el ledger de seguridad. Exige resolver de prueba de sesión autenticada inyectado por Central Authority (no UUID aportado por cliente), sesión GLOBAL vigente con reautenticación reciente y rol PLATFORM efectivo, challenge ENROLL ligado a usuario/sesión, RP/origin centrales, callback criptográfico de registro, alta PENDING→ACTIVE, material público 1:1, consumo único y auditoría `PLATFORM_MFA_ENROLLED` dentro de una transacción PostgreSQL. Wrapper privado invoca el verificador e.1 sin modificarlo. **Evidencia Windows 2026-10-20 (checkout `f5669a55`):** 9/9 unitarias de transacción PASS y 2/2 unitarias de binding PASS (ejecución documentada previamente); la unit suite de transacción se repitió tras corregir TS18048 y volvió a cerrar 9/9 PASS. Typecheck de database-postgres ejecutado sin diagnósticos impresos después de la corrección, sin código de salida explícito documentado; Central Authority typecheck previamente sin diagnósticos. Aprovisionamiento canónico de los roles PostgreSQL 16.14 temporal: completado con éxito y base temporal eliminada. **6/6 pruebas físicas PASS** sobre PostgreSQL real con 11 casos históricos omitidos por filtro: registro/replay, auditoría/rollback, concurrencia de challenge, cuenta cruzada/sesión revocada, challenge vencido y credencial duplicada. Árbol de trabajo limpio. El error de interfaz PSReadLine no impidió el resultado. Evidencia de pruebas físicas y unitarias, NO E2E de autenticación real. **BLOQUEO CRÍTICO:** todavía NO hay resolvedor de sesión real emitida/autenticada ni servicio central de login/MFA/refresh que autorice el flujo; la inyección en pruebas es un fixture y no autentica personas. No existe endpoint HTTP público, ni cambio de `mfa_status`/SSA, ni política productiva de reauth/RP/TTL, ni migración 009/010 persistente. NO habilitar enrolamiento ni considerar el R5.2e.2 integrado hasta conectar una autoridad real, validar la procedencia y ejecutar el E2E completo (PostgreSQL físico del incremento ya PASS).
- **SSA-ISSUER-NEXT / SIGNING_PRIMITIVE_MATERIALIZED / UNIT_PASS_17_17 / TYPES_PASS / NOT_INTEGRATED (2026-10-20):** Se añade un emisor criptográfico interno en Central Authority y su suite focalizada. Recibe únicamente prueba opaca y exige que un resolvedor de autenticación de confianza entregue claims provenientes del servidor, más el artefacto de clave operacional; NO acepta identidad, roles ni permisos enviados por el renderer. En cada intento exige certificado de clave Ed25519 firmado por la raíz de confianza, entorno y `key_id` correctos, estado `ACTIVE` (nunca `VERIFY_ONLY`/`REVOKED`), correspondencia exacta entre clave privada y pública certificada, ventana temporal y política explícita positiva para antigüedad/TTL; firma el contrato `SessionAssertionClaimsSchema` con la serialización canónica existente y devuelve `SignedSessionAssertionSchema`. Hay tests nuevos de Central Authority para firma, denegación, raíz errónea, clave incorrecta, rotación, entorno, claims extraños y vigencia; además, dos casos independientes en Local Service prueban paridad de bytes canónicos y verificación de firma Ed25519 central sobre bytes locales. **Evidencia Windows 2026-10-20 en HEAD `90ab0c01`:** Central Authority typecheck exit 0, POS Local Service typecheck exit 0, emisor SSA 15/15 PASS exit 0 y compatibilidad canónica 2/2 PASS exit 0; Git limpio. CI de la PR y autenticación real E2E no certificados. **Bloqueos de integración:** aún no existe resolvedor REAL de contraseña/MFA/sesión con reserva durable y monótona de `sequence`, `identity.sessions` 001 difiere entre sesiones GLOBAL y negocio; tampoco está implementada conexión HTTP de login, entrega segura de SSA al cliente ni E2E contra el verificador local. No declarar login o SSA productiva. El diseño visual de PR #92 queda intacto; sus tests de React/Electron y logo todavía requieren verificación.
- **D3-DEVICE-REQUEST-PROOF-012 / ED25519_REPLAY_LEDGER_MATERIALIZED / NOT_TESTED / NOT_INTEGRATED (2026-10-20):** Se aprovecha `DeviceProof`/Ed25519 de `@pos-platform/device-trust` en un nuevo verificador central interno `PostgresDeviceProofReplayVerifier` y no en una ruta pública. Obtiene clave pública de `identity.device_registry` y `identity.device_credentials` 004 con status ACTIVE y correspondencia de device, installation, tenant, company, device_key y trust_key; exige firma sobre bytes reales de POST `/v1/business-session/assertions`, request ID, correlation ID, timestamp y body original, frescura ±120 s y clave Ed25519. Ejecuta transacción con bloqueo de dispositivo+credencial, después consume por `INSERT ... ON CONFLICT DO NOTHING` en la migración aditiva 012 `identity.device_request_proof_replays`: dos índices únicos por `(credential_id, nonce_sha256)` y `(credential_id, request_id)`, `FORCE RLS` y acceso central-only para que firmas repetidas, solicitudes concurrentes o reinicios nunca acrediten el dispositivo por segunda vez; historial inmutable, rollback 012 destructivo bloqueado. Se agregaron **8 unitarias de verificador**, **3 de contrato 012** y **4 físicas nuevas** al mismo arnés PostgreSQL temporal (13 casos físicos totales). **NO EJECUTADO todavía ni Windows ni CI en el nuevo HEAD.** La prueba de dispositivo no es prueba de usuario: el token de sesión, Argon2id/MFA, identidad autorizada, endpoint, emisión/activación SSA E2E, antigüedad real y sesiones comerciales permanecen pendientes. Nunca aceptar UUID o tenant de renderer como autoridad; `main` intacto, PR #92 DRAFT.
- **D3-SSA-SEQUENCE-ISSUER-BINDING / RESERVATION_MATCH_GUARD_MATERIALIZED / CENTRAL_30_30_PASS / TYPES_PASS / NOT_INTEGRATED (2026-10-20):** El emisor Central Authority ahora exige `ReservedBusinessSsaSequence` explícito del asignador PostgreSQL, en vez de aceptar scope y secuencia como datos independientes: `claims.sequence` debe ser idéntica a `reservation.sequence` (entero positivo seguro), mientras las identidades y fechas de la SSA se contrastan con `reservation.eligibleScope` como antes. Se agregan cinco casos negativos de falta o discordancia en la reserva a la suite central (25 antiguos + 5 nuevos = **30/30 PASS** el 2026-10-20 a las 10:50 COT en HEAD `4530bbf7`: `central-authority` typecheck **exit 0**, Vitest 30/30 **exit 0**, fast-forward confirmado y Git limpio). **CI exact-HEAD y login E2E NO ejecutados/verificados.** La verificación estructural del objeto reservado **NO demuestra por sí sola** que la reserva exista en la DB: aún se requiere resolver auténtico y cerrado que invoque `reserveForVerifiedProof` exclusivamente después de verificar en central la sesión y la posesión de la clave del dispositivo. La llamada directa a un método DB con UUID no es un login, no es evidencia de posesión. No se abren rutas HTTP, no se toca frontend ni RLS; `main` intacto.
- **D3-SSA-SEQUENCE-011 / CONTRACT_3_3_PASS / UNIT_17_17_PASS / POSTGRES_PHYSICAL_9_9_PASS / NOT_INTEGRATED (2026-10-20):** Esquema aditivo `011_session_assertion_sequences` con contador BIGINT exacto por binding (`user_id`, `installation_id`, `device_id`), independiente de la fila/sesión y de `identity.sessions.version`: arranca en 1, solamente aumenta +1, nunca borra un watermark, mantiene `FORCE ROW LEVEL SECURITY` bajo `pos_platform_app`, bloquea rollback destructivo si hay filas y respeta `Number.MAX_SAFE_INTEGER`. Nuevo `PostgresBusinessSsaSequenceAllocator.reserveForVerifiedProof` interno, sin endpoint HTTP: obtiene tenant desde `identity.sessions`, establece RLS local a la transacción READ COMMITTED, vuelve a verificar el predicado de elegibilidad empresarial ya probado y bloquea las filas relevantes de identidad, membership, tenant, empresa, dispositivo, credencial y un factor MFA ACTIVE; reserva con UPSERT atómico y confirma ANTES de firmar, por lo que fallos posteriores de firma dejan huecos seguros pero nunca reutilizan números emitidos. Se reutiliza el SQL de elegibilidad mediante una constante compartida, no se duplica la validación. Se agregan 7 unitarias del asignador, 3 del contrato de migración y 4 pruebas físicas nuevas al arnés existente (9 físicas totales) para secuencias concurrentes, continuidad tras otra sesión, denegación MFA y retención irreversible. **Evidencia Windows 2026-10-20, HEAD `b79c1f92`, 10:23–10:24 COT:** 011 contract **3/3 PASS** exit 0; elegibilidad/allocator **17/17 PASS** exit 0; PostgreSQL 16.14 físico contra base temporal en `127.0.0.1:55433` **9/9 PASS** exit 0 (6 reservas concurrentes estrictamente monótonas, continuidad entre sesiones, rechazo de revocaciones/MFA, RLS y bloqueo de rollback/borrado/rewind); `database-postgres` typecheck **exit 0**. `target-migrations` typecheck mostró `tsc -p tsconfig.json` sin error visible, pero el `Write-Host` de su exit code no mostró un número en el log suministrado: **no afirmar código 0 de esa verificación**. Fast-forward y Git limpio. **CI exact-HEAD, login real y aplicación de 011 en un entorno de uso real NO certificados**. El método aún presupone prueba central de sesión y dispositivo previamente autenticados: un UUID no es prueba de identidad ni posesión. Faltan emisor final conectado, serialización/auditoría, endpoint HTTPS, login Argon2id/MFA, transporte y E2E. Mantener PR #92 DRAFT, no fusionar `main`.
- **SSA-ISSUER-SCOPE-BOUNDARY / CLAIM_BINDING_AND_EXPIRY_GUARD_MATERIALIZED / TEST_25_25_PASS / TYPECHECK_PASS / NOT_INTEGRATED (2026-10-20):** Se endurece únicamente `CentralSessionAssertionIssuer` existente para exigir el `EligibleBusinessSessionCandidate` materializado por la consulta central ya validada. La identidad firmada debe corresponder exactamente a la sesión, usuario, membership, dispositivo e instalación devueltos por el resolvedor central confiable. `offline_valid_until` no puede superar ni `sessionExpiresAt` ni `deviceCredentialExpiresAt`, tampoco sus vencimientos pueden ser anteriores/al tiempo de emisión. Pruebas negativas específicas de los cinco bindings, dos límites de vencimiento, estados expirados y fecha corrupta incorporadas a la suite Central Authority; **Evidencia Windows 2026-10-20 a las 10:05 COT, HEAD `bafff75a`:** `central-authority` TypeScript PASS exit 0; `central-session-assertion-issuer.test.ts` **25/25 PASS** exit 0, incluidos rechazos por binding, vigencia, clave Ed25519, certificado/entorno y claims externos; fast-forward correcto y árbol de trabajo limpio. La compatibilidad local 2/2 y PostgreSQL físico 5/5 siguen acreditados en commits previos; no se ejecutaron nuevamente porque el delta no cambió esos componentes. ** Esto NO añade HTTP, contraseña, MFA, prueba de posesión del dispositivo, asignador duradero de secuencia ni reemplaza la transacción de revalidación central. La PR #92 continúa DRAFT y no se altera el frontend.
- **D3-SSA-BUSINESS-ELIGIBILITY / UNIT_PASS_10_10 / POSTGRES_PHYSICAL_PASS_5_5 / TYPECHECK_PASS / ELIGIBILITY_VALIDATED_NOT_LOGIN (2026-10-20):** Nuevo `PostgresBusinessSessionSsaEligibilityRepository` exclusivamente de lectura y exportado desde `@pos-platform/database-postgres`: comprueba en UNA consulta SQL identidad activa, `identity.sessions` empresarial no revocada y con reautenticación reciente/MFA satisfecho y factor ACTIVE, pertenencia activa del mismo usuario/tenant, tenant ACTIVE, compañía ACTIVE, dispositivo registrado ACTIVE y credencial 004 ACTIVE no vencida con IDs/llaves/scope coincidentes. Respeta `sessions_device_deferred_ck` de 001 (`device_id IS NULL`) y obtiene binding del registro 004 sin relajar DDL. **Evidencia previa 2026-10-20 en HEAD `146cc261`:** 7/7 pruebas unitarias PASS, `database-postgres` typecheck exit 0 y Git limpio. **Hallazgo RLS al revisar migración 001:** `tenants`, `tenant_memberships` y `companies` están en FORCE RLS y requieren `app.tenant_id`. Se adapta el repositorio a transacción REPEATABLE READ, READ ONLY: obtiene `tenant_id` de `identity.sessions`, instala contexto con `set_config(..., true)` solo para esa transacción, comprueba el resto de invariantes y limpia con COMMIT/ROLLBACK antes de devolver la conexión. Pruebas unitarias revisadas (10 casos) y nuevo archivo opt-in físico (5 casos), que aplica bootstrap+001+004 en DB aleatoria del PostgreSQL local `127.0.0.1:55433` con rol real `pos_platform_app`; **Evidencia Windows 2026-10-20, HEAD `0ed08307`, 09:44 COT:** `pnpm --filter @pos-platform/database-postgres typecheck` PASS exit 0; suite unitaria RLS **10/10 PASS**, exit 0; suite física PostgreSQL 16.14 **5/5 PASS**, exit 0, incluyendo FORCE RLS bajo `pos_platform_app` no-BYPASSRLS, tenant derivado del servidor, ausencia de fuga de tenant en la conexión, rechazo por vinculación de instalación/dispositivo, credenciales revocadas/vencidas, membresía/tenant suspendidos y sesión revocada/MFA PENDING. `target-migrations-postgres-1` HEALTHY en `127.0.0.1:55433`, git limpio y fast-forward verificado. No consta E2E de credenciales o SSA ni ejecución exact-HEAD de CI. ** No se modifica la migración, ni se reusa el login global ni se reduce FORCE RLS. Este repositorio NO verifica posesión de credencial/identidad, NO obtiene prueba autenticada, NO genera claims, NO asigna secuencia, NO firma SSA ni autoriza sesión. El valor `version` de `identity.sessions` es control de concurrencia de esa fila, no una secuencia SSA; el baseline antirreplay del Local Service es receptor, no allocator central. Se necesita reserva durable y monótona por binding `(user_id, installation_id, device_id)`, independiente del ciclo de vida de una sesión y sin reinicio por expiración. La futura autoridad de autenticación debe pasar solo identidades derivadas de pruebas reales y revalidar estado en la transacción con reserva monótona durable; no conectar renderer ni HTTP por aprobar este gate.
- **Integración pendiente:** PostgreSQL físico del candidato final, acceso real Windows/Electron, grants/administración central, CI exact-head y revisión para PR #92 → `main`. Los 161 tests del escritorio sobre `1dd6a285` continúan cerrados.

## Reconciliación operativa — 2026-10-17 (America/Bogota)

Esta sección fija el corte remoto de esta auditoría y prevalece para el estado actual sobre los snapshots históricos de agosto/septiembre conservados abajo. No cambia contratos, ADR, SQL ni niveles de evidencia.

### Prerrequisito de administración central: bibliotecas D3 — 2026-10-18

Continúa PR #92, sin otra rama ni reemplazo de módulos. Se resolvieron con pnpm 9.15.0 `argon2@0.45.1` y `@simplewebauthn/server@14.0.3` como dependencias de desarrollo de central-authority, con integridades en el lockfile. No se importan desde el runtime ni se habilita login por este cambio: el formato final, el contrato de secret_reference y los parámetros de producción mantienen las condiciones de D3-01/D3-02.

- Node 22.19.0/Linux x64: typecheck central aprobado y **24 pruebas centrales aprobadas**, incluidas 13 nuevas de compatibilidad criptográfica. Verifican Argon2id nativo, PHC/salt/parámetros, contraseña incorrecta, enrolamiento WebAuthn de prueba, firma P-256, origen/challenge/RP ID, UV y contador. El autenticador es una fixture software, no navegador/hardware físico.
- Una prueba explícita muestra que las passkeys sin contador requieren consumo atómico del challenge por el futuro runtime: la biblioteca criptográfica es deliberadamente stateless y no acredita por sí sola protección durable contra replay.
- Benchmark reproducible de tres perfiles candidatos ejecutado con Node 22.19.0. No selecciona parámetros de producción; faltan hardware objetivo y prueba de carga. Comando: `pnpm --filter @pos-platform/central-authority benchmark:kdf`. Alcance y mediciones en el [gate D3](../governance/central-authority-administration-d3-gate-2026-10-08.md#compatibilidad-criptográfica-ejecutada--2026-10-18).
- Instalación offline con lockfile congelado y scanner de arquitectura aprobados. Inventario: 343 paquetes, sin hallazgos de licencia. Auditoría según política vigente: sin bloqueantes; conserva dos avisos moderados para triage en Nx/smol-toml, sin cambiar la política.
- El workflow D3 ahora instala con lockfile congelado, ejecuta toda la suite central y conserva el benchmark como artefacto. Esto es configuración materializada, no ejecución de CI acreditada.

Los **33 casos de transporte continúan sin aprobar** por EPERM del socket Unix. La comprobación con elevación fue rechazada por la política automática de esta sesión; no se modificaron los tests, skips ni transporte para ocultarlo. Los checks consultados de `37d467c8` siguen sin ejecución utilizable de runner. No hay merge a main ni cierre de las once pantallas administrativas: aún faltan contrato operacional de MFA, autenticación/sesión/refresh/recuperación central, handlers/grants de cada capacidad y verificación con PostgreSQL real. Se continúa sobre las tablas existentes.

### Pantallas, marca y continuidad — 2026-10-18

Esta ejecución continúa PR #92 en la misma rama. Prevalece sobre el corte inicial para las superficies que enumera. No cambia SQL, dependencias, permisos canónicos ni la arquitectura del canal.

| Superficie existente | Cambio comprobable |
|---|---|
| Estado del servicio | Ahora envía el sobre canónico y distingue respuesta rechazada de conexión válida. |
| Diagnóstico de operaciones | Consulta con operation_id + idempotency_key; confirmación con tipo, JSON, identidad de operación e idempotencia exigidos por el contrato. No confirma ventas ni sustituye pagos. |
| Navegación | Las pantallas autorizadas ya visitadas conservan su instancia al cambiar de vista; caja/carrito/venta no desaparecen por navegar. No es persistencia frente a cierre o reinicio del renderer. |
| Caja y ventas | Normalización de efectivo a escala 6; importe parcial explícito, sin calcular totales en el frontend; quitar líneas del carrito antes de crear la venta; no editar líneas ya enviadas o con resultado pendiente. |
| Reintento de mutaciones comerciales | Una respuesta perdida conserva el sobre original, incluidos operación e idempotencia. Otra mutación con datos distintos se bloquea hasta un resultado definitivo; existe reintento explícito de la petición original. Esta retención es en memoria, no recuperación durable después de cerrar el proceso. |
| Transferencias | Consulta por ID para un usuario con permiso de lectura; confirmación/cancelación usando la versión persistida; actualización de estado; un reportador sin lectura conserva el ID, sin inventar estado ni versión. Las capacidades backend siguen siendo autoridad. |
| Catálogo | Lectura y paginación por el endpoint existente, además del alta. El alta conecta con entrada de inventario usando presentation_id devuelto por el servicio. |
| Comprobante / factura | La venta cobrada conecta con el recibo o precarga el ID en facturación según permisos. Navegar a facturación no emite un documento automáticamente. |
| Controles por acción | Caja, pagos, catálogo, inventario y clientes deshabilitan acciones ajenas al permiso efectivo; la validación backend se conserva. |
| Preferencias de clientes | Se añade comprobación backend de CUSTOMERS_CUSTOMER_READ antes de customer.marketing.get; una prueba reprodujo acceso sin ese permiso y luego su rechazo. Al cambiar de cliente se limpia la preferencia anterior. |
| Marca | Los dos PNG existentes se reemplazan por los bytes del horizontal aprobado; README y renderer conservan sus rutas. No quedan copias del arte anterior en el árbol actual. El renderer añade base clara para legibilidad; no se redibuja el logo. |
| Instrucciones de agentes | Se centralizan en AGENTS.md. Ocho guías existentes y el procedimiento se reubican en .agents sin duplicar capacidades. Se retiran nombres y configuración específicos del proveedor; SHAs e identidad de PR conservan trazabilidad. Los refs remotos y la historia no se reescriben. |

**Validación observada:** 158 pruebas de escritorio aprobadas; typecheck general del workspace aprobado y typechecks de los dos proyectos modificados aprobados. Build de escritorio aprobado; la comprobación final del candidato debe conservar su SHA. Regresiones previas reprodujeron sobres inválidos, rechazo mostrado como conexión, pérdida de formulario al navegar, efectivo fuera de formato, nueva idempotencia tras respuesta perdida y lectura de preferencias sin permiso. Las pruebas del renderer usan respuestas controladas y verifican contratos; no se declaran Electron E2E ni canal real por esas pruebas.

**Los 33 casos de canal siguen sin aprobar.** Reejecución de sus tres archivos: 33 fallidas / 5 aprobadas / 1 omitida; todos los fallos se detienen en listen EPERM al crear el socket Unix. Reejecución completa del servicio local: 620 aprobadas / 33 fallidas / 10 omitidas. SQLite y observabilidad aprobaron antes de detenerse el script runtime. No se cambiaron esos tests, sus skips, los endpoints ni el transporte para obtener verde. La ejecución válida de esos casos requiere un host que permita el transporte real: REQUIRES_LOCAL_VERIFICATION.

#### Cobertura de pantallas: cierre aún incompleto

Ocho superficies navegables existentes tienen llamadas ejecutables según permisos: caja/ventas, fiscal, catálogo, inventario, clientes, comprobantes, dashboard y auditoría. Esta cifra no acredita que cada flujo esté completo: el dashboard aún devuelve null para agregados de ventas/caja porque faltan sus grants centrales canónicos.

Las once definiciones de navegación restantes —reportes, usuarios, roles, empresa, sucursales, dispositivos, configuración, licencias, planes/suscripciones, superadministrador y soporte— no obtienen contratos/handlers/grants completos por habilitar sus botones. Continúan fuera de la navegación operativa. Login, MFA, recuperación/refresh y administración central exigen completar su runtime existente y validarlo con PostgreSQL real; no se crea otra identidad ni otra tabla. Balanza, tarjeta, QR integrado y crédito conservan sus bloqueos reales de adapter/contrato/decisión. FACTUS Pay mantiene el delta dependiente de #93.

Por tanto, **no se declara 100 % de pantallas, cierre productivo ni integración en main**. Pendientes para integrar: transporte real y Windows/Electron, PostgreSQL físico, revisión funcional restante y CI exact-head conforme a gobernanza. El producto canónico sigue en main@591ad4c.

### Revisión adicional de persistencia — 2026-10-18

- Sobre `116d64e7` limpio se ejecutaron 20 pruebas unitarias de repositorios centrales y 13 comprobaciones estáticas de las migraciones 004–008: aprobadas. Los repositorios usan pools simulados en esas pruebas; no acreditan PostgreSQL físico ni RLS real.
- Se corrigió una aserción tautológica en la prueba física existente de concurrencia de onboarding. Ahora compara tenant, company, branch, owner y membership entre ambas respuestas, conforme a UC-ONB-001; antes comparaba el mismo arreglo consigo mismo. No cambia código de producción, contratos ni SQL.
- El typecheck de pos-local-service y las 6 pruebas unitarias existentes de InitializeTenant aprobaron tras el cambio. La suite física reportó expresamente **5 omitidas** por ausencia de POSTGRES_TEST_URL; su salida 0 no se declara PASS físico. La ejecución real de esas aserciones queda REQUIRES_LOCAL_VERIFICATION.
- Los bloqueos de transporte/Windows/PostgreSQL del apartado siguiente siguen abiertos; no se fusiona #92 ni se activa #93 por estas comprobaciones estáticas/unitarias.

### Ejecución autorizada — reconciliación y seguridad

Esta actualización sustituye el estado operativo del corte inicial conservado abajo. La línea activa ya contiene `main@591ad4c`: comparación remota **0 behind**. `main` permanece en su SHA; la integración siguiente sigue siendo PR #92.

| Cambio aplicado en la línea activa | Commit | Evidencia |
|---|---|---|
| Incorporar main respetando sus retiradas | `690b8836` | Merge con padres `6c0aaea2` y `591ad4c1`; comparación de tres árboles sin conflictos. Único delta neto: documento del avatar. |
| Conservar el delta útil de #94 | `8336a0dd` | Segundo padre `b08efb8f`; el limiter/orden ya existían. Se incorporan las aserciones que impiden aprobar por un índice -1. |
| Conservar el delta útil de #95 | `10be72ed` | Segundo padre `41e2b1a8`; expiración exclusiva y regresión correspondiente. |
| Corregir el presupuesto de enrolamiento | `0b662018` | Un presupuesto por dirección remota/ruta, independiente del bearer. Cambio de producción de dos líneas retiradas y una añadida, más regresión de listener. |

#94 y #95 están integradas en la línea activa, **no fusionadas en main**. Sus PR originales conservan la evidencia del HEAD probado. La cola ya no requiere volver a aplicar esos deltas. No se crearon ramas ni se portaron los linajes archivados.

#### Ejecuciones observadas

Entorno de validación: Linux, Node 24.19.0, pnpm 9.15.0, TypeScript 6.0.3 y Vitest 4.1.11. Copias de los HEAD remotos verificadas por SHA de blob; la línea activa también se materializó como checkout Git con commit y árbol exactos e historia shallow. Instalación de la línea activa con `--frozen-lockfile`: salida 0.

| Comprobación | Resultado y alcance |
|---|---|
| #94 exacto `b08efb8f` | 4 pruebas del limiter y typecheck central: salida 0. |
| #95 exacto `41e2b1a8` | 19 pruebas de device-trust y su typecheck: salida 0. |
| Baseline activo `6c0aaea2` | Typecheck general: salida 0; 16 pruebas del validador, límites y política: aprobados. |
| Seguridad sobre `0b662018`, checkout limpio | 23 pruebas device-trust + 11 centrales: aprobadas; typechecks central-authority/device-trust/local-channel: salida 0. |
| Juntura local sobre `0b662018`, checkout limpio | 25 pruebas existentes de enrolamiento, dispatcher, componente de sync y refresco de trust: aprobadas. |
| Contratos / canal local | 277 / 6 pruebas: aprobadas. |
| Domain / Application / adapters fiscales | 47 / 16 / 173 aprobadas; 2 de sandbox fiscal omitidas. |
| SQLite / observabilidad / escritorio / migraciones SQLite | 58 / 4 / 142 / 13 aprobadas. |
| Runtime local completo, baseline | **No aprobado:** 618 aprobadas, 33 fallidas, 10 omitidas; 3 archivos fallan al abrir sockets Unix con EPERM. El script encadenado se detuvo antes del escritorio; sus 142 pruebas se ejecutaron después por separado. |

La regresión nueva importa el listener de producción y envía 31 solicitudes HTTP por loopback cambiando bearer. Antes de la corrección falla (401 en lugar de 429); después aprueba: las primeras 30 son 401 y la 31 devuelve 429, sin consultas a PostgreSQL. También comprueba que session-trust mantiene su presupuesto separado y health continúa respondiendo. TLS y PostgreSQL se sustituyen sólo dentro de esta prueba; no se presenta como E2E de TLS/DB.

Los 33 fallos no se ocultaron ni se cambiaron por skips. Una sonda independiente confirmó EPERM al crear sockets Unix en /tmp, /dev/shm y el workspace; TCP loopback sí admite bind. No se modificó el transporte de producción para acomodar esta restricción. PostgreSQL real, canal Windows, E2E Electron y CI del candidato siguen sin certificar.

El intento inicial del comando general invocó el pnpm global 11 y se abortó antes de probar; se repitió fijando PATH a pnpm 9.15.0. Un directorio vacío residual del cambio de snapshot causó un primer fallo del scanner de áreas; se retiró al comprobar que no existe en el árbol Git. Ninguno se atribuye al código del producto.

#### Cola actual

1. Validar el transporte completo en un entorno que permita sus sockets y el canal de Windows; conservar el fallo observado en este entorno.
2. Continuar la revisión restante de #92 por los módulos y dependencias ya inventariados, con PostgreSQL real donde corresponda y controles de permisos/tenant.
3. Satisfacer el gate vigente del HEAD final y la verificación post-merge antes de integrar #92 en main.
4. Reevaluar #93 sobre la base final y cerrar prerrequisitos 008/009, correlación de pagos y HTTPS; no ampliar su alcance antes.

### Corte inicial de auditoría — evidencia histórica

Las cifras A/B y decisiones de la primera cola que siguen corresponden al estado anterior a esta ejecución. Para la cola vigente se aplica el apartado anterior.

- Producto integrado: `main@591ad4c19df9c8e36f451e9c243dda8b47dc7e51`.
- Línea de implementación: `3a4f70b22efbf0a18d3ec6ed2db33ad33cdb13c7` ([rama de origen de PR #92](https://github.com/Andresito202/pos-platform/pull/92)), antes del commit documental de reconciliación.
- Objetivo único: reconciliar, revisar y validar el delta acumulado de PR #92; no abrir otra implementación.
- Comparación por ascendencia: 553 commits propios y 9 de `main` ausentes en la línea. El número de commits no mide funcionalidades pendientes ni duplicadas.
- Comparación de PR desde el ancestro común: 188 archivos, +9732/-896. Comparación directa de los dos árboles completos: 194 rutas diferentes (111 modificadas, 77 añadidas y 6 ausentes). Incluye movimientos de archivos; no son 194 defectos.
- PR #89 y #91 fueron fusionadas el 2026-10-05. PR #78 está cerrada sin merge propio: ya no representa la cola actual.
- Los nueve commits posteriores a `ed13f6e` en la primera línea de `main` tienen un solo padre. Incumplen el método de integración vigente, que exige merge commit de PR; no se reescribe historia para ocultarlos.
- GitHub devuelve `protected: false`; la consulta de rulesets responde 403 por el plan del repositorio privado. El control existente es detectivo.
- TARGET run `39084346449` y CodeQL run `39084346418`, sobre `41e2b1a8`: jobs de ejecución con `runner_id: 0` y cero pasos. No son evidencia de tests fallidos ni aprobados; la causa de facturación no se revalidó en esta auditoría.
- Se ejecutaron inspección remota de Git/árboles/código/configuración y una reproducción aislada del limiter con su expresión de clave de producción (Node 24.19.0, salida 0). Las suites del repositorio, typecheck, PostgreSQL real, Windows/Electron y estado del PC: `REQUIRES_LOCAL_VERIFICATION`.

### Cola de integración del corte inicial (histórica)

| PR | Dependencia y alcance observado | Estado / siguiente condición |
|---|---|---|
| #94 | Base `main`; 4 commits, 3 archivos: rate limit de session-trust | `BLOCKED`: ejecutar tests/typecheck. El módulo del limiter coincide byte a byte con la línea activa, pero los otros dos archivos difieren; reconciliar ese solapamiento, no copiar archivos completos. |
| #95 | Base `main`; 3 commits, 2 archivos: rechazo en el instante exacto de expiración | `BLOCKED`: ejecutar tests/typecheck. El guard `now >= expires_at` difiere del código de la línea activa; conservar el delta y su regresión al reconciliar. |
| #92 | Base `main`; acumulación de CI, seguridad/sync, onboarding, administración, UI y migraciones | `BLOCKED`: reconciliar los nueve commits de `main`, revisar por unidades y ejecutar validación sobre el candidato completo. No es una corrección pequeña de CI. |
| #93 | Base en la línea de #92; +39 commits, 21 archivos, +1013/-7 | `BLOCKED`: webhook/inbox de FACTUS Pay. No sustituye la facturación electrónica; falta correlación autoritativa con el pago, PostgreSQL/HTTPS real y verificación del prerrequisito 008 del runner 009. |

Los cuatro PR continúan en borrador. `mergeable: true` sólo indica que GitHub puede construir una fusión textual; `mergeable_state: unstable` no certifica el producto. La tabla no autoriza un merge ni crea ramas nuevas.

### Estado técnico verificado por inspección

| Área | Existe en la línea auditada | Falta demostrar o completar |
|---|---|---|
| POS local | Electron/React/Vite, Local Service, SQLite/WAL y módulos comerciales bajo `apps/pos-local-service/src/` | Regresión completa, transporte Windows real y flujo por rol en el candidato de integración. No declarar ausentes estas aplicaciones por los textos históricos inferiores. |
| Credenciales y sync | `main.ts` carga `EnrolledDeviceCredentialProvider` cuando existen identidad y credencial cifradas, e inyecta claves de sesión; `central-sync-server.ts` verifica prueba firmada y revalida credencial en la transacción | Aprovisionamiento/rotación/revocación y persistencia/replay probados en el entorno objetivo. El fallback no aprovisionado sigue siendo fail-closed; no significa que el único provider sea ya el no aprovisionado. |
| Login y recuperación | Contratos/repositorios y SQL 007/008 | El listener revisado expone health, session-trust y device-enrollment; no contiene login/refresh/recuperación de usuario completos. Las tablas no acreditan esos flujos. |
| Administración | Métricas de tenant y consulta de auditoría tienen hooks/casos de uso; panel de superadministrador presenta valores pendientes | Lifecycle central de cuentas, usuarios/roles, planes y licencias; conectar la superficie al contrato autoritativo y probar límites de tenant/rol. |
| FACTUS fiscal | Adapter y puertos existentes | La declaración mantiene emisión/consulta/artefactos en `MOCK_TESTED`; no equivale a emisión real verificada ahora. |
| Rate limit de enrolamiento | La clave de bucket combina IP y hash del bearer; 30 intentos del mismo token agotan su bucket | Reproducción aislada: 100 tokens inválidos distintos recibieron presupuesto desde la misma IP y ventana. No se levantó HTTP ni se autenticó ninguno. #94 sólo cubre session-trust; falta corregir y probar la política de enrolamiento sobre el runtime. |
| Validación | Suites y workflows específicos existen | `pnpm typecheck` raíz omite central-authority, device-trust y local-channel. D-3 cubre typechecks de los dos primeros por separado, pero usa `pnpm install --no-frozen-lockfile`; su selección de tests central no incluye el nuevo limiter. Revisar cobertura y reproducibilidad antes de certificar. |

La retirada del runner 008 en `main@591ad4c` fue explícita. No se restaura automáticamente para satisfacer 009: comprobar la disposición aprobada y el ledger real. El runner 009 exige checksums APPLIED de 002, 007 y 008; el script local de FACTUS Pay no prueba aplicación física de migraciones ni HTTPS.

## Estados

| Estado | Significado |
|---|---|
| `DONE` | Alcance cerrado con evidencia verificable del nivel declarado. |
| `IN_PROGRESS` | Trabajo principal activo y delimitado. |
| `READY` | Dependencias y alcance suficientes para iniciar, pero no activo. |
| `BLOCKED` | Trabajo válido detenido por un impedimento explícito. |
| `PLANNED` | Trabajo aceptado aún no preparado/iniciado. |
| `DEFERRED` | Trabajo válido aplazado a otra fase. |
| `OUT_OF_SCOPE` | Excluido deliberadamente del alcance vigente. |

Los niveles `DOCUMENTED`, `MATERIALIZED`, `TESTED`, `REVIEWED`, `CANONICALLY_APPLIED` y `PRODUCTION_READY` no son equivalentes.

## Baseline canónico

### Integrado en `main`

- Fase 0 documental: `DONE`.
- PR #2: `MERGED / CLOSED`; fundación TARGET integrada.
- PR #3: `MERGED / CLOSED`; runtime/documentación legacy retirados del árbol TARGET.
- Migration 001: `MATERIALIZED / TESTED / IMMUTABLE`.
- Migration 002 External Integrations: `MATERIALIZED / TESTED / IMMUTABLE`, PostgreSQL central, dispatch físico `NON_FISCAL`.
- MAT-003 preflight tooling: `MATERIALIZED / REVIEWED`.
- canonical-role-readiness tooling: `MATERIALIZED / REVIEWED`.
- canonical-role readiness: `APPLIED / REVIEWED` solo en `LOCAL_CANONICAL_INTEGRATION`.
- MAT-003 preflight canónico: `EXECUTED / PASS / REVIEWED`, read-only, cero mutaciones durables.
- PR #5: `MERGED / CLOSED`; supply-chain baseline + gobernanza detectiva de `main` integrados.
- PR #6: `MERGED / CLOSED`; fuentes canónicas reconciliadas.
- PR #7: `MERGED / CLOSED`; `Camacho POS Colombia` adoptado como nombre comercial con clearance oficial todavía pendiente.
- PR #8: `MERGED / CLOSED`; gobernanza detectiva de pushes a `main` endurecida para validar todo el rango de primer padre y fuentes de estado reconciliadas.
- PR #4: `MERGED / CLOSED`; propuesta V7 de reconciliación SQL003 integrada con `PROPOSAL_REVIEW = PASS`.
- PR #9: `MERGED / CLOSED`; remediación contractual autoritativa V2 integrada con `AUTHORITATIVE_CONTRACT_REVIEW = PASS`.
- PR #10: `MERGED / CLOSED`; reconciliación post-merge de INT-006 integrada.
- PR #11: `MERGED / CLOSED`; INT-007 / SQL003 V2 integrado con Gate A `PASS / FROZEN` y Gate B `PASS / CLOSED`.
- HEAD exacto integrado de PR #11: `39c56d030954f3bef20b84f773e4a4f76766a06b`; Codex exact-head: `Didn't find any major issues`; 48/48 review threads resueltos.
- Merge commit canónico: `8676caef419d70732f74489a413ae7fda2c49d0c`.
- Run post-merge #159 `33142409080`: `COMPLETED / SUCCESS`, incluidos `Main push governance`, repository/secret policy, dependency inventory, TypeScript, SQLite, PostgreSQL 16.14 migrations 001/002/003, Modelo A, MAT-003 preflight y role-readiness.
- Artifact post-merge exact-head: `int-007-gate-b-8676caef419d70732f74489a413ae7fda2c49d0c`.
- PR #15: `MERGED / CLOSED`; TECH-004 CI, calidad y supply chain integrado.
- HEAD exacto de cierre TECH-004: `cc8aba3f8f873eab9ba7a5d93803870487eed810`; TARGET #225 / run `33176899684` y CodeQL #36 / run `33176899692` `SUCCESS`.
- Merge commit TECH-004: `cf8632c032d0cdd0e7e5c8cb21b532b35294218f`, firma GitHub válida.
- Post-merge TARGET #226 / run `33177520034`: `SUCCESS`; CodeQL #37 / run `33177520014`: `SUCCESS`; Main push governance: `SUCCESS`.
- Post-merge supply chain: 194 packages / 11 direct / 10 workspaces, 0 advisories, SBOM 259 components / 259 relationships, SPDX 249 ALLOW / 0 REVIEW_REQUIRED / 0 DENY, SARIF 0 results.
- Post-merge provenance manifest SHA-256: `311fb9827017ebfad109cfe2f809787233fc75a9364c6ea5d6e98bfdcd5b647b`; GitHub native Artifact Attestation permanece `BLOCKED_BY_PLATFORM`, no PASS.

La evidencia de SHA anterior es commit-scoped; el HEAD vigente de `main` siempre se consulta en GitHub antes de cualquier integración.

### Snapshot histórico de ausencias — agosto de 2026

Estas ausencias describen aquel baseline, no el árbol actual. El estado actual está en la reconciliación operativa de la cabecera.

- NestJS/Fastify runtime: `ABSENT / NOT_MATERIALIZED`.
- Electron/React/Vite: `ABSENT / NOT_MATERIALIZED`.
- POS Local Service: `ABSENT / NOT_MATERIALIZED`.
- Nx foundation y límites de packages: `INTEGRATED / TESTED` por ARCH-003 / PR #12; las aplicaciones runtime continúan `ABSENT / NOT_MATERIALIZED`.
- SQL 003 DDL + descriptor 003: `INTEGRATED / GATES_CLOSED / PHYSICALLY_VALIDATED_IN_POSTGRESQL_16_14`; apply→introspection/smoke→down→exact-002→reapply y Modelo A pasan; SQLite 003 permanece `NONE`.
- schema/migration 003 en un entorno compartido o productivo: `NOT_DEPLOYED`; INT-007 cerró el artefacto de repositorio y su evidencia CI, no un despliegue productivo.
- bundle autoritativo V2 de INT-006: `INTEGRATED / REVIEWED` por PR #9; la autorización separada para iniciar diseño/materialización SQL003 fue otorgada el 2026-08-26 y queda acotada a INT-007.
- SIIGO/FACTUS/ALEGRA adapters reales: `DESIGNED / NOT_EVALUATED`.
- infraestructura productiva/piloto: pendiente.
- hardware certificado: todos los modelos continúan sin certificación productiva.
- `SEC-G01..SEC-G10`: `PLANNED / NOT_EVALUATED`.

## Gobernanza de `main`

`main` es la única rama canónica.

Branch protection preventiva nativa no está disponible para el repositorio privado con el plan GitHub vigente. GitHub reporta `protected: false` y sin required status checks.

Control compensatorio integrado:

- PR hacia `main` -> CI commit-scoped;
- push a `main` -> CI completo + `Main push governance`;
- merge permitido por política: merge commit normal mediante PR;
- direct push, squash y rebase -> violación detectada por workflow;
- el guard revisa el rango completo de primer padre introducido por cada push;
- gate exacto y post-merge: `docs/governance/repository-governance.md`.

Este control es detectivo, no preventivo.

## Ramas persistentes — inventario remoto al 2026-10-17

Son 17 refs observados, no los 68 del registro histórico de septiembre. A/B son commits exclusivos por ascendencia respecto de `main@591ad4c`, no una medida de valor funcional. SHAs completos consultados por API; aquí se abrevian para lectura. Los conteos preceden al commit documental de reconciliación.

| Rama | HEAD | A/B | Disposición |
|---|---|---|---|
| `audit/branch-deprecation-record` | `bf39de72` | 0/424 | INTEGRATED; ref auxiliar sin commits únicos respecto de main; candidato a retiro separado |
| `_audit-temp` | `bf39de72` | 0/424 | INTEGRATED; mismo tip que el otro ref de auditoría; candidato a retiro separado |
| `fiscal-adapter-gate` (etiqueta histórica) | `c7eaa2dd` | 2/556 | HISTORICAL_WIP; documentación, extraer sólo valor vigente si falta |
| `handler-response-typing` (etiqueta histórica) | `ad7c711a` | 1/492 | HISTORICAL_WIP; revisar guard de tipos vigente; no reemplazar el handler |
| `ledger-wip-lineage-correction` (etiqueta histórica) | `6651596a` | 1/555 | HISTORICAL_WIP; corrección documental histórica |
| [rama de origen de PR #92](https://github.com/Andresito202/pos-platform/pull/92) | `3a4f70b2` | 553/9 | ACTIVE; única línea de implementación, PR #92 |
| `sale-cash-shift-binding` (etiqueta histórica) | `940f5d70` | 1/492 | HISTORICAL_WIP; no integrar selector por origin_device_id contrario al contrato de caja vigente |
| `domain/cash-open-vertical-20260901` | `503aeb14` | 20/628 | HISTORICAL_WIP; referencia de diseño, no integrar código (DEC-017) |
| `feat/factus-pay-webhook-ingress` | `9804cdc1` | 592/9 | BLOCKED; PR #93 apilada sobre #92, conservar delta |
| `feat/payment-qr-provider-foundation` | `5b363823` | 191/220 | HISTORICAL_WIP; auditar sólo delta útil no contenido; no merge completo |
| `feat/selective-pr79-payment-cash-sale` | `d495915c` | 4/425 | HISTORICAL_WIP; origen selectivo previo, comprobar duplicación funcional |
| `fix/runtime-status-envelope` | `024987b0` | 21/464 | HISTORICAL_WIP; evidencia del PR #79 cerrado, no merge completo |
| `fix/session-trust-rate-limit-order` | `b08efb8f` | 4/0 | BLOCKED; PR #94 extraída hacia main; solapa con #92 |
| `main` | `591ad4c1` | 0/0 | CANONICAL_PRODUCT; preservar historial |
| `test/device-enrollment-challenge-time-boundary` | `41e2b1a8` | 3/0 | BLOCKED; PR #95 extraída hacia main; pendiente de ejecución |
| `wip/local-catalog-inventory-payment-20260906` | `a10249fe` | 21/628 | HISTORICAL_WIP; referencia de diseño, no portar código (DEC-018) |
| `wip/sql003-contract-gap-20260825` | `dd07f9d4` | 1/1010 | HISTORICAL_WIP; SQL003 sustituida, no reintroducir migraciones |

El inventario de `branch-deprecation-audit-2026-09-16.md` se conserva como evidencia histórica, no como lista de ramas presentes. Esta reconciliación sólo avanza documentalmente la línea activa; no borra refs ni altera sus linajes. Los dos refs auxiliares están contenidos en main; las demás ramas históricas divergentes no se consideran integradas sólo porque algunas capacidades coincidan.

## Flujo oficial de trabajo

`PLANNED -> READY -> IN_PROGRESS -> DONE`

con `BLOCKED`, `DEFERRED` y `OUT_OF_SCOPE` como estados explícitos.

Reglas:

1. Debe existir un solo trabajo principal `IN_PROGRESS`, salvo excepción documentada.
2. Un trabajo bloqueado no cuenta como línea principal activa, pero conserva causa y condición de desbloqueo.
3. No se abre otra rama para el mismo objetivo.
4. No se marca `DONE` por documentación si el criterio exige implementación.
5. Todo merge a `main` sigue el gate de gobernanza.
6. Cada cambio que altere estado/orden actualiza este backlog en el mismo PR.
7. No se usan estados locales históricos (`CLEAN`, upstream 0/0, Docker, PostgreSQL) como hechos presentes.
8. Un documento V2 abreviado nunca sustituye destructivamente contratos históricos ricos; las remediaciones usan overlays/versionado o reemplazo completo verificable sin pérdida.

## Registro histórico de cierres

### TECH-004 — CI, calidad y supply chain

Prioridad: `P0`

Estado: `DONE / INTEGRATED`

Rama histórica integrada: `tech/tech004-quality-supply-chain-20260828`.

PR #15 fue integrada desde exact HEAD `cc8aba3f8f873eab9ba7a5d93803870487eed810` como merge commit `cf8632c032d0cdd0e7e5c8cb21b532b35294218f`. TARGET #225 y CodeQL #36 cerraron el gate pre-merge; post-merge TARGET #226 / run `33177520034` y CodeQL #37 / run `33177520014` finalizaron `SUCCESS`, incluido Main push governance y provenance exact-head.

El alcance cerrado incluye repository policy, CodeQL/SAST, vulnerability gate, CycloneDX 1.6, compatibilidad SPDX y provenance hash-bound. GitHub native Artifact Attestations permanece `BLOCKED_BY_PLATFORM`; no se representa como firma ni PASS.

Los controles que requieren aplicaciones/runtime — lint/E2E de apps, packaging, firma de releases y promoción — permanecen diferidos a la línea runtime separada.

## Bloque cerrado anterior

### TECH-003 — contratos ejecutables compartidos

Estado: `DONE / INTEGRATED`.

PR #14 fue integrada desde exact HEAD `d37512634c823f16f71928671c46aaccc7f04d3c` como merge commit `148a6546657afed528d3da37b263134a944c09be`. CI exact-head #187 / run `33165786730` fue `SUCCESS`; CI post-merge #188 / run `33165957857` fue `SUCCESS`, incluida gobernanza de main, repository policy/dependency inventory, 57/57 contratos con 5/5 compatibilidad cruzada, TypeScript, SQLite, PostgreSQL 16.14 y MAT-003.

TECH-003 no implementa runtime, autenticación criptográfica productiva, providers ni producción.

## Bloque cerrado anterior

### ARCH-003 — límites ejecutables de módulos / Nx

Estado: `DONE / INTEGRATED`.

PR #12 fue integrada como `bc55851c7045105473d546667dce72718638a8b9`; CI post-merge #170 / run `33145497682` fue `SUCCESS`, incluida gobernanza de main, repository policy, ARCH-003 boundary gate, TypeScript, SQLite y PostgreSQL 16.14.

## Bloque cerrado anterior

### INT-007 — materialización SQL/descriptor 003 sobre bundle V2

Prioridad: `P0`

Estado: `DONE / INTEGRATED`

Baseline y autorización:

- rama: `feat/sql003-v2-materialization-20260826`;
- base exacta: `main@b28ca8850acc6b97385c80627a9d64b7ea607a42`;
- INT-006: `DONE`;
- bundle V2: `INTEGRATED / REVIEWED`;
- autorización separada para iniciar diseño/materialización SQL003: `GRANTED 2026-08-26`.
- Gate A contract remediation commit: `c0df539eb52d370fbfd0902a3df0d1ec94332398`; semantic dispatch checksum, credential binding pinning y definición física de catálogo remediados; evidencia exact-head CI/Codex todavía requerida antes de Gate B.
- Gate A exhaustiveness hardening: definitions must cover exact set equality for every advertised constraint/index/guard/policy; semantic FISCAL fields are explicitly NOT NULL by CHECK semantics; normative one-IN_PROGRESS and one-FISCAL-dispatch indexes are required.
- Gate A local-numbering hardening: `AUTHORIZED_RANGE|LOCAL_CONTINGENCY` require non-null start/end/cursor before numeric comparisons so PostgreSQL CHECK three-valued logic cannot admit unusable configurations.
- Gate A function/transition hardening: all fiscal functions referenced by guards/policies/checks require canonical SQL definitions; migration 003 must validate `integration_dispatches_dispatch_class_003_ck` before retiring 002, and down must validate restored 002 before retiring 003.
- Gate A preparation-scope hardening: preparation INSERT revalida bajo lock document generation/type, configuration `PUBLISHED` + vigencia + branch, connection vigencia e `ExternalIntegration=ACTIVE`; no basta una FK histórica.
- Gate A reprepare-closure hardening: deferred current-generation validator requires predecessor preparation `CANCELLED`, any historical FISCAL dispatch `CANCELLED`, and no predecessor numbering left `RESERVED` before commit.
- Gate A published-config hardening: published fiscal configuration material is immutable; only local numbering cursor/exhaustion plus row-version/timestamp may advance, and terminal versions cannot be rewritten.
- Gate A branch hardening: preparation branch must equal ElectronicDocument branch at INSERT and deferred current-generation validation.
- Gate A late-evidence hardening: CANCELLED remote PENDING_EXTERNAL may resolve only to CONSUMED|UNKNOWN_OUTCOME with admissible generation-scoped evidence; local numbering history remains immutable.
- Gate A webhook fence hardening: VERIFIED auth+replay correlation acquires document→preparation→dispatch fence; provider-specific general-receipt selector remains an explicit versioned external contract with tenant/integration-only matching forbidden.
- Gate A claim hardening: PostgreSQL revalidates ACTIVE integration, adapter/declaration/capability, credential binding, connection/config and document/preparation/dispatch; FISCAL_EMISSION_SNAPSHOT_V2 external material must be compared fail-closed by the command under the same fence.
- Gate A claim lock-order hardening: ProviderCapabilityDeclaration→ProviderAdapterVersion→ExternalIntegration→IntegrationCapability→credential binding→FiscalConnection/config/version→document/preparation/dispatch; current capability rows are locked, not merely counted.
- Gate A configuration-selection hardening: preparation and claim re-resolve effective BRANCH>COMPANY version under locked FiscalConnection coordinator; publication after freeze cannot silently leave an obsolete company-wide snapshot eligible.
- Gate A preparation lock-order hardening: preparation now locks Declaration→Adapter→ExternalIntegration→IntegrationCapability→FiscalConnection→Config/Version before ElectronicDocument/predecessor; caller must not pre-lock a successor and the FiscalConnection coordinator precedes the BRANCH/COMPANY candidate scan.
- Gate A declaration lock-mode hardening: ProviderCapabilityDeclaration is consumed with `FOR UPDATE` in preparation and claim, matching downgrade serialization.
- Gate A claim caller-order hardening: attempt trigger is defense-in-depth only; claim command must own the canonical upstream prefix before Document/Dispatch state mutation and attempt INSERT, with commit before HTTP.
- Gate A post-claim evidence hardening: live integration/capability/connection/config eligibility is revalidated only when entering `IN_PROGRESS`; response/evidence persistence after durable claim validates immutable root scope and cannot be blocked by later downgrade/expiry.
- Gate A late-evidence authorization hardening: any mutation of a CANCELLED historical preparation requires durable `VERIFIED_LATE_REMOTE_EVIDENCE_V1` comparator output; late numbering additionally binds `numbering_resolution_reason` to the exact lowercase SHA-256 comparator evidence checksum.
- Gate A late-evidence value binding: comparator `expected_state_reference` must equal the canonical JSON array of the exact late mutation values (prefix, number, numbering_state, provider_document_id/reference/status); a valid evidence checksum cannot authorize different values.
- Gate A webhook privilege boundary: historical quarantine runs with invoker privileges; no `SECURITY DEFINER` widening is introduced. An ingress role unable to quarantine fails closed and must defer fiscal linkage to the authorized `pos_worker` correlator.
- Gate A historical quarantine hardening: accepted late historical evidence and historical webhook correlation quarantine the current pre-terminal generation to `UNKNOWN_OUTCOME` in the same transaction; current QUEUED dispatch remains durable but unclaimable.
- Gate A webhook timing hardening: fiscal correlation guard is AFTER-write validation/quarantine under invoker privileges; canonical lock acquisition remains a caller precondition and no privilege widening is introduced.
- Gate A receipt-update transition hardening: 003 creates `external_webhook_receipts_update_guard_003` with the exact 002 lifecycle allowlist plus the five fiscal linkage fields before dropping the narrower 002 guard; down restores 002 first, so there is no permissive window.
- Gate A receipt lock-order hardening: `external_webhook_receipts_fiscal_correlation_guard` fires only on INSERT or UPDATE OF the five fiscal linkage columns. Ordinary 002 processing-status updates bypass the fiscal fence and cannot acquire receipt-before-document locks.
- Gate A publication-coordinator hardening: DRAFT→PUBLISHED takes `FiscalConnection FOR UPDATE`; publication command must acquire that coordinator before updating the version so BRANCH>COMPANY selection and publication share the same phantom fence.
- Gate A webhook-ingress privilege hardening: migration003 converts inherited table-wide `pos_platform_app INSERT` into base-column INSERT only; the five fiscal linkage columns are NULL at ingress and `pos_worker` is the sole fiscal linkage writer under the canonical fence.
- Gate A dispatch-ingress privilege hardening (self-found during Gate B preparation): migration002 also gives `pos_platform_app` table-wide INSERT on `integration_dispatches`; 003 must convert it to exact base-002-column INSERT so the four fiscal extension columns remain inaccessible while non-fiscal platform dispatch creation remains available.
- Gate A webhook lock-order clarification: receipt trigger is revalidation only; correlator command must lock document→preparation→dispatch before mutating/inserting the receipt linkage.
- Gate A connection hardening: FiscalConnection closure is CAS-versioned and irreversible; a closed connection cannot be reopened, extended or rewritten.
- Gate A closure record: `DONE / FROZEN`; the historical pending/remediation-candidate checkpoints are superseded by exact-head CI #98 and Codex closure on `c297d465cbfb9349f53d3f2e368034dddb9ca545`. Gate B is the only active INT-007 gate.

Alcance autorizado:

- Gate A: descriptor 003, catálogo esperado, constantes/exports y tests estáticos del contrato materializable; incluye definiciones físicas verificables, checksum semántico por dispatch y credential binding generation por attempt;
- Gate B: SQL PostgreSQL 003 up/down, runner apply/down, introspection, smoke, grants/RLS/guards y pruebas funcionales/concurrencia del target de diez tablas;
- preservar migrations 001/002 byte-for-byte;
- mantener SQLite migration 003 en `NONE`;
- usar exclusivamente Modelo A y `SUBMIT_DOCUMENT` físico V1.

No alcance:

- adapters SIIGO/FACTUS/ALEGRA;
- HTTP/credenciales/sandbox provider;
- runtime NestJS/Electron;
- promoción de `SEC-G01..SEC-G10`;
- query/retrieve físico V1;
- merge de la rama sin gate posterior separado.

INT-007 no se considera `DONE` por crear el descriptor ni por producir SQL estático. Requiere DDL ejecutable, validación de catálogo, apply/down, regresión 001/002, CI exact-head y revisión independiente.

Checkpoint final 2026-08-28:

- Gate A: `PASS / FROZEN`.
- Gate B: `PASS / CLOSED`.
- INT-007: `DONE / INTEGRATED`.
- Exact implementation HEAD: `39c56d030954f3bef20b84f773e4a4f76766a06b`.
- CI exact-head #158 / run `33141808515`: `SUCCESS`.
- Codex exact-head: `Didn't find any major issues`; review threads `48/48 RESOLVED`.
- PR #11: `MERGED / CLOSED`.
- Merge commit: `8676caef419d70732f74489a413ae7fda2c49d0c`.
- CI post-merge #159 / run `33142409080`: `SUCCESS`; main governance, repository policy/dependency inventory, TypeScript, SQLite, PostgreSQL 16.14 y tooling MAT-003 verdes.
- Artifact post-merge: `int-007-gate-b-8676caef419d70732f74489a413ae7fda2c49d0c`.
- Providers, HTTP/credenciales/sandbox, runtime, hardware, producción y `SEC-G01..SEC-G10` permanecen fuera del cierre de INT-007.

### INT-006 — remediación contractual autoritativa de migration 003

Prioridad: `P0`

Estado: `DONE`

Baseline habilitante:

- PR #4 `MERGED / CLOSED`;
- propuesta `PROPOSAL_V7 / MODEL_A_SELECTED`;
- CI V7 `SUCCESS`;
- revisión independiente V7 `PASS`;
- PR #9 `MERGED / CLOSED` sobre HEAD exacto `655b824fee296a7bececa113bbb9dd0d0ca84a93`;
- `AUTHORITATIVE_CONTRACT_REVIEW = PASS`;
- Codex final sobre `655b824fee`: sin major issues;
- post-merge #64 `SUCCESS` en `main@be986884cd21aae11f84e64a56158705197325d0`.

Resultado cerrado:

- reconciliar fuentes autoritativas sin perder detalle histórico;
- seleccionar Modelo A exclusivamente;
- materializar documentalmente `preparation_generation` y una representación append-only de cada preparación;
- separar create/replay, edición DRAFT, reprepare y retry;
- mantener root provider-facing estable por dispatch/generation;
- limitar V1 a `SUBMIT_DOCUMENT`;
- definir fence común frente a worker/webhook/reconciliation;
- preservar numeración histórica sin reuse;
- mantener SQL003/descriptor003 ausentes; su diseño/materialización exige autorización separada posterior.

Bundle autoritativo integrado:

- `docs/migration/sql003-authoritative-contract-remediation-index.md`;
- `docs/migration/sql003-authoritative-contract-codex-resolution.md`;
- `docs/migration/third-target-migration-manifest-v2-authoritative-remediation.md`;
- `docs/architecture/physical-model/electronic-invoicing-schema-v2-authoritative-remediation.md`;
- `docs/architecture/physical-model/fiscal-integration-fence-schema.md`;
- `docs/architecture/electronic-invoicing-v2-authoritative-remediation.md`;
- `docs/use-cases/electronic-invoicing/UC-EINV-001-manage-electronic-document-lifecycle-v2-authoritative-remediation.md`.

Gate de cierre de esta línea:

1. commit atómico y diff documental delimitado;
2. CI commit-scoped `SUCCESS`;
3. revisión independiente del HEAD exacto;
4. cero BLOCKER/HIGH/MEDIUM abiertos;
5. `AUTHORITATIVE_CONTRACT_REVIEW = PASS`;
6. integración a `main` solo mediante autorización separada y gate de merge vigente.

Cierre verificado: los seis criterios se cumplieron; PR #9 fue integrada y el run post-merge #64 cerró `SUCCESS`.

Ese cierre **no** materializa SQL003; únicamente habilita una tarea posterior separada para diseñarlo.

### TECH-004 — CI, calidad y supply chain

Prioridad: `P0`

Estado: `DONE / INTEGRATED`

Rama histórica integrada: `tech/tech004-quality-supply-chain-20260828`.

Baseline ya materializado:

- gate TARGET en PR y push a `main`;
- Nx + límites ejecutables de dependencias integrados por ARCH-003;
- typecheck del tooling actual;
- SQLite migrations/regresiones actuales;
- PostgreSQL 001/002 + MAT-003 tooling;
- repository policy;
- scanner baseline de secretos trackeados;
- frozen lockfile;
- dependency/license inventory;
- artifact obligatorio;
- Actions fijadas por SHA;
- `persist-credentials: false`;
- regresión ejecutable del rango de primer padre de `main`;
- gobernanza detectiva de push a `main`.

Materializado en el alcance estático de TECH-004:

- CodeQL/SAST + hardening TOCTOU, con SARIF exact-head y política fail-closed;
- vulnerability scanning con piso high/critical, triage y excepciones temporales explícitas;
- SBOM CycloneDX 1.6 con grafo workspace + dependencias opcionales reportadas por pnpm;
- gate SPDX de compatibilidad de licencias sobre todo el universo third-party del SBOM;
- provenance hash-bound que enlaza TARGET, inventory, vulnerabilidades, SBOM, licencias y CodeQL;
- GitHub native Artifact Attestations registradas como `BLOCKED_BY_PLATFORM`, no como PASS.

Diferido hasta que existan artefactos runtime/release reales:

- lint del runtime/aplicaciones;
- firma de releases;
- runtime/E2E tests;
- packaging y controles de release/promoción.

TECH-004 quedó `DONE / INTEGRATED` mediante PR #15. El cierre exact-head fue `cc8aba3f8f873eab9ba7a5d93803870487eed810`; el merge canónico es `cf8632c032d0cdd0e7e5c8cb21b532b35294218f`. TARGET #226 y CodeQL #37 post-merge quedaron `SUCCESS`, con provenance exact-head verde. Los gates de runtime/E2E/release se incorporarán en la línea runtime posterior cuando existan artefactos ejecutables reales.

## Runtime TARGET — roadmap normativo RT-000..RT-010

Esta tabla gobierna la materialización del runtime. **Estado normativo y presencia de código son dimensiones distintas**: un bloque puede tener código parcial y continuar `BLOCKED` o `IN_PROGRESS` hasta demostrar todos sus invariantes.

| ID | Pri | Estado | Materialización actual | Dependencias / criterio mínimo de cierre |
|---|---|---|---|---|
| RT-000 | P0 | DONE | `INTEGRATED` por PR #17 | Baseline runtime reconciliado sobre `main`; TARGET, CodeQL y main-push governance post-merge verdes. |
| RT-001 | P0 | DONE | POS Local Service + config/lifecycle/health/observability materializados en PR #18 | Config fail-closed; lifecycle ordenado con rollback; shutdown concurrente idempotente y acotado; manejo fatal real; proceso hijo real; logger estructurado con redacción, cola acotada, backpressure, fallo de sink y flush. Evidencia CI + reproducción física Windows sobre el corte funcional validado. |
| RT-002 | P0 | DONE | SQLite/WAL/single-writer/migrations/backup/restore/recovery materializados en PR #18 | Dos procesos escritores reales; crash del owner + stale-lock recovery; WAL + FULL synchronous + foreign keys + trusted_schema OFF; busy_timeout efectivo; migration ledger inmutable; backup verificado pre-migration; falta de espacio/fallo de backup fail-closed; restore atómico con rollback del DB/WAL/SHM anterior ante fallo; integrity/restart recovery. Reproducción física Windows: 11/11 PASS. |
| RT-003 | P0 | DONE | `OS_RESTRICTED / PROTOCOL_VALIDATED` materializado en PR #18 y reproducido físicamente en Windows sobre `9e5672eb2e7668b5a3ee37fa62d7b2538ea280d0` | TECH-003 canónico; handshake + negociación fail-closed; client/server integrados al proceso; deadlines/cancelación; colas acotadas cliente/servidor; replay durable; DPAPI OS_BOUND; named pipe real con DACL `SYSTEM + Logon SID`; pipe squatting fail-closed; TARGET #329 + CodeQL #140 exact-head SUCCESS; reproducción física Windows: SQLite 11/11 y POS Local Service 32 passed / 2 skipped. |
| RT-004 | P0 | DONE | Device trust/license activation materializado en PR #18 | Ed25519 device identity + proof-of-possession; DPAPI OS_BOUND root key; AES-256-GCM envelope; durable key lifecycle ACTIVE/VERIFY_ONLY/REVOKED/REPLACED; activation/suspension/revocation; trusted clock; signing-key revocation; installation/device binding; offline policy; device replacement; append-only security audit; fail-closed capability decision. TARGET #338 + CodeQL #149 exact-head SUCCESS. |
| RT-005 | P0 | DONE | `INTEGRATED` por PR #19, merge commit `de3e20b01b4f740e22f131b3db8eadf706461534` | SQLite v4; outbox/inbox durable; inbox append-only; idempotencia scoped; secuencia local contigua; checkpoints monotónicos; claim durable; retries acotados con backoff; recovery automático de `IN_FLIGHT` al startup; dead-letter durable y requeue explícito. Antes del merge se corrigió una condición de carrera en `process.test.ts` (`waitForLogEvent` no mataba al hijo al expirar, dejándolo huérfano y bloqueando `pos-local.db` en cleanup) que causaba fallos intermitentes reproducibles en el runner Windows de CI; fix verificado con 1 corrida verde post-fix tras 3 rojas reproducibles pre-fix. Post-merge sobre `main@de3e20b`: TARGET foundation validation + CodeQL + `Main push governance` `SUCCESS`, verificado vía `gh run list`/`gh ls-remote` en esta sesión. Revisión: el autor y único desarrollador autorizado, Wilson Andrés Camacho Culma, revisó el diff completo del merge `de3e20b01b4f740e22f131b3db8eadf706461534` el 2026-09-01 (política permanente de revisión de autor único — ver docs/governance/repository-governance.md, sección "Política permanente de revisión en proyecto de un solo desarrollador"). |
| RT-006 | P0 | DONE | `INTEGRATED` por PR #21, merge commit `77f96fcf7f9580a9e33520a0f284bc7af6e18d8f` | Primer vertical slice runtime completo: request → auth → validation → SQLite transaction → outbox → response → restart/retry → audit, vía `operation.confirm` (confirmación genérica, no un agregado de dominio comercial — todo el núcleo comercial tiene su `PHY-Gxx` físico `CLOSED` pero el gate de DDL/"primera migración" sigue `NO-GO` para todos por igual, `docs/architecture/physical-model/traceability.md:271`). `tenant_id`/`company_id`/`branch_id` derivados de config local (`POS_TENANT_ID`/`POS_COMPANY_ID`/`POS_BRANCH_ID`), mismo nivel de confianza self-asserted que `installation_id`/`device_id`; derivarlos de la licencia firmada de RT-004 sigue siendo el diseño objetivo pero requiere infraestructura de provisión de licencia (`LIC-003`/`DEV-003`) inexistente hoy — gap documentado, no atajo silencioso. Actor de toda operación es el dispositivo (`actor_type=DEVICE`), nunca un usuario; SEC-G01/G02/G03 no se tocan ni avanzan. `MIGRATION_005` agrega únicamente `local_operation_audit` (infraestructura, mismo patrón que `local_security_audit` de RT-004), sin tabla de dominio comercial. Transacción anidada (`better-sqlite3` SAVEPOINT) prueba rollback atómico entre el hecho de negocio y el outbox. Post-merge sobre `main@77f96fc`: TARGET foundation validation + CodeQL + `Main push governance` `SUCCESS`, verificado vía `gh run list`/`gh ls-remote` en esta sesión. Revisión: Wilson Andrés Camacho Culma autorizó el merge sobre el head `c2adbbe6ac130bf8efcf86d049e484408ccdbdca` el 2026-09-01, con base en el diseño discutido en sesión y el resumen de verificación (no lectura línea por línea propia), conforme a la política de revisión de autor único; El agente hizo además una revisión técnica propia del diff sin hallazgos bloqueantes. |
| RT-007 | P0 | DONE | `INTEGRATED` por PR #23, merge commit `6a658bd73ed3a712058ce6aca2b2e6006bbab8a1` | Electron main + secure preload + `contextIsolation: true` + `nodeIntegration: false` + `sandbox: true` + IPC allowlist (`pos:runtime.status.get`, `pos:operation.result.get`, `pos:operation.confirm`); sin acceso directo renderer→SQLite/hardware/secrets. `apps/pos-desktop/`: window-security, ipc-allowlist, channel-bridge, preload-api, preload.ts, main.ts; layer `desktop` en module-boundaries.json; tipos ambient de electron vía tsconfig paths (sin binario en CI). 25/25 tests PASS (4 archivos), typecheck CLEAN, ARCH-003 PASS (13/13). Revisión: Wilson Andrés Camacho Culma autorizó el merge sobre PR #23 el 2026-09-03, conforme a la política de revisión de autor único (docs/governance/repository-governance.md). |
| RT-008 | P1 | DONE | `INTEGRATED` por PR #24, merge commit `b24915ab8c8cd3d32fd8d41aea67138cb0ee140e` | Renderer React mínimo y UX operativa sobre contratos permitidos. `apps/pos-desktop/renderer/`: `index.html` (CSP meta + `div#root`), `main.tsx` (`createRoot`), `App.tsx`, `pos-service.ts` (tipado de `window.posService` + guard de disponibilidad), `hooks/useRuntimeStatus.ts` (polling de `runtime.status.get` cada 5s), `components/StatusPanel.tsx` y `components/OperationPanel.tsx`. El renderer consume **exclusivamente** los 3 métodos expuestos por `contextBridge` en el preload de RT-007; no hay `require`, acceso a Node ni IPC directo. `src/main.ts` carga `renderer/index.html` tras `registerIpcHandlers`. Toolchain: `vite.config.ts` (build a `dist/renderer/`), `vitest.config.ts` + `tsconfig.renderer.json` (jsdom + `@testing-library/react`). 41/41 tests PASS (7 archivos), typecheck CLEAN (`tsconfig.json` + `tsconfig.renderer.json`), ARCH-003 PASS, `vite build` OK. Incluye remediación de seguridad obligatoria para superar el gate de CI (ver nota 5 de «Orden inmediato obligatorio»). CI verde sobre `efe7af0`: repository policy + dependency inventory + vulnerability audit, TypeScript/SQLite/PostgreSQL 16.14, Windows local runtime checks, CodeQL y provenance evidence. Revisión: Wilson Andrés Camacho Culma autorizó el merge sobre PR #24 el 2026-09-03, conforme a la política de revisión de autor único (docs/governance/repository-governance.md). |
| RT-009 | P0 | IN_PROGRESS | **RT-009 global `NOT_PASS`** — dividido en A y B | Requiere RT-007/008. Windows Service/installer/signing/upgrade/downgrade/rollback/uninstall/recovery. **RT-009 no se marca PASS mientras RT-009-B siga bloqueado.** |
| RT-009-A | P0 | DONE | `INTEGRATED` por PR #27, merge commit `c178f2d3d233d7f2c849cfdf419d85b820b3edc5` | Núcleo determinista de actualización y rollback. `packages/contracts/src/release.ts`: `ReleaseManifest` (versiones explícitas de `DESKTOP_APP`, `LOCAL_SERVICE`, `LOCAL_SCHEMA`, `CONTRACTS`), `evaluateUpgrade` y `evaluateRollback`, ambos fail-closed y acumulando todas las causas de rechazo. Reglas de DEC-010 «Actualizaciones»: **1, 3 y 7 cubiertas**; **regla 2 cubierta parcialmente** — se evalúa presencia de firma y confianza en la clave, **no** se verifica criptográficamente. Reglas 4, 5, 6, 8, 9 y 10 no cubiertas en este corte. Evidencia sobre `8d07a23`: CI 6/6 (5 `success`, 1 `skipped`), contracts 87/87 tests (+27), CodeQL `SUCCESS`, Provenance `SUCCESS`, ARCH-003 PASS, typecheck CLEAN, sin FAIL ni MAJOR, sin cambios fuera de `packages/contracts`. **Coverage: `NOT_EVALUATED`** — no existe instrumentación de cobertura en el repositorio; no se infiere porcentaje a partir del número de tests. Revisión: Wilson Andrés Camacho Culma autorizó el merge sobre PR #27 el 2026-09-03. |
| RT-009-B | P0 | BLOCKED | `BLOCKED / REQUIRES_CERTIFICATE` | Empaquetado y firma. **Empaquetador decidido: `electron-builder` + NSIS** (DEC-010, decisión cerrada el 2026-09-03); el diseño de upgrade/rollback debe respetar el contrato de RT-009-A, no al revés. **Bloqueo: no existe evidencia de certificado real de firma de código para Camacho POS Colombia.** Es una dependencia externa real, no una tarea de implementación pendiente: no se generan certificados autofirmados ni simulados para destrabar el gate, y la firma no se declara resuelta por la existencia de código que la evalúe. Pendiente en RT-009-B: verificación criptográfica real de la firma, y generación/empaquetado de artefactos firmados. |
| RT-010 | P0 | PLANNED | `NOT_MATERIALIZED` | Requiere RT-001..009. Gate integral de crash/recovery, security, local-first, Windows, packaging y release. |

### Mapping de gates runtime

- `TECH-005` se materializa progresivamente mediante RT-001/002/005/009/010 para observabilidad, backup/restore, update y rollback; no puede marcarse DONE por pruebas unitarias aisladas.
- `TECH-006` se materializa mediante RT-002/005/006/010 para fixtures, multiproceso, concurrencia y recovery.
- `SEC-G04` y `SEC-G07` reciben evidencia candidata desde RT-004; permanecen `PLANNED / NOT_EVALUATED` hasta su gate independiente.
- `SEC-G05` recibe evidencia candidata desde RT-002/003/005; permanece `PLANNED / NOT_EVALUATED`.
- `SEC-G06` recibe evidencia candidata desde RT-004/006; permanece `PLANNED / NOT_EVALUATED`.
- `SEC-G09` y `SEC-G10` dependen además de RT-009/010 y de release/operación reales.
- Ningún RT promueve automáticamente `SEC-G01..SEC-G10`; cada promoción requiere evidencia y evaluación explícitas.

### Exclusiones de PR #18

PR #18 no autoriza RT-005+, Electron, renderer, negocio comercial, providers SIIGO/FACTUS/ALEGRA, producción, packaging final ni promoción automática de security gates. Mientras RT-001..004 no estén cerrados, la PR permanece `DRAFT / NOT_MERGE_AUTHORIZED`.

## Orden inmediato obligatorio

1. Continuar únicamente en la línea activa. Congelar ampliaciones funcionales mientras se reconcilia el alcance acumulado; conservar los cuatro PR existentes y las referencias históricas.
2. Validar los cambios acotados de #94 y #95 contra el `main` consultado. Son candidatos iniciales, no merges aprobados. Registrar ejecución real, revisar sus diferencias con #92 y evitar doble aplicación.
3. Reconciliar los nueve commits propios de `main` con la línea activa, conservando el diseño de avatar y las retiradas intencionales. No reintroducir el runner 008 ni archivos accidentales por resolver conflictos mecánicamente.
4. Revisar el delta de #92 en este orden de dependencias: CI/fixtures y límites; claves/credenciales y sync; onboarding y persistencia central; contratos/handlers de administración; renderer y regresión comercial. Revisar archivos y efectos, no escoger commits por el título. Contratos, backend y llamadores que dependan entre sí forman una unidad.
5. Usar las suites existentes para cada unidad y una regresión completa sobre el candidato conjunto: typechecks de todos los paquetes implicados, arquitectura/política, SQLite, PostgreSQL real, canal Windows y Electron. Registrar SHA, comandos, salidas, omitidas y limitaciones.
6. La política de merge y verificación post-merge sigue siendo `repository-governance.md`. Sin Actions observable se pueden ejecutar validaciones locales, pero no se declara CI verde ni se cambia esa política por inferencia.
7. Después de reconciliar #92, reevaluar #93 sobre su base final: 008/009, persistencia concurrente/idempotente, correlación de pago y HTTPS público. No activar el webhook antes de esa evidencia.
8. Retirar refs redundantes sólo mediante borrado autorizado y disponible, después de conservar su disposición. No crear más ramas para ordenar carpetas ni reimplementar los linajes archivados.

### Registro histórico de orden de trabajo — septiembre de 2026

Lo siguiente conserva decisiones y ejecuciones históricas sobre sus SHAs; no constituye la cola actual ni prueba del HEAD auditado.


1. Mantener **INT-007**, **ARCH-003**, **TECH-003**, **TECH-004** y **RT-000** `DONE / INTEGRATED`; no reabrirlos salvo defecto reproducible o decisión versionada nueva.
2. `main@77f96fcf7f9580a9e33520a0f284bc7af6e18d8f` integra RT-001..006 (PR #18 + PR #19 + PR #20 + PR #21). Post-merge de PR #21: TARGET foundation validation + CodeQL + `Main push governance` `SUCCESS` sobre ese SHA exacto, verificado en esta sesión vía `gh run list` y `git ls-remote origin main`. No hay línea runtime activa en una rama de trabajo en este momento.
3. RT-001..006 quedan `DONE / INTEGRATED`. TARGET + CodeQL exact-head verdes, backlog/PR reconciliados y revisión de autor único (Wilson Andrés Camacho Culma) satisfechos para RT-005 (2026-09-01, sobre `de3e20b0`) y RT-006 (2026-09-01, sobre `c2adbbe6`), conforme a la política permanente de docs/governance/repository-governance.md. Cero findings bloqueantes abiertos de esta sesión.
4. **RT-007 `DONE / INTEGRATED`** — Decisión y revisión de Wilson Andrés Camacho Culma el 2026-09-03. PR #23 mergeado en `main@6a658bd`. 25/25 tests PASS, ARCH-003 PASS, typecheck CLEAN.
5. **RT-008 `DONE / INTEGRATED`** — Decisión y revisión de Wilson Andrés Camacho Culma el 2026-09-03. PR #24 mergeado en `main@b24915a` mediante merge commit. 41/41 tests PASS, ARCH-003 PASS, typecheck CLEAN, `vite build` OK.
5.1. **Auditoría de calidad sobre RT-007/RT-008 — PR #26, `main@46494af`.** Se corrigieron tres defectos que los gates anteriores no detectaban porque pasaban por construcción: (a) `apps/pos-desktop/types/electron.d.ts` suplantaba los 27.287 líneas de tipos reales de Electron vía `tsconfig paths`, de modo que el typecheck nunca se contrastaba contra la API real —la justificación registrada en RT-007 («tipos ambient sin binario en CI») era **incorrecta**: electron publica sus tipos en el paquete npm, independiente del binario—; (b) `void close().finally(() => app.quit())` no capturaba el rechazo y dejaba un *unhandled rejection* en el apagado; (c) `main.ts` y `preload.ts`, los dos únicos archivos que tocan Electron, no tenían cobertura alguna. `pos-desktop` pasa de 41/41 a 62/62 tests y el typecheck queda CLEAN contra Electron 44.1.1 real.
5.2. **RT-009-A `DONE / INTEGRATED`** — PR #27 mergeado en `main@c178f2d`. Ver fila RT-009-A. **RT-009 global permanece `NOT_PASS`** porque RT-009-B sigue `BLOCKED / REQUIRES_CERTIFICATE`.
5.3. **Empaquetador Windows decidido: `electron-builder` + NSIS.** Decisión explícita de Wilson Andrés Camacho Culma el 2026-09-03, registrada en DEC-010 («Empaquetado» → «Empaquetador Windows — decisión cerrada»). Cierra la cláusula abierta previa. **No se vuelve a plantear** la alternativa WiX/MSI ni Squirrel.Windows salvo decisión versionada nueva. No implica implementación: el empaquetador aún no se materializa.
5.4. **Deuda técnica registrada, no abierta como trabajo.** Los siguientes elementos del stack objetivo están declarados y **no materializados**; se registran aquí para trazabilidad y **no deben convertirse en implementación sin decisión explícita**: instrumentación de **coverage** (no existe `@vitest/coverage-*` ni umbrales; por eso RT-009-A reporta `NOT_EVALUATED`), **Playwright** (sin E2E), **k6** (sin pruebas de carga), **Testcontainers** (CI usa un *service container* de PostgreSQL, no Testcontainers), **OpenTelemetry** (solo `StructuredLogger`; sin métricas ni trazas), **Docker** (sin `Dockerfile` ni `compose`), **backend central NestJS + Fastify** y **PWA** (no existen como aplicaciones), **`packages/database-postgres` vacío** (solo manifiesto; `pg` vive únicamente en `tools/target-migrations`, es decir hay acceso a PostgreSQL para migraciones pero no en runtime), **`packages/domain` vacío**, **integraciones de hardware** (báscula, lector, impresora, cajón, datáfono) y **Object Storage S3**. Además, `vite` se mantiene en la línea 6.x (`6.4.3`) y no en 8.x, por compatibilidad de peers: es deuda consciente, no elección arquitectónica cerrada.
6. **Remediación de seguridad integrada en PR #24 (no era alcance original de RT-008).** El gate `ci:vulnerability-audit` bloqueaba con 10 advisories `high`. Causa raíz verificada con `pnpm audit --json` y rangos parcheados exactos: `electron@36.1.0` (7 advisories, requieren `>=39.8.10`), `extract-zip@2.0.1` transitiva de electron (`GHSA-jmr9-qjv8-65gv`, **sin versión parcheada disponible**) y `vite@6.3.5` (2 advisories, requieren `>=6.4.3`). Se verificó versión por versión que `electron@43.0.0` es la primera que sustituye `extract-zip` por `@electron-internal/extract-zip`; por eso `>=39.8.10` no bastaba y se adoptó `44.1.1` (última estable). `vite` se mantuvo en la línea 6.x (`6.4.3`) para preservar los peers de `@vitejs/plugin-react@4.5.0` y `vitest@4.1.10`. Al desbloquearse el audit, el `license gate` —que antes no llegaba a ejecutarse— reveló dos SPDX ids sin clasificar introducidos por el árbol de `vite`: se registraron explícitamente `MIT-0` (sin obligaciones; más permisiva que MIT) y `CC-BY-4.0` (atribución e indicación de cambios) en `tools/ci/license-compatibility-policy.json`. **`electron@36.1.0` provenía de RT-007 y dejó `main@5fd99ab` en rojo**; RT-008 no podía alcanzar verde sin remediarlo, porque el audit evalúa todo el workspace.
7. **Hallazgo de gobernanza abierto — `main@5fd99ab`.** El job `Main push governance` falló sobre ese SHA con `main introduced non-merge commit 5fd99ab. Direct pushes and squash/rebase merges are not accepted.`: el commit de reconciliación de backlog de RT-007 se empujó directo a `main` en lugar de integrarse vía PR. La brecha queda registrada en el historial y **no se corrige reescribiendo `main`**. Medida permanente: toda actualización de backlog se integra por PR y todo merge a `main` usa merge commit (nunca squash ni rebase).
8. La evidencia CI debe describir exactamente lo probado; una suite `PASS` no equivale a cierre de RT ni a promoción de `SEC-G01..SEC-G10`. `tools/target-migrations` **no es verificable localmente** (requiere PostgreSQL en `127.0.0.1:55432`); su evidencia proviene del job `TypeScript, SQLite and PostgreSQL 16.14`, `SUCCESS` sobre `efe7af0`.
9. Providers, producción, packaging/release y limpieza de ramas históricas siguen en líneas separadas.

## Gate SQL003

### INT-007 / materialización 003

Estado de materialización: `DONE / INTEGRATED / NOT_DEPLOYED_TO_PRODUCTION`.

PR #9 fue revisada, integrada y validada post-merge; PR #10 reconcilió el backlog y el run #67 validó el nuevo `main`. Los requisitos técnicos/documentales 1–5 del gate estaban cumplidos y la autorización explícita y separada del punto 6 fue otorgada el 2026-08-26. La ejecución queda limitada a INT-007 y no autoriza providers, runtime ni promoción de seguridad.

Decisiones cerradas y consolidadas en el bundle autoritativo integrado:

- Modelo A exclusivamente;
- `REPREPARE_BEFORE_SUBMISSION` solo pre-exposure;
- `FiscalDocumentPreparation` como representación durable por generation;
- dispatch anterior cancelado atómicamente;
- numeración histórica no reutilizable;
- retry con root estable y attempts append-only;
- `SUBMIT_DOCUMENT` como único operation type físico V1;
- query/retrieve diferidos y fail-closed;
- fence worker/webhook/reconciliation por documento/generation.

Condición para desbloquear una **tarea posterior de materialización**:

1. bundle V2 completo — `PASS`;
2. CI exact-head de PR #9 — `PASS`;
3. review independiente del HEAD exacto — `PASS`;
4. `AUTHORITATIVE_CONTRACT_REVIEW = PASS`;
5. integración documental + post-merge #64 — `PASS`;
6. autorización separada para iniciar diseño/materialización SQL003 — `PASS / GRANTED 2026-08-26`.

Autorizado exclusivamente dentro de INT-007:

- descriptor 003 y catálogo esperado;
- SQL PostgreSQL 003 up/down;
- runner/apply/down 003;
- schema fiscal y extensiones 003 de tablas `integrations`;
- introspection/smoke/tests necesarios para demostrar el target.

Continúa no autorizado:

- adapters provider y llamadas HTTP;
- credenciales/sandbox;
- promoción de security gates;
- runtime;
- query/retrieve físico V1;
- merge/cherry-pick completo del WIP histórico.

## Backlog por épica

### Arquitectura

| ID | Pri | Estado | Trabajo / evidencia |
|---|---|---|---|
| ARCH-001 | P0 | DONE | Monolito modular, monorepo, local-first y single codebase definidos. |
| ARCH-002 | P0 | DONE | Contexto, tenancy, deployment y ownership definidos. |
| ARCH-003 | P0 | DONE | PR #12 integrada; Nx + límites ejecutables 13/13 PASS y post-merge #170 SUCCESS. |
| ARCH-004 | P0 | DONE | Contratos renderer/Electron/local/API/hardware/providers definidos; extensión fiscal V2 de INT-006 integrada y revisada, sin runtime. |
| ARCH-005 | P0 | DONE | Stack objetivo cerrado en ADR-005. |

### Seguridad

| ID | Pri | Estado | Trabajo / evidencia |
|---|---|---|---|
| SEC-001 | P0 | DONE | Modelo de seguridad, roles y permisos documentados. |
| SEC-002 | P0 | DONE | Permisos atómicos, ABAC, SoD y pruebas negativas definidas. |
| SEC-003 | P0 | PLANNED | Implementar tenant isolation, sesiones, MFA y reautenticación. |
| SEC-004 | P0 | DONE | Secretos, claves, firma y soporte JIT definidos. |
| SEC-G01 | P0 | PLANNED | Tenant Isolation — NOT_EVALUATED. |
| SEC-G02 | P0 | PLANNED | Authentication & Session — NOT_EVALUATED. |
| SEC-G03 | P0 | PLANNED | Authorization RBAC/ABAC — NOT_EVALUATED. |
| SEC-G04 | P0 | PLANNED | Device Trust & License — NOT_EVALUATED. |
| SEC-G05 | P0 | PLANNED | Local-first Integrity/Replay — NOT_EVALUATED. |
| SEC-G06 | P0 | PLANNED | Audit & Anti-Fraud — NOT_EVALUATED. |
| SEC-G07 | P0 | PLANNED | Secrets & Cryptography — NOT_EVALUATED. |
| SEC-G08 | P0 | PLANNED | API/Webhook/Input Security — NOT_EVALUATED. |
| SEC-G09 | P0 | PLANNED | Infra/Supply Chain/Backup — NOT_EVALUATED. |
| SEC-G10 | P0 | PLANNED | Security Release Gate — NOT_EVALUATED. |

### Catálogo

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| CAT-001 | P0 | DONE | Producto, identificadores, variantes, presentaciones y conversiones definidos. |
| CAT-002 | P1 | READY | Persistencia física alineada con DEC-004/TECH-002; preparar implementación futura. |
| CAT-003 | P1 | PLANNED | Implementar Catalog multiempresa. |
| CAT-004 | P3 | DEFERRED | Especialización droguería. |

### Precios / promociones / impuestos

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| PRICE-001 | P0 | DONE | Programación/resolución de precios definida. |
| PRICE-002 | P0 | DONE | `PRICING_PIPELINE_V1` y orden definitivo cerrados. |
| PRICE-003 | P1 | PLANNED | Implementar versiones/vigencias/snapshots offline. |
| PROMO-001 | P0 | DONE | Creación/aplicación de promociones definida. |
| PROMO-002 | P1 | PLANNED | Persistencia de reglas/contadores idempotentes. |
| PROMO-003 | P1 | PLANNED | Motor determinista de promociones. |
| TAX-001 | P0 | DONE | Resolución/cambios tributarios definidos. |
| TAX-002 | P0 | DONE | Redondeo total pagadero definido. |
| TAX-003 | P0 | DONE | Precisión/residuos/conciliación y rounding final cerrados. |
| TAX-004 | P1 | PLANNED | Implementar Electronic Invoicing tras INT-006/TECH-003/gates. |
| UC-EINV-001 | P1 | DONE | Contrato funcional base documentado; overlay V2 autoritativo integrado por INT-006, sin runtime. |

### Integraciones externas

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| INT-001 | P0 | DONE | Contrato provider-neutral y ownership cerrados. |
| INT-002 | P0 | DONE | Manifest migration 002 cerrado. |
| INT-003 | P0 | DONE | Migration 002 materializada/tested/immutable. |
| INT-004 | P1 | PLANNED | Adapters SIIGO/FACTUS/ALEGRA reales; no mocks como evidencia. |
| INT-005 | P2 | PLANNED | Evaluar HKA/Odoo sin adapters ficticios. |
| INT-006 | P0 | DONE | Remediación contractual autoritativa V2 integrada/revisada por PR #9; contrato cerrado. |
| INT-007 | P0 | DONE | Gate A PASS/FROZEN; Gate B PASS/CLOSED; PR #11 MERGED/CLOSED; post-merge #159 SUCCESS sobre `main@8676caef419d70732f74489a413ae7fda2c49d0c`. |

### Pagos

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| PAY-000 | P0 | DONE | Lifecycle conceptual de pagos. |
| UC-PAY-001 | P0 | DONE | Pago individual. |
| UC-PAY-002 | P0 | DONE | Pago mixto/fallo parcial. |
| UC-PAY-003 | P0 | DONE | Transferencia manual/QR. |
| UC-PAY-004 | P0 | DONE | Refund/reversal. |
| UC-PAY-005 | P0 | DONE | Settlement/reconciliation. |
| PAY-007 | P0 | DONE | Máquinas de estado separadas y autoridad cerrada. |
| PAY-008 | P1 | PLANNED | Persistencia física de pagos. |
| PAY-009 | P1 | PLANNED | Implementación/concurrencia/idempotencia/permisos/recovery. |

### Caja

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| CASH-001 | P0 | DONE | Apertura definida. |
| CASH-002 | P0 | DONE | Cierre/diferencia definidos. |
| CASH-003 | P0 | DONE | Movimientos, retiros, arqueos y compensaciones definidos. |
| CASH-004 | P1 | PLANNED | Implementar caja por terminal/turno. |

### Ventas

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| SALES-001 | P0 | DONE | Confirmación atómica/idempotente definida. |
| SALES-002 | P0 | DONE | Suspensión/recuperación/cancelación/devolución/reimpresión. |
| SALES-003 | P1 | PLANNED | Implementar pipeline comercial/snapshots. |

### Compras / proveedores

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| PUR-001 | P1 | PLANNED | Definir PurchaseOrder/SupplierReturn sin contaminar GoodsReceipt. |
| PUR-002 | P1 | PLANNED | Implementar capacidades de compra/proveedor separadas de Payment de cobros. |

### Inventario

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| INV-001 | P0 | DONE | GoodsReceipt definido. |
| INV-002 | P0 | DONE | Movimientos/reservas/ajustes/lotes/traslados/concurrencia definidos. |
| INV-003 | P1 | PLANNED | Implementar movimientos como fuente y saldos como proyección. |

### Clientes / crédito

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| CUST-001 | P1 | PLANNED | Alta/edición/búsqueda/privacidad. |
| CUST-002 | P1 | PLANNED | Cuenta/cupo/mora/abonos; depende de DEC-005. |
| CUST-003 | P2 | PLANNED | Implementación auditable. |

### Domicilios

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| DEL-001 | P3 | DEFERRED | Pedido/preparación/asignación/recaudo/PIN/incidencias. |
| DEL-002 | P3 | DEFERRED | App domiciliario/GPS limitado. |
| DEL-003 | P3 | OUT_OF_SCOPE | No forma parte del primer núcleo Fase 1. |

### Onboarding

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| ONB-001 | P0 | DONE | Inicialización tenant/company/branch/owner definida. |
| ONB-002 | P0 | PLANNED | Bootstrap transaccional/idempotente/auditable. |
| ONB-003 | P2 | PLANNED | Importación masiva/migración asistida. |

### Licencias / dispositivos

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| LIC-001 | P0 | DONE | Validación HYBRID/LOCAL_PERPETUAL. |
| LIC-002 | P0 | DONE | Lifecycle contractual-operativo cerrado. |
| LIC-003 | P1 | PLANNED | Implementar entitlements/límites/dispositivos. |
| DEV-001 | P0 | DONE | Lifecycle dispositivo. |
| DEV-002 | P0 | DONE | Identidad segura + licencia. |
| DEV-003 | P1 | PLANNED | Simuladores/adapters hardware; certificación requiere equipos reales. |

### Sincronización

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| SYNC-001 | P0 | DONE | Operation/outbox/inbox/idempotencia/checkpoint definidos. |
| SYNC-002 | P0 | DONE | Configuración offline versionada por dominio. |
| SYNC-003 | P0 | DONE | Conflictos/retry/recovery/dead letter/clock definidos. |
| SYNC-004 | P1 | PLANNED | Venta offline real sin duplicación/pérdida. |

### Reporting

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| REP-001 | P1 | PLANNED | Reportes por rol. |
| REP-002 | P2 | PLANNED | Proyecciones/procesamiento async sin source-of-truth paralelo. |
| REP-003 | P2 | PLANNED | Exportación/privacidad/métricas. |

### UX

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| UX-001 | P1 | DONE | Navegación inicial/decisiones UX. |
| UX-002 | P1 | PLANNED | Flujos POS venta/pago/offline/hardware. |
| UX-003 | P1 | PLANNED | Design system accesible/resoluciones/touch. |
| UX-004 | P2 | PLANNED | Usabilidad por rol/tipo de comercio. |

### Diseño técnico

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| TECH-001 | P0 | DONE | Modelo conceptual y ownership. |
| TECH-002 | P0 | DONE | Modelo físico base + migrations 001/002/materialización revisada. |
| TECH-003 | P0 | DONE | PR #14 integrada; 57/57 contratos + 5/5 compatibilidad cruzada, CI exact-head #187 y post-merge #188 SUCCESS. |
| TECH-004 | P0 | DONE | PR #15 integrada; SAST, vulnerabilidades, SBOM, licencias SPDX y provenance cerrados con evidencia exact-head y post-merge. |
| TECH-005 | P1 | PLANNED | Observabilidad/backups/restore/update/rollback. |
| TECH-006 | P1 | PLANNED | Fixtures multi-tenant/concurrencia/recovery. |

## Decisiones

### Cerradas P0

- DEC-001: taxonomía de estados de pagos.
- DEC-002: compensación de pagos.
- DEC-003: pricing pipeline.
- DEC-004: Product/Variant/Presentation.
- DEC-006: rounding policy.
- DEC-007: autoridad local-first.
- DEC-008: device trust/license activation.
- DEC-009: baseline operacional productivo.
- DEC-010: runtime POS.

### Pendiente

| ID | Pri | Estado | Bloquea |
|---|---|---|---|
| DEC-005 | P1 | DEFERRED | Crédito offline: CUST-002/PAY-009. |

## Hitos

| Hito | Estado | Criterio vigente |
|---|---|---|
| Fase 0 | DONE | Fundación documental/decisiones P0 cerradas. |
| F1.1 Esqueleto modular y contratos | IN_PROGRESS | ARCH-003 y TECH-003 DONE; esqueleto runtime aún pendiente y no se mezcla con el primer slice estático de TECH-004. |
| F1.2 Modelo físico/migrations | DONE | TECH-002 e INT-006 cerrados; migrations 001/002 inmutables; SQL003 integrado por PR #11 con Gate A/B PASS y post-merge #159 SUCCESS. Despliegue productivo no iniciado. |
| F1.3 Seguridad/identidad | PLANNED | SEC gates con evidencia runtime real. |
| F1.4 CI/calidad | IN_PROGRESS | baseline vigente PASS; pipeline integral depende de runtime/apps y permanece incompleto. |
| F1.5 Primer corte vertical | PLANNED | Onboarding mínimo autenticado/auditado/idempotente. |
| F1.6 Base local-first | PLANNED | Operation/outbox/sync real sin duplicación. |

## Riesgos abiertos

| ID | Sev | Riesgo | Cierre |
|---|---|---|---|
| R-001 | Alta | Confundir docs/tooling con runtime. | Claims por nivel + evidencia ejecutable. |
| R-003 | Alta | Pagos externos sin atomicidad distribuida. | Idempotencia/UNKNOWN_OUTCOME/compensación/reconciliation. |
| R-004 | Alta | Tenant isolation no probado en runtime. | SEC-003 + SEC-G01 real. |
| R-005 | Alta | Local-first aún no implementado extremo a extremo. | SYNC-004 y suites SQLite/PostgreSQL. |
| R-006 | Alta | Sobre-modelado físico de dominios pendientes. | Manifests/reviews aditivos; no DDL especulativo. |
| R-007 | Media | Pricing documentado, runtime pendiente. | Implementación determinista + tests. |
| R-008 | Media | RPO/RTO/volumen sin benchmark. | TECH-005 + medición. |
| R-009 | Media | Hardware sin validación real. | DEV-003 + LAB_VALIDATED/CERTIFIED. |
| R-010 | Alta | Una materialización SQL003 futura puede derivar del bundle autoritativo o perder historia contractual/numeración. | Bundle V2 integrado + índice de precedencia + CI/review exact-head obligatorios para cualquier tarea SQL003. |
| R-011 | Alta | Runtime objetivo ausente. | ARCH-003/TECH-003 -> esqueleto -> gates. |
| R-012 | Media | Firma/keys/support definidos pero no implementados. | SEC-004 materializado + pruebas. |
| R-013 | Alta | `main` sin branch protection preventiva por limitación de plan. | Control detectivo vigente; habilitar protección cuando plan lo permita. |
| R-014 | Media | Drift documental puede reabrir pasos ya cerrados. | Fuente vigente compacta + reconciliación obligatoria en el mismo PR. |

## Trazabilidad histórica

La historia detallada anterior a esta reconciliación no se elimina: permanece en el historial Git de `docs/product/backlog.md`, commits, PRs y workflows.

Los hitos que sustentan el baseline actual incluyen, entre otros:

- migration 001 materializada desde el corte autorizado de TECH-002;
- migration 002 External Integrations materializada y mantenida inmutable;
- MAT-003 preflight/readiness revisados;
- cleanup legacy integrado por PR #3;
- fundación TARGET integrada por PR #2;
- supply-chain/governance integrada por PR #5;
- reconciliación canónica por PR #6;
- identidad comercial por PR #7;
- hardening de gobernanza por PR #8;
- propuesta SQL003 V7 integrada por PR #4;
- run post-merge #54 PASS sobre `bdc0f96323069de821e975737f19961fd16c3ccf`;
- remediación contractual autoritativa V2 integrada por PR #9 con `AUTHORITATIVE_CONTRACT_REVIEW = PASS`;
- run post-merge #64 PASS sobre `be986884cd21aae11f84e64a56158705197325d0`.

El registro histórico sirve como evidencia, no como cola de trabajo vigente.

## Regla de cierre

Una tarea no está cerrada hasta que:

1. el artefacto existe;
2. cumple alcance y criterios;
3. las validaciones reales aplicables pasan;
4. el diff fue revisado;
5. el backlog refleja el estado nuevo;
6. branch/PR/merge quedan reconciliados conforme a governance;
7. no queda una rama activa sin objetivo o condición de bloqueo;
8. no se deja una fuente normativa contando un estado incompatible;
9. ninguna remediación reduce o elimina silenciosamente detalle contractual previamente aprobado.

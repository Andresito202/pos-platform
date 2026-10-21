# Continuidad de autenticación — 2026-10-20

Continúa la [auditoría Windows anterior](local-integrated-audit-2026-10-20.md), sin repetir sus suites comerciales. Misma rama de PR #92; no merge a main.

## Consolidación del corte anterior

- Commit publicado: `0a1510091ab845f616af144e797f576f8b1f8825`, `fix(pos): align transfer states and restore real Windows E2E`.
- Los ocho archivos del inventario SHA-256 anterior coincidieron **8/8** antes de consolidar. Se conservan la corrección CREATED de DEC-016, arnés Windows, typecheck del host y documentación; no se reimplementaron pagos.
- Las evidencias anteriores permanecen asociadas al árbol descrito en el informe original. No se presentan como una ejecución nueva ni como CI del commit publicado.
- Logs, imágenes, scripts de inventario y bases temporales permanecen fuera de Git en `artifacts/` y rutas temporales. No había cambios incompletos de producto mezclados con el corte.

## Incremento materializado

Se conecta el primer paso de UC-AUTH-001: **correo/contraseña → credencial PASSWORD persistida → verificador Argon2id existente**.

| Archivo | Cambio acotado |
|---|---|
| `packages/database-postgres/src/password-credential-verification-repository.ts` | Consulta parametrizada a users/user_credentials canónicas, exige usuario/credencial activos, no revocados ni bloqueados; mantiene locks SHARE durante el callback criptográfico. Commit/rollback y devolución de conexión. No modifica datos de identidad |
| `packages/database-postgres/src/index.ts` | Exporta el adapter de Identity existente; no módulo ni tabla nuevos |
| `apps/central-authority/src/platform-password-verifier.ts` | `verifyStoredPlatformPassword` reutiliza la normalización de onboarding y `verifyPlatformPasswordVerifier`. Requiere verifier de rechazo aportado por configuración de confianza; sin perfil implícito. Ausencia de cuenta o PHC inválido realizan verificación de rechazo y devuelven null |
| `apps/central-authority/tests/stored-password-verification-physical.test.ts` | Nueva suite física, DB aleatoria exclusiva en localhost:55433, SQL bootstrap+001 existente, rol pos_platform_app sin superuser/BYPASSRLS y Argon2id nativo |

El resultado interno contiene solo userId, credentialId y credentialVersion; **no** contiene PHC, contraseña, permisos ni token. credentialVersion no es secuencia SSA. Una coincidencia no prueba MFA ni pertenencia y no puede sustituir una sesión autenticada.

No se expone HTTP ni se conecta el resultado a session.activate o al emisor SSA. Los contadores/lockout, eventos de login y emisión de sesión pertenecen al servicio de autenticación completo aún pendiente; esta consulta no los simula. El verificador dummy y el perfil usados por el test son sintéticos, no una selección de política productiva. Las bibliotecas siguen bajo su clasificación actual hasta habilitar runtime conforme a D3.

## Evidencia nueva

Windows real, Node 22.19.0, pnpm 9.15.0, PostgreSQL 16.14 en el fixture local existente. Base de código del incremento: `0a151009` más los archivos arriba. Logs separados en `artifacts/continuity/2026-10-20/`; los hashes del código se conservan con esa evidencia.

| Validación | Resultado |
|---|---|
| `pnpm --filter @pos-platform/database-postgres typecheck` | Exit 0 |
| `pnpm --filter @pos-platform/central-authority typecheck` | Exit 0 |
| `POSTGRES_TEST_URL=...localhost:55433`; `pnpm --filter @pos-platform/central-authority test -- tests/stored-password-verification-physical.test.ts` | **12/12 PASS**, exit 0, 0 omitidas; PostgreSQL y Argon2id reales |
| `node tools/architecture/validate-boundaries.mjs` | Exit 0; acceso PostgreSQL a través del paquete canónico |

Casos nuevos: credencial correcta y normalización; incorrecta; cuenta inexistente aunque coincida el dummy; cuenta inactiva; credencial revocada; preservación del CHECK de revocación; bloqueo persistido; cambio de verifier/version y rechazo de contraseña anterior; PHC no soportado; rechazo de configuración dummy inválida; rollback/liberación ante error de crypto; lock concurrente y rechazo tras revocación. El caso positivo verifica que **no se crearon sesiones ni eventos de login ficticios**.

Primera ejecución: **10 PASS / 2 FAIL**, exit 1. Fallaron supuestos del test: user_credentials global no usa FORCE RLS, sino ACL central exclusiva; el CHECK existente ya impide ACTIVE con revoked_at. Se corrigieron solo las expectativas y se repitió exclusivamente esta suite. No se tocó DDL/RLS/ACL para conseguir verde. La ejecución física final no valida MFA, dispositivo, SSA ni autorización de rol.

El scanner detectó inicialmente un import **solo de tipo** `pg` en el test central. Se retiró ese import y se deriva el tipo del factory canónico `createPostgresPool`; scanner y typecheck central volvieron a cerrar con exit 0. No cambió el comportamiento ejecutable del test y no se repitió la suite física por ese cambio de tipos.

La DB temporal fue eliminada por DROP DATABASE estricto tras cerrar pools; no se aplicaron migraciones a bases existentes ni se alteraron roles del clúster.

## Conexiones pendientes y bloqueo exacto

| Eslabón | Estado al cierre de este incremento |
|---|---|
| PASSWORD contra almacenamiento canónico | Nuevo enlace físicamente probado; sin endpoint de login |
| MFA inicial de persona | Falta coordinar AUTHENTICATE con creación de sesión comercial. El wrapper y la transacción WebAuthn existentes atienden REAUTHENTICATE/RECOVERY_APPROVAL y exigen sesión **GLOBAL** previa. El enrolamiento también presupone sesión autenticada. No se sustituye por MFA SATISFIED aportado por cliente |
| Sesión central comercial / prueba de acceso y refresh | Falta autoridad que emita/valide una prueba de posesión del usuario y gestione expiración/rotación/revocación con las políticas pendientes. Un UUID de identity.sessions no sirve como esa prueba |
| Dispositivo → reserva 011 → firma SSA | Verificador 012, allocator y emisor existentes; no pueden recibir la coincidencia de contraseña como sustituto de la sesión/MFA. Requieren el resolvedor auténtico anterior y revalidación de la emisión |
| Entrega segura / activación / permisos / React | Canal, verificador, activación/recuperación y RBAC ya existen y mantienen su evidencia anterior. No hay login central completo que produzca los artefactos reales para conectarlos |
| Roles de negocio y plataforma | Ningún rol humano autenticado en esta continuación. No se creó acceso universal ni se confundió un usuario global con autoridad PLATFORM |

Se comprobó por SELECT de catálogos `pos_target_test` y `postgres`: no existe `platform.target_migration_executions`, `identity.sessions`, `identity.session_assertion_sequences` ni `identity.device_request_proof_replays` en esas bases persistentes. Por tanto **011/012 no están aplicadas allí** y no hay un ledger persistente que permita presentarlas como aplicadas. Su ejecución histórica en fixtures temporales no cambia ese hecho. No se reaplicaron ni se creó una instalación ficticia.

Las decisiones pendientes siguen en [D3](../governance/central-authority-administration-d3-gate-2026-10-08.md): perfil KDF de producción, RP/origin reales, ventanas de reautenticación, expiración/refresh y límites de abuso. El formato/procedencia de la prueba de sesión comercial y su vínculo al AUTHENTICATE inicial deben quedar definidos antes de abrir el transporte. No se introdujo otra tabla de sesiones, tokens inventados ni una implementación de login paralela.

**Login humano: no conseguido.** Lo nuevo es verificación de la contraseña persistida en una DB controlada, no autenticación humana E2E. Próximo paso mínimo al cierre de este snapshot: materializar el AUTHENTICATE inicial y la autoridad de sesión comercial sobre las tablas existentes, con política y prueba de acceso explícitas; después podrá conectarse con el resolvedor SSA.

**Actualización posterior:** el [incremento MFA inicial](business-initial-mfa-2026-10-20.md) cierra la coordinación interna AUTHENTICATE con 23/23 pruebas físicas nuevas. Sustituye el bloqueo de coordinación descrito arriba; siguen pendientes la autoridad/prueba de sesión comercial y las decisiones D3 enumeradas en ese informe. No habilita login humano ni sesión POS.

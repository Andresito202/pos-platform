# D-3 — Platform Account: identidad, autenticación, recuperación y sesión

Fecha: 2026-10-08  
Rama: `claude/pos-camacho-bloque-4c-ld43py`  
Estado: `CONTRACT_MATERIALIZED_IMPLEMENTATION_PENDING`

## Objetivo

Cerrar el contrato canónico que permita materializar de forma segura `PlatformAccount` como actor administrativo de la autoridad central.

Este gate no crea tablas, credenciales, endpoints ni tokens. Su propósito es impedir que D-3 introduzca una segunda identidad paralela o una autenticación inventada.

## Evidencia existente y reutilizable

### 1. PlatformAccount ya existe como entidad conceptual

`docs/architecture/conceptual-data-model.md` define `PlatformAccount` como usuario interno del proveedor con:

- `id`;
- `email`;
- `phone`;
- `status`;
- `security_level`;
- `last_login_at`.

El mismo modelo conceptual ya establece que las credenciales y los factores MFA tienen ciclo de vida propio y que una credencial válida no concede por sí misma pertenencia, rol ni contexto de tenant.

**No se crea otra entidad conceptual ni otro modelo de credenciales.**

El documento, sin embargo, no fija para PlatformAccount los valores canónicos de `status`/`security_level`, su relación con la identidad existente ni el protocolo de autenticación administrativa.

### 2. Ya existe UC-AUTH-001 para autenticación de usuarios

`docs/use-cases/auth/UC-AUTH-001-login.md` ya define el flujo existente de login:

1. recepción de credenciales;
2. validación de formato;
3. búsqueda sin revelar existencia;
4. verificación de credencial;
5. comprobación de estado/contexto;
6. evaluación MFA/riesgo;
7. validación del segundo factor;
8. creación de sesión;
9. emisión de acceso/renovación;
10. auditoría;
11. entrega del contexto autorizado.

También define comportamiento para credenciales inválidas, cuenta inactiva, MFA, rate limiting, refresh rotativo, revocación y auditoría.

**Esto evita inventar un segundo mecanismo genérico de login.**

El problema pendiente es que UC-AUTH-001 identifica al actor principal como **Usuario registrado** y no define la variante administrativa de `PlatformAccount`.

### 3. Ya existe el modelo conceptual MfaFactor

`docs/architecture/conceptual-data-model.md` contiene `MfaFactor`, con `user_id`, `factor_type` y referencia de secreto.

Por tanto, **no se crea un nuevo agregado MFA paralelo**.

La falta concreta es determinar si el mismo ciclo de vida se extiende formalmente a PlatformAccount y bajo qué política de administración, recuperación y reautenticación.

### 4. Ya existe la autoridad física de sesión

La migración central y su manifiesto definen:

- `identity.users`;
- `identity.sessions`;
- `identity.session_refresh_tokens`;
- `identity.security_events`.

`identity.sessions` ya contempla MFA, reautenticación, expiración y revocación. `session_refresh_tokens` ya contempla rotación, consumo, replay/reuse y revocación.

Esto es reutilizable.

**No se crea una segunda tabla genérica de sesiones ni otro sistema de refresh tokens.**

### 5. Ya existe el contrato de actor PLATFORM_ACCOUNT

`packages/contracts/src/authorization.ts` y el modelo de dominio reconocen:

`USER | PLATFORM_ACCOUNT | SYSTEM | DEVICE`.

También existe la regla de autorización que actualmente deniega un `PLATFORM_ACCOUNT` cuando no existe la autoridad/permiso correspondiente.

Esto es coherente con D-1: D-1 define qué operaciones centrales existen, pero no inventa cómo se autentica el actor.

### 6. Ya existe auditoría de seguridad

El modelo de migración define `identity.security_events` para señales de login, MFA y replay. El manifiesto distingue esas señales de `audit.audit_events`, evitando duplicar login/MFA como eventos de negocio.

**No se crea otro ledger de autenticación.**

## Hallazgo definitivo de D-3

Después de revisar los artefactos existentes, el bloqueo ya no es “no existe autenticación” en términos generales.

La arquitectura **sí tiene piezas de autenticación de usuario reutilizables**.

El bloqueo preciso es:

> No existe todavía una decisión contractual que determine cómo `PlatformAccount` entra en esas piezas existentes.

Faltan únicamente las decisiones de frontera que no deben inferirse:

1. si `PlatformAccount` es una identidad separada o una identidad existente con representación administrativa;
2. qué sesión representa a un `PLATFORM_ACCOUNT`;
3. qué claims/contexto son válidos sin `tenant_membership_id`;
4. qué MFA se exige siempre y qué reautenticación exige D-1;
5. cómo se recupera una cuenta de plataforma;
6. qué eventos de `security_events` y qué `audit_events` corresponden;
7. cómo una sesión autenticada se convierte en actor `PLATFORM_ACCOUNT` para autorización;
8. qué endpoint/servicio de autoridad central emite esa sesión.

## Decisión del gate

D-3 **todavía no puede materializar persistencia ni autenticación administrativa** sin resolver esas fronteras.

No se crea:

- `platform_accounts`;
- otra tabla de credenciales;
- otra tabla MFA;
- otra tabla de sesiones;
- otro refresh token;
- contraseñas/hashes inventados;
- JWT/bearer tokens inventados;
- endpoint administrativo inventado;
- UI Superadmin que simule una sesión válida.

La implementación debe extender/reutilizar los artefactos existentes una vez cerrada la decisión.

## Contrato mínimo pendiente

### Identidad

- identidad canónica de PlatformAccount;
- relación con `identity.users`, si existe;
- identificador;
- email/normalización;
- estado y transiciones;
- `security_level`.

### Autenticación

- método primario usando el mecanismo ya previsto por UC-AUTH-001;
- almacenamiento y tratamiento de credenciales;
- rate limiting/lockout;
- auditoría de intentos;
- revocación.

### MFA

- reutilización formal de `MfaFactor`;
- factores admitidos;
- satisfacción obligatoria para administración;
- reautenticación;
- recuperación ante pérdida del factor.

### Sesión

- reutilización/extensión de `identity.sessions`;
- ausencia/presencia de contexto tenant;
- claims;
- expiración;
- refresh;
- revocación;
- traducción a `PLATFORM_ACCOUNT`.

### Recuperación

- prueba reforzada;
- token de un solo uso;
- consumo atómico;
- expiración;
- revocación de sesiones;
- auditoría.

### Autoridad administrativa

- operaciones D-1 autorizadas;
- MFA/reautenticación por operación;
- actor auditado;
- servicio emisor;
- transporte administrativo.

## Decisión materializada — frontera PlatformAccount

La auditoría de la migración central demuestra que no hace falta una segunda identidad para cerrar la frontera D-3:

- PlatformAccount.id se representa por el mismo identificador de identity.users.id.
- identity.user_credentials sigue siendo la única fuente de credencial PASSWORD.
- identity.mfa_factors sigue siendo la única fuente de MFA.
- identity.sessions sigue siendo la única fuente de sesión; una sesión administrativa no tiene tenant_id ni tenant_membership_id.
- identity.session_refresh_tokens sigue siendo la única fuente de refresh.
- identity.security_events sigue siendo la fuente append-only de señales de seguridad.
- No se crea membership de tenant para conferir autoridad de plataforma.
- La sesión administrativa exige mfa_status = SATISFIED y reautenticación vigente.
- La sesión no transporta roles, permisos ni entitlements; D-1 continúa siendo la autoridad de operaciones administrativas.
- El cliente local no puede invocar directamente operaciones administrativas centrales.

Este contrato quedó materializado en packages/contracts/src/central-administration.ts y bloqueado por pruebas en packages/contracts/tests/platform-administration-session.test.ts.

## Qué queda realmente pendiente después de D-3

El contrato ya no está bloqueado por una decisión de identidad. Lo pendiente es implementación, en este orden:

1. implementar el servicio central que autentica/reautentica contra identity.users + identity.user_credentials y satisface MFA mediante identity.mfa_factors;
2. persistir/revocar la sesión administrativa usando identity.sessions y rotación existente de refresh;
3. emitir y verificar el contexto PlatformAdministrationSession;
4. registrar login, MFA, reautenticación, revocación y replay en identity.security_events;
5. conectar el contexto autenticado con las operaciones D-1 sin convertirlo en permisos tenant;
6. exponer el transporte administrativo central;
7. probar end-to-end;
8. solamente después materializar la pantalla Superadministrador.

No se permite crear otra identidad, otra sesión, otro MFA, otro refresh token ni una UI que simule autenticación.

## Revalidación de implementación — 2026-10-08

La autorización de ejecución fue aplicada hasta el límite que permiten los contratos normativos existentes. La auditoría de implementación encontró dos dependencias concretas que no pueden inferirse ni inventarse:

1. Verificador de credencial: identity.user_credentials.verifier está definido como un hash con algoritmo/parámetros/salt, pero el contrato del repositorio no fija una serialización canónica consumible por runtime. DEC-012 documenta scrypt con parámetros provisionales, pero declara expresamente que requieren benchmark sobre hardware real y que no constituyen una implementación definitiva.
2. MFA administrativo: identity.mfa_factors.factor_type exige un método aprobado por implementación, pero la documentación física declara que no se selecciona ningún método hasta contar con implementación y pruebas de seguridad. No existe un contrato ejecutable para TOTP, PIN, WebAuthn u otro factor que pueda reutilizarse sin inventar un protocolo.

Existe además una restricción normativa explícita: DEC-012 conserva login, MFA, rotación de refresh, bloqueo y recuperación como alcance central no evaluado/no autorizado. Por tanto, la autorización del usuario para ejecutar D-3 no permite sobreescribir una decisión arquitectónica previa ni fabricar una autenticación funcional.

### Decisión operativa

No se materializa todavía:

- un verificador de contraseña con formato inventado;
- un algoritmo MFA no aprobado;
- un endpoint de login administrativo;
- emisión de sesiones o refresh utilizables sin MFA verificable;
- recuperación de cuenta;
- UI Superadmin que aparente autenticación real.

Esto no es trabajo pendiente por negligencia ni una implementación parcial: es un bloqueo de seguridad reproducible. Es preferible mantener el sistema sin autenticación administrativa que introducir una credencial o segundo factor no especificado y convertirlo en una autoridad falsa.

### Evidencia de lo que sí está cerrado

La frontera D-3 ya está materializada en packages/contracts/src/central-administration.ts y cubierta por packages/contracts/tests/platform-administration-session.test.ts. Esa parte fija identidad, ausencia de tenant membership, MFA satisfecho, reautenticación, sesión central y ausencia de permisos/entitlements transportados.

### Condiciones exactas para desbloquear implementación

Antes de escribir el runtime de autenticación deben quedar cerrados, en el mismo contrato/gate y sin crear otro sistema:

1. serialización/versionado del UserCredential.verifier y parámetros aprobados;
2. benchmark o autorización explícita del KDF que corresponda;
3. método MFA administrativo y representación/verificación de su secret_reference;
4. política de reautenticación y ventana aplicable;
5. recuperación de PlatformAccount;
6. catálogo de security_events para login/MFA/reauth/replay/revocación;
7. política de expiración y rotación de refresh para esta sesión administrativa.

Una vez cerrados esos siete puntos, la implementación puede continuar sobre identity.users, identity.user_credentials, identity.mfa_factors, identity.sessions, identity.session_refresh_tokens e identity.security_events, sin crear tablas paralelas.

**Estado actualizado:** BLOCKED_BY_UNAUTHORIZED_AUTHENTICATION_DETAILS.


## Criterio de salida

D-3 queda cerrado únicamente cuando esas decisiones estén expresadas en un contrato único y testeable.

Hasta entonces, el estado correcto es **bloqueado por contrato**, no “pendiente de código”.

## Orden posterior, sin duplicar trabajo

1. cerrar contrato de frontera sobre los artefactos existentes;
2. añadir pruebas estructurales/negativas a los contratos existentes;
3. extender `identity` solo donde el contrato demuestre que falta persistencia;
4. implementar servicio de autenticación/sesión reutilizando UC-AUTH-001;
5. integrar `PLATFORM_ACCOUNT` con D-1;
6. transporte administrativo;
7. pruebas reales;
8. Superadmin UI.

No se salta a Licensing, Plan ni frontend mientras esta frontera siga abierta.


## Ejecución secuencial autorizada — 2026-10-08

La inspección de DEC-012 confirma que su PIN de seis dígitos y scrypt pertenecen a presencia local de caja, no a autenticación central de PlatformAccount. No se trasladan a identidad central. El servicio central sí contiene runtime y pruebas de enrolamiento de dispositivos, publicación de confianza de sesión y eventos Wompi. Sin embargo, no se encontró un flujo de autenticación administrativa PlatformAccount conectado a D-1; no se declara ese flujo, sus pruebas, CI ni su interfaz como completados. Para continuar sin crear una segunda arquitectura, primero se debe ratificar el contrato central de credenciales, MFA, recuperación y sesiones; después se implementarán y probarán el servicio, el transporte y la interfaz sobre las tablas identity existentes.


## Revisión de integración de pantallas — 2026-10-08

### Alcance y evidencia

Inspección estática de la rama `claude/pos-camacho-bloque-4c-ld43py`, en `apps/pos-desktop/renderer/src/App.tsx`, `components/AdministrativeControlPanel.tsx`, hooks de autorización/métricas/auditoría, `apps/pos-desktop/tests/renderer/App.test.tsx`, `AdminPanels.test.tsx`, `packages/contracts/src/ipc-commercial.ts` y `packages/contracts/src/central-administration.ts`. Esta revisión no equivale a ejecutar Vitest, TypeScript, Electron ni CI.

### Matriz real de integración

| Superficie | Integración comprobada en código | Estado |
|---|---|---|
| Navegación comercial | `authorization.capabilities.get` carga permisos efectivos; la aplicación falla cerrada cuando la lectura falla y solo agrega pantallas comerciales con permisos requeridos. | Implementada en código; pruebas de renderer presentes, ejecución no verificada en esta revisión. |
| Caja/ventas, catálogo, inventario, clientes, comprobantes y facturación | Componentes existentes consumen el canal de servicio local; las pruebas de renderer validan sobres y desenlaces contra esquemas reales de contratos. Facturación diferencia emisión, bloqueo, fallo de transporte y resultado incierto. | Integración local presente; no se infiere disponibilidad de proveedor fiscal real a partir de pruebas con dobles. |
| Dashboard administrativo | `useAdminMetrics` llama `admin.metrics.get`; los datos son entregados por el servicio, no calculados en el renderer. Las métricas sin permiso se muestran como no autorizadas. | Lectura local parcial y limitada por permisos existentes. |
| Auditoría administrativa actual | `useAdministrativeAudit` llama `audit.event.list`, con filtros, paginación y lectura sin mutación. | Integrada con la auditoría de la sesión/tenant; no equivale a auditoría de seguridad de identidad ni a la auditoría global de PlatformAccount. |
| Superadministrador | Las tarjetas de licencias, cuentas, planes y riesgo siguen en valores `—`; Seguimiento informa que no hay datos ejecutables; Seguridad es informativa. No se encontró hook/transporte de lectura o mutación D-1 en la pantalla. | No integrada con autoridad central. No debe mostrarse como consola funcional. |
| Usuarios, roles, empresa, sucursales, dispositivos, configuración, licencias, planes y soporte | `plannedScreens` los describe, pero sus acciones están deshabilitadas. La mayoría declara `requiredPermissions: []`; como la visibilidad usa `required.some(...)`, una lista vacía nunca habilita esa pantalla. | Superficie declarativa, no flujo ejecutable. No inventar permisos para hacerlas aparecer. |
| Seguridad de PlatformAccount | El contrato D-3 define el contexto de sesión, pero el gate conserva siete decisiones de implementación de autenticación sin ratificar. | Bloqueo de seguridad vigente. No conectar UI antes del servicio real. |

### Hallazgos de integración que deben conservarse

1. La UI no debe usar `AUDIT_EVENT_READ` como sustituto de autoridad de plataforma. El contrato central requiere actor `PLATFORM_ACCOUNT`, MFA satisfecho, reautenticación vigente y autorización central independiente de permisos tenant.
2. `identity.security_events` y `audit.audit_events` tienen propósitos diferentes. La vista existente `audit.event.list` no debe rotularse ni reutilizarse como registro global de login/MFA/replay de PlatformAccount.
3. La presencia de archivos en `apps/central-authority` no demuestra que exista el flujo de login administrativo. El runtime actual contiene enrolamiento de dispositivos, publicación de confianza de sesión y procesamiento de eventos Wompi; no se halló un servicio de autenticación PlatformAccount conectado a operaciones D-1.
4. La pantalla Seguridad actual es una lista informativa, no una interfaz para gestionar MFA, sesiones, credenciales o políticas. No debe describirse como gestión de seguridad materializada.
5. Las pruebas de `AdminPanels.test.tsx` usan respuestas controladas para verificar la conducta del renderer. Son pruebas unitarias de integración de pantalla/canal, no evidencia de conectividad central real ni de despliegue.

### Orden de implementación sin saltos

1. Resolver y ratificar los siete puntos de autenticación de este gate.
2. Implementar autenticación, MFA, sesión, refresh y eventos de seguridad reutilizando las tablas `identity.*` existentes.
3. Implementar el transporte central autenticado y los casos de uso D-1; probar denegación por actor incorrecto, MFA ausente, reautenticación vencida, expiración, revocación y replay.
4. Añadir contratos de lectura/mutación de plataforma que correspondan a operaciones D-1, con autorización y auditoría del lado servidor.
5. Conectar primero la pantalla Superadministrador a lecturas reales y estados de error/denegación; no usar datos ficticios ni habilitar botones antes de que existan los casos de uso.
6. Conectar cada acción de licencias/cuentas a su operación central específica, con confirmación, idempotencia donde aplique y resultado visible.
7. Extender auditoría con una vista separada para eventos de seguridad de identidad, sin mezclarla con auditoría comercial del tenant.
8. Añadir pruebas de renderer, contratos, servicio y E2E contra el runtime real; reportar cada conjunto por separado y no marcarlo verde sin resultados de ejecución.

### Resultado de esta pasada

Se completó la inspección estática y se registró la matriz de integración sobre el gate existente. No se implementaron endpoints, permisos, credenciales ni controles de seguridad ficticios. No se ejecutaron pruebas ni se declara CI verde. El siguiente bloque funcional depende de la ratificación de las decisiones de autenticación enumeradas en este mismo documento.


## Decisiones ratificadas para implementar D-3 — 2026-10-08

**Autoridad:** aprobación explícita del usuario en esta conversación.  
**Alcance:** política y fronteras de diseño. Esta aprobación no equivale a gate de seguridad aprobado, pruebas ejecutadas ni autorización para declarar producción lista.

### D3-01 — Identidad y credenciales

- `PlatformAccount.id` es el mismo UUID que `identity.users.id`; no se crea tabla de cuentas de plataforma.
- `identity.user_credentials` es la única fuente de credenciales PASSWORD y `identity.mfa_factors` la única fuente de factores MFA.
- La implementación evaluará **Argon2id** como KDF preferido. Antes de fijar parámetros se hará benchmark reproducible en los entornos objetivo; se versionará el formato almacenado e incluirá salt único y parámetros. No se almacenarán contraseñas reversibles ni se copiarán credenciales al cliente local.
- La elección de KDF queda aprobada como dirección de diseño; los parámetros y el formato final permanecen bloqueados hasta revisión de benchmark y pruebas.

### D3-02 — MFA administrativo

- Se adopta **WebAuthn/passkeys** como método preferido para MFA de cuentas de plataforma, sujeto a validar la compatibilidad real de clientes, autenticadores y biblioteca mantenida.
- No se crea una tabla MFA ni se inventa una representación de secreto: la integración debe cumplir el contrato existente de `identity.mfa_factors.secret_reference` y el ciclo de vida de `MfaFactor`.
- No se emitirá sesión administrativa completa hasta que el factor requerido quede verificado. Si la infraestructura WebAuthn no se puede validar, se mantiene el gate bloqueado; no se degradará silenciosamente a PIN local ni a MFA ficticio.

### D3-03 — Reautenticación

- Toda operación D-1 requiere sesión central vigente, MFA satisfecho y evidencia de reautenticación dentro de la ventana aplicable.
- La reautenticación debe verificarse en el servicio central para cada operación crítica; el renderer no es una frontera de autorización.
- La duración concreta se configura y versiona tras revisar riesgo, usabilidad y pruebas de expiración. No se fija un número de minutos sin evidencia.

### D3-04 — Recuperación de PlatformAccount

- La recuperación es un flujo central separado del login normal, con verificación reforzada, credencial de recuperación de un solo uso, expiración, consumo atómico y auditoría.
- Recuperar o reemplazar el factor invalida las sesiones/familias de refresh según política y registra evento de seguridad.
- No se define una recuperación basada únicamente en correo entrante, SMS, soporte informal ni acceso al POS local. El canal de verificación y el procedimiento de aprobación deben demostrarse seguros antes de habilitar recuperación en producción.

### D3-05 — Catálogo de eventos de seguridad

Se definirá un catálogo versionado de códigos estables, al menos para: login exitoso/fallido, credencial inválida, MFA requerido/incorrecto/registrado/revocado, reautenticación fallida/satisfecha, sesión emitida/expirada/revocada, refresh rotado/reutilizado, recuperación solicitada/completada/rechazada y limitación/bloqueo por abuso.

- Los hechos de identidad se escriben append-only en `identity.security_events`, con resultado, razón estable, correlación y timestamps.
- Los cambios administrativos de negocio se registran además en `audit.audit_events` cuando corresponda; no se sustituye un ledger por el otro.
- No se registran contraseñas, secretos MFA, tokens completos ni datos sensibles innecesarios.

### D3-06 — Sesión y refresh

- Se reutilizan `identity.sessions` y `identity.session_refresh_tokens`; no se crean tokens ni tablas paralelas.
- Los refresh tokens se almacenan protegidos mediante hash, rotan con consumo atómico y detectan reutilización; la detección revoca la familia/sesión según política y emite evento.
- Access y refresh tienen expiraciones distintas, configurables y versionadas. Los valores concretos quedan pendientes de threat modeling, compatibilidad operativa y pruebas de replay/concurrencia.
- La sesión de PlatformAccount no tiene `tenant_id` ni `tenant_membership_id`; las operaciones D-1 se autorizan desde la autoridad central.

### D3-07 — Abuso y limitación de intentos

- Se implementa rate limiting y backoff configurables por cuenta y contexto de origen, con respuesta externa que no permita enumerar cuentas.
- Las decisiones de bloqueo, escalamiento y desbloqueo deben ser versionadas, auditables y resistentes a carreras; se monitorean ráfagas distribuidas y credential stuffing.
- Umbrales, ventanas y duración de bloqueo se fijan tras pruebas de carga y abuso en el entorno objetivo, no mediante valores arbitrarios.

### Condiciones obligatorias antes de habilitar el flujo

1. Confirmar bibliotecas mantenidas y compatibilidad WebAuthn/KDF en el stack real; fijar versiones y configuración.
2. Definir el contrato versionado de `secret_reference` sin guardar secretos MFA directamente en texto claro.
3. Materializar casos de uso y repositorios sobre las tablas de identidad existentes.
4. Añadir pruebas negativas de login, MFA, reautenticación, recuperación, expiración, revocación, replay y concurrencia.
5. Verificar auditoría y no enumeración de cuentas.
6. Ejecutar los gates `SEC-G02` y `SEC-G03` con evidencia reproducible y registrar su estado real. La documentación por sí sola no cambia `PLANNED / NOT_EVALUATED`.

**Estado después de la ratificación:** decisiones de dirección documentadas; implementación aún pendiente. Los parámetros criptográficos/temporales, el contrato concreto del secreto MFA y los gates ejecutables no se consideran cerrados por inferencia.


## Auditoría de dependencias para D-3 — 2026-10-08

### Evidencia inspeccionada

- `apps/central-authority/package.json`: dependencias actuales de contratos, confianza de dispositivos y acceso PostgreSQL; no declara `argon2`, `@simplewebauthn/server` ni una biblioteca WebAuthn.
- `pnpm-lock.yaml`: no contiene paquetes `argon2`, `@simplewebauthn/server`, `@simplewebauthn/browser` ni `@node-rs/argon2`.
- `apps/central-authority/src/main.ts`: el runtime expone health, publicación de confianza de sesión y enrolamiento de dispositivos; tiene un rate limiter en memoria para esos flujos. No implementa login de PlatformAccount, MFA WebAuthn, sesiones administrativas ni refresh.
- `apps/central-authority/tests/`: las pruebas presentes cubren enrolamiento, publicación de confianza y eventos Wompi; no se encontró una suite de autenticación de PlatformAccount.
- El workspace usa Node/TypeScript, pnpm 9.15.0 y Vitest. La inspección fue estática por GitHub; no fue posible instalar dependencias ni medir KDF desde este entorno.

### Decisión de compatibilidad

**Resultado: dependencias de autenticación no materializadas; implementación bloqueada hasta validar entorno y lockfile.**

No se añadió una dependencia directa ni se modificó manualmente el lockfile: sin ejecutar resolución e instalación en el workspace no hay evidencia de compatibilidad, integridad del lockfile, binarios nativos o soporte de runtime. Tampoco se ha comparado el rendimiento de Argon2id en los sistemas objetivo ni validado WebAuthn con autenticadores reales.

### Siguiente acción ejecutable en el repositorio

1. En el workspace de la rama, verificar versiones de Node y pnpm, plataformas objetivo y políticas de dependencias.
2. Evaluar la biblioteca Argon2id mantenida para ese entorno, resolverla con pnpm y ejecutar pruebas de formato versionado, salt, verificación y benchmark sin credenciales reales.
3. Evaluar una biblioteca WebAuthn mantenida en servidor; comprobar challenge/origin/RP ID, verificación de firma, contador/backup flags según soporte, expiración y replay con autenticadores de prueba.
4. Revisar las licencias, avisos de seguridad, dependencias transitivas y generación del lockfile; ejecutar typecheck, pruebas de contratos y análisis de dependencias.
5. Solo después de esos resultados, fijar versiones y parámetros y comenzar repositorios/casos de uso sobre `identity.user_credentials`, `identity.mfa_factors`, `identity.sessions`, `identity.session_refresh_tokens` e `identity.security_events`.

**Estado:** auditoría de compatibilidad completada por inspección estática; runtime de autenticación y benchmark no ejecutados. No se declara compatibilidad ni gate de seguridad aprobado.

## Diagnóstico real de GitHub Actions en el SHA revisado — 2026-10-09 UTC

### Evidencia de ejecución consultada

Se consultaron los runs asociados por GitHub Actions al HEAD `3e67825a1237b346b101a276c02f87f21b83d95e` del PR #92. La API devuelve seis runs del evento `pull_request`, todos completados con conclusión `failure`:

| Workflow | Run ID | Conclusión observada | URL |
|---|---:|---|---|
| Central Sync Persistence Gate | 37869811417 | `failure` | https://github.com/Andresito202/pos-platform/actions/runs/37869811417 |
| CodeQL SAST | 37869811439 | `failure` | https://github.com/Andresito202/pos-platform/actions/runs/37869811439 |
| D-3 Live Security E2E | 37869811316 | `failure` | https://github.com/Andresito202/pos-platform/actions/runs/37869811316 |
| TARGET foundation validation | 37869811344 | `failure` | https://github.com/Andresito202/pos-platform/actions/runs/37869811344 |
| Strix penetration test | 37869811369 | `failure` | https://github.com/Andresito202/pos-platform/actions/runs/37869811369 |
| G1.2 Live Session Bootstrap | 37869811407 | `failure` | https://github.com/Andresito202/pos-platform/actions/runs/37869811407 |

Los runs se crearon alrededor de `2026-10-09T01:26:51Z` y figuran completados entre 3 y 4 segundos después. En los datos consultados, los jobs no exponen pasos ejecutados (`steps: []`); tampoco aparecen status checks en el endpoint de estado combinado del commit.

### Interpretación correcta y límite de la evidencia

- **GitHub Actions no está ausente:** sí hay workflows y runs asociados a este SHA.
- **El CI está rojo:** las seis conclusiones publicadas son `failure`; no hay base para declarar CI verde.
- **Causa raíz aún no identificada:** la finalización casi inmediata y la ausencia de pasos visibles sugieren un fallo anterior a la ejecución normal de los pasos, pero la evidencia consultada no distingue entre error de configuración/validación del workflow, fallo de plataforma o problema de exposición de datos del job. No se atribuye causa sin logs diagnósticos.
- **No equivale a fallo de pruebas de aplicación:** como no hay pasos visibles, no se puede afirmar que TypeScript, Vitest, PostgreSQL, E2E, CodeQL o Strix hayan llegado a ejecutarse.
- **Siguiente control de diagnóstico:** abrir cada run en GitHub y obtener el mensaje de fallo a nivel workflow/job; después corregir únicamente la causa demostrada y volver a validar el mismo HEAD actualizado. No deshabilitar workflows, no relajar gates ni declarar tests PASS para hacer desaparecer el rojo.

### Estado del bloque

Diagnóstico de metadatos de Actions materializado en esta documentación. **Causa raíz de los runs: PENDIENTE.** **Pruebas de aplicación en este SHA: NO DEMOSTRADAS por estos runs.** **D-3 autenticación PlatformAccount: NO IMPLEMENTADA**, según la auditoría de código precedente. El PR #92 sigue abierto y no fusionado.

## Continuación tras limitación operativa de Actions — 2026-10-09

El usuario autorizó continuar la materialización sin detenerse por la disponibilidad de GitHub Actions e indicó que los fallos se deben al plan Free. Esa explicación se registra como contexto operativo aportado por el usuario, no como causa técnica demostrada por los metadatos consultados. Se mantiene la regla de no afirmar que las pruebas pasaron si no existe ejecución verificable.

### Ajuste de contrato de sesión administrativa

En `packages/contracts/tests/platform-administration-session.test.ts` se corrigió el nombre del caso de expiración para describir la invariante que valida realmente `PlatformAdministrationSessionSchema`: `expires_at` debe ser estrictamente posterior a `last_reauthenticated_at`. Se añadió la condición límite de igualdad, que debe rechazarse. No se cambió la implementación de autenticación ni se presentó la validación estática del contrato como comprobación de vigencia contra el reloj actual.

Commit: `3034c6de27f6e708b9c70700b099b86687112276`.

**Verificación:** cambio guardado y releído desde la rama remota. **Ejecución de Vitest/typecheck:** no ejecutada en esta sesión. **Resultado de prueba:** pendiente de ejecución; no se declara PASS.

### Próximo bloque de implementación

Continuar con la autenticación real de PlatformAccount sobre las tablas existentes y con los gates de seguridad ya ratificados. Antes de escribir el verificador de credenciales se requiere resolver una biblioteca Argon2id mantenida en el workspace y su lockfile mediante el gestor real; no se sustituirá por un hash improvisado ni por el PIN local. Antes de MFA se debe resolver la implementación WebAuthn y el contrato operacional de `secret_reference`. La conexión actual permite editar y leer archivos remotos, pero no ejecutar la instalación del workspace, benchmarks ni las suites; por eso los cambios que requieran esas validaciones deben permanecer explícitamente no verificados hasta obtener ejecución real.



## Materialización D-3 — contrato de eventos de seguridad — 2026-10-09

### Cambios guardados en la rama del PR #92

- Se añadió `packages/contracts/src/platform-security-events.ts`.
- Se exportó el contrato desde `packages/contracts/src/index.ts`.
- Se añadió `packages/contracts/tests/platform-security-events.test.ts`.

El contrato tipa 19 códigos estables para login, credenciales, MFA, reautenticación, ciclo de sesión, rotación/reutilización de refresh, recuperación y abuso. El sobre usa metadatos compatibles con la forma existente de `identity.security_events`, exige que `server_recorded_at` no sea anterior a `occurred_at`, y exige `session_id` cuando el evento tiene `tenant_id`. Su forma estricta rechaza campos adicionales de contraseña, token de refresh o secreto MFA.

### Límites de lo materializado

Esto es contrato y cobertura de invariantes, **no** el escritor de eventos ni el flujo de autenticación. La autoridad del timestamp del servidor, la escritura append-only, la atomicidad con cambios de sesión/credenciales y el control de acceso deben imponerse en el servicio/repositorio central. No se ha conectado todavía el contrato al runtime ni a D-1.

### Verificación

Los tres archivos se volvieron a leer desde la rama remota y se confirmó la exportación. No se ejecutaron Vitest ni TypeScript en esta sesión; los tests añadidos están **pendientes de ejecución** y no se declara PASS.

### Siguiente bloque en orden

1. Materializar y probar repositorio de eventos sobre la tabla existente, con timestamps generados por el servidor y sin registrar secretos.
2. Validar dependencias reales de Argon2id y WebAuthn mediante pnpm/lockfile y runtime; no se puede dar ese paso por cerrado con una inspección estática.
3. Implementar el caso de uso de login y MFA solo después de resolver la verificación criptográfica y el contrato operacional de `secret_reference`.
4. Implementar sesión/refresh con transacciones y pruebas de replay/concurrencia sobre `identity.sessions` y `identity.session_refresh_tokens`.
5. Ejecutar pruebas de contrato, typecheck, integración y gates SEC-G02/SEC-G03 en un entorno ejecutable. Actions rojo o sin diagnóstico sigue siendo un estado no verde; no detiene el trabajo de código, pero tampoco sustituye estas pruebas.


## Materialización D-3 — persistencia append-only de eventos — 2026-10-09

### Cambios guardados

- `packages/database-postgres/src/platform-security-event-repository.ts`: repositorio que inserta en la tabla existente `identity.security_events`.
- `packages/database-postgres/src/index.ts`: exportación del repositorio.
- `packages/database-postgres/tests/platform-security-event-repository.test.ts`: pruebas unitarias con pool/cliente de PostgreSQL simulado.

El repositorio genera un identificador UUIDv7 distinto del identificador de correlación, valida los metadatos con el contrato de eventos, inserta exclusivamente el evento y obtiene `server_recorded_at` de PostgreSQL mediante `clock_timestamp()`. No ofrece operaciones de actualización ni borrado. Acepta un `PoolClient` para que el caso de uso pueda escribir el evento dentro de la misma transacción que el cambio de seguridad.

### Límites y riesgos aún abiertos

- Las pruebas usan dobles de `pg`; no prueban conexión real, permisos SQL, restricciones reales, rollback ni atomicidad en PostgreSQL.
- La atomicidad solo se consigue si el caso de uso inicia y confirma/revierte la transacción correcta y pasa ese mismo cliente al repositorio. Aún no existe el caso de uso de autenticación que lo haga.
- La tabla actual contiene `device_id` con una restricción diferida que exige `NULL`; el repositorio respeta esa restricción y no atribuye un dispositivo a estos eventos.
- El contrato de entrada usa `occurred_at` aportado por el evento y el servidor registra su propio timestamp. Un evento cuya hora de ocurrencia sea futura puede ser rechazado por la restricción temporal de base de datos; no se ajusta silenciosamente.
- No se ejecutaron Vitest, typecheck ni pruebas contra PostgreSQL en esta sesión. Las pruebas nuevas permanecen **pendientes de ejecución**.

### Siguiente bloque

1. Integrar este repositorio en una capa de aplicación con transacción explícita y pruebas de rollback/atomicidad contra PostgreSQL.
2. Cerrar la instalación y verificación real de Argon2id/WebAuthn y el contrato de `secret_reference`.
3. Implementar login/MFA, emisión y revocación de sesiones, y rotación/replay de refresh sobre las tablas existentes.
4. Ejecutar pruebas y gates de seguridad en un entorno que pueda correr el workspace. El estado de CI no se considera verde sin evidencia de ejecución.


## Corrección del contrato de escritura de eventos — 2026-10-09

Se añadió `PlatformSecurityEventWriteSchema` para validar los metadatos de entrada sin fabricar un `server_recorded_at`; ese timestamp sigue siendo generado por PostgreSQL. Se añadieron pruebas para el rechazo de eventos con tenant sin sesión y de timestamps suministrados por el llamador. Cambios en commits `226a56629b6fe65bba34ed3635228015231eec61`, `43486a910cb2911f5b95482e387c7f3894b98b01`, `be2e9707588de6dea644f56e211db995e0820bf5` y `0c582c3ab491643c8542aecdad5bbb8207364557`.

**Verificación pendiente:** no se ejecutaron Vitest ni TypeScript. Las pruebas de PostgreSQL real y la atomicidad transaccional siguen pendientes; esta corrección no implementa login/MFA.


## Revisión incremental del repositorio de eventos y dependencias — 2026-10-09

Se añadieron dos pruebas unitarias de validación de salida: rechazar una fila persistida si `server_recorded_at` precede a `occurred_at`, y fallar explícitamente cuando el `INSERT ... RETURNING` no entrega fila. Commit: `47c53135e06b461014e120b35263e955713b1533`.

Inspección estática del workspace en la misma rama: `pnpm-lock.yaml` no contiene `argon2`, `@node-rs/argon2`, `@simplewebauthn/server`, `@simplewebauthn/browser` ni `@simplewebauthn/types`; `apps/central-authority/src/main.ts` no expone flujo de login, sesiones de PlatformAccount o MFA. `identity.mfa_factors.secret_reference` existe como texto no vacío opcional, pero el contrato de referencia/gestor de secretos no está definido en el DDL inspeccionado. No se agregaron dependencias ni se implementó autenticación con primitivas improvisadas.

**Pendiente de ejecución:** las pruebas añadidas y el typecheck no se ejecutaron en esta sesión; no existe evidencia de CI para el SHA actual en la consulta realizada. La validación con PostgreSQL real, atomicidad/rollback y revisión de privilegios efectivos sigue abierta.


## Revisión de compatibilidad con DDL y RLS — 2026-10-09

Se contrastó el SQL del repositorio contra `tools/target-migrations/sql/postgres/001_central_foundation.up.sql` en la misma rama:

- La tabla existente incluye las columnas insertadas por el repositorio; `device_id` está explícitamente restringido a `NULL`, y el repositorio envía `NULL`.
- `server_recorded_at` se calcula en PostgreSQL y el DDL exige que no sea anterior a `occurred_at`.
- La tabla tiene RLS habilitado y forzado. La política `security_events_platform_context` permite a `pos_platform_app` escribir eventos globales solo con `tenant_id IS NULL`; la política tenant exige contexto tenant y sesión según las restricciones de tabla. El repositorio no cambia el rol ni el contexto de la conexión: el caller debe usar el rol/conexión de servicio previsto y el caso de uso debe controlar transacciones/contexto.
- Se reforzó la prueba unitaria para comprobar la forma de columnas, el orden de parámetros, el ID UUIDv7 independiente de la correlación y la ausencia de nombres de campos secretos en el SQL.

**Límite de verificación:** es una comprobación estática del DDL y del código, no una prueba de permisos efectivos de PostgreSQL. No se ejecutaron las pruebas ni typecheck. Falta ejecutar la prueba contra la base de datos real con roles RLS de runtime, comprobar inserción global permitida y tenant cruzado denegado, y verificar rollback de la transición junto al evento. El bloque D-3 sigue parcial y no autoriza a marcar D-1 como implementado.


## Comprobación de Actions y fallo transaccional — 2026-10-09

Se añadió una prueba unitaria que exige propagar el error del cliente transaccional y prohíbe reintentar silenciosamente el INSERT usando el pool fuera de la transacción. Esto protege contra la pérdida de atomicidad si falla la escritura del evento. La prueba está escrita pero **no ejecutada**.

Consulta de GitHub Actions para HEAD `c981ca1733f88e0cf36f0bed0c76557aa648e194`: seis ejecuciones asociadas finalizaron con `failure` (Central Sync Persistence Gate, D-3 Live Security E2E, TARGET foundation validation, G1.2 Live Session Bootstrap, CodeQL SAST y Strix penetration test). Los endpoints disponibles no devolvieron logs de trabajo utilizables; por ello no se atribuye una causa raíz sin evidencia. La consulta de status combinado no mostró estados individuales. Los siguientes pasos son recuperar los logs/anotaciones desde GitHub, corregir cada causa demostrada y esperar nuevas ejecuciones sobre el SHA actualizado. No se debe interpretar el fallo de Actions como prueba de que el nuevo test es la causa.

La lectura estática del DDL confirma que `identity.security_events` exige ID UUIDv7, correlation ID UUIDv7, `server_recorded_at >= occurred_at`, `device_id IS NULL` y sesión no nula para eventos con tenant; además, tiene triggers append-only y RLS forzado. La comprobación estática no sustituye una ejecución PostgreSQL con roles de runtime.


## Cobertura CI del paquete database-postgres — 2026-10-09

La inspección del workflow `.github/workflows/target-foundation-validation.yml` mostró que el job principal ya ejecutaba `pnpm typecheck` y el test de onboarding del servicio local, pero no ejecutaba `packages/database-postgres/tests/platform-security-event-repository.test.ts`. Se añadió un paso explícito `pnpm --filter @pos-platform/database-postgres test` al job de validación PostgreSQL para que las pruebas del repositorio de eventos formen parte del gate automatizado. La edición del workflow quedó guardada en la rama; aún requiere ejecución en Actions para confirmar que el comando y las pruebas pasan.

Las ejecuciones de Actions consultadas para el SHA anterior finalizaron como `failure` en pocos segundos. Los logs no están disponibles mediante la integración consultada, por lo que no se atribuye causa raíz. La ejecución sobre el SHA nuevo es necesaria para comprobar si el cambio activa correctamente la cobertura y para obtener resultados reproducibles.


## Diagnóstico de reintento de GitHub Actions — 2026-10-09

Se reintentaron los jobs fallidos de TARGET foundation validation, D-3 Live Security E2E, Central Sync persistence/idempotency, Windows session bootstrap, CodeQL y Strix sobre el mismo SHA `d145d3e2edea721a40282282a5762706be8aebe2`. El segundo intento de TARGET muestra jobs completados como `failure` en 3–7 segundos, `runner_id: 0`, `runner_name: ""` y `steps: []`. Los logs descargables responden `BlobNotFound`; los jobs no aportan salida de comandos ni pruebas ejecutadas. Esto demuestra que esos resultados no permiten diagnosticar fallos del código: la ejecución no llegó a registrar un runner ni pasos. No se etiqueta como PASS y no se modifica código de producto para “arreglar” un fallo de infraestructura. Se requiere restaurar/validar la disponibilidad y permisos de runners de GitHub Actions y volver a ejecutar el SHA exacto.

La lectura estática del DDL también confirmó que existen políticas separadas para eventos de seguridad por tenant (`security_events_tenant_isolation`, contexto `platform.current_tenant_id()`) y eventos globales de plataforma (`security_events_platform_context`, `tenant_id IS NULL`), además de permisos SELECT/INSERT para `pos_app`, `pos_worker` y `pos_platform_app`. Esto es inspección del SQL versionado, no una prueba de integración PostgreSQL/RLS en ejecución.


## Avance posterior — vigencia temporal de sesión administrativa

Se añadió `assertPlatformAdministrationSessionUsable` en `packages/contracts/src/central-administration.ts`. La validación de esquema por sí sola solo confirma la forma y la relación entre fechas; no demuestra que la sesión siga vigente frente al reloj actual.

La función nueva comprueba en tiempo de ejecución:

- reloj válido;
- límite de reautenticación configurado por el llamador, positivo y entero seguro;
- sesión no expirada;
- reautenticación no situada en el futuro;
- reautenticación dentro del máximo aprobado que recibe como parámetro.

No se fija un timeout global sin decisión de política, no emite tokens, no autentica al usuario y no concede permisos D-1. El servicio central deberá invocarla con el límite aprobado antes de cada operación protegida y resolver la autorización por separado.

Se añadieron pruebas de contrato para expiración, reautenticación antigua, fecha futura, caso válido y parámetros inválidos en `packages/contracts/tests/platform-administration-session.test.ts`.

**Estado de verificación:** las pruebas se añadieron al repositorio, pero no se ejecutaron en este entorno. GitHub Actions queda deliberadamente fuera del ciclo de avance por instrucción; no se declara PASS. Sigue pendiente conectar esta guarda a un servicio de sesión/operación real y verificarla mediante pruebas ejecutadas.


## Materialización incremental — lectura de sesión global MFA — 2026-10-09

Se añadió `PostgresPlatformAdministrationSessionRepository` en `packages/database-postgres/src/platform-administration-session-repository.ts` y se exportó desde el índice del paquete. El método `findActiveGlobalMfaSession` consulta las tablas existentes `identity.sessions`, `identity.users` e `identity.mfa_factors`; no emite sesiones ni lee credenciales o secretos.

La consulta solo devuelve un candidato si la sesión no está revocada, sigue vigente según el reloj de PostgreSQL, no tiene contexto tenant, registra MFA satisfecho, tiene reautenticación y el usuario está activo con al menos un factor MFA verificado y activo. La capa de repositorio también rechaza reloj inválido, política de antigüedad inválida, reautenticación futura o antigua y sesión expirada. Los errores de base de datos se propagan.

### Límite de seguridad identificado y preservado

La inspección del DDL no encontró una relación de asignación/eligibilidad de PlatformAccount independiente del contexto tenant. Por eso el repositorio devuelve deliberadamente `GlobalMfaSessionCandidate` con `user_id`, no un `PlatformAdministrationSession` ni un actor `PLATFORM_ACCOUNT`. Una sesión global con MFA no prueba por sí misma que la identidad tenga autoridad administrativa central. No se permite usar este resultado para autorizar operaciones D-1 hasta que la fuente de elegibilidad de PlatformAccount y la autorización de cada operación estén materializadas.

Se añadieron pruebas unitarias para candidato válido, sesión no encontrada/inactiva, reautenticación antigua, expiración, reautenticación futura, UUID inválido, error de base de datos y política inválida. Están escritas pero **no ejecutadas**. Tampoco se probó contra PostgreSQL real ni se verificaron permisos efectivos/RLS. Este bloque no implementa login, emisión/revocación de sesión, refresh, MFA challenge ni autorización D-1.

**Estado:** repositorio de lectura candidato materializado; tests pendientes de ejecución; elegibilidad PlatformAccount y runtime de autenticación siguen abiertos. No se declara PASS ni se considera completado D-3.


## Cierre de auditoría del bloque D-3 — elegibilidad de PlatformAccount — 2026-10-09

### Resultado de inspección de fuentes existentes

Se contrastaron el contrato `packages/contracts/src/central-administration.ts`, el repositorio `packages/database-postgres/src/platform-administration-session-repository.ts`, el modelo conceptual `docs/architecture/conceptual-data-model.md`, la migración PostgreSQL `001_central_foundation.up.sql` y la configuración de `apps/central-authority/src/main.ts`.

Hallazgos verificables:

1. El contrato declara que `PlatformAccount.id` es el mismo UUID que `identity.users.id`; no debe crearse una segunda identidad ni duplicar contraseña, MFA o sesión.
2. El modelo conceptual menciona `PlatformAccount.security_level`, pero el DDL físico inspeccionado de `identity.users` no contiene esa columna ni existe una relación física específica de elegibilidad de PlatformAccount en la migración base.
3. `authorization.user_role_assignments` es contexto de autorización de usuarios vinculados a tenant; no constituye por sí misma una asignación global de PlatformAccount y no se reutiliza como bypass tenant.
4. `apps/central-authority/src/main.ts` instancia el flujo de enrolamiento de dispositivos; en la ruta inspeccionada no registra endpoints de login administrativo, desafío MFA, reautenticación, recuperación, refresh ni autorización de operaciones D-1.
5. El repositorio de sesión añadido devuelve únicamente `GlobalMfaSessionCandidate`. Ese tipo no acredita elegibilidad administrativa y no se convierte implícitamente en `PlatformAdministrationSession`.

### Por qué no se añadió una migración especulativa

La ausencia de una fuente física de elegibilidad es un bloqueo de autorización, no una omisión que se pueda cerrar asignando cualquier usuario activo con MFA a la administración de plataforma. Hacerlo permitiría escalar a un usuario que nunca fue autorizado como operador interno. Tampoco es válido reutilizar una asignación tenant como autoridad global ni añadir una tabla duplicada sin definir su ciclo de vida, asignador autorizado, revocación, auditoría, RLS y restricciones de unicidad.

Antes de crear o cambiar el esquema debe ratificarse explícitamente una de estas opciones:

- **A. Relación explícita de elegibilidad** vinculada por FK a `identity.users.id`, con estado, nivel de seguridad, fechas/auditoría y reglas de alta/revocación; es más expresiva, pero requiere definir quién puede conceder o retirar la elegibilidad y cómo se protege esa fuente.
- **B. Atributos en `identity.users`** para distinguir elegibilidad/estado de plataforma; evita una tabla nueva, pero mezcla el ciclo de vida de identidad con privilegios internos y necesita un mecanismo de cambios privilegiados y auditoría igualmente definido.

La decisión debe especificar además la primera cuenta de plataforma (bootstrap seguro, sin credencial predeterminada), los roles/permisos globales admitidos, el procedimiento de revocación de emergencia y la matriz RLS por rol PostgreSQL. Ninguna de esas políticas se infiere automáticamente de `security_level` conceptual.

### Estado real de materialización y verificación

- **Materializado en la rama:** guarda temporal de sesión, repositorio de lectura de candidato MFA global, exportación del paquete, pruebas unitarias escritas y este diagnóstico de brecha.
- **No materializado:** fuente de elegibilidad de PlatformAccount, autenticación de credenciales, verificación MFA real, emisión/rotación/revocación de sesión y refresh, recuperación segura, registro de eventos de seguridad desde los flujos, guardas de reautenticación integradas al runtime, autorización D-1 por operación y pruebas PostgreSQL/RLS end-to-end.
- **No ejecutado:** los nuevos tests del contrato y del repositorio. Las pruebas que sólo mockean `Pool.query` no demuestran que el SQL compile ni que RLS permita/deniegue correctamente.
- **CI:** se sigue excluyendo del ciclo por instrucción. Los fallos anteriores con `runner_id: 0`, `runner_name` vacío y sin pasos registrados no prueban un fallo de código, pero tampoco constituyen validación positiva.
- **Estado de salida:** `D-3 INCOMPLETO / NO PASS`. No declarar 100% ni seguridad lista hasta implementar y probar todos los flujos y cerrar la decisión de elegibilidad.

### Secuencia de cierre pendiente (orden obligatorio)

1. Ratificar la fuente de elegibilidad y bootstrap de la primera cuenta.
2. Materializar esquema/RLS/grants/auditoría y su reversión de forma versionada, si la decisión lo exige.
3. Implementar autenticación de contraseña con un KDF soportado y parámetros aprobados; no reutilizar PIN local ni inventar codificación de `verifier`.
4. Implementar MFA real con contrato de almacenamiento/recuperación de `secret_reference` o credenciales WebAuthn; no simular desafíos.
5. Implementar sesión central y refresh con hashes, rotación atómica, detección de replay y revocación de familia.
6. Conectar reautenticación reciente y resolución de permisos a cada operación D-1; denegar por defecto.
7. Emitir eventos de seguridad append-only respetando UUIDv7, correlación, reloj y RLS del DDL existente.
8. Añadir pruebas negativas, concurrencia, replay, expiración, revocación, aislamiento de roles/RLS y E2E.
9. Ejecutar typecheck, tests de paquetes, migraciones PostgreSQL, arquitectura/policy gates y CI; registrar los resultados reales por SHA.

Este cierre no crea un contrato alternativo ni abre una rama paralela. Deja documentado el punto exacto donde continuar sobre el mismo trabajo sin conceder autoridad por inferencia.


### Verificación adicional de autorización y dependencias — 2026-10-09

Se amplió la inspección del DDL y los manifiestos existentes para evitar introducir una segunda fuente de roles o un mecanismo criptográfico no soportado.

- `authorization.roles` ya admite `scope_type = 'PLATFORM'`; se reutilizará ese catálogo de roles y permisos.
- `authorization.user_role_assignments` exige `tenant_id` y `tenant_membership_id`. Por su contrato físico no puede representar una asignación global de PlatformAccount sin romper su invariante tenant.
- El modelo físico y `tools/target-migrations/src/contract.ts` no declaran una tabla de asignaciones globales de cuentas de plataforma. Por tanto, la existencia de roles de ámbito PLATFORM no implica que un usuario tenga uno asignado.
- El manifiesto ya contiene `identity.session_refresh_tokens`, `identity.password_recovery_requests` e `identity.security_events`; no se deben duplicar. Sus tablas existentes permiten diseñar la implementación sobre la base actual, pero no prueban que los flujos de runtime estén conectados.
- El `package.json` raíz declara pnpm 9.15.0 y los scripts de typecheck y tests por paquete. `packages/database-postgres` declara sólo `pg`, los paquetes workspace y Vitest como dependencias; no declara una biblioteca Argon2 ni una biblioteca WebAuthn. La búsqueda del repositorio tampoco encontró uso de Argon2. No se añadirá un import de biblioteca inexistente ni se tratará el PIN local basado en scrypt como autenticación central.
- El paquete de migraciones ya tiene convenciones de descriptores, runners, contratos físicos e introspección. Cualquier nueva migración debe integrarse en todos esos puntos y tener pruebas de aplicación, reversión y RLS; crear únicamente un archivo SQL no sería una materialización completa.

### Decisión técnica provisional para el siguiente cambio de código

La solución debe conservar `authorization.roles` y `authorization.role_permission_grants`, añadir una relación global explícita de asignación de rol sólo si se formaliza su contrato físico, y hacer que la elegibilidad se compruebe junto con usuario activo, sesión no revocada, MFA verificado y reautenticación reciente. La asignación debe ser revocable y auditada; las cuentas sin asignación deben fallar cerradas. No se sembrará ningún administrador por defecto ni se concederá autoridad automáticamente al primer usuario.

Esta inspección no cambia el estado: sigue siendo `D-3 INCOMPLETO / NO PASS`. No se ejecutaron typecheck, Vitest ni pruebas PostgreSQL en este entorno, y no se atribuye ningún resultado positivo a Actions.

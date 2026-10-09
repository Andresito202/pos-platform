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


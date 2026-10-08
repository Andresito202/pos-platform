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

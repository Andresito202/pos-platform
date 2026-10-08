# D-3 — Platform Account: identidad, autenticación, recuperación y sesión

Fecha: 2026-10-08  
Rama: `claude/pos-camacho-bloque-4c-ld43py`  
Estado: `BLOCKED_BY_MISSING_AUTHORITY_CONTRACT`

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

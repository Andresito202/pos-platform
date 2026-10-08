# D-3 — Platform Account: identidad, autenticación, recuperación y sesión

Fecha: 2026-10-08  
Rama: `claude/pos-camacho-bloque-4c-ld43py`  
Estado: `BLOCKED_BY_MISSING_AUTHORITY_CONTRACT`

## Objetivo

Cerrar el contrato canónico que permita materializar de forma segura `PlatformAccount` como actor administrativo de la autoridad central.

Este gate no crea tablas, credenciales, endpoints ni tokens. Su propósito es impedir que D-3 introduzca una segunda identidad paralela o una autenticación inventada.

## Evidencia existente

### 1. PlatformAccount existe únicamente como entidad conceptual

`docs/architecture/conceptual-data-model.md` define `PlatformAccount` como usuario interno del proveedor con:

- `id`;
- `email`;
- `phone`;
- `status`;
- `security_level`;
- `last_login_at`.

El documento no fija valores canónicos para `status` ni `security_level`, ni define credenciales, MFA, recuperación, sesiones o revocación de credenciales.

### 2. El modelo físico actual ya tiene identidad y sesiones de usuario

La primera migración central define:

- `identity.users`;
- `identity.sessions`;
- `identity.session_refresh_tokens`;
- `identity.security_events`.

La sesión existente se vincula a `user_id`, tenant/membership y, cuando corresponda, dispositivo. La sesión contiene `mfa_status`, `last_reauthenticated_at`, expiración y revocación.

Esto demuestra que ya existe una autoridad de sesión para usuarios de tenant, pero no demuestra que `PlatformAccount` pueda reutilizar `identity.users` sin una decisión explícita de identidad y alcance.

### 3. La SSA existente representa identidad de usuario, no una cuenta de plataforma

`packages/contracts/src/session-assertion.ts` exige:

- `session_id`;
- `user_id`;
- `tenant_membership_id`;
- binding de instalación/dispositivo;
- vigencia y política;
- evidencia MFA.

El runtime local consume esa identidad para sesiones de negocio. No existe en el contrato actual una SSA equivalente para un `PLATFORM_ACCOUNT` ni una regla que permita tratar una cuenta de plataforma como usuario de tenant.

### 4. MFA y recuperación están definidos como requisitos de seguridad, no como contrato implementable de PlatformAccount

`docs/security/security-gates.md` exige MFA y reautenticación para administración crítica y exige recuperación separada, tokens de un solo uso, verificación reforzada, revocación y trazabilidad.

La búsqueda del repositorio no encontró un contrato canónico que materialice:

- credencial primaria de PlatformAccount;
- factor MFA y sus estados;
- recuperación de cuenta;
- tokens de recuperación de un solo uso;
- revocación de credenciales;
- sesiones administrativas de plataforma;
- política de reautenticación;
- rate limiting/lockout específico de PlatformAccount.

## Decisión del gate

D-3 **no puede materializar todavía persistencia ni autenticación de PlatformAccount** sin inventar autoridad.

Queda prohibido en este bloque:

1. crear `platform_accounts` por inferencia;
2. reutilizar `identity.users` como cuenta de plataforma sin decisión contractual;
3. crear contraseñas, hashes, bearer tokens o JWT no definidos;
4. crear endpoints administrativos sin contrato de sesión;
5. crear MFA o recuperación parcialmente implementados;
6. conectar Electron directamente a PostgreSQL;
7. marcar Superadmin UI como funcional mientras no exista una sesión administrativa verificable.

## Contrato mínimo que debe cerrarse antes de D-3 físico

La decisión canónica debe fijar explícitamente:

### Identidad

- si PlatformAccount es agregado independiente o una proyección/rol de una identidad existente;
- identificador canónico;
- unicidad y normalización de email;
- teléfono y su uso;
- estado y transiciones;
- suspensión/revocación;
- `security_level` y sus valores.

### Autenticación

- método primario;
- almacenamiento de credenciales;
- política de credenciales;
- protección contra credential stuffing/brute force;
- rate limiting;
- lockout/backoff;
- auditoría de intentos;
- revocación de credenciales.

### MFA

- factores admitidos;
- enrolamiento;
- estados;
- evidencia verificable;
- reautenticación;
- recuperación ante pérdida del factor;
- requisitos adicionales para operaciones críticas.

### Sesión

- autoridad emisora;
- identificador de sesión;
- claims mínimos;
- duración;
- renovación;
- revocación;
- binding, si aplica;
- relación con `identity.sessions`;
- diferencia entre sesión de plataforma y SSA de usuario de tenant.

### Recuperación

- iniciación;
- prueba reforzada de identidad;
- token de un solo uso;
- hash/persistencia del token;
- expiración;
- consumo atómico;
- revocación de sesiones anteriores;
- auditoría completa.

### Autoridad administrativa

- qué operaciones D-1 puede ejecutar un PlatformAccount;
- separación entre autenticación y autorización;
- requisito de MFA/reautenticación por operación;
- actor que debe quedar en auditoría;
- emisión y revocación de sesiones administrativas.

## Criterio de salida

D-3 se podrá cerrar únicamente cuando exista un contrato único y testeable que permita responder, sin inferencias:

`¿Quién es un PlatformAccount?`

`¿Cómo demuestra su identidad?`

`¿Cómo se satisface MFA?`

`¿Cómo se recupera sin takeover?`

`¿Cómo se emite, renueva y revoca su sesión?`

`¿Cómo se traduce esa sesión a un actor PLATFORM_ACCOUNT para autorización y auditoría?`

Hasta entonces, la ausencia de tablas/API no es trabajo pendiente accidental: es un bloqueo arquitectónico explícito.

## Siguiente paso

Una vez cerrada esta decisión, el siguiente bloque debe materializarse en este orden:

1. contrato compartido de identidad/autenticación de PlatformAccount;
2. pruebas estructurales y negativas;
3. persistencia central;
4. servicio de autenticación/sesión;
5. auditoría de seguridad;
6. transporte administrativo;
7. integración con D-1;
8. recién después, Superadmin UI.

No se autoriza saltar directamente a licencias, planes ni frontend.

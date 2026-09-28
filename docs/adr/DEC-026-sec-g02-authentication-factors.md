# DEC-026 — `SEC-G02`: factores de autenticación del operador

## Estado

`ACEPTADA` como política el 2026-09-26: las diez decisiones de la tabla
fueron ratificadas por el propietario, una a una y en sesión. Ninguna se
completó por inferencia (`DEC-012` §13). La implementación se autorizó
aparte, después, el mismo día (§13).

| Id | Decisión | Estado |
|---|---|---|
| `A-1` | Factor primario de inicio de sesión | **RATIFICADO** 2026-09-26 (§2) |
| `A-2` | Reautenticación dentro del turno | **YA RATIFICADO** en `DEC-012` §18 — se reconcilia en §3, no se redecide |
| `A-3` | ¿El login con contraseña exige conexión con la autoridad central? | **RATIFICADO** 2026-09-26 (§4) |
| `A-4` | Alcance de MFA por rol | **RATIFICADO** 2026-09-26 (§5), incluido `A-4.1` |
| `A-5` | Longitud mínima y política de contraseña | **RATIFICADO** 2026-09-26 (§6) |
| `A-6` | Alta de cuenta y contraseña inicial | **RATIFICADO** 2026-09-26 (§7) |
| `A-7` | Identificador de inicio de sesión (correo, usuario, código de empleado) | **RATIFICADO** 2026-09-26 (§8) |
| `A-8` | Bloqueo y limitación de intentos de contraseña | **RATIFICADO** 2026-09-26 (§9) |
| `A-9` | Recuperación de cuenta | **RATIFICADO** 2026-09-26 (§10) |
| `A-10` | Duración y rotación de access/refresh token | **RATIFICADO** 2026-09-26 (§11) |

## Qué NO es

- **No cierra `SEC-G02`** ni le sube un peldaño: sigue `PLANNED / NOT_EVALUATED`
  en `docs/product/backlog.md` hasta que exista implementación y la evidencia
  que exige `docs/security/security-gates.md` §SEC-G02.
- **La política no autorizaba implementar por sí sola.** La implementación
  se autorizó por separado (§13) y sigue condicionada a las brechas de
  esquema de §13.3, que exigen decisión propia.
- **No sustituye a `DEC-025`** ni a la sesión de revisión por rol de
  `apps/pos-local-service/src/dev-only/`. Aquélla es aprovisionamiento; ésta,
  revisión de pantallas. Ninguna autentica a una persona.

## 1. Contexto

`D-28` (`docs/governance/materialization-state.md`): el POS verifica una
aserción de sesión (SSA) pero ninguna ruta de producción la emite, porque la
autoridad no sabe autenticar al usuario. El paso siguiente que registra `D-28`
no es código: es decidir `SEC-G02`. Este documento lo empieza.

## 2. `A-1` — factor primario: contraseña

Ratificado por el propietario el 2026-09-26, en sesión:

> «Contraseña, con posibilidad de PIN rápido para reautenticación en el turno.»

El inicio de sesión de un operador se autentica con **contraseña**.

Lo que esta decisión **no** fija, y queda en la tabla de estado: dónde se
verifica (`A-3`), si va acompañada de segundo factor (`A-4`), su longitud y
composición (`A-5`), cómo nace (`A-6`), con qué identificador se usa (`A-7`),
cómo se limita la fuerza bruta (`A-8`) y cómo se recupera (`A-9`).

## 3. `A-2` — el «PIN rápido» ya está decidido

La segunda mitad de la respuesta coincide con una decisión **anterior y
vigente**: `DEC-012` §18 ratificó el 2026-09-03 la prueba de presencia local
del cajero y del supervisor. No se reabre; se cita para que nadie la
reimplemente con otros parámetros:

- PIN numérico de **6 dígitos**, individual, nunca compartido (§18.2, §18.3).
- **Generado por CSPRNG, no elegido por el usuario en la ruta por defecto**
  (§18.2).
- Verifier derivado con `scrypt`, parámetros `PROVISIONAL — REQUIRES REAL
  HARDWARE BENCHMARK` (§18.11).
- 5 intentos, backoff `0 s · 0 s · 5 s · 15 s`, lockout de 15 minutos
  persistido y evaluado con `TrustedClockGuard` (§18.4–§18.6).
- Presencia: 10 minutos de inactividad, 2 horas de ventana máxima (§18.7).
- Operaciones de caja sensibles exigen re-presencia (§18.8).
- El verifier sobrevive a la expiración de la SSA (§18.9).

Relación entre ambos factores, derivada de las dos decisiones y sin añadir
nada: la **contraseña** establece la sesión (SSA); el **PIN** restablece la
**presencia** dentro de esa sesión, sin volver a pedir la contraseña, mientras
la SSA siga vigente (techo efectivo 24 h, `DEC-012` §19).

## 4. `A-3` — el login exige conexión con la autoridad central

Ratificado por el propietario el 2026-09-26, en sesión, eligiendo la opción
«Sí, online».

- La contraseña se verifica **en la autoridad central**, que es quien emite la
  SSA y el SAS. Es coherente con `DEC-012` D1 (la SSA la emite la autoridad
  central) y no la modifica.
- Dentro de la vigencia de la SSA (techo efectivo 24 h, `DEC-012` §19) el
  equipo opera sin Internet y restablece presencia con el PIN de `DEC-012` §18.
- **Consecuencia aceptada:** sin conexión y sin SSA vigente no se puede abrir
  sesión nueva. El equipo **no** firma sesiones propias.

## 5. `A-4` — MFA obligatorio sólo para roles de administración

Ratificado por el propietario el 2026-09-26, en sesión, eligiendo «Solo
administradores». El segundo factor es un **código de app autenticadora**
(así se formuló la pregunta).

| Rol (`docs/product/roles.md`) | MFA |
|---|---|
| `PLATFORM_OWNER` (superadministrador) | obligatorio |
| `OWNER` (dueño) | obligatorio |
| `GENERAL_ADMIN` (administrador) | obligatorio |
| `SUPERVISOR` | no — contraseña + equipo enrolado; PIN en turno |
| `CASHIER` | no — contraseña + equipo enrolado; PIN en turno |

`A-4.1` **RATIFICADO** 2026-09-26, en sesión, eligiendo «Sí, los dos»:

| Rol | MFA |
|---|---|
| `BILLING_ADMIN` | obligatorio |
| `SECURITY_ADMIN` | obligatorio |

Cualquier otro rol de `roles.md` que no aparezca en estas dos tablas **no se
asigna por inferencia**. El vínculo definitivo rol → permisos sigue siendo de
`SEC-G03`.

## 6. `A-5` — longitud y política de contraseña

Ratificado por el propietario el 2026-09-26, en sesión, eligiendo «15 sin MFA
/ 8 con MFA», que se formuló como «sigue NIST al pie de la letra».

- **15 caracteres mínimo** cuando la contraseña es el único factor
  (`SUPERVISOR`, `CASHIER`).
- **8 caracteres mínimo** cuando va con MFA (roles de §5).
- Sin reglas de composición (mayúsculas, símbolos), sin caducidad forzada.
- Se verifica contra listas de contraseñas filtradas o comprometidas.

Fuente: NIST SP 800-63B rev. 4, §Password Verifiers, consultada el 2026-09-26
en `pages.nist.gov/800-63-4/sp800-63b.html` («Verifiers and CSPs SHALL require
passwords that are used as a single-factor authentication mechanism to be a
minimum of 15 characters in length… SHALL require them to be a minimum of
eight characters»).

**Derivado, no ratificado aparte:** al elegir seguir NIST «al pie de la
letra», también aplican sus demás requisitos obligatorios de ese apartado
(por ejemplo, admitir contraseñas de al menos 64 caracteres y permitir
pegar). La implementación deberá leer el texto vigente de la norma, no esta
paráfrasis.

## 7. `A-6` — alta con contraseña temporal

Ratificado por el propietario el 2026-09-26, en sesión, eligiendo «Contraseña
temporal».

- Un administrador crea el usuario; **el sistema** genera una contraseña
  temporal **de un solo uso**.
- El usuario **debe cambiarla en su primer ingreso**; hasta entonces la cuenta
  no opera.
- No depende de que cada cajero tenga correo.

Una contraseña olvidada se resuelve por este mismo camino: ver `A-9` (§10).

## 8. `A-7` — identificador de inicio de sesión

Ratificado por el propietario el 2026-09-26, en sesión, eligiendo «Usuario/
código + correo admin».

- `CASHIER` y `SUPERVISOR`: **nombre de usuario o código de empleado**. No
  necesitan correo.
- Roles con MFA (§5): **correo**.

## 9. `A-8` — intentos fallidos de contraseña

Ratificado por el propietario el 2026-09-26, en sesión, eligiendo «Como el
PIN». Reutiliza los números de `DEC-012` §18.4–§18.6; aquí se aplican a la
contraseña, que se verifica en la autoridad central (§4):

- Máximo **5** intentos; backoff `0 s · 0 s · 5 s · 15 s`; al 5.º, `LOCKOUT`.
- Lockout de **15 minutos**, que se levanta solo al expirar; un administrador
  autorizado puede levantarlo antes.
- **El mismo mensaje de error** exista o no la cuenta: no se enumeran
  usuarios.
- Además del contador por cuenta, **limitación por equipo/IP** en el servidor.
- Contadores y lockout persistidos; nunca sólo en memoria.

Los contadores de la contraseña (central) y del PIN (local) son
**independientes**: fallar uno no consume intentos del otro.

## 10. `A-9` — recuperación de cuenta

Ratificado por el propietario el 2026-09-26, en sesión, eligiendo «Admin
reinicia + códigos».

- **Camino ordinario:** un administrador genera una nueva **contraseña
  temporal de un solo uso** (el mismo mecanismo de `A-6`) y **se revocan todas
  las sesiones anteriores** del usuario. El usuario la cambia en su primer
  ingreso.
- **`PLATFORM_OWNER`**, que no tiene a nadie por encima, se recupera con
  **códigos de recuperación de un solo uso** que se entregan al activar su
  MFA.
- No hay recuperación por correo ni autoservicio.

## 11. `A-10` — duración y rotación de tokens y sesión

Ratificado por el propietario el 2026-09-26, en sesión, eligiendo «Ratificar
tal cual» sobre la propuesta presentada ese mismo día.

Pone números al modelo de refresh ya cerrado en esquema (`PHY-G02`,
`docs/architecture/physical-model/foundation-schema.md` §`identity.session_refresh_tokens`;
`docs/architecture/conceptual-data-model.md` §SessionRefreshToken). No lo
rediseña.

| Parámetro | `CASHIER` / `SUPERVISOR` | Roles con MFA (§5) |
|---|---|---|
| Access token | 10 min | 10 min |
| Refresh token | un solo uso, rotado en cada renovación | igual |
| Caducidad por inactividad del refresh | ninguna propia | 30 min |
| Duración absoluta de la sesión (`Session.expires_at`) | 24 h | 12 h |
| Reautenticación reciente para operaciones críticas de administración | — | contraseña + MFA en los últimos 15 min |
| Reutilización de un refresh ya consumido | revoca **la sesión entera** + `SecurityEvent` | igual |
| Retención del hash de tokens consumidos (`retained_until`) | hasta el fin de la sesión | igual |

Invariante ratificado con esta propuesta:

```
SSA.offline_valid_until  <=  Session.expires_at
```

Se suma a la cadena de `DEC-012` §19 (`SSA.offline_valid_until <=
SAS.expires_at <= TTL de despliegue`), no la sustituye.

**Corrección, 2026-09-26.** Al proponerlo se presentó como invariante
**nuevo**. No lo es: la migración PostgreSQL 001 ya lo impone sobre
`identity.sessions` (`sessions_offline_expiry_ck`,
`tools/target-migrations/sql/postgres/001_central_foundation.up.sql`). La
ratificación lo confirma; no añade nada al esquema.

Razones registradas:

- **Sin caducidad por inactividad en servidor para operadores:** su
  inactividad la gobierna la presencia local (`DEC-012` §18.7, 10 min).
  Duplicarla en el servidor obligaría a reintroducir la contraseña tras un
  corte de Internet con la sesión local aún vigente.
- **24 h para operadores:** es el techo del SAS ya ratificado (`DEC-011`,
  `DEC-012` §19); no añade exposición a revocación y cubre una jornada entera
  sin conexión, que es el riesgo aceptado en `A-3`.
- **Sin ventana de gracia en la rotación:** el esquema cerrado establece que un
  token consumido no emite sucesor. **Consecuencia aceptada:** si se pierde la
  respuesta de una renovación, la sesión se revoca y hay que volver a entrar
  con contraseña. Introducir gracia exige reabrir `PHY-G02`.

Todos los valores son **configurables y versionados** (`security-gates.md`
§SEC-G02); los de esta tabla son los iniciales.

## 12. PIN de presencia: sin cambios

Confirmado por el propietario el 2026-09-26, en sesión, eligiendo «Lo genera
el sistema»: `DEC-012` §18.2 se mantiene íntegro. El PIN lo genera el sistema
por CSPRNG; el cajero no lo elige.

## 13. Implementación — autorizada el 2026-09-26

El propietario autorizó avanzar con la implementación el 2026-09-26, en
sesión («Autorizado avanza»).

### 13.1 Ubicación

`apps/api/src/authentication/`, trasladada con `git mv` desde
`apps/central-authority/src/authentication/`, donde se escribió primero,
tras la decisión `G-7` (§13.4). No en `packages/domain` ni
`packages/application`: `DEC-017` congeló sus áreas (`module-boundaries.json`,
`frozenSourceAreas`) y abrir `identity` ahí es lo que `architecture:check`
rechaza. `A-3` sitúa la verificación en la autoridad central.

### 13.2 Primer tramo — política pura (hecho)

Sin HTTP, sin base de datos y sin dependencia nueva. Cada cifra sale de un
único objeto versionado (`AUTHENTICATION_POLICY_VERSION = 1`).

| Fichero | Decisión |
|---|---|
| `authentication-policy.ts` | cifras de `A-4`, `A-5`, `A-8`, `A-10`; rol no ratificado → `UNDECIDED` |
| `password-policy.ts` | `A-5`; la lista de filtradas es un puerto |
| `login-throttle.ts` | `A-8` |
| `session-lifetimes.ts` | `A-10` |
| `password-hasher.ts` | scrypt `N=2^17, r=8, p=1` (OWASP, consultado 2026-09-26); trabajo equivalente para cuentas inexistentes |
| `temporary-password.ts` | `A-6` / `A-9` |

Pruebas: `apps/api/tests/authentication-policy.test.ts`.

### 13.3 Brechas medidas contra el esquema cerrado — requieren decisión

Contrastado con `tools/target-migrations/sql/postgres/001_central_foundation.up.sql`
el 2026-09-26. **Ninguna se resuelve por inferencia.** Las que cambian una
restricción de una migración cerrada exigen una migración nueva y autorización
expresa.

| Id | Brecha | Afecta a |
|---|---|---|
| `G-1` | `identity.users.email` es `NOT NULL` y único: un cajero sin correo **no puede existir** | `A-7` |
| `G-2` | No hay columna de nombre de usuario ni se ha decidido si es único en toda la plataforma o por comercio | `A-7` |
| `G-3` | `identity.user_credentials` no puede marcar «debe cambiarla en su primer ingreso» | `A-6`, `A-9` |
| `G-4` | Hay `failed_attempt_count` y `locked_until`, pero no la hora del último fallo que el backoff necesita | `A-8` |
| `G-5` | `sessions_device_deferred_ck` y `security_events_device_deferred_ck` obligan a `device_id IS NULL`, pero la SSA se ata al equipo | `A-3`, `DEC-012` |
| `G-6` | No existen códigos de recuperación, y `mfa_factors.secret_reference` presupone un almacén de secretos central que no existe | `A-4`, `A-9` |
| `G-7` | `central-authority` es un servidor HTTPS de Node sin framework; `ADR-005` fija NestJS + Fastify y el backend central está al 0 % (`stack-conformance-audit.md`) | dónde se sirve el login |
| `G-8` | Emitir SSA en línea exige la clave operacional privada **en el servidor**; hoy se firma fuera del repositorio (`DEC-025`) y el material publicado no parsea (`D-30`) | `A-3` |
| `G-9` | Fuente de la lista de contraseñas filtradas: lista local o servicio externo (que sería un tercero a declarar en `docs/legal/`) | `A-5` |

### 13.4 Resolución de brechas — ratificada el 2026-09-26

El propietario eligió, en sesión, la opción recomendada en cada una:

| Brecha | Decisión |
|---|---|
| `G-1`, `G-2` | **Nombre de usuario único por comercio** (`tenant`). El correo pasa a ser opcional. El cajero entra desde un POS enrolado, que ya conoce su comercio; los roles con MFA siguen entrando con correo (`A-7`). |
| `G-3`–`G-6` | **Autorizada la migración PostgreSQL 005**, sólo aditiva respecto de 001: marca de cambio obligatorio, hora del último fallo, códigos de recuperación, usuario por comercio, correo opcional y levantar la prohibición de `device_id` en sesión y eventos de seguridad. **No modifica 001**: la sustituye con restricciones nuevas en una migración nueva. |
| `G-7` | **Se crea la API central con NestJS + Fastify** (`ADR-005`). El login es su primer módulo y la capa de §13.2 se traslada allí. Los dos endpoints actuales de `central-authority` no se mueven en este tramo. |
| `G-8` | **La clave operacional de sesión vive como secreto en fichero del servidor**, fuera del repositorio. La raíz sigue fuera de línea con el propietario; si la operacional se compromete, se revoca y se reemite desde la raíz. |

`G-9` (fuente de la lista de contraseñas filtradas) **sigue abierta**.

### 13.5 Migración PostgreSQL 005 — escrita y probada

`tools/target-migrations/sql/postgres/005_identity_login.{up,down}.sql`, con
descriptor, runner y CLI propios siguiendo el protocolo de la 004. Sólo
PostgreSQL: la identidad es `CENTRAL_ONLY` y SQLite no recibe credenciales
(`foundation-schema.md`).

| Brecha | Cómo la cierra el esquema |
|---|---|
| `G-1` | `users.email` admite `NULL`; `users_email_pair_ck` impide medio correo |
| `G-2` | `identity.user_login_names`, único por comercio entre los activos, atado a la **membresía** con dos claves compuestas: no se puede dar un nombre de usuario en un comercio donde la persona no es miembro |
| `G-3` | `user_credentials.must_change_at_next_login` |
| `G-4` | `user_credentials.last_failed_at`; `user_credentials_failure_time_ck` exige la hora si hay fallos |
| `G-5` | se sustituyen `sessions_device_deferred_ck` y `security_events_device_deferred_ck` por claves foráneas a `identity.device_registry` (004) |
| `G-6` | `identity.mfa_recovery_codes`, sólo hash, estados de un solo uso |

Permisos: sólo `pos_platform_app`, por columna; `pos_app`, `pos_worker` y
`pos_platform_admin` sin acceso a las tablas nuevas.

**Evidencia, 2026-09-26, PostgreSQL 16.13 local:**
`tests/postgres-005-identity-login.test.ts` **11/11**. Aplica 001 y 002 con sus
runners y 004/005 como `pos_schema_owner`. Tres mutaciones (quitar
`users_email_pair_ck`, quitar la clave usuario–membresía, quitar la clave de
equipo en sesiones) hacen fallar la prueba cada una. La reversión se niega
mientras haya datos que 001 no admite (usuario sin correo, sesión con equipo)
y, sin ellos, devuelve las restricciones de 001. `pnpm test:postgres` completo:
165 pasan; los 2 ficheros de la 003 que fallan también fallan **antes** de este
cambio, porque su preparación de roles exige exactamente 16.14
(`postgres-003-role-readiness.ts:226`).

**Lo que no está probado aquí:** el **runner** de la 005, que exige el ledger
completo con 003 y PostgreSQL 16.14 exacto (igual que la 004). Queda como paso
del workflow `d3-live-security-e2e` tras la 004; su ejecución en CI no se ha
observado. Ninguna base de datos desplegada tiene la 005.

### 13.6 API central NestJS + Fastify — esqueleto (hecho)

`apps/api` (`@pos-platform/api`), capa `central-runtime`, registrada en
`module-boundaries.json`, en `pnpm typecheck` y en `pnpm test:runtime`.
NestJS 12.1.0 y Fastify 5.12.5 (vía `@nestjs/platform-fastify`), ambos ESM,
con Node ≥ 20.

- Escucha **sólo en `127.0.0.1`**, sin opción de configurarlo: TLS lo
  termina un proxy inverso (`DEC-024`, **todavía `PROPOSED`**). Si `DEC-024`
  cambia, esta frontera se revisa con ella.
- Tope de cuerpo de 16 KiB.
- Inyección con `@Inject(TOKEN)` explícito: `tsx` y `vitest` compilan con
  esbuild, que no emite `emitDecoratorMetadata`.
- Un único endpoint: `GET /v1/health` → `{ status: "UP" }`. **No hay endpoint
  de login todavía.**

Evidencia, 2026-09-26: `apps/api` **32/32** (4 de arranque —Fastify, salud,
404, 413— y las 28 de la política trasladada). Arrancado el proceso real con
`tsx src/main.ts`: por loopback `200`; por la IP del contenedor, conexión
rechazada. Las dependencias nuevas pasan inventario, SBOM, licencias (0 a
revisar, 0 denegadas) y auditoría de vulnerabilidades (0 avisos), tras
corregir el defecto de inventario que destaparon (`D-42`).

### 13.7 Motor de login por comercio — hecho, sin ruta HTTP

`TenantLoginService` + `PostgresTenantLoginStore` (`apps/api/src/authentication/`):
el login de `CASHIER` y `SUPERVISOR` por nombre de usuario (`A-7`).

- Un intento es **una transacción** con la credencial bloqueada
  (`SELECT … FOR UPDATE`): intentos simultáneos contra la misma cuenta se
  serializan y el contador de `A-8` no se esquiva en paralelo.
- Cuenta inexistente, persona inactiva y contraseña errónea responden igual
  (`REJECTED`), y en todas se hace el trabajo de scrypt.
- Contraseña temporal → `PASSWORD_CHANGE_REQUIRED`, **sin sesión** (`A-6`).
- Rol de administración → `MFA_REQUIRED`, **sin sesión**, hasta que exista el
  TOTP. Rol no ratificado → `ROLE_UNDECIDED`. Sin rol → `NO_ACTIVE_ROLE`.
- Éxito: sesión de 24 h y refresh de la misma vigencia (`A-10`), del que sólo
  se guarda el SHA-256; evento `LOGIN_SUCCEEDED` con comercio, sesión e IP.
- Se conecta como `pos_platform_app`, sin `BYPASSRLS`, y fija el comercio
  por conexión (`app.tenant_id`).

**Por qué no hay ruta HTTP todavía:** el comercio del cajero debe salir del
**equipo autenticado**, no de lo que escriba el cliente (`CLAUDE.md`,
principios no negociables). `DeviceTrustVerifier.verifyProof`
(`packages/device-trust`) verifica credencial + desafío + firma del equipo,
pero **ningún servidor emite ni consume esos desafíos**. Exponer la ruta antes
obligaría a aceptar el `tenant_id` del cliente.

**Evidencia, 2026-09-26, PostgreSQL 16.13 local:**
`apps/api/tests/tenant-login.postgres.test.ts` **7/7**, conectado como
`pos_platform_app` sobre 001 + 002 + 004 + 005. Tres mutaciones —quitar el
`FOR UPDATE`, no guardar el fallo, guardar el refresh en claro— hacen fallar la
prueba cada una. Queda en `pnpm test:migrations:postgres`, que CI ejecuta con
16.14.

**No resuelto en este tramo:** re-derivar un verifier con parámetros viejos
(`needsRehash`) exige insertar una credencial nueva y retirar la anterior —la
001 no concede `UPDATE (verifier)`— y queda para el tramo de cambio de
contraseña. Tampoco hay emisión de SSA ni SAS, ni access token.

### 13.8 Ruta HTTP del login — hecha, end-to-end real

Cierra la brecha de §13.7: `POST /v1/auth/device/challenge` y
`POST /v1/auth/login` en `apps/api/src/authentication/{auth.controller,
auth.module,auth.dto,device-login-verification,device-registry-reader,
device-challenge-store,in-memory-clock-guard}.ts`.

**El `tenant_id` sale del equipo, no del cliente**, exactamente como exigía
§13.7: el flujo es (1) el equipo pide un desafío dando sólo su `device_id`;
(2) el servidor busca ese `device_id` en `identity.device_registry` (el
registro real de la migración 004, sin invocar nada de
`apps/central-authority` — importar de otra app violaría límites de módulo,
así que `DeviceRegistryReader` repite el mismo `SELECT` de sólo lectura); (3)
el desafío que se emite lleva el `tenant_id`/`installation_id` **que dice el
registro**, nunca uno que el cliente pudiera declarar; (4) el equipo firma
ese desafío con su clave privada; (5) `DeviceTrustVerifier.verifyProof`
(`packages/device-trust`, ya existía, sin tocar) verifica la firma contra el
binding que vino del registro — un sobre fabricado con otro `tenant_id` no
encuentra clave que lo firme para ESE binding, y uno reciclado de otro equipo
falla por `CREDENTIAL_BINDING_MISMATCH`; (6) sólo entonces se llama a
`TenantLoginService.login({tenantId, ...})` con el usuario y la contraseña.

**Dos decisiones tomadas aquí mismo, no pedidas antes, documentadas como
tales:**

- **Desafíos de prueba de equipo, en memoria** (`DeviceChallengeStore`): un
  desafío usado no debería sobrevivir a un reinicio ni compartirse entre
  réplicas, y una tabla en PostgreSQL lo daría; se eligió memoria porque hoy
  hay un solo proceso de `apps/api` y ninguna alta disponibilidad que lo
  contradiga. Si eso cambia, se sustituye por una tabla sin cambiar el
  contrato (`issue`/`consume`).
- **Reloj monótono también en memoria** (`InMemoryClockGuard`), con la misma
  tolerancia de 5 minutos que `TrustedClockGuard` local (`DEC-012` §19.4),
  por la misma razón y la misma limitación.

Ambas quedan explícitas en el código y aquí, no escondidas, y son
reversibles sin romper el contrato de la clase que las usa.

**Evidencia, 2026-09-26, PostgreSQL 16.13 local:**
`apps/api/tests/device-login.postgres.test.ts` **6/6**, por HTTP real
(`Fastify.inject`, sin abrir puerto): equipo desconocido sin desafío; login
completo con firma de equipo real y contraseña real, sesión verificada en
`identity.sessions`; un desafío no se puede reutilizar; una prueba firmada
con una clave de equipo distinta se rechaza; una contraseña equivocada se
rechaza **después** de que el equipo ya verificó, no antes; un cuerpo mal
formado responde `400` sin tocar la base de datos. Mutación verificada:
quitar el borrado de un solo uso del desafío hace fallar exactamente esa
prueba y ninguna otra. `apps/api` completo (32 sin Postgres + 13 con
Postgres) y los gates de todo el monorepo (`typecheck`, `architecture:check`,
`ci:governance`, `ci:repository-policy`) en verde.

**No resuelto:** emisión de SSA/SAS para operación offline, access token de
10 min (`A-10` sólo entrega hoy sesión + refresh), y el login de roles de
administración —se rechaza con `MFA_NOT_ENROLLED`/`MFA_REQUIRED`, resuelto
en §13.9.

### 13.9 TOTP para roles de administración — hecho, con dos decisiones propias

Cierra la última pieza que `A-4` exigía: `GENERAL_ADMIN`, `BILLING_ADMIN`,
`SECURITY_ADMIN`, `OWNER` y `PLATFORM_OWNER` ya pueden iniciar sesión.

- `totp.ts`: RFC 6238 sobre RFC 4226 (HMAC-SHA1, 30 s, 6 dígitos), verificado
  contra los **6 vectores oficiales** del Apéndice B de RFC 6238 —si esta
  aritmética se desviara del estándar, ninguna app autenticadora real
  generaría códigos que este verificador acepte—. Ventana ±1 paso (±30 s de
  desfase de reloj del teléfono) y anti-repetición: un código, una vez
  aceptado, no vuelve a ser válido ni siquiera repetido en el mismo paso.
- `mfa-enrollment-service.ts`: enrolamiento por reautenticación con
  contraseña, no por sesión previa — el primer administrador de un comercio
  no puede tener una sesión que todavía no puede abrir. `POST
  /v1/auth/mfa/enroll` genera el secreto y lo muestra **una sola vez**;
  `POST /v1/auth/mfa/confirm` lo activa sólo tras un primer código válido.
- `tenant-login-service.ts`: dentro del login, un rol de administración pide
  el factor activo del usuario. Cuatro desenlaces, no dos: `MFA_NOT_ENROLLED`
  (nadie ha enrolado nada — antes se confundía con `MFA_REQUIRED`, que
  DEC-026 §13.7 usaba para «no existe TOTP», una razón distinta),
  `MFA_REQUIRED` (falta el código), `MFA_INVALID` (código incorrecto, cuenta
  como el mismo fallo que una contraseña equivocada contra el mismo
  contador de `A-8` — no hay columna de intentos propia en
  `identity.mfa_factors` y abrir una exigiría otra migración para una
  segunda barrera que la primera ya cubre) y `AUTHENTICATED` con sesión de
  **12 h**, no 24 (`A-10`; roles mixtos operador+administración se tratan
  como administración, la clase más estricta).

**Dos decisiones tomadas aquí, no pedidas antes, documentadas como tales:**

- **El secreto TOTP se cifra con AES-256-GCM y una clave simétrica del
  propio proceso** (`mfa-secret-cipher.ts`), en vez de guardarse en claro en
  `identity.mfa_factors.secret_reference` — la brecha `G-6` de §13.3 sigue
  abierta (no existe un almacén de secretos central), y cifrar aquí es la
  única alternativa a guardarlo en claro. Si `G-6` se resuelve, esta clase
  se sustituye sin tocar el resto del flujo.
- **El paso TOTP «ya usado» se deriva de `last_used_at`** en vez de añadir
  una columna propia: el paso de 30 s es determinista a partir de esa
  marca de tiempo, así que no hace falta ampliar la 001 ni escribir una
  migración nueva para esto.

**Evidencia, 2026-09-26, PostgreSQL 16.13 local:** `totp.test.ts` **15/15**,
incluidos los 6 vectores RFC. `tenant-login.postgres.test.ts` con el bloque
MFA añadido, **17/17** en conjunto: entra sin código pide `MFA_REQUIRED`;
con el código correcto entra con sesión de 12 h y `mfa_status=SATISFIED`;
un código con formato válido pero incorrecto cuenta como intento fallido
del mismo contador que la contraseña; el mismo código no sirve dos veces;
sin ningún factor activo se rechaza como `MFA_NOT_ENROLLED`, nunca como
`MFA_REQUIRED`. Mutación verificada dos veces: quitar la comprobación
anti-repetición hace fallar exactamente esas dos pruebas de repetición;
forzar la clase `OPERATOR` siempre hace fallar exactamente las cinco
pruebas de administración/MFA. `apps/api` completo, 32 con PostgreSQL + 47
sin, y los gates de todo el monorepo en verde.

**No resuelto:** el propio endpoint `/v1/auth/mfa/enroll`/`/confirm` no
tiene todavía una prueba end-to-end por HTTP real (las pruebas de MFA
ejercen `TenantLoginService`/`MfaEnrollmentService` directamente, no la
ruta HTTP); revocar un factor MFA (perder el teléfono) no tiene endpoint;
códigos de recuperación de un solo uso (`A-9`, `PLATFORM_OWNER`) siguen sin
implementar — la migración 005 ya tiene la tabla (`identity.
mfa_recovery_codes`), falta el código.

### 13.10 Emisión de sesión local en el login — hecha (Fase 1, tramo central)

Pedido por el propietario el 2026-09-28 («construye todos los login de los
roles… estás autorizado»), dentro de la autorización de §13. Cierra la primera
brecha de §14: **emitir SSA/SAS para operar offline**.

- **`POST /v1/auth/login` devuelve `operator_session`**: el mismo artefacto de
  dos sobres de `DEC-025` (`OperatorSessionProvisioningArtifact`), firmado en
  el momento. El POS lo activa por la ruta que ya verifica ese artefacto; no
  hay un segundo camino de activación.
- **Ligado al equipo probado**: `installation_id`/`device_id` salen de la
  prueba de equipo verificada contra el registro (§13.8), nunca del cuerpo.
- **SSA** (`DEC-012`): `session_id` = la sesión central recién abierta,
  `user_id`, `tenant_membership_id`. **SAS** (`DEC-011`): proyección completa de
  las asignaciones de rol **vigentes** de la membresía con las concesiones
  vigentes de cada rol (`authorization.*` de la 001), una asignación por
  ámbito. Si dos roles coinciden en ámbito se unen: permisos sumados
  (`ACTIVE` gana a `RETIRED`) y vigencia **intersección**, nunca unión —no se
  concede nada fuera de la vigencia de un rol que lo aporta—.
- **Una clave por propósito** (`D-31`): la SSA y el SAS se firman con claves
  distintas; el servidor se niega a arrancar con el mismo `key_id` para ambas.
  Claves privadas desde **fichero** (`*_SIGNING_KEY_FILE`), nunca desde
  variable; las cuatro variables juntas o ninguna. Sin ellas el login central
  sigue funcionando y `operator_session` es `null`.
- **Vigencia**: SAS = mínimo entre 24 h (`DEC-011`, `authorizationSnapshotMs`)
  y la sesión (24 h operador / 12 h administración, `A-10`); la SSA vence con
  el SAS (`DEC-012` §19). La sesión central guarda `device_id` y
  `offline_valid_until` (`UC-AUTH-001` paso 8).
- **Secuencia**: `identity.session_trust_sequence`, **migración PostgreSQL
  006** (sólo una secuencia y su `USAGE` para `pos_platform_app`; sin tablas).
  `DEC-011` deja la monotonía al emisor: una secuencia global crece para todo
  binding; un rollback no la devuelve.

**Evidencia, 2026-09-28, PostgreSQL 16.13 local:**
`postgres-006-session-trust-sequence.test.ts` **5/5** (crece estrictamente, un
rollback no la repite, `pos_platform_app` no puede `setval` ni `RESTART`, la
reversión la retira). `operator-session.postgres.test.ts` **5/5** por HTTP real:
SSA y SAS verifican cada uno con su clave y **no** con la del otro; binding al
equipo probado; permisos por ámbito con concesión retirada excluida; secuencia
creciente entre logins; sesión central con `device_id` y `offline_valid_until`;
una asignación revocada desaparece del SAS del siguiente login.
`operator-session-issuer.test.ts` **8/8** sin base de datos; **mutaciones
verificadas**: vigencia por unión en vez de intersección, y `RETIRED` que pisa
a `ACTIVE` según el orden, fallan cada una. `apps/api` completo: 55 sin
PostgreSQL + 22 con PostgreSQL.

**No resuelto en este tramo:** que el POS pida el login y active los sobres
(tramo local), la pantalla de login y el laboratorio en el PC físico. La
aceptación de estos sobres por el verificador real del POS la prueba la E2E de
la ventana, no esta prueba.

### 13.11 Login en el POS y en la ventana — hecho (Fase 1, tramo local)

Mismo pedido que §13.10. El POS consume lo que §13.10 emite.

- **Enrolamiento del equipo al arrancar** (`D-3`, `security/device-enrollment-runner.ts`).
  Con `POS_CENTRAL_AUTH_URL` (sólo `https`) y las claves públicas de confianza
  de equipo configuradas, el servicio prepara la petición firmada
  (`DeviceEnrollmentService`), la envía a `/v1/device-enrollment` y **verifica**
  la credencial devuelta contra la raíz y la clave operativa configuradas antes
  de guardarla. Sin enrolar el servicio sigue arrancando; lo único que no puede
  es iniciar sesión nueva (`DEVICE_NOT_ENROLLED`). Se reintenta cada 15 s
  mientras la autoridad no responda a `GET /health`: preparar deja un asiento
  `PENDING` que no se reenvía, así que sólo se prepara cuando hay a quién
  enviarlo. `NOT_READY` y `REJECTED` no se reintentan: exigen una activación
  nueva.
- **Identidad pública del equipo en disco** (`device-public-identity.json`,
  `DEC-020` §6): la única vía por la que el registro central conoce la clave
  pública que el enrolamiento compara. Sólo datos públicos.
- **`session.login`** (IPC, contrato `SessionLoginRequestSchema`/`SessionLoginResultSchema`):
  `CentralLoginClient` pide desafío con el `device_id`, comprueba que el
  desafío es para esta instalación y este equipo, lo firma con la clave del
  equipo y envía credencial, prueba, usuario, contraseña y TOTP. La respuesta
  se activa por `activateOperatorSessionArtifact` —SSA y SAS verificados contra
  los anclajes por propósito—, la misma ruta del artefacto de `DEC-025`. No hay
  segundo camino de activación. La contraseña no se registra en ningún log.
- **Desenlaces cerrados** (14): los de la autoridad pasan tal cual
  (`REJECTED`, `THROTTLED`, `MFA_REQUIRED`, …); los del POS son
  `DEVICE_NOT_ENROLLED`, `DEVICE_REJECTED`, `CENTRAL_UNREACHABLE`,
  `SESSION_NOT_ISSUED` y `SESSION_REJECTED`. Un código que el POS no conoce se
  rechaza nombrándolo; nunca se convierte en éxito.
- **`session.end`** cierra la sesión **de forma durable**: SQLite
  `MIGRATION_036` crea `local_session_end`, append-only (disparadores que
  impiden `UPDATE`/`DELETE`), y `loadActiveByDevice` excluye las sesiones
  cerradas. Una sesión cerrada no se recupera al reiniciar.
- **Ventana**: pantalla de login (usuario, contraseña y, cuando la autoridad lo
  pide, código TOTP) y botón **Salir**. La compuerta sólo se activa cuando el
  proceso principal abre el renderer con `?login=required`
  (`POS_DESKTOP_REQUIRE_LOGIN=1` o `central_login: true` en el
  aprovisionamiento de laboratorio). Sin ella el comportamiento anterior no
  cambia: el contrato `RuntimeStatus` está cerrado y las E2E existentes siguen
  intactas. Un usuario inexistente y una contraseña equivocada muestran el
  mismo mensaje.

**Evidencia, 2026-09-28 (Linux, este entorno):** `operator-login.test.ts`
**10/10**, `device-enrollment-runner.test.ts` **4/4**, pruebas de migración
SQLite con 36 migraciones, `LoginGate.test.tsx` y listas ratificadas del
escritorio. `pos-local-service` completo **1076** pruebas, escritorio **255**.

**`IMPLEMENTED`, no `TESTED`:** el cableado de `main.ts` (bucle de reintento
del enrolamiento incluido). La E2E de §13.12 usa un anfitrión
(`e2e-host/real-service-host.ts`) que replica ese cableado con las mismas
piezas; el propio `main.ts` sólo se verifica arrancando el servicio en
Windows, que no se ha hecho con login central.

### 13.12 Laboratorio central y prueba de extremo a extremo — hecho

- **`apps/api/lab/lab-central.ts`** (`setup`, `serve`, `register-device`):
  levanta, sobre un PostgreSQL local, las migraciones 001–006, un comercio con
  sede, los roles `CASHIER`, `SUPERVISOR` y `GENERAL_ADMIN` con las concesiones
  de los repartos de ejemplo (`DEV_ROLE_PRESETS`, leídos de su única fuente),
  tres usuarios (`cajero`, `supervisor`, `admin` con TOTP), claves Ed25519 por
  propósito, certificado TLS propio, y sirve la API, la `central-authority` y
  una pasarela HTTPS única. Con `--watch-device` registra el equipo en cuanto
  aparece su identidad pública y emite la activación. **Es herramienta de
  laboratorio**: usa el superusuario de la base (RLS no ejercida), la
  credencial de equipo dura un año y los usuarios no son cuentas reales.
- **`apps/pos-desktop/e2e/central-login.spec.ts`**: Electron real ⇄ canal real
  ⇄ servicio local real ⇄ pasarela HTTPS ⇄ API y autoridad reales ⇄
  PostgreSQL. Sin PostgreSQL se salta y lo dice.

**Evidencia, 2026-09-28, PostgreSQL 16.13 local, `xvfb`:** **6/6**. (1) sin
sesión la ventana pide login y no monta el POS; (2) contraseña equivocada y
usuario inexistente dan el mismo mensaje; (3) el cajero entra y el alta de
producto devuelve `UNAUTHORIZED`; (4) **Salir** vuelve al login y la sesión
cerrada no reaparece; (5) el supervisor da de alta el producto
(`REGISTERED`); (6) el administrador recibe `MFA_REQUIRED` y entra con el
código TOTP. **Mutación verificada:** dar al cajero el reparto del supervisor
en la semilla hace fallar (3). Suite E2E completa del escritorio **27/27**.
En CI la ejecuta el job `validate` de `target-foundation-validation.yml`, que
tiene PostgreSQL; esa ejecución no se ha observado todavía.

**No resuelto:** renovación de la credencial de equipo; desfase de reloj entre
central y POS (el SAS se evalúa con el reloj confiable del POS); el
laboratorio en el PC físico del propietario (`F1.4`); la política por rol de
`SEC-G03` —los repartos son de ejemplo, no la política—.

## 14. Qué sigue abierto

- Las diez decisiones de política están ratificadas. Cajero, supervisor **y**
  administración tienen login real, `END_TO_END` hasta la sesión persistida
  (§13.8, §13.9): `TESTED` en este entorno, contra PostgreSQL local, no
  `PRODUCTION_READY` — ninguna instancia central está desplegada. `SEC-G02`
  sigue `PLANNED / NOT_EVALUATED` en conjunto: falta recuperación de cuenta
  (`A-9`) y revocar un factor MFA. La emisión de SSA/SAS está hecha en el lado
  central (§13.10) y el POS la consume con pantalla de login y salida
  (§13.11), probado de extremo a extremo contra el laboratorio central
  (§13.12).
- `G-1`–`G-8` tienen decisión (§13.4) e implementación (§13.5, §13.6, §13.8,
  §13.9). `G-9` sigue abierta.
- `central-authority` no compila en modo estricto por errores anteriores a
  este cambio, y ninguna puerta lo detecta: `D-41`.

## 15. Referencias

- `DEC-012` §13, §16, §18, §19.
- `DEC-011` (TTL del SAS).
- `DEC-025` (aprovisionamiento de sesión, no autenticación).
- `docs/security/security-gates.md` §SEC-G02.
- `docs/use-cases/auth/UC-AUTH-001-login.md`.
- `D-28` en `docs/governance/materialization-state.md`.

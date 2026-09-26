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

`apps/central-authority/src/authentication/`. No en `packages/domain` ni
`packages/application`: `DEC-017` congeló sus áreas (`module-boundaries.json`,
`frozenSourceAreas`) y abrir `identity` ahí es lo que `architecture:check`
rechaza. `A-3` sitúa la verificación en la autoridad central, y
`central-authority` es la única aplicación central que existe.

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

Pruebas: `apps/central-authority/tests/authentication-policy.test.ts`.

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

## 14. Qué sigue abierto

- Las diez decisiones de política están ratificadas. **El tramo de §13.2 está
  `TESTED`; nada más.** No hay endpoint de login, ni persistencia, ni emisión
  de SSA. `SEC-G02` sigue `PLANNED / NOT_EVALUATED`.
- `G-1`–`G-8` tienen decisión (§13.4) pero no implementación. `G-9` sigue
  abierta.
- `central-authority` no compila en modo estricto por errores anteriores a
  este cambio, y ninguna puerta lo detecta: `D-41`.

## 15. Referencias

- `DEC-012` §13, §16, §18, §19.
- `DEC-011` (TTL del SAS).
- `DEC-025` (aprovisionamiento de sesión, no autenticación).
- `docs/security/security-gates.md` §SEC-G02.
- `docs/use-cases/auth/UC-AUTH-001-login.md`.
- `D-28` en `docs/governance/materialization-state.md`.

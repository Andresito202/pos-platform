# DEC-026 — `SEC-G02`: factores de autenticación del operador

## Estado

`PROPUESTA`, en ratificación por partes. Cada decisión se registra aquí
**cuando el propietario la ratifica**, con su fecha; ninguna se completa por
inferencia (`DEC-012` §13).

| Id | Decisión | Estado |
|---|---|---|
| `A-1` | Factor primario de inicio de sesión | **RATIFICADO** 2026-09-26 (§2) |
| `A-2` | Reautenticación dentro del turno | **YA RATIFICADO** en `DEC-012` §18 — se reconcilia en §3, no se redecide |
| `A-3` | ¿El login con contraseña exige conexión con la autoridad central? | **RATIFICADO** 2026-09-26 (§4) |
| `A-4` | Alcance de MFA por rol | **RATIFICADO** 2026-09-26 (§5), con `A-4.1` pendiente |
| `A-5` | Longitud mínima y política de contraseña | **RATIFICADO** 2026-09-26 (§6) |
| `A-6` | Alta de cuenta y contraseña inicial | **RATIFICADO** 2026-09-26 (§7) |
| `A-7` | Identificador de inicio de sesión (correo, usuario, código de empleado) | pendiente |
| `A-8` | Bloqueo y limitación de intentos de contraseña | pendiente |
| `A-9` | Recuperación de cuenta | pendiente |
| `A-10` | Duración y rotación de access/refresh token | pendiente |

## Qué NO es

- **No cierra `SEC-G02`** ni le sube un peldaño: sigue `PLANNED / NOT_EVALUATED`
  en `docs/product/backlog.md` hasta que exista implementación y la evidencia
  que exige `docs/security/security-gates.md` §SEC-G02.
- **No autoriza implementar.** Fija política; la implementación del login
  necesita, además, las decisiones pendientes de la tabla y autorización
  expresa.
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

`A-4.1` **pendiente:** la respuesta nombró superadministrador, dueño y
administrador. `BILLING_ADMIN`, `SECURITY_ADMIN` y cualquier otro rol de
`roles.md` no citado aquí **no se asignan por inferencia**; requieren
ratificación. El vínculo definitivo rol → permisos sigue siendo de `SEC-G03`.

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

Queda para `A-9` (recuperación) si una contraseña olvidada se resuelve por
este mismo camino.

## 8. Referencias

- `DEC-012` §13, §16, §18, §19.
- `DEC-011` (TTL del SAS).
- `DEC-025` (aprovisionamiento de sesión, no autenticación).
- `docs/security/security-gates.md` §SEC-G02.
- `docs/use-cases/auth/UC-AUTH-001-login.md`.
- `D-28` en `docs/governance/materialization-state.md`.

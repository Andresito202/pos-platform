# DEC-026 — `SEC-G02`: factores de autenticación del operador

## Estado

`PROPUESTA`, en ratificación por partes. Cada decisión se registra aquí
**cuando el propietario la ratifica**, con su fecha; ninguna se completa por
inferencia (`DEC-012` §13).

| Id | Decisión | Estado |
|---|---|---|
| `A-1` | Factor primario de inicio de sesión | **RATIFICADO** 2026-09-26 (§2) |
| `A-2` | Reautenticación dentro del turno | **YA RATIFICADO** en `DEC-012` §18 — se reconcilia en §3, no se redecide |
| `A-3` | ¿El login con contraseña exige conexión con la autoridad central? | pendiente |
| `A-4` | Alcance de MFA por rol | pendiente |
| `A-5` | Longitud mínima y política de contraseña | pendiente (depende de `A-4`) |
| `A-6` | Alta de cuenta y contraseña inicial | pendiente |
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

## 4. Referencias

- `DEC-012` §13, §16, §18, §19.
- `DEC-011` (TTL del SAS).
- `DEC-025` (aprovisionamiento de sesión, no autenticación).
- `docs/security/security-gates.md` §SEC-G02.
- `docs/use-cases/auth/UC-AUTH-001-login.md`.
- `D-28` en `docs/governance/materialization-state.md`.

# Propuesta ordenada — integración SSA/SAS Central (POS)

Fecha: 2026-11-23  
Rama visual de referencia: `cursor/commercial-login-form-c53a` (`3d1da5aa`+)  
Alcance: **propuesta solamente**. No implementar en la rama visual del login.

## Objetivo

Completar el camino comercial firmado:

`autenticación BUSINESS humana (+ MFA) → emisión SSA → session.activate → adquisición SAS → authorization.capabilities.get → paneles autorizados`

sin usar `local-operator-development-bridge` ni `POS_LOCAL_OPERATOR_AUTH_STORE` en producción, y sin debilitar SCM (PR #127).

## Inventario de contratos existentes

| Artefacto | Ubicación | Rol |
|---|---|---|
| `SignedSessionAssertion` | `packages/contracts` session-assertion | SSA Ed25519 |
| `SignedAuthorizationSnapshot` | `packages/contracts` authorization-snapshot | SAS |
| IPC `session.activate` / `session.recover` / `authorization.capabilities.get` | `ipc-commercial` + allowlist desktop | Frontera POS |
| Possession paths `/v1/business-session/assertions` y `/authorization` | `device-trust` + `CommercialDeviceCredentialProvider` | Firma de posesión del dispositivo |
| Trust purpose `SESSION_ASSERTION` (G1.2) | `session-trust` + Central publication `/v1/session-trust` | Claves públicas para verificar SSA |
| `SessionActivationService` + store SQLite | `pos-local-service` | Activate/recover locales |
| `SnapshotAcquisitionService` (SAS-003) | `pos-local-service` | Adquisición genérica (sin provider HTTP) |
| `BusinessBrowserSessionIssuer` | `central-authority` | Cookie BUSINESS **web** (no SSA Electron) |

## Endpoints / piezas ausentes

1. **Emisor HTTP de SSA POS** en Central: no existe handler montado para `POST /v1/business-session/assertions` que emita `SignedSessionAssertion` tras login humano + posesión de dispositivo.
2. **Emisor/entrega HTTP de SAS** para `POST /v1/business-session/authorization`.
3. **`SnapshotProvider` productivo** (HTTP) e instancia de `SnapshotAcquisitionService` en `main.ts` (`DEC-020` lo bloquea sin API real).
4. **SEC-G02** — login humano POS (password/MFA/bloqueo) sigue `NOT_EVALUATED` en ADR; `BusinessBrowserSessionIssuer` no lo sustituye.
5. **Cliente desktop** que, tras emisión legítima, transporte SSA a `session.activate` (renderer no firma).

## Dependencias con SCM (PR #127)

- Canal Windows / handoff SCM debe seguir siendo la frontera de transporte autenticado.
- Device Trust / custody OS_BOUND es requisito de posesión comercial; no sustituible por secreto de desarrollo.
- Cualquier contrato compartido con handoff/SCM **no** se altera desde la rama visual; si hiciera falta un campo nuevo, se documenta y se coordina en la línea SCM sin incompatibilidad silenciosa.
- No levantar `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` simulando progreso.

## Orden de implementación recomendado (otra línea, no esta rama)

### Fase 0 — Decisiones (bloqueo de gobierno)
- Ratificar SEC-G02 / emisor SSA POS: factores MFA, audiencia, `offline_valid_until`, binding installation/device/caja.
- Fijar contrato request/response de assertions y authorization (además de las paths de possession ya tipadas).

### Fase 1 — Central (código)
1. Handler `POST /v1/business-session/assertions`: autentica operador BUSINESS + MFA; exige possession Device Trust; emite SSA firmada con operational key `SESSION_ASSERTION`.
2. Handler `POST /v1/business-session/authorization`: entrega SAS firmado acotado a tenant/company/branch/device.
3. Revocación/caducidad alineadas con stores Central y replay verifier existente.
4. Pruebas negativas: SSA inválida, empresa ajena, sin Device Trust, MFA ausente.

### Fase 2 — Local Service (código)
1. Implementar `SnapshotProvider` HTTP contra Central (con possession).
2. Montar `SnapshotAcquisitionService` en `main.ts` solo cuando Central + trust estén configurados.
3. Conservar fail-closed si el mapa de trust está vacío.
4. No habilitar store local de operadores en producción.

### Fase 3 — Desktop (código, tras 1–2)
1. Tras credenciales humanas autorizadas (flujo Central), recibir SSA solo por canal confiable (servicio local).
2. Llamar `session.activate` con el artefacto; luego `authorization.capabilities.get`.
3. Mantener el **mismo** formulario visual; sin segundo login.
4. Recuperación: `session.recover` ya cableado en `useAuthorizationCapabilities`.

### Fase 4 — Certificación física Windows
- SCM real, Device Trust enrolado, trust bundle, emisión Central real.
- E2E cuatro roles + negativos.
- Capturas solo con sesión firmada.

## Qué se puede completar por código antes de la certificación física

| Trabajo | ¿Antes de PC físico? | Nota |
|---|---|---|
| Contratos Zod request/response SSA/SAS HTTP | Sí | Sin claves de producción |
| Handlers Central + tests con keys de laboratorio aisladas | Sí | Keys fuera de artefactos comerciales |
| SnapshotProvider HTTP + montaje condicional | Sí | Contra Central de laboratorio |
| Desktop activate tras SSA de laboratorio | Sí | No en rama visual; no smoke-entry |
| Interop SCM + DPAPI + enrollment real | **No** | Requiere Windows objetivo |
| Declarar PRODUCTION / certificación | **No** | Exige evidencia física |

## Qué no hacer en la rama visual del login

- No inventar emisor SSA local.
- No promover el bridge de desarrollo.
- No abrir PR de integración SSA desde esta rama.
- No modificar PR #127.
- Conservar el login aprobado como superficie única cuando llegue la integración comercial.

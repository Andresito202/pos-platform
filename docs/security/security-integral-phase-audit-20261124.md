# Fase integral de ciberseguridad — auditoría inicial (2026-11-24)

## Alcance y reglas

Autorización expresa del propietario: ciberseguridad, antifraude, antipiratería e ingeniería inversa.

Repositorios auditados:

| Repo | Visibilidad (GitHub API) | PRs inspeccionados |
|---|---|---|
| `Andresito202/pos-platform` | **public** | `main` (`d69587cc`), PR #135 (`36947f48`), PR #136 (`8b99cffc`) |
| `Andresito202/camacho-pos-comercial` | **public** | PR #1 (`cf4276d9`) |

Reglas de esta fase:

- Reutilizar controles existentes; no duplicar.
- No debilitar seguridad para pasar CI.
- No simular certificaciones físicas Windows/M60WL (reservadas).
- No habilitar cobros reales; no merge a `main`; no apps paralelas.
- Claims: `DOCUMENTED` / `IMPLEMENTED` / `TESTED` sólo con evidencia de este entorno. `SEC-G01..G10` permanecen `NOT_EVALUATED` hasta cierre de gate.

Base de trabajo de evidencia/código transversal: rama `cursor/security-integral-phase-c53a` (desde `codex/scm-real-integration-20261122`). Controles Android específicos de producto comercial se continúan en PR #136. Portal comercial en PR #1 / `camacho-pos-comercial`.

## Inventario por bloque (estado observado)

### 1 — Web / API / autenticación

| Control | Ubicación | Estado | Gap residual |
|---|---|---|---|
| Rate limit proceso | `apps/central-authority/src/fixed-window-rate-limiter.ts` | IMPLEMENTED + tests locales históricos | **No durable** (memoria); reinicio/multi-instancia resetea presupuesto |
| MFA WebAuthn GLOBAL/BUSINESS | Central business/global runtimes; PR #135/#136 composition | IMPLEMENTED (código); login humano conectado **no** RUNTIME_VERIFIED aquí | Turnstile/bots ABSENT; stuffing depende de rate limit + MFA |
| CSRF browser commercial | Origin + Fetch Metadata en `isolated-commercial-https` (PR #136) | IMPLEMENTED en composición | N/A portal hasta verificar PR #1 |
| Zod / input fail-closed | contracts + IPC Android/Electron | IMPLEMENTED / TESTED en suites | Cobertura endpoint-completa SEC-G08 abierta |
| Tenant ID no autoridad | config/contexto; RLS PoC PHY-G14 | Parcial | SEC-G01 NOT_EVALUATED (falta suite API stack objetivo) |
| DeviceProof / replay native | device-trust + native requests | IMPLEMENTED | Enrolamiento físico pendiente |
| Webhooks Factus Pay | factus-pay-runtime + rate limit | IMPLEMENTED | Sandbox real no ejecutado aquí |
| Secretos en Git | política + gates CI | DOCUMENTED + CI | Privatización repos pendiente (no cambiar visibilidad aún) |
| Turnstile / bot | — | **ABSENT** | Añadir en portal comercial (PR #1) cuando egress/secretos existan |
| HTTPS TLS Central | min TLSv1.2, verify identity | IMPLEMENTED | WAF/DDoS = infra externa BLOCKED |

### 2 — Windows / Electron

| Control | Ubicación | Estado | Gap residual |
|---|---|---|---|
| contextIsolation / sandbox / no nodeIntegration | `apps/pos-desktop/src/window-security.ts` | IMPLEMENTED + TESTED | — |
| IPC allowlist + preload API | `ipc-allowlist.ts`, `preload.ts` | IMPLEMENTED + TESTED | — |
| DPAPI / OS_BOUND | WindowsDpapiKeyProvider | IMPLEMENTED | Certificación física SCM reservada |
| Electron Fuses / ASAR integrity | `electron-builder.yml` | **ABSENT → remediar en esta fase** | Firma Authenticode RT-009-B BLOCKED |
| Ofuscación selectiva | — | ABSENT | Bajo riesgo vs integridad+firma; residual |
| Detección clonación instalación | Device Trust + LicenseCapacity | Parcial | Clone físico + restore: SEC-G04 abierto |
| Updates autenticadas | — | BLOCKED | Requiere canal update firmado |

### 3 — Android

| Control | Ubicación | Estado | Gap residual |
|---|---|---|---|
| Keystore custody | AndroidKeystoreKeyProvider (PR #136) | IMPLEMENTED | — |
| App Links / DAL | prep NOT_PUBLISHED; guía API 28 | DOCUMENTED + prep | Publicación DAL + verify OS M60WL |
| DeviceProof native | AndroidBusinessNativeCentralClient | IMPLEMENTED + unit TESTED | Enrolamiento físico |
| R8/ProGuard | commercialApk D8 path | Parcial (minify no productizado) | Evaluar sin romper Node assets |
| Root / Frida / debug detection | — | **ABSENT** | Añadir fail-closed en autoridad BUSINESS (PR #136), sin romper venta offline ya autorizada |
| Integridad APK + runtime Node | files.json digests + operational boundary | Parcial | Runtime attestation host-side pendiente |
| Play Integrity | — | N/A obligatorio | Mantener path sin Play (M60WL) |

### 4 — Antipiratería

| Control | Ubicación | Estado | Gap residual |
|---|---|---|---|
| Capacidad firmada + LicenseCapacityGate | local-service | IMPLEMENTED + TESTED (incl. PR #135 trial 120h / grace 0) | — |
| Clock rollback | TrustedClockGuard | IMPLEMENTED | — |
| Trial reuse / reinstall | installation identity + gate | Parcial | Matriz SEC-G04 reinstall/restore |
| Claves privadas Central | managed files fuera de Git | DOCUMENTED | Prep firma comercial Win/Android **sin** publicar privados |
| Binding dispositivo/empresa/caja | DeviceTrust + SAS/SSA | IMPLEMENTED en composición | RUNTIME_VERIFIED físico pendiente |

### 5 — Antifraude

| Control | Ubicación | Estado | Gap residual |
|---|---|---|---|
| Append-only financiero/inventario/audit | stores SQLite + contracts | IMPLEMENTED | Señales antifraude operativas SEC-G06 abiertas |
| SoD / permisos backend | deny-by-default commercial handler | Parcial | Matriz RBAC completa SEC-G03 |
| Cross-tenant | IDs no autoridad + RLS PoC | Parcial | Suite API cross-tenant |
| FACTUS Pay / Nequi / Bre-B fraude | adapters + webhooks | Parcial | Sandbox/producción no acreditados aquí |
| Caja / devoluciones / precios | domain use cases | IMPLEMENTED | Pruebas negativas fraude nuevas sólo si gap |

### 6 — Datos / infraestructura / supply chain

| Control | Ubicación | Estado | Gap residual |
|---|---|---|---|
| CycloneDX SBOM | `pnpm ci:sbom` + workflow | IMPLEMENTED en CI | — |
| Provenance exact-head | tools/ci provenance | IMPLEMENTED en CI | — |
| CodeQL / Strix | workflows | DOCUMENTED / CI parcial | Strix requiere secretos |
| Backup/restore | docs + PoC parcial | DOCUMENTED | DR medido BLOCKED |
| WAF / DDoS / firewall | — | BLOCKED (infra) | — |
| Exposición código | ambos repos **public** | OBSERVED | Checklist privatización (sin cambiar visibilidad) |

### 7 — SEC-G01..G10

Estado documental vigente (`docs/security/security-gates.md`): **PLANNED / NOT_EVALUATED** para todos.

Esta fase **no** promueve ningún gate a PASS. Entrega matriz amenaza/control/prueba/resultado/riesgo residual con evidencia parcial y gaps explícitos.

## Decisiones de remediación (sin duplicar)

1. **Electron Fuses + ASAR integrity** — implementar en pos-desktop (gap claro).
2. **Rate limit durable** — diseño + implementación mínima durable (PostgreSQL o store existente) sin segundo limiter paralelo.
3. **Android integrity / anti-tamper** — en PR #136, fail-closed para BUSINESS, compatible API 28, sin Play obligatorio.
4. **Portal Turnstile** — en camacho-pos-comercial cuando secreto/egress existan; si no, DOCUMENTED residual.
5. **Prep firma comercial + privatización** — documentación operativa sin claves privadas ni cambio de visibility.
6. **Pruebas negativas** — sólo controles nuevos/deficientes; no repetir suites ya PASS de #135/#136.

## Evidencia de comandos (actualizada por bloque)

Se registra en `docs/security/security-integral-phase-evidence-20261124.md` y en el canvas de matriz.

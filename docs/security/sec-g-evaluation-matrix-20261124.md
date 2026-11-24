# Matriz SEC-G01..G10 — evaluación 2026-11-24 (actualizada)

Fuente de contrato: `docs/security/security-gates.md`.  
Regla: **ningún gate se declara PASS** en esta fase.

Leyenda de buckets:

- **Probado (código)**: prueba negativa/control ejecutada en este entorno o CI exact-HEAD.
- **Infra pendiente**: Turnstile, WAF, privatización, secret manager, DNS/TLS de campo.
- **Físico pendiente**: Windows Authenticode, M60WL device lab, Play signing productivos.

| Gate | Amenaza principal | Control | Probado (código) | Infra pendiente | Físico pendiente | Estado gate |
|---|---|---|---|---|---|---|
| SEC-G01 | Cross-tenant IDOR/BOLA | TenantContext; sale cross-tenant; cash register company scope | sale cross-tenant; cash OTHER_COMPANY → REGISTER_NOT_FOUND (antifraud 2026-11-24) | API stack cross-tenant suite completa | — | NOT_EVALUATED |
| SEC-G02 | Fuerza bruta / sesión | Postgres rate limit (035) + MFA existing | postgres limiter 4 PASS; durable flush 6 PASS | Multi-edge Turnstile/WAF | Login humano físico | NOT_EVALUATED |
| SEC-G03 | Escalada privilegios | Deny-by-default; SoD permissions | payment/cash UNAUTHORIZED suites existentes (no re-run) | Matriz RBAC atómica completa | — | NOT_EVALUATED |
| SEC-G04 | Clonación / trial / reloj | LicenseCapacityGate; TrustedClockGuard; DeviceProof; AndroidRuntimeIntegrity | Reuso #135/#136 (no re-ejecutada aquí) | — | Reinstall/clone físico; M60WL | NOT_EVALUATED |
| SEC-G05 | Replay / integridad local | Outbox checksum; DeviceProof; files.json | android-runtime-integrity en #136 | Transporte real | — | NOT_EVALUATED |
| SEC-G06 | Fraude operativo | Append-only; frozen sale prices; cash expected ignores forged rows | antifraud: price freeze PASS; company boundary PASS | Alertas operativas | — | NOT_EVALUATED |
| SEC-G07 | Secretos / crypto | DPAPI/Keystore; signing prep; no private keys in Git | Docs + fuses tests previos | Secret manager release | Authenticode/Play | NOT_EVALUATED |
| SEC-G08 | API/webhook abuse | Postgres atomic rate; portal header webhook (#1) | Central postgres limiter; portal CI SUCCESS @ 28b1803 | Edge WAF | — | NOT_EVALUATED |
| SEC-G09 | Supply chain / backup | SBOM + provenance CI; portal SCA critical | Portal #1 audit critical exit 0 | DR medido; privatización repos | — | NOT_EVALUATED |
| SEC-G10 | Release inseguro | Fuses; optional R8; signing prep | electron-fuses previos; R8 prep on PR #138 | — | Release gate físico Windows/M60WL | NOT_EVALUATED |

## Conclusión

Controles resolubles por código avanzaron (Postgres rate limit, antifraud negatives, R8 prep, CI SCM-base).  
`SEC-G01..G10` permanecen `PLANNED / NOT_EVALUATED`. Certificación física expresamente fuera de alcance.

# Matriz SEC-G01..G10 — evaluación 2026-11-24

Fuente de contrato: `docs/security/security-gates.md`.  
Regla: **ningún gate se declara PASS** en esta fase.

| Gate | Amenaza principal | Control reutilizado / añadido | Prueba (esta fase) | Resultado | Riesgo residual | Estado gate |
|---|---|---|---|---|---|---|
| SEC-G01 | Cross-tenant IDOR/BOLA | IDs no autoridad; RLS PoC PHY-G14; TenantIsolationGuard Android | No suite API stack objetivo nueva | Parcial | Fuga vía API/worker sin suite | NOT_EVALUATED |
| SEC-G02 | Fuerza bruta / sesión | Rate limit canónico + durable file; MFA WebAuthn en composición | durable limiter 4 PASS | Parcial | Multi-nodo rate; Turnstile ABSENT; login físico | NOT_EVALUATED |
| SEC-G03 | Escalada privilegios | Deny-by-default CommercialRequestHandler; SoD docs | Sin matriz RBAC nueva | Parcial | Cobertura atómica incompleta | NOT_EVALUATED |
| SEC-G04 | Clonación / trial / reloj | LicenseCapacityGate; TrustedClockGuard; DeviceTrust | Reuso evidencia #135 (no re-ejecutada) | Parcial | Restore/reinstall físico | NOT_EVALUATED |
| SEC-G05 | Replay / integridad local | Outbox checksum; DeviceProof; runtime files.json verify | android-runtime-integrity 2 PASS | Parcial | Transporte real + ventanas | NOT_EVALUATED |
| SEC-G06 | Fraude operativo | Append-only audit/finance/inventory | Sin prueba fraude nueva (sin gap reproducible) | Parcial | Señales/alertas operativas | NOT_EVALUATED |
| SEC-G07 | Secretos / crypto | DPAPI/Keystore; privados fuera de Git; prep firma | Docs + fuses | Parcial | Authenticode/Play BLOCKED | NOT_EVALUATED |
| SEC-G08 | API/webhook abuse | FixedWindow (no eviction); Factus webhook limiter; Zod | durable + main wiring | Parcial | Cluster rate; WAF | NOT_EVALUATED |
| SEC-G09 | Supply chain / backup | SBOM CycloneDX + provenance CI existentes | No re-run CI supply aquí | Parcial | DR medido; privatización | NOT_EVALUATED |
| SEC-G10 | Release inseguro | Fuses + signing prep; fail-closed claims | Config tests PASS | Parcial | Release gate físico | NOT_EVALUATED |

## Conclusión

Fase integral **avanza remediaciones y evidencia parcial**. `SEC-G01..G10` permanecen `PLANNED / NOT_EVALUATED`. Certificación física Windows/M60WL expresamente fuera de alcance.

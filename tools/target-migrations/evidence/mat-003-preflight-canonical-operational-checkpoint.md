# MAT-003 preflight canonical — operational checkpoint

- Fecha: 2026-08-24.
- Estado operacional: `EXECUTED / PASS / REVIEWED`.
- Configuración y ejecución canónica: `PASS`.
- Revisión independiente de la ejecución canónica del preflight: `PASS`.
- Findings: `CRITICAL=0`, `HIGH=0`, `MEDIUM=0`, `LOW=1 KNOWN / NON_BLOCKING`.

## Target y ejecución

- Environment class: `LOCAL_CANONICAL_INTEGRATION`.
- Environment ID sanitizado: `local-canonical-integration`.
- Database identity sanitizada: `pos_target_canonical_local`.
- PostgreSQL: `16.14`; `server_version_num=160014`.
- Repository commit ejecutado y revisado: `84c772b76d5b904cce061c9bef4b47bc295f5fef`.
- Identidad directa sanitizada: `pos_platform_admin`; `LOGIN NOSUPERUSER BYPASSRLS`.
- Comando aprobado: `pnpm preflight:migration:003`.
- Transacción: `REPEATABLE READ / READ ONLY`; cierre mediante `ROLLBACK`.
- Global lock: `pos-platform:target-migrations:global:v1`; adquirido en ambas ejecuciones.
- `failure_code=null`; `failure_cause_code=null`.

## Resultado estructurado revisado

| Check | Status | Count |
|---|---:|---:|
| `MAT003_INTEGRATION_CAPABILITY_DEBIT_NOTES` | `PASS` | 0 |
| `MAT003_NON_FISCAL_DEBIT_NOTES_DISPATCH` | `PASS` | 0 |
| `MAT003_NON_FISCAL_DEBIT_NOTES_ATTEMPT` | `PASS` | 0 |
| `MAT003_DEBIT_NOTES_MAPPING` | `PASS` | 0 |
| `MAT003_DEBIT_NOTES_OWNERSHIP` | `PASS` | 0 |
| `MAT003_AFFECTED_SCOPE_INTEGRITY` | `PASS` | 0 |

- Affected scope: `0`.
- Diagnostic evidence: `0`; ninguna evidencia truncada.
- El trust invariant conserva la regla `violation = FAIL`, nunca `BLOCKED`.
- Declaraciones y configuraciones globales de provider permanecen fuera del blocker contract.

## Integridad y no regresión

- Canonical role-readiness: `APPLIED / REVIEWED`; check posterior `PASS / READY`.
- Recibo externo: validación de contrato e integridad `PASS`; no fue copiado, regenerado ni trasladado a Git.
- Migration 001 UP/DOWN SHA-256: `7f188dd5c14a33f223e4684ace877d588278081924ab4c7286eb105a7c829507` / `383a26d046beb31975e0a5f00657aea00b9748de67f1188ca2fc7edfe765c0b7`.
- Migration 002 UP/DOWN SHA-256: `8b22fdbc76ff79178d3063541012d7f428ed6d538d9027edb7987ebbbe09a554` / `91acc3576b784daa261fa8e125c32fed522c0c5be12dd8c8fc91ed0c60bb1cf6`.
- `validatePostgresCatalog=PASS`; `validatePostgres002Catalog=PASS`, antes y después.
- Platform ACL fingerprint antes/después: `0dae4b28b747275e8ac5e1ea387c82b32d68aa5df01f3465ec577e80ff05e549`.
- Integrations ACL fingerprint antes/después: `92f550e939134639a9e7b51fe21de0c75c409ca5ccfd6b5efc479c606c81a207`.
- Datos de negocio antes/después: 35 tablas, cero filas; fingerprint `feee600441f759d83e6279a4a5bba0f69de961638b1df29690d6b247b011acbd`.
- Durable database mutations: `ZERO`.

## Gobernanza y límites

- SQL 003: `ABSENT`.
- Descriptor 003: `ABSENT`.
- Ledger 003: `0`.
- Fiscal schema: `ABSENT`.
- Migration 003: `NOT_MATERIALIZED`.
- LOW conocido/no bloqueante: el orden de evidencia diagnóstica no incluye `related_id` como desempate final; no impactó esta ejecución de alcance vacío y no fue remediado.
- `SIIGO`, `FACTUS` y `ALEGRA`: `DESIGNED / NOT_EVALUATED`.
- `SEC-G01..SEC-G10`: `PLANNED / NOT_EVALUATED`.
- Este checkpoint no acredita integración provider, funcionalidad fiscal, seguridad productiva ni readiness de producción.
- No contiene URLs, credenciales, tokens, variables de entorno, secretos, recibos privados ni datos de clientes o negocio.

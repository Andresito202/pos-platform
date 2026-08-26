# MAT-003 canonical role readiness — operational checkpoint

- Fecha: 2026-08-24.
- Resultado operacional: `APPLIED / REVIEWED`.
- Application: `PASS`.
- Revisión independiente: `PASS`.
- Findings de la revisión operacional: `CRITICAL=0`, `HIGH=0`, `MEDIUM=0`, `LOW=0`.

## Target y operación

- Environment class: `LOCAL_CANONICAL_INTEGRATION`.
- Environment ID sanitizado: `local-canonical-integration`.
- Database identity sanitizada: `pos_target_canonical_local`.
- PostgreSQL: `16.14`; `server_version_num=160014`.
- Repository commit usado para APPLY: `96556a87e4571bf4960bb6043c58105ac6281b3c`.
- Operation ID: `01a03683-6dde-7b51-8ad8-5972c70952d8`.
- Transición: `MISSING -> APPLY -> READY`.
- Delta exacto: `USAGE ON SCHEMA platform` y `SELECT(migration_id,status,checksum) ON platform.target_migration_executions` para `pos_platform_admin`.

## Integridad y custodia

- Role-readiness UP SHA-256: `722557a56e19273cf3cea8143c030cbbc7636029f9d60326e9491ad39891e53b`.
- Role-readiness DOWN SHA-256: `d3539fe24ff203904d0bbb3e9e96ba9bf1a3350a3e00b30d84a421f5fc8de1b1`.
- Migration 001 UP SHA-256: `7f188dd5c14a33f223e4684ace877d588278081924ab4c7286eb105a7c829507`.
- Migration 001 DOWN SHA-256: `383a26d046beb31975e0a5f00657aea00b9748de67f1188ca2fc7edfe765c0b7`.
- Migration 002 UP SHA-256: `8b22fdbc76ff79178d3063541012d7f428ed6d538d9027edb7987ebbbe09a554`.
- Migration 002 DOWN SHA-256: `91acc3576b784daa261fa8e125c32fed522c0c5be12dd8c8fc91ed0c60bb1cf6`.
- Receipt SHA-256: `7908fa8f588c7e4c6ff998a998a112b51a3c21e1f2a7c9a6c5529da0b13ca9b6`.
- Receipt contract: `receipt_version=1`; `lifecycle_contract_version=1`.
- Receipt result: `READY_WITH_RECEIPT`.
- Custodia: artifact durable local externo a Git; este checkpoint no copia, mueve, regenera ni altera el recibo.

## No regresión y límites

- `validatePostgresCatalog=PASS`; `validatePostgres002Catalog=PASS`.
- Integrations ACL sin regresión; fingerprint `92f550e939134639a9e7b51fe21de0c75c409ca5ccfd6b5efc479c606c81a207`.
- Roles, membresías y ownership: sin regresión; `pos_platform_admin` conserva cero ownership y ninguna membresía inesperada.
- Datos de negocio: cero mutaciones, cero filas; fingerprint `feee600441f759d83e6279a4a5bba0f69de961638b1df29690d6b247b011acbd`.
- `MAT-003-PREFLIGHT=NOT_EXECUTED`.
- SQL 003 y descriptor 003: `ABSENT`.
- Ledger 003: `0`; fiscal schema: `ABSENT`; migration 003: `NOT_MATERIALIZED`.
- `SIIGO`, `FACTUS` y `ALEGRA`: `DESIGNED / NOT_EVALUATED`.
- `SEC-G01..SEC-G10`: `PLANNED / NOT_EVALUATED`.
- Esta evidencia no acredita providers, funcionalidad fiscal ni readiness de producción y no contiene URLs, credenciales, tokens, secretos ni datos de clientes/negocio.

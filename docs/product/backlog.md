# Backlog maestro

## Propósito y autoridad

Este archivo es la fuente normativa del **estado vigente del trabajo** de POS Platform: prioridad, dependencia, bloqueo, trabajo activo y orden inmediato.

No funciona como diario histórico exhaustivo. La cronología detallada permanece trazable en Git, commits, PRs y workflows. Un snapshot histórico no puede contradecir la cola actual.

Última reconciliación normativa: 2026-08-26.

## Jerarquía relacionada

- Estado y orden de trabajo: este backlog.
- Arquitectura/decisiones: `docs/adr/`.
- Módulos y ownership: `docs/architecture/module-map.md` + `docs/architecture/data-ownership.md`.
- Ramas/PR/merge: `docs/governance/repository-governance.md`.
- CI vigente: `docs/testing/target-foundation-ci-gate.md`.
- Seguridad: `docs/security/security-gates.md`.
- Migrations: manifests y tooling aprobados bajo `docs/migration/` y `tools/target-migrations/`.

Si una fuente vigente contradice otra, la transición afectada se bloquea hasta reconciliación. No se elige una interpretación arbitraria.

## Estados

| Estado | Significado |
|---|---|
| `DONE` | Alcance cerrado con evidencia verificable del nivel declarado. |
| `IN_PROGRESS` | Trabajo principal activo y delimitado. |
| `READY` | Dependencias y alcance suficientes para iniciar, pero no activo. |
| `BLOCKED` | Trabajo válido detenido por un impedimento explícito. |
| `PLANNED` | Trabajo aceptado aún no preparado/iniciado. |
| `DEFERRED` | Trabajo válido aplazado a otra fase. |
| `OUT_OF_SCOPE` | Excluido deliberadamente del alcance vigente. |

Los niveles `DOCUMENTED`, `MATERIALIZED`, `TESTED`, `REVIEWED`, `CANONICALLY_APPLIED` y `PRODUCTION_READY` no son equivalentes.

## Baseline canónico

### Integrado en `main`

- Fase 0 documental: `DONE`.
- PR #2: `MERGED / CLOSED`; fundación TARGET integrada.
- PR #3: `MERGED / CLOSED`; runtime/documentación legacy retirados del árbol TARGET.
- Migration 001: `MATERIALIZED / TESTED / IMMUTABLE`.
- Migration 002 External Integrations: `MATERIALIZED / TESTED / IMMUTABLE`, PostgreSQL central, dispatch físico `NON_FISCAL`.
- MAT-003 preflight tooling: `MATERIALIZED / REVIEWED`.
- canonical-role-readiness tooling: `MATERIALIZED / REVIEWED`.
- canonical-role readiness: `APPLIED / REVIEWED` solo en `LOCAL_CANONICAL_INTEGRATION`.
- MAT-003 preflight canónico: `EXECUTED / PASS / REVIEWED`, read-only, cero mutaciones durables.
- PR #5: `MERGED / CLOSED`; supply-chain baseline + gobernanza detectiva de `main` integrados.
- PR #6: `MERGED / CLOSED`; fuentes canónicas reconciliadas.
- PR #7: `MERGED / CLOSED`; `Camacho POS Colombia` adoptado como nombre comercial con clearance oficial todavía pendiente.
- HEAD vigente de `main`: `940107f8cc0976c130dd4f274928b2df248473f4`.
- Run post-merge #47 `32937793013`: `COMPLETED / SUCCESS`, incluidos repository policy, TypeScript/SQLite/PostgreSQL y `Main push governance`.

La evidencia de SHA anterior es commit-scoped; el HEAD vigente de `main` siempre se consulta en GitHub.

### No materializado / no aprobado como producto

- NestJS/Fastify runtime: `ABSENT / NOT_MATERIALIZED`.
- Electron/React/Vite: `ABSENT / NOT_MATERIALIZED`.
- POS Local Service: `ABSENT / NOT_MATERIALIZED`.
- Nx de aplicaciones/packages: `ABSENT`.
- SQL 003: `ABSENT`.
- descriptor 003: `ABSENT`.
- schema fiscal 003: `ABSENT`.
- migration 003: `NOT_MATERIALIZED`.
- SIIGO/FACTUS/ALEGRA adapters reales: `DESIGNED / NOT_EVALUATED`.
- infraestructura productiva/piloto: pendiente.
- hardware certificado: todos los modelos continúan sin certificación productiva.
- `SEC-G01..SEC-G10`: `PLANNED / NOT_EVALUATED`.

## Gobernanza de `main`

`main` es la única rama canónica.

Branch protection preventiva nativa no está disponible para el repositorio privado con el plan GitHub vigente. GitHub reporta `protected: false` y sin required status checks.

Control compensatorio integrado:

- PR hacia `main` -> CI commit-scoped;
- push a `main` -> CI completo + `Main push governance`;
- merge permitido por política: merge commit normal mediante PR;
- direct push, squash y rebase -> violación detectada por workflow;
- gate exacto y post-merge: `docs/governance/repository-governance.md`.

Este control es detectivo, no preventivo.

## Ramas persistentes no canónicas

| Rama | Estado | Decisión |
|---|---|---|
| `architecture/foundation` | `INTEGRATED / HISTORICAL` | Eliminar cuando exista operación de borrado de ref autorizada/disponible. No reutilizar. |
| `architecture/physical-model` | `INTEGRATED / HISTORICAL` | PR #2 ya integrada; no reutilizar. |
| `cleanup/pure-pos-platform-20260825` | `INTEGRATED / HISTORICAL` | PR #3 ya integrada; no reutilizar. |
| `ci/supply-chain-baseline-20260826` | `INTEGRATED / HISTORICAL` | PR #5 ya integrada; no reutilizar. |
| `docs/canonical-state-reconciliation-20260826` | `INTEGRATED / HISTORICAL` | PR #6 ya integrada; no reutilizar. |
| `docs/camacho-pos-colombia-branding-20260826` | `INTEGRATED / HISTORICAL` | PR #7 ya integrada; no reutilizar. |
| `brand/canonical-identity-assets-20260826` | `REDUNDANT_REF / NO_UNIQUE_COMMITS` | Idéntica a `main`; eliminar de forma segura cuando la operación de borrado de refs esté autorizada/disponible. |
| `design/sql003-contract-reconciliation-20260826` | `BLOCKED` | PR #4 draft; requiere sincronización con `main` y revisión independiente. |
| `wip/sql003-contract-gap-20260825` | `HISTORICAL_WIP / NOT_INTEGRABLE` | No merge/cherry-pick completo; retirar solo después de reconciliación autoritativa SQL003. |

Las ramas temporales de una PR pasan a `INTEGRATED` tras el merge y no se reutilizan, aunque GitHub conserve físicamente el ref.

## Flujo oficial de trabajo

`PLANNED -> READY -> IN_PROGRESS -> DONE`

con `BLOCKED`, `DEFERRED` y `OUT_OF_SCOPE` como estados explícitos.

Reglas:

1. Debe existir un solo trabajo principal `IN_PROGRESS`, salvo excepción documentada.
2. Un trabajo bloqueado no cuenta como línea principal activa, pero conserva causa y condición de desbloqueo.
3. No se abre otra rama para el mismo objetivo.
4. No se marca `DONE` por documentación si el criterio exige implementación.
5. Todo merge a `main` sigue el gate de gobernanza.
6. Cada cambio que altere estado/orden actualiza este backlog en el mismo PR.
7. No se usan estados locales históricos (`CLEAN`, upstream 0/0, Docker, PostgreSQL) como hechos presentes.

## Trabajo principal actual

### TECH-004 — CI, calidad y supply chain

Prioridad: `P0`

Estado: `IN_PROGRESS`

Materializado:

- gate TARGET en PR y push a `main`;
- typecheck del tooling actual;
- SQLite migrations/regresiones actuales;
- PostgreSQL 001/002 + MAT-003 tooling;
- repository policy;
- scanner baseline de secretos trackeados;
- frozen lockfile;
- dependency/license inventory;
- artifact obligatorio;
- Actions fijadas por SHA;
- `persist-credentials: false`;
- gobernanza detectiva de push a `main`.

Pendiente para cerrar TECH-004:

- Nx cuando se materialicen apps/packages;
- lint del runtime/aplicaciones;
- CodeQL/SAST completo;
- vulnerability scanning con severidad/policy cerrada;
- SBOM estándar y firmado;
- compatibilidad legal de licencias completa;
- provenance/attestations;
- firma de releases;
- runtime/E2E tests;
- controles de release/promoción.

## Orden inmediato obligatorio después de esta reconciliación canónica

1. **Cerrar ramas históricas integradas** cuando exista operación segura de borrado de refs; no mover refs artificialmente ni hacer force-push para simular limpieza.
2. **Resolver PR #4 / SQL003 contract gap**: obtener revisión independiente; si pasa, remediar fuentes autoritativas; revalidar idempotencia, retry/transport y `operation_type`; SQL003 continúa prohibido hasta cierre.
3. **Retirar WIP SQL003 histórico** solo cuando la reconciliación autoritativa haya absorbido toda evidencia necesaria y sea demostrable que no se pierde trazabilidad.
4. **ARCH-003**: materializar reglas ejecutables de límites modulares/Nx sobre el mapa reconciliado.
5. **TECH-003**: materializar contratos Zod/API/IPC, errores, versionado, idempotencia y correlación.
6. Solo después iniciar el primer esqueleto de runtime conforme a ADR-005/DEC-010, sin saltar security/data gates.

No se inicia NestJS/Electron “por avanzar” mientras los pasos anteriores sigan abiertos.

## Bloqueo SQL003

### INT-006

Prioridad: `P0`

Estado: `BLOCKED`

Causa:

- PR #4 contiene una propuesta contractual `NOT_AUTHORITATIVE`;
- revisión independiente Codex solicitada y bloqueada por límite de uso;
- la auditoría detectó incompatibilidad entre retry con idempotency root estable y un unique histórico que impediría nuevas filas de attempt con la misma raíz;
- existen findings de identidad lógica/transport/retry/operation scope que deben reconciliarse antes de DDL.

Condición de desbloqueo:

1. revisión independiente de la propuesta;
2. `PROPOSAL_REVIEW = PASS`;
3. remediación autoritativa separada del manifest/physical model/use case aplicables;
4. review de esa remediación;
5. solo entonces considerar manifest/materialización SQL003.

No autorizado mientras esté bloqueado:

- SQL 003;
- descriptor 003;
- runner/apply/down 003;
- fiscal schema;
- adapters provider;
- merge/cherry-pick completo del WIP histórico.

## Backlog por épica

### Arquitectura

| ID | Pri | Estado | Trabajo / evidencia |
|---|---|---|---|
| ARCH-001 | P0 | DONE | Monolito modular, monorepo, local-first y single codebase definidos. |
| ARCH-002 | P0 | DONE | Contexto, tenancy, deployment y ownership definidos. |
| ARCH-003 | P0 | READY | Convertir límites en reglas ejecutables de módulos/Nx. TECH-002 está DONE y module-map queda reconciliado en este corte. |
| ARCH-004 | P0 | DONE | Contratos renderer/Electron/local/API/hardware/providers definidos. |
| ARCH-005 | P0 | DONE | Stack objetivo cerrado en ADR-005. |

### Seguridad

| ID | Pri | Estado | Trabajo / evidencia |
|---|---|---|---|
| SEC-001 | P0 | DONE | Modelo de seguridad, roles y permisos documentados. |
| SEC-002 | P0 | DONE | Permisos atómicos, ABAC, SoD y pruebas negativas definidas. |
| SEC-003 | P0 | PLANNED | Implementar tenant isolation, sesiones, MFA y reautenticación. |
| SEC-004 | P0 | DONE | Secretos, claves, firma y soporte JIT definidos. |
| SEC-G01 | P0 | PLANNED | Tenant Isolation — NOT_EVALUATED. |
| SEC-G02 | P0 | PLANNED | Authentication & Session — NOT_EVALUATED. |
| SEC-G03 | P0 | PLANNED | Authorization RBAC/ABAC — NOT_EVALUATED. |
| SEC-G04 | P0 | PLANNED | Device Trust & License — NOT_EVALUATED. |
| SEC-G05 | P0 | PLANNED | Local-first Integrity/Replay — NOT_EVALUATED. |
| SEC-G06 | P0 | PLANNED | Audit & Anti-Fraud — NOT_EVALUATED. |
| SEC-G07 | P0 | PLANNED | Secrets & Cryptography — NOT_EVALUATED. |
| SEC-G08 | P0 | PLANNED | API/Webhook/Input Security — NOT_EVALUATED. |
| SEC-G09 | P0 | PLANNED | Infra/Supply Chain/Backup — NOT_EVALUATED. |
| SEC-G10 | P0 | PLANNED | Security Release Gate — NOT_EVALUATED. |

### Catálogo

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| CAT-001 | P0 | DONE | Producto, identificadores, variantes, presentaciones y conversiones definidos. |
| CAT-002 | P1 | READY | Persistencia física alineada con DEC-004/TECH-002; preparar implementación futura. |
| CAT-003 | P1 | PLANNED | Implementar Catalog multiempresa. |
| CAT-004 | P3 | DEFERRED | Especialización droguería. |

### Precios / promociones / impuestos

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| PRICE-001 | P0 | DONE | Programación/resolución de precios definida. |
| PRICE-002 | P0 | DONE | `PRICING_PIPELINE_V1` y orden definitivo cerrados. |
| PRICE-003 | P1 | PLANNED | Implementar versiones/vigencias/snapshots offline. |
| PROMO-001 | P0 | DONE | Creación/aplicación de promociones definida. |
| PROMO-002 | P1 | PLANNED | Persistencia de reglas/contadores idempotentes. |
| PROMO-003 | P1 | PLANNED | Motor determinista de promociones. |
| TAX-001 | P0 | DONE | Resolución/cambios tributarios definidos. |
| TAX-002 | P0 | DONE | Redondeo total pagadero definido. |
| TAX-003 | P0 | DONE | Precisión/residuos/conciliación y rounding final cerrados. |
| TAX-004 | P1 | PLANNED | Implementar Electronic Invoicing tras INT-006/TECH-003/gates. |
| UC-EINV-001 | P1 | DONE | Ciclo funcional fiscal documentado. |

### Integraciones externas

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| INT-001 | P0 | DONE | Contrato provider-neutral y ownership cerrados. |
| INT-002 | P0 | DONE | Manifest migration 002 cerrado. |
| INT-003 | P0 | DONE | Migration 002 materializada/tested/immutable. |
| INT-004 | P1 | PLANNED | Adapters SIIGO/FACTUS/ALEGRA reales; no mocks como evidencia. |
| INT-005 | P2 | PLANNED | Evaluar HKA/Odoo sin adapters ficticios. |
| INT-006 | P0 | BLOCKED | Reconciliación/materialización migration 003 fiscal; ver bloque SQL003. |

### Pagos

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| PAY-000 | P0 | DONE | Lifecycle conceptual de pagos. |
| UC-PAY-001 | P0 | DONE | Pago individual. |
| UC-PAY-002 | P0 | DONE | Pago mixto/fallo parcial. |
| UC-PAY-003 | P0 | DONE | Transferencia manual/QR. |
| UC-PAY-004 | P0 | DONE | Refund/reversal. |
| UC-PAY-005 | P0 | DONE | Settlement/reconciliation. |
| PAY-007 | P0 | DONE | Máquinas de estado separadas y autoridad cerrada. |
| PAY-008 | P1 | PLANNED | Persistencia física de pagos. |
| PAY-009 | P1 | PLANNED | Implementación/concurrencia/idempotencia/permisos/recovery. |

### Caja

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| CASH-001 | P0 | DONE | Apertura definida. |
| CASH-002 | P0 | DONE | Cierre/diferencia definidos. |
| CASH-003 | P0 | DONE | Movimientos, retiros, arqueos y compensaciones definidos. |
| CASH-004 | P1 | PLANNED | Implementar caja por terminal/turno. |

### Ventas

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| SALES-001 | P0 | DONE | Confirmación atómica/idempotente definida. |
| SALES-002 | P0 | DONE | Suspensión/recuperación/cancelación/devolución/reimpresión. |
| SALES-003 | P1 | PLANNED | Implementar pipeline comercial/snapshots. |

### Compras / proveedores

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| PUR-001 | P1 | PLANNED | Definir PurchaseOrder/SupplierReturn sin contaminar GoodsReceipt. |
| PUR-002 | P1 | PLANNED | Implementar capacidades de compra/proveedor separadas de Payment de cobros. |

### Inventario

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| INV-001 | P0 | DONE | GoodsReceipt definido. |
| INV-002 | P0 | DONE | Movimientos/reservas/ajustes/lotes/traslados/concurrencia definidos. |
| INV-003 | P1 | PLANNED | Implementar movimientos como fuente y saldos como proyección. |

### Clientes / crédito

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| CUST-001 | P1 | PLANNED | Alta/edición/búsqueda/privacidad. |
| CUST-002 | P1 | PLANNED | Cuenta/cupo/mora/abonos; depende de DEC-005. |
| CUST-003 | P2 | PLANNED | Implementación auditable. |

### Domicilios

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| DEL-001 | P3 | DEFERRED | Pedido/preparación/asignación/recaudo/PIN/incidencias. |
| DEL-002 | P3 | DEFERRED | App domiciliario/GPS limitado. |
| DEL-003 | P3 | OUT_OF_SCOPE | No forma parte del primer núcleo Fase 1. |

### Onboarding

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| ONB-001 | P0 | DONE | Inicialización tenant/company/branch/owner definida. |
| ONB-002 | P0 | PLANNED | Bootstrap transaccional/idempotente/auditable. |
| ONB-003 | P2 | PLANNED | Importación masiva/migración asistida. |

### Licencias / dispositivos

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| LIC-001 | P0 | DONE | Validación HYBRID/LOCAL_PERPETUAL. |
| LIC-002 | P0 | DONE | Lifecycle contractual-operativo cerrado. |
| LIC-003 | P1 | PLANNED | Implementar entitlements/límites/dispositivos. |
| DEV-001 | P0 | DONE | Lifecycle dispositivo. |
| DEV-002 | P0 | DONE | Identidad segura + licencia. |
| DEV-003 | P1 | PLANNED | Simuladores/adapters hardware; certificación requiere equipos reales. |

### Sincronización

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| SYNC-001 | P0 | DONE | Operation/outbox/inbox/idempotencia/checkpoint definidos. |
| SYNC-002 | P0 | DONE | Configuración offline versionada por dominio. |
| SYNC-003 | P0 | DONE | Conflictos/retry/recovery/dead letter/clock definidos. |
| SYNC-004 | P1 | PLANNED | Venta offline real sin duplicación/pérdida. |

### Reporting

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| REP-001 | P1 | PLANNED | Reportes por rol. |
| REP-002 | P2 | PLANNED | Proyecciones/procesamiento async sin source-of-truth paralelo. |
| REP-003 | P2 | PLANNED | Exportación/privacidad/métricas. |

### UX

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| UX-001 | P1 | DONE | Navegación inicial/decisiones UX. |
| UX-002 | P1 | PLANNED | Flujos POS venta/pago/offline/hardware. |
| UX-003 | P1 | PLANNED | Design system accesible/resoluciones/touch. |
| UX-004 | P2 | PLANNED | Usabilidad por rol/tipo de comercio. |

### Diseño técnico

| ID | Pri | Estado | Trabajo |
|---|---|---|---|
| TECH-001 | P0 | DONE | Modelo conceptual y ownership. |
| TECH-002 | P0 | DONE | Modelo físico base + migrations 001/002/materialización revisada. |
| TECH-003 | P0 | READY | Contratos Zod/API/IPC/error/idempotencia/versionado/correlación. |
| TECH-004 | P0 | IN_PROGRESS | CI/calidad/supply chain; trabajo principal actual. |
| TECH-005 | P1 | PLANNED | Observabilidad/backups/restore/update/rollback. |
| TECH-006 | P1 | PLANNED | Fixtures multi-tenant/concurrencia/recovery. |

## Decisiones

### Cerradas P0

- DEC-001: taxonomía de estados de pagos.
- DEC-002: compensación de pagos.
- DEC-003: pricing pipeline.
- DEC-004: Product/Variant/Presentation.
- DEC-006: rounding policy.
- DEC-007: autoridad local-first.
- DEC-008: device trust/license activation.
- DEC-009: baseline operacional productivo.
- DEC-010: runtime POS.

### Pendiente

| ID | Pri | Estado | Bloquea |
|---|---|---|---|
| DEC-005 | P1 | DEFERRED | Crédito offline: CUST-002/PAY-009. |

## Hitos

| Hito | Estado | Criterio vigente |
|---|---|---|
| Fase 0 | DONE | Fundación documental/decisiones P0 cerradas. |
| F1.1 Esqueleto modular y contratos | PLANNED | ARCH-003 + TECH-003 + esqueleto aprobado. |
| F1.2 Modelo físico/migrations | IN_PROGRESS | TECH-002 DONE; 001/002 materializadas; cortes posteriores aditivos y gated. |
| F1.3 Seguridad/identidad | PLANNED | SEC gates con evidencia runtime real. |
| F1.4 CI/calidad | IN_PROGRESS | TECH-004; baseline vigente PASS, pipeline integral pendiente. |
| F1.5 Primer corte vertical | PLANNED | Onboarding mínimo autenticado/auditado/idempotente. |
| F1.6 Base local-first | PLANNED | Operation/outbox/sync real sin duplicación. |

## Riesgos abiertos

| ID | Sev | Riesgo | Cierre |
|---|---|---|---|
| R-001 | Alta | Confundir docs/tooling con runtime. | Claims por nivel + evidencia ejecutable. |
| R-003 | Alta | Pagos externos sin atomicidad distribuida. | Idempotencia/UNKNOWN_OUTCOME/compensación/reconciliation. |
| R-004 | Alta | Tenant isolation no probado en runtime. | SEC-003 + SEC-G01 real. |
| R-005 | Alta | Local-first aún no implementado extremo a extremo. | SYNC-004 y suites SQLite/PostgreSQL. |
| R-006 | Alta | Sobre-modelado físico de dominios pendientes. | Manifests/reviews aditivos; no DDL especulativo. |
| R-007 | Media | Pricing documentado, runtime pendiente. | Implementación determinista + tests. |
| R-008 | Media | RPO/RTO/volumen sin benchmark. | TECH-005 + medición. |
| R-009 | Media | Hardware sin validación real. | DEV-003 + LAB_VALIDATED/CERTIFIED. |
| R-010 | Alta | SQL003 con contract gaps abiertos. | PR #4 -> remediación autoritativa -> review -> materialización separada. |
| R-011 | Alta | Runtime objetivo ausente. | ARCH-003/TECH-003 -> esqueleto -> gates. |
| R-012 | Media | Firma/keys/support definidos pero no implementados. | SEC-004 materializado + pruebas. |
| R-013 | Alta | `main` sin branch protection preventiva por limitación de plan. | Control detectivo vigente; habilitar protección cuando plan lo permita. |
| R-014 | Media | Drift documental puede reabrir pasos ya cerrados. | Fuente vigente compacta + reconciliación obligatoria en el mismo PR. |

## Trazabilidad histórica

La historia detallada anterior a esta reconciliación no se elimina: permanece en el historial Git de `docs/product/backlog.md`, commits, PRs y workflows.

Los hitos que sustentan el baseline actual incluyen, entre otros:

- migration 001 materializada desde el corte autorizado de TECH-002;
- migration 002 External Integrations materializada y mantenida inmutable;
- MAT-003 preflight/readiness revisados;
- cleanup legacy integrado por PR #3;
- fundación TARGET integrada por PR #2;
- supply-chain/governance integrada por PR #5;
- run post-merge #40 PASS.

El registro histórico sirve como evidencia, no como cola de trabajo vigente.

## Regla de cierre

Una tarea no está cerrada hasta que:

1. el artefacto existe;
2. cumple alcance y criterios;
3. las validaciones reales aplicables pasan;
4. el diff fue revisado;
5. el backlog refleja el estado nuevo;
6. branch/PR/merge quedan reconciliados conforme a governance;
7. no queda una rama activa sin objetivo o condición de bloqueo;
8. no se deja una fuente normativa contando un estado incompatible.

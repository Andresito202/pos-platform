# Preparación comercial interna — informe de avance

**Repositorio:** Andresito202/pos-platform  
**Rama:** `cursor/commercial-design-review-0d11`  
**PR:** #106 (Draft)  
**HEAD de partida aprobado:** `7937229997d16884faea93758b67188634cce30c` (Bloque 7 CI 6/6)

## Alcance ejecutado

### 1. Consumidores Central (motor existente)

- Módulo `tools/target-migrations/src/central-domain-consumers.ts` integrado en `central-sync-server.ts`.
- Diferencia **recepción durable** (`persistOperation` → `sync.sync_operations`) de **aplicación de dominio** (`applyCentralDomainOperation` + auditoría `SYNC_DOMAIN_APPLY`).
- Familias tipadas: SALES, PAYMENTS, INVENTORY (movimientos/reservas/transformaciones/mermas vía tipos inventario), PRODUCTION (bakery), AUDIT; resto `DURABLE_RECEIVED_UNTYPED`.
- Idempotencia/checksum/aislamiento empresarial del receive existentes se conservan.
- Conflictos de inventario entre actores distintos sobre la misma presentación/sucursal → `CONFLICT` + `review_required` sin borrar operaciones confirmadas.
- No se creó un segundo motor de sync.

### 2. Inventario multicaja

- Política Bloque 5 reafirmada: reservas 024 = misma DB; no consistencia global inmediata offline.
- Detección Central de solapes multi-actor (`INVENTORY_DISTRIBUTED_OVERLAP`) para reconciliación autorizada.
- Test local de política: `bloque5-offline-sync-e2e` filtro `documents inventory policy` PASS.

### 3. DEC-024 transporte

- `central-sync-tls-policy.ts`: lab loopback OK; producción exige `CENTRAL_SYNC_BEHIND_TLS_TERMINATOR=1`; override HTTP inseguro prohibido.
- Bind por defecto fail-closed (ya no `0.0.0.0` implícito).
- Cliente `SyncDispatcher` sigue exigiendo `https://` (DEC-007).
- Certificación lab ≠ producción; proxy TLS real / DNS / certs siguen externos (ADR PROPOSED para despliegue).

### 4. Instalador Windows

- Workflow `.github/workflows/windows-nsis-installer-lab.yml` (windows-2022).
- Icono oficial `apps/pos-desktop/packaging/icon.png` (símbolo amarillo Camacho).
- electron-builder **26.18.1** + NSIS; unsigned lab; RT-009-B BLOCKED.
- Artefacto esperado: `camacho-pos-nsis-lab-<sha>` + `installer-integrity.txt` (SHA-256).

### 5. Dependencias

- picomatch: latest npm **4.0.7**, `first_patched_version` ausente → excepciones GHSA-fc5q **conservadas** (vencimiento 2026-12-17); no ampliadas.
- `ci:vulnerability-audit` PASS local (2 triage + 2 exceptions).

## Pruebas (este entorno)

| Suite | Resultado |
|---|---|
| target-migrations TLS policy | 5 PASS |
| domain family registry | 1 PASS |
| typecheck target-migrations | PASS |
| inventory policy bloque5 | 1 PASS |
| vulnerability audit | PASS |
| NSIS generation / silent install / uninstall físico | SKIP hasta artifact Actions |
| Authenticode | BLOCKED |
| FACTUS | no intervenido |

## Pendientes

**Internos:** verificación artifact NSIS en Actions; instalación silenciosa/desinstalación/upgrade en runner cuando el .exe exista; consumers con proyección comercial PostgreSQL completa (hoy ledger sync+audit, sin segundo POS).

**Externos / físicos:** certificado Authenticode; reverse proxy TLS producción; VPS/dominio; FACTUS; hardware; Android.

## Estado

Claim de cierre se fija tras CI exact-head del tip de esta preparación:  
`PREPARACION_COMERCIAL_INTERNA_CERRADA` o `PREPARACION_COMERCIAL_INTERNA_BLOQUEADA`.

# Auditoría e informe Prompt 6 — Farmacia/Droguería

**HEAD inicial:** `f6f4194cb560eb4d9e5d1b92b1937935c72a78fa`  
**HEAD final:** `a995e74420d00baa0071029fd935566f1720c144`  
**Rama:** `cursor/commercial-design-review-0d11` · PR #106 Draft  
**Migraciones 001–025:** sin alteración de contenido funcional previo; fixtures actualizados a `user_version >= 26` para drop de tablas v26.

## Clasificación de capacidades

| Capacidad | Antes | Después |
|---|---|---|
| Catálogo / presentaciones / food policy | OPERATIVO | OPERATIVO (reusado) |
| Lotes FEFO / cuarentena / reservas (P4) | OPERATIVO | OPERATIVO (reusado) |
| Transform / multi-presentación (P5) | OPERATIVO | OPERATIVO (regresión OK) |
| Ficha farmacéutica | AUSENTE | OPERATIVO (`catalog_pharmacy_profile`) |
| Establecimiento farmacéutico | AUSENTE | OPERATIVO (config local) |
| Recepción técnica | PARCIAL (receive+lote) | OPERATIVO parcial + rechazo sin stock + cuarentena automática de lote |
| Dispensación con fórmula | AUSENTE | OPERATIVO (gates en `sale.create` + revalidación en cash payment) |
| Control especial FNE | AUSENTE | BLOQUEADO_EXTERNO (fail-closed siempre) |
| Alertas INVIMA sync | AUSENTE | PARCIAL (carga administrativa; sin sync oficial) |
| Reportes oficiales FNE | AUSENTE | BLOQUEADO_EXTERNO |

## Implementación aditiva

- `MIGRATION_026` — `company_pharmacy_establishment`, `catalog_pharmacy_profile`, `pharmacy_prescription`, `pharmacy_technical_receipt`, `pharmacy_dispensation_authorization`, `pharmacy_sanitary_alert`, `pharmacy_controlled_ledger`
- IPC: `pharmacy.establishment.upsert`, `pharmacy.profile.upsert`, `pharmacy.prescription.register`, `pharmacy.technical_receipt.register`, `pharmacy.sanitary_alert.register`
- Gates en `sale.create` + `payment.register.cash` → `PHARMACY_ELIGIBILITY_LOST`
- UI: `PharmacyPanel` dentro de `CatalogPanel` (solo permisos de catálogo/inventario)

## Pruebas ejecutadas (este entorno)

| Suite | Resultado |
|---|---|
| `pharmacy-v26-migration` + inventory v22–v25 migrations | PASS (6) |
| `pharmacy-contracts` | PASS (2) |
| `farmacia-pharmacy` | PASS (5) |
| `salsamentaria-transform` | PASS (8) |
| `inventory-batches` + reservations | PASS (34) |
| `sale` + `payment` + `fiscal-issuance` + `catalog` + `commercial-ipc` | PASS (192) |
| desktop `ipc-allowlist` + `preload-api` | PASS (11) |
| typecheck contracts / database-sqlite / local-channel / pos-local-service / pos-desktop | PASS |

## No acreditado

- Habilitación sanitaria, inscripción FNE con ACK, sync INVIMA, E2E Windows/hardware, producción comercial, merge a `main`.
- No se declara certificación legal ni conformidad sanitaria por CI.

## Riesgos P0/P1

- **P0:** Control especial permanece bloqueado — correcto hasta integración FNE/reportes con formato vigente y ACK.
- **P1:** Verificación INVIMA es manual (`VERIFIED_MANUAL`); no hay consulta en línea automática.
- **P1:** Traslados inter-sucursal reconciliados siguen en capacidad inventario existente; no se inventó segundo ajuste paralelo como “traslado confirmado”.

## Dictamen funcional por proceso

| Proceso | Dictamen |
|---|---|
| OTC permitido con establecimiento autorizado | CONFORME (backend) |
| Rx con fórmula válida / sin fórmula | CONFORME (bloqueo/aceptación) |
| Control especial | CONFORME AL BLOQUEO (no habilitado) |
| Recepción REJECTED sin stock | CONFORME |
| Recepción QUARANTINE → lote no dispensable | CONFORME |
| Alerta sanitaria administrativa | CONFORME parcial (sin sync oficial) |
| Cajero altera ficha regulatoria | CONFORME (permiso catálogo requerido) |

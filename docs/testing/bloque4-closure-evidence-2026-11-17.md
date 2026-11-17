# Bloque 4 — evidencia de cierre funcional (2026-11-17)

**Rama:** `cursor/commercial-design-review-0d11`  
**PR:** #106 (Draft — no merge a `main`)  
**Alcance de este cierre:** licencias sectoriales sobre la autoridad firmada existente + pruebas integrales 3×4.

## Veredicto

| Clasificación | Estado |
|---|---|
| Pendientes internos (licencias sectoriales + E2E 3 empresas × 4 roles) | **CERRADOS en esta rama** con evidencia de prueba ejecutada |
| Dependencias externas | **SIGUEN ABIERTAS** (no bloquean el cierre interno del Bloque 4) |

No se inicia Bloque 5. No se interviene VPS, dominio, Android, hardware ni FACTUS.

## Pendientes internos resueltos

### 1. Licencias sectoriales (sin segundo sistema)

Códigos canónicos en `packages/contracts/src/license-sector.ts`:

- `SECTOR_SALSAMENTARIA`
- `SECTOR_FARMACIA`
- `SECTOR_PASTELERIA`

viajan en `CAMACHO_LICENSE_CAPACITY_V2.claims.entitlements` junto a `CASH_REGISTER`.

| Superficie | Mecanismo |
|---|---|
| GLOBAL | `POST /v1/platform/license-offers/set-entitlements` sobre plan DRAFT (`LicenseOfferDrafts.setEntitlements`) |
| Activación Central | proyección de `SECTOR_*` contratados al artefacto firmado |
| Local gate | `LicenseCapacityGate.authorizeEntitlement` + `listEntitlements` |
| IPC | handlers pharmacy / bakery / transform / sale con fórmula |
| Frontend | `authorization.capabilities.get` → `entitlements`; paneles ocultos sin licencia |

Manipulación local del archivo de provisión sin firma válida → rechazo (`LICENSE_SIGNATURE_INVALID`). Contaminación entre empresas → `LICENSE_SCOPE_MISMATCH` / rechazo de ámbito.

### 2. Pruebas integrales 3×4

Archivo: `apps/pos-local-service/tests/bloque4-sector-license-e2e.test.ts`

Comprueba: proyección de sectores, denegación cruzada, aislamiento de empresas, permisos +/- de CAJERO/SUPERVISOR/ADMINISTRADOR/SUPERADMINISTRADOR (local; GLOBAL sigue en Central), revocación independiente, persistencia tras reconstrucción del gate.

**Ejecutado en este entorno:**

```text
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/bloque4-sector-license-e2e.test.ts
→ 6 passed
```

## Regresiones observadas (este entorno)

```text
pnpm --filter @pos-platform/contracts test                     → 343 passed
pnpm architecture:check                                         → PASS
pnpm --filter @pos-platform/pos-local-service typecheck          → PASS
pnpm --filter @pos-platform/pos-desktop typecheck                → PASS
pnpm --filter @pos-platform/central-authority typecheck          → PASS
vitest: farmacia / salsamentaria / block1 / license-capacity    → PASS
vitest: local-operator-authorization                            → PASS
vitest: pos-desktop session-recovery                            → PASS
```

CI exact-head del commit publicado se certifica en el workflow remoto del HEAD tras el push (no inferir PASS aquí).

## Dependencias externas (fuera de este cierre)

| Ítem | Motivo |
|---|---|
| FNE | Restringido hasta autorización externa |
| Hardware | Último bloque |
| FACTUS | Pendiente respuesta del proveedor |
| VPS / dominio / Android | Excluidos explícitamente |

## Exclusiones respetadas

- No rediseño de UI/arquitectura
- No ramas adicionales
- No merge a `main`
- No Bloque 5
- SUPERADMINISTRADOR local = auditoría; licencia GLOBAL = portal Central

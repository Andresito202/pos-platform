# Auditoría Prompt 5 — Avícola / Salsamentaria sobre el núcleo existente

**HEAD de partida certificado:** `321d09dbf40725fea922f52390dc3505cd03b4e2`  
**Rama:** `cursor/commercial-design-review-0d11` · PR #106 Draft

## Clasificación de capacidades (antes / después de la implementación)

| Capacidad | Antes | Después | Archivos / evidencia |
|---|---|---|---|
| Catálogo producto + 1 presentación | OPERATIVA | OPERATIVA | `SqliteCatalogStore`, `CatalogPanel` |
| Multi-presentación comercial | AUSENTE | OPERATIVA | `addPresentation`, `catalog.presentation.register` |
| Política alimentaria (conservación/lote/vencimiento) | AUSENTE | OPERATIVA | `catalog_food_policy`, `catalog.food_policy.upsert` |
| Conversión 1→1 MIGRATION_023 | OPERATIVA | OPERATIVA (reusada) | `inventory.conversion.*` |
| Despiece multi-salida atómico | AUSENTE | OPERATIVA | `executeTransform`, MIGRATION_025 |
| FEFO / lotes / cuarentena / bloqueo | OPERATIVA | OPERATIVA (reusada + bloqueo en transform) | Prompt 4 + checks en transform |
| Reservas / saldo disponible | OPERATIVA | OPERATIVA (transform respeta reservas) | `LOT_RESERVED` |
| Receiving / Sales / Payments | OPERATIVA | OPERATIVA (sin fork) | paneles existentes |
| Balanza física certificada | LABORATORIO | LABORATORIO (sin claim) | `salsamentaria-scale-audit-2026-11-15.md` |
| Sync multi-caja offline | PARCIAL | PARCIAL (sin claim falso) | outbox local; sin ACK distribuido inventado |
| Fiscal precisión | OPERATIVA | OPERATIVA | rechazo por precisión inválida existente |

## Migración aditiva

- `MIGRATION_025` en `packages/database-sqlite/src/local-database.ts`
  - `catalog_food_policy`
  - `inventory_transform_order` / `inventory_transform_line` (append-only)

## No hecho (explícito)

- No se creó app Salsamentaria paralela ni tres módulos de inventario.
- No se modificaron migraciones históricas.
- No se declaró certificación sanitaria ni balanza acreditada.
- No se fusionó a `main`.

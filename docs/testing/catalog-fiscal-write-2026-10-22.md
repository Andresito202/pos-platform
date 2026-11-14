# D-19 — alta validada de atributos fiscales

Base `2dc2272`, misma rama activa. Se amplía únicamente el alta de catálogo compartida existente; no se añade otro permiso, tabla, migration ni motor fiscal.

`catalog.product.register` acepta `fiscal_attributes` opcional. La pantalla existente permite declararlos explícitamente; los cinco campos empiezan vacíos y no hay código, tasa ni exención por defecto. `RegisterProductUseCase` conserva el permiso `CATALOG_PRODUCT_REGISTER` y deriva actor/scope del contexto existente. El store valida la forma con `FiscalDocumentItemSchema` y la pertenencia/precisión con `validateFiscalDocumentItem` antes de persistir. `KGM` no se convierte silenciosamente a código DIAN.

Los atributos se insertan en `catalog_fiscal_attribute` existente dentro de la misma transacción de producto/presentación/precio/operación/auditoría/outbox. El campo explícito entra en checksum y payload de sincronización; la omisión conserva el checksum previo y deja ausencia fiscal, no tasa cero. Cambiar tasa bajo la misma clave de idempotencia produce conflicto. No se implementa aquí modificación fiscal de productos existentes ni se altera precio automáticamente por declarar impuesto; el motor calcula con la semántica fiscal que ya tenía.

Evidencia ejecutada en Windows/Node 22.19, SQLite real temporal:

- `pnpm --filter @pos-platform/pos-local-service exec vitest run tests/catalog.test.ts`: 20/20, 3 nuevas. Incluye códigos desconocidos, tasas fuera de rango/no representables, ausencia de permiso, idempotencia y rollback completo ante fallo de auditoría.
- `pnpm --filter @pos-platform/pos-desktop exec vitest run --config vitest.config.ts tests/renderer/AdminPanels.test.tsx -t CatalogPanel`: 6/6, 20 omitidas. Contrato real del sobre y omisión sin valores inventados; transporte de prueba/jsdom.
- `pnpm --filter @pos-platform/pos-local-service exec vitest run tests/channel-commercial-vertical.test.ts -t D-19/D-23`: 1/1, 20 omitidas. Canal autenticado real/named pipe Windows → handler → autorización existente → SQLite: alta sin sesión rechazada, código fiscal incorrecto rechazado, atributo correcto persistido y barcode congelado al crear la venta. Claves/SSA y asignaciones exclusivamente fixtures. Log `artifacts/android-runtime/2026-10-22/fiscal-identifier-channel.log`.
- TypeScript local-service y desktop/renderer: exit 0. Fronteras y política verificadas antes de publicar.

Estado: escritor inicial D-19 IMPLEMENTED/TESTED y CALLER_REACHABLE en el arnés del canal; no facturación electrónica productiva ni E2E Android. D-13/adquiriente, credencial fiscal, rangos y autorización reales siguen siendo dependencias independientes. No se emite documento ante un proveedor ni se usa una base persistente. D-21 y D-22 continúan abiertos.

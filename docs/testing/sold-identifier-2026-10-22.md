# D-23 — identificador realmente utilizado en la venta

Base `f27cddd8df201a3ba1590d0372665313ec88df37`, rama activa Android. Incremento independiente de DEV-003/D3: se conserva el motor compartido, sin habilitar un login ni ejecutar una venta productiva.

El carrito compartido envía el código interno al seleccionar catálogo y el barcode devuelto al resolver un escaneo. `sale.create.lines[].identifier` es opcional para callers anteriores. El caso de uso valida el dato contra el producto/presentación del catálogo bajo alcance confiable **después de autorizar**, conserva el snapshot en la columna existente y devuelve `IDENTIFIER_MISMATCH` sin efectos ante un identificador ajeno. Precio, actor y permisos continúan derivados por backend. Los recibos existentes ya leen esa columna, sin otro modelo de recibo.

El identificador explícito participa en el checksum de idempotencia. Si se omite, la forma antigua del checksum permanece idéntica; el snapshot queda NULL porque no se conoce lo utilizado. No se rellenan ventas históricas ni se afirma que seleccionar un producto equivale a escanearlo. No se alteran migraciones, pagos o impuestos.

Ejecución Windows/Node 22.19, SQLite temporal:

- `pnpm --filter @pos-platform/pos-local-service exec vitest run tests/sale.test.ts -t D-23`: 4/4 nuevas, 45 omitidas; `artifacts/android-runtime/2026-10-22/sold-identifier-tests.log`.
- Regresión de la dependencia modificada `tests/sale.test.ts`: 49/49, `sold-identifier-sale-regression.log`. Incluye autorización, alcance, cálculo y persistencia existentes. Primera ejecución tuvo dos errores en consultas de los tests nuevos (tabla mal nombrada y rowid en tabla WITHOUT ROWID); corregidos, no se atribuye ese fallo al producto.
- Contrato `tests/sale-identifier.test.ts`: 1/1; omisión compatible, límites y rechazo de precio no permitido.
- Renderer `tests/renderer/SalePanel.test.tsx`: 34/34, incluyendo contrato del identificador del escaneo. jsdom con transporte de prueba; **no E2E físico**.
- TypeScript contracts/local-service/desktop y renderer: exit 0. ARCH-003 y política de repositorio se verifican antes de publicar.

El primer comando vía `pnpm test -- ... -t` no trasladó el filtro a Vitest; la regresión completa se ejecutó porque la venta es una dependencia directamente modificada. El comando reproducible focalizado usa `exec vitest` como arriba.

Estado D-23: IMPLEMENTED/TESTED en la cadena compartida contrato/handler/caso de uso/SQLite y renderer. No se declara E2E Android ni recibo físico comercial, pendientes de autoridad y canal aprobados. D-19, D-21 y D-22 se mantienen separados; no se cierran por este cambio.

# Importación CSV de catálogo — 2026-10-22

Base `49452137069477f92feef156d69a1d59a92159af`, única rama activa. Continúa la pantalla/IPC/caso de uso/stores existentes. No añade backend paralelo, tabla de importaciones, permiso ni canal. No importa existencias, costos ni documentos de compra.

En el panel de catálogo: descargar plantilla CSV, elegir coma o punto y coma y abrir archivo UTF-8 exportado desde una hoja de cálculo. Máximo técnico 1 MiB, 1000 registros, 4096 caracteres por celda; NUL, UTF-8 inválido, cabeceras desconocidas/repetidas y comillas inconsistentes rechazados. Admite separadores/comillas/saltos de línea entre comillas y BOM. La fila mostrada es el número de registro lógico CSV, no necesariamente línea física si hay textos multilínea. Las celdas se presentan como texto React, sin evaluar fórmulas.

Vista previa con código/nombre/precio normalizado/errores por registro, códigos/barcodes duplicados y consulta mediante `catalog.item.list/find` autorizados. Las coincidencias visibles son informativas: una consulta paginada o un producto inactivo no permiten afirmar inexistencia. No se actualizan productos existentes ni se resuelve un barcode ambiguo por inferencia. La confirmación final sigue dependiendo del backend y sus índices; los duplicados se presentan como desenlace, sin sobrescribirlos.

La confirmación es **por fila**, cada una con su transacción canónica producto/presentación/precio/fiscal/auditoría/outbox. No se promete atomicidad de todo el archivo. Clave estable `catalog-csv:<SHA256 del contenido>:<registro>`; es idempotencia, nunca autenticación. Tras un resultado de transporte incierto se detiene y exige reintento explícito del mismo archivo. Las filas ya confirmadas se recuperan por el ledger `runtime_operations` existente; no se crea ledger cliente ni se guardan secretos en localStorage. Las operaciones/outbox y correlaciones existentes permiten rastrear cada registro. Un archivo editado tiene otro hash; las unicidades backend siguen evitando altas duplicadas.

Corrección relacionada en `SqliteCatalogStore.register`: al resolver idempotencia exige tenant **y empresa**, además de la clave. Antes una solicitud autorizada desde otra empresa del mismo tenant/actor podía recibir la referencia del producto anterior. Ahora devuelve conflicto, sin filtrar esa referencia. No cambia el checksum de callers previos.

Pruebas observadas:

- `pnpm --filter @pos-platform/pos-desktop exec vitest run --config vitest.config.ts tests/renderer/catalog-csv.test.ts`: 5/5. CSV/BOM/citas/decimales, duplicados, cabeceras ajenas, límites, reanudación con claves idénticas, denegación/resultado pendiente.
- `... tests/renderer/AdminPanels.test.tsx -t CatalogPanel`: 7/7, 20 omitidas. Nueva prueba conduce carga → lectura de coincidencias → vista previa sin mutación → confirmación por contrato existente; verifica que no se invoca inventario. jsdom/transporte controlado, no E2E físico.
- `pnpm --filter @pos-platform/pos-local-service exec vitest run tests/catalog.test.ts -t 'CSV retry'`: 1/1, 20 omitidas, SQLite temporal real para el conflicto de empresa.
- TypeScript desktop/renderer y local-service; ARCH-003 y política verificados antes de publicar.

Límites del incremento: CSV compatible con exportación Excel; **no lector binario XLS/XLSX**. No PDF/IA ni XML de proveedor: no se recibió formato/namespace/XSD y no se adivina un mapping. No GoodsReceipt, cuenta por pagar o pago a proveedor. La carga no incrementa stock. No hay prueba de importación física en Android porque aún no existe autoridad/canal comercial aprobados.

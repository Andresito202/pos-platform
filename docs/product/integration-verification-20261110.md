# Estado verificable de integraciones — 10 de noviembre de 2026

Base inspeccionada: ad5e057bd150fe74073465d87d6c1cf3382745ae, rama única de trabajo `cursor/commercial-design-review-0d11`. Este incremento modifica inventario en los componentes reales. No crea otro producto ni cambia autorizaciones comerciales.

## Inventario

Antes: el importador de catálogo no registraba existencias. El formulario manual generaba una nueva clave por intento; perder una respuesta podía llevar a registrar otro movimiento al repetir.

Ahora: lector CSV acotado compartido; plantilla de existencias separada; validación completa antes de escribir; confirmación secuencial por el canal existente con permiso de recepción. Cada fila conserva `import_id` UUIDv4 y `row_id` positivo. El servicio decide permisos, existencia del producto e idempotencia. Los lotes son parciales, no una transacción global: las filas ya confirmadas permanecen y se pueden reenviar con sus mismas claves. Se detiene al primer rechazo o resultado incierto. Límite 1 MiB y 1000 filas.

Columnas: `import_id;row_id;presentation_id;movement_type;quantity;reason_code;business_date`. Movimientos: OPENING_COUNT, PURCHASE_RECEIPT, TRANSFER_IN. Cantidad positiva con punto decimal, máximo seis decimales, fecha AAAA-MM-DD; presentación existente. La cantidad SUMA stock: no reemplaza la existencia actual. Para múltiples filas se conserva import_id y se numera row_id 1, 2, 3… Otro lote requiere otra plantilla/identidad. No importa compras, costos ni facturas de proveedor. CSV UTF-8 editable en Excel; XLSX no implementado.

Formulario manual: bloqueo de doble envío y retención de payload/clave para reintentar mientras el componente permanece montado. **Limitación:** el pendiente manual no es durable ante cierre, recarga o desmontaje de la pantalla; debe añadirse recuperación persistente antes de certificar ese escenario. No se afirma recuperación del formulario después de perder la sesión. La identidad del CSV sí permanece en el archivo.

## Pruebas ejecutadas

- Desktop: 283 pruebas aprobadas / 34 archivos. Incluye validación del lote, reordenamiento, reintentos, denegación de permisos, respuestas incompletas y doble envío manual. Los tests renderer usan dobles del canal; no son E2E Electron/SQLite.
- Local-service: 68 aprobadas / 5 archivos: inventory, fiscal-issuance, factus-bill-assembly, license-capacity, license-offer-catalog. Persistencia SQLite real en las pruebas aplicables, proveedor fiscal simulado.
- Fiscal-adapters: 173 aprobadas, 2 omitidas por no disponer de credenciales de sandbox.
- Central Factus Pay (eventos/webhook): 12 aprobadas, 1 omitida por faltar POSTGRES_TEST_URL.
- TypeScript renderer y build renderer aprobados. Dependencias de caché, no instalación reproducida con frozen-lockfile. No certifica Windows, Android ni Linux empaquetado.

## Factus y administración global

Factus Pay dispone de creación/consulta de recaudos, verificador y recepción de webhook. Esto acredita rutas de código, no un pago real. No están disponibles en este entorno las variables de sandbox fiscal, POSTGRES_TEST_URL ni los archivos de provisión de Factus Pay. No se llamó /auth ni se emitió una factura, cobró dinero o modificó una licencia comercial.

Central expone rutas de emisión, asignación y revocación de activaciones bajo sesión GLOBAL y controles de permisos. `PlatformClient` conecta planes y ahora consulta/revoca activaciones; todavía no conecta emisión y asignación desde el panel. Esto no acredita una consola completa de licencias/bloqueos. Los indicadores vacíos del panel no son métricas reales. Un superadministrador local de desarrollo no sustituye la sesión GLOBAL autenticada con MFA.

## Criterios de cierre aún no cumplidos

1. Completar emisión/asignación desde la consola GLOBAL y ejecutar consulta/revocación contra PostgreSQL y una sesión GLOBAL real.
2. Factura sandbox aceptada y consulta del documento con evidencia del proveedor; pago sandbox y webhook real con conciliación, duplicados y aislamiento.
3. Recuperación durable de operaciones manuales inciertas; revisar igualmente reintentos fiscales tras UNCERTAIN.
4. Login BUSINESS/SCM y revocación acreditados en entorno compatible, no solamente unit tests.
5. Comparación visual ejecutada contra las referencias y flujos reales de todos los roles. La conexión de la vista previa ha fallado; no se declara diseño 1:1.
6. Consolidación de Android comercial, empaquetado y E2E de venta/offline/sincronización/dispositivos por plataforma.

La configuración final de VPS y dominio no resuelve estos puntos por sí sola. El estado correcto es desarrollo integrado parcialmente verificado, no listo para distribuir.

## Incremento: consulta y revocación desde superadministración

El portal GLOBAL muestra una pestaña Licencias con activaciones reales, estados y acción de revocación confirmada. El nuevo POST `/v1/platform/licenses/activations` acepta exclusivamente `{after: UUID|null}` y devuelve páginas de hasta 50 registros, con cursor. Exige sesión GLOBAL, CSRF, HTTPS y permiso LICENSE_REVOKE igual que la acción de revocación. La autoridad vuelve a verificar sesión, credenciales vigentes y permiso dentro de la transacción antes y después de la lectura. No devuelve claves, firmas ni payloads de autorización.

La revocación reutiliza el endpoint existente, no cambia su semántica ni el protocolo de distribución: revocado en Central NO significa bloqueo instantáneo de un equipo offline. No cancela la licencia de toda la empresa, no libera cupos automáticamente y no incluye un botón de reactivación inexistente. La pantalla identifica empresa/licencia/dispositivo mediante sus IDs reales; los nombres comerciales aún no se consultan.

Validación de este incremento: 286 pruebas desktop aprobadas, cuatro pruebas unitarias de la consulta Central aprobadas, TypeScript renderer y build renderer aprobados. La prueba de Central usa pool y autoridad de sesión simulados: comprueba límites, proyección, argumentos, rechazo y rollback; no acredita ejecución física de SQL/RLS. El typecheck completo de Central está bloqueado por la dependencia `@simplewebauthn/server` ausente del entorno de caché (17 diagnósticos TS2307). No se ha rebajado el contrato ni simulado esa dependencia para anunciar éxito. Falta PostgreSQL provisionado para acreditar el recorrido HTTPS/MFA/CSRF/SQL completo.

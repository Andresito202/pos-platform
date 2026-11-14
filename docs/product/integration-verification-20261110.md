# Estado verificable de integraciones — 10 de noviembre de 2026

**Actualización 11 de noviembre:** el bloqueo de dependencias WebAuthn se resolvió y ocho escenarios HTTP/SQL aprobaron en PostgreSQL 16.14 real. [Evidencia y límites](../testing/central-physical-20261111.md). Las menciones de PostgreSQL no disponible más abajo describen el estado previo. Factus externo y Electron Windows siguen pendientes.

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

Central expone rutas de emisión, asignación y revocación de activaciones bajo sesión GLOBAL y controles de permisos. `PlatformClient` conecta planes, consulta/revocación de activaciones y emisión/asignación mediante referencias registradas en Central. Esto no acredita el recorrido físico completo de licencias/bloqueos. Los indicadores vacíos del panel no son métricas reales. Un superadministrador local de desarrollo no sustituye la sesión GLOBAL autenticada con MFA.

## Criterios de cierre aún no cumplidos

1. Ejecutar emisión/asignación/consulta/revocación contra PostgreSQL y una sesión GLOBAL real; completar consulta de pagos/licencias y referencias de cajas; los selectores de sucursal y credencial ya consultan opciones autorizadas.
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

## Incremento: emisión y asignación desde el portal GLOBAL

La pestaña Licencias incluye emisión/recuperación de contrato desde un paymentId y asignación de cajas a una credencial aprovisionada. Usa `/v1/platform/licenses/issue` y `/v1/platform/licenses/allocate`, ya existentes; no crea pagos ni cambia importes, políticas, firmas o autoridad. El backend mantiene LICENSE_ISSUE, pago confirmado, capacidad pagada, pertenencia de sucursales y vínculo del dispositivo. La interfaz valida UUID, cajas duplicadas, respuesta y confirmación explícita de asignación. Máximo de captura: 100 cajas por solicitud en la interfaz; no representa capacidad concedida.

El reintento de emisión conserva el pago como referencia natural. La asignación conserva el mismo payload y clave al reintentar; una respuesta incierta impide editar el borrador, mientras que un rechazo HTTP explícito permite corregirlo. Cambiar de pestaña no desmonta los formularios. La memoria de solicitudes no es durable ante recarga o cierre; no se acredita ese escenario. El panel distingue contrato, asignación PENDING y activación: emitir no prueba activación ni concede permisos al usuario. Para contratos recuperados, no presenta el NOT_ACTIVATED histórico del endpoint como estado actual del dispositivo.

La operación requiere referencias reales (pago/licencia/credencial/sucursal/caja); la consulta posterior incorpora nombre de empresa, sucursales y credenciales; el registro de dispositivos no contiene nombre comercial. Esto es una integración funcional para administración con referencias conocidas, no una afirmación de UX comercial terminada.

Validación: 290 pruebas desktop, TypeScript renderer y build aprobados. Los cuatro tests nuevos verifican rutas/payloads, validación, confirmación, rechazo, reintento idéntico y doble clic. Se corrigió una carrera en el test de navegación del supervisor: esperaba inmediatamente un componente cargado con lazy import; ahora espera su aparición. Los proveedores y el canal HTTP se simulan en estas pruebas. No se emitió ninguna licencia comercial desde esta sesión ni se llamó Factus real.

## Incremento: opciones de asignación vinculadas a la licencia

POST `/v1/platform/licenses/assignment-context` acepta únicamente `licenseId` bajo HTTPS, CSRF, sesión GLOBAL y LICENSE_ISSUE. Deriva tenant y empresa desde licencia/pago/cotización; no admite esos identificadores del navegador como autoridad. Consulta sucursales activas de esa empresa y credenciales DEVICE_TRUST vigentes de dispositivos activos con el vínculo completo de instalación, empresa y claves. Verifica la autorización antes y después de la consulta. Responde únicamente IDs, nombres de empresa/sucursal y vencimiento de credencial; nunca material criptográfico ni firmas.

La interfaz permite cargar esas opciones, muestra el nombre real de empresa y sucursales, y limpia credencial/cajas cuando cambia la licencia. Cada lista está limitada a 100 opciones; indica explícitamente si hay más. No se representa la consulta parcial como un catálogo completo. Continúa disponible la captura manual sin consulta. La asignación definitiva vuelve a aplicar todas las comprobaciones existentes; esta vista de opciones no concede capacidad.

Límites: el registro central de dispositivos no define un nombre visible, por lo que se muestran sus IDs reales. No se encontró catálogo central de nombres de cajas en la autoridad consultada: la caja sigue requiriendo su referencia local, cuya existencia/alcance valida Cash en el runtime. La licencia y el pago tampoco cuentan aún con selector por nombre. No se añadieron datos ficticios ni nuevos registros de caja para rellenar la pantalla.

Validación: 292 pruebas desktop aprobadas, siete pruebas focalizadas de Central (cuatro anteriores + tres nuevas) aprobadas, TypeScript renderer y build aprobados. Incluye limpiar opciones al cambiar licencia, rechazar contexto de otra licencia, derivar el scope exclusivamente del servidor y no consultar tras denegación. Las pruebas de SQL usan dobles; permanece pendiente ejecución con PostgreSQL/RLS y sesión GLOBAL reales. No cambia el estado de certificación comercial, Factus, Windows/Android ni QA visual.

## Inventario: respuestas no concluyentes — 11 de noviembre

El formulario manual ya no descarta su clave y payload ante una respuesta sin resultado, un rechazo de sesión, conflicto o respuesta incoherente. Exige SUCCEEDED + POSTED/IDEMPOTENT con secuencia y cantidad válidas para acreditar éxito. Solo libera un rechazo de negocio conocido y coherente si no hubo antes incertidumbre de transporte. Una consulta de stock tampoco puede solaparse y liberar el bloqueo de un movimiento en curso. Mientras hay un pendiente, registra beforeunload; esto no constituye persistencia ni prueba física de cierre Electron.

La regresión descubrió una respuesta simulada incorrecta en AdminPanels: SUCCEEDED con INSUFFICIENT_STOCK. Se ajustó a REJECTED, como devuelve el handler real. Validación: 300 pruebas desktop aprobadas, TypeScript renderer y build aprobados; ocho casos nuevos de respuestas inconsistentes, identidad de reintento, cierre y concurrencia.

**Limitación crítica vigente:** el pendiente vive en el componente. La revocación/revalidación de acceso puede desmontarlo; cerrar/recargar también lo pierde. No se guardó en localStorage con username porque ese dato no identifica de manera suficiente usuario/tenant/sucursal/dispositivo. Falta un diario durable de solicitudes ligado a identidad y scope verificados por el servicio. No afirmar recuperación completa ni certificar inventario frente a reinicio con esta protección parcial.

## Emisión fiscal: bloqueo por resultado incierto — 11 de noviembre

Se corrigió una contradicción entre el comentario y la interfaz: UNCERTAIN/REQUIRES_RECONCILIATION mostraban aviso pero dejaban activos ambos botones de emisión. El hook ahora bloquea la venta/tipo de documento al recibir esos resultados, perder la respuesta o recibir un sobre incoherente. Hay exclusión síncrona de doble envío. La pantalla deshabilita ambos botones para la venta afectada; cambiar a otra venta no borra el bloqueo anterior ni muestra su resultado bajo el nuevo ID. Solo se presenta éxito con respuesta coherente y validada por el contrato.

Validación: **305 pruebas desktop aprobadas**, TypeScript renderer y build aprobados. Cinco casos nuevos de hook y una ampliación de la prueba de panel verifican bloqueo, retorno a la venta original, aislamiento entre ventas, pérdida de respuesta y doble clic. Pruebas de frontend con doble del canal: no equivalen a emisión externa.

Límite vigente: el bloqueo de interfaz vive en memoria del componente. Al reiniciar, el backend sigue siendo la autoridad y mantiene sus estados de documento; no hay conciliación automática nueva, botón ficticio para conciliar ni evidencia de factura emitida en Factus externo. La recuperación durable y conciliación física siguen pendientes.

## Rechazo fiscal distinguido de emisión — 11 de noviembre

Se reprodujo un defecto del servicio: persistía normalized_result=REJECTED pero devolvía ISSUED. La corrección introduce FISCAL_REJECTED en el contrato IPC, el handler y la pantalla. COMPLETED describe el transporte, no la aceptación fiscal. Una segunda solicitud recupera primero la identidad persistida: devuelve el rechazo sin transmitir otra vez ni colisionar con el índice único. Un documento CANCELLED exige revisión. Las consultas por identidad y por venta también filtran empresa y sucursal, además del tenant.

Validación: 33 pruebas de emisión fiscal aprobadas, incluyendo rechazo persistido, una sola llamada al proveedor e aislamiento de consultas entre empresas/sucursales; 306 pruebas desktop aprobadas; TypeScript del servicio local y renderer, y build renderer aprobados. El rechazo se comprobó con un proveedor simulado: no acredita Factus externo ni corrige automáticamente una factura rechazada.

## Requisito acordado: cliente en espera

Pendiente de implementación después del cierre de integraciones en curso. En el carrito del cajero debe existir un botón pequeño «En espera». Debe conservar productos, cantidades, cliente y descuentos válidos al atender otra venta; permitir listar y recuperar pendientes sin mezclar carritos ni perder cambios. Debe usar ventas persistidas del servicio con aislamiento por negocio/sucursal/caja y autorización, no una copia únicamente en memoria del navegador. Suspender no equivale a cobrar, confirmar pago, emitir factura ni cancelar. No debe liberar ni duplicar un pago en curso: ese caso requiere una decisión explícita del servicio.

Pruebas de aceptación pendientes: alternar entre dos clientes, recuperar después de reiniciar, cantidades/descuentos correctos, doble clic sin duplicados, permisos/aislamiento, pago en curso y rechazo de recuperación concurrente. Esta sección registra el alcance autorizado; no afirma que la función esté disponible.

## Caja: conservar la identidad después de perder respuesta — 11 de noviembre

Defecto reproducido con una prueba de SalePanel: tras perder la respuesta de un cobro, un reintento REJECTED/UNAUTHORIZED borraba el pendiente, aunque no demostraba si el primer cobro había sido aplicado. La prueba falló antes de la corrección. Ahora la solicitud recuerda la incertidumbre y conserva el mismo sobre y clave ante rechazos posteriores o resultados desconocidos. El botón de recuperación reenvía la solicitud original, no construye otro cobro. Se registra beforeunload mientras exista un pendiente y se retira al recuperarlo.

Validación: 309 pruebas desktop aprobadas, TypeScript renderer y build aprobados. Tres casos nuevos ejercitan pérdida de respuesta seguida de UNAUTHORIZED, VERSION_CONFLICT y UNKNOWN_OUTCOME, y finalmente recuperación IDEMPOTENT con la misma solicitud, sin sonido de cobro duplicado. Son pruebas de interfaz con transporte simulado.

Límites: beforeunload no es persistencia ni certificación de cierre Electron. Un desmontaje por cambio de sesión/autorización o reinicio sigue perdiendo el pendiente del renderer. Este cambio tampoco incorpora validación estricta de todos los sobres SUCCEEDED. Es necesaria una recuperación durable con identidad y scope verificados en el servicio; no se acredita recuperación integral ni pagos reales.

Diagnóstico para «En espera»: useCommercialSale conserva las líneas en estado React. El contrato comercial revisado expone sale.create pero no listar/recuperar borradores. SqliteSaleStore persiste la venta creada con su numeración y outbox; no debe usarse como guardado de un carrito editable sin definir antes su ciclo de vida. La función acordada requiere persistencia y operaciones autorizadas de borrador, separación de pagos en curso y control de concurrencia. Sigue pendiente; no se añadió un botón sin respaldo funcional.

## Clientes en espera — incremento del 13 de noviembre

Las notas anteriores que lo marcaban pendiente quedan sustituidas en su alcance por [Clientes en espera](waiting-carts.md): guardado/consulta/recuperación/eliminación conectados desde SalePanel al servicio y SQLite; conversión atómica al caso de uso existente de venta, aislamiento por operador y dispositivo, versiones y reintentos. Recupera el turno propio OPEN al consultar un carrito guardado después de reiniciar. No recupera pagos inciertos ni implementa cliente comercial/descuentos ausentes del carrito actual. No se declara E2E Electron o Android.


## 2026-11-13 — caja, cliente en espera y base de inventario sectorial

Base remota inspeccionada: c759ee40812d40fbf3477171a30bf636866a8112, rama cursor/commercial-design-review-0d11. Incremento sobre esa misma línea, sin merge a main. El SHA del incremento se identifica en el commit que contiene esta sección.

Cambios materializados:

- Cliente real opcional en carrito en espera: customer.find/get, referencia persistida en payload SQLite, validación del permiso y empresa al guardar. No equivale todavía a asignación automática del adquiriente de la factura final.
- Nequi/Daviplata con controles compactos separados y provider_code de transferencia; no se simula confirmación bancaria.
- Catálogo, comprobantes y monto administrativo presentan COP legible sin alterar el valor fuente. Prueba de recibo actualizada por el cambio de presentación esperado, no de cálculo.
- Mostrador sale.create exige turno OPEN en la transacción que crea la venta. Un channel alternativo no evade la regla del adaptador. Se rechazan caja ausente y turno CLOSING antes de numerar/escribir; un replay de venta ya creada se conserva aunque el turno cambie. El test fiscal D19 se actualizó para publicar su caja y abrir el turno antes de vender, conforme al nuevo requisito.
- Apertura informa errores junto al formulario y rechaza identificador inválido antes de transmitir. No resuelve todavía la pantalla administrativa de habilitación/asignación.
- Inventario verifica precisión/unidad, cantidad positiva y rango numeric(19,6), saldo máximo y empresa. Rechazos previos a escritura y reintentos idempotentes. El frontend permite corregir rechazos definitivos sin cambiar solicitudes de resultado incierto.
- Matriz de soporte sectorial en business-types.md: revisados contratos existentes y fuentes INVIMA. Lotes/FEFO, despiece y recetas siguen sin operación completa; la documentación no los da por implementados.

Ejecución observada en Linux, Node 24.22.1:

| Comprobación | Resultado |
|---|---|
| Desktop, 37 archivos | 319 PASS |
| Servicio: canal real, venta, caja vinculada, inventario, espera y autorización local, 6 archivos | 127 PASS |
| Regresión adicional caja/pagos/cantidades de recepción, 3 archivos | 65 PASS |
| Contratos, 20 archivos | 298 PASS |
| Local-channel, 6 archivos | 47 PASS, 4 SKIPPED |
| TypeScript servicio y renderer | PASS |
| Vite build renderer | PASS |

Total de las suites indicadas: 856 pruebas aprobadas y 4 omitidas. Las pruebas de canal usan socket TCP loopback real en Linux, handler de producción y SQLite; no representan SCM Windows. Las pruebas de UI usan transporte simulado. No se ejecutó verificación visual en Electron/Android ni servicio bancario/Factus externo para este incremento. Dependencias disponibles de caché: Vitest 4.1.11 y Vite 6.4.3; no se acredita frozen-lockfile ni el comando completo desktop con E2E Playwright.

Pendientes conservados en el backlog: asignación administrativa de caja, métricas por medio de pago, adquiriente final, sincronización entre dispositivos y autoridad de perfiles sectoriales; inventario especializado y XLSX; Factus externo, licencias BUSINESS/SCM y verificación física multiplataforma. No se declara el sistema listo para despliegue comercial integral.


## 2026-11-13 — continuación: licencia por venta y superadministrador

**Registro histórico supersedido: se interpretó incorrectamente la venta de licencias como venta de productos. La aclaración posterior restaura la exclusión de Caja del superadministrador.** Base: 2c3214e1e9f10fabe68f28a309789da3be1c9a43, misma rama activa. La orden posterior del propietario permite vender al superadministrador dentro del negocio; sustituye su antigua exclusión de Caja. Permanecen las pruebas de denegación para supervisor/administrador; superadministrador obtiene permisos de negocio sin LICENSE_PLAN_MANAGE local. La navegación sigue filtrando las capacidades del servicio.

CommercialComponent conecta el verificador de capacidad al escritor de ventas. El test con canal real abre turno y vende, cambia la decisión de licencia a expirada/revocada y verifica que una nueva venta no se escribe ni avanza el número; el replay conserva su ID. La política del gate está inyectada en esa prueba: no es un pago externo. Por separado, SQLite con Ed25519 real comprueba validez hasta el milisegundo anterior al vencimiento y rechazo desde el instante exacto, incluso tras reiniciar. Central prueba ACTIVE/PAST_DUE a ambos lados de los tres días y niega vigencia perpetua morosa.

Resultados: 99 pruebas del servicio, 318 de escritorio, 12 de vigencia central, 298 de contratos y 47 de local-channel; 4 local-channel omitidas. Total 774 aprobadas. No es comparación de cobertura total con el incremento anterior: cambia la selección de suites y se sustituyen expectativas que prohibían vender al superadministrador. TypeScript servicio/renderer/Central y Vite build renderer aprobados, usando las dependencias de caché ya documentadas; sin frozen-lockfile.

Límites: login local de desarrollo no acredita BUSINESS; contexto fijado por servicio, sin selector multiempresa libre; sin verificación visual Windows/Android, prueba de carga ni recorrido externo pago→renovación→descarga. Revocación offline depende de recibir evidencia firmada; vencimiento firmado se comprueba localmente sin añadir gracia.


Prueba adicional del mismo incremento: LicenseCapacityGate real con firma Ed25519 de pruebas, sesión autorizada, canal TCP y escritor SQLite. Una licencia expirada bloquea la nueva venta; un artefacto firmado de versión superior válido la permite, y repetirla conserva una sola fila. El reloj del servicio y el de licencia se inyectan desde la misma fuente, respetando el antirretroceso. Se prueban firma y consumo local del artefacto; no se sustituye con esto la prueba del pago ni la emisión/descarga externa.


## Cliente de la venta y corrección de roles — 2026-11-13

Base remota: c780b5e69d7e7bbf493c2fdfa27e3e3ecf5d9abf. Misma rama cursor/commercial-design-review-0d11; sin nuevo POS, rama ni fusión a main.

- Corrección explícita: superadministrador vende LICENCIAS mediante GLOBAL, no productos. Se revierte su concesión local de Caja/catálogo/inventario introducida en c780b5e6; vuelve a auditoría. Administrador y supervisor siguen sin venta/carrito. Hay pruebas negativas de servicio y navegación. Esto no certifica login BUSINESS ni reemplaza autorizaciones firmadas.
- Cliente→venta→factura: sale.create transmite customer_id; el servicio exige lectura de clientes y pertenencia a tenant/empresa, persiste la referencia y la incluye en auditoría/outbox. La identidad forma parte del checksum para ventas identificadas; anónimas conservan compatibilidad.
- Migración SQLite 020 aditiva: sales_sales.customer_id nullable, índice y triggers de referencia compuesta/inmutabilidad. No modifica migraciones 001–019 ni inventa clientes para ventas antiguas. Prueba de actualización desde v19 conserva una venta completada y verifica integridad.
- FiscalPanel tiene acción explícita «Emitir con cliente de la venta», usando SALE_CUSTOMER. El servicio carga la venta completada del ámbito autorizado y rechaza cambiar/quitar el cliente asociado. Ventas históricas sin vínculo mantienen selección manual. La prueba de canal llega hasta el payload fiscal congelado con proveedor simulado; no acredita aceptación por FACTUS/DIAN.
- Cuatro asignaciones sucesivas de licencias en el panel mantienen licencia, credencial, cajas e idempotencia separadas y limpian selección anterior. Prueba de UI con Central simulado, no cuatro compras reales ni prueba PostgreSQL de aislamiento extremo a extremo.

Validación de este incremento: servicio 99 PASS; desktop 321 PASS; SQLite 59 PASS; contratos 298 PASS; canal local 47 PASS/4 SKIP. TypeScript servicio, renderer y proceso principal PASS; compilación Vite PASS. Entorno usa Vitest 4.1.11 y Vite 6.4.3 disponibles en caché (distintos de versiones fijadas); no se acredita instalación frozen-lockfile ni CI remoto. Las cuatro pruebas de canal omitidas no se dan por aprobadas.

Brechas abiertas y prioridad: farmacia/droguería, salsamentaria con base avícola y pastelería aún necesitan lotes, vencimientos/FEFO, transformaciones/recetas y proyección de habilitación sectorial. No existe todavía contrato sectorial de licencia completo. Tampoco se acredita aplicación central del nuevo customer_id de outbox, sincronización entre dispositivos, FACTUS externo, capacidad bajo carga, Windows SCM físico ni Android físico. No distribuir como producto sectorial terminado por estas pruebas.

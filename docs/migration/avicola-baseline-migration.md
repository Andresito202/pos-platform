# Migración desde la base avícola

## Objetivo

Usar el proyecto supermercado-avicola como línea base auditada, sin convertirlo directamente en la arquitectura final.

## Estado de la base

El proyecto actual contiene:

- FastAPI;
- SQLAlchemy;
- Alembic;
- PostgreSQL;
- autenticación JWT;
- roles simples;
- productos;
- categorías;
- compras;
- inventario;
- lotes;
- ventas;
- caja;
- reportes;
- pruebas iniciales;
- frontend HTML y JavaScript.

## Clasificación

### Reutilizar conceptualmente

- FastAPI.
- SQLAlchemy.
- Alembic.
- PostgreSQL.
- Decimal y Numeric para dinero.
- modelos básicos de ventas;
- inventario por movimientos;
- lotes;
- caja;
- autenticación;
- pruebas iniciales.

### Refactorizar

- autenticación;
- roles;
- ventas;
- compras;
- inventario;
- caja;
- reportes;
- valores heredados candidatos a configuraciones nativas, sujetos a clasificación por dominio;
- auditoría;
- manejo de lotes.

### Reemplazar

- frontend HTML estático;
- navegación actual;
- estructura de interfaz;
- configuración específica de avícola sin ownership, scope o versión demostrables;
- semillas de demo;
- creación automática de tablas en producción;
- administración global simple;
- numeración de venta basada en conteo.

### Crear

- tenants;
- empresas;
- sucursales;
- dispositivos;
- licencias;
- feature flags;
- precios versionados;
- pagos separados;
- caja por terminal y turno;
- snapshots;
- idempotencia;
- outbox;
- sincronización;
- operación local-first;
- panel del propietario;
- backoffice;
- apps de comprador y domiciliario;
- servicio de hardware.

## Estrategia

1. Conservar el tag `baseline-avicola-audit`.
2. No modificar el repositorio público original.
3. Trabajar únicamente en `pos-platform`.
4. Definir arquitectura antes de modificar modelos.
5. Crear nuevas migraciones; no reescribir silenciosamente la migración original.
6. Introducir multiempresa antes de agregar módulos nuevos.
7. Migrar caso de uso por caso de uso.
8. Mantener pruebas de regresión.
9. Eliminar código demo solo cuando exista reemplazo probado.
10. No desplegar cambios incompletos en producción.

## Orden de migración

### Etapa 1 — Fundación

- metadatos técnicos de entorno, separados de configuración de negocio;
- tenant;
- empresa;
- sucursal;
- usuarios;
- roles;
- permisos;
- dispositivos;
- licencias;
- auditoría.

### Etapa 2 — Catálogo

- productos;
- categorías;
- códigos;
- variantes;
- unidades;
- precios.

### Etapa 3 — Inventario y compras

- stock por sucursal;
- lotes;
- movimientos;
- compras heredadas interpretadas como evidencia histórica de recepción;
- GoodsReceipt, líneas y asignaciones de lote objetivo;
- proveedores.

### Etapa 4 — Caja y ventas

- cajas físicas;
- turnos;
- pagos;
- ventas;
- devoluciones;
- anulaciones;
- recibos.

### Etapa 5 — Local-first

- base local;
- UUID;
- outbox;
- idempotencia;
- sincronización;
- recuperación.

### Etapa 6 — Aplicaciones

- nuevo POS;
- panel del propietario;
- backoffice;
- comprador;
- domiciliario.

## Contrato de identificadores

1. Las entidades objetivo sincronizables usan UUID v7.
2. Los enteros heredados se conservan en una tabla o referencia de correspondencia `(source_table, legacy_id, target_id)`.
3. `legacy_id` nunca sustituye la PK objetivo ni se expone como autoridad de sincronización.
4. Los consecutivos humanos se migran como datos de negocio y no como PK.

## Mapeo obligatorio de datos heredados

### Tenancy

Antes de migrar datos operacionales debe existir una regla aprobada que asigne cada fila heredada a un Tenant, Company y Branch de transición. No se permiten valores nulos ni un tenant global compartido como bypass de aislamiento.

### Usuarios y roles

| Legado | Objetivo |
|---|---|
| `usuarios` | `User` global |
| `usuarios.rol` | `TenantMembership` activa + `UserRoleAssignment` al rol aprobado equivalente |
| `usuarios.activo = false` | User desactivado y assignments no vigentes |

El correo se normaliza antes de validar unicidad global. Una colisión no se fusiona automáticamente: se lleva a cuarentena con evidencia.

### Catálogo

Cada producto heredado genera:

1. un `Product`;
2. una `ProductPresentation` predeterminada con la unidad heredada;
3. el SKU o código heredado como identificador de la presentación;
4. una referencia de correspondencia entre IDs.

No se crea `ProductVariant` si el legado no contiene evidencia de variantes.

### Inventario y lotes

Los lotes, movimientos, mermas y detalles de recepción heredados se enlazan a la presentación predeterminada creada para su producto. `InventoryMovement` se migra como hecho; `StockBalance` se reconstruye desde movimientos y se compara contra cantidades heredadas.

Una diferencia no se corrige sobrescribiendo el movimiento: se registra en un informe de reconciliación y requiere ajuste explícito aprobado.

### Compras heredadas y recepción

La tabla heredada `compras` no representa una orden de compra, factura del proveedor, cuenta por pagar ni pago al proveedor. El endpoint heredado crea cada fila directamente como recibida, calcula sus detalles y, en la misma operación, crea lotes y movimientos de entrada. Por ello se conserva como evidencia histórica de una recepción física heredada, sujeta a reconciliación.

Mapeo permitido cuando la evidencia y los scopes son verificables:

- `compras` a `GoodsReceipt` histórico;
- `detalle_compras` a `GoodsReceiptLine` con la presentación predeterminada del producto;
- el lote relacionado a una `GoodsReceiptLotAllocation` y a su `InventoryMovement` de entrada;
- proveedor, fecha, cantidades, costo unitario, subtotal, total, observaciones y estado exactamente como consten en origen;
- `productos.precio_compra` únicamente como snapshot legado del último valor observado, nunca como costo histórico, valoración o precio autoritativo.

No puede reconstruirse sin evidencia adicional:

- PurchaseOrder ni cantidades ordenadas;
- recepciones parciales respecto de una orden;
- SupplierDocument, número o fecha de factura/remisión;
- impuestos o descuentos de compra y su inclusión en el costo;
- moneda cuando no exista una fuente autorizada;
- landed cost, método de valoración o costo contable;
- AccountsPayable o condiciones de crédito;
- SupplierPayment;
- tenant, empresa, sucursal o ubicación ausentes;
- código de lote real del proveedor cuando el legado generó uno sintético.

Los valores ausentes se registran como no disponibles; no se completan con defaults comerciales. Las anulaciones heredadas requieren reconciliación porque el flujo existente puede haber puesto el lote en cero y creado una salida por la cantidad original sin demostrar disponibilidad. Una anulación incoherente se conserva como evidencia o se lleva a cuarentena; no se transforma automáticamente en devolución al proveedor ni en corrección válida.

### Ventas

Las ventas cerradas se migran como históricas e inmutables. Cada línea conserva:

- referencia a la presentación migrada;
- nombre, código, unidad, cantidad y precio heredados;
- impuesto, descuento o costo solo cuando exista evidencia;
- `legacy_id` y fecha original.

No se inventan snapshots fiscales, promociones, descuentos o versiones inexistentes. Los campos desconocidos se marcan como datos heredados no disponibles.

### Devoluciones comerciales heredadas

Una fila heredada solo produce un `SaleReturn` histórico cuando existe evidencia inequívoca de la Sale y SaleItem originales, cantidad, resultado comercial, fecha y asignación aprobada de Tenant, Company y Branch.

Se preservan exactamente los identificadores, motivos, actores, cantidades, importes, impuestos, condición física y timestamps que consten en origen. No se infieren:

- aprobación o segregación de funciones;
- `Refund` o `Reversal`;
- CashMovement de salida;
- InventoryMovement de restitución;
- nota crédito u otro efecto fiscal;
- idempotency key, operation ID, checksum o versión de política histórica;
- condición física o destino de inventario ausentes.

Una anulación no se transforma automáticamente en SaleReturn. Devoluciones sin desglose de línea, con cantidad o valor superior a la venta, venta inexistente, tenant no verificable, pago mixto sin componentes o efectos financieros/inventario no reconciliables se conservan como evidencia y pasan a cuarentena. Los efectos separados se migran únicamente cuando su propia fuente los demuestra y quedan relacionados causalmente sin reescribir la venta.

### Pagos

`ventas.metodo_pago` se transforma en un `PaymentGroup` y un `Payment` cuando el medio y el importe son inequívocos.

Un valor heredado `mixto` sin desglose suficiente se migra como evidencia histórica no descompuesta y queda fuera de nuevas operaciones de refund automático hasta revisión. No se inventan importes, proveedores, referencias ni intentos.

### Reversal, Settlement y Reconciliation heredados

Una venta anulada, nota libre, diferencia de caja, fecha, estado genérico o cambio manual no demuestra por sí mismo un `Reversal`, `Settlement` o `Reconciliation` completado.

Solo se convierte un hecho cuando existen tenant/company/branch verificables, identidad de fuente, importes exactos, moneda, relación con el Payment original y evidencia suficiente. No se inventan referencias externas, idempotency keys, políticas de cálculo, tratamiento del bruto, evidencia de proveedor, aprobaciones ni estados finales.

Los componentes de Settlement se reconstruyen separados cuando la fuente los demuestra: bruto, comisiones, retenciones, refunds, reversals, contracargos, ajustes positivos, ajustes negativos y neto. Debe documentarse si el bruto incluye operaciones posteriormente reversadas o ya viene neto; una ambigüedad impide calcular un neto autoritativo y pasa a revisión.

El alcance heredado de conciliación se conserva como snapshot, no como agregado de periodo ni máquina paralela. Items e incidencias ambiguos se llevan a cuarentena. La migración no modifica Payment histórico para cuadrar Settlement o Reconciliation y debe detectar duplicados, doble consumo y contaminación cross-tenant antes del cutover.

### Caja

La tabla heredada `cajas` mezcla turno, base y snapshot de cierre. `movimientos_caja` conserva hechos básicos, pero no tiene tenant, empresa, sucursal, caja física separada, dispositivo, moneda explícita, idempotencia, secuencia, aprobación, referencia robusta o política.

Mapeo permitido con evidencia y reconciliación:

- cada `cajas` coherente puede producir un CashShift histórico después de asignar Tenant, Company, Branch y CashRegister mediante una regla de transición aprobada;
- cada `movimientos_caja` puede producir un CashMovement histórico conservando tipo, importe, usuario y timestamp;
- `monto_apertura` debe reconciliarse contra el movimiento `apertura`; nunca se crean dos efectos por la misma base;
- una caja heredada `cerrada` puede producir CashCount `CLOSING` histórico únicamente cuando `monto_cierre - monto_esperado = diferencia` con decimal exacto;
- una diferencia histórica distinta de cero crea CashDifferenceReview `REVIEW_REQUIRED` y su acción inicial con actor de migración; no se infieren aceptación, resolución ni aprobador;
- observaciones y estados se conservan como evidencia heredada.

No pueden reconstruirse sin evidencia adicional:

- arqueos parciales o ciegos;
- denominaciones;
- correcciones versionadas de conteo;
- tolerancia y versión de política;
- aprobaciones, segregación o investigación de diferencias;
- idempotency keys, checksums, correlation IDs o secuencia de movimientos;
- dispositivo, moneda o business date cuando no exista fuente autorizada;
- referencia exacta de venta, pago, refund o recaudo para movimientos genéricos.

Una fórmula incoherente, movimiento huérfano, apertura duplicada o turno imposible de aislar se lleva a revisión/cuarentena y no se presenta como cierre válido. No se inventan denominaciones, aprobadores o políticas para completar la historia.

### Auditoría

La auditoría heredada se encapsula en `AuditEvent` conservando el texto original. Tenant, actor y recurso se asignan solo cuando exista correspondencia verificable; la ausencia se representa mediante actor/tipo de migración, nunca mediante datos inventados.

### Configuraciones heredadas por dominio

El legado no contiene un agregado global de configuración reutilizable ni historia suficiente para demostrar versiones publicadas. `backend/app/core/config.py` representa settings técnicos de ejecución y no se migra como configuración de negocio.

`Producto.precio_venta`, `stock_minimo` y `es_perecedero` son valores de negocio candidatos, no evidencia de `PricingPolicyVersion`, `InventoryPolicyVersion` o `TaxRuleVersion`. Solo pueden alimentar drafts iniciales del dominio correspondiente después de:

- resolver Tenant y Company, y Branch cuando aplique;
- clasificar semántica, moneda, unidad, scope y vigencia;
- reconciliar duplicados y valores incompatibles;
- obtener revisión humana y motivo;
- publicar una versión nueva con checksum, sin atribuirle historia anterior.

No se inventan identidad histórica, autor, fecha de publicación, vigencia, prioridad, desempate, permiso, firma, checksum anterior ni relación de sustitución. Un valor ambiguo pasa a cuarentena.

No se crea `Configuration` global, key-value autoritativo ni JSON libre para absorber columnas heredadas. Pricing, Tax, Cash Register, Inventory, Payments, Electronic Invoicing, Authorization, Licensing y Devices reciben únicamente datos que su contrato nativo reconozca.

Las credenciales o secretos encontrados se rotan y se cargan al almacén aprobado; las tablas de negocio solo reciben referencias opacas. La migración conserva por separado snapshots tributarios de operación y snapshots de emisión fiscal cuando exista evidencia suficiente; nunca inventa un `fiscal_snapshot` combinado.

### Documentos electrónicos heredados

La auditoría del legado FastAPI/SQLAlchemy/Alembic no encontró agregados o tablas con semántica suficiente de `FiscalConnection`, `ElectronicDocument`, `FiscalSubmissionAttempt`, `FiscalArtifact`, `FiscalIncident` o `FiscalReconciliation`. Tampoco encontró evidencia estructurada de resolución/autorización, numeración fiscal, CUFE/CUDE, QR fiscal, XML/PDF, application response, respuestas de proveedor o webhooks.

Clasificación inicial:

- ventas, anulaciones, devoluciones y textos libres: `evidence only`, no documentos electrónicos;
- menciones aisladas de factura, NIT, resolución, QR, proveedor o estado: `ambiguous`;
- secretos o credenciales encontrados: `not migrable`, se rotan y no se copian;
- artefacto histórico futuro con identidad, checksum y referencias verificables: `migrable parcialmente` después de reconciliación;
- aceptación, timestamps, provider ID, CUFE/CUDE, numeración, versión, actor o estado no demostrados: no se inventan.

`FiscalDocument` heredado no se crea como alias o entidad paralela. Cualquier documento verificable se mapea al agregado canónico `ElectronicDocument`. Un número de venta, un Payment, una anulación, un SaleReturn, un Refund o una línea de auditoría no prueban emisión o aceptación fiscal. Lo ambiguo permanece en cuarentena o como evidencia, sin habilitar retry, correctivos automáticos ni descarga de artefactos.

### Dead letters y sincronización heredadas

La auditoría del legado no encontró `SyncOperation`, Outbox, Inbox, checkpoints, conflictos Sync, retries persistidos ni dead letters. Los errores HTTP, excepciones, mensajes de conexión del frontend o líneas de auditoría aisladas no demuestran una intención sincronizable recuperable.

Clasificación:

- migrable: ningún dead letter demostrado;
- parcialmente migrable: ninguno con identidad, tenant, checksum, intentos y causalidad suficientes;
- evidencia solamente: logs o auditoría que documenten un fallo, conservados de forma sanitizada como evidencia histórica;
- no migrable: errores o acciones abandonadas sin `operation_id`, tenant, payload checksum, retry history y causalidad.

No se inventan operaciones, dead letters, retries, aceptación/rechazo, actores, timestamps o causalidad a partir de logs. La puesta en marcha del stack objetivo comienza sus Outbox/Inbox/DeadLetter vacías y no convierte errores históricos en trabajo ejecutable.

## Cuarentena

Se llevan a cuarentena, sin inserción silenciosa en el modelo operacional:

- correos globales duplicados no resolubles;
- SKU duplicados dentro de empresa;
- productos sin unidad interpretable;
- lotes sin producto/presentación;
- movimientos huérfanos;
- ventas con totales incoherentes;
- pagos mixtos sin desglose;
- turnos de caja con fórmula de cierre incoherente;
- movimientos de caja huérfanos o base duplicada;
- auditoría sin correspondencia verificable;
- referencias cruzadas entre scopes incompatibles.

## Reconciliación obligatoria

Cada etapa produce y valida:

1. conteo origen, migrado, omitido y en cuarentena;
2. suma monetaria por moneda y fecha comercial;
3. saldo de inventario por presentación, ubicación y lote;
4. total de ventas y pagos migrados;
5. correspondencia completa de IDs;
6. huérfanos y violaciones de FK;
7. duplicados de claves naturales;
8. checksum o evidencia reproducible del lote migrado.

La migración no se considera aceptada mientras existan diferencias sin clasificación y aprobación explícita.

## Rollback

Las migraciones objetivo se crean como revisiones nuevas y no reescriben `001_initial_schema.py`. El rollback debe retirar exclusivamente estructuras o datos creados por la revisión objetivo, conservar los datos heredados y documentar cualquier operación no reversible antes de ejecutarla.

## Restricciones

- No copiar código sin comprender sus invariantes.
- No mantener lógica de negocio dentro de rutas HTTP.
- No introducir microservicios prematuros.
- No duplicar reglas entre frontend y backend.
- No conservar credenciales demo.
- No usar datos del portafolio como datos productivos.
- No ejecutar semillas de demostración automáticamente en despliegues compartidos o productivos; `SEED_DEMO_DATA` debe permanecer desactivado salvo ejecución local, explícita y aislada.

## Criterio de finalización

La migración termina cuando:

- el nuevo núcleo cubra los casos de uso aprobados;
- las pruebas críticas pasen;
- la demo antigua no sea necesaria;
- el modelo multiempresa esté probado;
- las dos modalidades de despliegue estén soportadas;
- exista rollback documentado.

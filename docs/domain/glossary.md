# Glosario del dominio

## Plataforma

Sistema completo administrado por el proveedor del software.

## Tenant

Unidad de aislamiento comercial y técnico. Representa a un cliente de la plataforma.

## Empresa

Negocio legal o comercial perteneciente a un tenant.

## Sucursal

Ubicación física u operativa de una empresa.

## Caja registradora

Punto operativo donde se inicia un turno, se registran ventas y se controla efectivo.

## Turno de caja

Periodo comprendido entre la apertura y el cierre de una caja por un usuario.

## Usuario

Persona autenticada que opera dentro de una empresa o de la plataforma.

## Pertenencia a tenant

Relación explícita y verificable entre una identidad global de usuario y un tenant.

Se representa conceptualmente mediante `TenantMembership`.

La pertenencia determina el tenant al que está asociado el usuario, pero no concede por sí sola todos los permisos.

Un usuario puede disponer de más de una pertenencia únicamente cuando la política del producto lo autoriza.

## Propietario del tenant

Usuario cuya `TenantMembership` utiliza `membership_type = OWNER`.

Representa la responsabilidad administrativa principal dentro del tenant.

Ser propietario no elimina validaciones RBAC, ABAC, MFA, reautenticación ni aislamiento entre tenants.

## Asignación de rol de usuario

Relación que asigna un rol y, cuando corresponda, alcance de empresa o sucursal dentro de una `TenantMembership`.

Se representa conceptualmente mediante `UserRoleAssignment`.

No determina pertenencia al tenant y no sustituye `TenantMembership`.
## Rol

Conjunto de permisos asignados a un usuario.

## Dispositivo

Identidad operativa autorizada para ejecutar el POS o servicios relacionados.

Se distingue de la instalación, la clave criptográfica y la evidencia de hardware.

La identidad del dispositivo no depende exclusivamente de una huella física.

## Producto

Entidad comercial que representa el artículo lógico compartido por la empresa.

## Variante

Combinación opcional de atributos comerciales de un producto, como sabor, color, talla, concentración o modelo.

Una variante no representa empaques, cantidades ni unidades de venta.

## Presentación

Forma concreta en la que un producto o una variante se compra, almacena, transforma o vende.

Toda venta, precio, inventario, lote y movimiento operativo resuelve finalmente a una presentación.

## Código de barras

Identificador escaneable asociado a un producto, variante o presentación.

Los códigos utilizados operacionalmente deben resolver finalmente a una presentación.

## Unidad de medida

Unidad física utilizada para comprar, almacenar, transformar o vender una presentación.

## Precio

Valor de venta aplicable según empresa, sucursal, canal, lista o vigencia.

## Inventario

Existencias disponibles de productos por sucursal y ubicación.

## Lote

Grupo de existencias de un producto con origen, costo, fecha y vencimiento comunes.

## Movimiento de inventario

Registro inmutable que incrementa o disminuye existencias.

## Reserva de inventario

Compromiso explícito de cantidad disponible para una operación futura sin registrar todavía una salida física.

Una reserva reduce disponibilidad, pero no existencia física.

Estados conceptuales:

- `ACTIVE`;
- `PARTIALLY_CONSUMED`;
- `CONSUMED`;
- `RELEASED`;
- `EXPIRED`.

## Saldo de inventario

Proyección derivada de existencias por producto, variante, sucursal, ubicación y lote cuando corresponda.

No constituye la fuente primaria de verdad.

La fuente de verdad de las variaciones de existencia son los movimientos de inventario.

## Traslado de inventario

Operación que mueve existencias entre ubicaciones autorizadas y conserva identidad, origen, destino, estado y trazabilidad.

No se representa mediante edición directa de saldos.

Los movimientos de salida y entrada permanecen vinculados al traslado.

## Línea de traslado de inventario

Detalle de producto, variante, lote y cantidades solicitadas, despachadas, recibidas y diferentes dentro de un traslado.

Permite representar recepciones parciales y diferencias sin sobrescritura silenciosa.

## Ajuste de inventario

Movimiento explícito utilizado para corregir una diferencia entre existencia registrada y existencia física.

Todo ajuste manual requiere motivo y trazabilidad.

Un ajuste no modifica destructivamente movimientos anteriores.

## Merma

Disminución real de existencias por daño, deterioro, vencimiento, pérdida, rotura u otra causa autorizada.

Debe registrarse mediante movimiento explícito y motivo auditable.

## FEFO

Política de salida `First Expired, First Out`.

Prioriza el lote válido con fecha de vencimiento más próxima cuando existe vencimiento y la política aplicable lo exige.

## FIFO

Política de salida `First In, First Out`.

Puede utilizarse cuando no existe vencimiento o cuando la política configurada lo autoriza.

## Conflicto de inventario

Situación en la que dos o más operaciones incompatibles intentan afectar la misma existencia, reserva, lote, traslado o versión.

Puede originarse por doble consumo, reserva concurrente, versión obsoleta, movimiento duplicado o conflicto local-central.

No debe resolverse mediante sobrescritura silenciosa.

## Compensación de inventario

Operación explícita utilizada para corregir el efecto de una operación previa sin eliminar ni reescribir el historial original.

Puede ser requerida por diferencias, pérdidas, cancelaciones posteriores, conflictos o errores operativos.

## Revisión requerida de inventario

Estado conceptual utilizado cuando un conflicto, diferencia o inconsistencia no puede resolverse automáticamente de forma segura.

Se representa conceptualmente mediante `REVIEW_REQUIRED`.

## Kardex

Historial ordenado de movimientos de inventario.

## Orden de compra

Intención comercial futura de adquirir mercancía a un proveedor. `PurchaseOrder` está diferido a `PUR-001` y no es requisito para recibir mercancía en el primer release.

## Recepción

Confirmación física e inmutable de mercancía recibida en una ubicación de inventario. `GoodsReceipt` puede existir sin orden de compra y produce movimientos mediante sus líneas y asignaciones de lote.

No es factura, cuenta por pagar ni pago al proveedor. Un error se corrige mediante una operación compensatoria nueva.

## Documento del proveedor

Factura, remisión, nota u otra evidencia comercial emitida por un proveedor. `SupplierDocument` está diferido y permanece separado de la recepción física; no modifica inventario directamente.

## Devolución al proveedor

Operación futura y trazable que retira mercancía mediante movimientos de salida nuevos. No anula ni reescribe la recepción original.

## Venta

Transacción comercial confirmada con uno o varios productos y pagos.

## Venta suspendida

Venta aún no confirmada que puede recuperarse posteriormente.

## Devolución comercial

Operación `SaleReturn`, propiedad de Sales, que devuelve total o parcialmente líneas de una venta completada sin modificarla destructivamente.

Puede originar efectos financieros, de inventario, caja o fiscalización, pero no los confirma por sí misma.

## Línea de devolución

Parte de SaleReturn que referencia una SaleItem y conserva cantidades, valores, impuestos, snapshots originales, condición física y resolución comercial aplicable.

## Devolución parcial y total

Una devolución parcial consume solo parte de la elegibilidad de una o más líneas. Una devolución total consume toda la elegibilidad restante, sin convertir esos resultados en estados persistentes de SaleReturn.

`PARTIALLY_RETURNED` y `FULLY_RETURNED` son proyecciones derivadas de Sale.

## Refund

Operación compensatoria de Payments que devuelve dinero o restaura valor confirmado y elegible sin reescribir Payment, Sale o SaleReturn. Puede existir relacionada con una devolución comercial o de forma independiente cuando la política lo permita.

## Reversal

Operación de Payments que revierte una autorización o confirmación cuando el estado real y el proveedor todavía lo permiten. No equivale a Refund ni prueba una devolución comercial o física.

## Settlement

Agregado de Payments que representa el reconocimiento y liquidación de componentes financieros por caja, proveedor, adquirente, billetera o banco. Conserva bruto, comisiones, retenciones, refunds, reversals, contracargos, ajustes y neto separados, además de política, entradas, evidencia y resultado; no modifica Payment histórico ni equivale a conciliación.

## Reconciliation

Agregado de Payments que compara snapshots de movimientos internos y fuentes externas mediante reglas deterministas y versionadas. Su periodo o alcance es contexto congelado, no otro agregado con estado propio. Los estados de la ejecución, de sus items y de sus incidencias son ejes separados.

## Provider authority

Principio por el cual el proveedor o subsistema que controla una operación externa es autoridad sobre su resultado. POS Platform valida y consolida evidencia, pero un dispositivo, frontend, callback no autenticado o timestamp no puede declarar éxito.

## Evidencia de proveedor

Respuesta, webhook, archivo, consulta o referencia verificable de una fuente externa, conservada de forma inmutable mediante localizador seguro, identidad, hash y contexto tenant-scoped. No incluye secretos ni datos sensibles en logs o eventos.

## Anulación

Reversión autorizada de una operación completa, manteniendo trazabilidad.

## Pago

Registro de dinero recibido mediante efectivo, tarjeta, transferencia, QR, crédito u otro método.

## Pago mixto

Venta pagada mediante más de un método.

## Base de caja

Efectivo inicial entregado al cajero para dar cambio.

## Efectivo esperado

Valor derivado de movimientos de caja publicados hasta una secuencia de corte. No es un saldo mutable ni se reemplaza con el efectivo contado.

## Arqueo de caja

Operación `CashCount` que congela el corte de movimientos, efectivo esperado, efectivo contado, denominaciones y diferencia sin modificar movimientos ni cerrar necesariamente el turno.

Un conteo completado es inmutable; su corrección crea otro conteo relacionado.

## Diferencia de caja

Resultado exacto de restar efectivo esperado al efectivo contado. La tolerancia puede clasificarla, pero no ocultarla ni convertirla en cero.

## Licencia

Derecho contractual firmado emitido para un tenant.

Define modalidad, vigencia, derechos y límites.

No representa una activación, una sesión, un dispositivo ni un permiso de usuario.

## Activación de licencia

Asociación verificable entre una licencia, un dispositivo y una instalación autorizada.

Una activación no amplía derechos ni límites contractuales.

## Instalación

Instancia concreta de la aplicación identificada mediante `installation_id`.

Una reinstalación limpia genera una nueva instalación y no revive automáticamente activaciones anteriores.

## Identidad criptográfica del dispositivo

Identidad basada en una clave propia del dispositivo y una asociación aprobada por la autoridad central.

Permite demostrar posesión sin transmitir la clave privada.

## Clave de dispositivo

Clave criptográfica asociada a un dispositivo.

La clave privada permanece protegida localmente y la clave pública se registra para validación.

## Evidencia de hardware

Información secundaria utilizada para detectar cambios, clonación o riesgo en un dispositivo.

No constituye identidad principal ni debe producir bloqueo irreversible por un único atributo.

## Revocación

Instrucción verificable que desautoriza una licencia, activación, dispositivo o clave.

La revocación conserva identidad, secuencia, motivo y auditoría.

No elimina datos ni historia.

## Periodo de gracia

Autorización temporal y explícita que permite continuar con capacidades limitadas.

No se genera automáticamente por pérdida de conectividad, reinstalación o error criptográfico.

## Conjunto de confianza

Colección versionada de claves públicas autorizadas para verificar artefactos firmados.

No se amplía mediante claves arbitrarias recibidas junto con una licencia o actualización.

## Activación offline

Proceso mediante el cual un dispositivo obtiene una activación verificable sin conexión directa durante el intercambio final.

La autorización sigue siendo emitida por la autoridad central.

## Replay

Reutilización de una solicitud, respuesta o artefacto para intentar repetir un efecto ya aplicado.

Un replay debe rechazarse o devolver idempotentemente el resultado existente.

## Actualización firmada

Paquete de software, política o material de confianza cuya autenticidad e integridad se verifican antes de instalarse.

Una actualización no amplía derechos ni elimina datos confirmados.

## Gracia agotada

Estado en el que una autorización de gracia alcanzó su límite temporal o fue revocada.

No puede reiniciarse localmente.

## Estado de confianza del dispositivo

Clasificación operativa de la confianza conocida de un dispositivo.

Valores conceptuales:

- `TRUSTED`;
- `DEGRADED`;
- `UNTRUSTED`;
- `REVOKED`;
- `UNKNOWN`;
- `REVIEW_REQUIRED`.

## Clave confiable

Clave pública previamente aprobada para verificar un tipo específico de artefacto.

Una clave retirada puede conservarse en modo `VERIFY_ONLY` para validación histórica controlada.

## Recuperación de dispositivo

Proceso controlado para restaurar operación después de pérdida de clave, reinstalación, daño, reemplazo o revocación.

La recuperación conserva trazabilidad y no amplía derechos.

## Reemplazo de dispositivo

Proceso que retira o revoca una activación anterior y crea una nueva asociación verificable.

La clave privada anterior no se copia al nuevo dispositivo.

## Estado operativo del dispositivo

Clasificación técnica de disponibilidad y condición conocida de un dispositivo.

Es independiente del estado de confianza criptográfica, de la licencia, de la activación y del estado contractual.

Valores conceptuales:

- `ACTIVE`;
- `OFFLINE`;
- `STALE`;
- `UNREACHABLE`;
- `DEGRADED`;
- `DEACTIVATED`;
- `REVIEW_REQUIRED`.

## Dispositivo `STALE`

Dispositivo que no ha reportado actividad válida dentro del umbral definido por una política versionada.

No implica automáticamente revocación, compromiso, desinstalación ni abandono.

## Dispositivo `UNREACHABLE`

Dispositivo con el que no se logra establecer comunicación esperada dentro de la política de disponibilidad o reintentos aplicable.

No constituye por sí solo evidencia suficiente de desinstalación.

## Desinstalación confirmada

Evidencia explícita y auditable de que la aplicación fue removida mediante un flujo controlado o una señal técnica verificable.

La ausencia de heartbeat, sincronización o conectividad no equivale por sí sola a desinstalación confirmada.

## Última actividad conocida

Momento representado por `last_seen_at` en el que el sistema central confirmó actividad válida de un dispositivo.

No equivale a última sincronización.

## Última sincronización confirmada

Momento representado por `last_sync_at` en el que una sincronización válida fue completada y confirmada.

No debe actualizarse únicamente porque el dispositivo se haya comunicado.

## Modalidad de propiedad del activo

Clasificación que determina quién posee físicamente el equipo asociado al POS.

Valores conceptuales:

- `CUSTOMER_OWNED`;
- `PROVIDER_OWNED`;
- `LEASED`;
- `MANAGED_ASSET`.

La propiedad del activo no modifica por sí sola la confianza del dispositivo ni los derechos de licencia.

## Modalidad de administración del dispositivo

Clasificación que determina el alcance técnico autorizado para administrar el POS o el equipo.

Valores conceptuales:

- `SOFTWARE_ONLY`;
- `SOFTWARE_MANAGED`;
- `DEVICE_MANAGED`;
- `KIOSK_MANAGED`.

El alcance efectivo depende del contrato, consentimiento, permisos y política de seguridad aplicable.

## Equipo propiedad del cliente

Activo clasificado como `CUSTOMER_OWNED`.

El proveedor administra únicamente el POS y los componentes expresamente contratados.

No autoriza control general del sistema operativo ni bloqueo de software de terceros.

## Equipo administrado

Activo gestionado bajo una modalidad que permite administración técnica reforzada.

Puede incluir configuración controlada, actualizaciones administradas, mantenimiento, monitoreo técnico o modo kiosco cuando exista autorización contractual explícita.

## Equipo arrendado

Activo clasificado como `LEASED`.

Puede estar sujeto a administración reforzada cuando el contrato lo autoriza.

## Reinstalación sospechosa

Nueva instalación cuya relación con una identidad previa, activación, clave o evidencia de hardware presenta inconsistencias que requieren revisión.

No produce revocación irreversible por sí sola.

## Alerta administrativa de dispositivo

Señal generada cuando el estado operativo, identidad, instalación, clave o evidencia de hardware requiere revisión.

Una alerta no modifica automáticamente licencia, activación ni derechos y no autoriza acciones destructivas por sí sola.

## Estado contractual de licencia

Estado persistente de la relación contractual asociada a una licencia.

Valores conceptuales:

- `TRIAL`;
- `ACTIVE`;
- `PAST_DUE`;
- `SUSPENDED`;
- `CANCELLED`;
- `TERMINATED`.

No incluye vigencia temporal, gracia, revocación, restricción efectiva ni validez criptográfica.

## Licencia expirada

Resultado temporal de evaluación representado por `EXPIRED`.

Se determina mediante `not_before`, `expires_at`, evidencia temporal confiable y política aplicable.

No constituye un `contract_status` persistente.

## Licencia restringida

Resultado efectivo de autorización representado por `RESTRICTED`.

Permite únicamente las capacidades determinadas por entitlements, política contractual, gracia, activación, dispositivo y demás restricciones aplicables.

No constituye un `contract_status` base.

## Licencia inválida

Resultado de validación representado por `INVALID`.

Puede originarse en firma inválida, estructura incorrecta, emisor no confiable, clave desconocida, versión incompatible o corrupción del artefacto.

No constituye estado contractual.

## Licencia revocada

Resultado efectivo representado por `REVOKED` cuando existe una `LicenseRevocation` aplicable.

No constituye `contract_status`.

## Licencia terminada

Licencia cuyo `contract_status` es `TERMINATED`.

Representa cierre definitivo de la relación contractual mediante un proceso explícito.

La terminación no elimina datos ni auditoría.

## Aviso de vencimiento de licencia

Señal comercial generada por una política versionada para informar sobre una obligación o cambio contractual próximo.

Un aviso no modifica por sí solo derechos, vigencia ni estado contractual.

## Restricción progresiva de licencia

Política que reduce capacidades autorizadas de forma explícita y gradual.

Debe operar mediante entitlements y reglas verificables, no mediante bloqueo general del sistema operativo.

## Decisión efectiva de autorización

Resultado derivado de combinar estado contractual, vigencia, entitlements, gracia, activación, dispositivo, revocaciones, política offline y versión aplicable.

Puede producir resultados como:

- `ALLOW`;
- `ALLOW_WITH_RESTRICTIONS`;
- `DENY`;
- `GRACE_PERIOD`;
- `RESTRICTED`;
- `EXPIRED`;
- `REVOKED`;
- `INVALID`.

## Feature flag

Control que habilita o deshabilita una capacidad sin cambiar el código desplegado.

## Modalidad híbrida

POS local con sincronización y servicios centrales cuando hay Internet.

## Modalidad local perpetua

POS instalado localmente con licencia permanente para una versión contratada.

## Domicilio

Pedido preparado y entregado fuera del establecimiento.

## Domiciliario

Usuario encargado de transportar y entregar pedidos asignados.

## PIN de entrega

Código temporal de un solo uso que valida la recepción de un domicilio.

## Auditoría

Registro inmutable de acciones relevantes, responsables, fechas y cambios.

## Snapshot

Copia de datos comerciales o fiscales conservada tal como existía al confirmar una operación.

## Idempotencia

Propiedad que impide duplicar una operación cuando una solicitud se repite.

## Outbox

Registro persistente de operaciones o eventos confirmados localmente que todavía deben publicarse o sincronizarse.

La operación de negocio y su registro de outbox deben persistirse dentro de la misma transacción local.

## Inbox

Registro persistente utilizado por el nodo receptor para reconocer operaciones previamente recibidas e impedir que sus efectos se apliquen más de una vez.

## Operación local

Intención operativa creada y confirmada en un dispositivo POS antes de obtener confirmación del servidor central.

Conserva identidad global, tenant, dispositivo, actor, versión, payload, checksum y estado de sincronización.

## Checkpoint de sincronización

Posición confirmada desde la cual un dispositivo puede reanudar la sincronización sin perder ni aplicar nuevamente operaciones.

No avanza hasta que la confirmación correspondiente haya sido persistida.

## Autoridad por dato

Política que determina qué nodo, dominio o proveedor puede decidir el estado definitivo de un dato u operación.

La autoridad no se determina mediante una regla genérica de último timestamp.

## Versión esperada

Versión del agregado que una operación espera encontrar antes de modificarlo.

Si no coincide con la versión vigente, se genera un conflicto en lugar de sobrescribir el estado existente.

## Causalidad

Relación que identifica la operación o evento que originó otro efecto posterior.

Permite impedir que una operación dependiente sea aplicada antes de su causa obligatoria.

## Conflicto de sincronización

Situación en la que una operación no puede aplicarse automáticamente porque existe una diferencia de versión, estado, autoridad, dependencia, permiso, dispositivo, tenant o política.

Un conflicto debe resolverse explícitamente o pasar a revisión.

## Append-only

Modelo en el que los hechos confirmados no se actualizan ni eliminan destructivamente.

Las correcciones se representan mediante nuevas operaciones compensatorias.

## Proyección derivada

Estado calculado a partir de hechos fuente, como saldo de inventario, efectivo esperado o cobertura de pago.

Una proyección no sustituye ni reescribe los hechos que la originaron.

## Checksum de payload

Huella determinista utilizada para verificar que el contenido de una operación no cambió durante transmisión, almacenamiento o reintentos.

La misma identidad de operación con un checksum diferente constituye un conflicto.

## Reintento

Nueva transmisión de la misma operación, conservando `operation_id`, `idempotency_key` y payload original.

Un reintento no representa una nueva intención comercial.

## Dead letter

Estado operativo de una operación que no pudo resolverse automáticamente después de agotar los reintentos permitidos o presentar un error permanente.

Su evidencia y tratamiento se materializan mediante `SyncDeadLetter`, sin duplicar la intención o payload original.

## SyncDeadLetter

Agregado de Sync con identidad global que referencia una `SyncOperation` en estado `DEAD_LETTER` y conserva clasificación, reintentos observados, revisión, reactivación autorizada, archivo y auditoría.

Existe como máximo uno por operación y no es un mensaje ejecutable.

## SyncDeadLetterAction

Hecho append-only de revisión, retry autorizado, rechazo, resultado o archivo de una dead letter. Conserva actor, motivo, transición, causalidad y evidencia sanitizada.

## Agotamiento de reintentos

Condición determinada por una política técnica versionada en la que Sync detiene reintentos automáticos y conserva la operación para revisión o dead letter.

No cambia la identidad ni el payload original.

## Archivo de dead letter

Transición `ARCHIVED` que retira el caso de tratamiento activo sin borrar operación, evidencia, idempotencia o auditoría sujeta a retención.

## Calidad de reloj

Clasificación de la confiabilidad temporal conocida de un dispositivo.

Valores conceptuales:

- `TRUSTED`;
- `DEGRADED`;
- `UNTRUSTED`;
- `UNKNOWN`.

El reloj local aporta evidencia contextual, pero no constituye autoridad global.

## Local-first

Arquitectura en la que el POS puede confirmar operaciones autorizadas mediante persistencia local y sincronizarlas posteriormente de forma idempotente.

No significa que todos los datos sean autoritativos localmente ni que todos los conflictos puedan fusionarse.

## Configuración por dominio

Política, regla o perfil cuya identidad, versiones y autoridad pertenecen al módulo que define su semántica. No existe una entidad global `Configuration`.

## ConfigurationDistribution

Componente técnico opcional que transporta referencias, versiones y snapshots de configuraciones nativas. No es un dominio ni fuente de verdad y no puede publicar o ampliar derechos.

## Identidad estable de configuración

Identidad que agrupa la sucesión histórica de versiones de una política del mismo dominio y scope. No cambia cuando se publica una versión nueva.

## Versión de configuración

Representación inmutable publicada de una configuración, con identidad propia, número monotónico, vigencia, checksum, actor, motivo y relación de sustitución.

## Versión programada

Proyección temporal de una versión `PUBLISHED` cuyo `valid_from` todavía no ha llegado. `SCHEDULED` no es un estado persistente paralelo.

## Sustitución de versión

Publicación de una versión nueva que reemplaza prospectivamente otra sin editarla ni borrarla. Restaurar una conducta anterior también crea una versión nueva; no reactiva el registro histórico.

## Snapshot tributario de operación

Evidencia inmutable de reglas, bases, tasas y resultado calculados por Tax para una operación comercial.

## Snapshot de emisión fiscal

Evidencia inmutable de la configuración, proveedor, numeración, contingencia y resultado usados por Electronic Invoicing. No sustituye ni recalcula el snapshot tributario.

## FiscalConnection

Conexión neutral, versionada y tenant-scoped de Electronic Invoicing con un proveedor y ambiente. Conserva capabilities y referencias opacas a secretos, nunca credenciales utilizables.

## ElectronicDocument

Agregado canónico de Electronic Invoicing para factura electrónica, documento equivalente, nota u otro documento fiscal. Tiene identidad interna global anterior al envío y separa estado interno, evidencia externa, numeración e identificadores legales. `FiscalDocument` es solo una descripción narrativa y no una entidad equivalente.

## FiscalSubmissionAttempt

Interacción técnica persistida contra un proveedor para emitir, consultar o recuperar evidencia. Su lifecycle técnico es independiente del resultado fiscal de `ElectronicDocument`.

## FiscalArtifact

Referencia íntegra y autorizada a XML, PDF, application response, QR data, payload firmado, respuesta externa u otra evidencia fiscal. Conserva checksum, metadata, storage reference y política de retención.

## FiscalIncident

Situación fiscal u operativa persistente que requiere revisión y supera un error transitorio ordinario. Su clasificación y resolución son distintas de su lifecycle `OPEN`, `IN_REVIEW`, `RESOLVED`, `ARCHIVED`.

## FiscalReconciliation

Agregado de Electronic Invoicing que compara estado interno con evidencia externa autoritativa sin sobrescribir historia. Es distinto de `Payments.Reconciliation`, aunque algunos estados tengan nombres equivalentes.

## Resultado fiscal incierto

Situación `UNKNOWN_OUTCOME` en la que no existe evidencia suficiente para afirmar aceptación, rechazo o ausencia de procesamiento. Puede existir en documento e intento como dimensiones diferentes y se resuelve mediante consulta, webhook validado o conciliación.

## Ambigüedad de configuración

Situación en la que dos o más versiones son igualmente elegibles y la política no define composición o desempate. Produce conflicto explícito; timestamps y orden de llegada no son autoridad.

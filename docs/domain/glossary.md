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

## Kardex

Historial ordenado de movimientos de inventario.

## Compra

Operación de adquisición de mercancía a un proveedor.

## Recepción

Confirmación física de mercancía recibida.

## Venta

Transacción comercial confirmada con uno o varios productos y pagos.

## Venta suspendida

Venta aún no confirmada que puede recuperarse posteriormente.

## Devolución

Operación que revierte total o parcialmente una venta confirmada.

## Anulación

Reversión autorizada de una operación completa, manteniendo trazabilidad.

## Pago

Registro de dinero recibido mediante efectivo, tarjeta, transferencia, QR, crédito u otro método.

## Pago mixto

Venta pagada mediante más de un método.

## Base de caja

Efectivo inicial entregado al cajero para dar cambio.

## Efectivo esperado

Valor calculado a partir de la base, ventas, ingresos, egresos, retiros y devoluciones.

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

Operación que no pudo resolverse automáticamente después de agotar los reintentos permitidos o presentar un error permanente.

Debe conservarse para diagnóstico, revisión o archivo controlado.

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

UC-PAY-003: Confirmar transferencia manual o pago por QR estático

Objetivo

Validar y confirmar, de forma segura, trazable e idempotente, un pago previamente reportado mediante transferencia bancaria, billetera digital o QR estático, sin depender de una API externa y sin considerar una evidencia visual como prueba suficiente por sí sola.

Actor principal

Uno de los siguientes, según permisos y configuración:

propietario;

administrador general;

gerente de sucursal;

supervisor autorizado;

cajero con permiso explícito;

servicio interno de verificación;

integración financiera confiable, cuando exista.

Actores secundarios

cliente;

domiciliario;

cajero;

aplicación del propietario;

POS;

módulo de ventas;

módulo de pedidos;

módulo de domicilios;

módulo de auditoría;

servicio de notificaciones;

servicio de sincronización.

Principio central

Reportar un pago no equivale a confirmarlo.

REPORTE REGISTRADO + `Payment=PENDING`
≠
CONFIRMED

El cliente, cajero o domiciliario puede informar que realizó o recibió un pago. La confirmación exige una fuente autorizada y debe dejar evidencia operativa y de auditoría.

Alcance inicial

Este caso de uso aplica a:

Nequi;

Daviplata;

transferencia bancaria;

QR estático del negocio;

billetera digital sin API;

otros medios manuales autorizados.

No cubre pagos confirmados automáticamente por API, webhook autenticado o pasarela, salvo que una integración confiable invoque este flujo con identidad técnica autorizada.

Precondiciones

El usuario o servicio está autenticado.

El tenant y la empresa están activos.

La sucursal pertenece a la empresa.

El pago existe.

El pago pertenece al mismo tenant y empresa.

El pago se encuentra en `PENDING` y tiene un reporte inmutable asociado a un `PaymentAttempt`.

La venta, pedido u obligación asociada existe.

El actor tiene permiso `payments.transfer.confirm`, en forma canónica `PAYMENTS_TRANSFER_CONFIRM` conforme a `DEC-012` D6. Cubre la familia de medios manuales de este caso de uso —transferencia bancaria, Nequi, Daviplata y QR estático—, no sólo la transferencia bancaria. **No** autoriza reportar el pago, que exige `payments.transfer.report` (`UC-PAY-001:111`).

Cuando el medio utiliza una cuenta destino o un QR **versionados por el sistema**, esa versión estaba vigente cuando se reportó el pago. La condición **no aplica** a los medios cuya cuenta destino no está versionada —transferencia bancaria, Nequi y Daviplata—, y el QR estático depende de `QR-001`, todavía no modelado.

La licencia permite confirmación manual.

El dispositivo está autorizado.

La solicitud contiene idempotency_key.

La referencia externa no está confirmada en otra operación incompatible.

La moneda coincide con la obligación.

Entrada

payment_id;

idempotency_key;

expected_payment_version;

external_reference;

financial_entity;

destination_account_version, **sólo cuando el medio utiliza una cuenta destino o QR versionados**; depende de `QR-001` y no aplica a los medios de la primera materialización;

reported_amount;

confirmed_amount;

reported_at;

confirmed_at;

confirmation_source;

evidence_reference opcional;

reason;

device_id;

branch_id;

correlation_id.

El contexto de tenant, empresa, usuario y permisos se deriva de la identidad autenticada. No se confía en valores libres enviados por el frontend.

Salida

payment_id;

previous_status;

new_status;

confirmed_amount;

sale_payment_status;

order_payment_status opcional;

delivery_release_status opcional;

confirmation_reference;

confirmed_by;

confirmed_at;

requires_reconciliation;

audit_reference;

pricing_pipeline_version;

tax_policy_version;

rounding_policy_version.

Permisos y segregación de funciones

Puede reportar

Según política:

cliente;

domiciliario;

cajero;

sistema de pedidos;

POS.

Puede confirmar

Según alcance:

propietario;

administrador general;

gerente de sucursal;

supervisor;

cajero con permiso explícito;

integración financiera confiable.

No puede confirmar

Por defecto:

cliente;

domiciliario;

usuario anónimo;

dispositivo revocado;

frontend sin autorización backend;

operador de otra sucursal sin alcance.

Separación de reportante y confirmador

La política puede exigir que:

reported_by != confirmed_by;

el domiciliario nunca confirme;

el cajero no confirme su propio reporte;

montos superiores a un umbral requieran supervisor;

confirmaciones repetidas o sospechosas requieran doble validación.

Fuentes de confirmación válidas

Una confirmación manual debe basarse en al menos una fuente autorizada:

revisión directa de la cuenta o billetera del negocio;

extracto o movimiento bancario visible al usuario autorizado;

consulta en banca empresarial;

confirmación de una integración interna confiable;

comprobación presencial por el propietario;

proceso administrativo documentado.

Fuentes insuficientes por sí solas

No constituyen confirmación suficiente:

captura de pantalla enviada por el cliente;

mensaje de WhatsApp;

texto escrito por el domiciliario;

número digitado sin verificación;

comprobante visual no validado;

imagen del celular del cliente;

notificación no autenticada.

Estas evidencias pueden conservarse como soporte, pero no cambian el estado automáticamente.

Validaciones

El pago debe existir.

El pago debe pertenecer al tenant autorizado.

El estado debe permitir confirmación.

El actor debe tener permiso.

La referencia externa es obligatoria cuando el medio la emite.

La referencia debe normalizarse.

La referencia no puede estar confirmada en otra operación incompatible.

El valor confirmado debe ser mayor que cero.

El valor confirmado debe coincidir con el valor esperado o seguir una política de diferencia autorizada.

La cuenta o QR destino debe corresponder al negocio.

La versión de cuenta debe ser la vigente al momento del reporte.

La sucursal debe corresponder al pago.

La fecha no puede ser incoherente.

El pago no puede estar cancelado, rechazado, expirado, reembolsado o revertido.

La venta no puede estar anulada de forma incompatible.

La misma solicitud no puede confirmar dos veces.

Una misma referencia no puede cubrir dos ventas incompatibles.

La evidencia no puede contener secretos almacenados sin protección.

El dispositivo y la sesión deben seguir vigentes.

La configuración debe estar actualizada.

Flujo principal

El actor abre la cola de pagos reportados.

El sistema filtra por empresa, sucursal y alcance.

El actor selecciona un pago.

El sistema carga:

venta o pedido;

importe esperado;

medio;

referencia reportada;

cuenta o QR destino;

reportante;

fecha;

evidencia opcional;

historial.

El sistema valida el estado actual.

Verifica la versión para evitar confirmación concurrente.

Verifica permisos y segregación de funciones.

Normaliza la referencia externa.

Busca referencias iguales o similares.

Muestra posibles duplicados.

El actor consulta la fuente financiera autorizada.

Verifica que el dinero haya ingresado.

Verifica cuenta destino, valor, fecha y referencia.

El actor ingresa o confirma los datos.

El sistema valida coherencia.

Si el valor coincide, continúa.

Si existe diferencia, aplica el flujo correspondiente.

El actor confirma la operación.

El sistema inicia una transacción.

Cambia el `Payment` de `PENDING` a `CONFIRMED` y confirma el `PaymentAttempt` correspondiente.

Registra quién confirmó, cuándo, desde qué dispositivo y con qué fuente.

Crea o actualiza la asignación del pago.

Recalcula la cobertura confirmada de la venta.

Recalcula el estado de pago de la venta.

Si existe pedido, recalcula su estado.

Si existe domicilio, recalcula si puede liberarse la entrega.

Registra auditoría.

Guarda eventos en outbox.

Confirma la transacción.

Notifica a los actores correspondientes.

Devuelve el estado real.

La conciliación financiera queda pendiente.

Confirmación por monto exacto

Cuando:

confirmed_amount == expected_amount

el pago puede pasar a CONFIRMED, siempre que se cumplan las demás validaciones.

La venta queda cubierta —`PAID` como **proyección de cobertura** del `PaymentGroup`, nunca un estado de `Sale.status`— únicamente si la suma de pagos confirmados cubre el total pagadero. La cobertura se deriva de los pagos confirmados y **no se persiste como alias mutable**.

Diferencias de valor

Pago inferior

Ejemplo:

Esperado:   $50.000
Confirmado: $45.000

Opciones permitidas:

confirmar solo $45.000 y dejar saldo pendiente;

rechazar la confirmación;

solicitar pago adicional;

escalar a supervisor.

No se debe confirmar $50.000 si solo ingresaron $45.000.

Pago superior

Ejemplo:

Esperado:   $50.000
Confirmado: $55.000

Opciones:

registrar sobrepago explícito;

aplicar a otra obligación compatible;

iniciar devolución;

escalar a supervisor;

rechazar la asignación automática.

No se debe ocultar el excedente.

Política

Las diferencias deben ser configurables por empresa, pero siempre auditadas.

Referencias duplicadas

Duplicado exacto

Si una referencia ya está confirmada en otro pago:

Se bloquea la confirmación.

Se muestra la operación existente.

Se genera alerta.

Se requiere revisión administrativa.

Referencia similar

El sistema puede alertar cuando coincidan:

valor;

fecha;

entidad;

últimos caracteres;

cuenta destino;

cliente.

Una similitud no confirma fraude automáticamente, pero exige revisión.

Reutilización permitida

Solo podrá permitirse cuando el proveedor no emita referencias únicas y exista una política alternativa fuerte de deduplicación.

Debe combinar al menos:

entidad;

fecha y hora;

importe;

cuenta destino;

identificador del movimiento;

actor confirmador.

QR estático

Reglas

El QR pertenece al negocio o sucursal.

Debe existir una versión de configuración.

El domiciliario puede mostrarlo.

El domiciliario no puede reemplazarlo.

El cliente paga directamente al negocio.

El sistema conserva qué QR fue mostrado.

La confirmación debe validar la cuenta destino.

Un cambio de QR no altera pedidos anteriores.

El QR debe almacenarse de forma protegida y auditable.

La interfaz no debe permitir cargar un QR distinto sin autorización reforzada.

Nequi, Daviplata y transferencias

Reglas comunes

El medio debe estar habilitado.

La cuenta destino debe pertenecer al negocio.

La referencia debe registrarse cuando exista.

La confirmación es manual mientras no exista integración confiable.

No se simula una API bancaria.

El sistema debe permitir migrar posteriormente a integración automática sin cambiar el dominio.

El medio y la entidad deben quedar separados conceptualmente.

Ejemplo:

payment_method: DIGITAL_WALLET
financial_entity: NEQUI

o:

payment_method: BANK_TRANSFER
financial_entity: BANCOLOMBIA

Confirmación desde el panel del propietario

El propietario debe poder ver:

pagos reportados;

sucursal;

venta o pedido;

cliente;

domiciliario;

importe;

referencia;

cuenta destino;

tiempo transcurrido;

posibles duplicados;

evidencia opcional.

Acciones permitidas:

confirmar;

rechazar;

solicitar revisión;

marcar posible duplicado;

abrir detalle;

consultar historial.

La interfaz debe priorizar claridad y evitar confirmaciones accidentales.

Confirmación desde el POS

El POS puede permitir confirmación cuando:

el usuario tiene permiso;

la caja y sucursal corresponden;

la política no exige separación de funciones;

el monto está dentro del límite autorizado;

el dispositivo está registrado.

Debe exigir confirmación explícita y mostrar:

importe;

referencia;

entidad;

cuenta destino;

venta;

advertencias.

Domicilios

Flujo

El cliente selecciona transferencia o QR.

El pedido muestra el QR oficial.

El cliente realiza el pago.

El cliente o domiciliario reporta.

El `Payment` queda `PENDING` con el reporte conservado como evidencia del intento.

El propietario o actor autorizado verifica.

El `Payment` pasa a `CONFIRMED` o, ante rechazo concluyente sin importe confirmado, a `FAILED`; el intento pasa a `CONFIRMED` o `DECLINED`.

La aplicación del domiciliario recibe actualización.

La entrega se habilita según política.

El PIN de entrega puede mantenerse bloqueado hasta la confirmación.

Restricciones

El domiciliario no puede:

confirmar;

cambiar QR;

cambiar cuenta;

cambiar importe;

asignar la referencia a otra venta;

liberar la entrega manualmente sin permiso.

Rechazo

Motivos iniciales

dinero no recibido;

referencia inválida;

referencia duplicada;

cuenta destino incorrecta;

importe incorrecto;

evidencia inconsistente;

pago expirado;

operación sospechosa;

error del reportante.

Flujo

El actor selecciona rechazar.

Debe indicar motivo.

El sistema cambia el intento de `PENDING` a `DECLINED` y el `Payment` de `PENDING` a `FAILED` únicamente cuando el rechazo es concluyente y no existe importe confirmado.

Recalcula el estado de la venta.

Notifica al canal correspondiente.

Registra auditoría.

No elimina el reporte original.

Cancelación

Puede aplicarse antes de la confirmación cuando:

el cliente cambia de medio;

el pedido se cancela;

la referencia fue digitada erróneamente;

el intento expira.

Debe conservarse historial.

Reversión de una confirmación

Una confirmación no se edita destructivamente.

Si se confirmó por error:

Se inicia una operación de reversión.

Se exige permiso superior.

Se registra motivo.

Se referencia el pago original.

Se recalcula la venta.

Se genera incidencia si la mercancía ya fue entregada.

Se notifica a responsables.

Se conserva toda la trazabilidad.

Operación offline

Permitido

reportar pago;

almacenar referencia;

registrar evidencia;

mantener `Payment=PENDING` y la evidencia del reporte;

sincronizar posteriormente.

No permitido

confirmar sin fuente autorizada;

consultar cuenta bancaria;

asumir que una captura es válida;

liberar entrega si la política exige confirmación en línea.

Flujo

El reporte se guarda localmente.

Se agrega a outbox.

Al recuperar conexión se sincroniza.

El servidor deduplica.

La confirmación se realiza después.

El resultado vuelve al POS o app.

Idempotencia

La confirmación debe utilizar:

payment_id;

idempotency_key;

expected_payment_version;

external_reference;

correlation_id.

Reglas

Repetir la misma confirmación devuelve el resultado original.

Misma clave con datos diferentes genera conflicto.

Dos actores no pueden confirmar simultáneamente sin control de versión.

Un evento repetido no duplica asignaciones.

Las notificaciones repetidas no cambian el estado.

Concurrencia

Escenario

Dos usuarios intentan confirmar el mismo pago.

Resolución

Ambos leen versión N.

El primero confirma y actualiza a N+1.

El segundo falla por conflicto de versión.

El sistema muestra que el pago ya fue procesado.

No se crea una segunda confirmación.

Persistencia conceptual afectada

payments;

payment_allocations;

payment_confirmations;

payment_evidence;

external_reference_registry;

audit_events;

outbox_events;

proyección de estado de venta;

proyección de estado de pedido;

proyección de liberación de entrega.

La persistencia física se definirá posteriormente.

Eventos

ManualPaymentReported;

ManualPaymentConfirmationRequested;

ManualPaymentConfirmed;

ManualPaymentReportRejected;

DuplicatePaymentReferenceDetected;

PaymentAmountDifferenceDetected;

SalePaymentStatusChanged;

OrderPaymentStatusChanged;

DeliveryReleaseStatusChanged;

PaymentReversalRequired.

Notificaciones

Pueden notificarse:

propietario;

administrador;

cajero;

cliente;

domiciliario;

sistema de pedidos.

Ejemplos

“Pago reportado pendiente de verificación”.

“Pago confirmado”.

“Pago rechazado: referencia no encontrada”.

“Pago con diferencia de valor”.

“Referencia duplicada detectada”.

“Pedido habilitado para entrega”.

Las notificaciones no son fuente de verdad. El estado se consulta en backend o núcleo local confiable.

Auditoría

Debe registrar:

payment_id;

venta o pedido;

reportante;

confirmador;

rol;

empresa;

sucursal;

dispositivo;

entidad financiera;

referencia protegida;

importe esperado;

importe confirmado;

cuenta destino versionada;

estado anterior;

estado nuevo;

fecha;

fuente de confirmación;

motivo;

resultado;

correlación;

alertas.

No se almacenan credenciales, claves, tokens ni datos financieros sensibles completos en logs.

Excepciones

pago inexistente;

pago de otro tenant;

estado incompatible;

referencia ausente;

referencia duplicada;

valor inferior;

valor superior;

cuenta destino incorrecta;

actor sin permiso;

separación de funciones incumplida;

versión desactualizada;

dispositivo revocado;

licencia restringida;

venta anulada;

pedido cancelado;

configuración inexistente;

evidencia corrupta;

fallo de persistencia;

fallo de notificación;

conflicto de sincronización.

Recuperación ante fallos

Fallo antes del commit

El `Payment` permanece `PENDING` y el intento conserva la evidencia de reporte.

Fallo después del commit

La idempotencia devuelve la confirmación existente.

Fallo de notificación

El pago permanece confirmado. La notificación se reintenta.

Fallo de sincronización

El servidor conserva el estado y el cliente se actualiza posteriormente.

Confirmación concurrente

Solo una operación puede completar la transición.

Evidencia no disponible

No impide consultar la fuente financiera autorizada, pero debe registrarse la ausencia.

Invariantes

Reportar no equivale a confirmar.

El cliente no confirma su propio pago.

El domiciliario no confirma pagos.

Una captura no confirma por sí sola.

Una referencia confirmada no se reutiliza de forma incompatible.

La confirmación requiere actor o integración autorizada.

El valor confirmado no se inventa.

Una diferencia de valor queda explícita.

La cuenta destino debe pertenecer al negocio.

Un QR anterior conserva su versión histórica.

El estado de la venta es derivado.

La entrega depende de la política de pago.

La confirmación no se edita destructivamente.

Una solicitud repetida no duplica confirmación.

Los pagos de otro tenant son inaccesibles.

El frontend no decide la validez financiera.

El modo offline no inventa confirmaciones.

Toda transición crítica queda auditada.

La conciliación es posterior y separada.

La operación debe poder reconstruirse desde su historial.

Criterios de aceptación

Un pago reportado permanece pendiente hasta ser verificado.

Un actor autorizado puede confirmar un pago válido.

Un domiciliario no puede confirmar.

Una referencia duplicada bloquea la confirmación.

Una diferencia de valor no se oculta.

La venta se actualiza automáticamente.

Un pedido puede liberarse tras confirmación.

El mismo request no confirma dos veces.

Dos confirmadores concurrentes no generan duplicados.

Una captura sola no cambia el estado.

La operación offline solo reporta.

Los datos de otro tenant no son accesibles.

La auditoría identifica reportante y confirmador.

Pruebas mínimas

Nequi confirmado;

Daviplata confirmado;

transferencia bancaria confirmada;

QR estático confirmado;

referencia ausente;

referencia duplicada;

referencia similar;

pago inferior;

pago superior;

cuenta destino incorrecta;

domiciliario intentando confirmar;

cajero sin permiso;

supervisor autorizado;

separación de funciones;

confirmación concurrente;

solicitud duplicada;

versión desactualizada;

venta anulada;

pedido cancelado;

operación offline;

sincronización posterior;

rechazo;

cancelación;

reversión requerida;

fallo de notificación;

dispositivo revocado;

licencia restringida;

aislamiento entre tenants;

rollback transaccional.

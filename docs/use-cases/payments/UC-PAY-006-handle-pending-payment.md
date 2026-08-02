UC-PAY-006: Gestionar pago pendiente

Objetivo

Gestionar pagos que todavía no pueden considerarse confirmados, preservando su estado real, evitando rechazos falsos por timeout, permitiendo reintentos seguros, procesando respuestas tardías y manteniendo coherencia entre venta, pedido, domicilio, proveedor y operación offline.

Actor principal

Según el origen y el canal:

sistema POS;

servicio de pagos;

administrador;

supervisor;

propietario;

cajero autorizado;

integración externa autenticada;

servicio de sincronización;

proceso programado de expiración.

Actores secundarios

cliente;

domiciliario;

proveedor de pagos;

módulo de ventas;

módulo de pedidos;

módulo de domicilios;

módulo de caja;

módulo de auditoría;

servicio de notificaciones;

servicio de conciliación.

Principio central

Un timeout, pérdida de red o respuesta incompleta no equivale automáticamente a rechazo.

TIMEOUT
≠
REJECTED

El sistema debe conservar el pago en un estado pendiente hasta contar con evidencia suficiente para confirmar, rechazar, cancelar, expirar o revertir.

Estados gestionados

Este caso de uso aplica principalmente a:

CREATED;

PENDING;

REPORTED;

AUTHORIZED;

PARTIALLY_CONFIRMED;

FAILED recuperable;

EXPIRED sujeto a revisión;

agrupaciones de pago con componentes pendientes.

No debe alterar destructivamente pagos ya:

CONFIRMED;

SETTLED;

RECONCILED;

REFUNDED;

REVERSED.

Precondiciones

El pago o grupo de pagos existe.

Pertenece al tenant y empresa autorizados.

La venta, pedido u obligación asociada existe.

El estado actual admite seguimiento.

El actor o proceso tiene permiso.

Existe una política de timeout y expiración vigente.

La solicitud contiene idempotency_key cuando es interactiva.

El proveedor, medio y canal están identificados.

La versión esperada del pago es conocida.

El dispositivo o identidad técnica está autorizado.

Entrada

payment_id o payment_group_id;

idempotency_key;

expected_payment_version;

action;

reason;

provider_status opcional;

provider_reference opcional;

occurred_at;

retry_strategy opcional;

new_payment_method opcional;

device_id;

branch_id;

correlation_id.

Acciones permitidas

CHECK_STATUS;

RETRY;

WAIT;

CANCEL;

EXPIRE;

CHANGE_METHOD;

ESCALATE;

PROCESS_LATE_RESPONSE;

RESOLVE_CONFLICT;

MARK_REVIEW_REQUIRED.

Salida

payment_id o payment_group_id;

previous_status;

new_status;

sale_payment_status;

order_payment_status opcional;

delivery_release_status opcional;

remaining_amount;

next_action;

next_check_at opcional;

retry_count;

expires_at opcional;

requires_manual_review;

requires_reconciliation;

audit_reference.

Clasificación de pagos pendientes

Pendiente técnico

El sistema espera una respuesta de proveedor o sincronización.

Ejemplos:

timeout;

webhook pendiente;

red interrumpida;

proveedor no disponible;

respuesta parcial.

Pendiente operativo

Requiere acción humana.

Ejemplos:

transferencia reportada;

QR estático pendiente de verificación;

diferencia de valor;

posible duplicado;

autorización de supervisor.

Pendiente comercial

La venta tiene cobertura incompleta.

Ejemplos:

pago parcial;

componente rechazado;

cambio de medio pendiente;

crédito por aprobar.

Pendiente de conciliación

El pago fue confirmado, pero todavía no fue conciliado contra caja o proveedor.

Este estado no debe bloquear una venta ya válidamente pagada, salvo política específica.

Flujo principal

El sistema recibe o detecta un pago pendiente.

Valida tenant, empresa, sucursal, actor y dispositivo.

Carga el pago, grupo, venta, pedido y estado actual.

Verifica la versión para evitar conflictos concurrentes.

Clasifica el tipo de pendiente.

Consulta la política vigente.

Determina si corresponde:

esperar;

reintentar;

consultar al proveedor;

escalar;

cancelar;

expirar;

cambiar de medio;

procesar respuesta tardía.

Valida límites de reintento.

Ejecuta la acción permitida.

Actualiza el estado sin perder historial.

Recalcula cobertura confirmada.

Recalcula el estado de la venta.

Recalcula el estado del pedido.

Recalcula si puede liberarse un domicilio.

Registra auditoría.

Guarda eventos en outbox.

Confirma la transacción.

Notifica a los actores afectados.

Programa la siguiente revisión si aplica.

Devuelve el estado real y la siguiente acción.

Timeout

Regla

Un timeout indica ausencia de respuesta, no rechazo.

Flujo

La solicitud al proveedor excede el tiempo configurado.

El pago permanece PENDING.

Se registra:

proveedor;

operación;

tiempo de espera;

intento;

correlación.

Se consulta el estado cuando el proveedor lo permita.

Se programa reintento o revisión.

La venta permanece pendiente salvo cobertura suficiente por otros pagos.

La respuesta tardía se procesa idempotentemente.

Prohibiciones

No se debe:

marcar automáticamente REJECTED;

crear un segundo pago sin deduplicación;

cobrar nuevamente sin revisar el estado anterior;

asumir que el cliente no pagó;

liberar mercancía si la política exige confirmación.

Reintentos

Tipos

Reintento técnico

Repite consulta o comunicación sin crear un nuevo pago.

Reintento comercial

El cliente intenta pagar nuevamente.

Debe verificarse primero el estado del intento anterior.

Reglas

El reintento conserva payment_id cuando representa la misma operación.

Una nueva operación requiere nuevo identificador y relación con el intento anterior.

Debe existir límite de intentos.

Se aplica backoff.

Los errores no recuperables no se reintentan automáticamente.

Un webhook tardío debe asociarse al pago original.

Los reintentos no duplican movimientos de caja ni asignaciones.

Respuestas tardías

Ejemplo

El POS recibe timeout.

El pago queda PENDING.

El proveedor confirma después.

Llega un webhook o consulta positiva.

El sistema actualiza el mismo pago.

Flujo

Se autentica la respuesta.

Se localiza el pago original.

Se valida referencia, importe y proveedor.

Se verifica el estado actual.

Si ya fue confirmado, se devuelve idempotentemente.

Si fue cancelado o reemplazado, se crea incidencia.

Si sigue pendiente, se procesa la transición.

Se recalcula venta, pedido y entrega.

Se registra auditoría.

Cambio de medio de pago

Motivos

proveedor no disponible;

cliente cambia de decisión;

transferencia no confirmada;

tarjeta rechazada;

timeout prolongado;

pago parcial;

QR incorrecto.

Flujo

El actor solicita cambiar de medio.

El sistema revisa el estado del pago anterior.

Si está PENDING, intenta consultar o cancelar cuando sea posible.

Si no puede garantizar cancelación, marca riesgo de doble pago.

Crea un nuevo pago vinculado al anterior.

Conserva el intento previo.

Recalcula cobertura.

Si posteriormente llega confirmación del pago anterior, genera incidencia o sobrepago.

Regla

Nunca se elimina el intento anterior para “limpiar” la operación.

Cancelación

Puede solicitarse cuando el pago no está confirmado.

Validaciones

estado cancelable;

actor autorizado;

proveedor compatible;

ausencia de confirmación tardía conocida;

motivo obligatorio.

Resultado

CANCELLED, si es seguro;

PENDING_CANCELLATION, si depende del proveedor;

REVIEW_REQUIRED, si existe incertidumbre.

Expiración

Política

Cada medio puede tener un plazo distinto.

Ejemplos:

QR temporal;

autorización de tarjeta;

transferencia reportada sin verificación;

pedido no pagado;

sesión de pago.

Flujo

Un proceso detecta vencimiento.

Verifica que no exista confirmación tardía.

Marca EXPIRED si corresponde.

Recalcula venta y pedido.

Puede cancelar reserva de inventario.

Notifica al cliente.

Conserva trazabilidad.

Regla

Expirar no significa afirmar que el dinero nunca llegó. La conciliación posterior puede detectar diferencias.

Pagos parcialmente confirmados

Escenario

Un grupo contiene:

efectivo confirmado;

transferencia reportada.

Resultado

grupo: PARTIALLY_CONFIRMED;

venta: PAYMENT_PENDING o PARTIALLY_PAID;

saldo: explícito;

entrega: bloqueada o condicionada según política.

Acciones

esperar confirmación;

completar con otro medio;

cancelar componente pendiente;

mantener pago parcial;

solicitar devolución del componente confirmado.

Venta y pedido

Venta física

La política puede permitir:

mantener venta abierta;

suspenderla;

conservar pago parcial;

exigir otro medio;

cancelar con compensación.

Pedido a domicilio

La política predeterminada debe impedir liberar entrega cuando:

el pago requerido está pendiente;

existe referencia duplicada;

hay diferencia de valor;

un componente fue rechazado.

Reserva de inventario

Debe tener vencimiento configurable.

Al expirar el pago:

puede liberarse la reserva;

puede mantenerse por tolerancia;

debe quedar auditado.

Domicilios

Estados relacionados

PAYMENT_PENDING;

READY_WAITING_PAYMENT;

PAYMENT_CONFIRMED;

DELIVERY_RELEASED;

DELIVERY_BLOCKED.

Reglas

El domiciliario puede consultar estado.

No puede forzar confirmación.

No puede cambiar QR ni cuenta.

El PIN puede permanecer bloqueado.

Una respuesta tardía puede habilitar entrega.

Si el pedido ya fue cancelado, una confirmación tardía genera incidencia y posible devolución.

Operación offline

Casos

Efectivo

Puede confirmarse localmente con caja abierta.

Transferencia o QR

Permanece REPORTED o PENDING.

Tarjeta

No se confirma sin proveedor, salvo dispositivo certificado y flujo específico futuro.

Sincronización

Se guarda localmente.

Se registra outbox.

Se sincroniza al recuperar conexión.

El servidor deduplica.

Se comparan versiones.

Los conflictos quedan en revisión.

Nunca se promociona a CONFIRMED sin evidencia válida.

Consulta de estado al proveedor

Cuando exista API:

Se autentica la integración.

Se consulta por referencia original.

Se valida importe, moneda y cuenta.

Se procesa estado:

pendiente;

autorizado;

confirmado;

rechazado;

revertido;

desconocido.

Se conserva respuesta resumida y segura.

No se almacenan secretos.

Escalamiento manual

Debe ocurrir cuando:

supera tiempo máximo;

excede reintentos;

existe referencia duplicada;

hay diferencia de valor;

la respuesta del proveedor es contradictoria;

el pago aparece confirmado y cancelado;

existe riesgo de doble cobro;

el pedido fue entregado con pago incierto.

Resultado

incidencia;

responsable;

prioridad;

fecha límite;

evidencia;

resolución auditada.

Idempotencia

Debe utilizar:

payment_id;

payment_group_id opcional;

idempotency_key;

provider_reference;

expected_payment_version;

correlation_id.

Reglas

Repetir una acción devuelve el mismo resultado.

Misma clave con acción distinta genera conflicto.

Un webhook repetido no duplica confirmación.

Un reintento no crea nuevo movimiento.

Una sincronización repetida no altera cobertura.

La respuesta tardía se asocia al pago original.

Concurrencia

Escenario

proceso automático expira;

proveedor confirma al mismo tiempo.

Resolución

Ambos leen versión N.

Solo una transición actualiza a N+1.

La segunda operación reevalúa el nuevo estado.

Si existe contradicción, crea incidencia.

No se sobrescribe silenciosamente.

Persistencia conceptual afectada

payments;

payment_groups;

payment_attempts;

payment_status_history;

payment_provider_interactions;

payment_allocations;

payment_incidents;

audit_events;

outbox_events;

proyección de estado de venta;

proyección de estado de pedido;

proyección de liberación de entrega;

reserva de inventario cuando aplique.

La persistencia física definitiva se documentará después.

Eventos

PaymentPendingDetected;

PaymentRetryScheduled;

PaymentRetryExecuted;

PaymentLateResponseReceived;

PaymentMethodChangeRequested;

PaymentCancelled;

PaymentExpired;

PaymentReviewRequired;

PaymentIncidentCreated;

SalePaymentStatusChanged;

OrderPaymentStatusChanged;

DeliveryReleaseStatusChanged;

InventoryReservationReleased.

Notificaciones

Pueden notificarse:

cliente;

cajero;

supervisor;

propietario;

domiciliario;

soporte.

Ejemplos

“Pago pendiente de confirmación”.

“No repita el pago; estamos verificando”.

“Pago confirmado”.

“Pago rechazado”.

“Puede seleccionar otro medio”.

“Pedido bloqueado hasta confirmar el pago”.

“Pago confirmado después de cancelar el pedido”.

Las notificaciones no sustituyen el estado real del backend.

Auditoría

Debe registrar:

pago;

grupo;

venta o pedido;

estado anterior;

estado nuevo;

actor o proceso;

proveedor;

referencia protegida;

intento;

timeout;

reintento;

respuesta tardía;

cambio de medio;

expiración;

incidencia;

dispositivo;

sucursal;

correlación;

resultado.

Excepciones

pago inexistente;

pago de otro tenant;

estado no gestionable;

versión desactualizada;

acción no permitida;

límite de reintentos;

proveedor no disponible;

referencia inconsistente;

venta anulada;

pedido cancelado;

dispositivo revocado;

licencia restringida;

fallo de persistencia;

fallo de sincronización;

conflicto concurrente;

configuración de timeout inexistente.

Recuperación ante fallos

Fallo antes del commit

El estado anterior permanece intacto.

Fallo después del commit

La idempotencia devuelve el resultado existente.

Fallo de notificación

La transición permanece válida y la notificación se reintenta.

Proveedor no disponible

El pago permanece pendiente y se programa revisión.

Respuesta contradictoria

Se crea incidencia; no se elige arbitrariamente.

Sincronización incompleta

Se conserva en outbox.

Invariantes

Timeout no equivale a rechazo.

Un pago pendiente conserva su identidad.

Los reintentos no duplican pagos.

Las respuestas tardías actualizan el pago original.

Cambiar de medio no elimina el intento anterior.

Un pago reportado no cubre como confirmado.

El estado de venta es derivado.

El estado de pedido es derivado.

La entrega respeta la política de pago.

El domiciliario no fuerza confirmación.

El modo offline no inventa estados externos.

La expiración conserva historial.

Las contradicciones generan incidencia.

Los pagos de otro tenant son inaccesibles.

Toda transición crítica queda auditada.

Las notificaciones no son fuente de verdad.

La confirmación tardía no se descarta silenciosamente.

La cobertura confirmada no excede el total sin política explícita.

Los conflictos concurrentes se resuelven por versión.

El historial permite reconstruir todo el ciclo.

Criterios de aceptación

Un timeout deja el pago pendiente.

El sistema evita cobros duplicados.

Una respuesta tardía actualiza el pago original.

Un pago puede cambiar de medio sin perder historial.

Los reintentos respetan límites.

Un pago puede expirar de forma auditada.

Una venta permanece pendiente sin cobertura suficiente.

Un domicilio puede quedar bloqueado.

El modo offline sincroniza sin confirmar indebidamente.

Los conflictos concurrentes no sobrescriben estados.

Una contradicción crea incidencia.

Los datos de otro tenant no son accesibles.

Pruebas mínimas

timeout;

proveedor lento;

respuesta tardía confirmada;

respuesta tardía rechazada;

webhook repetido;

reintento técnico;

reintento comercial;

límite de reintentos;

cambio de medio;

riesgo de doble pago;

cancelación segura;

cancelación incierta;

expiración;

pago parcialmente confirmado;

pedido bloqueado;

liberación posterior;

reserva de inventario expirada;

operación offline;

sincronización repetida;

conflicto concurrente;

venta anulada;

pedido cancelado;

dispositivo revocado;

licencia restringida;

aislamiento entre tenants;

rollback transaccional.
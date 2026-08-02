UC-PAY-002: Registrar pago mixto

Objetivo

Registrar una combinación de dos o más medios de pago para cubrir una misma venta, pedido, devolución u obligación, manteniendo cada componente como un pago independiente, con estado, trazabilidad, idempotencia, conciliación y reglas propias.

Actor principal

Según el canal y los medios utilizados:

cajero;

supervisor;

administrador autorizado;

POS local;

aplicación de pedidos;

servicio de pagos;

integración externa autenticada.

Actores secundarios

cliente;

domiciliario;

módulo de ventas;

módulo de caja;

módulo de crédito;

proveedor de pagos;

módulo de auditoría;

servicio de sincronización;

motor de licencias.

Principio central

Un pago mixto no es un único pago con varios campos.

Debe modelarse como:

una operación de pago compuesta;

varios registros Payment;

varias asignaciones PaymentAllocation;

un mismo payment_group_id o equivalente;

estados independientes por componente;

un estado derivado global para la venta.

Ejemplo:

Venta: $100.000

Payment A:
- CASH
- $40.000
- CONFIRMED

Payment B:
- BANK_TRANSFER
- $60.000
- REPORTED

La venta no debe considerarse totalmente pagada mientras el componente pendiente no sea confirmado.

Precondiciones generales

El usuario o servicio está autenticado.

El tenant y la empresa están activos.

La sucursal pertenece a la empresa.

La licencia permite pagos mixtos.

La venta, pedido u obligación existe.

La operación no está anulada.

El usuario tiene permiso para cada medio incluido.

El dispositivo está autorizado.

La política monetaria y de redondeo está vigente.

La moneda coincide con la obligación.

La solicitud contiene una idempotency_key global.

Cada componente contiene una clave idempotente propia.

El total pagadero fue calculado previamente.

La operación admite pago parcial o mixto según política.

Entrada

Nivel de operación

payment_group_id;

idempotency_key;

sale_id, order_id o receivable_id;

currency;

branch_id;

device_id;

cash_register_id opcional;

cash_shift_id opcional;

customer_id opcional;

correlation_id;

expected_payable_total;

configuration_version.

Nivel de componente

Cada elemento de payments debe incluir:

payment_component_id;

component_idempotency_key;

payment_method;

amount;

provider_id opcional;

external_reference opcional;

reported_at opcional;

evidence_reference opcional;

metadata controlada.

Para efectivo

amount_received;

change_amount propuesto;

denominaciones opcionales.

Para crédito

credit_account_id;

credit_amount;

autorización opcional.

Salida

payment_group_id;

group_status;

sale_payment_status;

payable_total;

covered_amount_confirmed;

covered_amount_pending;

remaining_amount;

rounding_adjustment;

payments;

requires_confirmation;

requires_reconciliation;

created_at;

configuration_version;

audit_reference.

Cada pago devuelto debe incluir:

payment_id;

payment_method;

amount;

status;

confirmed_amount;

pending_amount;

external_reference;

cash_movement_id opcional;

credit_transaction_id opcional.

Estados derivados del grupo

CREATED

La agrupación fue creada, pero todavía no se procesaron todos los componentes.

PARTIALLY_CONFIRMED

Existe al menos un componente confirmado y otro pendiente, reportado, autorizado o fallido.

PAYMENT_PENDING

No existe cobertura confirmada suficiente y al menos un componente espera confirmación.

CONFIRMED

Todos los componentes necesarios están confirmados y cubren exactamente el total pagadero.

FAILED

La agrupación no puede completar la cobertura y no es recuperable sin intervención.

CANCELLED

La agrupación fue cancelada antes de quedar confirmada.

COMPENSATION_REQUIRED

Uno o más componentes se confirmaron, pero otro falló y la política exige reversión o compensación.

RECONCILED

Todos los componentes aplicables fueron conciliados.

Validaciones comunes

Deben existir al menos dos componentes.

Cada componente debe tener importe mayor que cero.

No se aceptan componentes duplicados por clave.

La moneda debe coincidir.

La sucursal debe coincidir con la obligación.

El medio debe estar habilitado.

El usuario debe tener permiso para cada medio.

La suma propuesta debe ser coherente con el total pagadero.

El redondeo solo puede aplicarse al saldo en efectivo.

No se permite redondear componentes electrónicos.

Un componente reportado no cuenta como confirmado.

Un componente rechazado no cubre saldo.

El crédito no incrementa caja.

El efectivo exige caja abierta.

Las referencias externas no pueden reutilizarse de forma incompatible.

Cada componente debe seguir su propia máquina de estados.

La misma solicitud global no puede crear un segundo grupo.

Una repetición con contenido distinto debe producir conflicto.

Los pagos de otro tenant son inaccesibles.

La venta anulada no admite nuevos pagos.

Orden recomendado de captura

Para reducir fricción al cajero:

Mostrar total pagadero.

Permitir agregar medios.

Permitir ajustar importes.

Recalcular saldo restante en tiempo real.

Aplicar redondeo al componente en efectivo.

Validar cobertura.

Confirmar la operación.

Mostrar estado real por componente.

La interfaz no debe obligar a navegar entre múltiples pantallas.

Flujo principal

El actor selecciona “Pago mixto”.

El sistema obtiene el total pagadero vigente.

Verifica tenant, empresa, sucursal, usuario y dispositivo.

Verifica licencia y módulo habilitado.

Verifica caja abierta si existe efectivo.

Crea o recupera el payment_group_id por idempotencia.

El actor agrega el primer medio.

El sistema valida método e importe.

El sistema recalcula el saldo restante.

El actor agrega uno o más medios adicionales.

El sistema valida cada componente.

El sistema normaliza importes electrónicos a pesos enteros.

El sistema identifica el saldo cubierto en efectivo.

Aplica la política de redondeo solo al saldo en efectivo.

Calcula el total cubierto confirmado potencial.

Verifica que la suma no exceda el total pagadero.

Verifica que no queden saldos negativos.

Congela la propuesta de distribución.

Inicia una transacción para crear la agrupación y los componentes.

Registra cada Payment con su estado inicial.

Registra cada PaymentAllocation.

Para efectivo, registra el movimiento de caja.

Para crédito, registra la obligación correspondiente.

Para transferencias manuales, registra estado REPORTED.

Para proveedores externos, inicia el flujo correspondiente.

Recalcula cobertura confirmada.

Deriva el estado de pago de la venta.

Registra auditoría.

Guarda eventos en outbox.

Confirma la transacción local.

Devuelve el estado real del grupo y sus componentes.

Procesos externos continúan de forma asíncrona.

La impresión o notificación no cambia la validez financiera.

Escenarios principales

1. Efectivo + transferencia manual

Ejemplo:

Total pagadero: $100.000

Efectivo:       $40.000
Transferencia:  $60.000

Resultado inicial:

efectivo: CONFIRMED;

transferencia: REPORTED;

grupo: PARTIALLY_CONFIRMED;

venta: PAYMENT_PENDING.

La venta pasa a PAID únicamente cuando la transferencia sea confirmada.

2. Efectivo + tarjeta

Ejemplo:

Total pagadero: $85.000

Efectivo: $25.000
Tarjeta:  $60.000

Flujo:

Se valida caja.

Se inicia el pago con tarjeta.

Si la tarjeta queda confirmada:

se confirma el efectivo;

se confirma el grupo;

la venta queda PAID.

Si la tarjeta es rechazada:

el efectivo no debe quedar confirmado silenciosamente;

la política debe decidir si:

se conserva como pago parcial;

se cancela;

se exige otro medio;

se genera compensación.

La política predeterminada recomendada es conservar el efectivo como pago parcial solo si el usuario confirma explícitamente esa decisión.

3. Transferencia + QR

Ambos medios manuales pueden quedar REPORTED.

La venta permanece PAYMENT_PENDING hasta que la suma confirmada cubra el total.

No debe entregarse mercancía cuando la política exija confirmación total.

4. Efectivo + crédito

Ejemplo:

Total:    $120.000
Efectivo:  $70.000
Crédito:   $50.000

Resultado:

efectivo confirmado;

obligación de crédito creada;

caja incrementa solo $70.000;

la venta puede quedar comercialmente cubierta;

el crédito queda como cuenta por cobrar.

5. Tres o más medios

El sistema debe permitir múltiples componentes siempre que:

la empresa lo habilite;

no se supere el máximo configurado;

todos los componentes sean compatibles;

la suma final cuadre;

la interfaz siga siendo clara.

No se recomienda permitir una cantidad ilimitada de componentes en el POS. El límite debe ser configurable y razonable.

Redondeo en pago mixto

Regla principal

El redondeo se aplica únicamente al saldo final cubierto en efectivo.

Ejemplo:

Total calculado: $10.042,50
Total normalizado: $10.043

Transferencia: $8.000
Saldo efectivo normalizado: $2.043
Efectivo cobrado: $2.050
Ajuste de redondeo: $7

Reglas

No se redondea el total antes de distribuir medios de forma arbitraria.

Los pagos electrónicos se expresan en pesos enteros.

El efectivo absorbe el ajuste permitido.

El ajuste debe registrarse una sola vez.

No se registra como descuento.

Debe quedar asociado al grupo y a la venta.

Si no existe efectivo, no se aplica redondeo a múltiplos de $50.

La suma final debe conciliar exactamente.

Fallo parcial

Definición

Existe fallo parcial cuando uno o más componentes se confirmaron y otro no pudo completarse.

Ejemplo

efectivo confirmado;

tarjeta fallida.

Políticas posibles

KEEP_PARTIAL_PAYMENT

Conservar componentes confirmados y permitir completar el saldo con otro medio.

CANCEL_UNCONFIRMED_ONLY

Cancelar únicamente componentes no confirmados.

COMPENSATE_ALL

Revertir o compensar los componentes confirmados cuando sea posible.

REQUIRE_SUPERVISOR

Bloquear la operación hasta decisión autorizada.

Recomendación predeterminada

efectivo: conservar solo con confirmación explícita del cajero o supervisor;

pagos externos: mantener estado real del proveedor;

nunca cambiar estados silenciosamente;

mostrar claramente el saldo pendiente.

Confirmación atómica y compensación

No todos los medios pueden confirmarse en una única transacción distribuida.

Por tanto:

La creación local del grupo y componentes debe ser atómica.

Los proveedores externos se procesan fuera de la transacción local.

Los resultados tardíos actualizan cada componente.

Si la combinación no puede completarse:

se conserva el estado real;

se calcula saldo pendiente;

se ejecuta compensación cuando aplique;

se registra incidencia.

No se debe simular atomicidad global entre banco, tarjeta y caja local.

Operación offline

Permitido

efectivo;

crédito autorizado con información sincronizada;

registro de transferencia o QR como REPORTED;

grupos mixtos compuestos por medios permitidos offline.

No permitido

confirmar tarjeta sin proveedor;

confirmar transferencia bancaria;

liquidar;

conciliar externamente;

cambiar QR o cuenta destino.

Reglas

Cada componente obtiene identificador global.

El grupo se persiste localmente.

Se registra outbox por grupo y por componente.

Al recuperar conexión se sincroniza idempotentemente.

No se duplican pagos ni movimientos de caja.

Los conflictos se marcan para revisión.

Un componente pendiente no se convierte en confirmado por sincronización sin evidencia válida.

Idempotencia

Nivel de grupo

La idempotency_key global evita duplicar la operación completa.

Nivel de componente

Cada component_idempotency_key evita duplicar un pago individual.

Reglas

Repetir el grupo devuelve el resultado original.

Repetir un componente no crea otro pago.

Misma clave con contenido diferente genera conflicto.

Un webhook repetido actualiza el mismo pago.

Un reintento de sincronización no duplica caja.

La deduplicación no depende solo de importe y fecha.

Persistencia conceptual afectada

payment_groups;

payments;

payment_allocations;

cash_movements;

credit_transactions;

audit_events;

outbox_events;

proyección de estado de pago de venta;

incidencias de compensación cuando apliquen.

La persistencia física definitiva se definirá después.

Eventos

MixedPaymentStarted;

PaymentComponentCreated;

PaymentComponentReported;

PaymentComponentConfirmed;

PaymentComponentRejected;

PaymentComponentFailed;

PaymentGroupPartiallyConfirmed;

PaymentGroupConfirmed;

PaymentGroupFailed;

PaymentCompensationRequired;

CashMovementRecorded;

CreditTransactionCreated;

SalePaymentStatusChanged.

Auditoría

Debe registrar:

actor;

rol;

tenant;

empresa;

sucursal;

caja;

turno;

dispositivo;

total pagadero;

distribución propuesta;

importes por medio;

estados iniciales;

cambios de estado;

redondeo;

referencias protegidas;

decisiones de compensación;

correlación;

resultado final.

No se almacenan secretos, números completos sensibles ni credenciales en logs.

Excepciones

menos de dos medios;

importe cero o negativo;

suma insuficiente;

suma superior;

caja cerrada;

crédito sin cupo;

referencia duplicada;

medio incompatible;

proveedor no disponible;

tarjeta rechazada;

timeout;

licencia restringida;

dispositivo revocado;

conflicto de idempotencia;

venta anulada;

política de redondeo inválida;

acceso entre tenants;

fallo de persistencia;

conflicto de sincronización.

Recuperación ante fallos

Fallo antes del commit local

No debe persistirse un grupo parcial.

Fallo después del commit local

La idempotencia debe recuperar el mismo grupo.

Fallo de un proveedor externo

El componente conserva su estado real y el grupo recalcula cobertura.

Fallo de impresión

No modifica pagos ni grupo.

Fallo de sincronización

Los componentes locales permanecen en outbox.

Respuesta tardía

Debe asociarse al componente original.

Reversión o compensación fallida

Debe generar incidencia visible y auditable.

Invariantes

Un pago mixto contiene pagos independientes.

Cada componente conserva su propio estado.

El estado del grupo es derivado.

El estado de la venta es derivado.

El redondeo solo afecta el saldo en efectivo.

Un pago reportado no cubre como confirmado.

Un componente rechazado no cubre saldo.

El crédito no incrementa caja.

El efectivo exige caja abierta.

Una solicitud repetida no duplica grupo ni componentes.

Una referencia externa no se reutiliza de forma incompatible.

No se simula atomicidad global con proveedores externos.

Los fallos parciales generan estado explícito.

Las compensaciones se registran, no se ocultan.

Los pagos de otro tenant son inaccesibles.

La impresión no determina la validez financiera.

El modo offline no inventa confirmaciones.

Toda transición crítica queda auditada.

La suma de cobertura confirmada no puede exceder el total sin política explícita.

El grupo debe poder reconstruirse desde sus componentes.

Criterios de aceptación

El sistema permite registrar al menos dos medios compatibles.

Cada medio crea un pago independiente.

El efectivo genera movimiento de caja.

La transferencia manual queda REPORTED.

La venta permanece pendiente mientras falte confirmación.

El redondeo se aplica solo al efectivo.

Una tarjeta rechazada no confirma el grupo.

El crédito genera cuenta por cobrar.

Repetir la solicitud no duplica pagos.

Un fallo parcial queda visible.

El estado global se recalcula automáticamente.

La operación offline sincroniza sin duplicados.

Ningún pago de otro tenant puede asignarse.

Pruebas mínimas

efectivo + transferencia;

efectivo + tarjeta;

transferencia + QR;

efectivo + crédito;

tres medios;

redondeo con efectivo;

sin efectivo;

pago insuficiente;

pago superior;

componente reportado;

componente rechazado;

tarjeta con timeout;

tarjeta confirmada tardíamente;

crédito sin cupo;

caja cerrada;

grupo duplicado;

componente duplicado;

referencia externa duplicada;

fallo parcial;

compensación requerida;

fallo de impresión;

operación offline;

sincronización repetida;

conflicto de versión;

dispositivo revocado;

licencia restringida;

aislamiento entre tenants;

rollback transaccional.
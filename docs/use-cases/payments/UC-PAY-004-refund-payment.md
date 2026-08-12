# UC-PAY-004: Reembolsar o revertir un pago

## Objetivo

Solicitar, autorizar, ejecutar y seguir la devolución total o parcial de valor asociado a un pago confirmado, o revertir una autorización o confirmación cuando el proveedor y el estado todavía lo permitan, sin alterar destructivamente el pago ni la venta originales.

El caso de uso conserva trazabilidad entre venta, pago, reembolso, reversión, caja, crédito, inventario, impuestos, conciliación y sincronización. Toda operación debe respetar aislamiento multiempresa, permisos, segregación de funciones, idempotencia y el estado real de cada medio.

Este documento define comportamiento de dominio y persistencia conceptual. No define tablas, migraciones, endpoints ni una integración bancaria concreta.

---

## Actores principales

Según el medio, el importe y la política:

- propietario;
- administrador general;
- gerente de sucursal;
- supervisor autorizado;
- cajero dentro de límites explícitos;
- servicio de pagos;
- integración externa autenticada;
- proceso de sincronización autorizado.

## Actores secundarios

- cliente;
- módulo de ventas;
- módulo de caja;
- módulo de inventario;
- módulo tributario;
- módulo de crédito y cartera;
- proveedor de pagos;
- módulo de auditoría;
- servicio de notificaciones;
- servicio de conciliación;
- aplicación de pedidos;
- módulo de domicilios;
- domiciliario, únicamente como consultante o reportante autorizado;
- motor de licencias.

---

## Definición formal de Refund y Reversal

### Refund

`Refund` es una operación compensatoria que devuelve dinero o restaura valor después de una venta o pago confirmado.

Puede ser:

- total;
- parcial;
- posterior a liquidación;
- posterior a conciliación, sin borrar la conciliación histórica;
- asociada a una devolución física, o independiente de ella cuando la política lo permita.

Un `Refund`:

- referencia uno o más pagos originales elegibles;
- conserva asignaciones por pago, componente, línea, impuesto y concepto;
- acumula lo ya completado antes de calcular el valor disponible;
- no cambia la identidad ni borra los hechos del pago original;
- puede requerir ejecución asíncrona para medios externos.

### Reversal

`Reversal` revierte una autorización o confirmación cuando el proveedor y el estado de la operación todavía lo permiten. Normalmente ocurre antes de la liquidación y no representa una devolución comercial.

Un `Reversal`:

- referencia la autorización o confirmación original;
- conserva el motivo y la respuesta autenticada del proveedor cuando exista;
- no se simula si el proveedor no ofrece esa capacidad;
- se reemplaza por un flujo de `Refund` cuando la reversión ya no es válida;
- no prueba por sí mismo que haya existido devolución física de mercancía.

### Separación obligatoria

`Refund` y `Reversal` son operaciones diferentes. No se intercambian sus nombres ni se oculta una dentro de la otra.

El pago original conserva historial inmutable. Los estados `PARTIALLY_REFUNDED`, `REFUNDED` y `REVERSED` descritos en `docs/domain/payment-lifecycle.md` se interpretan aquí como resultados o proyecciones derivadas de operaciones compensatorias confirmadas y de un historial append-only. No autorizan sobrescribir destructivamente el registro original.

Los estados definidos en este documento pertenecen a `Refund` o `Reversal`, no se agregan automáticamente a `Payment`.

---

## Precondiciones

1. El actor o servicio está autenticado.
2. El tenant y la empresa están activos.
3. La sucursal pertenece a la empresa y está dentro del alcance del actor.
4. La licencia permite la operación y los módulos afectados.
5. El dispositivo o identidad técnica está autorizado.
6. La venta, obligación y pago original existen.
7. El pago pertenece al mismo tenant y empresa.
8. El pago tiene valor confirmado elegible para devolver o un estado que permite reversión.
9. La moneda del reembolso coincide con la del pago original.
10. Existe motivo válido y política de devolución vigente.
11. Se conocen la versión esperada del pago y, cuando aplique, de la venta, grupo y reembolso acumulado.
12. La solicitud contiene `idempotency_key`.
13. El actor tiene permiso para solicitar y, cuando corresponda, aprobar o ejecutar.
14. Los snapshots comerciales y tributarios de la venta original están disponibles.
15. Para efectivo existen caja y turno abiertos en la sucursal autorizada.
16. Para crédito existe una cuenta identificada y una proyección vigente dentro de la tolerancia offline permitida.
17. Para un medio externo existe un mecanismo válido para registrar la solicitud; no se presupone que exista API.

---

## Entrada

### Nivel de operación

- `refund_id` o `reversal_id` global;
- `operation_type`: `REFUND` o `REVERSAL`;
- `idempotency_key`;
- `sale_id`, `order_id` o `receivable_id`;
- `payment_group_id` opcional;
- `reason_code`;
- `reason_detail`;
- `requested_at`;
- `branch_id`;
- `device_id`;
- `currency`;
- `expected_sale_version`;
- `expected_refund_version`;
- `pricing_pipeline_version`;
- `tax_policy_version`;
- `rounding_policy_version`;
- `correlation_id`.

El contexto de `tenant_id`, `company_id`, actor y permisos se deriva de la identidad autenticada. No se confía en valores libres enviados por el frontend.

### Nivel de componente financiero

Cada componente solicitado incluye:

- `payment_id`;
- `requested_amount`;
- `expected_payment_version`;
- `refund_method`, normalmente igual al medio original;
- `provider_id` opcional;
- `provider_reference` protegida, cuando exista;
- `original_payment_allocation_id` opcional;
- `payment_idempotency_key`;
- `override_reason` y aprobador, si se aparta de la política original.

### Nivel comercial y tributario

- líneas y cantidades elegibles;
- importes comerciales elegibles por línea;
- descuentos y promociones congelados;
- bases e impuestos de los snapshots originales;
- valor no asociado a líneas, como sobrepago, cuando aplique;
- referencia a devolución física opcional;
- condición del producto opcional;
- política de reincorporación a inventario, solo como referencia del proceso propietario.

### Datos adicionales para efectivo

- `cash_register_id`;
- `cash_shift_id`;
- valor a entregar;
- desglose opcional por denominación;
- autorización de límite cuando aplique.

### Datos adicionales para medios externos

- acción solicitada al proveedor, si existe integración autorizada;
- referencia de la solicitud externa;
- evidencia autenticada del resultado, cuando llegue;
- fecha y estado reportados por el proveedor;
- cuenta destino protegida cuando la devolución manual la requiera.

---

## Salida

- `refund_id` o `reversal_id`;
- `operation_type`;
- estado anterior y nuevo de la operación compensatoria;
- `requested_amount`;
- `approved_amount`;
- `completed_amount`;
- `failed_amount`;
- `remaining_eligible_amount`;
- componentes y estado de cada uno;
- `cash_movement_id` opcional;
- `credit_transaction_id` opcional;
- `provider_operation_reference` opcional;
- `sale_refund_status` derivado;
- `payment_refund_status` derivado por componente;
- `inventory_return_status` informativo, sin modificar inventario;
- `tax_effect_status`;
- `requires_reconciliation`;
- `requires_manual_review`;
- `next_action`;
- `created_at` y `completed_at` opcional;
- `pricing_pipeline_version`;
- `tax_policy_version`;
- `rounding_policy_version`;
- `audit_reference`.

---

## Permisos y segregación de funciones

### Permisos conceptuales iniciales

- `payments.refund.request`;
- `payments.refund.approve`;
- `payments.refund.execute.cash`;
- `payments.refund.execute.external`;
- `payments.refund.override_method`;
- `payments.refund.override_distribution`;
- `payments.reversal.request`;
- `payments.reversal.approve`;
- `payments.reversal.execute`;
- `credit.refund.adjust`;
- `payments.refund.review`;
- `payments.refund.read`.

Estos permisos están incorporados en la matriz atómica de producto. No sustituyen la validación backend, el ownership de Payments ni las políticas de alcance y segregación.

### Alcance inicial por rol

- `OWNER`: puede solicitar, aprobar y consultar dentro de su empresa, sujeto a reautenticación y políticas críticas.
- `GENERAL_ADMIN`: puede operar según delegación y límites configurados.
- `BRANCH_MANAGER`: puede operar únicamente sobre sucursales asignadas y dentro de su límite.
- `SUPERVISOR`: puede aprobar o ejecutar excepciones dentro de su alcance.
- `CASHIER`: puede solicitar; solo puede ejecutar efectivo dentro de límites explícitos, con caja propia abierta y aprobación cuando aplique.
- `COURIER`: no solicita, aprueba ni ejecuta reembolsos; solo consulta el estado necesario para su pedido.
- `CUSTOMER`: puede solicitar atención comercial por un canal autorizado, pero no aprueba ni confirma la devolución financiera.
- integraciones: solo ejecutan acciones técnicas autenticadas y limitadas al proveedor configurado.

### Segregación

La política puede exigir que solicitante, aprobador y ejecutor sean personas distintas.

Siempre requieren control reforzado:

- importes sobre umbral;
- selección de un medio diferente al original;
- selección manual de un componente de pago mixto;
- reembolso fuera de horario;
- reembolso repetido al mismo cliente, pago, dispositivo o actor;
- operación sobre otra sucursal autorizada excepcionalmente;
- sobrepago;
- producto no retornado;
- reversión de una confirmación manual sospechosa;
- reembolso de pago no conciliado;
- excepción tributaria o monetaria.

Toda excepción exige motivo, aprobador, reautenticación cuando corresponda y auditoría.

---

## Estados conceptuales del reembolso

Los siguientes estados pertenecen al agregado `Refund`. Una `Reversal` usa un ciclo separado con los estados que sean aplicables y nunca convierte esos estados en estados nuevos de `Payment`.

### `REQUESTED`

La solicitud fue registrada, pero todavía no se ha aprobado ni ejecutado.

### `PENDING_APPROVAL`

La política exige aprobación por rol, umbral, riesgo o excepción.

### `APPROVED`

La operación fue autorizada por el importe y componentes explícitos, pero aún no se ha completado financieramente.

### `PROCESSING`

La ejecución está en curso o espera confirmación válida del medio externo. La proyección de interfaz puede mostrar `PENDING_REFUND`, pero ese alias no es un nuevo estado de `Payment`.

### `COMPLETED`

Todo el importe aprobado quedó devuelto mediante evidencia válida y los efectos internos requeridos quedaron registrados.

### `PARTIALLY_COMPLETED`

Solo parte del importe aprobado se completó. Debe mostrar componentes completados, fallidos y pendientes.

### `REJECTED`

La solicitud fue revisada y declarada no procedente antes de completar valor.

### `CANCELLED`

La solicitud se canceló antes de completar valor. No cancela silenciosamente componentes ya completados.

### `FAILED`

La ejecución falló. Debe clasificarse como recuperable o no recuperable y conservar intentos.

### `REVIEW_REQUIRED`

Existe contradicción, posible duplicado, riesgo, resultado tardío o diferencia que impide resolver automáticamente.

### Transiciones iniciales

```text
REQUESTED
├── PENDING_APPROVAL
├── APPROVED
├── REJECTED
├── CANCELLED
└── REVIEW_REQUIRED

PENDING_APPROVAL
├── APPROVED
├── REJECTED
├── CANCELLED
└── REVIEW_REQUIRED

APPROVED
├── PROCESSING
├── COMPLETED
├── CANCELLED
└── REVIEW_REQUIRED

PROCESSING
├── COMPLETED
├── PARTIALLY_COMPLETED
├── FAILED
└── REVIEW_REQUIRED

PARTIALLY_COMPLETED
├── PROCESSING
├── COMPLETED
├── FAILED
└── REVIEW_REQUIRED

FAILED
├── PROCESSING
├── CANCELLED
└── REVIEW_REQUIRED

REVIEW_REQUIRED
├── PENDING_APPROVAL
├── APPROVED
├── PROCESSING
├── REJECTED
└── CANCELLED
```

`COMPLETED`, `REJECTED` y `CANCELLED` son terminales para la solicitud. Una corrección posterior crea otra operación vinculada; no reabre ni sobrescribe la anterior.

Para `Reversal`, `COMPLETED` produce una proyección `REVERSED` del pago únicamente cuando la evidencia válida cubre todo el valor reversible. Un intento parcial o incierto permanece explícito y puede requerir `Refund` o revisión.

---

## Validaciones comunes

1. El pago existe y pertenece al tenant y empresa autorizados.
2. El actor tiene alcance sobre la sucursal y el recurso.
3. El importe solicitado es mayor que cero.
4. La moneda coincide con el pago original.
5. Solo el valor confirmado es elegible para `Refund`.
6. Solo una autorización o confirmación reversible según proveedor y estado es elegible para `Reversal`.
7. El acumulado completado, reservado por operaciones en curso y solicitado no puede superar el valor elegible.
8. El importe elegible se calcula con snapshots y operaciones compensatorias previas, no con configuración actual.
9. Una solicitud repetida no crea otra devolución, salida de caja, ajuste de crédito ni llamada externa.
10. La misma clave con contenido diferente produce conflicto.
11. El pago original, sus asignaciones históricas y la venta no se eliminan.
12. Cada componente de un pago mixto se valida por separado.
13. El medio predeterminado es el original.
14. Cambiar el medio o seleccionar un componente específico exige permiso y motivo.
15. Una captura, declaración del cliente o notificación no autenticada no confirma una devolución externa.
16. El efectivo exige caja y turno abiertos, sucursal compatible y límite disponible.
17. El crédito no genera efectivo salvo que exista saldo pagado elegible que se devuelva por otro medio autorizado.
18. El reembolso financiero no incrementa inventario.
19. Una devolución física no prueba que el dinero haya sido devuelto.
20. Los efectos tributarios usan snapshots originales y quedan separados.
21. El redondeo no se aplica por línea ni se disfraza como producto, impuesto o descuento.
22. Un pago no conciliado puede reembolsarse si está confirmado, pero genera marca o incidencia de conciliación.
23. Comisiones, retenciones o diferencias del proveedor no reducen silenciosamente el derecho reconocido al cliente.
24. Sesión, dispositivo, licencia y configuración deben seguir vigentes.
25. La versión esperada evita que dos solicitudes consuman el mismo valor elegible.
26. La distribución predeterminada de un refund parcial mixto usa el algoritmo versionado `PROPORTIONAL_ORIGINAL_CONFIRMED_V1`.
27. Antes de calcular proporciones se excluyen componentes no confirmados, sin saldo reembolsable o cuyo medio no permita el refund.
28. Una restricción real del proveedor que exija un componente específico prevalece sobre el prorrateo general.
29. Los residuos de precisión se asignan al pago elegible con mayor importe confirmado originalmente asignado y capacidad disponible; los empates se resuelven por `payment_id` en orden estable ascendente.
30. Un override manual de componente exige permiso, motivo y auditoría, y no puede exceder ningún saldo reembolsable.
31. La suma final de `RefundComponent` debe coincidir exactamente con el importe aprobado.
32. El algoritmo, versión, conjunto elegible, exclusiones, proporciones, residuos y overrides quedan congelados en el snapshot conceptual del `Refund`.

---

## Flujo principal

1. El actor inicia una solicitud de `Refund` o `Reversal` sobre una venta o pago.
2. El sistema deriva tenant, empresa, sucursal, actor, rol y dispositivo.
3. Verifica licencia, permisos, límites y segregación.
4. Localiza venta, pagos, grupo, asignaciones, reembolsos, reversiones y conciliaciones relacionadas.
5. Verifica versiones y deduplicación por solicitud y operación compensatoria.
6. Obtiene snapshots comerciales, monetarios y tributarios originales.
7. Calcula el valor confirmado original por componente.
8. Resta reembolsos y reversiones completados, y reserva valores de operaciones concurrentes aprobadas o en proceso según política.
9. Determina el valor elegible restante.
10. Valida líneas, cantidades, impuestos, sobrepago y conceptos solicitados.
11. Separa el estado de la devolución física del estado financiero.
12. Distribuye el importe por pago y componente; por defecto usa el medio original.
13. Evalúa umbrales, señales de riesgo y necesidad de aprobación.
14. Crea la solicitud en `REQUESTED`, `PENDING_APPROVAL` o `APPROVED`.
15. Si requiere aprobación, conserva el valor reservado sin ejecutar movimientos financieros.
16. El aprobador revisa importe, motivo, medio, venta, evidencia, devoluciones previas y alertas.
17. Al aprobar, el sistema ejecuta cada componente según su medio.
18. Para efectos locales que deban ser atómicos, registra operación, asignaciones, movimiento de caja o crédito, auditoría y outbox en una transacción.
19. Para proveedores externos, registra el intento y cambia a `PROCESSING` sin simular atomicidad distribuida.
20. Procesa respuestas autenticadas e idempotentes.
21. Deriva el estado del reembolso desde sus componentes.
22. Deriva el estado de reembolso del pago y de la venta sin edición manual.
23. Mantiene inventario y devolución física como procesos independientes enlazados.
24. Marca necesidades de conciliación o crea incidencia.
25. Registra auditoría y eventos mediante outbox.
26. Confirma la transacción local.
27. Envía notificaciones desacopladas.
28. Devuelve estado real, importes completados, pendientes y siguiente acción.

---

## Reembolso total

Un reembolso total devuelve todo el valor elegible confirmado que permanece disponible.

Reglas:

1. Debe considerar devoluciones y reversiones anteriores.
2. Debe distribuirse por los pagos originales; no se crea un único reembolso opaco si la venta fue pagada con varios medios.
3. Solo queda `COMPLETED` cuando todos los componentes requeridos tienen evidencia válida.
4. Si un componente queda pendiente, el resultado es `PARTIALLY_COMPLETED` o `PROCESSING`, no `COMPLETED`.
5. La venta deriva `REFUNDED` únicamente cuando el valor elegible total se completó.
6. Inventario, comprobante fiscal y conciliación conservan estados propios.

---

## Reembolso parcial

Un reembolso parcial devuelve una parte explícita del valor elegible.

Debe conservar:

- líneas y cantidades relacionadas;
- importe comercial;
- descuentos y promociones asignados;
- base e impuesto del snapshot;
- componente de pago utilizado;
- importe completado y pendiente;
- acumulado previo y saldo elegible posterior.

Reglas:

1. Las devoluciones parciales se acumulan con precisión decimal.
2. Ningún acumulado puede superar el valor elegible.
3. No se recalcula el precio actual ni la promoción vigente.
4. No se redondea cada línea.
5. La venta deriva `PARTIALLY_REFUNDED` mientras conserve valor elegible no devuelto.
6. Una solicitud posterior vuelve a calcular el saldo bajo control de versión.

---

## Reembolso de pago individual

1. El sistema obtiene el `Payment` original y su asignación.
2. Valida que esté confirmado y tenga saldo elegible.
3. Determina si procede `Reversal` o `Refund` según estado, liquidación y capacidad real del medio.
4. Usa el medio original por defecto.
5. Registra una única operación compensatoria vinculada.
6. Ejecuta el flujo específico del medio.
7. Deriva `PARTIALLY_REFUNDED`, `REFUNDED` o `REVERSED` solo a partir de resultados completados.

Un `Payment` en `PENDING`, `CANCELLED` o `FAILED` sin valor confirmado no se reembolsa. Los reportes, rechazos y expiraciones pertenecen a la evidencia o estado de `PaymentAttempt`; pueden gestionarse mediante `UC-PAY-006` sin ampliar `PaymentStatus`.

---

## Reembolso de pago mixto

Cada componente se devuelve por separado.

### Algoritmo predeterminado de distribución proporcional

El algoritmo operativo predeterminado es `PROPORTIONAL_ORIGINAL_CONFIRMED_V1`.

Para cada componente elegible `i` se define:

- `original_confirmed_allocated_amount_i`: importe confirmado y originalmente asignado por el componente a la obligación;
- `refundable_balance_i`: saldo todavía reembolsable después de refunds y reversals completados o reservados;
- `weight_i`: `original_confirmed_allocated_amount_i`.

El algoritmo se ejecuta así:

1. Construye el conjunto elegible únicamente con componentes confirmados, con `refundable_balance_i > 0` y medio permitido para el refund.
2. Excluye antes del cálculo todo componente no confirmado, agotado, cancelado, revertido totalmente o no reembolsable por una restricción válida. El snapshot registra el motivo de cada exclusión.
3. Conserva el medio original de cada componente.
4. Si un proveedor exige devolver a un componente específico, esa restricción prevalece. El conjunto aplicable se limita al componente exigido; si su saldo no cubre el importe aprobado, la distribución no se completa automáticamente y queda `REVIEW_REQUIRED`.
5. Sin restricción del proveedor ni override autorizado, calcula la proporción de cada componente:

   `proportion_i = weight_i / sum(weight_eligible)`

6. Calcula la asignación teórica:

   `raw_refund_i = approved_refund_amount * proportion_i`

7. Expresa cada asignación en la precisión monetaria interna vigente. Esta cuantización sirve para distribuir componentes y no resuelve la fórmula definitiva de redondeo COP al cliente.
8. Si una asignación supera `refundable_balance_i`, la limita a ese saldo y redistribuye iterativamente el remanente entre los demás componentes elegibles, usando sus pesos originales. Ningún componente puede superar su saldo reembolsable.
9. Después de cuantizar y aplicar límites, calcula el residuo:

   `residual = approved_refund_amount - sum(refund_component_amounts)`

10. Asigna el residuo, en unidades de la precisión monetaria interna, al componente elegible con mayor `original_confirmed_allocated_amount`. Si ese componente no tiene capacidad suficiente, continúa con el siguiente por el mismo orden.
11. Si dos o más pagos empatan en importe original, usa `payment_id` en orden estable ascendente.
12. Verifica que la suma final de todos los `RefundComponent` coincida exactamente con `approved_refund_amount`. Si no puede cuadrar sin exceder un saldo o violar una restricción, rechaza la distribución automática y marca `REVIEW_REQUIRED`.
13. Una selección manual sustituye el prorrateo únicamente con `payments.refund.override_distribution` o permiso equivalente, motivo explícito, límites válidos y auditoría de distribución original y distribución aprobada.
14. Congela en el snapshot conceptual del `Refund`:
    - identificador `PROPORTIONAL_ORIGINAL_CONFIRMED`;
    - versión `1`;
    - importe aprobado;
    - componentes evaluados;
    - importes originales confirmados y asignados;
    - saldos reembolsables;
    - componentes excluidos y motivos;
    - proporciones y asignaciones teóricas;
    - límites aplicados y redistribuciones;
    - residuo y componente receptor;
    - orden estable utilizado;
    - restricción de proveedor u override, cuando aplique;
    - suma final validada.

### Ejemplo proporcional aprobado

```text
Venta total:          $100.000
Efectivo confirmado:   $40.000
Tarjeta confirmada:    $60.000
Refund aprobado:       $25.000
Refund efectivo:       $10.000
Refund tarjeta:        $15.000
```

La proporción original es 40 % efectivo y 60 % tarjeta. El refund aprobado se distribuye en esa misma proporción y conserva ambos medios originales.

El estado de ejecución sigue siendo independiente de la distribución. Por ejemplo:

```text
Refund efectivo: $10.000 COMPLETED
Refund tarjeta:  $15.000 PROCESSING
Refund group:    PARTIALLY_COMPLETED
```

Reglas:

1. Cada componente tiene identificador, clave idempotente y estado propios.
2. No se mezcla efectivo, transferencia, tarjeta y crédito en un campo sin estructura.
3. La suma completada se deriva desde componentes.
4. Un fallo externo no revierte silenciosamente un reembolso en efectivo ya entregado.
5. Si se requiere compensar un componente completado, se crea otra operación explícita y una incidencia.
6. La selección manual de componente requiere permiso, motivo y auditoría.
7. Los componentes no reembolsables se excluyen antes de calcular las proporciones.
8. Una restricción específica del proveedor prevalece sobre la distribución proporcional.
9. La suma de componentes debe coincidir exactamente con el importe aprobado.
10. `PAY-007` debe incorporar formalmente esta política y su versionado a la máquina de estados y al modelo conceptual, sin redefinir el algoritmo operativo predeterminado aprobado aquí.

---

## Reembolso en efectivo

### Precondiciones adicionales

- caja activa;
- turno abierto;
- actor autorizado para esa caja y sucursal;
- efectivo y límite operativo suficientes o política de escalamiento;
- aprobación de supervisor cuando corresponda.

### Flujo

1. Se valida el saldo elegible.
2. Se valida caja, turno, dispositivo, actor y límite.
3. Se calcula el importe comercial y cualquier ajuste monetario separado.
4. Se crea o aprueba el `Refund`.
5. En una misma transacción local se registran:
   - componente de reembolso;
   - asignación al pago original;
   - salida de caja;
   - estado derivado;
   - auditoría;
   - evento de outbox.
6. El componente pasa a `COMPLETED`.
7. El efectivo esperado disminuye por una salida identificada como reembolso.

El reembolso no se registra como ajuste genérico, retiro, descuento ni corrección del movimiento original.

Si no hay caja abierta o el efectivo es insuficiente, no se inventa una salida. La operación queda `PENDING_APPROVAL`, `REVIEW_REQUIRED` o se propone otro medio con permiso explícito.

---

## Reembolso de transferencia o QR manual

La transferencia o QR original confirmado puede requerir una devolución manual desde una cuenta autorizada del negocio.

Flujo:

1. Se valida el pago confirmado por `UC-PAY-003` o fuente equivalente.
2. Se crea el `Refund` aprobado.
3. Se registra la instrucción o gestión manual sin afirmar que el dinero salió.
4. El componente queda `PROCESSING`; la interfaz puede proyectar `PENDING_REFUND`.
5. Un actor segregado verifica la fuente financiera autorizada.
6. Se registran referencia, valor, cuenta origen autorizada, destino protegido y confirmador.
7. Solo una evidencia financiera válida cambia el componente a `COMPLETED`.
8. Una captura, mensaje, número digitado o declaración del ejecutor puede ser soporte, pero no confirma por sí solo.

No se inventa una API de Nequi, Daviplata, banco o QR. Mientras no exista integración confiable, el proceso es manual, autorizado y auditable.

---

## Reembolso de tarjeta o proveedor externo

1. Se verifica que el pago esté confirmado y el proveedor identificado.
2. Se determina si el proveedor permite `Reversal` o exige `Refund`.
3. Se crea la operación local y un intento externo idempotente.
4. El componente queda `PROCESSING`.
5. El proveedor responde por un canal autenticado cuando exista.
6. Se validan referencia, moneda, importe y operación original.
7. Una respuesta válida completa, rechaza o falla el intento.
8. Un timeout mantiene el componente pendiente; no equivale a rechazo.
9. Una respuesta tardía actualiza el intento original.
10. La liquidación y conciliación se actualizan posteriormente sin alterar la venta de forma silenciosa.

Si no existe integración, solo puede registrarse una solicitud o gestión manual autorizada. El sistema no afirma que el proveedor devolvió dinero.

---

## Reversión antes de liquidación

Una `Reversal` procede cuando:

- existe autorización o confirmación reversible;
- el proveedor y estado todavía permiten revertir;
- la operación no fue liquidada, salvo semántica explícita y autenticada del proveedor;
- el importe reversible permanece disponible;
- el actor o integración tiene permiso.

Flujo:

1. Se crea `Reversal` vinculada al pago y autorización originales.
2. Se registra motivo, versión e idempotencia.
3. Se envía o registra la solicitud por el mecanismo real disponible.
4. La operación queda `PROCESSING` mientras el resultado sea incierto.
5. La respuesta autenticada se procesa una sola vez.
6. Al completarse, se emite `PaymentReversed` y se recalculan proyecciones.
7. Si la reversión no es permitida, se conserva el intento y se inicia `Refund` separado cuando corresponda.

No se utiliza `Reversal` para representar devolución comercial posterior a liquidación.

---

## Reembolso de crédito y cartera

`CUSTOMER_CREDIT` no es efectivo recibido.

Reglas:

1. Si la obligación no ha sido pagada, el reembolso reduce o revierte la cuenta por cobrar mediante un movimiento de crédito vinculado.
2. La reducción restaura cupo según la política vigente y conserva el saldo anterior y nuevo.
3. No genera salida de caja.
4. Si el cliente ya realizó abonos reales, se identifica qué valor corresponde a saldo pagado elegible.
5. Solo el saldo efectivamente pagado puede originar devolución monetaria por un medio autorizado.
6. No se mezcla reducción de cartera con devolución de efectivo en un único movimiento.
7. Offline solo se permite si la proyección de crédito está vigente y dentro de límites; un conflicto queda `REVIEW_REQUIRED`.

---

## Relación con devolución física e inventario

El proceso financiero y el proceso físico están relacionados mediante referencias, pero tienen estados y autoridades diferentes.

Reglas:

1. El reembolso financiero no incrementa inventario automáticamente.
2. Inventario solo cambia mediante un movimiento creado por su propio caso de uso después de validar recepción, condición, lote, vencimiento y ubicación.
3. Una devolución física puede existir antes, durante o después del reembolso.
4. Una devolución física puede quedar pendiente de reembolso por garantía, inspección o aprobación.
5. Un reembolso puede completarse sin retorno a stock cuando la política lo permita.
6. No se usa el estado de inventario para falsificar un estado financiero.
7. Los eventos enlazan ambos procesos sin permitir modificación directa de datos propietarios.

Estados informativos posibles de la devolución física:

- no requerida;
- pendiente de recepción;
- recibida pendiente de inspección;
- aceptada para stock;
- aceptada sin reincorporación;
- rechazada;
- enviada a garantía.

Estos estados no pertenecen a `Refund` ni a `Payment`.

---

## Productos dañados, consumidos, perecederos o no retornables

Un artículo puede ser financieramente elegible aunque no deba regresar a stock.

Casos:

- producto dañado;
- producto consumido parcialmente;
- perecedero abierto o vencido;
- servicio ya prestado con compensación comercial autorizada;
- artículo sanitario o regulado no retornable;
- empaque comprometido;
- garantía administrada por proveedor.

Reglas:

1. Se registra condición, motivo, evidencia y aprobador.
2. El reembolso no crea inventario disponible.
3. Si el artículo ingresa físicamente, inventario decide cuarentena, merma, devolución a proveedor o disposición.
4. La política puede exigir supervisor.
5. Costos y pérdidas se registran por procesos separados; no se ocultan reduciendo el reembolso al cliente.

---

## Efecto tributario

1. El reembolso usa producto, precio, descuento, promoción, base, tasa e impuesto de los snapshots de la venta original.
2. No recalcula el pasado con la configuración tributaria actual.
3. El efecto se distribuye por línea y componente tributario de manera determinista.
4. Un reembolso parcial no puede revertir más base o impuesto que el acumulado elegible.
5. El resultado tributario se conserva separado del movimiento financiero.
6. La venta y el documento original permanecen inmutables.
7. Este caso no simula nota crédito fiscal, CUFE, QR fiscal ni integración DIAN.
8. Cuando una integración fiscal exista, su documento y estado serán procesos vinculados y no una precondición inventada para completar el reembolso comercial.
9. Una falla fiscal no puede borrar una devolución financiera ya confirmada; genera estado pendiente o incidencia según la política futura.

---

## Tratamiento del redondeo COP

1. El ajuste original no se devuelve como si fuera un producto, impuesto o descuento.
2. El valor comercial elegible se calcula desde líneas, descuentos, promociones e impuestos congelados.
3. No se redondea cada línea ni cada impuesto.
4. Para una devolución parcial se consolida primero el total elegible de la operación.
5. Cualquier normalización o ajuste de efectivo se calcula una sola vez mediante una política versionada.
6. `commercial_refund_amount`, `refund_rounding_adjustment` y `cash_refund_amount` se conservan por separado.
7. La salida de caja registra el valor efectivamente entregado.
8. La diferencia nunca se oculta como ajuste genérico de caja.
9. La asignación definitiva del ajuste original y la regla de empate siguen pendientes de DEC-006 y `PAY-007`; este caso no inventa una fórmula no aprobada.

---

## Pago confirmado pero no conciliado

Un pago `CONFIRMED` puede reembolsarse aunque aún no esté conciliado.

Reglas:

1. El estado confirmado debe tener fuente válida.
2. Se marca `requires_reconciliation`.
3. Se crea una incidencia o marca que vincula pago y reembolso.
4. La conciliación posterior debe mostrar ambos movimientos.
5. Una diferencia no cambia silenciosamente el importe devuelto ni la venta.
6. UC-PAY-005 definirá cruce, resolución y cierre de esta incidencia.

---

## Pago liquidado

Después de `SETTLED`, la política normal es `Refund`, no `Reversal`.

1. Se conserva la liquidación original.
2. El reembolso se registra como operación posterior.
3. Se vincula a la liquidación cuando el proveedor entregue esa relación.
4. Si el proveedor llama “reversal” a una operación posterior, el dominio debe clasificarla por su efecto real antes de mapearla.
5. El resultado se conciliará en un periodo igual o posterior sin reescribir el periodo original.

---

## Comisiones, retenciones y diferencias del proveedor

1. La comisión o retención del proveedor no reduce silenciosamente el importe reconocido al cliente.
2. El reembolso al cliente, el costo del proveedor y el valor neto de liquidación son conceptos separados.
3. Una comisión no recuperable se registra como diferencia o gasto por el proceso propietario.
4. Una comisión devuelta se registra en conciliación, no como aumento ficticio del reembolso.
5. Retenciones, contracargos, tasas y diferencias generan asignaciones explícitas.
6. UC-PAY-005 definirá reglas de conciliación, periodos, fuentes y tratamiento contable conceptual.

---

## Sobrepago

El sobrepago confirmado es valor recibido por encima de la obligación y debe resolverse explícitamente.

1. Se identifica la porción no asignada a líneas o deuda.
2. La devolución del excedente referencia el pago original y el registro de sobrepago.
3. No se crea una devolución física ficticia.
4. No se asignan impuestos ni productos al excedente salvo que el snapshot demuestre esa relación.
5. El medio original es el predeterminado.
6. Cambiar el medio exige permiso y motivo.
7. La devolución nunca puede superar el excedente confirmado disponible.
8. Si el sobrepago fue causado por respuesta tardía o doble cobro, se crea incidencia.

---

## Fallo parcial y compensación

Existe fallo parcial cuando uno o más componentes se completaron y otros quedaron pendientes, rechazados o fallidos.

Reglas:

1. El grupo queda `PARTIALLY_COMPLETED` mientras el resultado no sea total.
2. Se conserva el estado real de cada componente.
3. No se marca `COMPLETED` por intención administrativa.
4. Reintentar usa el mismo componente cuando representa la misma operación.
5. Un nuevo intento comercial tiene identidad propia y vínculo con el anterior.
6. Una compensación de un componente ya completado crea otra operación; nunca borra el movimiento.
7. Si no puede garantizarse la compensación, se crea incidencia `REVIEW_REQUIRED`.
8. La suma completada, pendiente y fallida debe reconstruirse exactamente.
9. La venta deriva su estado desde valores completados, no desde el estado nominal del grupo.

---

## Operación offline

### Permitido

- reembolso en efectivo con caja y turno abiertos, permisos, límites y datos vigentes;
- reducción o reversión de crédito interno con proyección vigente y política autorizada;
- registro local de solicitud para transferencia, QR, tarjeta o billetera;
- persistencia local, auditoría y outbox.

### No permitido

- inventar confirmación de devolución externa;
- afirmar que un proveedor ejecutó una reversión sin evidencia válida;
- liquidar o conciliar externamente;
- cambiar cuenta o QR;
- resolver silenciosamente conflictos de versión;
- ejecutar por segunda vez una salida de caja sincronizada.

### Flujo

1. Se valida identidad, licencia, política y datos locales.
2. Se crea un identificador global.
3. Se ejecutan únicamente efectos locales permitidos.
4. Se registra outbox por operación y componente.
5. Al recuperar conexión se sincroniza idempotentemente.
6. El servidor deduplica y compara versiones.
7. Los conflictos o excesos acumulados quedan `REVIEW_REQUIRED`.
8. Una respuesta externa posterior actualiza la operación original.

---

## Idempotencia

La deduplicación opera en dos niveles.

### Solicitud

- `refund_id` o `reversal_id`;
- `idempotency_key`;
- tenant y empresa;
- venta u obligación;
- huella canónica del contenido.

### Operación compensatoria

- identificador del componente;
- `payment_idempotency_key`;
- `payment_id` original;
- referencia del proveedor;
- movimiento de caja o crédito vinculado;
- correlación y causación.

Reglas:

1. Repetir la misma solicitud devuelve el resultado original.
2. La misma clave con contenido diferente produce conflicto.
3. Un callback repetido no completa dos veces.
4. Una sincronización repetida no duplica salida de caja ni ajuste de crédito.
5. La deduplicación no depende solo de fecha, cliente e importe.
6. Un reintento técnico no crea otra devolución.
7. Un nuevo intento comercial queda enlazado y no consume dos veces el saldo elegible.

---

## Concurrencia

Escenario principal:

1. Dos actores leen el mismo valor elegible con versión N.
2. Ambos solicitan devolver el mismo saldo.
3. La primera operación reserva o consume el valor y actualiza a N+1.
4. La segunda falla por conflicto de versión y vuelve a calcular.
5. No se crean dos salidas ni dos solicitudes externas.

También deben controlarse:

- aprobación y cancelación simultáneas;
- refund y reversal concurrentes;
- reembolso y conciliación simultáneos;
- respuesta tardía y reintento;
- devolución física y reembolso sin orden garantizado;
- dos cajas intentando devolver el mismo componente;
- sincronización offline contra un reembolso central ya completado.

Las contradicciones generan incidencia; no se resuelven con “última escritura gana”.

---

## Persistencia conceptual

Entidades o registros conceptuales afectados:

- `Payment` original;
- `PaymentGroup`;
- `PaymentAllocation`;
- `Refund`;
- `RefundComponent`;
- `RefundAllocation`;
- `RefundLine`;
- `RefundAttempt`;
- `RefundStatusHistory`;
- `Reversal`;
- `ReversalAttempt`;
- `CashMovement`;
- `CreditTransaction`;
- `TaxEffectSnapshot` o referencia al snapshot tributario original;
- `InventoryReturnReference`;
- `PaymentProviderInteraction`;
- `ReconciliationIncident`;
- `AuditEvent`;
- `OutboxEvent`;
- proyección de estado de reembolso de la venta;
- proyección de estado de reembolso del pago;
- proyección informativa de pedido o domicilio.

Esta lista expresa responsabilidades y relaciones del dominio. No define tablas, columnas, claves físicas, índices, migraciones ni endpoints. El diseño físico está explícitamente aplazado hasta cerrar UC-PAY-005, PAY-007 y las decisiones arquitectónicas relacionadas.

---

## Eventos de dominio

- `RefundRequested`;
- `RefundApprovalRequired`;
- `RefundApproved`;
- `RefundRejected`;
- `RefundProcessingStarted`;
- `RefundCompleted`;
- `RefundPartiallyCompleted`;
- `RefundFailed`;
- `PaymentReversalRequested`;
- `PaymentReversed`;
- `CashRefundRecorded`;
- `CreditBalanceRestored`;
- `InventoryReturnPending`;
- `ReconciliationIncidentCreated`;
- `SaleRefundStatusChanged`;
- `PaymentRefundStatusChanged`;
- `RefundReviewRequired`.

Los eventos críticos se guardan mediante outbox. Los consumidores son idempotentes. Un evento no sustituye la transacción que confirma el efecto local.

---

## Notificaciones

Pueden notificarse:

- cliente;
- cajero;
- supervisor;
- propietario;
- administrador;
- soporte autorizado;
- sistema de pedidos;
- domiciliario, solo con información necesaria.

Ejemplos:

- “Solicitud de reembolso recibida”.
- “Reembolso pendiente de aprobación”.
- “Reembolso en proceso con el medio original”.
- “Reembolso completado”.
- “Reembolso parcialmente completado”.
- “La operación requiere revisión”.

Las notificaciones no son fuente de verdad y no confirman movimientos financieros. No deben exponer referencias completas, cuentas, tokens ni datos innecesarios.

---

## Auditoría

Debe registrar:

- identificador de refund o reversal;
- pago, grupo, venta, pedido u obligación original;
- actor solicitante;
- actor aprobador;
- actor o integración ejecutora;
- roles y permisos evaluados;
- tenant, empresa y sucursal;
- caja y turno;
- dispositivo e IP cuando aplique;
- motivo y evidencia;
- importes solicitado, aprobado, completado, pendiente y fallido;
- saldo elegible antes y después;
- medio original y medio utilizado;
- justificación de cualquier excepción;
- líneas, impuestos y ajustes monetarios;
- estado anterior y nuevo;
- referencias externas protegidas;
- intentos, timeouts y respuestas tardías;
- relación con devolución física;
- marcas e incidencias de conciliación;
- versiones de configuración;
- correlación y causación;
- señales de riesgo;
- resultado.

Reembolsos sospechosos, repetidos, fuera de horario, cercanos al límite o ejecutados desde un dispositivo inusual deben generar alerta según política.

---

## Excepciones

- pago, venta u obligación inexistente;
- acceso a otro tenant;
- sucursal fuera de alcance;
- pago sin valor confirmado;
- estado no reversible;
- importe cero o negativo;
- importe superior al elegible;
- moneda incompatible;
- reembolso duplicado;
- conflicto de idempotencia;
- versión desactualizada;
- actor sin permiso;
- aprobación faltante;
- segregación incumplida;
- caja o turno cerrados;
- efectivo insuficiente;
- límite excedido;
- crédito desactualizado;
- proveedor no disponible;
- timeout;
- respuesta externa no autenticada;
- referencia inconsistente;
- método diferente sin autorización;
- componente mixto inválido;
- snapshot histórico incompleto;
- asignación tributaria inconsistente;
- política de redondeo inexistente;
- devolución física contradictoria;
- pago no conciliado con riesgo;
- liquidación incompatible;
- dispositivo revocado;
- licencia restringida;
- fallo de persistencia;
- fallo de sincronización;
- respuesta tardía contradictoria.

---

## Recuperación ante fallos

### Fallo antes del commit local

No se persisten efectos parciales locales. El saldo elegible permanece disponible salvo una reserva transaccional válida.

### Fallo después del commit local

La misma solicitud recupera la operación existente por idempotencia.

### Fallo después de entregar efectivo

La salida de caja y el reembolso deben haberse confirmado atómicamente. Si existió una contingencia física fuera del sistema, se crea incidencia y arqueo; no se inventa un segundo movimiento.

### Fallo del proveedor

El componente conserva `PROCESSING`, `FAILED` o `REVIEW_REQUIRED` según evidencia y recuperabilidad. No se afecta otro componente silenciosamente.

### Timeout

No equivale a rechazo. Se consulta o reintenta sobre el mismo intento según `UC-PAY-006`.

### Respuesta tardía

Se autentica y asocia a la operación original. Si contradice cancelación, cambio de medio o compensación, se crea incidencia.

### Fallo de notificación

No revierte el resultado financiero. La notificación se reintenta.

### Fallo de sincronización

El evento permanece en outbox y se reintenta sin duplicar efectos.

### Conflicto de conciliación

Se conserva pago, refund, liquidación y evidencia. UC-PAY-005 resolverá la diferencia sin reescribir hechos.

---

## Invariantes

1. `Refund` y `Reversal` son conceptos diferentes.
2. El pago y la venta originales no se eliminan ni se sobrescriben destructivamente.
3. Toda corrección crea una operación compensatoria vinculada.
4. El acumulado completado nunca supera el valor confirmado elegible.
5. Una solicitud repetida no duplica reembolso, caja, crédito ni proveedor.
6. Cada componente de un pago mixto conserva identidad, estado y medio.
7. El medio original es la política predeterminada.
8. Una excepción de medio o componente exige permiso y motivo.
9. El efectivo exige caja y turno abiertos y genera salida de caja.
10. El crédito no genera efectivo si no existe saldo pagado elegible.
11. Una captura o declaración no confirma una devolución externa.
12. Un timeout no equivale a rechazo.
13. El modo offline no inventa confirmaciones externas.
14. El reembolso financiero no incrementa inventario automáticamente.
15. Una devolución física no confirma un reembolso.
16. Los productos no retornables pueden reembolsarse sin volver a stock según política.
17. Los impuestos se derivan de snapshots originales.
18. El redondeo no se devuelve como producto ni se aplica por línea.
19. Las diferencias monetarias y de caja quedan explícitas.
20. Un pago confirmado no conciliado puede reembolsarse, pero conserva incidencia o marca.
21. Las comisiones del proveedor no reducen silenciosamente el reembolso reconocido.
22. Los estados de venta, pago, grupo y refund son derivados, no editables manualmente.
23. Los pagos de otro tenant o sucursal fuera de alcance son inaccesibles.
24. Toda acción crítica registra actor, aprobador, motivo, dispositivo y valores.
25. El historial permite reconstruir solicitud, aprobación, ejecución, fallos y resultado.
26. Un refund parcial mixto usa `PROPORTIONAL_ORIGINAL_CONFIRMED_V1` salvo restricción de proveedor u override autorizado.
27. Solo participan componentes confirmados, reembolsables, con saldo y medio permitido.
28. Los residuos se asignan por mayor importe original y, en empate, por orden estable de `payment_id`.
29. La suma de `RefundComponent` coincide exactamente con el importe aprobado.
30. El snapshot del `Refund` conserva algoritmo, versión, entradas, exclusiones, proporciones, residuos y overrides.

---

## Criterios de aceptación

1. Un pago confirmado puede originar un refund total o parcial dentro de su saldo elegible.
2. El acumulado nunca supera el valor elegible.
3. El pago original permanece trazable e inmutable.
4. Refund y reversal se registran como operaciones diferentes.
5. Un pago mixto crea componentes de reembolso separados.
6. El medio original se utiliza por defecto.
7. Seleccionar otro medio o componente requiere permiso y motivo.
8. El efectivo genera una única salida de caja con turno abierto.
9. El crédito reduce cartera sin crear efectivo ficticio.
10. Un medio externo permanece pendiente hasta confirmación válida.
11. Un timeout no marca la devolución como completada ni rechazada.
12. Un pago no conciliado genera seguimiento de conciliación.
13. El reembolso no modifica inventario automáticamente.
14. Productos dañados o no retornables pueden quedar fuera de stock sin bloquear una devolución autorizada.
15. Los impuestos se obtienen del snapshot original.
16. El redondeo se conserva separado y no se aplica por línea.
17. Repetir la solicitud no duplica efectos.
18. Dos solicitudes concurrentes no consumen el mismo saldo.
19. Offline solo completa efectivo o crédito dentro de la política y sincroniza sin duplicados.
20. La auditoría identifica solicitante, aprobador, ejecutor, motivo, dispositivo, importes y resultado.
21. Un refund parcial mixto se distribuye proporcionalmente según los importes confirmados originalmente asignados.
22. Un componente no reembolsable se excluye antes de calcular proporciones.
23. Un residuo de precisión se asigna al pago elegible de mayor importe original y los empates se resuelven establemente por `payment_id`.
24. Un override manual solo se acepta con permiso, motivo y auditoría.
25. Una restricción de proveedor sobre un componente específico prevalece sobre el prorrateo.
26. La suma de componentes coincide exactamente con el importe aprobado y el snapshot conserva la versión del algoritmo.

---

## Pruebas mínimas

### Generales

- refund total;
- refund parcial;
- segundo refund parcial acumulado;
- intento por encima del elegible;
- pago sin valor confirmado;
- solicitud duplicada;
- misma clave con contenido diferente;
- dos solicitudes concurrentes;
- versión desactualizada;
- venta anulada con devolución autorizada;
- aislamiento entre tenants;
- sucursal fuera de alcance;
- dispositivo revocado;
- licencia restringida;
- rollback transaccional.

### Individual y mixto

- pago individual;
- efectivo más transferencia;
- efectivo más tarjeta;
- transferencia más QR;
- efectivo más crédito;
- tres componentes;
- distribución proporcional 40/60;
- exclusión de componente no reembolsable;
- redistribución por saldo insuficiente de un componente;
- residuo por precisión monetaria;
- empate determinista por `payment_id`;
- override autorizado con motivo y auditoría;
- override sin permiso;
- restricción de proveedor a componente específico;
- suma exacta de `RefundComponent` contra importe aprobado;
- snapshot de `PROPORTIONAL_ORIGINAL_CONFIRMED_V1`;
- selección de componente autorizada;
- selección sin permiso;
- fallo parcial;
- compensación requerida.

### Efectivo y crédito

- caja abierta;
- caja cerrada;
- turno ajeno;
- límite de cajero;
- aprobación de supervisor;
- efectivo insuficiente;
- salida de caja duplicada;
- reducción de cartera;
- crédito con abonos reales;
- crédito offline vigente;
- conflicto de crédito offline.

### Medios externos

- transferencia manual completada con fuente válida;
- QR manual pendiente;
- captura insuficiente;
- reversal permitido;
- reversal rechazado por estado;
- conversión a refund;
- tarjeta con timeout;
- respuesta tardía confirmada;
- respuesta tardía contradictoria;
- callback repetido;
- proveedor no disponible;
- pago liquidado;
- pago no conciliado.

### Comercial, inventario y fiscal

- devolución física antes del refund;
- refund antes de devolución física;
- producto dañado;
- producto consumido;
- perecedero no reincorporable;
- servicio sin inventario;
- garantía pendiente;
- impuesto incluido;
- impuesto adicional;
- refund parcial con descuentos;
- promoción distribuida;
- cambio tributario posterior;
- total COP con fracciones;
- ajuste de efectivo separado;
- pago mixto con redondeo;
- sobrepago;
- comisión no recuperable;
- retención y diferencia de liquidación.

### Offline y recuperación

- refund de efectivo offline;
- crédito offline;
- solicitud externa offline;
- sincronización repetida;
- conflicto con refund central;
- fallo antes del commit;
- fallo después del commit;
- fallo de notificación;
- recuperación de outbox.

---

## Resolución de consistencia

1. `PARTIALLY_REFUNDED`, `FULLY_REFUNDED` y `REVERSED` son proyecciones del pago; no pertenecen a `PaymentStatus`.
2. Un refund posterior a conciliación conserva la conciliación original y crea operaciones posteriores separadas.
3. Después de liquidación se utiliza `Refund`; `Reversal` solo aplica cuando el proveedor confirma semántica técnica reversible.
4. `DEC-006` y `UC-ROUND-001` gobiernan el ajuste comercial original y prohíben recalcular por medio.
5. La matriz de permisos atómicos gobierna solicitud, aprobación, ejecución y override.
6. `PAY-007` separa los estados por agregado y este caso aplica esa separación.

---

## Architectural Review

### Complejidad

Alta.

### Riesgo

Alto.

### Impacto

- Payments;
- Sales;
- Cash Register;
- Inventory;
- Tax;
- Customer Credit;
- Audit;
- Offline Sync;
- Delivery.

### Dependencias

- `UC-PAY-001`;
- `UC-PAY-002`;
- `UC-PAY-003`;
- `UC-PAY-006`;
- `UC-SALES-001`;
- `UC-CASH-001`;
- `UC-CASH-002`;
- `UC-ROUND-001`;
- `UC-TAX-001`.

### Entidades conceptuales afectadas

- `Payment`;
- `PaymentGroup`;
- `PaymentAllocation`;
- `Refund`;
- `RefundComponent`;
- `RefundAllocation`;
- `RefundLine`;
- `RefundAttempt`;
- `Reversal`;
- `ReversalAttempt`;
- `Sale`;
- `SaleItem` y snapshots;
- `CashRegister`;
- `CashShift`;
- `CashMovement`;
- `CreditAccount`;
- `CreditTransaction`;
- referencia de devolución de inventario;
- snapshot tributario;
- interacción con proveedor;
- incidencia de conciliación;
- auditoría;
- outbox;
- proyecciones de venta, pago, pedido y domicilio.

### Eventos principales

- `RefundRequested`;
- `RefundApprovalRequired`;
- `RefundApproved`;
- `RefundProcessingStarted`;
- `RefundCompleted`;
- `RefundPartiallyCompleted`;
- `RefundFailed`;
- `PaymentReversalRequested`;
- `PaymentReversed`;
- `CashRefundRecorded`;
- `CreditBalanceRestored`;
- `InventoryReturnPending`;
- `ReconciliationIncidentCreated`;
- `SaleRefundStatusChanged`.

### Riesgos residuales

1. Doble devolución por concurrencia entre nube, POS offline y proveedor.
2. Diferencia semántica entre refund, reversal, void, contracargo y ajuste de proveedor.
3. Respuesta tardía después de cambiar de medio o compensar.
4. Reembolso en efectivo sin liquidez suficiente o fuera del turno correcto.
5. Distribución incorrecta entre componentes mixtos, líneas, descuentos e impuestos.
6. Divergencia entre devolución física, garantía, inventario y dinero.
7. Reembolso de pago confirmado que luego resulte no conciliable.
8. Fraude interno por repetición, colusión o uso de otra sucursal.
9. Aplicación incorrecta del snapshot fiscal y de redondeo original.
10. Proveedores sin API o sin referencias únicas confiables.

### Integración con UC-PAY-005

1. Payment, Refund, Reversal, Settlement, Reconciliation y Chargeback conservan identidades y estados separados.
2. Una incidencia relaciona las operaciones sin reescribirlas.
3. La autoridad y evidencia dependen del medio y proveedor registrado.
4. Fecha operativa, fecha contable, moneda, importe neto y referencia se conservan por separado.
5. Un periodo cerrado no se reabre destructivamente; una ejecución posterior se enlaza con la anterior.
6. Las salidas offline se concilian después de sincronizar su identidad original.

### Decisiones tomadas

1. La distribución operativa predeterminada de refunds parciales en pagos mixtos es proporcional al importe confirmado y originalmente asignado de cada componente elegible.
2. El algoritmo aprobado es `PROPORTIONAL_ORIGINAL_CONFIRMED_V1` y debe quedar congelado en el snapshot conceptual del `Refund`.
3. Los componentes no reembolsables se excluyen antes del cálculo, las restricciones del proveedor prevalecen y un override manual exige permiso, motivo y auditoría.
4. Los residuos se asignan por mayor importe original, con desempate estable por `payment_id`, y la suma final debe coincidir exactamente con el importe aprobado.

### Decisiones aplicadas de PAY-007

1. Los ejes de Payment, Settlement, Reconciliation, Refund y Reversal están separados.
2. Los acumulados de refund y reversal son proyecciones.
3. Una conciliación cerrada conserva historia ante refunds posteriores.
4. `SETTLED` no habilita una transición destructiva de Payment.
5. `PROPORTIONAL_ORIGINAL_CONFIRMED_V1` queda versionada en el snapshot de Refund.
6. Los estados inciertos pertenecen a Refund/Reversal o a una incidencia, no a Payment.
7. El ajuste de redondeo se distribuye desde el snapshot original conforme DEC-006.
8. Las solicitudes aprobadas o en proceso reservan saldo elegible mediante versión y transacción.

### Decisión sobre diseño físico

El diseño físico puede modelar los agregados separados siempre que preserve estados, idempotencia, reservas de saldo, snapshots, concurrencia y operaciones append-only definidos aquí y en PAY-007.

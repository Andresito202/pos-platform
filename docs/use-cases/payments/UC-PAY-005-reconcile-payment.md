# UC-PAY-005 — Payment Reconciliation

## Estado

DONE

---

# Objetivo

Definir el proceso oficial de liquidación y conciliación de pagos del POS Platform para garantizar que todo dinero recibido por cualquier medio de pago coincida con:

- Caja
- Bancos
- Proveedores de pago
- Facturación electrónica
- Contabilidad
- Auditoría

La conciliación debe ser completamente trazable, auditable e idempotente.

---

# Prioridad

P0

---

# Dependencias

- UC-PAY-001
- UC-PAY-002
- UC-PAY-003
- UC-PAY-004

---

# Actores

## Actores primarios

- Supervisor de caja.
- Administrador financiero.
- Analista de conciliación.
- Contabilidad.
- Auditor autorizado.
- Procesos automáticos de POS Platform.

## Sistemas externos participantes

- Banco.
- Adquirente o procesador de tarjetas.
- Pasarela o proveedor de pagos.
- Proveedor de billetera o QR.
- Sistema contable externo, cuando exista.
- Proveedor fiscal, únicamente como fuente complementaria de referencias documentales.

El proveedor fiscal no constituye evidencia suficiente de recepción, liquidación o abono de un pago.

---

# Objetivo del negocio

Garantizar que ninguna venta confirmada quede sin conciliación y que ningún pago pueda contabilizarse dos veces.

---

# Alcance

Este caso cubre:

- efectivo
- tarjeta débito
- tarjeta crédito
- transferencia
- QR
- pagos mixtos
- devoluciones
- reversos
- pagos offline
- conciliación bancaria
- conciliación con proveedores
- conciliación de caja

No cubre generación de reportes financieros finales.

---

# Disparador

Existe al menos un pago confirmado pendiente de conciliación.

---

# Resultado esperado

Cada elemento incluido en una conciliación queda clasificado conceptualmente como:

- `MATCHED`: coincidencia válida sin diferencia.
- `MATCHED_WITH_TOLERANCE`: coincidencia dentro de una tolerancia autorizada.
- `UNMATCHED_INTERNAL`: existe movimiento interno sin contraparte externa.
- `UNMATCHED_EXTERNAL`: existe movimiento externo sin contraparte interna.
- `DIFFERENCE_DETECTED`: existe diferencia de valor, fecha, referencia, comisión o naturaleza.
- `REVIEW_REQUIRED`: requiere análisis o decisión humana.
- `ADJUSTMENT_REQUIRED`: requiere una operación compensatoria autorizada.
- `EXCLUDED`: fue excluido con una causa válida y auditable.

Estos son estados conceptuales del elemento de conciliación. `PAY-007` debe armonizarlos con la máquina general de estados sin convertirlos automáticamente en estados de `Payment`.

---

# Precondiciones

- Existe un periodo, lote, turno, extracto o conjunto de movimientos autorizado para conciliación.
- Existen movimientos internos o externos candidatos.
- Las fuentes utilizadas están identificadas y versionadas.
- El usuario o proceso automático tiene permiso para iniciar la conciliación.
- El tenant, empresa, sucursal, cuenta, caja y proveedor están correctamente delimitados.
- Las monedas y zonas horarias aplicables están definidas.
- Las operaciones internas ya fueron sincronizadas o están identificadas explícitamente como pendientes de sincronización.
- No existe otra ejecución activa incompatible sobre el mismo alcance, o se dispone de control de concurrencia.

---

# Postcondiciones

- La ejecución de conciliación queda registrada con identificador único.
- Cada movimiento analizado conserva su clasificación y evidencia.
- Las coincidencias quedan vinculadas sin modificar los movimientos originales.
- Las diferencias quedan abiertas como incidencias o ajustes pendientes.
- No se crean pagos, refunds, reversals ni movimientos de caja de forma silenciosa.
- Se registra auditoría completa.
- Se publican los eventos internos correspondientes.
- Una repetición idempotente no duplica coincidencias, incidencias ni ajustes.

---

# Flujo principal — Conciliación automática y cierre controlado

## Escenario principal

1. El actor autorizado selecciona el alcance de conciliación:

   - tenant;
   - empresa;
   - sucursal, cuando aplique;
   - caja, cuenta bancaria o proveedor;
   - medio de pago;
   - periodo o lote;
   - moneda;
   - fuente externa.

2. POS Platform valida:

   - autorización;
   - aislamiento entre tenants;
   - existencia del alcance;
   - compatibilidad de moneda;
   - zona horaria;
   - estado del periodo;
   - ausencia de otra ejecución incompatible;
   - idempotency key de la solicitud.

3. El sistema crea una ejecución de conciliación en estado conceptual `RUNNING`.

4. El sistema congela un snapshot de entrada que contiene:

   - filtros aplicados;
   - versión de reglas;
   - fuente interna;
   - fuente externa;
   - fecha de corte;
   - hashes o identificadores de archivos;
   - usuario o proceso iniciador;
   - tolerancias autorizadas.

5. El sistema obtiene los movimientos internos elegibles:

   - pagos confirmados;
   - componentes de pagos mixtos;
   - movimientos de efectivo;
   - transferencias;
   - pagos QR;
   - pagos con tarjeta;
   - refunds;
   - reversals;
   - liquidaciones previas;
   - contracargos;
   - operaciones offline sincronizadas;
   - ajustes autorizados.

6. El sistema obtiene los movimientos externos elegibles:

   - extractos bancarios;
   - archivos de adquirente;
   - reportes de pasarela;
   - reportes de billetera;
   - lotes de liquidación;
   - comisiones;
   - retenciones;
   - contracargos;
   - devoluciones;
   - referencias del proveedor.

7. El sistema normaliza ambas fuentes sin modificar los datos originales:

   - moneda;
   - signo;
   - precisión;
   - zona horaria;
   - fecha de operación;
   - fecha de abono;
   - referencia;
   - medio de pago;
   - importe bruto;
   - comisión;
   - retención;
   - importe neto.

8. El sistema excluye de forma explícita los movimientos no elegibles:

   - anulados;
   - duplicados confirmados;
   - pertenecientes a otro tenant;
   - fuera del periodo;
   - con moneda incompatible;
   - todavía no confirmados;
   - ya conciliados en un cierre incompatible;
   - sin evidencia mínima exigida.

9. Cada exclusión queda registrada con:

   - movimiento;
   - regla aplicada;
   - motivo;
   - actor o proceso;
   - fecha;
   - evidencia.

10. El motor intenta coincidencias deterministas en este orden:

    1. referencia externa única;
    2. identificador de proveedor;
    3. identificador de lote;
    4. idempotency key o correlation ID;
    5. valor exacto y moneda;
    6. fecha dentro de la ventana permitida;
    7. cuenta o terminal;
    8. medio de pago;
    9. importe bruto, comisión y neto;
    10. reglas complementarias versionadas.

11. Una referencia externa única válida tiene precedencia sobre coincidencias heurísticas.

12. El sistema impide que un mismo movimiento interno o externo sea consumido por dos coincidencias incompatibles.

13. Para cada coincidencia exacta, el sistema crea un elemento conceptual `MATCHED`.

14. Cuando la diferencia está dentro de una tolerancia previamente autorizada, el sistema crea `MATCHED_WITH_TOLERANCE` y registra:

    - diferencia;
    - regla de tolerancia;
    - versión;
    - responsable de aprobación;
    - efecto contable pendiente, cuando aplique.

15. Los movimientos sin contraparte se clasifican como:

    - `UNMATCHED_INTERNAL`; o
    - `UNMATCHED_EXTERNAL`.

16. Los valores, referencias, fechas, comisiones, retenciones o naturalezas incompatibles se clasifican como `DIFFERENCE_DETECTED`.

17. Los casos ambiguos pasan a `REVIEW_REQUIRED`; el sistema no decide arbitrariamente.

18. El sistema calcula el resumen de la ejecución:

    - total interno;
    - total externo;
    - total conciliado;
    - total dentro de tolerancia;
    - diferencias;
    - movimientos sin contraparte;
    - comisiones;
    - retenciones;
    - refunds;
    - reversals;
    - contracargos;
    - importe neto esperado;
    - importe neto observado.

19. El sistema valida que los totales de detalle coincidan exactamente con el resumen.

20. Si la validación interna falla, la ejecución pasa a `FAILED` y no puede cerrarse.

21. Si existen elementos pendientes, la ejecución queda en `REVIEW_REQUIRED` o `PARTIALLY_RECONCILED` conforme al modelo consolidado de `PAY-007`.

22. Si no existen diferencias bloqueantes, el actor autorizado solicita el cierre.

23. POS Platform vuelve a validar:

    - versión esperada;
    - ausencia de cambios concurrentes;
    - resolución de incidencias obligatorias;
    - permisos de cierre;
    - integridad de totales;
    - evidencia mínima;
    - política del periodo.

24. El sistema cierra la ejecución sin alterar retroactivamente los pagos, refunds, reversals, extractos ni movimientos originales.

25. El cierre registra:

    - usuario;
    - fecha;
    - versión;
    - totales;
    - diferencias aceptadas;
    - incidencias pendientes permitidas;
    - hashes de las fuentes;
    - motivo;
    - auditoría.

26. El sistema publica el evento interno `PaymentReconciliationClosed`.

27. Una repetición con la misma idempotency key y el mismo contenido devuelve el resultado existente.

28. Una repetición con la misma idempotency key y contenido diferente se rechaza como conflicto de idempotencia.

---

# Fuentes de conciliación y autoridad

## Fuentes internas

POS Platform puede utilizar como fuentes internas:

- pagos confirmados;
- componentes de pagos mixtos;
- intentos de pago;
- movimientos de caja;
- turnos y cierres;
- refunds;
- reversals;
- ventas;
- anulaciones;
- movimientos offline sincronizados;
- liquidaciones previas;
- ajustes autorizados;
- eventos de auditoría.

Las fuentes internas no pueden modificarse durante la conciliación. La conciliación crea vínculos, clasificaciones e incidencias separadas.

## Fuentes externas

Las fuentes externas pueden incluir:

- extractos bancarios;
- archivos de adquirentes;
- reportes de pasarelas;
- reportes de billeteras;
- reportes de QR;
- archivos de liquidación;
- comprobantes de transferencia;
- reportes de comisiones;
- retenciones;
- contracargos;
- archivos contables;
- respuestas de proveedores.

Cada fuente externa debe conservar:

- proveedor;
- tipo;
- versión;
- fecha de generación;
- fecha de recepción;
- hash;
- nombre original;
- formato;
- zona horaria;
- moneda;
- periodo;
- cuenta o terminal asociada;
- usuario o proceso que la cargó.

## Autoridad por medio de pago

### Efectivo

La fuente primaria es el movimiento de caja registrado en un turno válido.

La evidencia complementaria incluye:

- apertura;
- ventas en efectivo;
- refunds en efectivo;
- retiros;
- ingresos;
- arqueo;
- cierre;
- diferencia declarada.

El arqueo no modifica silenciosamente los movimientos anteriores.

### Tarjetas

La fuente primaria de confirmación es el proveedor, adquirente o procesador.

La fuente primaria de liquidación es el archivo o reporte de liquidación del proveedor.

La fuente primaria de abono es el extracto bancario.

Una autorización de tarjeta no implica liquidación ni abono.

### Transferencias

La evidencia de confirmación puede provenir de:

- referencia bancaria verificable;
- movimiento bancario;
- proveedor autorizado;
- confirmación manual aprobada.

Una captura de pantalla no constituye por sí sola evidencia final suficiente.

### QR y billeteras

La fuente primaria es el proveedor del QR o billetera.

El comprobante mostrado por el cliente es evidencia auxiliar.

El sistema debe distinguir:

- pago iniciado;
- pago pendiente;
- pago confirmado;
- pago liquidado;
- pago abonado;
- pago rechazado;
- pago expirado.

### Refunds

La fuente interna es la operación `Refund`.

La evidencia externa depende del medio:

- salida de caja;
- confirmación del proveedor;
- movimiento bancario;
- archivo de liquidación;
- referencia de devolución.

Un refund aprobado no equivale automáticamente a refund ejecutado.

### Reversals

La fuente primaria es la confirmación técnica del proveedor o del sistema que controla la operación original.

La reversión debe conservar relación con:

- intento original;
- referencia externa;
- estado anterior;
- motivo;
- fecha;
- resultado.

### Contracargos

La fuente primaria es el proveedor, adquirente o banco.

El contracargo no modifica el pago original. Se registra como operación posterior relacionada.

### Proveedor fiscal

El proveedor fiscal aporta evidencia documental de la venta o corrección fiscal.

No constituye prueba suficiente de:

- recepción del dinero;
- liquidación;
- abono;
- conciliación bancaria.

---

# Reglas de matching

## Principio general

Las coincidencias deben ser deterministas, explicables y versionadas.

No se permiten coincidencias irreversibles basadas únicamente en heurísticas débiles.

## Prioridad de coincidencia

El motor evalúa en este orden:

1. referencia externa única;
2. identificador del proveedor;
3. identificador de lote;
4. idempotency key;
5. correlation ID;
6. identificador de terminal;
7. valor exacto;
8. moneda;
9. fecha dentro de ventana permitida;
10. cuenta bancaria;
11. medio de pago;
12. importe bruto;
13. comisión;
14. retención;
15. importe neto;
16. regla complementaria versionada.

## Reglas obligatorias

1. Una referencia externa única válida prevalece sobre coincidencias aproximadas.
2. Un movimiento no puede participar en dos coincidencias incompatibles.
3. Una coincidencia parcial debe registrar el valor consumido y el saldo restante.
4. Las coincidencias uno-a-muchos y muchos-a-uno requieren una regla explícita.
5. Las diferencias de moneda no se concilian automáticamente.
6. Las diferencias de signo se consideran incompatibles salvo regla documentada.
7. La fecha de operación y la fecha de abono no se tratan como equivalentes.
8. Las comisiones y retenciones se separan del importe principal.
9. Los refunds, reversals y contracargos no se compensan silenciosamente contra ventas.
10. Las coincidencias heurísticas ambiguas pasan a `REVIEW_REQUIRED`.

## Coincidencia uno a uno

Aplica cuando un movimiento interno corresponde a un único movimiento externo.

Debe validar:

- referencia;
- moneda;
- valor;
- medio;
- cuenta;
- terminal;
- fecha permitida.

## Coincidencia uno a muchos

Aplica cuando un movimiento interno se liquida en varios movimientos externos.

Ejemplos:

- abono dividido;
- comisión separada;
- retención separada;
- devolución procesada en partes.

La suma debe coincidir exactamente o quedar dentro de tolerancia aprobada.

## Coincidencia muchos a uno

Aplica cuando varios movimientos internos forman un único abono externo.

Ejemplos:

- lote de tarjetas;
- lote de QR;
- cierre diario;
- consolidación por terminal.

El lote debe conservar la lista completa de movimientos incluidos.

## Coincidencia parcial

Una coincidencia parcial:

- no cierra automáticamente el elemento;
- conserva saldo pendiente;
- registra valor aplicado;
- registra valor restante;
- exige política de cierre;
- puede requerir revisión.

---

# Tolerancias

## Regla general

Toda tolerancia debe ser:

- explícita;
- versionada;
- limitada por medio;
- limitada por moneda;
- limitada por empresa;
- aprobada;
- auditable.

## Tipos de tolerancia

- diferencia monetaria;
- diferencia temporal;
- diferencia de comisión;
- diferencia de retención;
- diferencia por redondeo;
- diferencia por fecha de abono;
- diferencia por lote.

## Prohibiciones

No se permite:

- ocultar diferencias;
- ajustar automáticamente sin evidencia;
- usar una tolerancia global para todos los medios;
- aplicar tolerancia a otra moneda;
- cerrar una diferencia material como si fuera exacta.

## Resultado

Cuando una diferencia está dentro de la tolerancia autorizada:

- se clasifica como `MATCHED_WITH_TOLERANCE`;
- se registra la diferencia;
- se conserva la regla aplicada;
- se identifica el responsable;
- se determina si requiere ajuste contable posterior.

---

# Periodos de conciliación

## Definición

Una conciliación puede operar sobre:

- turno de caja;
- día operativo;
- lote de proveedor;
- periodo bancario;
- periodo contable;
- rango personalizado autorizado.

Cada periodo debe conservar:

- tenant;
- empresa;
- sucursal;
- cuenta;
- proveedor;
- medio de pago;
- moneda;
- fecha y hora inicial;
- fecha y hora final;
- zona horaria;
- fecha de corte;
- estado;
- versión.

## Estados conceptuales del periodo

- `OPEN`
- `PROCESSING`
- `REVIEW_REQUIRED`
- `PARTIALLY_RECONCILED`
- `RECONCILED`
- `CLOSED`
- `REOPENED`
- `FAILED`
- `CANCELLED`

Estos estados son conceptuales para UC-PAY-005. `PAY-007` debe armonizarlos con la máquina general sin agregarlos arbitrariamente a `Payment`.

## Reglas

1. Un periodo `CLOSED` no se modifica directamente.
2. Un movimiento recibido después del cierre no reescribe el periodo histórico.
3. La reapertura requiere permiso, motivo, versión esperada y auditoría.
4. Una reapertura crea una nueva revisión o versión del proceso.
5. Los periodos no pueden solaparse cuando representan el mismo alcance exclusivo.
6. Un periodo puede cerrarse con incidencias pendientes solo si una política expresa lo permite.
7. Las incidencias materiales bloquean el cierre.
8. La fecha contable y la fecha de operación deben conservarse separadas.
9. La zona horaria utilizada queda congelada en el snapshot del periodo.

---

# Liquidaciones

## Definición

Una liquidación representa el conjunto de movimientos que un proveedor, banco, caja o sistema externo reconoce dentro de un lote o periodo.

La liquidación no equivale automáticamente a conciliación.

## Tipos conceptuales

- `CASH_SETTLEMENT`
- `CARD_SETTLEMENT`
- `BANK_SETTLEMENT`
- `QR_SETTLEMENT`
- `WALLET_SETTLEMENT`
- `TRANSFER_SETTLEMENT`
- `REFUND_SETTLEMENT`
- `CHARGEBACK_SETTLEMENT`
- `MANUAL_SETTLEMENT`

## Componentes mínimos

Una liquidación debe identificar:

- proveedor o fuente;
- cuenta;
- terminal;
- lote;
- moneda;
- periodo;
- importe bruto;
- comisiones;
- retenciones;
- refunds;
- reversals;
- contracargos;
- ajustes;
- importe neto;
- fecha esperada de abono;
- fecha real de abono;
- referencia externa;
- evidencia.

## Regla de total

El importe neto esperado se calcula conceptualmente como:

```text
importe bruto
- comisiones
- retenciones
- refunds
- contracargos
+ ajustes positivos
- ajustes negativos
= importe neto esperado
```

La fórmula exacta debe quedar versionada y adaptarse al contrato de cada proveedor sin alterar la semántica interna.

## Reglas de liquidación

1. Una liquidación puede contener múltiples pagos.
2. Un pago puede participar en varias liquidaciones únicamente cuando exista liquidación parcial explícita.
3. Un componente no puede liquidarse dos veces por el mismo valor.
4. Las comisiones no reducen silenciosamente el importe confirmado del pago.
5. Las retenciones no cambian el valor original de la venta.
6. Los refunds y contracargos son operaciones relacionadas separadas.
7. Toda liquidación conserva detalle suficiente para reconstruir el neto.
8. Los archivos externos originales permanecen inmutables.
9. Una liquidación corregida crea una nueva versión o ajuste; no reemplaza la anterior sin trazabilidad.

---

# Diferencias e incidencias

## Tipos de diferencia

- importe interno distinto del externo;
- movimiento interno sin externo;
- movimiento externo sin interno;
- referencia incompatible;
- fecha fuera de ventana;
- moneda diferente;
- comisión inesperada;
- retención inesperada;
- refund no reportado;
- reversal no reportado;
- contracargo no registrado;
- lote incompleto;
- duplicado;
- operación offline tardía;
- abono bancario faltante;
- proveedor con estado incierto;
- evidencia insuficiente.

## Severidad

- `INFO`
- `LOW`
- `MEDIUM`
- `HIGH`
- `CRITICAL`

La severidad se determina mediante una política versionada que considere:

- valor;
- antigüedad;
- medio;
- riesgo de fraude;
- impacto contable;
- impacto de caja;
- impacto fiscal;
- recurrencia.

## Estados conceptuales de incidencia

- `OPEN`
- `ASSIGNED`
- `UNDER_REVIEW`
- `WAITING_EXTERNAL_EVIDENCE`
- `ADJUSTMENT_REQUIRED`
- `RESOLVED`
- `ACCEPTED_DIFFERENCE`
- `REJECTED`
- `CLOSED`

## Reglas

1. Toda diferencia conserva evidencia.
2. Resolver una incidencia no modifica movimientos históricos.
3. Una diferencia aceptada exige permiso y motivo.
4. Una diferencia material no puede cerrarse por tolerancia genérica.
5. La persona que crea un ajuste crítico no debe aprobarlo cuando la segregación de funciones aplique.
6. Una incidencia puede vincular pagos, refunds, reversals, liquidaciones y extractos.
7. Las incidencias vencidas generan alertas.
8. La recurrencia puede elevar automáticamente la severidad.

---

# Ajustes

## Principio

La conciliación nunca corrige silenciosamente el pasado.

Cuando se necesita corregir un efecto financiero, debe crearse una operación compensatoria explícita.

## Tipos conceptuales

- ajuste de caja;
- ajuste contable;
- ajuste por comisión;
- ajuste por retención;
- ajuste por diferencia bancaria;
- ajuste por redondeo;
- ajuste por proveedor;
- reclasificación;
- corrección de referencia;
- compensación autorizada.

## Reglas

1. Todo ajuste requiere causa.
2. Todo ajuste requiere relación con la incidencia.
3. El ajuste conserva actor, aprobador, fecha y evidencia.
4. Un ajuste no puede exceder el valor autorizado.
5. Los ajustes financieros críticos requieren segregación de funciones.
6. El ajuste no elimina la diferencia original.
7. La ejecución fallida de un ajuste queda trazada y puede reintentarse idempotentemente.
8. Un ajuste completado participa en conciliaciones posteriores como movimiento separado.

---

# Reapertura de conciliación

## Condiciones

Una conciliación cerrada solo puede reabrirse cuando:

- existe nueva evidencia;
- llegó un movimiento tardío;
- se detectó fraude o duplicidad;
- hubo error de fuente;
- cambió una liquidación externa;
- apareció un contracargo;
- se recibió un refund tardío;
- una auditoría exige revisión.

## Flujo

1. El actor solicita la reapertura.
2. El sistema valida permiso.
3. El actor registra motivo y evidencia.
4. El sistema valida la versión cerrada.
5. Se crea una nueva revisión vinculada a la anterior.
6. La revisión histórica permanece inmutable.
7. Los nuevos movimientos se incorporan a la revisión.
8. Las diferencias se recalculan.
9. El cierre posterior conserva relación con todas las versiones.

## Prohibiciones

No se permite:

- editar directamente una conciliación cerrada;
- borrar evidencias anteriores;
- reemplazar archivos sin conservar hash;
- ocultar el motivo;
- eliminar incidencias cerradas.

---

# Operaciones offline recibidas tardíamente

## Principio

Una operación válida creada offline puede llegar después del cierre del periodo al que pertenece.

El sistema no debe:

- descartarla;
- cambiar su fecha original;
- insertarla silenciosamente en un periodo cerrado;
- duplicarla;
- alterar un cierre histórico sin revisión.

## Tratamiento

1. Se conserva:

   - fecha del dispositivo;
   - fecha de recepción;
   - dispositivo;
   - usuario;
   - idempotency key;
   - versión local;
   - evidencia de sincronización.

2. El sistema valida autenticidad e idempotencia.

3. Si pertenece a un periodo abierto, se incorpora normalmente.

4. Si pertenece a un periodo cerrado:

   - se registra como movimiento tardío;
   - se crea incidencia;
   - se vincula al periodo histórico;
   - se decide reapertura, ajuste o conciliación posterior;
   - se conserva la fecha contable aplicada.

5. Si afecta efectivo, se verifica el turno y la caja.

6. Si afecta proveedor externo, se consulta su estado real.

7. Si la operación contradice un cierre anterior, pasa a `REVIEW_REQUIRED`.

---

# Concurrencia e idempotencia

## Claves de idempotencia

Deben existir claves separadas para:

- iniciar conciliación;
- cargar fuente externa;
- ejecutar matching;
- cerrar periodo;
- reabrir conciliación;
- crear incidencia;
- crear ajuste;
- ejecutar ajuste;
- registrar liquidación.

## Reglas

1. La misma clave y mismo contenido devuelve el resultado existente.
2. La misma clave con contenido diferente se rechaza.
3. Dos cierres concurrentes sobre la misma versión no pueden completarse.
4. Un movimiento no puede reservarse simultáneamente en conciliaciones incompatibles.
5. Las operaciones usan versión esperada.
6. Los locks no sustituyen la idempotencia.
7. Un timeout no implica que la operación haya fallado.
8. Antes de reintentar se consulta el estado conocido.
9. Los workers pueden reanudarse después de una caída sin duplicar efectos.

---

# Auditoría obligatoria

Debe registrarse:

- inicio;
- actor;
- alcance;
- fuentes;
- hashes;
- reglas;
- versiones;
- exclusiones;
- coincidencias;
- tolerancias;
- diferencias;
- incidencias;
- aprobaciones;
- ajustes;
- cierres;
- reaperturas;
- errores;
- reintentos;
- operaciones offline tardías;
- cambios de severidad;
- cambios de responsable.

La auditoría no almacena secretos ni datos de tarjeta sensibles.

---

# Permisos

La conciliación es una operación privilegiada.

## Roles autorizados

- Administrador de empresa.
- Supervisor financiero.
- Auditor.
- Servicio interno de conciliación.
- Integración autorizada.

## Restricciones

No pueden:

- vendedores;
- cajeros;
- usuarios invitados;
- dispositivos offline;
- APIs sin alcance de conciliación.

Toda autorización debe evaluarse considerando:

- empresa;
- sucursal;
- periodo;
- medio de pago;
- proveedor;
- estado de la conciliación.

---

# Eventos de dominio

Durante el proceso pueden emitirse los siguientes eventos conceptuales:

- `PaymentReconciliationStarted`
- `PaymentMatched`
- `PaymentMismatchDetected`
- `PaymentToleranceApplied`
- `PaymentIncidentCreated`
- `PaymentAdjustmentCreated`
- `PaymentReconciliationClosed`
- `PaymentReconciliationReopened`

Los eventos son inmutables y forman parte de la auditoría.

---

# Errores funcionales

El sistema debe distinguir, como mínimo:

- conciliación inexistente;
- periodo inexistente;
- periodo cerrado;
- proveedor inexistente;
- extracto inválido;
- archivo corrupto;
- moneda incompatible;
- referencia duplicada;
- referencia inexistente;
- movimiento duplicado;
- conflicto de concurrencia;
- conflicto de idempotencia;
- permisos insuficientes;
- evidencia obligatoria ausente;
- diferencia superior a la tolerancia;
- cierre no permitido;
- versión desactualizada;
- operación cancelada.

Ningún error debe producir modificaciones parciales no trazables.

---

# Invariantes

Durante toda la vida de la conciliación siempre debe cumplirse que:

1. Los pagos originales nunca cambian su importe histórico.
2. Las devoluciones permanecen independientes del pago original.
3. Las liquidaciones nunca destruyen evidencia.
4. Todo ajuste conserva trazabilidad.
5. Toda conciliación pertenece a una empresa.
6. Todo cierre conserva su versión.
7. Ninguna operación rompe la idempotencia.
8. Todo evento conserva orden temporal.
9. Todo cambio queda auditado.
10. Ningún proceso elimina información financiera histórica.

---

# Criterios de aceptación

El caso de uso se considera terminado únicamente cuando:

- existe conciliación automática;
- existe conciliación manual asistida;
- existen incidencias;
- existen tolerancias;
- existen ajustes;
- existen reaperturas;
- existe soporte para operaciones offline;
- existe control de concurrencia;
- existe idempotencia;
- existe auditoría completa;
- existen eventos internos;
- existen permisos;
- la documentación está aprobada.

---

# Pruebas mínimas

Debe existir evidencia para:

- conciliación exacta;
- conciliación con diferencia;
- conciliación con tolerancia;
- conciliación con refund;
- conciliación con reversal;
- conciliación con contracargo;
- conciliación parcial;
- conciliación con operación offline;
- reapertura;
- cierre exitoso;
- doble cierre concurrente;
- repetición idempotente;
- error de permisos;
- error por versión;
- archivo inválido;
- proveedor externo inconsistente.

---

# Relación con PAY-007

Este caso define el proceso de conciliación.

No define todavía la máquina de estados definitiva.

La consolidación de estados corresponde exclusivamente a `PAY-007`.

Ninguna implementación debe introducir estados adicionales sin actualizar `PAY-007`.

---

# Restricciones arquitectónicas

Este documento define comportamiento.

No autoriza todavía:

- crear tablas definitivas;
- crear migraciones finales;
- diseñar índices físicos;
- optimizar almacenamiento;
- decidir particionamiento;
- fijar contratos SQL;
- cerrar el modelo físico.

Todo diseño físico deberá respetar las decisiones documentadas aquí.

---

# Estado del documento

Estado: `DONE`

El documento permanece `DONE` mientras:

- exista revisión arquitectónica;
- exista revisión funcional;
- exista validación de consistencia;
- se mantengan alineadas las decisiones aprobadas;
- se complete la evidencia requerida;
- el backlog marque `UC-PAY-005` como `DONE`;
- `PAY-007` permanezca `DONE`.

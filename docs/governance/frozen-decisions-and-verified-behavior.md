# Decisiones y comportamientos verificados — NO REABRIR SIN EVIDENCIA

## Propósito

Este registro existe para impedir que una capacidad ya ejecutada y verificada vuelva a modificarse por una sugerencia pequeña de un agente y provoque regresiones en otra parte del sistema.

**Regla:** un agente no puede cambiar una entrada `FROZEN_VERIFIED` por preferencia, refactor, limpieza, simplificación o supuesto diseño mejor.

Para reabrirla debe existir evidencia nueva y reproducible, y debe registrarse antes del cambio.

> `FROZEN_VERIFIED` no significa que el software sea inmune a futuros defectos. Significa que el comportamiento fue ejecutado y verificado y queda protegido contra cambios arbitrarios. Un defecto real puede reabrirlo, pero la reapertura debe quedar documentada.

## Evidencia y alcance

La evidencia de ejecución indicada en este documento se identifica siempre por SHA. Una prueba histórica no se convierte en un PASS del HEAD actual si el HEAD cambió.

Estado actual de la línea de implementación al crear este registro:

- línea histórica: identificada por HEAD auditado; no designa la rama activa actual
- último HEAD funcional auditado antes de esta documentación: `bf39de720904f0b4aecf3541515c5b84cdb67f44`
- verificación funcional amplia disponible inmediatamente antes de `bf39de7`: `d91dddcdc979a1afe1b2cfdcabb568cafd52c81b`

El cambio `bf39de7` fue una corrección quirúrgica del binding de `branchId` en el CAS de inventario. Su ejecución completa posterior debe registrarse antes de declarar ese punto `FROZEN_VERIFIED`.

## Decisiones congeladas

### FZ-001 — Local Service es el único writer SQLite

**Estado:** `FROZEN_VERIFIED`

El Desktop/Renderer no debe escribir directamente SQLite. La autoridad de escritura permanece en POS Local Service.

No cambiar esta frontera para resolver un problema puntual de UI, rendimiento o conveniencia.

**Reapertura requiere:** evidencia reproducible de que el contrato vigente es incorrecto o una nueva decisión arquitectónica ratificada.

### FZ-002 — Cash Shift se selecciona por `cash_register_id`

**Estado:** `FROZEN_VERIFIED`

El renderer no selecciona directamente `cash_shift_id`. La capa confiable resuelve el turno correspondiente a `tenant + branch + cash_register`.

`origin_device_id` es provenance/idempotencia/auditoría y **no** es selector de ownership del turno.

No introducir un selector alternativo para corregir un caso individual.

### FZ-003 — Unicidad de Cash Shift OPEN/CLOSING

**Estado:** `FROZEN_VERIFIED`

La regla es como máximo un CashShift `OPEN`/`CLOSING` por `tenant + branch + cash_register`, independientemente de `origin_device_id`.

No modificar la semántica para hacer pasar un test aislado.

### FZ-004 — UUIDv7 para `sync_operations.operation_id`

**Estado:** `FROZEN_VERIFIED`

El identificador de operación persistido en Sync debe respetar el contrato UUIDv7.

No reemplazar UUIDv7 por UUID aleatorio por conveniencia ni hacer un reemplazo global indiscriminado: primero distinguir IDs de transporte/correlación de IDs de operación de Sync.

### FZ-005 — Payment no escribe directamente tablas internas de Cash

**Estado:** `FROZEN_VERIFIED`

Payment utiliza el puerto/contrato de caja y conserva la frontera transaccional definida. No se permite resolver un problema de Payment escribiendo directamente las tablas internas de Cash.

### FZ-006 — `cash_register_id` es el input confiable de Sale/Cash

**Estado:** `FROZEN_VERIFIED`

No volver a introducir `cash_shift_id` como selector enviado desde Renderer para sustituir la resolución confiable del turno.

### FZ-007 — Identificador histórico de Sale es snapshot

**Estado:** `VERIFIED_AT_SHA — NO REIMPLEMENTAR`

La implementación de `identifier_snapshot` se realiza en la creación de Sale para preservar el identificador histórico y evitar reconstruirlo posteriormente consultando Catalog.

Evidencia de integración registrada en el trabajo de Payment/Sale del 2026-09-16. Debe permanecer hasta que una prueba o contrato demuestre un defecto real.

### FZ-008 — Checksum de Outbox se deriva del payload canónico en el writer

**Estado:** `VERIFIED_AT_SHA — NO REIMPLEMENTAR`

La frontera `DurableSyncStore.enqueue()` es la autoridad para normalizar `payload_checksum` a partir del payload canónico.

No crear productores alternativos que calculen otro significado para el mismo campo.

### FZ-009 — Renderer no es autoridad financiera

**Estado:** `FROZEN_VERIFIED`

El renderer puede recoger `tendered_amount`, pero la autoridad sobre suficiencia, vuelto y finalización permanece en backend/Local Service.

No mover reglas financieras a la UI para corregir presentación o tests.

## Verificaciones de comportamiento registradas

Estas son verificaciones reales, pero se conservan con su SHA para no confundir evidencia histórica con el estado actual.

### V-001 — Cash domain

**SHA:** `d91dddcdc979a1afe1b2cfdcabb568cafd52c81b`

**Resultado:** `20/20` pruebas de Cash pasaron.

**Regla:** no reescribir la semántica de Cash para resolver fallos externos sin reproducir primero el fallo dentro de Cash.

### V-002 — Sale domain

**SHA:** `d91dddcdc979a1afe1b2cfdcabb568cafd52c81b`

**Resultado:** `45/45` pruebas de Sale pasaron.

**Regla:** no alterar Sale por un fallo de Payment/Channel sin localizar primero la frontera exacta del fallo.

### V-003 — Session assertion store/verifier

**SHA:** `d91dddcdc979a1afe1b2cfdcabb568cafd52c81b`

**Resultado:** assertion store `48/48`; verifier `51/51`.

**Regla:** no modificar Session/verification por un timeout de otro subsistema sin evidencia que apunte a Session.

### V-004 — Authorization snapshot

**SHA:** `d91dddcdc979a1afe1b2cfdcabb568cafd52c81b`

**Resultado:** authorization snapshot `31/31`; authorization snapshot store `21/21`.

### V-005 — Commercial channel transport

**SHA:** `d91dddcdc979a1afe1b2cfdcabb568cafd52c81b`

**Resultado:** channel commercial transport `7/7`; channel tests `13/13`; channel routing `2/2`.

**Regla:** no rediseñar el transporte por un fallo de una operación concreta sin identificar primero si el defecto está en routing, handler, store o test harness.

### V-006 — Fiscal issuance

**SHA:** `d91dddcdc979a1afe1b2cfdcabb568cafd52c81b`

**Resultado:** `32/32`.

No modificar la frontera fiscal para solucionar Payment, Cash o Inventory.

## Estado de regresiones conocidas

En `d91dddcdc979a1afe1b2cfdcabb568cafd52c81b` hubo 6 archivos de test fallidos. Por tanto, el sistema **no estaba en PASS global** en ese punto.

Los grupos fallidos registrados fueron:

- Inventory;
- Sale cash-register binding;
- Master snapshot;
- Payment;
- Commercial IPC;
- Channel commercial vertical.

El error de Inventory fue localizado con precisión: el CAS usaba `companyId` donde el SQL requería `branchId`. La corrección se publicó como:

`bf39de720904f0b4aecf3541515c5b84cdb67f44`

`fix(inventory): bind branch id in stock CAS update`

**Importante:** esta corrección no debe considerarse `FROZEN_VERIFIED` hasta que se ejecute nuevamente la cobertura afectada y se registre el resultado.

Los fallos UUIDv7 de Payment tampoco autorizan un reemplazo global de `randomUUID()` por `uuidV7()`. Debe distinguirse el `operation_id` persistido en Sync de IDs de transporte/correlación.

Los timeouts de canal no autorizan aumentar arbitrariamente el timeout. Primero debe aislarse la causa.

## Protocolo obligatorio para reabrir una entrada congelada

Antes de modificar una entrada `FROZEN_VERIFIED`:

1. citar esta entrada por ID;
2. describir el defecto reproducible;
3. indicar SHA donde se observa;
4. indicar prueba que falla;
5. demostrar que el fallo pertenece realmente a la entrada;
6. identificar impacto sobre otras capacidades congeladas;
7. proponer el cambio mínimo;
8. ejecutar pruebas de regresión de la entrada y de sus dependencias;
9. actualizar esta entrada con la nueva evidencia;
10. sólo entonces implementar.

## Regla para cualquier agente

La identidad del agente no cambia la autoridad técnica.

Ningún agente puede decir simplemente:

> "Esto debería cambiarse."

Debe aportar:

`evidencia -> defecto -> impacto -> cambio mínimo -> prueba`

Si no existe esa cadena, **no se toca una capacidad congelada**.

## Regla de cierre de futuras tareas

Cuando un objetivo termine, el commit/PR de cierre debe registrar:

- objetivo;
- archivos/capacidades afectadas;
- pruebas ejecutadas;
- resultado exacto;
- SHA verificado;
- qué queda deliberadamente sin tocar;
- ID de decisión o comportamiento que queda congelado.

Así, el siguiente agente no vuelve a empezar el análisis desde cero ni reabre una solución estable por una observación aislada.

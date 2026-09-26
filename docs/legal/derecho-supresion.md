# Derecho a borrar los datos — procedimiento — Camacho POS Colombia

> **BORRADOR — DOCUMENTED únicamente. No publicar sin revisión de abogado colombiano y sin completar los campos [PENDIENTE].**
> Este texto no es asesoría legal. Redactado el 2026-09-26.

## 1. Qué se puede pedir

Cualquier Titular puede pedir que se supriman sus datos personales o revocar la autorización que
dio (Ley 1581 de 2012, art. 8 lit. e; Decreto 1377 de 2013, art. 9, compilado en el Decreto 1074
de 2015, art. 2.2.2.25.2.6). La solicitud se tramita como **reclamo**, con los plazos de
`politica-tratamiento-datos.md` §7: respuesta en máximo **quince (15) días hábiles**, prorrogables
**ocho (8)** más informando el motivo.

## 2. Límite: lo que la ley obliga a conservar

La supresión **no procede cuando el Titular tiene un deber legal o contractual de permanecer en la
base de datos** (Decreto 1377 de 2013, art. 9, inciso 2). En este
producto eso cubre, como mínimo:

| Dato | Por qué se conserva | Fuente |
|---|---|---|
| Facturas electrónicas emitidas y sus adquirientes | Soporte tributario del Comercio | Ley 962 de 2005, art. 46, modificado por la Ley 1819 de 2016, art. 304 |
| Libros y registros contables y de caja del Comercio | Conservación de libros y papeles | Ley 962 de 2005, art. 28 |
| Registros de auditoría y eventos de seguridad | Trazabilidad e investigación de incidentes; son append-only por diseño | `001_central_foundation.up.sql:598-607`; `local-database.ts:184`, `:303` |
| Saldo pendiente de una cuenta de crédito | Relación contractual vigente entre el cliente y el Comercio | [PENDIENTE — validación legal] |

Cuando algo no se puede borrar por estas razones, **se le dice al solicitante qué se conserva, por
qué y hasta cuándo**. [PENDIENTE — plazos concretos validados por contador/abogado].

## 3. Qué pasa con lo que sí se puede borrar

Lo que no tiene deber de conservación se **elimina** o se **anonimiza**. Anonimizar es
imprescindible en este producto: los hechos financieros, de inventario y de auditoría son
append-only (principios no negociables de `CLAUDE.md`), así que borrar la fila de una persona rompería
la historia contable. Lo correcto es sustituir sus datos personales por un marcador que ya no la
identifique, conservando la operación.

El modelo de datos ya lo prevé: el `User` «se desactiva; la privacidad o anonimización es un proceso
separado y auditado» (`docs/architecture/conceptual-data-model.md:2775`).

> **Advertencia: el mecanismo técnico no existe todavía.** No hay función para anonimizar a una
> persona, ni en el servicio central ni en el POS local. Hasta que exista, cada solicitud se atiende
> de forma **manual, documentada y revisada**, y no se promete un plazo técnico. El diseño queda
> pendiente de una decisión de arquitectura (`DEC-027`, por redactar).

## 4. Quién responde

| Quién pide | Sobre qué datos | Quién decide | Qué hace la Plataforma |
|---|---|---|---|
| Un usuario del software (dueño, administrador, cajero) | Su cuenta, su acceso, su historial de seguridad | **La Plataforma**, como Responsable | Tramita el reclamo completo |
| Un cliente final de un Comercio | Sus datos como comprador o adquiriente | **El Comercio**, como Responsable | Si le llega la solicitud, la **traslada al Comercio en máximo dos (2) días hábiles** e informa al solicitante (Ley 1581 de 2012, art. 15 num. 1). Después asiste al Comercio como Encargado, ejecutando la supresión o anonimización que el Comercio ordene |

## 5. Pasos

1. **Recibir** la solicitud por el canal de la política: [PENDIENTE — correo de contacto de
   protección de datos].
2. **Verificar la identidad** del solicitante antes de tocar nada (Decreto 1377 de 2013, art. 20).
   Suprimir los datos de otra persona por error es también un incidente.
3. **Clasificar** según §4: si el dato es de un Comercio, trasladar.
4. **Marcar** el registro como «reclamo en trámite» en máximo dos (2) días hábiles (Ley 1581 de
   2012, art. 15). [PENDIENTE — el software no tiene aún esa marca].
5. **Separar** lo que se conserva por ley (§2) de lo que se borra o anonimiza (§3).
6. **Ejecutar** y dejar constancia auditada de qué se hizo, quién lo hizo y cuándo.
7. **Responder** al solicitante diciendo qué se suprimió, qué se conservó y por qué.

## 6. Preguntas que debe resolver `DEC-027`

Esta lista no es el diseño; es lo que el diseño técnico tendrá que decidir:

1. Qué campos de cada tabla son datos personales y cuáles se anonimizan, con qué marcador.
2. Cómo se anonimiza una fila de una tabla append-only sin violar su inmutabilidad (por ejemplo,
   un registro aparte de anonimización que las lecturas aplican, o cifrar el dato personal con una
   clave por Titular y destruirla).
3. Cómo llega la orden desde el servicio central a cada POS local que tenga copia del dato, incluido
   un POS que esté sin conexión.
4. Qué pasa con las copias de seguridad que ya contienen el dato.
5. Qué pasa con los datos que ya se enviaron a terceros (Factus, Wompi) y cómo se les traslada la
   solicitud cuando proceda.
6. Cómo queda auditada la supresión sin que la propia auditoría vuelva a guardar el dato suprimido.

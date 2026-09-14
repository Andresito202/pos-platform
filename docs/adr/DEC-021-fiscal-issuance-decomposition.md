# DEC-021 — Descomposición del bloque de emisión fiscal, y por qué no se empieza a medias

- **Estado:** aceptada (decisión de planificación; **no** implementa emisión)
- **Fecha:** 2026-09-14
- **Relacionada con:** `DEC-020` (identidad y custodia en el arranque), `SEC-004`,
  `D-9`, `D-2`

---

## 1. Qué dice hoy el tablero, y qué significa

> `C1`..`C11` · `TESTED` · «170 pruebas; **ningún consumidor**»
> «FACTUS es una isla. Verificado sobre `apps/pos-local-service/src`: **cero**
> llamadas a `DocumentIssuancePort`, a `issueDocument` y a `NumberingRangePort`.»

El adapter está terminado y verificado —`C7` y `C8` con sandbox real el
2026-09-06— y el POS no le habla. La conclusión escrita en el tablero es
correcta y conviene repetirla: **el bloqueo es nuestro, no de FACTUS.**

De ahí se sigue una tentación: «sólo falta la llamada». Este ADR existe para
dejar por escrito que eso es falso, con la lista de lo que falta de verdad.

## 2. Lo que falta, verificado sobre el árbol

### 2.1 No hay dónde guardar un documento electrónico

Las 36 tablas de `local-database.ts` son, íntegras: caja (3), catálogo (4+1
fiscal), clientes (1), inventario (2), pagos (4), ventas (3), sincronización
(4), seguridad (6), operaciones (3), sandbox huérfano (3), snapshots (3).

**Ninguna es un documento electrónico.** No hay identidad interna previa al
primer envío, no hay `idempotency_key`, no hay contador de intentos, no hay
estado. `C14` —el esquema fiscal de diez tablas— es **central y PostgreSQL**, y
está `IMPLEMENTED` sin prueba y sin consumidor; no sirve al equipo local.

Emitir sin esa tabla es inaceptable por una razón concreta: el desenlace
**incierto**. Si la petición sale y la respuesta se pierde, el documento puede
estar emitido en la DIAN. Reintentar sin identidad persistida emite una segunda
factura con otro consecutivo. Ese es el peor fallo posible de una integración
fiscal, y sólo se evita con estado en disco **anterior** al primer envío.

### 2.2 El `numbering_range_id` sólo existe en línea

Verificado en `factus/adapter.ts`: el identificador que exige emitir vive en
`/v2/numbering-ranges` —el recurso del proveedor, paginado—, **no** en
`/v2/numbering-ranges/dian`. El propio adapter documenta la confusión y la
corrige.

Consecuencia: **el payload canónico no se puede ensamblar sin una consulta
autenticada previa, o sin haber persistido el rango.** No hay tabla de rangos.

### 2.3 No hay ruta de aprovisionamiento de la credencial

`DEC-020` acaba de dejar vivo el almacén de `SEC-004`
—`EncryptedFileSecretStore` sobre DPAPI—, que es exactamente donde la
credencial de FACTUS debe vivir. Pero no existe:

- un `FactusCredentialResolver` de producción que lea de ese almacén;
- ni una operación por la que un operador **deposite** la credencial ahí.

Sin la segunda, la primera es una isla más. Y depositarla por variable de
entorno está expresamente descartado: el valor no debe existir fuera del
almacén.

### 2.4 Falta el emisor, pero menos de lo que parecía

Verificado: FACTUS deriva el emisor de la **cuenta autenticada**; el NIT del
emisor no viaja en el cuerpo. Eso retira del camino crítico el hueco de
`DEC-013 §7` —sólo `'CASH_REGISTER'` está implementado, de modo que el equipo no
conoce la identidad fiscal de la empresa—. Sigue faltando para el recibo y para
central; **no** bloquea la emisión.

## 3. La decisión

**No se empieza la emisión fiscal en este bloque.** Media emisión es peor que
ninguna: deja un documento transmitido sin estado que lo gobierne, que es
precisamente el fallo del §2.1.

Se fija en cambio la descomposición, en este orden, cada pieza con su evidencia:

| # | Pieza | Qué la cierra |
|---|---|---|
| F1 | `MIGRATION_016`: documento electrónico —identidad interna, `idempotency_key`, payload congelado con checksum, estado, intentos— y rango de numeración persistido | migraciones verdes y el estado observable en SQLite |
| F2 | Depósito de la credencial en el almacén de `SEC-004` y `FactusCredentialResolver` de producción | el valor nunca sale del adapter; el núcleo sólo ve `secretRef` |
| F3 | Ensamblado del payload canónico desde la venta cobrada, el adquiriente y el atributo fiscal del catálogo | prueba que compara contra un payload de referencia, campo a campo |
| F4 | Caso de uso de emisión con el protocolo del desenlace incierto | un envío que pierde la respuesta **no** emite una segunda factura |
| F5 | Cruce del canal y pantalla | `CALLER_REACHABLE` y luego `END_TO_END` |
| F6 | Ejecución contra el sandbox real | **sólo en el equipo del propietario**: la credencial no está aquí y no debe estarlo |

F1..F5 son ejecutables desde aquí. **F6 no**, y ninguna de las cinco anteriores
puede declararse `SANDBOX_VERIFIED` sin ella.

## 4. Por qué este orden y no otro

F2 antes que F3 porque ensamblar un payload que nadie puede transmitir no
prueba nada que la prueba unitaria no pruebe ya. F1 antes que todo porque es la
única pieza cuya ausencia produce un daño **irreversible** —una factura
duplicada ante la DIAN no se deshace—. F5 al final porque una pantalla sobre un
motor incompleto es la clase de media capacidad que el tablero lleva
corrigiendo desde que se retiró `CANONICALLY_APPLIED`.

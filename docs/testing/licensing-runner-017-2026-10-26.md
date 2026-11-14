# Licensing 017 registrado

Desde c0657d003e924cfcb00bf3494b6858b1410d775a, por solicitud expresa del propietario.
017_license_offer_pricing integra el delta ensayado en la tabla licensing.plans.
La propuesta histórica se conserva; el runner sólo usa el artefacto definitivo.

Mismo runner, advisory lock y ledger. Selector --licensing incluye 017 después de
016 y exige además checksum APPLIED auténtico de 006 antes de cualquier DDL.
El selector por defecto y el manifiesto de autenticación permanecen 008–016.
No se reescriben checksums cerrados ni se inventan filas del ledger productivo.

Comandos: postgres:commercial:apply --licensing --manifest para inspección;
postgres:commercial:apply --licensing para el operador con URL/DB/SHA y timeouts
explícitos. No se ejecutó contra una base persistente.

Pruebas observadas: runner-017-final.json, dos casos físicos PASS; aplicación
concurrente/idempotencia, preservación legacy con columnas nuevas NULL, manifiesto
anterior intacto, dependencia 006 ausente sin DDL y fallo 017 con rollback/FAILED.
offers-registered-017.json: un escenario integrado PASS usando ya el CLI canónico
con 017, publicación/precios/versiones, autorización, auditoría y down bloqueado
por historial. TypeScript del runner PASS. Error inicial sólo del test: comparación
de bigint pg como string frente a row_to_json como number; se comparan ambos
snapshots PostgreSQL de la misma forma, sin alterar precios ni tipos productivos.

El propietario confirmó que todavía no existe política fiscal/soporte aprobada
para cobros de planes. No se inventan tasas, inclusión de impuestos ni duración
de soporte perpetuo. Esto no bloquea el registro SQL ni las verificaciones de
capacidad, pero impide emitir una cotización pagable como definitiva.

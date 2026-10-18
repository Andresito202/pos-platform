# Auditoría de continuidad offline/online del POS — 2026-10-09

## Resultado ejecutivo

**NO APTO para prometer venta comercial real sin internet ni sincronización automática completa al reconectar.** La arquitectura contiene piezas local-first, pero faltan dependencias de identidad, datos maestros y autenticación central. No se considera probado por inspección estática.

## Evidencia del estado actual

| Capacidad | Evidencia en la rama auditada | Estado |
|---|---|---|
| Persistencia local durable | `packages/database-sqlite` usa SQLite/WAL y control single-writer; el backlog registra pruebas históricas de recuperación de DB. | Materializada; la evidencia histórica no certifica el HEAD actual. |
| Outbox durable e idempotente | `apps/pos-local-service/src/sync/durable-sync-store.ts`: enqueue idempotente, claim/ack, retry/backoff y recuperación de `IN_FLIGHT`. | Implementada; sin ejecución de pruebas en esta pasada. |
| Venta local + outbox atómicos | `apps/pos-local-service/src/sales/sqlite-sale-store.ts` documenta y ejecuta una transacción para agregado, auditoría local y outbox. | Implementación presente; no implica que el handler comercial pueda autorizar la venta. |
| Autenticación del operador offline | `commercial-component.ts` inyecta el trust map; si no se aprovisionan claves confiables, `session.activate` falla cerrado. `commercial-request-handler.ts` requiere una sesión vinculada y snapshot de autorización activo. | Bloqueante sin aprovisionamiento real y sesión/snapshot vigentes. |
| Vigencia de sesión offline | `session-binding-registry.ts` comprueba `offline_valid_until` en cada solicitud y elimina el vínculo vencido. | No es operación offline perpetua: al vencer la SSA, la sesión deja de autorizar operaciones. |
| Datos maestros necesarios | `sqlite-master-snapshot-store.ts` proyecta `CashRegister`; DEC-012 mantiene condiciones de habilitación de Cash y aprovisionamiento confiable. Catálogo, precios, impuestos y otros snapshots requieren sus propios contratos/versiones vigentes. | No se debe asumir que todas las cajas/productos/precios necesarios están sembrados localmente. |
| Transporte automático de salida | `main.ts` construye `CentralSyncComponent`, pero usa `UnprovisionedDeviceCredentialProvider`. Ese provider siempre rechaza. `central-sync-component.ts` registra `NO_DEVICE_CREDENTIAL` y no inicia temporizador. | **Bloqueante confirmado:** el runtime actual no puede sincronizar automáticamente al reconectar con la configuración de credencial por defecto. |
| Autoridad central de sincronización | `FetchCentralTransport` existe; DEC-023 indica que el transporte real a autoridad no equivale a una autoridad central desplegada y autenticada. | Falta entorno real con endpoint, credencial de dispositivo y receptor idempotente operativo. |
| Descarga de cambios centrales al POS | Los contratos de outbox y el dispatcher cubren principalmente subida de operaciones; no se acredita aquí un ciclo completo de descarga/aplicación de catálogo, precios, impuestos, cajas, políticas y revocaciones. | Pendiente de demostrar y cerrar por separado. |
| Pruebas de desconexión/reconexión sobre HEAD actual | Existen tests unitarios con dobles deterministas en `central-sync-component.test.ts`; no se ejecutaron en esta sesión. | Sin PASS actual; falta E2E con servicio y autoridad reales. |

## Qué debe significar “seguir vendiendo sin internet”

El POS debe poder aceptar operaciones locales **solo mientras** se cumplan las condiciones de seguridad y negocio preaprovisionadas: usuario autenticado, SSA vigente hasta `offline_valid_until`, snapshot de autorización válido, datos maestros necesarios disponibles, caja/turno local válido, reglas de precios/impuestos vigentes y almacenamiento local sano.

No debe prometerse operación offline ilimitada: la expiración de sesión/autorización, revocación, cambios de precio/impuestos, agotamiento de disco, falta de caja/turno y operaciones fiscales que requieran autoridad externa pueden bloquear o limitar acciones. Los límites deben comunicarse al operador; nunca se deben saltar para aparentar disponibilidad.

## Secuencia de cierre obligatoria

1. **Aprovisionamiento seguro de dispositivo**: cerrar DEC-008 y materializar alta/credencial con almacenamiento protegido del sistema; eliminar el provider no provisionado solo cuando exista un flujo real y probado.
2. **Sesión/autorización offline**: aprovisionar trust root y claves públicas; demostrar activación/recovery, binding, vigencia, replay, rotación y revocación; fijar una política explícita de duración offline y expiración.
3. **Datos maestros**: implementar y probar la distribución firmada/versionada de cajas, catálogo, precios, impuestos, políticas y demás dependencias; rechazar versiones ausentes/expiradas de forma explícita.
4. **Persistencia de la venta**: demostrar en runtime que venta, pagos permitidos, auditoría y outbox se confirman atómicamente; probar caída del proceso y reinicio sin pérdida ni duplicados.
5. **Reconexión automática**: con credencial real y autoridad desplegada, probar subida ordenada, idempotencia, ACK/checkpoint, reintentos/backoff, resultado incierto, caída de red en mitad de lote y reinicio durante despacho.
6. **Sincronización entrante**: aplicar snapshots/cambios centrales con validación de firma, versión, ámbito y anti-replay; tratar conflictos y revocaciones sin sobrescribir silenciosamente operaciones locales.
7. **E2E físico y certificación**: Windows + SQLite/WAL + servicio central PostgreSQL real, cortar/restaurar conectividad, comparar datos locales/centrales, reiniciar procesos y repetir la prueba. Ejecutar suite del workspace y GitHub Actions sobre el HEAD final.

## Criterios de aceptación medibles

- Una venta permitida se registra localmente aunque la red esté caída y sobrevive al reinicio del servicio/PC.
- La misma solicitud repetida no crea venta ni cobro duplicado.
- La UI distingue “guardada localmente / pendiente de sincronización” de “confirmada por central”; no presenta un ACK ficticio.
- Al recuperar internet, el servicio reintenta sin intervención manual y drena el outbox elegible, preservando orden, idempotencia y auditoría.
- Los cambios centrales aprobados se descargan y activan de forma atómica; versiones antiguas, inválidas o fuera de ámbito se rechazan.
- Al vencer la autorización offline, se bloquean solo las acciones que la política determina, se conserva lo ya registrado y se informa al operador.
- Se verifican reconciliación de totales, pagos, inventario, caja/turno y fiscalidad; no se declara sincronizado por el mero HTTP 200.
- Pruebas repetidas de corte/reconexión, reinicio, fallo parcial y duplicados pasan en el HEAD final.

## Limitación de esta auditoría

Se inspeccionó el contenido remoto de la rama [rama de origen de PR #92](https://github.com/Andresito202/pos-platform/pull/92). En esta sesión no se ejecutó el workspace local, no se probó hardware/Windows físico y GitHub Actions sigue sin entregar pasos/logs observables. Por ello este documento es diagnóstico de código/configuración, **no una certificación runtime**.

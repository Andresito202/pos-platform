# ADR-003: Arquitectura local-first

## Estado

Aceptado.

## Decisión

El POS confirmará las operaciones críticas localmente antes de sincronizar con la nube.

## Motivos

- evitar congelamientos por Internet;
- permitir continuidad operativa;
- proteger ventas;
- soportar modalidad híbrida y perpetua.

## Consecuencias

Se requieren:

- IDs globales;
- idempotencia;
- outbox;
- inbox;
- checkpoints;
- cola de sincronización persistente;
- resolución explícita de conflictos;
- autoridad definida por dominio;
- recuperación reproducible;
- almacenamiento local seguro.

## Especificación normativa relacionada

La definición detallada de autoridad por dato, estados de sincronización, outbox, inbox, checkpoints, relojes, idempotencia, conflictos, reintentos, retención, recuperación y seguridad se encuentra en:

- `DEC-007-local-first-data-authority.md`.

Este ADR conserva la decisión arquitectónica general.

`DEC-007` contiene la política operativa verificable y los criterios de aceptación.

No se utilizará `last-write-wins` como política genérica ni el reloj local como autoridad global.

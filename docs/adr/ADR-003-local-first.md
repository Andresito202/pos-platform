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
- cola de sincronización;
- resolución de conflictos;
- almacenamiento local seguro.

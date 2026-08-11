# ADR-004: Una sola base de código

## Estado

Aceptado.

## Decisión

Las modalidades híbrida y local perpetua compartirán la misma base de código.

## Implementación

Las diferencias se controlarán mediante:

- licencias;
- feature flags;
- configuración;
- deployment mode;
- módulos habilitados.

## Motivo

Evitar productos divergentes y duplicación de mantenimiento.

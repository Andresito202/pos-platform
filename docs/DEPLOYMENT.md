# Despliegue

Este archivo se conserva como punto de entrada para evitar que referencias históricas dirijan a una guía obsoleta.

## Arquitectura objetivo

La política normativa de entornos, infraestructura pagada, Render, PostgreSQL, backups, restauración, observabilidad, rollback y portabilidad se encuentra en:

- `docs/adr/DEC-009-operational-production-baseline.md`;
- `docs/architecture/deployment-modes.md`;
- `docs/adr/DEC-010-pos-runtime.md`.

Actualmente no existe un Blueprint productivo de POS Platform. Se creará cuando el backend objetivo y su pipeline estén implementados y hayan cumplido los gates de `TECH-004` y `TECH-005`.

## Línea base heredada

La antigua guía de demostración de Supermercado Avícola se conserva únicamente como historia en:

- `docs/legacy/avicola-render-demo.md`.

Su Blueprint se encuentra en:

- `render.legacy-demo.yaml`.

El Blueprint heredado:

- usa una instancia gratuita;
- ejecuta FastAPI y el frontend estático heredados;
- no representa el stack objetivo;
- no debe procesar datos reales;
- no debe utilizarse para piloto ni producción;
- no acredita disponibilidad, backup, recuperación ni SLA.

## Regla

No se agregará un nuevo `render.yaml` en la raíz hasta que describa exclusivamente la arquitectura objetivo, use recursos productivos pagados y cumpla `DEC-009`.

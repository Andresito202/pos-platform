# Despliegue TARGET

La política normativa de entornos, infraestructura pagada, PostgreSQL, backups, restauración, observabilidad, rollback y portabilidad se encuentra en:

- `docs/adr/DEC-009-operational-production-baseline.md`;
- `docs/architecture/deployment-modes.md`;
- `docs/adr/DEC-010-pos-runtime.md`.

Actualmente no existe configuración de deployment productivo, staging, piloto ni sandbox dentro del repositorio. Se materializará únicamente cuando el runtime TARGET y su pipeline estén implementados y hayan cumplido los gates de `TECH-004` y `TECH-005`.

## Regla

No se agregará configuración de proveedor o contenedor en la raíz hasta que describa exclusivamente la arquitectura objetivo, tenga ownership definido, use recursos apropiados para su ambiente y cumpla `DEC-009`.

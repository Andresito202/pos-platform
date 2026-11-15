# Auditoría de balanza — Prompt 5 (2026-11-15)

## Alcance

Auditoría del código y contratos de hardware Windows/Android existentes en este repositorio. **No** se declara balanza certificada ni lectura física acreditada.

## Clasificación

| Capacidad | Estado | Evidencia |
|---|---|---|
| Transporte `hardware.command` IPC | OPERATIVA | `packages/contracts/src/hardware.ts`, handlers en `pos-local-service` |
| Perfiles de hardware configurables | PARCIAL | `hardware_profiles_file` / registry de laboratorio |
| Lectura de peso bruta/tara/neto con estabilidad | DOCUMENTADA / laboratorio | Sin dispositivo físico accesible en este entorno |
| Asociación lectura ↔ presentación vendida | AUSENTE en runtime físico | Contrato de captura puede extenderse; no hay dispositivo verificable |
| Captura manual de cantidad/peso | OPERATIVA | Venta/caja ya aceptan cantidad escala-6 tecleada |
| Certificación metrológica / legal | AUSENTE | Fuera del software; requiere autoridad competente |

## Decisión

1. Se conserva captura manual cuando el operador tiene permiso de venta.
2. No se afirma integridad de captura física sin dispositivo accesible y prueba reproducible.
3. Cualquier integración futura de balanza debe rechazar lecturas inválidas, negativas, obsoletas o incompatibles con la presentación, y distinguir `MANUAL` vs `DEVICE`.

## Pendiente real

- Hardware físico Windows/Android no disponible en el entorno de agente.
- Acreditación metrológica y cadena de frío son obligaciones del establecimiento, no del POS.

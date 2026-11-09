# Auditoría histórica de ramas — 2026-09-16

> **Registro histórico, no una instrucción para elegir rama hoy.** El inventario nominal original de las ramas se conserva en Git antes de este commit de saneamiento. La disposición y las pruebas siguen sujetas a validación actual.

## Resultado registrado en la fecha

- 68 referencias Git comparadas con la línea de implementación de ese momento.
- 57 con `ahead_by=0`: contenidas entonces en la línea auditada.
- 10 divergentes: tenían commits no contenidos; no autoriza borrarlas sin comparación vigente.
- `main` era la rama canónica, como sigue siendo hoy.

## Evidencia técnica que no debe perderse

| Referencia | Hallazgo histórico | Disposición |
|---|---|---|
| PR #79 | Payment, Cash, Sale, checksum, runtime y Sync | Comparar e integrar solo deltas útiles |
| PR #81 | Selección de componentes Payment, Sale y Sync | Cerrado; evitar duplicación |
| `940f5d70ed340ebd0ce998a60a0b90081ee3fefe` | La asociación Sale→Cash por `origin_device_id` contradice DEC-012 (`cash_register_id`) | No importar tal cual |
| `ad7c711a339c7f98352cc9a97a9edc4ac8e067ff` | Tipado del handler y transferencia | Comparar antes de reutilizar |
| `bf39de720904f0b4aecf3541515c5b84cdb67f44` | HEAD de referencia de esa auditoría | Solo evidencia histórica |
| `54c3a57acdf1004e85bc64b926ace5ba848a2f6d`, `7690845c6787ab60af5360dcc85f61b19` | Cambios de gobernanza posteriores | Históricos |

No retirar ramas, componentes o contratos por una denominación antigua: comparar commits exclusivos, referencias, tests, owners y uso real. El historial Git conserva la versión completa de esta auditoría.

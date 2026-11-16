# Prompt 7 Pastelería — matriz normativa (Colombia)

Fuentes consultadas (Normograma INVIMA / MinSalud):

- [Resolución 2674 de 2013](https://normograma.invima.gov.co/compilacion/docs/resolucion_minsaludps_2674_2013.htm)
- [Resolución 719 de 2015](https://normograma.invima.gov.co/compilacion/docs/resolucion_minsaludps_0719_2015.htm)
- [Circular 31 de 2015](https://normograma.invima.gov.co/normograma/compilacion/docs/circular_minsaludps_0031_2015.htm)

**No afirmar certificación sanitaria, registro INVIMA ni BPM por existir registros informáticos.**

| Norma/artículo | Actividad | Requisito | Control POS | Evidencia | Obligación externa |
|---|---|---|---|---|---|
| Res. 2674/2013 art. 3 (definiciones: alimento, BPM, manipulación) | Clasificar operación | Distinguir preparación/expendio vs fabricación/envase | Documentación de modalidad en política de producto terminado (`policy_basis`) | Texto en `catalog_bakery_finished_policy` | Clasificación sanitaria del establecimiento ante autoridad competente |
| Res. 2674/2013 art. 6 (condiciones generales de establecimientos) | Local / higiene | Condiciones físicas BPM | Fuera de alcance POS (no simula infraestructura) | N/A en software | Inspección sanitaria / conceptos |
| Res. 2674/2013 art. 19 (envasado, lote, trazabilidad) | Producción / lote terminado | Trazabilidad hacia adelante y atrás; registros por lote | Genealogía: lotes ingrediente → orden → lote terminado → venta (vía transform + `bakery_production_*`) | `getTraceability`, `inventory_transform_line`, outbox | Conservar rótulos/registros físicos exigidos |
| Res. 2674/2013 (manipulación / conservación) | Conservación | Condiciones de almacenamiento | `conservation_code` en perfiles/políticas; lotes con expiry | Perfiles + lotes | Cadena de frío física |
| Res. 719/2015 (clasificación riesgo / notificación-permiso-registro) | Puesta en mercado | NSO / permiso / registro según riesgo | **No** auto-certifica; bloquea publicación vendible sin política de vida útil autorizada | `FINISHED_POLICY_REQUIRED`; release_required → QUARANTINE | Trámite INVIMA / autoridad sanitaria |
| Circular 31/2015 | Orientación operativa | Clarifica aplicación de controles | Referencia documental; sin control inventado | Matriz | Interpretación oficial vigente |

## Distinción operativa en POS

| Modalidad | Tratamiento en Prompt 7 |
|---|---|
| Preparación para venta directa | Producción local → lote; venta en Caja original tras liberación |
| Fabricación/envasado para distribución | Misma maquinaria de lotes; obligaciones de registro/rótulo son externas |
| Manipulación de alimentos | Roles: cajero no administra recetas/costos; admin/supervisor con grants reales |

## Bloqueos externos antes de producción comercial

- Certificación / concepto sanitario del local
- Registro/permiso/notificación del producto cuando aplique (719)
- Validación humana de vida útil y BPM
- Hardware / multi-caja sync real (no mock)

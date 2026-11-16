# Matriz normativa — Prompt 6 Farmacia/Droguería

**HEAD de partida:** `f6f4194cb560eb4d9e5d1b92b1937935c72a78fa`  
**Rama:** `cursor/commercial-design-review-0d11` · PR #106 Draft  

El POS **no sustituye** concepto sanitario, inscripción FNE, radicación oficial ni vigilancia territorial. Las filas con estado `BLOQUEADO_EXTERNO` permanecen denegadas en backend hasta acreditación real.

| Norma / fuente | Tipo establecimiento | Requisito | Proceso POS | Validación backend | Persistencia | Prueba | Estado |
|---|---|---|---|---|---|---|---|
| Decreto 780/2016 (compilado) + Res. 1403/2007 | Droguería | Actividades permitidas; dirección técnica según alcance | Configuración establecimiento | `company_pharmacy_establishment` | M026 | farmacia-pharmacy | OPERATIVO (config) / externo (habilitación) |
| Res. 1403/2007 Manual | Droguería / Farmacia-droguería | Recepción técnica, almacenamiento, dispensación, devoluciones | Recepción técnica + lotes | inspection ACCEPTED/QUARANTINE/REJECTED | `pharmacy_technical_receipt` + lotes 022 | farmacia-pharmacy | OPERATIVO parcial |
| Res. 1478/2006 (modif.) | Droguería con control especial | Dirección técnica QF/regente; libros; inscripción | Control especial | Fail-closed `PHARMACY_CONTROLLED_BLOCKED` | `pharmacy_controlled_ledger` (sin escritura operativa) | farmacia-pharmacy | BLOQUEADO_EXTERNO |
| Res. 315/2020 + Res. 116/2026 anexos | Todos que manejen listados | Listados actualizados; inscripción/ampliación FNE | Clasificación versionada | Categoría `CONTROLLED_SPECIAL` | `catalog_pharmacy_profile` | farmacia-pharmacy | DOCUMENTADO + bloqueo |
| Res. 2482/2026 | Actores con sustancias/medicamentos nuevos en anexos 1/3 | Plazo inscripción/ampliación hasta 1-mar-2027 | No habilita dispensación | Sin ACK FNE → denegado | nota establecimiento | — | BLOQUEADO_EXTERNO |
| INVIMA consulta registros | Productos con RS | Verificación de registro | Ficha `registration_verification_status` | UNVERIFIED/INVALID bloquea Rx | `catalog_pharmacy_profile` | farmacia-pharmacy | PARCIAL (manual) |
| INVIMA alertas sanitarias | Todos | Retiro/cuarentena | Alerta administrativa | `pharmacy.sanitary_alert.register` | `pharmacy_sanitary_alert` | farmacia-pharmacy | PARCIAL (no sync oficial) |
| Salud Capital autorregulación droguerías | Bogotá | Instalaciones/RRHH/calidad — externos al POS | Documentados | N/A | docs | — | EXTERNO |

## Diferencias de establecimiento (no intercambiables)

| Tipo | OTC | Rx | Control especial | Notas |
|---|---|---|---|---|
| DROGUERIA | Configurable | Configurable | Solo si ACCREDITED + integración FNE (hoy bloqueado) | No hereda permisos de IPS |
| FARMACIA_DROGUERIA | Configurable | Configurable | Igual | No auto-habilita control |
| SERVICIO_FARMACEUTICO_IPS | Configurable | Configurable | Igual | Alcance IPS externo al POS comercial |
| DEPOSITO_MAYORISTA | Configurable | Configurable | Igual | Distribución ≠ dispensación minorista |

## Fuentes oficiales consultadas

- https://www.minsalud.gov.co/Normatividad_Nuevo/Resolucion%20No%20116%20de%202026.pdf
- https://www.minsalud.gov.co/Normatividad_Nuevo/Resoluci%C3%B3n%20No%20002482%20de%202026.pdf
- https://normograma.invima.gov.co/compilacion/docs/resolucion_minproteccion_1403_2007.htm
- https://autorregulacion.saludcapital.gov.co/droguerias
- https://www.invima.gov.co/consulta-registros-sanitarios
- https://www.invima.gov.co/alertas-sanitarias

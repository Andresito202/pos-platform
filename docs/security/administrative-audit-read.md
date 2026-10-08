# Auditoría administrativa V1

## Alcance materializado

La primera lectura administrativa usa la evidencia local `local_operation_audit`, que es append-only y ya participa en las transacciones comerciales.

La consulta expuesta por `audit.event.list`:

- construye el scope exclusivamente desde la sesión/configuración confiable;
- exige el permiso atómico `AUDIT_EVENT_READ`;
- permite filtrar por texto, acción, recurso, actor y ventana temporal;
- pagina por `sequence DESC`;
- devuelve únicamente metadatos de trazabilidad;
- no devuelve `details_json`, `previous_value`, `new_value`, secretos ni payloads de evidencia;
- no permite modificar ni borrar auditoría.

## Límite deliberado

`local_operation_audit` no contiene un campo `result` ni una clasificación canónica de criticidad. Por eso V1 no fabrica métricas de "denegados" o "críticos". Esas métricas requieren una fuente y clasificación explícitas antes de incorporarse al panel.

La auditoría central `audit.audit_events` permanece separada de esta proyección local. Su lectura administrativa global requiere la frontera central/platform-admin documentada; no se simula desde Electron.

## Frontend

`AdministrativeControlPanel(kind="audit")` consume el contrato real, muestra filtros, paginación, secuencia, fecha, actor, acción, recurso y motivo, y mantiene la misma paleta y superficies limpias del POS.

## Seguridad

La identidad, tenant, company y branch nunca viajan como autoridad desde el renderer. El backend resuelve el contexto y vuelve a evaluar autorización. Una denegación no devuelve filas.

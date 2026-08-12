# UC-EINV-001: Gestionar el ciclo de vida de un documento electrónico

## Estado

`DONE` como contrato funcional. Implementación y habilitación productiva pendientes según backlog.

## Prioridad

`P1` para diseño; despliegue comercial sujeto a fase especializada.

## Propósito

Configurar un proveedor autorizado para una empresa, preparar un documento desde una operación comercial, transmitirlo de forma idempotente, reconciliar resultados inciertos, conservar artefactos y procesar correcciones o contingencia sin acoplar el dominio a Factus, Siigo u otro proveedor.

## Actores

- propietario o administrador autorizado;
- responsable fiscal autorizado;
- POS Local Service;
- API central;
- worker fiscal;
- proveedor fiscal;
- autoridad fiscal aplicable;
- sistema de auditoría;
- soporte temporal autorizado.

## Dependencias

- empresa y sucursal válidas;
- identidad fiscal configurada;
- venta, devolución u operación origen;
- snapshots comerciales y fiscales;
- permisos y reautenticación;
- `DEC-007`;
- `DEC-008`;
- `DEC-009`;
- `DEC-010`;
- `ARCH-004`;
- `docs/architecture/electronic-invoicing.md`.

## Invariantes

1. Una venta comercial y un documento electrónico son hechos diferentes.
2. Ningún proveedor recalcula o modifica la venta original.
3. Un documento aceptado no se elimina ni sobrescribe.
4. Una corrección crea otro documento relacionado.
5. Toda transmisión es idempotente o reconciliable.
6. Un timeout no significa rechazo.
7. No se repite un resultado incierto sin consulta o revisión.
8. Factus, Siigo y otros proveedores se integran mediante adaptadores.
9. Credenciales se aíslan por empresa y ambiente.
10. Un ticket no se presenta como factura electrónica sin evidencia válida.
11. La falta de proveedor fiscal no impide operar el núcleo comercial contratado.
12. Una obligación legal no se desactiva mediante una opción técnica.

## Permisos conceptuales

- consultar estado fiscal;
- configurar conexión fiscal;
- validar conexión;
- activar o desactivar configuración;
- preparar documento;
- solicitar emisión;
- reintentar después de autorización;
- reconciliar;
- descargar XML/PDF;
- emitir nota;
- activar contingencia;
- cerrar contingencia;
- consultar auditoría.

Configurar credenciales, cambiar NIT, ambiente, certificado, rango o proveedor requiere reautenticación y segregación de funciones cuando aplique.

## Flujo A — Configurar proveedor

### Entrada

```text
tenant_id
company_id
tax_identity_id
provider_code
environment
capabilities_requested
credential_input
certificate_input cuando aplique
numbering_configuration
expected_version
idempotency_key
```

### Flujo

1. El actor se autentica y reautentica.
2. El sistema valida tenant, empresa y permiso.
3. Valida que el ambiente sea `SANDBOX` o `PRODUCTION` explícito.
4. Almacena secretos en el mecanismo protegido y recibe referencias opacas.
5. Construye configuración versionada sin secretos en el payload de dominio.
6. El adaptador valida credenciales y consulta capacidades disponibles.
7. Valida rangos, prefijos, certificados o prerequisitos que el proveedor permita consultar.
8. Registra capacidades como `SUPPORTED`, `UNSUPPORTED` o `UNVERIFIED`.
9. Si falta un requisito, conserva configuración inactiva con diagnóstico seguro.
10. Si cumple, activa la versión de configuración.
11. Audita actor, cambio, proveedor, ambiente y referencias no sensibles.

### Reglas

- sandbox no se promueve cambiando únicamente una URL;
- una credencial no se comparte implícitamente con otra empresa;
- el secreto anterior se rota o revoca según política;
- no se devuelve el secreto después de almacenarlo;
- la UI solo ve estado, últimos caracteres permitidos y diagnóstico;
- activar nueva versión no reescribe documentos históricos.

## Flujo B — Preparar documento

### Entrada

- operación origen;
- tipo documental;
- empresa y sucursal;
- adquiriente cuando corresponda;
- configuración fiscal aplicable;
- idempotency key.

### Flujo

1. Valida que la operación origen exista y pertenezca al scope.
2. Valida que no exista documento equivalente creado con otra identidad.
3. Obtiene snapshots comerciales y fiscales inmutables.
4. Valida datos obligatorios según capacidad canónica.
5. Selecciona configuración fiscal vigente.
6. Construye payload canónico versionado.
7. Calcula checksum.
8. Crea `ElectronicDocument` en `DRAFT`.
9. Ejecuta validación interna.
10. Congela el payload y pasa a `READY`.
11. Registra auditoría y evento.

### Excepciones

- configuración inexistente;
- capacidad no soportada;
- datos de adquiriente incompletos;
- rango vencido o desconocido;
- operación origen no elegible;
- documento equivalente existente;
- checksum diferente para misma idempotency key.

Ninguna excepción modifica la venta original.

## Flujo C — Encolar y transmitir

1. El actor o proceso autorizado solicita emisión.
2. El sistema valida estado `READY`.
3. Crea trabajo persistente y pasa a `QUEUED`.
4. El worker adquiere lease y crea `FiscalSubmissionAttempt`.
5. Persiste el attempt en `CREATED`, lo adquiere mediante versión/lease y lo pasa a `IN_PROGRESS`; el documento cambia temporalmente a `SUBMITTING`.
6. El adaptador aplica rate limit y obtiene credenciales.
7. Transforma el payload canónico al proveedor.
8. Envía con identidad e idempotencia disponibles.
9. Persiste respuesta y artefactos o sus referencias.
10. Normaliza resultado.
11. Actualiza documento y finaliza el attempt en `COMPLETED`, `FAILED`, `UNKNOWN_OUTCOME` o `CANCELLED` según la evidencia técnica, en la misma frontera consistente aplicable.
12. Publica evento y auditoría.

### Resultado aceptado

- estado `ACCEPTED`;
- identidad externa;
- prefijo/número cuando corresponda;
- CUFE/CUDE u otro identificador cuando aplique;
- referencias XML/PDF;
- timestamps y evidencia.

### Resultado rechazado

- estado `REJECTED`;
- códigos originales;
- categoría normalizada;
- campos o reglas reportadas;
- acción requerida;
- payload congelado conservado.

### Timeout o desconexión

- el intento queda con resultado incierto;
- el attempt conserva `UNKNOWN_OUTCOME` como hecho técnico histórico;
- documento pasa a `UNKNOWN_OUTCOME`;
- no se crea otro documento;
- se agenda consulta o revisión;
- la UI informa que requiere conciliación.

## Flujo D — Reconciliar

1. Selecciona documento `UNKNOWN_OUTCOME`, `SUBMITTING` vencido o pendiente de verificación.
2. Obtiene configuración histórica usada.
3. Consulta mediante las referencias disponibles.
4. Si encuentra aceptación, actualiza a `ACCEPTED` y recupera artefactos.
5. Si encuentra rechazo verificable, actualiza a `REJECTED`.
6. Si el proveedor confirma ausencia inequívoca, puede autorizarse retry con el mismo documento e idempotencia.
7. Si no existe consulta concluyente, conserva incidencia y revisión manual.
8. Audita fuentes, actor/proceso y resultado.

La ejecución de conciliación usa `FiscalReconciliation` con estados `CREATED`, `RUNNING`, `REVIEW_REQUIRED`, `PARTIALLY_RECONCILED`, `RECONCILED`, `FAILED`, `CANCELLED`, `CLOSED` y `REOPENED`. Su scope es snapshot. Una discrepancia que requiere revisión crea o relaciona `FiscalIncident` en `OPEN`/`IN_REVIEW`; resolverla no borra attempts ni evidencia anteriores.

Un proceso automático no decide ausencia por un simple `404` sin conocer la semántica exacta del proveedor.

## Flujo E — Emitir nota o ajuste

1. Recibe devolución, corrección u operación autorizada.
2. Valida documento original aceptado.
3. Valida cantidades e importes elegibles acumulados.
4. Determina tipo canónico permitido.
5. Crea un nuevo `ElectronicDocument` relacionado.
6. Conserva razón y referencia comercial.
7. Sigue preparación, transmisión y conciliación ordinarias.
8. No modifica el documento ni la venta originales.

Un refund o reversal financiero sin operación fiscal aplicable no crea automáticamente una nota.

## Flujo F — Contingencia

1. El responsable solicita contingencia o el sistema propone evaluación.
2. Valida permiso y reautenticación.
3. Verifica configuración y prerequisitos vigentes.
4. Registra causa, alcance, inicio y responsable.
5. Crea documento en estado `CONTINGENCY` mediante el mecanismo autorizado.
6. Entrega representación permitida sin declarar una aceptación inexistente.
7. Conserva numeración y evidencia.
8. Al restablecerse la operación, transmite dentro del procedimiento aplicable.
9. Reconciliación determina estado final.
10. Cierra contingencia con auditoría.

Un timeout individual no activa automáticamente contingencia.

## Flujo G — Operar sin proveedor fiscal

1. La empresa no tiene configuración fiscal activa.
2. POS muestra la capacidad como no contratada o no configurada.
3. Completa venta, pagos, inventario, caja y ticket comercial.
4. No crea intentos fiscales.
5. No muestra estados de aceptación ni identificadores fiscales.
6. El responsable puede configurar posteriormente un proveedor conforme al alcance legal permitido.

Si la empresa está legalmente obligada a emitir, el sistema muestra la falta de configuración como riesgo operativo; no la oculta ni afirma cumplimiento.

## Idempotencia

- configurar: empresa + proveedor + ambiente + idempotency key;
- preparar: operación origen + tipo documental + identidad lógica;
- transmitir: electronic_document_id + intento lógico;
- reconciliar: electronic_document_id + ventana/consulta;
- nota: operación de ajuste + tipo + documento original;
- contingencia: empresa + evento de contingencia + identidad documental.

La misma clave con checksum distinto produce conflicto.

## Auditoría

Registrar como mínimo:

- configuración creada, validada, activada, desactivada o rotada;
- documento preparado;
- emisión solicitada;
- intento iniciado y finalizado;
- aceptación, rechazo o resultado incierto;
- reconciliación;
- artefacto descargado;
- nota creada;
- contingencia iniciada y cerrada;
- cambio de proveedor;
- acceso de soporte.

No registrar secretos ni documentos completos dentro del log de auditoría.

## Eventos conceptuales

- `FiscalProviderConfigured`;
- `FiscalConfigurationValidated`;
- `ElectronicDocumentPrepared`;
- `ElectronicDocumentQueued`;
- `FiscalSubmissionStarted`;
- `FiscalSubmissionCompleted`;
- `FiscalSubmissionFailed`;
- `FiscalSubmissionOutcomeUnknown`;
- `ElectronicDocumentAccepted`;
- `ElectronicDocumentRejected`;
- `ElectronicDocumentOutcomeUnknown`;
- `FiscalReconciliationCompleted`;
- `FiscalReconciliationReviewRequired`;
- `FiscalIncidentOpened`;
- `FiscalIncidentResolved`;
- `ElectronicAdjustmentPrepared`;
- `FiscalContingencyStarted`;
- `FiscalContingencyClosed`.

Los nombres definitivos y schemas se materializarán en `TECH-003` sin duplicar eventos ya existentes.

## Pruebas mínimas

1. configuración Factus sandbox válida;
2. credenciales inválidas;
3. separación sandbox/producción;
4. aislamiento entre dos empresas;
5. factura aceptada;
6. factura rechazada;
7. timeout antes de enviar;
8. timeout después de recepción externa;
9. conciliación aceptada;
10. retry sin duplicado;
11. mismo idempotency key con payload diferente;
12. `429` y `Retry-After`;
13. token expirado y renovación;
14. estado desconocido;
15. descarga XML/PDF;
16. nota parcial;
17. notas acumuladas por encima del elegible;
18. contingencia habilitada;
19. contingencia no habilitada;
20. operación `LOCAL_PERPETUAL` sin proveedor;
21. segundo adaptador sin cambios al dominio comercial;
22. secretos ausentes de logs, trazas y renderer.

## Postcondiciones

- venta original permanece inmutable;
- documento conserva identidad y versión;
- resultado y evidencia quedan persistidos;
- estados específicos del proveedor se conservan;
- auditoría está disponible;
- artefactos tienen checksum y autorización;
- reintentos no duplican documentos;
- incidentes inciertos permanecen visibles hasta resolución.

## Criterios de cierre documental

El caso queda definido porque cubre configuración, preparación, transmisión, aceptación, rechazo, timeout, conciliación, notas, contingencia, ausencia de proveedor, idempotencia, auditoría y pruebas multi-proveedor.

No se marcará implementación como terminada hasta disponer de código, sandbox, pruebas, seguridad, migraciones, proveedor productivo contratado y validación normativa vigente.

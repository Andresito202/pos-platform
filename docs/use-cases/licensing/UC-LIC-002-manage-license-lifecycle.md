# UC-LIC-002: Gestionar ciclo de vida de licencia

## Objetivo

Gestionar de forma segura, trazable y multi-tenant el ciclo de vida de una licencia desde su emisión hasta su renovación, restricción, suspensión, reactivación, revocación o terminación.

Este caso de uso administra derechos contractuales y operativos de la licencia, pero no sustituye:

- la activación;
- la identidad del dispositivo;
- la sesión del usuario;
- los permisos;
- la propiedad del hardware;
- la política técnica de administración del dispositivo.

## Actor principal

Administrador autorizado de la plataforma o servicio central de licencias.

## Actores secundarios

- tenant;
- empresa;
- servicio de activación;
- servicio de dispositivos;
- sistema de auditoría;
- sistema de facturación comercial;
- soporte autorizado;
- POS autorizado.

## Precondiciones

- El tenant está identificado.
- El actor dispone de autorización suficiente para la operación solicitada.
- Existe una política de licenciamiento vigente.
- El sistema dispone de claves confiables para firmar o verificar artefactos cuando corresponda.
- Los límites, módulos y modalidad contractual están definidos.
- La operación no depende exclusivamente del estado local del cliente.
- Las acciones críticas quedan auditadas.

## Entrada

Según la operación:

- `tenant_id`;
- `license_id` opcional;
- `deployment_mode`;
- `license_status` opcional;
- `plan_reference` opcional;
- `entitlements`;
- `device_limit` opcional;
- `branch_limit` opcional;
- `start_at`;
- `expires_at` opcional;
- `grace_policy_reference` opcional;
- `requested_action`;
- `reason` opcional;
- `actor_id`;
- `correlation_id`;
- `operation_context`;
- `policy_version`;
- `commercial_reference` opcional.

## Principios del caso de uso

1. La licencia es distinta de activación, dispositivo, instalación, sesión y permisos.
2. Una activación no amplía derechos contractuales.
3. El cliente no puede modificar localmente vigencia, módulos, límites, gracia ni revocaciones.
4. Los artefactos emitidos deben ser verificables.
5. La clave privada central no reside en el cliente.
6. La falta de conectividad no crea derechos.
7. La reinstalación no reinicia gracia ni estado contractual.
8. Una suspensión no elimina datos.
9. Una revocación no elimina datos.
10. Una licencia `LOCAL_PERPETUAL` no incluye automáticamente actualizaciones mayores.
11. La modalidad `HYBRID` y `LOCAL_PERPETUAL` comparten la misma base de código.
12. La restricción progresiva requiere política autorizada.
13. Los avisos comerciales no sustituyen el estado contractual.
14. Una venta ya confirmada no se elimina ni recalcula por cambio posterior de licencia.
15. Toda emisión, renovación, suspensión, reactivación, revocación y cambio de derechos queda auditado.

## Emisión de licencia

La emisión crea una licencia verificable para un tenant bajo una modalidad, vigencia, conjunto de derechos y límites definidos.

Flujo:

1. El sistema recibe una solicitud de emisión.
2. Valida actor, tenant, modalidad, plan, derechos y límites.
3. Genera `license_id` único.
4. Define `start_at` y `expires_at` cuando corresponda.
5. Define `deployment_mode`.
6. Define derechos y límites contractuales.
7. Define la política de gracia aplicable.
8. Versiona la política utilizada.
9. Firma el artefacto mediante la autoridad central.
10. Persiste la licencia y su estado inicial.
11. Registra auditoría.
12. Devuelve el artefacto verificable.

Reglas:

1. Una licencia nueva no reutiliza identidad de otra licencia terminada.
2. La licencia emitida pertenece a un único tenant.
3. La emisión no crea automáticamente una activación.
4. Los derechos emitidos no pueden exceder el plan o contrato autorizado.
5. La clave privada de firma permanece fuera del cliente.
6. La emisión debe ser idempotente cuando corresponda a una misma operación administrativa.
7. Toda emisión queda auditada.

## Renovación

La renovación extiende o actualiza derechos contractuales mediante una nueva decisión autoritativa.

Flujo:

1. El sistema identifica la licencia vigente.
2. Valida actor, tenant y estado contractual.
3. Verifica que la renovación esté permitida.
4. Determina nueva vigencia.
5. Determina derechos y límites aplicables.
6. Genera nueva versión del artefacto firmado.
7. Conserva trazabilidad con la versión anterior.
8. Actualiza el estado contractual.
9. Publica el nuevo artefacto verificable.
10. Audita la renovación.

Reglas:

1. La renovación no borra historial.
2. Una renovación no revive automáticamente una licencia revocada.
3. Una renovación no amplía derechos fuera del contrato.
4. La nueva versión debe poder distinguirse de versiones anteriores.
5. Una copia local antigua no prevalece sobre una versión autoritativa más reciente.

## Avisos de vencimiento

Los avisos informan sobre cambios contractuales próximos, pero no sustituyen el estado efectivo de la licencia.

Niveles conceptuales:

- `NOTICE_1`;
- `NOTICE_2`;
- `FINAL_NOTICE`.

Reglas:

1. Los avisos se generan según política versionada.
2. Los intervalos no se hardcodean en el dominio.
3. Un aviso no cambia por sí solo derechos.
4. Los avisos deben ser visibles en los canales autorizados.
5. El sistema debe registrar que el aviso fue generado.
6. Cuando corresponda, debe registrar entrega o reconocimiento.
7. Un aviso puede existir antes del vencimiento o durante mora según política.

## Periodo de gracia

El periodo de gracia permite continuar con capacidades autorizadas durante un intervalo explícitamente permitido.

Flujo:

1. El sistema detecta una condición que puede habilitar gracia.
2. Verifica que exista política autorizada.
3. Determina inicio y fin de gracia.
4. Determina capacidades permitidas durante gracia.
5. Emite o registra la autorización correspondiente.
6. Conserva trazabilidad.
7. Evalúa la gracia en cada decisión de autorización operativa.

Reglas:

1. La gracia nunca se infiere.
2. La pérdida de conectividad no crea gracia.
3. Una firma inválida no crea gracia.
4. Una reinstalación no reinicia gracia.
5. Cambiar el reloj no extiende gracia.
6. Una gracia agotada no se reinicia localmente.
7. La gracia puede revocarse cuando la política lo permita.

## Restricción progresiva

La restricción progresiva reduce capacidades autorizadas según la política contractual aplicable.

La restricción debe operar mediante derechos y capacidades explícitas, no mediante bloqueos generales del sistema.

Ejemplos de capacidades restringibles:

- reportes avanzados;
- creación de usuarios adicionales;
- nuevas sucursales;
- domicilios;
- integraciones externas;
- funciones cloud;
- módulos no esenciales.

Reglas:

1. La restricción requiere una política autorizada.
2. La restricción no elimina datos.
3. Una venta ya confirmada no se modifica.
4. Las capacidades críticas deben definirse explícitamente.
5. La restricción no debe confundirse con revocación de dispositivo.
6. La restricción no autoriza control general del sistema operativo del cliente.
7. Toda transición de restricción queda auditada.

## Suspensión

La suspensión impide nuevas operaciones o capacidades según el alcance contractual definido.

Flujo:

1. El sistema identifica la causa de suspensión.
2. Verifica política, actor y tenant.
3. Determina el alcance de la suspensión.
4. Actualiza el estado contractual.
5. Emite o actualiza el artefacto verificable.
6. Mantiene acceso permitido a información o capacidades mínimas según política.
7. Preserva datos.
8. Audita la suspensión.

Reglas:

1. Suspender no elimina datos.
2. Suspender no revoca automáticamente el dispositivo.
3. Suspender no destruye historial.
4. Suspender no invalida operaciones comerciales ya confirmadas.
5. La suspensión debe poder revertirse mediante reactivación autorizada.
6. El alcance debe ser explícito y versionado.

## Reactivación

La reactivación restaura capacidades autorizadas después de resolver la causa de restricción o suspensión.

Flujo:

1. El sistema identifica la licencia afectada.
2. Verifica que la reactivación esté permitida.
3. Verifica actor, tenant y contexto contractual.
4. Determina derechos efectivos.
5. Emite una nueva decisión o artefacto verificable cuando corresponda.
6. Conserva historial de suspensión y reactivación.
7. Audita la operación.

Reglas:

1. Reactivar no borra el historial de mora o suspensión.
2. Reactivar no revive revocaciones de dispositivo.
3. Reactivar no amplía derechos.
4. La reactivación debe ser explícita.
5. La ausencia de conectividad no produce reactivación automática.

## Revocación de licencia

La revocación desautoriza una licencia por una causa explícita de seguridad, fraude, terminación administrativa u otra política válida.

Flujo:

1. El sistema identifica la licencia.
2. Valida actor, tenant, alcance y motivo.
3. Verifica que la operación no corresponda únicamente a una suspensión comercial temporal.
4. Registra identidad y secuencia de revocación.
5. Actualiza el estado de la licencia.
6. Publica la revocación para los componentes que deban conocerla.
7. Conserva la revocación para operación offline cuando corresponda.
8. Preserva datos e historial.
9. Audita la revocación.

Reglas:

1. Revocación y suspensión son estados distintos.
2. Una licencia revocada no se reactiva mediante un flujo ordinario.
3. La revocación no elimina ventas, pagos, inventario, caja ni auditoría.
4. Una copia local antigua no prevalece sobre una revocación conocida más reciente.
5. La revocación debe conservar motivo, actor, secuencia y momento efectivo.
6. Una licencia revocada puede requerir un proceso excepcional de recuperación o nueva emisión según política.

## Terminación contractual

La terminación representa el cierre definitivo de una relación contractual de licencia sin eliminar la información histórica asociada.

Flujo:

1. Se identifica la licencia y contrato aplicable.
2. Se valida actor y tenant.
3. Se determina fecha efectiva de terminación.
4. Se define el comportamiento residual permitido.
5. Se actualiza el estado contractual.
6. Se preserva acceso permitido a datos según política.
7. Se impide la creación de nuevas operaciones no autorizadas.
8. Se conserva historial.
9. Se audita la terminación.

Reglas:

1. Terminación no equivale necesariamente a revocación de seguridad.
2. La terminación no elimina datos.
3. La terminación no borra auditoría.
4. Las activaciones asociadas deben evaluarse según la política aplicable.
5. El cliente no puede utilizar una reinstalación para evitar la terminación.
6. La terminación debe ser explícita y versionada.

## Modalidad `LOCAL_PERPETUAL`

Una licencia `LOCAL_PERPETUAL` autoriza uso permanente dentro del alcance contratado y la versión o política definida.

Reglas:

1. No requiere validación permanente por Internet.
2. Debe seguir validando firma, integridad, dispositivo, activación y revocaciones conocidas cuando corresponda.
3. No incluye automáticamente actualizaciones mayores.
4. Puede incluir actualizaciones menores o de seguridad según contrato.
5. No genera mensualidad obligatoria si el contrato no la establece.
6. No debe convertirse automáticamente en suscripción.
7. Servicios externos, soporte, cloud o integraciones pueden tener vigencias independientes.
8. La modalidad perpetua no elimina límites contractuales.
9. Una revocación válida por seguridad sigue siendo aplicable.
10. La reinstalación no genera una nueva licencia perpetua.

## Modalidad `HYBRID`

Una licencia `HYBRID` permite operación local con servicios centrales y sincronización cuando existe conectividad.

Reglas:

1. La pérdida de Internet no crea nuevos derechos.
2. La operación local autorizada depende de artefactos verificables.
3. El estado central más reciente prevalece cuando la política lo determina.
4. La licencia híbrida puede estar sujeta a renovación periódica.
5. La sincronización no sustituye validación de licencia.
6. La operación offline debe respetar revocaciones conocidas y gracia autorizada.
7. El cliente no puede modificar localmente el estado contractual.

## Cambio de plan y derechos

El cambio de plan modifica derechos y límites mediante una decisión autoritativa y versionada.

Flujo:

1. Se identifica la licencia actual.
2. Se valida actor, tenant y contrato.
3. Se determina el nuevo plan.
4. Se calculan derechos y límites efectivos.
5. Se define fecha de entrada en vigor.
6. Se genera una nueva versión verificable.
7. Se conserva trazabilidad con la versión anterior.
8. Se publica el nuevo estado.
9. Se audita el cambio.

Reglas:

1. Un upgrade puede ampliar derechos únicamente dentro del contrato aprobado.
2. Un downgrade no elimina datos existentes.
3. Un downgrade puede restringir nuevas operaciones que excedan límites futuros.
4. Los recursos ya creados deben tratarse mediante política explícita.
5. El cambio de plan no modifica automáticamente identidad de dispositivo.
6. El cambio de plan no reutiliza activaciones para ampliar límites.
7. Toda modificación de derechos queda auditada.

## Relación con activaciones

La licencia define derechos; la activación vincula esos derechos con un dispositivo e instalación autorizados.

Reglas:

1. Una activación referencia una licencia válida.
2. Una activación no amplía módulos, límites ni vigencia.
3. Suspender una licencia puede restringir capacidades de sus activaciones según política.
4. Revocar una licencia puede invalidar operación autorizada de activaciones asociadas.
5. Revocar una activación no revoca necesariamente toda la licencia.
6. Reemplazar dispositivo no crea derechos nuevos.
7. Las activaciones conservan identidad e historial propios.

## Relación con dispositivos

La licencia y el dispositivo se administran como conceptos separados.

Reglas:

1. Un dispositivo puede estar registrado antes de recibir una activación.
2. Una licencia puede existir sin dispositivo activado.
3. La confianza del dispositivo no sustituye estado contractual.
4. Un dispositivo `STALE` o `UNREACHABLE` no cambia por sí solo el estado de la licencia.
5. Una desinstalación confirmada no cancela automáticamente la licencia.
6. La deuda o suspensión de licencia no implica revocación criptográfica del dispositivo.
7. La reinstalación o reemplazo deben conservar trazabilidad con la licencia existente.

## Dimensiones de estado de licencia

El estado de una licencia se evalúa mediante dimensiones separadas.

No debe persistirse un único estado monolítico que mezcle contrato, vigencia temporal, gracia, restricción, revocación y validez criptográfica.

## Estado contractual

Valores conceptuales de `contract_status`:

- `TRIAL`;
- `ACTIVE`;
- `PAST_DUE`;
- `SUSPENDED`;
- `CANCELLED`;
- `TERMINATED`.

### `TRIAL`

La relación contractual opera bajo condiciones temporales y limitadas definidas por política.

### `ACTIVE`

La relación contractual se encuentra activa.

La autorización efectiva todavía depende de vigencia, entitlements, activación, dispositivo, gracia, revocaciones y demás políticas aplicables.

### `PAST_DUE`

Existe una obligación comercial vencida, pero la relación contractual todavía no se encuentra suspendida o terminada.

### `SUSPENDED`

La relación contractual se encuentra suspendida y las capacidades efectivas se determinan mediante la política autorizada.

### `CANCELLED`

La relación contractual fue cancelada mediante una decisión administrativa o comercial válida.

### `TERMINATED`

La relación contractual fue cerrada definitivamente mediante un proceso explícito.

## Vigencia temporal

La vigencia se determina mediante:

- `not_before`;
- `expires_at`;
- evidencia temporal confiable;
- política aplicable.

`EXPIRED` representa un resultado temporal de evaluación y no un `contract_status` persistente.

## Estado de gracia

La gracia se representa mediante `GraceAuthorization`.

`GRACE_PERIOD` representa una decisión efectiva cuando existe una autorización de gracia válida y vigente.

La gracia no se infiere del estado contractual ni de la conectividad.

## Restricción efectiva

`RESTRICTED` representa una decisión efectiva de autorización.

No constituye un `contract_status` base.

La restricción se calcula a partir de:

- estado contractual;
- entitlements;
- política de restricción;
- vigencia;
- gracia;
- activación;
- dispositivo;
- revocaciones conocidas.

## Revocación

La revocación se representa mediante `LicenseRevocation`.

`REVOKED` representa el resultado efectivo cuando existe una revocación aplicable.

No constituye un `contract_status`.

## Validez del artefacto

`INVALID` representa un resultado de validación criptográfica, estructural o normativa.

Puede producirse por:

- firma inválida;
- clave de firma desconocida;
- estructura inválida;
- versión incompatible;
- emisor no confiable;
- corrupción del artefacto.

`INVALID` no constituye un estado contractual.

## Decisión efectiva de autorización

La autorización efectiva debe calcularse combinando:

1. `contract_status`;
2. vigencia temporal;
3. entitlements;
4. `GraceAuthorization`;
5. activación;
6. confianza y estado aplicable del dispositivo;
7. `LicenseRevocation`;
8. política offline;
9. versión de aplicación;
10. demás restricciones contractuales y técnicas aplicables.

La decisión efectiva puede producir resultados como:

- `ALLOW`;
- `ALLOW_WITH_RESTRICTIONS`;
- `DENY`;
- `GRACE_PERIOD`;
- `RESTRICTED`;
- `EXPIRED`;
- `REVOKED`;
- `INVALID`.

## Salida

El caso de uso devuelve una respuesta estructurada que puede incluir:

- `license_id`;
- `tenant_id`;
- `license_status`;
- `deployment_mode`;
- `effective_entitlements`;
- `device_limit` opcional;
- `branch_limit` opcional;
- `start_at`;
- `expires_at` opcional;
- `grace_started_at` opcional;
- `grace_ends_at` opcional;
- `restriction_level` opcional;
- `required_action` opcional;
- `decision_code`;
- `policy_version`;
- `correlation_id`;
- `effective_at`.

La salida no debe incluir:

- claves privadas;
- secretos;
- credenciales reutilizables;
- información de otros tenants;
- datos comerciales innecesarios para la decisión.

## Flujos alternos

### Tenant inválido

1. La operación se rechaza.
2. No se crea ni modifica la licencia.
3. Se devuelve código estable.
4. El intento sensible queda auditado.

### Actor sin autorización

1. La operación se rechaza.
2. No se modifican derechos ni estado contractual.
3. Se registra intento no autorizado cuando corresponde.
4. No se revelan datos fuera del alcance permitido.

### Firma inválida

1. El artefacto se considera inválido.
2. No se genera gracia.
3. No se amplían derechos.
4. Se devuelve `INVALID` o código estable equivalente.

### Clave de firma desconocida

1. El artefacto no se acepta por fallback.
2. No se confía automáticamente en la clave recibida.
3. Se genera código de error estable.
4. Puede requerirse actualización del conjunto de confianza.

### Renovación no permitida

1. No se extiende vigencia.
2. No se genera nueva versión contractual.
3. Se informa la causa.
4. Se conserva el estado anterior.

### Gracia no autorizada

1. No se genera `GRACE_PERIOD`.
2. Se evalúa el siguiente estado permitido por política.
3. No se inventa una extensión temporal.

### Gracia agotada

1. La licencia abandona `GRACE_PERIOD`.
2. Se evalúa `RESTRICTED`, `SUSPENDED`, `EXPIRED` u otro estado permitido.
3. La gracia no se reinicia localmente.

### Suspensión por falta de pago

1. Se verifica la política autorizada.
2. Se confirma que los avisos y gracia aplicables fueron evaluados.
3. Se restringen únicamente las capacidades definidas.
4. Se preservan datos.
5. Se audita la suspensión.

### Pago confirmado después de suspensión

1. Se valida la confirmación autoritativa.
2. Se reevalúa el estado contractual.
3. Se ejecuta reactivación explícita cuando corresponde.
4. Se conserva historial.

### Dispositivo `STALE` o `UNREACHABLE`

1. No se modifica automáticamente el estado de la licencia.
2. Se conserva la evaluación contractual.
3. Puede generarse alerta administrativa separada.

### Desinstalación confirmada

1. La licencia no se cancela automáticamente.
2. No se elimina deuda.
3. No se elimina historial.
4. Puede iniciarse revisión administrativa.

### Cambio de plan con recursos excedidos

1. Los datos existentes no se eliminan.
2. Se aplican límites a nuevas operaciones según política.
3. El exceso debe resolverse explícitamente.
4. No se corrige destruyendo información existente.

## Puntos de auditoría

Deben auditarse como mínimo:

- emisión;
- renovación;
- cambio de vigencia;
- cambio de plan;
- cambio de derechos;
- cambio de límites;
- inicio de gracia;
- fin de gracia;
- restricción;
- suspensión;
- reactivación;
- cancelación;
- revocación;
- terminación;
- cambio de modalidad;
- acceso administrativo sensible;
- override excepcional autorizado.

Cada evento auditable debe conservar cuando corresponda:

- `tenant_id`;
- `actor_id`;
- `actor_type`;
- `license_id`;
- acción;
- estado anterior;
- estado nuevo;
- derechos anteriores;
- derechos nuevos;
- motivo;
- referencia comercial;
- `correlation_id`;
- fecha efectiva;
- política aplicada.

La auditoría es independiente del logging técnico.

## Puntos de observabilidad futura

Este caso de uso define puntos semánticos de instrumentación sin depender de SDKs concretos.

Eventos conceptuales:

- `LICENSE_ISSUED`;
- `LICENSE_RENEWED`;
- `LICENSE_NOTICE_GENERATED`;
- `LICENSE_GRACE_STARTED`;
- `LICENSE_GRACE_ENDED`;
- `LICENSE_RESTRICTED`;
- `LICENSE_SUSPENDED`;
- `LICENSE_REACTIVATED`;
- `LICENSE_PLAN_CHANGED`;
- `LICENSE_REVOKED`;
- `LICENSE_TERMINATED`;
- `LICENSE_VALIDATION_FAILED`.

Métricas conceptuales futuras:

- licencias activas;
- licencias en mora;
- licencias en gracia;
- licencias restringidas;
- licencias suspendidas;
- renovaciones;
- reactivaciones;
- revocaciones;
- cambios de plan;
- fallos de validación.

Reglas:

1. El dominio no importa OpenTelemetry, Prometheus, Grafana, Sentry ni SDK equivalente.
2. Los casos de uso utilizan puertos de observabilidad cuando dichos contratos sean implementados.
3. `tenant_id` y `correlation_id` se propagan en operaciones multi-tenant.
4. Los identificadores de alta cardinalidad no deben usarse indiscriminadamente como labels de métricas.
5. Fallar logging o métricas no debe alterar la decisión contractual.
6. La auditoría crítica puede requerir garantías más fuertes.
7. No se registran secretos.
8. Observabilidad no sustituye auditoría ni autorización.

## Pruebas mínimas

El diseño debe permitir verificar como mínimo:

1. emisión válida;
2. emisión con tenant inválido;
3. emisión con actor sin autorización;
4. emisión idempotente;
5. licencia activa;
6. licencia trial;
7. licencia vencida;
8. licencia `PAST_DUE`;
9. primer aviso;
10. segundo aviso;
11. aviso final;
12. inicio de gracia;
13. gracia vigente;
14. gracia agotada;
15. restricción progresiva;
16. suspensión;
17. reactivación;
18. reactivación no autorizada;
19. revocación;
20. terminación contractual;
21. renovación válida;
22. renovación no permitida;
23. cambio de plan;
24. upgrade;
25. downgrade;
26. downgrade con recursos excedidos;
27. modalidad `HYBRID`;
28. modalidad `LOCAL_PERPETUAL`;
29. operación offline autorizada;
30. pérdida de conectividad;
31. firma inválida;
32. clave de firma desconocida;
33. dispositivo `STALE`;
34. dispositivo `UNREACHABLE`;
35. desinstalación confirmada;
36. activación ausente;
37. activación válida;
38. activación revocada;
39. preservación de datos;
40. aislamiento entre tenants;
41. auditoría de cambios;
42. historial de versiones;
43. no reinicio de gracia por reinstalación;
44. no ampliación de derechos por activación;
45. observabilidad futura no altera el resultado contractual.

## Documentos normativos relacionados

- `docs/adr/DEC-008-device-trust-license-activation.md`;
- `docs/architecture/conceptual-data-model.md`;
- `docs/architecture/security-model.md`;
- `docs/domain/business-rules.md`;
- `docs/domain/glossary.md`;
- `docs/use-cases/licensing/UC-LIC-001-validate-license.md`;
- `docs/use-cases/devices/UC-DEV-001-manage-device-lifecycle.md`.

# UC-DEV-001: Gestionar ciclo de vida del dispositivo

## Objetivo

Gestionar de forma segura, trazable y multi-tenant el ciclo de vida de un dispositivo autorizado para ejecutar el POS o servicios relacionados, desde su registro inicial hasta su desactivación, revocación, recuperación o reemplazo.

Este caso de uso define el comportamiento operativo del dispositivo y su instalación, pero no emite licencias ni amplía derechos contractuales.

El dispositivo se considera una identidad operativa distinta de:

- la licencia;
- la activación;
- la instalación;
- la clave criptográfica;
- la evidencia de hardware;
- la sesión del usuario;
- la propiedad física del equipo.

## Actor principal

Administrador autorizado de la plataforma, servicio central de dispositivos o POS autorizado según la operación.

## Actores secundarios

- tenant;
- empresa;
- sucursal;
- dispositivo;
- servicio de licencias;
- servicio de activación;
- servicio de identidad;
- sistema de auditoría;
- sistema de observabilidad;
- soporte autorizado.

## Precondiciones

- El tenant está identificado.
- La empresa está identificada cuando la operación lo requiere.
- La sucursal está identificada cuando aplica.
- Existe una política vigente de registro y confianza de dispositivos.
- El sistema dispone de material criptográfico confiable para validar artefactos firmados cuando corresponda.
- El dispositivo dispone de `installation_id` para una instalación concreta.
- Cuando se requiere identidad criptográfica, el dispositivo dispone de una clave propia o inicia el flujo para crearla.
- Las operaciones administrativas sensibles requieren actor autorizado.
- Una licencia, activación o sesión de usuario no sustituyen la identidad del dispositivo.

## Entrada

Según la operación:

- `tenant_id`;
- `company_id`;
- `branch_id` opcional;
- `device_id` opcional;
- `installation_id`;
- `device_key_id` opcional;
- `public_key` opcional;
- `app_version`;
- `operating_system`;
- `device_type`;
- `device_evidence_hash` opcional;
- `proof_of_possession` opcional;
- `activation_reference` opcional;
- `license_reference` opcional;
- `operation_context`;
- `correlation_id`;
- `requested_action`;
- `reason` opcional;
- `connectivity_status`;
- `local_time_evidence` opcional;
- `current_device_status` opcional;
- `current_trust_status` opcional;
- `asset_ownership_mode` opcional;
- `management_mode` opcional.

## Principios del caso de uso

1. `device_id` identifica una identidad operativa global y no se reutiliza.
2. `installation_id` identifica una instalación concreta.
3. Una reinstalación limpia genera un nuevo `installation_id`.
4. La identidad del dispositivo no depende exclusivamente de hardware.
5. La evidencia de hardware es secundaria y no constituye identidad principal.
6. La misma clave privada no se comparte entre dispositivos.
7. La clave privada no se transmite al servidor.
8. Una clave revocada o comprometida no autentica nuevas operaciones.
9. Un dispositivo revocado no recupera confianza sin autorización explícita.
10. Un cambio menor de hardware no produce revocación automática.
11. Una activación no amplía derechos contractuales.
12. La recuperación conserva trazabilidad y no crea una identidad privilegiada.
13. La revocación o desactivación no elimina datos comerciales.
14. La ausencia de conectividad no equivale a desinstalación.
15. La ausencia prolongada de actividad no equivale por sí sola a revocación.
16. `UNINSTALL_CONFIRMED` requiere evidencia explícita del proceso de desinstalación.
17. Las acciones administrativas críticas deben quedar auditadas.
18. Los cambios de estado deben usar códigos estables y no depender de mensajes libres.
19. La propiedad del hardware y la modalidad de licencia se modelan de forma independiente.
20. El control administrativo del POS no implica control general del sistema operativo del cliente.

## Flujo principal

1. El sistema recibe una solicitud para registrar, aprobar, vincular, actualizar estado, recuperar, reemplazar, revocar o desactivar un dispositivo.
2. Valida identidad del tenant, empresa y sucursal cuando corresponda.
3. Valida actor, permisos y alcance administrativo.
4. Valida `installation_id` y la identidad criptográfica disponible.
5. Verifica prueba de posesión cuando la operación la requiere.
6. Evalúa evidencia de hardware únicamente como señal secundaria.
7. Determina si existe un `device_id` previamente autorizado para esa identidad.
8. Evalúa estado operativo, estado de confianza, activación y revocaciones conocidas.
9. Aplica la transición de estado permitida por la política vigente.
10. Conserva identidad, causalidad, versionado e idempotencia.
11. Registra auditoría de la operación crítica.
12. Emite eventos o señales operativas para observabilidad futura cuando corresponda.
13. Devuelve el estado resultante, identificadores afectados y código estable de decisión.

## Registro inicial

El registro inicial crea o solicita una identidad operativa para una instalación que todavía no dispone de un dispositivo autorizado.

Flujo:

1. El POS genera un `installation_id` único para la instalación actual.
2. Genera una clave criptográfica propia cuando la política la requiere.
3. La clave privada permanece protegida localmente.
4. El POS prepara la clave pública o referencia verificable.
5. Genera una prueba de posesión vinculada a la solicitud.
6. Captura únicamente la evidencia de hardware permitida por la política.
7. Incluye `tenant_id`, `company_id`, `branch_id` cuando aplique, versión de aplicación y sistema operativo.
8. Genera `idempotency_key` y `correlation_id`.
9. Envía la solicitud al servicio autorizado cuando existe conectividad.
10. El servicio central valida estructura, identidad, prueba de posesión, límites, política y duplicados.
11. Si la solicitud es admisible, crea o reserva un `device_id`.
12. El dispositivo queda en estado pendiente de aprobación cuando la política exige aprobación humana o administrativa.
13. Si la política permite aprobación automática bajo condiciones explícitas, se continúa con el vínculo autorizado.
14. El registro queda auditado.

Reglas:

1. Repetir la misma solicitud idempotente no crea varios dispositivos.
2. Una clave pública ya vinculada a otro dispositivo no se reutiliza sin flujo de recuperación o migración autorizado.
3. Un `installation_id` no identifica por sí solo una licencia.
4. El registro de dispositivo no crea derechos contractuales.
5. La evidencia de hardware no sustituye prueba de posesión.
6. Un registro rechazado no elimina evidencia necesaria para diagnóstico o auditoría.
7. La ausencia de conectividad no autoriza por sí sola un nuevo dispositivo.

## Aprobación y vínculo

La aprobación convierte una solicitud válida en una identidad de dispositivo autorizada dentro del alcance permitido.

El vínculo puede asociar:

- tenant;
- empresa;
- sucursal;
- dispositivo;
- instalación;
- clave de dispositivo;
- activación;
- política vigente.

Flujo:

1. El sistema carga la solicitud pendiente.
2. Verifica que no esté vencida, cancelada, revocada o ya resuelta.
3. Verifica el tenant y el alcance administrativo.
4. Verifica límites de dispositivos y restricciones contractuales aplicables.
5. Verifica prueba de posesión.
6. Evalúa señales de riesgo de hardware, reinstalación o posible clonación.
7. Verifica que la clave del dispositivo no esté revocada o comprometida.
8. Determina la empresa y sucursal autorizadas.
9. Asocia el `device_id` con la instalación y la clave correspondiente.
10. Registra o actualiza la activación cuando ese proceso corresponde al servicio de licencias.
11. Establece el estado operativo y de confianza inicial permitido.
12. Registra actor, motivo, política y contexto.
13. Emite evidencia verificable de la aprobación.
14. Audita la operación.

Reglas:

1. La aprobación de un dispositivo no amplía los derechos de la licencia.
2. El actor que aprueba debe tener alcance sobre el tenant afectado.
3. Un dispositivo no puede quedar vinculado accidentalmente a dos tenants.
4. Un vínculo de sucursal no puede ampliar el alcance autorizado por empresa o tenant.
5. Una aprobación manual debe conservar actor y motivo.
6. Una aprobación automática debe conservar la política y versión que la autorizó.
7. Una solicitud con evidencia de clonación no se aprueba automáticamente.
8. Una clave comprometida produce rechazo o revisión reforzada.
9. Un dispositivo previamente revocado no se reactiva mediante un nuevo vínculo ordinario.
10. Toda aprobación queda versionada y auditada.

## Operación conectada

Cuando el dispositivo dispone de conectividad:

1. El dispositivo presenta su identidad operativa.
2. Demuestra posesión de la clave cuando la operación lo requiere.
3. El servicio central valida tenant, dispositivo, instalación, activación y revocaciones conocidas.
4. Actualiza `last_seen_at` únicamente después de una comunicación válida.
5. Actualiza `last_sync_at` cuando existe una sincronización confirmada.
6. Evalúa versión de aplicación, estado operativo y estado de confianza.
7. Procesa cambios de política o revocaciones más recientes.
8. Registra anomalías sin ocultarlas.
9. Actualiza de forma idempotente el estado conocido del dispositivo.
10. Devuelve la política efectiva y las acciones requeridas.

Reglas:

1. Recibir tráfico no significa automáticamente que el dispositivo sea confiable.
2. Un heartbeat inválido no actualiza `last_seen_at`.
3. Un dispositivo revocado puede reportar estado, pero no recupera autorización por comunicarse.
4. Una secuencia central más reciente prevalece sobre una copia local antigua.
5. El servicio central no utiliza solamente timestamps para resolver autoridad.
6. Una actualización de estado técnico no modifica por sí sola derechos de licencia.

## Operación offline

Cuando el dispositivo no dispone de conectividad:

1. El POS utiliza únicamente identidad, activaciones, claves, políticas y revocaciones verificables disponibles localmente.
2. Conserva operaciones autorizadas mediante la política local-first aplicable.
3. Registra localmente eventos relevantes para sincronización posterior.
4. Conserva `operation_id`, `correlation_id` e idempotencia.
5. No declara nuevo estado central que no pueda verificar.
6. No crea una activación nueva por ausencia de conectividad.
7. No modifica localmente revocaciones conocidas.
8. No reinicia gracia, confianza ni vínculo de dispositivo.
9. Al recuperar conectividad, sincroniza evidencia y operaciones pendientes.
10. Las discrepancias pasan por el mecanismo de autoridad definido para el dominio afectado.

Reglas:

1. `OFFLINE` es un estado de conectividad, no una revocación.
2. La ausencia de Internet no equivale a desinstalación.
3. La operación offline no amplía permisos ni derechos.
4. La instalación conserva su identidad durante el periodo offline.
5. Una revocación conocida localmente sigue siendo efectiva.
6. El POS no inventa `last_seen_at` central.
7. La sincronización posterior no debe aplicar dos veces una operación ya aceptada.

## Heartbeat y actividad del dispositivo

El sistema puede recibir señales periódicas de actividad para conocer el estado técnico de una instalación administrada.

Un heartbeat puede incluir:

- `tenant_id`;
- `device_id`;
- `installation_id`;
- `app_version`;
- `operating_system`;
- `connectivity_status`;
- `sync_status`;
- `outbox_depth`;
- `last_successful_sync_at` opcional;
- `device_clock_quality` opcional;
- `health_status`;
- `correlation_id`;
- evidencia mínima permitida por la política.

Reglas:

1. El heartbeat no contiene secretos.
2. El heartbeat no contiene información personal ajena al POS.
3. El heartbeat no contiene historial general del sistema operativo.
4. El heartbeat debe autenticarse mediante la identidad del dispositivo cuando corresponda.
5. Un heartbeat aceptado actualiza `last_seen_at`.
6. `last_sync_at` solo se actualiza cuando existe sincronización confirmada.
7. La ausencia de heartbeat no confirma desinstalación.
8. Los intervalos y umbrales se definen mediante política versionada.
9. Los heartbeats repetidos son idempotentes respecto al estado observable.
10. La telemetría de actividad no sustituye auditoría.

## Estado operativo del dispositivo

El estado operativo describe disponibilidad y condición técnica, no confianza criptográfica.

Valores conceptuales:

- `ACTIVE`;
- `OFFLINE`;
- `STALE`;
- `UNREACHABLE`;
- `DEGRADED`;
- `DEACTIVATED`;
- `REVIEW_REQUIRED`.

Interpretación:

### `ACTIVE`

Existe actividad válida reciente y no se conoce una condición técnica que impida su operación.

### `OFFLINE`

El dispositivo se encuentra sin conectividad conocida durante un periodo compatible con operación local autorizada.

### `STALE`

El sistema central no recibe actividad válida dentro del umbral configurado, pero no existe evidencia suficiente para concluir desinstalación, abandono o daño.

### `UNREACHABLE`

El sistema no logra establecer comunicación esperada después de superar la política de reintentos o disponibilidad definida.

### `DEGRADED`

El dispositivo opera con una condición técnica que requiere atención pero no implica revocación automática.

Ejemplos:

- versión próxima a quedar fuera de soporte;
- sincronización persistentemente atrasada;
- reloj degradado;
- evidencia de hardware modificada;
- errores repetidos no críticos.

### `DEACTIVATED`

La identidad operativa fue retirada administrativamente sin implicar eliminación de sus datos históricos.

### `REVIEW_REQUIRED`

Existe una condición ambigua o sensible que requiere revisión humana o una política reforzada.

## Relación entre estado operativo y confianza

El estado operativo y `trust_status` se evalúan por separado.

Ejemplos válidos:

- `OFFLINE` + `TRUSTED`;
- `ACTIVE` + `DEGRADED`;
- `STALE` + `TRUSTED`;
- `ACTIVE` + `REVIEW_REQUIRED`;
- `DEACTIVATED` + `REVOKED`.

Reglas:

1. `OFFLINE` no significa `UNTRUSTED`.
2. `STALE` no significa `REVOKED`.
3. `UNREACHABLE` no significa `UNINSTALL_CONFIRMED`.
4. `ACTIVE` no significa automáticamente `TRUSTED`.
5. `REVOKED` es una decisión de confianza o autorización y no un fallo de conectividad.
6. Una transición técnica no debe ampliar permisos.

## Alertas administrativas

El sistema debe generar alertas administrativas cuando una condición de dispositivo requiera atención del propietario de la plataforma, del tenant o de soporte autorizado.

Alertas conceptuales:

- `DEVICE_OFFLINE`;
- `DEVICE_STALE`;
- `DEVICE_UNREACHABLE`;
- `DEVICE_DEGRADED`;
- `DEVICE_TRUST_DEGRADED`;
- `DEVICE_REVIEW_REQUIRED`;
- `DEVICE_REVOKED`;
- `SUSPICIOUS_REINSTALLATION`;
- `SUSPICIOUS_HARDWARE_CHANGE`;
- `DEVICE_KEY_COMPROMISED`;
- `DEVICE_REPLACEMENT_REQUIRED`;
- `UNINSTALL_CONFIRMED`.

Reglas:

1. Una alerta no cambia automáticamente la licencia.
2. Una alerta no elimina datos.
3. Una alerta conserva `tenant_id`, `device_id`, causa, severidad y momento de detección.
4. Una alerta administrativa puede requerir reconocimiento o resolución.
5. Las alertas repetidas deben deduplicarse o correlacionarse.
6. La ausencia prolongada de actividad genera una alerta de estado, no una afirmación de desinstalación.
7. `UNINSTALL_CONFIRMED` solo se genera cuando existe evidencia explícita y verificable del proceso de desinstalación.
8. Una reinstalación inesperada puede producir `SUSPICIOUS_REINSTALLATION`, pero no revocación irreversible por sí sola.
9. Las acciones tomadas desde una alerta crítica deben auditarse.
10. Las alertas deben poder exponerse posteriormente al panel administrativo sin depender del proveedor de observabilidad.

## Cambio de hardware

Un cambio de hardware modifica evidencia secundaria del dispositivo, pero no necesariamente su identidad operativa.

Flujo:

1. El dispositivo reporta nueva evidencia permitida por la política.
2. El sistema compara la evidencia actual con la evidencia anterior.
3. Clasifica el cambio.
4. Evalúa riesgo.
5. Conserva la evidencia anterior para auditoría.
6. Determina si el dispositivo puede continuar, operar degradado o pasar a revisión.
7. Actualiza `trust_status` únicamente cuando la política lo justifica.
8. Registra la causa y la política aplicada.

Clasificaciones conceptuales:

- `EXPECTED_CHANGE`;
- `MINOR_CHANGE`;
- `MAJOR_CHANGE`;
- `SUSPICIOUS_CHANGE`;
- `UNKNOWN_CHANGE`.

Reglas:

1. Un único cambio de hardware no produce revocación irreversible.
2. Un cambio menor puede conservar `device_id`.
3. Un cambio mayor puede requerir nueva prueba de posesión.
4. Un cambio sospechoso puede producir `DEGRADED` o `REVIEW_REQUIRED`.
5. La evidencia de hardware no reemplaza la clave del dispositivo.
6. La identidad no se recalcula mediante una huella física mutable.
7. La política debe permitir distinguir mantenimiento legítimo de posible clonación.
8. Toda decisión sensible queda auditada.

## Reinstalación

Una reinstalación limpia representa una instalación nueva de la aplicación.

Flujo:

1. La nueva instalación genera un `installation_id` distinto.
2. Genera una nueva clave de dispositivo cuando la clave anterior no se conserva de forma segura.
3. El sistema detecta que existe un dispositivo o activación previa relacionada cuando dispone de evidencia suficiente.
4. Evalúa si corresponde recuperación, reemplazo, nueva activación o revisión.
5. No reutiliza automáticamente una activación antigua.
6. No reinicia gracia, deuda, estado contractual ni revocaciones.
7. No copia automáticamente una clave privada anterior.
8. Registra la nueva instalación.
9. Conserva vínculo histórico con la instalación previa cuando exista una relación legítima.
10. Audita la operación.

Reglas:

1. `installation_id` anterior no se reutiliza.
2. Una reinstalación no genera una licencia nueva.
3. Una reinstalación no elimina deuda.
4. Una reinstalación no elimina restricciones.
5. Una reinstalación no revive dispositivos revocados.
6. Una reinstalación inesperada puede generar `SUSPICIOUS_REINSTALLATION`.
7. La recuperación legítima requiere controles explícitos.
8. Restaurar una imagen o backup no debe permitir replay de una activación antigua.

## Pérdida de clave

La pérdida de la clave privada del dispositivo impide demostrar posesión mediante la identidad criptográfica anterior.

Flujo:

1. El dispositivo o administrador reporta pérdida de clave.
2. El sistema identifica el dispositivo afectado.
3. Verifica actor, tenant y alcance administrativo.
4. Determina si la clave anterior puede probar posesión todavía.
5. Si la clave anterior está disponible, inicia recuperación reforzada con prueba de posesión.
6. Si la clave anterior no está disponible, exige recuperación sin clave anterior.
7. Genera una nueva clave de dispositivo cuando corresponde.
8. Revoca, retira o marca la clave anterior según su estado.
9. Conserva trazabilidad entre clave anterior y nueva.
10. Audita la recuperación.

Reglas:

1. La pérdida de clave no elimina el dispositivo automáticamente.
2. Una clave perdida no se marca `ACTIVE` por conveniencia.
3. La nueva clave no hereda privilegios fuera de la autorización existente.
4. La recuperación sin clave anterior requiere controles reforzados.
5. Una clave comprometida debe tratarse de forma más restrictiva que una clave simplemente perdida.
6. La rotación conserva historial.

## Revocación

La revocación desautoriza una identidad, clave, activación o dispositivo según el alcance de la decisión.

Motivos conceptuales:

- compromiso de clave;
- clonación confirmada;
- fraude;
- equipo perdido;
- reemplazo;
- finalización administrativa;
- violación de política;
- orden de seguridad;
- incidente confirmado.

Flujo:

1. Un actor autorizado solicita revocación.
2. El sistema valida actor, tenant, alcance y motivo.
3. Identifica exactamente el objeto a revocar.
4. Registra secuencia y causalidad.
5. Cambia el estado correspondiente.
6. Publica la revocación para los componentes que deban conocerla.
7. Conserva la revocación para operación offline cuando aplique.
8. No elimina datos comerciales.
9. No elimina auditoría.
10. Notifica o marca para revisión cuando corresponda.

Reglas:

1. Una revocación debe tener identidad propia.
2. Una revocación no se elimina mediante una operación ordinaria.
3. Un dispositivo revocado no recupera confianza automáticamente.
4. Una clave revocada no autentica nuevas operaciones.
5. Una revocación no debe confundirse con `OFFLINE`, `STALE` o `UNREACHABLE`.
6. Una revocación conocida localmente sigue siendo efectiva sin conectividad.
7. La reactivación requiere flujo explícito cuando la política la permita.
8. La revocación conserva motivo, actor y momento efectivo.

## Recuperación

La recuperación permite restaurar operación legítima sin borrar historia ni ampliar derechos.

Escenarios:

- reinstalación legítima;
- pérdida de clave;
- daño del equipo;
- cambio mayor de hardware;
- reemplazo;
- recuperación administrativa;
- incidente de seguridad resuelto.

Flujo:

1. El sistema identifica la identidad previa.
2. Determina si existe posesión de la clave anterior.
3. Verifica actor, tenant y autorización.
4. Evalúa estado de licencia y activación.
5. Evalúa revocaciones conocidas.
6. Evalúa riesgo del dispositivo o instalación nueva.
7. Crea nueva clave, instalación o activación únicamente cuando corresponda.
8. Vincula históricamente la identidad anterior con la nueva.
9. Retira o revoca credenciales anteriores cuando sea necesario.
10. Conserva auditoría y causalidad.
11. Devuelve el estado resultante sin ampliar derechos.

Reglas:

1. Recuperar no significa reactivar automáticamente.
2. Recuperar no elimina deuda ni restricciones comerciales.
3. Recuperar no borra revocaciones anteriores.
4. Una recuperación sin clave anterior exige mayor validación.
5. El soporte no puede saltarse controles criptográficos sin política explícita.
6. Toda recuperación queda auditada.

## Reemplazo de dispositivo

El reemplazo transfiere la operación autorizada hacia una nueva identidad o instalación según la política vigente.

Flujo:

1. El administrador o servicio autorizado identifica el dispositivo anterior.
2. Verifica motivo de reemplazo.
3. Evalúa estado contractual y límites.
4. Determina si el dispositivo anterior debe revocarse, desactivarse o quedar histórico.
5. Registra el nuevo dispositivo.
6. Genera o registra una nueva clave.
7. Crea un nuevo vínculo de instalación.
8. Gestiona la activación correspondiente.
9. Vincula `replacement_device_id` o relación equivalente.
10. Conserva la historia del dispositivo anterior.
11. Audita la operación.

Reglas:

1. El `device_id` anterior no se reutiliza.
2. La clave privada anterior no se copia.
3. Reemplazar dispositivo no amplía límites.
4. El dispositivo anterior no queda activo por accidente.
5. Si existen operaciones pendientes, deben conservarse y reconciliarse.
6. El reemplazo no elimina ventas, pagos, caja, inventario ni auditoría.
7. El nuevo dispositivo debe superar las validaciones vigentes.

## Desactivación

La desactivación retira administrativamente un dispositivo de operación sin asumir necesariamente compromiso de seguridad.

Motivos posibles:

- cierre de sucursal;
- reemplazo planificado;
- equipo fuera de servicio;
- finalización de uso;
- reorganización del tenant.

Reglas:

1. `DEACTIVATED` no equivale necesariamente a `REVOKED`.
2. La desactivación conserva historia.
3. La reactivación, si está permitida, debe ser explícita.
4. Un dispositivo desactivado no crea nuevas operaciones autorizadas.
5. Las operaciones ya confirmadas permanecen intactas.
6. La desactivación queda auditada.

## Desinstalación confirmada

La desinstalación confirmada representa evidencia explícita de que la aplicación fue removida mediante un flujo controlado o mediante evidencia verificable suficiente.

Posibles fuentes de evidencia:

- evento firmado emitido por el desinstalador;
- proceso de desactivación previo;
- confirmación administrativa;
- señal técnica verificable definida por política.

Reglas:

1. La ausencia de heartbeat no confirma desinstalación.
2. `STALE` no confirma desinstalación.
3. `UNREACHABLE` no confirma desinstalación.
4. Una desinstalación confirmada no elimina licencia, deuda ni historial.
5. El sistema puede generar `UNINSTALL_CONFIRMED`.
6. La desinstalación puede iniciar revisión administrativa.
7. La desinstalación no impide al propietario del equipo instalar otros programas.
8. El control del POS no se extiende al control general del sistema operativo.
9. Si el equipo es administrado o arrendado, se aplican únicamente las políticas contractuales específicas de ese activo.
10. Toda evidencia de desinstalación queda auditada.

## Modalidad del activo y administración

La propiedad física del equipo y la modalidad del software se modelan de forma independiente.

Valores conceptuales de `asset_ownership_mode`:

- `CUSTOMER_OWNED`;
- `PROVIDER_OWNED`;
- `LEASED`;
- `MANAGED_ASSET`.

Valores conceptuales de `management_mode`:

- `SOFTWARE_ONLY`;
- `SOFTWARE_MANAGED`;
- `DEVICE_MANAGED`;
- `KIOSK_MANAGED`.

Interpretación:

### `CUSTOMER_OWNED`

El equipo pertenece al cliente.

El sistema puede administrar únicamente el POS y los componentes expresamente contratados.

No autoriza control general del sistema operativo ni bloqueo de software de terceros.

### `PROVIDER_OWNED`

El equipo pertenece al proveedor del POS.

Las políticas de administración del activo dependen del contrato vigente.

### `LEASED`

El equipo se encuentra bajo arrendamiento.

Puede existir administración reforzada siempre que esté definida contractualmente.

### `MANAGED_ASSET`

El dispositivo es administrado técnicamente por el proveedor bajo una política explícita.

Puede incluir:

- configuración controlada;
- actualizaciones administradas;
- inventario del activo;
- mantenimiento;
- monitoreo técnico;
- restricciones de operación acordadas;
- modo kiosco cuando aplique.

Reglas:

1. La modalidad del activo no amplía derechos de licencia.
2. La propiedad del equipo no modifica por sí sola el `trust_status`.
3. `SOFTWARE_ONLY` no permite administrar el sistema operativo del cliente.
4. `DEVICE_MANAGED` y `KIOSK_MANAGED` requieren consentimiento y contrato explícito.
5. La administración del dispositivo debe respetar aislamiento por tenant.
6. Las políticas de administración deben estar versionadas.
7. Toda acción remota sensible debe quedar auditada.
8. Un equipo vendido al cliente no puede bloquearse para impedir la instalación de software de terceros.
9. Un equipo arrendado o administrado puede aplicar únicamente las restricciones previstas contractualmente.
10. La terminación del contrato debe definir el proceso de desadministración del activo.

## Salida

El caso de uso devuelve una respuesta estructurada que puede incluir:

- `device_id`;
- `installation_id`;
- `device_key_id` opcional;
- `tenant_id`;
- `company_id`;
- `branch_id` opcional;
- `device_status`;
- `trust_status`;
- `activation_status` opcional;
- `asset_ownership_mode`;
- `management_mode`;
- `last_seen_at` opcional;
- `last_sync_at` opcional;
- `required_action` opcional;
- `alert_codes`;
- `decision_code`;
- `policy_version`;
- `correlation_id`;
- `effective_at`.

La salida no debe incluir:

- claves privadas;
- secretos;
- tokens reutilizables;
- información personal ajena al propósito operativo;
- datos sensibles de otros tenants.

## Flujos alternos

### Tenant inválido

1. La operación se rechaza.
2. No se crea ni modifica el dispositivo.
3. Se devuelve un código estable.
4. El intento sensible queda auditado.

### Actor sin autorización

1. La operación se rechaza.
2. No se aplica transición de estado.
3. Se registra intento no autorizado cuando corresponda.
4. No se revelan datos fuera del alcance del actor.

### Prueba de posesión inválida

1. La identidad no se considera demostrada.
2. No se registra nueva clave como activa.
3. La operación se rechaza o pasa a revisión.
4. Se conserva evidencia mínima para diagnóstico.

### Clave comprometida

1. La clave queda en estado `COMPROMISED` o equivalente.
2. No autentica nuevas operaciones.
3. Se genera alerta crítica.
4. Puede iniciarse recuperación reforzada.
5. La decisión queda auditada.

### Clonación sospechada

1. El sistema no revoca automáticamente solo por una señal secundaria.
2. Evalúa prueba de posesión, instalación, hardware evidence y actividad concurrente.
3. Puede establecer `REVIEW_REQUIRED`.
4. Puede restringir operaciones sensibles según política.
5. Genera `SUSPICIOUS_REINSTALLATION` o alerta equivalente cuando corresponda.

### Clonación confirmada

1. Se identifica la credencial comprometida.
2. Se revoca la identidad o clave afectada según alcance.
3. Se preservan datos.
4. Se inicia recuperación o reemplazo cuando corresponda.
5. Se audita el incidente.

### Instalación ya vinculada

1. Se verifica si corresponde al mismo `device_id`.
2. Si la solicitud es idempotente, devuelve el resultado existente.
3. Si existe conflicto, no crea una identidad paralela.
4. Se genera código de conflicto estable.

### Límite de dispositivos alcanzado

1. No se amplía el límite automáticamente.
2. La solicitud queda rechazada o pendiente de acción administrativa.
3. Se informa la capacidad contractual afectada.
4. Puede requerirse reemplazo o ampliación de licencia.

### Dispositivo revocado intenta operar

1. No recupera confianza.
2. No se autoriza mediante un flujo ordinario.
3. Puede permitirse únicamente comunicación técnica mínima necesaria para informar estado o iniciar recuperación controlada.
4. Se registra el intento.

### Dispositivo `STALE` vuelve a conectarse

1. Se autentica nuevamente.
2. Se valida clave, instalación y revocaciones.
3. Se actualiza `last_seen_at` solo después de validación.
4. No recupera automáticamente confianza degradada.
5. Sincroniza operaciones pendientes según `DEC-007`.

### Reemplazo con operaciones pendientes

1. Las operaciones confirmadas no se eliminan.
2. Se preserva Outbox/Inbox y causalidad.
3. Se determina qué operaciones deben completarse desde la instalación anterior.
4. El nuevo dispositivo no duplica efectos ya confirmados.
5. Los conflictos pasan a reconciliación.

### Evidencia de desinstalación no verificable

1. No se usa `UNINSTALL_CONFIRMED`.
2. El dispositivo puede quedar `STALE`, `UNREACHABLE` o `REVIEW_REQUIRED`.
3. Se genera alerta administrativa.
4. No se modifican licencia ni deuda automáticamente.

## Puntos de auditoría

Deben auditarse como mínimo:

- registro de dispositivo;
- aprobación;
- rechazo administrativo;
- vínculo a tenant;
- vínculo a empresa;
- vínculo a sucursal;
- cambio de clave;
- rotación;
- pérdida de clave;
- compromiso de clave;
- cambio mayor de hardware;
- degradación de confianza;
- revocación;
- recuperación;
- reemplazo;
- desactivación;
- reactivación;
- cambio de modalidad de administración;
- desinstalación confirmada;
- acción administrativa remota sensible.

Cada evento auditable debe conservar cuando corresponda:

- `tenant_id`;
- `actor_id`;
- `actor_type`;
- `device_id`;
- `installation_id`;
- `action`;
- estado anterior;
- estado nuevo;
- motivo;
- `correlation_id`;
- fecha efectiva;
- política aplicada.

La auditoría es distinta del logging técnico.

## Puntos de observabilidad futura

Este caso de uso define puntos semánticos de instrumentación, pero no depende de SDKs ni adaptadores concretos.

Eventos conceptuales:

- `DEVICE_REGISTRATION_STARTED`;
- `DEVICE_REGISTRATION_COMPLETED`;
- `DEVICE_REGISTRATION_REJECTED`;
- `DEVICE_APPROVED`;
- `DEVICE_HEARTBEAT_ACCEPTED`;
- `DEVICE_HEARTBEAT_REJECTED`;
- `DEVICE_BECAME_STALE`;
- `DEVICE_BECAME_UNREACHABLE`;
- `DEVICE_TRUST_DEGRADED`;
- `DEVICE_KEY_COMPROMISED`;
- `DEVICE_REVOKED`;
- `DEVICE_RECOVERY_STARTED`;
- `DEVICE_RECOVERY_COMPLETED`;
- `DEVICE_REPLACED`;
- `DEVICE_DEACTIVATED`;
- `UNINSTALL_CONFIRMED`.

Métricas conceptuales futuras:

- dispositivos registrados;
- registros rechazados;
- dispositivos activos;
- dispositivos `STALE`;
- dispositivos `UNREACHABLE`;
- fallos de heartbeat;
- recuperaciones;
- revocaciones;
- reinstalaciones sospechosas;
- reemplazos;
- latencia de registro y validación.

Reglas:

1. El dominio no importa OpenTelemetry, Prometheus, Grafana, Sentry ni librerías equivalentes.
2. Los casos de uso utilizan puertos cuando dichos contratos sean implementados.
3. `tenant_id` y `correlation_id` deben propagarse en operaciones multi-tenant.
4. Los identificadores de alta cardinalidad no deben usarse indiscriminadamente como labels de métricas.
5. Fallar logging o métricas no debe modificar el resultado de negocio.
6. La auditoría crítica puede requerir garantías más fuertes según la operación.
7. No se registran secretos ni claves privadas.
8. La observabilidad no sustituye autorización ni auditoría.

## Pruebas mínimas

El diseño debe permitir verificar como mínimo:

1. registro inicial válido;
2. registro idempotente repetido;
3. tenant incorrecto;
4. actor sin autorización;
5. prueba de posesión válida;
6. prueba de posesión inválida;
7. clave ya vinculada;
8. clave comprometida;
9. aprobación manual;
10. aprobación automática autorizada;
11. límite de dispositivos alcanzado;
12. operación conectada;
13. operación offline autorizada;
14. heartbeat válido;
15. heartbeat inválido;
16. transición a `STALE`;
17. transición a `UNREACHABLE`;
18. retorno de `STALE` a actividad válida;
19. cambio menor de hardware;
20. cambio mayor de hardware;
21. cambio sospechoso de hardware;
22. reinstalación legítima;
23. reinstalación sospechosa;
24. restauración de backup con activación antigua;
25. pérdida de clave;
26. recuperación con clave anterior;
27. recuperación sin clave anterior;
28. revocación;
29. operación desde dispositivo revocado;
30. reemplazo de dispositivo;
31. reemplazo con operaciones pendientes;
32. desactivación;
33. reactivación permitida;
34. ausencia prolongada de heartbeat;
35. desinstalación confirmada;
36. ausencia de evidencia suficiente para confirmar desinstalación;
37. equipo `CUSTOMER_OWNED`;
38. equipo `LEASED`;
39. equipo `DEVICE_MANAGED`;
40. aislamiento entre tenants;
41. preservación de auditoría;
42. preservación de operaciones confirmadas;
43. no reutilización de `device_id`;
44. nueva instalación genera nuevo `installation_id`;
45. revocación conocida durante operación offline;
46. observabilidad futura no altera el resultado del caso de uso.

## Documentos normativos relacionados

- `docs/adr/DEC-007-local-first-data-authority.md`;
- `docs/adr/DEC-008-device-trust-license-activation.md`;
- `docs/architecture/conceptual-data-model.md`;
- `docs/architecture/security-model.md`;
- `docs/domain/business-rules.md`;
- `docs/domain/glossary.md`;
- `docs/use-cases/licensing/UC-LIC-001-validate-license.md`.
# UC-DEV-002: Consolidar identidad segura del POS y contrato operativo con licencias

## Objetivo

Definir el contrato operativo que relaciona de forma segura y verificable la identidad del POS, su instalación, su clave criptográfica, su activación y la licencia aplicable.

Este caso de uso no emite licencias, no registra dispositivos desde cero y no sustituye los casos de uso `UC-DEV-001`, `UC-LIC-001` ni `UC-LIC-002`.

Su responsabilidad es consolidar cómo se demuestra y evalúa que una instalación concreta del POS está autorizada para ejecutar capacidades determinadas bajo una licencia vigente.

## Actor principal

POS autorizado o servicio central de autorización.

## Actores secundarios

- tenant;
- dispositivo;
- instalación;
- servicio de dispositivos;
- servicio de licencias;
- servicio de activación;
- sistema de auditoría;
- sistema de observabilidad;
- soporte autorizado.

## Precondiciones

- El tenant está identificado.
- Existe un `device_id` registrado o una identidad de dispositivo previamente aprobada.
- Existe un `installation_id` correspondiente a la instalación actual.
- Existe una identidad criptográfica del dispositivo cuando la operación la requiere.
- Existe una licencia aplicable.
- Existe una activación cuando la capacidad requiere vínculo explícito licencia-dispositivo-instalación.
- El sistema dispone de material confiable para verificar firmas.
- Las revocaciones conocidas están disponibles según la política conectada u offline aplicable.
- El caso de uso se ejecuta dentro de un contexto con `correlation_id`.

## Entrada

Según la operación:

- `tenant_id`;
- `device_id`;
- `installation_id`;
- `device_key_id` opcional;
- `license_id`;
- `activation_id` opcional;
- `requested_feature`;
- `app_version`;
- `connectivity_status`;
- `operation_context`;
- `correlation_id`;
- `local_time_evidence` opcional;
- `proof_of_possession` opcional;
- `license_payload`;
- `activation_payload` opcional;
- `known_revocations` opcional;
- `policy_version`.

## Principios del contrato

1. `device_id`, `installation_id`, `device_key_id`, `activation_id` y `license_id` representan conceptos distintos.
2. Ninguno de estos identificadores puede sustituir a los demás.
3. La identidad del dispositivo no depende exclusivamente de hardware.
4. La instalación identifica una instancia concreta de la aplicación.
5. La clave del dispositivo demuestra posesión cuando corresponde, pero no contiene derechos contractuales.
6. La activación vincula una licencia con un dispositivo y una instalación.
7. Una activación no amplía derechos.
8. La licencia define derechos contractuales y límites.
9. Los entitlements determinan capacidades dentro del alcance de la licencia.
10. La sesión del usuario y sus permisos se evalúan por separado.
11. La falta de conectividad no crea identidad, activación ni licencia.
12. Una reinstalación no revive automáticamente una activación anterior.
13. Una revocación conocida prevalece sobre una copia local antigua.
14. El cliente no puede autoemitirse derechos, activaciones ni confianza.
15. La autorización efectiva debe ser verificable, determinista y auditable.

## Cadena de confianza operativa

La autorización del POS se construye mediante una cadena verificable de relaciones y decisiones.

Cadena conceptual:

1. `tenant_id` identifica el ámbito multi-tenant.
2. `device_id` identifica la identidad operativa autorizada.
3. `installation_id` identifica la instalación concreta.
4. `device_key_id` identifica la clave utilizada para demostrar posesión.
5. `activation_id` representa el vínculo autorizado entre licencia, dispositivo e instalación.
6. `license_id` identifica el derecho contractual aplicable.
7. Los entitlements determinan capacidades y límites.
8. Las revocaciones conocidas pueden invalidar componentes de la cadena.
9. La política temporal y offline determina si la evidencia disponible sigue siendo utilizable.
10. La decisión efectiva combina todas las dimensiones anteriores.

La cadena no debe reducirse a una única bandera booleana.

## Validación de identidad del POS

Flujo:

1. El sistema valida `tenant_id`.
2. Carga el dispositivo correspondiente.
3. Confirma que el `device_id` pertenece al tenant.
4. Valida `installation_id`.
5. Verifica que la instalación corresponda al dispositivo esperado cuando exista vínculo previo.
6. Verifica `device_key_id` cuando la capacidad requiere prueba criptográfica.
7. Valida prueba de posesión cuando corresponde.
8. Evalúa estado de confianza del dispositivo.
9. Evalúa estado operativo sin confundirlo con confianza.
10. Evalúa revocaciones conocidas.
11. Devuelve una identidad operativa verificable o un código estable de rechazo.

Reglas:

1. Un dispositivo `ACTIVE` no se considera automáticamente confiable.
2. Un dispositivo `STALE` no se considera automáticamente revocado.
3. Un dispositivo `UNREACHABLE` no confirma desinstalación.
4. Una clave desconocida no se acepta por fallback.
5. Una clave revocada no demuestra posesión válida.
6. Una reinstalación genera un nuevo `installation_id`.
7. Una instalación nueva no reutiliza automáticamente una activación anterior.
8. La evidencia de hardware es secundaria.
9. El vínculo con tenant debe validarse antes de evaluar derechos.

## Validación de activación

Flujo:

1. El sistema identifica la activación aplicable.
2. Valida estructura y firma cuando la activación está representada mediante artefacto verificable.
3. Confirma `tenant_id`.
4. Confirma `license_id`.
5. Confirma `device_id`.
6. Confirma `installation_id`.
7. Confirma `device_key_id` cuando corresponda.
8. Evalúa `activation_status`.
9. Evalúa vigencia temporal de la activación.
10. Evalúa revocaciones conocidas.
11. Confirma que la activación no haya sido reemplazada.
12. Devuelve la activación efectiva o código estable de rechazo.

Reglas:

1. Una activación `REVOKED` no se reutiliza.
2. Una activación `REPLACED` no vuelve a ser principal.
3. Una activación expirada no extiende derechos.
4. Una activación suspendida no se trata como activa por estar offline.
5. Una activación no amplía módulos, límites ni vigencia contractual.
6. Una respuesta antigua no prevalece sobre una secuencia autoritativa más reciente.
7. Una activación pertenece a un tenant, licencia, dispositivo e instalación concretos.

## Validación de licencia

Flujo:

1. El sistema valida el artefacto de licencia.
2. Verifica firma y estructura.
3. Confirma emisor y clave confiable.
4. Confirma `tenant_id`.
5. Evalúa `contract_status`.
6. Evalúa vigencia temporal.
7. Evalúa revocaciones conocidas.
8. Evalúa entitlements.
9. Evalúa límites.
10. Evalúa política offline.
11. Evalúa `GraceAuthorization` cuando corresponda.
12. Devuelve la evaluación contractual efectiva.

Reglas:

1. `contract_status` no mezcla vigencia, gracia, revocación ni validez criptográfica.
2. `EXPIRED` es un resultado temporal.
3. `REVOKED` es resultado de una revocación aplicable.
4. `INVALID` es resultado de validación.
5. `RESTRICTED` es una decisión efectiva, no un estado contractual base.
6. Una licencia `PAST_DUE` puede seguir operando únicamente bajo la política autorizada.
7. Una licencia `SUSPENDED` no recupera capacidades sin reactivación explícita.
8. Una licencia `LOCAL_PERPETUAL` no requiere validación permanente por Internet.
9. La modalidad `HYBRID` puede utilizar estado central cuando la política lo requiere.

## Validación conectada

Cuando existe conectividad:

1. El POS valida localmente los artefactos firmados disponibles.
2. Consulta el estado central cuando la política lo requiere.
3. Compara secuencias, versiones y revocaciones.
4. El estado autoritativo más reciente prevalece según la política del dominio.
5. Actualiza caché local de forma atómica.
6. No sobrescribe evidencia histórica necesaria.
7. Recalcula la decisión efectiva.
8. Registra discrepancias.
9. Devuelve el resultado.

Reglas:

1. La conectividad no elimina la validación criptográfica local.
2. Una copia local antigua no prevalece sobre una revocación central más reciente.
3. Una respuesta central inválida no se acepta por conveniencia.
4. La actualización de caché debe ser idempotente.
5. Una venta ya confirmada no se recalcula por un cambio posterior de licencia.

## Validación offline autorizada

Cuando no existe conectividad:

1. El POS utiliza únicamente artefactos verificables disponibles localmente.
2. Valida licencia, activación y dispositivo.
3. Evalúa revocaciones conocidas.
4. Evalúa vigencia y evidencia temporal.
5. Evalúa gracia únicamente si existe `GraceAuthorization`.
6. Evalúa política offline.
7. Evalúa versión de aplicación.
8. Determina las capacidades permitidas.
9. Registra la decisión y anomalías localmente.
10. Sincroniza evidencia cuando vuelva la conectividad.

Reglas:

1. La falta de Internet no crea licencia.
2. La falta de Internet no crea activación.
3. La falta de Internet no crea gracia.
4. La falta de Internet no reactiva un dispositivo o licencia.
5. Una revocación conocida sigue siendo efectiva.
6. Un rollback de reloj no extiende derechos.
7. Una reinstalación no reinicia vigencia o gracia.
8. La operación offline no puede autoemitir nuevos entitlements.

## Resolución de autorización efectiva

La decisión efectiva se calcula combinando:

1. tenant válido;
2. identidad del dispositivo;
3. instalación;
4. prueba de posesión;
5. estado de confianza;
6. estado operativo relevante;
7. activación;
8. licencia;
9. vigencia temporal;
10. entitlements;
11. límites;
12. gracia;
13. revocaciones;
14. política offline;
15. versión de aplicación;
16. contexto de operación.

Resultados conceptuales:

- `ALLOW`;
- `ALLOW_WITH_RESTRICTIONS`;
- `DENY`;
- `REVIEW_REQUIRED`.

Códigos de razón pueden incluir, entre otros:

- `LICENSE_INVALID`;
- `LICENSE_EXPIRED`;
- `LICENSE_REVOKED`;
- `LICENSE_SUSPENDED`;
- `LICENSE_RESTRICTED`;
- `ACTIVATION_MISSING`;
- `ACTIVATION_REVOKED`;
- `ACTIVATION_EXPIRED`;
- `DEVICE_MISMATCH`;
- `INSTALLATION_MISMATCH`;
- `DEVICE_KEY_INVALID`;
- `DEVICE_REVOKED`;
- `DEVICE_REVIEW_REQUIRED`;
- `FEATURE_NOT_ENTITLED`;
- `LIMIT_EXCEEDED`;
- `GRACE_ACTIVE`;
- `GRACE_EXHAUSTED`;
- `CLOCK_ROLLBACK_DETECTED`;
- `OFFLINE_POLICY_DENIED`;
- `APP_VERSION_UNSUPPORTED`.

Reglas:

1. La decisión debe ser determinista para la misma evidencia y política.
2. El mensaje visible no sustituye el código de razón.
3. `ALLOW_WITH_RESTRICTIONS` debe indicar las capacidades efectivamente permitidas.
4. `DENY` no elimina datos ni operaciones confirmadas.
5. `REVIEW_REQUIRED` no equivale automáticamente a revocación.
6. La decisión debe conservar `tenant_id`, `correlation_id`, política y evidencia relevante.

## Salida

El caso de uso devuelve una decisión estructurada que puede incluir:

- `tenant_id`;
- `device_id`;
- `installation_id`;
- `device_key_id` opcional;
- `activation_id` opcional;
- `license_id`;
- `requested_feature`;
- `decision`;
- `reason_code`;
- `effective_entitlements`;
- `effective_limits`;
- `trust_status`;
- `device_status`;
- `activation_status`;
- `contract_status`;
- `grace_status` opcional;
- `offline_decision` opcional;
- `required_action` opcional;
- `policy_version`;
- `correlation_id`;
- `evaluated_at`.

La salida no debe incluir:

- claves privadas;
- secretos;
- tokens reutilizables;
- material criptográfico sensible;
- información de otros tenants;
- datos innecesarios para la decisión.

## Flujos alternos

### Tenant inválido

1. La operación se rechaza.
2. No se evalúan derechos de otro tenant.
3. No se modifica estado.
4. Se devuelve código estable.
5. El intento queda auditado cuando corresponde.

### Dispositivo inexistente

1. No se inventa identidad.
2. No se reutiliza una activación ajena.
3. Puede iniciarse `UC-DEV-001` cuando la política lo permite.
4. La autorización actual se rechaza.

### Instalación diferente

1. Se compara `installation_id`.
2. No se reutiliza automáticamente una activación anterior.
3. Puede tratarse como reinstalación o reemplazo.
4. Puede requerir recuperación o revisión.
5. La operación actual no amplía derechos.

### Clave inválida o desconocida

1. La prueba de posesión falla.
2. La clave no se acepta por fallback.
3. La operación se rechaza o pasa a revisión.
4. Puede iniciarse recuperación reforzada.

### Activación ausente

1. Se determina si la capacidad requiere activación.
2. Si la requiere, se devuelve `ACTIVATION_MISSING`.
3. No se crea una activación automáticamente.
4. Puede iniciarse el flujo autorizado de activación.

### Activación revocada

1. Se devuelve `ACTIVATION_REVOKED`.
2. No se reutiliza la activación.
3. No se amplían derechos.
4. Puede iniciarse reemplazo o recuperación si corresponde.

### Licencia suspendida

1. Se evalúa el alcance permitido.
2. Se aplica la política de restricción vigente.
3. No se revoca automáticamente el dispositivo.
4. No se eliminan datos.
5. Se devuelve código estable.

### Licencia revocada

1. Se aplica `LicenseRevocation`.
2. Se deniega la operación no autorizada.
3. No se eliminan datos.
4. Una copia local antigua no prevalece.

### Licencia expirada

1. Se evalúa vigencia temporal.
2. Se determina si existe `GraceAuthorization`.
3. Si no existe continuidad autorizada, se deniega o restringe según política.
4. No se modifica `contract_status` solo por el cálculo temporal.

### Gracia activa

1. Se valida la autorización de gracia.
2. Se aplican exclusivamente las capacidades permitidas.
3. Se devuelve `GRACE_ACTIVE` o resultado equivalente.
4. La gracia no amplía derechos originales.

### Gracia agotada

1. La autorización de gracia deja de ser aplicable.
2. No se reinicia localmente.
3. Se calcula la siguiente decisión efectiva.
4. Se devuelve `GRACE_EXHAUSTED` cuando corresponde.

### Dispositivo `STALE`

1. No se revoca automáticamente.
2. Se valida la evidencia disponible.
3. Puede generarse alerta.
4. La licencia no cambia por ese hecho aislado.

### Dispositivo `UNREACHABLE`

1. No se considera desinstalado automáticamente.
2. No cambia la licencia.
3. Puede requerir revisión operativa.
4. La autorización local depende de la evidencia verificable disponible.

### Reloj no confiable

1. Se evalúa calidad temporal.
2. No se confía ciegamente en el reloj local.
3. Se detectan rollback o adelantos anómalos.
4. No se extiende vigencia ni gracia.
5. Puede devolverse `CLOCK_ROLLBACK_DETECTED`.

### Versión no soportada

1. Se valida `app_version` contra la política vigente.
2. Se devuelve `APP_VERSION_UNSUPPORTED`.
3. No se amplían derechos.
4. Puede requerirse actualización antes de continuar.

## Reglas de consistencia

1. Toda decisión pertenece a un único tenant.
2. `device_id` no sustituye `installation_id`.
3. `installation_id` no sustituye `device_key_id`.
4. `device_key_id` no sustituye `activation_id`.
5. `activation_id` no sustituye `license_id`.
6. `license_id` no sustituye entitlements.
7. La activación no amplía derechos.
8. La confianza del dispositivo no sustituye estado contractual.
9. El estado operativo no sustituye confianza criptográfica.
10. La gracia no sustituye una licencia válida.
11. Una revocación conocida no se ignora por operación offline.
12. Una reinstalación no revive una activación anterior.
13. Una copia local antigua no prevalece sobre una decisión autoritativa más reciente.
14. Una decisión de autorización no elimina hechos comerciales confirmados.
15. La autorización efectiva debe poder explicarse mediante códigos estables.

## Puntos de auditoría

Deben auditarse como mínimo:

- validación sensible de identidad;
- prueba de posesión fallida;
- cambio de instalación;
- activación ausente;
- activación revocada;
- licencia suspendida;
- licencia revocada;
- uso de gracia;
- gracia agotada;
- mismatch de dispositivo;
- mismatch de instalación;
- mismatch de tenant;
- intento con clave inválida;
- decisión `REVIEW_REQUIRED`;
- override administrativo autorizado;
- recuperación o reemplazo iniciado desde este contrato.

Cada evento debe conservar cuando corresponda:

- `tenant_id`;
- `actor_id` opcional;
- `device_id`;
- `installation_id`;
- `activation_id` opcional;
- `license_id`;
- `requested_feature`;
- `decision`;
- `reason_code`;
- `correlation_id`;
- política aplicada;
- momento efectivo.

La auditoría es distinta del logging técnico.

## Puntos de observabilidad futura

Este caso de uso define puntos semánticos de instrumentación sin depender de librerías concretas.

Eventos conceptuales:

- `POS_IDENTITY_VALIDATION_STARTED`;
- `POS_IDENTITY_VALIDATION_SUCCEEDED`;
- `POS_IDENTITY_VALIDATION_FAILED`;
- `ACTIVATION_VALIDATION_FAILED`;
- `LICENSE_VALIDATION_FAILED`;
- `AUTHORIZATION_ALLOWED`;
- `AUTHORIZATION_RESTRICTED`;
- `AUTHORIZATION_DENIED`;
- `AUTHORIZATION_REVIEW_REQUIRED`;
- `OFFLINE_AUTHORIZATION_USED`;
- `CLOCK_ANOMALY_DETECTED`.

Métricas conceptuales futuras:

- autorizaciones permitidas;
- autorizaciones restringidas;
- autorizaciones denegadas;
- fallos de identidad;
- fallos de activación;
- fallos de licencia;
- uso de autorización offline;
- mismatches de instalación;
- mismatches de dispositivo;
- decisiones `REVIEW_REQUIRED`;
- latencia de evaluación.

Reglas:

1. El dominio no importa SDKs de observabilidad.
2. Los casos de uso utilizarán puertos cuando existan.
3. `tenant_id` y `correlation_id` deben propagarse.
4. Identificadores de alta cardinalidad no deben usarse indiscriminadamente como labels.
5. Fallos de logging o métricas no alteran la decisión de negocio.
6. La auditoría crítica puede requerir garantías más fuertes.
7. No se registran secretos.
8. Observabilidad no sustituye autorización ni auditoría.

## Pruebas mínimas

El diseño debe permitir verificar como mínimo:

1. tenant válido;
2. tenant inválido;
3. dispositivo válido;
4. dispositivo inexistente;
5. dispositivo revocado;
6. dispositivo `STALE`;
7. dispositivo `UNREACHABLE`;
8. instalación válida;
9. instalación diferente;
10. reinstalación;
11. clave válida;
12. clave inválida;
13. clave revocada;
14. prueba de posesión válida;
15. prueba de posesión inválida;
16. activación válida;
17. activación ausente;
18. activación suspendida;
19. activación revocada;
20. activación reemplazada;
21. activación expirada;
22. licencia válida;
23. licencia `PAST_DUE`;
24. licencia suspendida;
25. licencia revocada;
26. licencia expirada;
27. licencia `LOCAL_PERPETUAL`;
28. licencia `HYBRID`;
29. entitlement permitido;
30. entitlement no contratado;
31. límite disponible;
32. límite excedido;
33. gracia activa;
34. gracia agotada;
35. operación conectada;
36. operación offline autorizada;
37. operación offline denegada;
38. revocación conocida offline;
39. reloj confiable;
40. rollback de reloj;
41. versión soportada;
42. versión no soportada;
43. mismatch de tenant;
44. mismatch de dispositivo;
45. mismatch de instalación;
46. decisión `ALLOW`;
47. decisión `ALLOW_WITH_RESTRICTIONS`;
48. decisión `DENY`;
49. decisión `REVIEW_REQUIRED`;
50. preservación de datos;
51. aislamiento entre tenants;
52. decisión determinista;
53. códigos de razón estables;
54. auditoría;
55. observabilidad futura no altera el resultado.

## Documentos normativos relacionados

- `docs/adr/DEC-007-local-first-data-authority.md`;
- `docs/adr/DEC-008-device-trust-license-activation.md`;
- `docs/architecture/conceptual-data-model.md`;
- `docs/architecture/security-model.md`;
- `docs/domain/business-rules.md`;
- `docs/domain/glossary.md`;
- `docs/use-cases/devices/UC-DEV-001-manage-device-lifecycle.md`;
- `docs/use-cases/licensing/UC-LIC-001-validate-license.md`;
- `docs/use-cases/licensing/UC-LIC-002-manage-license-lifecycle.md`.
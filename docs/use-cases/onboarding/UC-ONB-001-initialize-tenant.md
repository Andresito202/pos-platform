# UC-ONB-001: Inicializar tenant y estructura operativa mínima

## Objetivo

Definir el contrato funcional para crear de forma coherente un nuevo tenant junto con su empresa inicial, primera sucursal, propietario y configuración mínima necesaria para comenzar el proceso de activación del POS.

Este caso de uso no define todavía el bootstrap físico ni la transacción SQL concreta.

La atomicidad técnica, idempotencia de infraestructura, rollback físico y estrategia de persistencia se detallarán en `ONB-002` después de `TECH-002`.

## Actor principal

Administrador de plataforma o flujo autorizado de alta comercial.

## Actores secundarios

- futuro propietario del tenant;
- servicio de licencias;
- sistema de autenticación;
- sistema de autorización;
- sistema de auditoría;
- sistema de observabilidad;
- servicio de configuración;
- proceso de activación del POS.

## Precondiciones

- El actor que inicia el onboarding está autenticado y autorizado.
- Los permisos definidos por `SEC-002` están disponibles.
- La política de licencia definida por `LIC-002` está disponible.
- El identificador comercial utilizado para crear el tenant no pertenece a otro tenant incompatible.
- El propietario inicial dispone de una identidad de usuario válida o puede ser creado mediante un flujo autorizado.
- La operación conserva `correlation_id`.
- No existe un onboarding previo confirmado con la misma identidad lógica salvo reintento idempotente.

## Entrada

Según el flujo:

- `tenant_name`;
- `tenant_code` opcional;
- `commercial_reference` opcional;
- `company_name`;
- `company_legal_name` opcional;
- `company_tax_id` opcional;
- `branch_name`;
- `branch_code` opcional;
- `branch_address` opcional;
- `owner_user_id` opcional;
- `owner_email`;
- `owner_phone` opcional;
- `initial_locale`;
- `initial_timezone`;
- `initial_currency`;
- `initial_tax_profile` opcional;
- `initial_configuration`;
- `license_reference` opcional;
- `requested_plan` opcional;
- `idempotency_key`;
- `correlation_id`;
- `actor_id`.

## Resultado mínimo esperado

Un onboarding confirmado debe producir lógicamente:

1. un `Tenant`;
2. una `Company` inicial perteneciente al tenant;
3. una `Branch` inicial perteneciente a la empresa;
4. un usuario propietario identificado;
5. una relación verificable entre el propietario y el tenant;
6. el rol o conjunto de permisos iniciales autorizados;
7. configuración mínima versionada;
8. referencia contractual o de licencia cuando corresponda;
9. trazabilidad de auditoría;
10. un estado explícito de onboarding.

## Principios del caso de uso

1. El tenant es el límite principal de aislamiento.
2. La empresa inicial pertenece exactamente a un tenant.
3. La primera sucursal pertenece exactamente a una empresa.
4. El propietario inicial debe quedar asociado explícitamente al tenant.
5. Ser propietario no elimina las validaciones de autorización backend.
6. La creación parcial no debe considerarse onboarding confirmado.
7. Un reintento con la misma `idempotency_key` no debe crear un segundo tenant lógico.
8. Una identidad comercial no debe reutilizarse silenciosamente entre tenants.
9. La configuración inicial debe ser explícita y versionable.
10. La licencia no sustituye la identidad del tenant.
11. El tenant no queda operativo para todas las capacidades solo por existir.
12. La activación del POS se ejecuta mediante los contratos de licencias y dispositivos ya definidos.
13. Toda operación debe conservar `tenant_id` una vez creado.
14. Las operaciones sensibles del propietario deben respetar MFA o reautenticación según política.
15. El onboarding debe poder auditarse de extremo a extremo.

## Flujo principal

1. El sistema valida la identidad y autorización del actor que inicia el onboarding.
2. Valida que la identidad comercial utilizada no esté asociada a otro tenant incompatible.
3. Valida la información mínima de empresa.
4. Valida la información mínima de la primera sucursal.
5. Resuelve o crea la identidad global `User` del propietario inicial mediante un flujo autorizado.
6. Crea el `Tenant`.
7. Crea la `Company` inicial vinculada al tenant.
8. Crea la `Branch` inicial vinculada a la empresa.
9. Crea una `TenantMembership` explícita entre el propietario y el tenant con `membership_type = OWNER`.
10. Aplica los roles y alcances iniciales autorizados mediante `UserRoleAssignment`, conforme a RBAC, ABAC y `SEC-002`.
11. Aplica la configuración mínima inicial.
12. Registra la referencia de licencia o plan cuando corresponda.
13. Calcula el estado inicial de onboarding.
14. Registra auditoría.
15. Devuelve una respuesta estructurada con los identificadores creados y el estado resultante.

## Propietario inicial

El propietario inicial representa la identidad de usuario que recibe la responsabilidad administrativa principal del tenant durante el onboarding.

Reglas:

1. El propietario debe corresponder a una identidad de usuario verificable.
2. La relación propietario ↔ tenant debe representarse explícitamente mediante una `TenantMembership`.
3. El propietario no debe inferirse únicamente por correo electrónico, teléfono o coincidencia de nombre.
4. Un usuario puede pertenecer a más de un contexto únicamente cuando la política de producto lo autorice explícitamente.
5. Ser propietario no permite acceder a otros tenants.
6. Los roles y alcances del propietario inicial deben aplicarse mediante `UserRoleAssignment`; la pertenencia `OWNER` no concede por sí sola todos los permisos.
7. Las operaciones críticas posteriores pueden exigir MFA o reautenticación.
8. Un cambio posterior de propietario debe seguir un caso de uso separado y auditable.
9. La eliminación del usuario propietario no debe eliminar automáticamente el tenant ni su historial.
10. El onboarding debe fallar o quedar incompleto si no puede establecerse una relación válida con el propietario.

## Configuración inicial

La configuración inicial contiene únicamente los valores necesarios para establecer el contexto operativo mínimo del tenant.

Puede incluir:

- idioma;
- zona horaria;
- moneda;
- formatos regionales;
- datos comerciales básicos;
- parámetros iniciales de empresa;
- parámetros iniciales de sucursal;
- perfil fiscal inicial cuando corresponda;
- política inicial de numeración cuando corresponda;
- configuración de impresión;
- configuración de caja inicial opcional;
- configuración de inventario inicial;
- capacidades habilitadas según licencia.

Reglas:

1. La configuración inicial debe quedar asociada al tenant correspondiente.
2. La configuración de empresa y sucursal no debe mezclarse con configuración global de plataforma.
3. Los valores sensibles deben validarse antes de confirmarse.
4. Los cambios posteriores deben conservar versión o trazabilidad cuando corresponda.
5. La configuración inicial no puede habilitar funcionalidades no contratadas.
6. Un valor ausente no debe inventarse silenciosamente cuando sea necesario para operar.
7. Los defaults técnicos deben distinguirse de decisiones comerciales o fiscales.
8. La configuración inicial debe poder evolucionar sin recrear el tenant.

## Relación con licencias

El onboarding puede registrar una referencia comercial o contractual, pero no sustituye el ciclo de vida de licencias.

Reglas:

1. Crear un tenant no equivale a emitir una licencia.
2. Crear un tenant no equivale a activar una licencia.
3. La licencia aplicable debe cumplir `UC-LIC-001` y `UC-LIC-002`.
4. Una licencia no crea automáticamente empresa, sucursal o propietario.
5. El onboarding puede quedar en estado pendiente mientras la licencia se emite o valida.
6. Los entitlements efectivos deben provenir del contrato de licencia.
7. El plan solicitado no debe confundirse con el plan efectivamente autorizado.
8. La falta de licencia no elimina la estructura creada cuando la política permita conservar onboarding pendiente.
9. Una licencia inválida o revocada no debe convertir automáticamente en inválida la identidad del tenant.
10. La activación del POS se ejecuta después mediante los contratos de dispositivos y licencias.

## Relación con dispositivos

El onboarding prepara el contexto administrativo para que posteriormente puedan registrarse y activarse dispositivos.

Reglas:

1. `UC-ONB-001` no crea automáticamente una activación de dispositivo.
2. El dispositivo se gestiona mediante `UC-DEV-001`.
3. El contrato seguro dispositivo ↔ instalación ↔ activación ↔ licencia se gestiona mediante `UC-DEV-002`.
4. Un tenant puede existir sin dispositivos activos.
5. Una sucursal puede existir antes de disponer de un POS registrado.
6. El onboarding no debe inventar `device_id`, `installation_id` ni claves criptográficas.

## Estados de onboarding

Estados conceptuales:

- `PENDING`;
- `IN_PROGRESS`;
- `READY_FOR_LICENSE`;
- `READY_FOR_ACTIVATION`;
- `COMPLETED`;
- `FAILED`;
- `CANCELLED`;
- `REVIEW_REQUIRED`.

### `PENDING`

La solicitud existe, pero todavía no ha comenzado la creación lógica.

### `IN_PROGRESS`

La creación lógica se encuentra en ejecución o existe trabajo pendiente dentro del flujo.

### `READY_FOR_LICENSE`

Tenant, empresa, sucursal y propietario están definidos, pero falta completar o validar la licencia requerida.

### `READY_FOR_ACTIVATION`

La estructura mínima y la licencia aplicable están disponibles, por lo que puede iniciarse la activación del POS.

### `COMPLETED`

El contrato funcional mínimo de onboarding quedó satisfecho.

No implica que todos los módulos del POS estén configurados o activados.

### `FAILED`

El flujo no pudo alcanzar un estado coherente y debe conservar información suficiente para diagnóstico y reintento seguro.

### `CANCELLED`

La solicitud fue cancelada mediante una decisión autorizada.

La cancelación no debe reutilizar silenciosamente la identidad de una operación previa.

### `REVIEW_REQUIRED`

Existe una inconsistencia, riesgo o conflicto que requiere revisión antes de continuar.

## Reglas de transición

1. `PENDING` puede pasar a `IN_PROGRESS`.
2. `IN_PROGRESS` puede pasar a `READY_FOR_LICENSE`, `READY_FOR_ACTIVATION`, `COMPLETED`, `FAILED` o `REVIEW_REQUIRED`.
3. `READY_FOR_LICENSE` puede pasar a `READY_FOR_ACTIVATION` cuando exista una licencia aplicable.
4. `READY_FOR_ACTIVATION` puede pasar a `COMPLETED` cuando se satisfaga el criterio funcional definido.
5. `FAILED` puede reintentarse únicamente mediante una operación controlada e idempotente.
6. `CANCELLED` no vuelve automáticamente a `IN_PROGRESS`.
7. `REVIEW_REQUIRED` necesita resolución explícita.
8. Ninguna transición puede cambiar el tenant asociado a la operación.
9. Las transiciones deben conservar auditoría y `correlation_id`.
10. Los estados de onboarding no sustituyen estados de licencia, dispositivo, usuario o sucursal.

## Flujos alternos

### Tenant comercialmente duplicado

1. El sistema detecta que la identidad comercial ya está asociada a otro tenant incompatible.
2. No crea un segundo tenant lógico.
3. Devuelve un código estable.
4. Puede pasar a `REVIEW_REQUIRED` cuando exista ambigüedad.
5. El intento queda auditado.

### Empresa inválida

1. Se rechaza la creación lógica de la empresa.
2. El onboarding no se marca como `COMPLETED`.
3. Se conserva información suficiente para diagnóstico.
4. No se crea una empresa huérfana fuera de tenant.

### Sucursal inválida

1. Se rechaza la creación de la primera sucursal.
2. El tenant no se considera operativo para POS.
3. La empresa no debe reasignarse a otro tenant.
4. Puede reintentarse mediante la misma identidad lógica.

### Propietario inexistente

1. Se intenta resolver o crear la identidad mediante un flujo autorizado.
2. Si no puede establecerse una identidad válida, el onboarding no se completa.
3. No se asigna un propietario ficticio o implícito.
4. Puede pasar a `REVIEW_REQUIRED`.

### Propietario ya asociado a otro tenant

1. Se evalúa la política aplicable.
2. No se concede acceso cruzado automáticamente.
3. Si el producto permite pertenencia múltiple, debe existir una relación explícita por tenant.
4. Si no está permitido, se rechaza la asociación.

### MFA requerido

1. Se detecta que la operación crítica requiere MFA.
2. Si MFA no está satisfecho, se detiene la operación sensible.
3. Se devuelve un código estable.
4. No se degrada silenciosamente la política de seguridad.

### Reautenticación requerida

1. La operación se pausa.
2. El actor debe demostrar nuevamente su identidad.
3. La reautenticación no amplía permisos.
4. El resultado queda asociado a la misma operación lógica.

### Licencia todavía no disponible

1. Tenant, empresa, sucursal y propietario pueden quedar preparados según política.
2. El onboarding pasa a `READY_FOR_LICENSE`.
3. No se inventan entitlements.
4. La activación del POS no se inicia.

### Licencia inválida o revocada

1. Se conserva la estructura administrativa válida.
2. El onboarding no declara capacidades licenciadas.
3. Se devuelve el estado correspondiente.
4. La identidad del tenant no se destruye.

### Reintento idempotente

1. Se identifica la operación previa mediante `idempotency_key`.
2. No se crea un segundo tenant.
3. No se duplican empresa, sucursal o relación de propietario.
4. Se devuelve el resultado existente o el estado vigente de la operación.

### Conflicto durante onboarding

1. Se conserva la evidencia disponible.
2. No se sobrescribe silenciosamente la relación existente.
3. Se genera `REVIEW_REQUIRED`.
4. La resolución debe ser explícita y auditable.

### Cancelación

1. Un actor autorizado solicita cancelación.
2. Se registra el motivo.
3. El estado pasa a `CANCELLED` cuando la política lo permita.
4. No se eliminan silenciosamente estructuras ya confirmadas.
5. Las consecuencias físicas se definirán en `ONB-002`.

## Salida

El caso de uso puede devolver:

- `onboarding_id`;
- `tenant_id` opcional;
- `company_id` opcional;
- `branch_id` opcional;
- `owner_user_id` opcional;
- `tenant_membership_id` opcional;
- `status`;
- `reason_code`;
- `license_reference` opcional;
- `requested_plan` opcional;
- `effective_plan` opcional;
- `configuration_version` opcional;
- `required_action` opcional;
- `idempotency_key`;
- `correlation_id`;
- `created_at`;
- `updated_at`.

La salida no debe exponer:

- secretos;
- tokens;
- credenciales;
- información privada de otros tenants;
- datos innecesarios de autenticación;
- información interna que permita enumerar tenants ajenos.

## Reglas de consistencia

1. Un `Company` no puede pertenecer a dos tenants.
2. Una `Branch` no puede pertenecer a dos empresas.
3. Una relación de propietario debe indicar explícitamente el tenant.
4. Un usuario propietario no obtiene acceso implícito a otros tenants.
5. La creación lógica debe conservar una única identidad de onboarding.
6. `idempotency_key` no puede producir dos tenants lógicos para la misma operación.
7. Los estados de onboarding no sustituyen estados de licencia.
8. Los estados de onboarding no sustituyen estados de usuario o sesión.
9. Los estados de onboarding no sustituyen estados de dispositivo.
10. Un onboarding incompleto no debe presentarse como `COMPLETED`.
11. La configuración debe permanecer dentro del alcance del tenant.
12. La información fiscal debe pertenecer a la empresa correspondiente.
13. La primera sucursal debe pertenecer a la empresa inicial.
14. La autorización efectiva debe validarse en backend.
15. La auditoría debe conservar el contexto del actor y la operación.

## Puntos de auditoría

Deben auditarse como mínimo:

- inicio de onboarding;
- creación lógica de tenant;
- creación de empresa;
- creación de primera sucursal;
- resolución o creación del propietario;
- asociación del propietario;
- asignación de rol o permisos iniciales;
- configuración inicial;
- asociación de referencia comercial;
- asociación de licencia;
- cambio de estado;
- reintento idempotente;
- conflicto;
- revisión requerida;
- cancelación;
- finalización.

Cada evento debe conservar cuando corresponda:

- `onboarding_id`;
- `tenant_id`;
- `company_id`;
- `branch_id`;
- `actor_id`;
- `owner_user_id`;
- operación;
- estado anterior;
- estado nuevo;
- `reason_code`;
- `idempotency_key`;
- `correlation_id`;
- `policy_version` opcional;
- momento efectivo.

## Puntos de observabilidad futura

Eventos conceptuales:

- `ONBOARDING_STARTED`;
- `TENANT_CREATED`;
- `COMPANY_CREATED`;
- `INITIAL_BRANCH_CREATED`;
- `OWNER_ASSOCIATED`;
- `INITIAL_CONFIGURATION_APPLIED`;
- `ONBOARDING_READY_FOR_LICENSE`;
- `ONBOARDING_READY_FOR_ACTIVATION`;
- `ONBOARDING_COMPLETED`;
- `ONBOARDING_FAILED`;
- `ONBOARDING_CANCELLED`;
- `ONBOARDING_REVIEW_REQUIRED`;
- `ONBOARDING_IDEMPOTENT_RETRY`.

Métricas conceptuales futuras:

- onboardings iniciados;
- onboardings completados;
- onboardings fallidos;
- onboardings en revisión;
- tiempo hasta `READY_FOR_LICENSE`;
- tiempo hasta `READY_FOR_ACTIVATION`;
- tiempo total de onboarding;
- conflictos;
- reintentos idempotentes;
- fallos por propietario;
- fallos por licencia.

Reglas:

1. El dominio no importa SDKs concretos de observabilidad.
2. Logging y métricas no sustituyen auditoría.
3. `tenant_id` y `correlation_id` deben propagarse cuando existan.
4. Antes de existir `tenant_id`, debe propagarse `onboarding_id` y `correlation_id`.
5. Los identificadores de alta cardinalidad no deben utilizarse indiscriminadamente como labels.
6. Un fallo de métricas no cambia la decisión funcional.
7. No se registran secretos ni credenciales.

## Pruebas mínimas

El diseño debe permitir verificar como mínimo:

1. onboarding válido;
2. tenant nuevo;
3. empresa inicial;
4. primera sucursal;
5. propietario existente;
6. propietario nuevo;
7. asociación explícita propietario-tenant;
8. propietario perteneciente a otro tenant;
9. aislamiento de tenant;
10. identidad comercial duplicada;
11. empresa inválida;
12. sucursal inválida;
13. propietario inválido;
14. permiso insuficiente;
15. MFA requerido;
16. reautenticación requerida;
17. configuración inicial válida;
18. configuración inicial inválida;
19. zona horaria;
20. moneda;
21. configuración fiscal;
22. licencia disponible;
23. licencia pendiente;
24. licencia inválida;
25. licencia revocada;
26. `READY_FOR_LICENSE`;
27. `READY_FOR_ACTIVATION`;
28. `COMPLETED`;
29. `FAILED`;
30. `CANCELLED`;
31. `REVIEW_REQUIRED`;
32. transición inválida;
33. reintento con misma `idempotency_key`;
34. intento duplicado con identidad comercial;
35. conservación de `correlation_id`;
36. auditoría;
37. no exposición de secretos;
38. no enumeración de otro tenant;
39. activación no creada automáticamente;
40. dispositivo no creado automáticamente;
41. licencia no emitida automáticamente;
42. separación onboarding/licencia/dispositivo;
43. decisión determinista;
44. códigos de razón estables.

## Documentos normativos relacionados

- `docs/architecture/conceptual-data-model.md`;
- `docs/architecture/security-model.md`;
- `docs/domain/business-rules.md`;
- `docs/domain/glossary.md`;
- `docs/security/permission-matrix.md`;
- `docs/use-cases/licensing/UC-LIC-001-validate-license.md`;
- `docs/use-cases/licensing/UC-LIC-002-manage-license-lifecycle.md`;
- `docs/use-cases/devices/UC-DEV-001-manage-device-lifecycle.md`;
- `docs/use-cases/devices/UC-DEV-002-secure-pos-identity-license-contract.md`.

## Relación con ONB-002

`UC-ONB-001` define el contrato funcional y los invariantes del onboarding.

`ONB-002` deberá definir posteriormente:

- límites de la transacción física;
- orden de persistencia;
- rollback;
- idempotencia técnica;
- aislamiento transaccional;
- manejo de fallos parciales;
- outbox y eventos;
- reintentos técnicos;
- recuperación después de crash;
- garantías de auditoría durante bootstrap.

`ONB-002` no podrá alterar los invariantes funcionales establecidos por este caso de uso.

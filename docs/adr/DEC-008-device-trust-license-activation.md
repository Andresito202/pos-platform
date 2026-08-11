# DEC-008 — Confianza de dispositivo, licencia firmada y activación offline

Estado:

`DONE`

---

# Propósito

Definir el modelo normativo de confianza para licencias, dispositivos, activaciones, validación local, operación offline, gracia, revocación, rotación de claves, reemplazo y recuperación.

Esta decisión no define todavía:

- esquema físico;
- proveedor criptográfico;
- algoritmo criptográfico definitivo;
- formato de transporte definitivo;
- implementación específica por sistema operativo;
- precios, planes o condiciones comerciales.

---

# Alcance

Incluye:

- autoridad de licencias;
- identidad de dispositivo;
- licencia firmada;
- derechos y límites;
- activación online;
- activación offline;
- validación local;
- vigencia;
- gracia;
- revocación;
- rotación de claves;
- reemplazo de dispositivo;
- recuperación;
- actualizaciones firmadas;
- auditoría;
- amenazas;
- escenarios;
- pruebas;
- invariantes.

---

# Fuera de alcance

No define:

- autenticación completa de usuarios;
- autorización RBAC o ABAC general;
- infraestructura PKI empresarial completa;
- modelo comercial de suscripciones;
- facturación del proveedor;
- diseño físico de tablas;
- código de producción;
- sincronización general, definida por `DEC-007`.

---

# Documentos relacionados

- `docs/adr/DEC-007-local-first-data-authority.md`;
- `docs/adr/ADR-003-local-first.md`;
- `docs/architecture/security-model.md`;
- `docs/architecture/conceptual-data-model.md`;
- `docs/use-cases/licensing/UC-LIC-001-validate-license.md`;
- `docs/domain/business-rules.md`;
- `docs/product/non-functional-requirements.md`.

---

# Principios iniciales

1. La autoridad de licencia pertenece al servidor central.
2. La clave privada de firma no reside en el cliente.
3. El cliente valida mediante material público confiable.
4. Una alteración del payload invalida la licencia.
5. El reloj local no constituye autoridad temporal definitiva.
6. La identidad del dispositivo no depende únicamente de una huella de hardware.
7. La activación es distinta de la licencia contractual.
8. Los derechos efectivos deben ser verificables.
9. Una revocación no elimina datos locales.
10. Una licencia perpetua no implica actualizaciones mayores perpetuas.
11. La operación offline debe ser explícitamente autorizada.
12. Una restricción no debe corromper operaciones ya confirmadas.
13. Un reemplazo de dispositivo conserva trazabilidad.
14. La rotación de claves debe mantener compatibilidad controlada.
15. Las decisiones criptográficas concretas requieren justificación verificable.

---

# Matriz inicial de autoridad

| Concepto | Autoridad principal | Verificación local | Cambio offline |
|---|---|---|---|
| Licencia contractual | Servidor central | Sí | No |
| Derechos y módulos | Servidor central | Sí | No |
| Límites | Servidor central | Sí | No |
| Activación | Servidor central | Sí | No |
| Identidad criptográfica del dispositivo | Dispositivo y servidor | Sí | No unilateral |
| Evidencia de hardware | Dispositivo | Sí | Puede cambiar |
| Revocación | Servidor central | Sí | No |
| Gracia autorizada | Servidor central | Sí | No |
| Calidad de reloj | Evidencia compartida | Sí | Sí |
| Estado de sincronización | Compartido | Sí | Sí |

---

# Modelo de confianza

La autoridad central:

- emite licencias;
- define derechos;
- define límites;
- aprueba activaciones;
- autoriza gracia;
- revoca activaciones;
- publica material público de verificación.

El dispositivo:

- conserva material público confiable;
- genera o conserva identidad criptográfica local;
- presenta evidencia de identidad;
- valida licencias y activaciones;
- conserva caché verificable;
- registra anomalías;
- no puede autoemitirse derechos.

El POS:

- consume decisiones verificadas;
- habilita o restringe capacidades;
- no modifica contenido firmado;
- no interpreta ausencia de conexión como autorización nueva;
- no convierte errores criptográficos en periodos de gracia.

El backend:

- verifica identidad del tenant;
- valida identidad del dispositivo;
- aplica políticas contractuales;
- registra activaciones y revocaciones;
- mantiene trazabilidad;
- no confía en valores suministrados únicamente por el cliente.

## Cadena conceptual de confianza

Autoridad central
→ licencia contractual
→ activación
→ identidad de dispositivo
→ POS instalado
→ capacidades autorizadas

## Raíz de confianza

1. El cliente conserva claves públicas o identificadores de clave autorizados.
2. No acepta una clave pública arbitraria recibida junto con la licencia.
3. Una clave retirada no firma nuevas licencias.
4. La rotación conserva compatibilidad controlada.
5. El cliente no posee material suficiente para emitir licencias válidas.

# Actores y responsabilidades

## Autoridad de licencias

Responsable de emitir, firmar, versionar, revocar y auditar licencias.

## Servicio de activación

Responsable de validar tenant, licencia, dispositivo, límites e idempotencia.

## Dispositivo como actor

Responsable de proteger su identidad local, validar material firmado y conservar evidencia.

## Aplicación POS

Responsable de aplicar restricciones sin borrar datos ni reescribir operaciones confirmadas.

## Operador autorizado

Puede solicitar activación, reemplazo y recuperación, pero no alterar licencias.

## Soporte

Solo puede intervenir mediante acceso temporal, limitado y auditado.

## Administrador criptográfico

Responsable de custodia, rotación, retiro y respuesta ante compromiso de claves.

## Auditor

Puede revisar emisión, activación, revocación, reemplazo y validaciones fallidas.

# Separación de conceptos

## Licencia contractual

Representa el derecho emitido por la autoridad central para que un tenant utilice una modalidad, versión, conjunto de capacidades y límites determinados.

No representa:

- una instalación;
- una sesión;
- un usuario;
- una activación concreta;
- una huella de hardware;
- una operación pendiente de sincronización.

La licencia:

- pertenece a un tenant;
- tiene identidad global;
- tiene versión de payload;
- tiene vigencia;
- tiene modalidad;
- declara límites;
- referencia derechos;
- contiene metadatos de firma;
- puede ser suspendida, cancelada o sustituida sin borrar historial.

## Derechos y límites

Los derechos definen capacidades autorizadas.

Ejemplos:

- módulos;
- número de sucursales;
- número de dispositivos;
- versiones permitidas;
- funciones premium;
- modalidades offline.

Los límites:

- son definidos centralmente;
- deben ser verificables;
- no se amplían localmente;
- no deben depender de valores editables sin firma;
- pueden tener vigencia propia;
- conservan versión.

Un derecho no equivale a permiso de usuario.

## Concepto de activación

Representa la asociación autorizada entre:

- licencia;
- tenant;
- empresa opcional;
- sucursal opcional;
- dispositivo;
- instalación;
- versión de aplicación.

La activación es distinta de la licencia.

Una licencia puede admitir varias activaciones según sus límites.

Toda activación debe tener:

- identidad global;
- estado;
- fecha de emisión;
- evidencia de dispositivo;
- versión;
- referencia de licencia;
- prueba verificable;
- historial de revocación;
- idempotencia.

## Identidad de dispositivo

La identidad operativa del dispositivo no depende exclusivamente de hardware.

Debe distinguir:

- device_id emitido;
- installation_id local;
- identidad criptográfica;
- evidencia de hardware;
- versión de aplicación;
- sistema operativo;
- estado de confianza.

La evidencia de hardware:

- ayuda a detectar cambios;
- no constituye autoridad única;
- puede variar por reparación;
- no debe contener más datos personales de los necesarios;
- no debe permitir bloqueo irreversible sin revisión.

## Concepto de revocación

La revocación desautoriza una activación o identidad de dispositivo.

No elimina:

- licencia;
- datos locales;
- ventas confirmadas;
- auditoría;
- operaciones pendientes.

Una revocación debe conservar:

- motivo;
- actor;
- fecha;
- alcance;
- versión;
- evidencia;
- estado de propagación.

La revocación de una activación no implica necesariamente cancelar la licencia completa.

## Concepto de reemplazo de dispositivo

El reemplazo:

- revoca o retira la activación anterior;
- crea una nueva asociación;
- conserva trazabilidad;
- no copia secretos del dispositivo anterior;
- no transfiere confianza automáticamente;
- debe reconciliar operaciones pendientes antes de descartar el equipo anterior cuando sea posible.

# Separación de estados

El sistema no utilizará una única máquina de estados para representar licencia, activación, dispositivo y autorización operativa.

Cada dimensión conserva su propio estado.

## SignatureValidity

Representa la validez criptográfica del artefacto.

Valores conceptuales:

- VALID;
- INVALID_SIGNATURE;
- UNKNOWN_KEY;
- UNSUPPORTED_ALGORITHM;
- MALFORMED_PAYLOAD;
- UNSUPPORTED_PAYLOAD_VERSION.

Reglas:

1. Un error criptográfico nunca se convierte en gracia.
2. Una firma inválida bloquea el uso del artefacto.
3. Una clave desconocida no se acepta por conveniencia.
4. Una versión de payload no soportada requiere actualización o revisión.
5. La validez criptográfica no implica autorización contractual.

## ContractStatus

Representa el estado contractual de la licencia.

Valores conceptuales:

- TRIAL;
- ACTIVE;
- PAST_DUE;
- SUSPENDED;
- CANCELLED;
- EXPIRED.

Reglas:

1. El servidor central es autoritativo.
2. El cliente conserva un snapshot verificable.
3. La falta de conexión no modifica el estado contractual.
4. PAST_DUE no equivale automáticamente a bloqueo total.
5. CANCELLED no elimina datos ni historial.
6. La licencia perpetua puede permanecer contractual y limitar actualizaciones.

## GraceStatus

Representa la autorización temporal para continuar operando bajo restricciones.

Valores conceptuales:

- NOT_APPLICABLE;
- AUTHORIZED;
- ACTIVE;
- EXHAUSTED;
- REVOKED.

Reglas:

1. La gracia debe estar explícitamente autorizada.
2. La gracia no nace de un error de red.
3. La gracia no corrige una firma inválida.
4. La gracia tiene alcance y vigencia verificables.
5. La gracia no amplía módulos ni límites.
6. Una gracia agotada no se reinicia por reinstalación.

## ActivationStatus

Representa el estado de la asociación licencia-dispositivo.

Valores conceptuales:

- PENDING;
- ACTIVE;
- SUSPENDED;
- REVOKED;
- REPLACED;
- EXPIRED;
- REVIEW_REQUIRED.

Reglas:

1. Una activación revocada no vuelve a ACTIVE automáticamente.
2. Un reemplazo crea una nueva activación.
3. Una activación sustituida conserva historial.
4. Un dispositivo diferente no reutiliza una activación existente.
5. La reactivación requiere autorización explícita.
6. La misma solicitud idempotente no crea activaciones duplicadas.

## DeviceTrustStatus

Representa el nivel de confianza del dispositivo.

Valores conceptuales:

- TRUSTED;
- DEGRADED;
- UNTRUSTED;
- REVOKED;
- UNKNOWN;
- REVIEW_REQUIRED.

Reglas:

1. La evidencia de hardware no determina por sí sola el estado.
2. Un cambio menor de hardware puede degradar confianza sin revocar.
3. Una identidad criptográfica inválida produce UNTRUSTED.
4. Un dispositivo revocado no sincroniza ni activa licencias.
5. La revisión manual conserva evidencia y motivo.
6. La confianza del dispositivo no sustituye permisos de usuario.

## EntitlementStatus

Representa si una capacidad concreta puede utilizarse.

Valores conceptuales:

- ALLOWED;
- ALLOWED_WITH_RESTRICTIONS;
- DENIED;
- UNKNOWN;
- REVIEW_REQUIRED.

Se calcula a partir de:

- validez de firma;
- estado contractual;
- gracia;
- activación;
- confianza del dispositivo;
- versión de aplicación;
- derechos firmados;
- límites;
- política de operación offline.

## EffectiveLicenseDecision

Representa el resultado operativo final para una capacidad solicitada.

Campos conceptuales:

- decision;
- reason_code;
- license_id;
- activation_id;
- device_id;
- feature_code;
- evaluated_at;
- evaluation_source;
- payload_version;
- signing_key_id;
- policy_version.

Valores de decision:

- ALLOW;
- ALLOW_WITH_RESTRICTIONS;
- DENY;
- REVIEW_REQUIRED.

El POS consume esta decisión, pero no inventa sus fundamentos.

## Matriz mínima de evaluación

| Firma | Contrato | Gracia | Activación | Dispositivo | Resultado |
|---|---|---|---|---|---|
| válida | activo | no aplica | activa | confiable | permitir |
| válida | vencido | activa | activa | confiable | permitir con restricciones |
| válida | suspendido | no aplica | activa | confiable | denegar o restringir según política |
| inválida | cualquiera | cualquiera | cualquiera | cualquiera | denegar |
| válida | activo | no aplica | revocada | confiable | denegar |
| válida | activo | no aplica | activa | revocado | denegar |
| válida | activo | no aplica | revisión | degradado | revisión requerida |

# Payload firmado y metadatos

El sistema utilizará artefactos firmados cuyo contenido pueda validarse de forma determinista.

El formato físico definitivo permanece abierto.

## LicensePayload

Representa la declaración firmada de derechos contractuales.

Campos conceptuales mínimos:

- payload_type;
- payload_version;
- license_id;
- tenant_id;
- issuer_id;
- issued_at;
- not_before opcional;
- expires_at opcional;
- deployment_mode;
- contract_status;
- feature_entitlements;
- branch_limit;
- device_limit;
- allowed_app_versions;
- offline_policy;
- grace_policy opcional;
- supersedes_license_id opcional;
- signing_key_id.

Reglas:

1. Todos los campos que afectan autorización deben estar cubiertos por la firma.
2. Los derechos no se leen desde una fuente local no firmada.
3. Los límites no se amplían mediante configuración local.
4. El payload es inmutable después de firmarse.
5. Una modificación requiere emitir una nueva versión.
6. license_id permanece estable para la licencia lógica.
7. La emisión de una nueva versión conserva trazabilidad.
8. Un payload sustituido no se elimina.

## ActivationPayload

Representa la autorización firmada de una instalación concreta.

Campos conceptuales mínimos:

- payload_type;
- payload_version;
- activation_id;
- license_id;
- tenant_id;
- device_id;
- installation_id;
- issued_at;
- not_before opcional;
- expires_at opcional;
- activation_status;
- device_key_id;
- device_evidence_hash opcional;
- allowed_app_versions;
- offline_authorization;
- grace_policy opcional;
- previous_activation_id opcional;
- replacement_reason opcional;
- signing_key_id.

Reglas:

1. Una activación pertenece a una licencia.
2. Una activación referencia una identidad concreta de dispositivo.
3. La activación no modifica los derechos contractuales.
4. Un reemplazo emite un nuevo `activation_id`.
5. La activación anterior conserva estado histórico.
6. El cliente no cambia device_id, installation_id ni límites.
7. Una activación revocada no puede reutilizarse.
8. El mismo payload no puede vincularse a otro dispositivo.

## RevocationPayload

Representa una instrucción verificable de revocación.

Campos conceptuales mínimos:

- payload_type;
- payload_version;
- revocation_id;
- target_type;
- target_id;
- tenant_id;
- reason_code;
- issued_at;
- effective_at;
- sequence;
- signing_key_id.

Valores conceptuales de 	arget_type:

- LICENSE;
- ACTIVATION;
- DEVICE;
- SIGNING_KEY;
- UPDATE_KEY.

Reglas:

1. La revocación tiene identidad propia.
2. La revocación no elimina el objeto objetivo.
3. El orden se resuelve mediante una secuencia central verificable.
4. Una instrucción más antigua no revierte una revocación posterior.
5. La revocación debe persistirse y auditarse.
6. El cliente no puede borrar una revocación aplicada.

## GraceAuthorizationPayload

Representa una autorización temporal y explícita de continuidad.

Campos conceptuales mínimos:

- payload_type;
- payload_version;
- grace_id;
- license_id;
- activation_id opcional;
- tenant_id;
- issued_at;
- starts_at;
- ends_at;
- allowed_features;
- restricted_features;
- reason_code;
- grace_sequence;
- signing_key_id.

Reglas:

1. La gracia no se infiere.
2. La gracia debe estar firmada.
3. La gracia no corrige una firma inválida.
4. La gracia no amplía derechos originales.
5. La gracia puede restringir capacidades.
6. Una gracia agotada no se reinicia localmente.
7. Una gracia posterior debe tener secuencia superior.
8. La ausencia de conexión no genera una nueva gracia.

## Metadatos de firma

Cada artefacto firmado debe incluir o asociar:

- signing_key_id;
- signature_algorithm_id;
- payload_version;
- canonicalization_version;
- issued_at;
- issuer_id;
- signature.

Reglas:

1. La clave pública no se acepta desde el mismo artefacto sin una cadena de confianza previa.
2. signing_key_id identifica material previamente confiado.
3. El algoritmo debe estar soportado por la política vigente.
4. La canonicalización debe ser determinista.
5. La verificación debe fallar ante campos desconocidos críticos cuando la versión no sea soportada.
6. Los metadatos de firma no pueden depender de valores editables externamente.

## Canonicalización

Antes de firmar, el payload debe transformarse de forma determinista.

La canonicalización debe definir:

- orden de campos;
- codificación;
- representación de fechas;
- representación numérica;
- tratamiento de campos opcionales;
- listas;
- valores nulos;
- versión del esquema.

No se firmará una representación cuya serialización pueda cambiar entre plataformas.

## Versionado de payload

Reglas:

1. Cada tipo de payload tiene versión explícita.
2. Las versiones publicadas son inmutables.
3. El cliente rechaza versiones críticas desconocidas.
4. Los cambios compatibles deben estar documentados.
5. Los cambios incompatibles requieren nueva versión mayor.
6. La migración no reescribe artefactos históricos.
7. El servidor conserva verificadores compatibles durante la ventana aprobada.
8. Una versión obsoleta puede validarse históricamente sin autorizar nuevas operaciones.

## Identificadores

Los identificadores firmados deben ser:

- globalmente únicos;
- opacos;
- no reutilizables;
- estables durante la vida del objeto;
- independientes de nombres comerciales.

No se utilizarán como identidad principal:

- dirección MAC;
- número de serie de disco;
- hostname;
- dirección IP;
- nombre de usuario del sistema.

Estos valores pueden servir como evidencia secundaria, no como raíz de identidad.

# Identidad criptográfica del dispositivo

La identidad confiable del dispositivo se basa en una credencial criptográfica propia y una asociación aprobada por el servidor.

No se basa únicamente en hardware.

## Componentes de identidad

Se distinguen:

- device_id;
- installation_id;
- device_key_id;
- clave privada local;
- clave pública registrada;
- evidencia de hardware;
- versión de aplicación;
- sistema operativo;
- estado de confianza.

## `device_id`

Identificador global emitido o aprobado por la autoridad central.

Reglas:

1. Es opaco.
2. No se reutiliza.
3. Permanece estable mientras exista la misma identidad autorizada.
4. No depende de hostname, IP o usuario local.
5. Un reemplazo crea un nuevo device_id salvo migración expresamente autorizada.
6. Una revocación no libera el identificador para reutilización.

## `installation_id`

Identifica una instalación concreta de la aplicación.

Reglas:

1. Se genera durante instalación o primer inicio controlado.
2. Cambia después de una reinstalación limpia.
3. No sustituye device_id.
4. Permite detectar clonación o restauración de imágenes.
5. Debe estar incluido en la activación.
6. No se reutiliza en instalaciones independientes.

## Clave del dispositivo

El dispositivo genera o recibe una identidad criptográfica local.

Principios:

1. La clave privada del dispositivo no abandona el dispositivo en texto claro.
2. El servidor registra la clave pública o su identificador verificable.
3. La clave privada no se copia durante un reemplazo normal.
4. La pérdida de la clave requiere recuperación o nueva activación.
5. La misma clave no debe compartirse entre dispositivos.
6. La prueba de posesión debe verificarse durante activación y operaciones sensibles.
7. La rotación de clave del dispositivo conserva trazabilidad.
8. Una clave comprometida debe revocarse.

## Registro de clave pública

El servidor conserva como mínimo:

- device_id;
- device_key_id;
- public_key;
- key_status;
- created_at;
- activated_at;
- revoked_at opcional;
- replacement_key_id opcional;
- proof_method;
- policy_version.

La clave pública registrada no otorga por sí sola derechos contractuales.

## Prueba de posesión

La prueba de posesión demuestra que el dispositivo controla la clave privada asociada.

Puede aplicarse mediante:

- firma de desafío;
- respuesta autenticada;
- protocolo equivalente aprobado.

Reglas:

1. El desafío debe ser impredecible.
2. El desafío tiene vigencia limitada.
3. No puede reutilizarse.
4. La respuesta se vincula a tenant, licencia, dispositivo e instalación.
5. El servidor verifica la firma con la clave registrada.
6. Un replay debe rechazarse.

## Evidencia de hardware

La evidencia de hardware es secundaria.

Puede incluir de forma controlada:

- familia de sistema operativo;
- identificador de instalación del sistema;
- presencia de hardware protegido;
- información estable no sensible;
- cambios relevantes detectados.

No debe utilizarse como identidad principal:

- dirección MAC;
- IP;
- hostname;
- usuario local;
- número de serie aislado;
- lista completa de hardware.

## Cambios de hardware

Los cambios se clasifican conceptualmente:

- EXPECTED_CHANGE;
- MINOR_CHANGE;
- MAJOR_CHANGE;
- SUSPICIOUS_CHANGE;
- UNKNOWN_CHANGE.

Política:

1. Un cambio menor no revoca automáticamente.
2. Un cambio mayor puede degradar confianza.
3. Un cambio sospechoso requiere revisión.
4. La evidencia anterior se conserva.
5. La decisión debe considerar clave, instalación, licencia y contexto.
6. No se bloquea irreversiblemente por un único atributo.

## Clonación

Se sospecha clonación cuando:

- la misma clave aparece activa desde instalaciones incompatibles;
- el mismo installation_id aparece en equipos distintos;
- existen desafíos firmados concurrentemente desde contextos incompatibles;
- una imagen restaurada reutiliza identidad antigua;
- la secuencia de activación es inconsistente.

La sospecha no debe borrar datos.

Puede producir:

- degradación;
- bloqueo de nuevas operaciones sensibles;
- revisión;
- revocación;
- reemplazo controlado.

## Reinstalación

Una reinstalación limpia:

- genera nuevo installation_id;
- puede generar nueva clave;
- requiere validación;
- no reutiliza automáticamente una activación anterior;
- puede entrar en recuperación;
- conserva referencia al dispositivo previo cuando sea autorizada.

## Rotación de clave del dispositivo

La rotación:

- genera nueva clave;
- prueba posesión de la clave anterior cuando esté disponible;
- registra nueva clave;
- enlaza ambas identidades;
- revoca o retira la anterior;
- conserva historial;
- no amplía derechos.

Si la clave anterior no está disponible, se utiliza recuperación reforzada.

## Estado de clave

Valores conceptuales:

- PENDING;
- ACTIVE;
- ROTATING;
- RETIRED;
- REVOKED;
- COMPROMISED;
- UNKNOWN.

Una clave REVOKED o COMPROMISED no puede autenticar operaciones nuevas.

## Almacenamiento local de clave

La implementación debe preferir almacenamiento protegido por la plataforma.

La selección del mecanismo concreto por sistema operativo pertenece a la implementación de dispositivos. No altera el contrato de persistencia: debe registrarse el tipo de almacén protegido, la versión del mecanismo y la evidencia de disponibilidad o degradación.

Requisitos mínimos:

1. La clave privada no se guarda en archivos planos.
2. No se incluye en backups sin protección.
3. No se expone en logs.
4. No se transmite al servidor.
5. El acceso se limita al proceso autorizado.
6. Debe existir manejo de pérdida, corrupción y rotación.
7. La ausencia de almacenamiento protegido degrada capacidades o exige controles compensatorios.

## Relación con licencia y activación

La identidad de dispositivo:

- no concede módulos;
- no modifica límites;
- no extiende vigencia;
- no crea gracia;
- no reemplaza la activación.

La activación vincula:

- licencia;
- device_id;
- installation_id;
- device_key_id;
- política;
- vigencia;
- estado.

# Activación y recuperación

## Activación online

La activación online vincula una licencia válida con una instalación y una identidad de dispositivo aprobadas.

Flujo conceptual:

1. El dispositivo genera o recupera su identidad criptográfica.
2. Obtiene un desafío del servicio de activación.
3. Presenta tenant, licencia, instalación, dispositivo y prueba de posesión.
4. El servidor valida:
   - licencia;
   - estado contractual;
   - derechos;
   - límites;
   - identidad del dispositivo;
   - prueba de posesión;
   - idempotencia;
   - revocaciones;
   - versión de aplicación;
   - política vigente.
5. El servidor registra la activación.
6. Emite un `ActivationPayload`.
7. El dispositivo valida firma, versión y vínculo.
8. Persiste la activación localmente.
9. Registra auditoría.

## Reglas de activación online

1. La misma solicitud idempotente no crea activaciones duplicadas.
2. Una licencia inválida no puede activarse.
3. Una licencia suspendida o cancelada no genera activaciones nuevas salvo política explícita.
4. El dispositivo debe demostrar posesión de su clave.
5. El servidor no confía únicamente en `fingerprint`.
6. Una activación no amplía derechos.
7. Una activación no modifica la licencia contractual.
8. La respuesta debe estar firmada.
9. Una activación emitida para otro tenant se rechaza.
10. Una activación emitida para otro dispositivo se rechaza.
11. Una activación emitida para otra instalación se rechaza cuando el vínculo sea obligatorio.
12. Los límites de dispositivos se evalúan centralmente.
13. La validación del límite, la reserva de capacidad, el registro idempotente, la creación de la activación y su auditoría se confirman en una sola transacción central.
14. El payload firmado se emite a partir de una activación ya confirmada; si la firma o entrega falla, un reintento recupera la misma activación.
15. La concurrencia sobre el cupo de licencia usa lock o versión autoritativa y nunca permite exceder el límite contratado.

## Activación offline

La activación offline permite autorizar un dispositivo sin conexión directa entre el POS y el servidor durante el flujo final.

No significa que el dispositivo pueda autoautorizarse.

El proceso requiere intercambio de artefactos verificables entre:

- dispositivo;
- operador;
- canal intermedio;
- servicio de activación.

Flujo conceptual:

1. El dispositivo genera una solicitud offline.
2. La solicitud contiene identidad, nonce, licencia solicitada, instalación y prueba de posesión.
3. La solicitud se transporta por un canal externo.
4. El servicio central valida la solicitud.
5. Emite una respuesta firmada y vinculada a la solicitud.
6. La respuesta retorna al dispositivo.
7. El dispositivo valida:
   - firma;
   - nonce;
   - tenant;
   - licencia;
   - dispositivo;
   - instalación;
   - vigencia;
   - versión;
   - replay;
   - política.
8. Persiste la activación.
9. Registra evidencia y auditoría.
10. Sincroniza el resultado cuando exista conexión.

## Reglas de activación offline

1. La solicitud offline tiene identidad propia.
2. El nonce es impredecible.
3. Una respuesta solo sirve para la solicitud original.
4. Una respuesta no puede reutilizarse en otro dispositivo.
5. Una respuesta expirada se rechaza.
6. La activación offline no omite límites.
7. La activación offline no evita revocaciones conocidas.
8. La respuesta debe ser verificable sin conexión.
9. El canal de transporte no necesita ser confiable si el artefacto está correctamente protegido.
10. La confidencialidad del canal no sustituye la firma.
11. Una respuesta importada dos veces produce el mismo resultado.
12. Una solicitud modificada invalida la respuesta.
13. La ausencia de conectividad no crea gracia automática.
14. El dispositivo conserva evidencia del intercambio.

## Solicitud de activación offline

Campos conceptuales:

- request_id;
- request_version;
- tenant_id;
- license_reference;
- device_id;
- installation_id;
- device_key_id;
- public_key o referencia;
- challenge_nonce;
- requested_at_local;
- app_version;
- operating_system_family;
- device_evidence_hash opcional;
- proof_of_possession;
- checksum.

La solicitud no contiene secretos privados.

## Respuesta de activación offline

Campos conceptuales:

- response_id;
- request_id;
- activation_id;
- license_id;
- tenant_id;
- device_id;
- installation_id;
- issued_at;
- not_before opcional;
- expires_at opcional;
- activation_status;
- offline_authorization;
- policy_version;
- request_checksum;
- signing_key_id;
- signature.

La respuesta debe quedar vinculada criptográficamente a la solicitud original.

## Replay

Se considera replay cuando:

- se reutiliza una respuesta ya aplicada;
- se importa en otra instalación;
- se presenta en otro dispositivo;
- se modifica el request asociado;
- se altera el nonce;
- se reutiliza una solicitud vencida;
- se intenta activar nuevamente una identidad revocada.

Política:

1. El replay se rechaza.
2. Una repetición idempotente válida devuelve el resultado existente.
3. El rechazo se audita.
4. No se crea una segunda activación.
5. El artefacto original se conserva como evidencia.

## Política de recuperación

La recuperación aplica cuando:

- se pierde la clave del dispositivo;
- se corrompe la instalación;
- se reinstala el sistema;
- se reemplaza hardware;
- se pierde el dispositivo;
- se restaura una copia antigua;
- la activación local no puede validarse.

La recuperación no restaura automáticamente confianza completa.

## Niveles de recuperación

### Recuperación con clave anterior

Aplica cuando el dispositivo todavía controla la clave anterior.

Requiere:

- prueba de posesión;
- activación previa válida;
- nueva identidad o instalación;
- autorización central;
- auditoría.

### Recuperación sin clave anterior

Aplica cuando la clave se perdió o el dispositivo no está disponible.

Requiere controles reforzados:

- identidad del tenant;
- actor autorizado;
- segundo factor o aprobación;
- motivo;
- revisión de riesgo;
- revocación de identidad anterior;
- nueva activación;
- auditoría completa.

## Flujo de reemplazo de dispositivo

Flujo conceptual:

1. Se solicita reemplazo.
2. Se identifica la activación anterior.
3. Se revisan operaciones pendientes.
4. Se revoca o retira la activación anterior.
5. Se registra motivo.
6. Se crea nueva identidad.
7. Se emite nueva activación.
8. Se conserva relación entre ambas.
9. Se sincronizan evidencias.
10. Se audita el proceso.

La revocación o retiro de la activación anterior, la creación de la nueva activación, el vínculo de reemplazo y la auditoría comparten una transacción central. La reconciliación de operaciones pendientes ocurre antes o después mediante el protocolo de `DEC-007` y no se simula como parte de una transacción distribuida.

## Operaciones pendientes durante reemplazo

Reglas:

1. Las operaciones pendientes no se eliminan.
2. Deben reconciliarse antes de descartar el equipo cuando sea posible.
3. Una operación aceptada no se reenvía.
4. Una operación no confirmada conserva identidad.
5. La recuperación no duplica ventas, pagos, caja ni inventario.
6. Las operaciones ambiguas pasan a revisión.
7. La clave del dispositivo anterior no se copia.
8. La nueva activación no hereda automáticamente la outbox antigua sin procedimiento controlado.
9. La evidencia forense se conserva cuando exista incidente.
10. `DEC-007` gobierna sincronización y recuperación operativa.

## Reactivación

La reactivación no modifica destructivamente la activación anterior.

Puede ocurrir después de:

- suspensión levantada;
- recuperación aprobada;
- renovación contractual;
- revisión completada;
- actualización de política.

Reglas:

1. Requiere autorización central.
2. Conserva historial.
3. No borra revocaciones anteriores.
4. Puede emitir nueva versión o nueva activación.
5. Debe verificar límites y derechos vigentes.
6. No reutiliza una clave comprometida.
7. La reactivación offline requiere artefacto firmado específico.

## Continuidad sin conectividad

El dispositivo puede continuar únicamente según:

- activación válida;
- licencia verificable;
- autorización offline;
- gracia vigente;
- estado de confianza;
- versión soportada;
- políticas locales sincronizadas.

La desconexión por sí sola no autoriza:

- nuevas activaciones;
- nuevas gracias;
- ampliación de límites;
- nuevos módulos;
- reactivaciones;
- eliminación de revocaciones.

# Vigencia, gracia y confianza temporal

La evaluación temporal no dependerá exclusivamente del reloj local del dispositivo.

El sistema combinará:

- tiempos firmados;
- última evidencia central confiable;
- calidad del reloj local;
- secuencias monotónicas;
- política de gracia;
- estado de activación;
- versión de licencia.

## Fuentes temporales

Se distinguen:

- `issued_at`;
- `not_before`;
- `expires_at`;
- `starts_at`;
- `ends_at`;
- `last_trusted_server_time`;
- `last_successful_validation_at`;
- `device_local_time`;
- `monotonic_elapsed_time`;
- `clock_quality`.

El reloj local es evidencia contextual, no autoridad absoluta.

## Tiempo central confiable

El servidor central es la fuente principal para:

- emisión;
- expiración;
- inicio y fin de gracia;
- revocación;
- secuencias;
- reactivación;
- renovación;
- actualización de política.

Cuando existe conectividad, el dispositivo registra:

- tiempo central;
- tiempo local observado;
- desviación;
- versión de política;
- firma o evidencia de autenticidad;
- momento monotónico local.

## Tiempo monotónico

El tiempo monotónico se utiliza para detectar:

- retroceso del reloj;
- reinicios;
- pausas anómalas;
- discrepancias grandes;
- reutilización de artefactos.

No reemplaza al tiempo civil central.

## Calidad del reloj

Valores conceptuales:

- `TRUSTED`;
- `DEGRADED`;
- `UNTRUSTED`;
- `UNKNOWN`.

La calidad se determina a partir de:

- desviación frente al servidor;
- retrocesos detectados;
- cambios abruptos;
- consistencia monotónica;
- antigüedad de la última validación;
- integridad del dispositivo.

## Rollback del reloj

Existe rollback cuando el reloj local retrocede de forma incompatible con evidencia previa.

Reglas:

1. El rollback no renueva vigencia.
2. El rollback no reinicia gracia.
3. El rollback no elimina expiraciones.
4. El rollback degrada la calidad del reloj.
5. Operaciones sensibles pueden bloquearse o pasar a revisión.
6. Las operaciones ya confirmadas no se reescriben.
7. El evento se audita.
8. La recuperación requiere nueva evidencia temporal confiable.

## Adelanto del reloj

Un adelanto anómalo puede provocar expiración prematura aparente.

Reglas:

1. No se cancela una licencia únicamente por un adelanto local no confirmado.
2. Se compara con la última evidencia central.
3. Puede aplicarse modo restringido.
4. Se solicita validación central cuando sea posible.
5. El evento se audita.
6. No se amplía vigencia al corregir el reloj.

## Evaluación offline de vigencia

Sin conectividad, el dispositivo evalúa usando:

- artefactos firmados;
- última evidencia temporal confiable;
- tiempo monotónico transcurrido;
- calidad del reloj;
- política offline;
- gracia autorizada;
- estado de activación.

La evaluación offline debe ser conservadora y determinista.

## Política de gracia

La gracia es una autorización explícita para continuar temporalmente.

Debe definir:

- alcance;
- inicio;
- fin;
- módulos permitidos;
- módulos restringidos;
- operaciones permitidas;
- operaciones bloqueadas;
- política de sincronización;
- versión;
- secuencia.

La gracia no se deduce de:

- fallo de red;
- error criptográfico;
- reloj incorrecto;
- ausencia de validación;
- reinstalación;
- copia de archivos.

## Inicio de gracia

La gracia puede iniciar por:

- estado contractual autorizado;
- vencimiento con autorización previa;
- indisponibilidad central bajo política;
- incidente administrativo aprobado.

El inicio debe quedar respaldado por artefacto verificable o política previamente firmada.

## Fin de gracia

La gracia finaliza por:

- vencimiento;
- revocación;
- reactivación;
- renovación;
- sustitución;
- sincronización con estado más restrictivo.

Una gracia finalizada no se reactiva localmente.

## Alcance de gracia

Durante gracia pueden permitirse, según política:

- lectura de datos;
- cierre de operaciones iniciadas;
- ventas básicas;
- impresión;
- sincronización;
- exportación;
- respaldo.

Pueden restringirse:

- nuevas activaciones;
- nuevos dispositivos;
- cambios de configuración;
- módulos premium;
- cambios fiscales;
- administración de licencias;
- operaciones de alto riesgo;
- actualizaciones mayores.

El alcance efectivo se deriva de la modalidad, la licencia firmada y sus políticas versionadas. No se codifica una lista global fija ni se amplían derechos por defecto.

## Operaciones iniciadas antes de restricción

Una operación iniciada antes de un cambio de estado puede completarse solo cuando:

- tiene identidad;
- usa snapshot verificable;
- no requiere derechos nuevos;
- no viola una revocación crítica;
- no compromete seguridad o fiscalidad;
- la política permite continuidad.

No se considera iniciada únicamente por abrir una pantalla.

## Estado temporal efectivo

Campos conceptuales:

- clock_quality;
- last_trusted_server_time;
- evaluated_local_time;
- monotonic_elapsed;
- rollback_detected;
- forward_jump_detected;
- grace_status;
- temporal_decision;
- reason_code;
- policy_version.

Valores de `temporal_decision`:

- `VALID`;
- `VALID_WITH_RESTRICTIONS`;
- `EXPIRED`;
- `REVIEW_REQUIRED`;
- `UNDETERMINED`.

## Reglas críticas de confianza temporal

1. Cambiar el reloj local no extiende derechos.
2. Reinstalar no reinicia gracia.
3. Copiar la base local no reinicia vigencia.
4. Un snapshot temporal antiguo no prevalece sobre una revocación más reciente.
5. La secuencia central prevalece sobre timestamps locales.
6. La desconexión no genera autorización nueva.
7. La expiración no elimina datos.
8. La recuperación temporal conserva auditoría.
9. Una discrepancia no se oculta.
10. El POS no inventa tiempo confiable.

# Custodia y ciclo de vida de claves

El sistema separa las claves según su función.

No se utilizará una única clave para:

- licencias;
- activaciones;
- revocaciones;
- actualizaciones;
- dispositivos;
- sesiones.

## Dominios de clave

Se distinguen conceptualmente:

- clave de firma de licencias;
- clave de firma de activaciones;
- clave de firma de revocaciones;
- clave de firma de actualizaciones;
- clave de identidad del dispositivo;
- claves operativas de sesión.

Cada dominio tiene:

- propósito;
- propietario;
- alcance;
- política de rotación;
- política de retiro;
- permisos;
- auditoría.

## Claves privadas centrales

Las claves privadas centrales:

- no se distribuyen al cliente;
- no se almacenan en repositorios;
- no se incluyen en imágenes de despliegue;
- no aparecen en variables de entorno sin protección;
- no se registran en logs;
- no se exportan sin control;
- requieren acceso mínimo;
- deben estar separadas por entorno.

El entorno de desarrollo no utiliza claves de producción.

## Custodia

La custodia debe garantizar:

1. acceso limitado por función;
2. separación de responsabilidades;
3. registro de uso;
4. rotación;
5. respaldo protegido cuando aplique;
6. recuperación controlada;
7. respuesta ante compromiso;
8. aislamiento entre ambientes;
9. revisión periódica;
10. revocación de acceso administrativo.

La tecnología concreta de custodia queda abierta hasta diseño de infraestructura.

## Identificador de clave

Cada clave pública confiable tiene un `key_id`.

Reglas:

1. `key_id` es estable durante la vida de la clave.
2. No contiene secretos.
3. No se reutiliza.
4. Permite seleccionar el verificador correcto.
5. Se incluye en artefactos firmados.
6. Su existencia no implica que la clave siga activa para nuevas firmas.

## Estado de clave central

Valores conceptuales:

- `PENDING`;
- `ACTIVE`;
- `ROTATING`;
- `VERIFY_ONLY`;
- `RETIRED`;
- `REVOKED`;
- `COMPROMISED`;
- `DESTROYED`.

Reglas:

1. Solo `ACTIVE` firma nuevos artefactos.
2. `VERIFY_ONLY` permite validar historia, pero no firmar.
3. `RETIRED` no firma artefactos nuevos.
4. `REVOKED` no debe aceptarse para nuevas autorizaciones.
5. `COMPROMISED` activa respuesta de incidente.
6. `DESTROYED` exige conservar evidencia de retiro.

## Rotación ordinaria

La rotación ordinaria ocurre por:

- calendario;
- cambio de política;
- cambio de proveedor;
- cambio de algoritmo;
- mantenimiento;
- separación de ambientes;
- reducción de riesgo.

Flujo conceptual:

1. Se genera nueva clave.
2. Se registra nuevo `key_id`.
3. Se distribuye material público confiable.
4. Se valida disponibilidad en clientes compatibles.
5. La nueva clave pasa a `ACTIVE`.
6. La anterior pasa a `VERIFY_ONLY`.
7. Se emiten nuevos artefactos con la nueva clave.
8. Se conserva verificación histórica.
9. Se retira la clave anterior según política.
10. Se audita todo el proceso.

## Rotación de emergencia

Aplica ante:

- sospecha de compromiso;
- acceso no autorizado;
- fuga;
- uso anómalo;
- pérdida de control;
- vulnerabilidad crítica.

Flujo conceptual:

1. Se bloquea la firma con la clave afectada.
2. Se clasifica el alcance.
3. Se genera clave nueva.
4. Se publica actualización de confianza.
5. Se revocan artefactos afectados cuando corresponda.
6. Se fuerzan validaciones o actualizaciones.
7. Se conserva evidencia.
8. Se ejecuta análisis posterior.

## Compatibilidad de verificación

El cliente puede conservar varias claves públicas confiables durante una ventana controlada.

Reglas:

1. Una clave antigua puede verificar historia.
2. No puede firmar artefactos nuevos.
3. La lista de claves confiables es versionada.
4. La retirada completa requiere comprobar compatibilidad.
5. Un cliente obsoleto puede quedar restringido.
6. No se acepta una clave desconocida por fallback.

## Distribución de material público

El material público puede distribuirse mediante:

- aplicación;
- actualización firmada;
- configuración firmada;
- canal administrativo controlado.

Reglas:

1. No se confía automáticamente en claves descargadas junto con el artefacto.
2. La actualización del conjunto de confianza debe ser autenticada.
3. La eliminación de una clave debe ser explícita.
4. La distribución debe ser reproducible.
5. El cliente conserva versión del conjunto confiable.

## Respaldo de claves centrales

El respaldo, cuando exista:

- debe estar cifrado;
- debe estar separado del servicio principal;
- debe requerir control de acceso reforzado;
- debe probarse;
- debe auditarse;
- no debe convertirse en un canal paralelo de firma.

No todas las claves requieren respaldo exportable. La decisión depende del mecanismo de custodia.

## Recuperación de claves centrales

La recuperación debe distinguir:

- pérdida operativa;
- corrupción;
- indisponibilidad temporal;
- compromiso;
- destrucción controlada.

Una clave comprometida no se restaura para continuar firmando.

## Destrucción

La destrucción de una clave:

- impide nuevas firmas;
- conserva metadatos;
- conserva `key_id`;
- conserva historial;
- registra actor y motivo;
- no elimina artefactos históricos.

## Separación por ambiente

Se requieren conjuntos independientes para:

- desarrollo;
- pruebas;
- staging;
- producción.

Un artefacto firmado en desarrollo no debe ser aceptado en producción.

## Separación por función

Se recomienda separar al menos:

- firma de licencias;
- firma de actualizaciones;
- firma de revocaciones.

La separación definitiva debe equilibrar:

- impacto de compromiso;
- complejidad operativa;
- costo;
- capacidad de rotación;
- mantenibilidad.

No se crearán claves distintas sin una frontera de riesgo real.

## Acceso administrativo

Las operaciones sensibles requieren:

- identidad fuerte;
- MFA;
- permiso específico;
- motivo;
- auditoría;
- aprobación adicional cuando corresponda.

No se permite acceso anónimo ni compartido.

## Auditoría de uso de claves

Debe registrar:

- `key_id`;
- tipo de operación;
- actor o servicio;
- fecha;
- artefacto;
- resultado;
- ambiente;
- correlación;
- motivo cuando aplique.

La auditoría no contiene claves privadas ni payloads sensibles completos.

## Compromiso de clave

Ante compromiso:

1. se detiene su uso;
2. se marca `COMPROMISED`;
3. se identifica el periodo afectado;
4. se determina qué artefactos requieren revocación;
5. se distribuye nueva confianza;
6. se emiten reemplazos cuando corresponda;
7. se notifican incidentes;
8. se conserva evidencia;
9. se revisan causas;
10. se actualizan controles.

## Reglas críticas de custodia criptográfica

1. Una clave privada central nunca reside en el POS.
2. Una clave de producción no se usa en desarrollo.
3. Una clave retirada no firma artefactos nuevos.
4. La rotación no invalida historia automáticamente.
5. Una clave comprometida no vuelve a `ACTIVE`.
6. El cliente no acepta claves arbitrarias.
7. La actualización de confianza debe ser autenticada.
8. La custodia no depende de conocimiento compartido informal.
9. El acceso se audita.
10. La complejidad criptográfica debe corresponder al riesgo real.

# Decisiones resueltas y diferidas

## Decisiones resueltas por DEC-008

Quedan definidas normativamente:

1. La custodia de claves privadas centrales.
2. La rotación ordinaria y de emergencia.
3. El retiro, revocación y estado `VERIFY_ONLY` de claves.
4. La identidad criptográfica del dispositivo.
5. La separación entre `device_id`, `installation_id` y `device_key_id`.
6. El uso de evidencia de hardware como señal secundaria.
7. La activación online y offline.
8. La prevención de replay.
9. El reemplazo y recuperación de dispositivos.
10. La recuperación con y sin clave anterior.
11. La política ante rollback y adelanto del reloj.
12. La compatibilidad versionada de payloads.
13. Las actualizaciones firmadas.
14. La revocación conocida durante operación offline.
15. La separación entre licencia, activación, dispositivo y derechos.
16. La degradación segura.
17. La auditoría y observabilidad.
18. Los códigos operativos y de error.

## Decisiones diferidas al diseño técnico

Las siguientes decisiones no bloquean el cierre arquitectónico, pero deberán resolverse antes de implementar producción:

1. Formato físico definitivo de los artefactos firmados.
2. Algoritmo criptográfico y parámetros concretos.
3. Proveedor o mecanismo de custodia de claves centrales.
4. Mecanismo de almacenamiento protegido por sistema operativo.
5. Formato físico para transportar solicitudes y respuestas offline.
6. Tolerancias exactas de desviación temporal.
7. Duraciones concretas de autorización offline y gracia.
8. Número concreto de activaciones por modalidad o plan.
9. Plataformas oficialmente soportadas.
10. Estrategia física de integridad de auditoría.
11. Política exacta de retención.
12. Procedimiento de migración desde instalaciones existentes.

## Condiciones obligatorias para decisiones diferidas

Toda decisión técnica posterior debe:

1. Preservar las invariantes de este documento.
2. Ser interoperable entre plataformas soportadas.
3. Evitar `float` o serializaciones ambiguas en campos firmados.
4. Usar canonicalización determinista.
5. Permitir rotación de claves.
6. Permitir validación histórica controlada.
7. No almacenar claves privadas centrales en clientes.
8. No basar identidad exclusivamente en hardware.
9. No permitir que el reloj local amplíe derechos.
10. No permitir replay.
11. Mantener aislamiento por tenant.
12. Ser auditable.
13. Tener estrategia de recuperación.
14. Ser verificable mediante pruebas automatizadas.
15. Quedar registrada mediante ADR, especificación técnica o decisión equivalente.

## Decisiones comerciales fuera de DEC-008

Permanecen fuera de esta decisión:

- duración comercial exacta de la gracia;
- cantidad contratada de dispositivos;
- precios;
- planes;
- módulos comercializados;
- periodos de soporte;
- condiciones de renovación.

Estos valores se configuran comercialmente, pero deben respetar la estructura y límites técnicos definidos por esta decisión.

## Migración desde instalaciones existentes

La migración deberá:

1. Detectar instalaciones sin identidad criptográfica.
2. Crear un nuevo `installation_id`.
3. Generar una clave de dispositivo.
4. Registrar o aprobar el dispositivo centralmente.
5. Emitir una activación verificable.
6. Conservar datos y operaciones existentes.
7. No convertir archivos antiguos en licencia válida sin verificación.
8. Detectar copias o instalaciones duplicadas.
9. Conservar trazabilidad de la migración.
10. Permitir revisión cuando la identidad anterior sea ambigua.

El procedimiento físico se materializará en migraciones nuevas durante implementación, siguiendo `docs/migration/avicola-baseline-migration.md` y antes de admitir datos productivos. Este trabajo no modifica la identidad ni las invariantes decididas aquí.

---

# Estado del documento

`DONE`

El documento contiene el contrato normativo completo de confianza, amenazas, activación, recuperación, revocación y actualizaciones. Los criterios posteriores conservan evidencia de su cierre y no representan trabajo pendiente.

# Modelo de amenazas

El modelo de amenazas se limita a licencias, activaciones, identidad de dispositivo, claves, operación offline, revocación y actualizaciones firmadas.

No sustituye el modelo de seguridad general.

## Activos protegidos

- claves privadas centrales;
- claves privadas de dispositivo;
- conjunto de claves públicas confiables;
- licencias firmadas;
- activaciones firmadas;
- revocaciones;
- autorizaciones de gracia;
- identidad de dispositivo;
- derechos y límites;
- historial de activaciones;
- operaciones pendientes;
- artefactos de actualización;
- auditoría.

## Fronteras de confianza

Se distinguen:

- servicio central;
- infraestructura de custodia;
- servicio de activación;
- canal de transporte;
- aplicación POS;
- almacenamiento local;
- sistema operativo;
- operador;
- soporte;
- dispositivo externo usado para transportar artefactos offline.

El canal de transporte no se considera confiable por defecto.

## Amenaza: falsificación de licencia

Ataque:

- crear un artefacto que aparente ser una licencia válida;
- cambiar derechos, límites o vigencia;
- sustituir tenant;
- cambiar modalidad;
- habilitar módulos no contratados.

Controles:

1. Firma verificable.
2. Canonicalización determinista.
3. `payload_version`.
4. `signing_key_id`.
5. Rechazo de claves desconocidas.
6. Verificación de tenant.
7. Verificación de estructura.
8. Auditoría de fallos.

Resultado seguro:

- `DENY`;
- evidencia conservada;
- sin gracia automática.

## Amenaza: copia de licencia

Ataque:

- copiar la licencia a otro equipo;
- reutilizarla en otra instalación;
- clonar la base local;
- restaurar una imagen del sistema.

Controles:

1. Activación separada de licencia.
2. Vínculo con `device_id`.
3. Vínculo con `installation_id`.
4. Clave del dispositivo.
5. Prueba de posesión.
6. Detección de replay.
7. Límites centrales.
8. Revisión de clonación.

Resultado seguro:

- rechazo;
- degradación;
- revisión;
- revocación según evidencia.

## Amenaza: manipulación del reloj

Ataque:

- retroceder fecha;
- adelantar fecha;
- reiniciar gracia;
- extender vigencia;
- ocultar expiración.

Controles:

1. Tiempo central confiable.
2. Tiempo monotónico.
3. Secuencias.
4. Última evidencia confiable.
5. Calidad del reloj.
6. Detección de rollback.
7. Política offline firmada.

Resultado seguro:

- no extender derechos;
- degradar confianza;
- restringir o revisar.

## Amenaza: replay de activación

Ataque:

- reutilizar una respuesta offline;
- importar respuesta en otro dispositivo;
- duplicar una activación;
- reutilizar nonce;
- reenviar solicitud vencida.

Controles:

1. `request_id`.
2. Nonce impredecible.
3. Vínculo solicitud-respuesta.
4. Checksum.
5. Idempotencia.
6. Expiración.
7. Persistencia de requests aplicados.
8. Vínculo con dispositivo e instalación.

Resultado seguro:

- devolver resultado existente o rechazar;
- nunca crear una activación adicional.

## Amenaza: sustitución de clave pública

Ataque:

- entregar una clave pública falsa junto con la licencia;
- modificar el conjunto de confianza;
- forzar fallback a una clave no autorizada.

Controles:

1. Raíz de confianza previa.
2. Conjunto de confianza versionado.
3. Actualización firmada.
4. `key_id`.
5. No aceptar claves embebidas sin cadena confiable.
6. No permitir fallback inseguro.

Resultado seguro:

- rechazar artefacto;
- bloquear actualización de confianza;
- auditar.

## Amenaza: compromiso de clave central

Ataque:

- uso no autorizado para firmar;
- extracción de clave;
- abuso interno;
- fuga de credenciales.

Controles:

1. Custodia controlada.
2. Acceso mínimo.
3. Separación por ambiente.
4. Separación por función.
5. MFA administrativo.
6. Auditoría de uso.
7. Rotación.
8. Respuesta de emergencia.

Resultado seguro:

- detener firma;
- marcar clave comprometida;
- rotar;
- revocar artefactos afectados;
- conservar evidencia.

## Amenaza: extracción de clave del dispositivo

Ataque:

- leer archivo local;
- copiar backup;
- inspeccionar memoria;
- ejecutar software malicioso;
- clonar la instalación.

Controles:

1. Almacenamiento protegido.
2. No usar archivos planos.
3. Acceso limitado al proceso.
4. Clave no exportable cuando la plataforma lo permita.
5. No incluir secretos en backups.
6. Rotación.
7. Revocación.
8. Detección de uso concurrente incompatible.

Resultado seguro:

- degradar o revocar;
- requerir recuperación;
- no transferir confianza automáticamente.

## Amenaza: downgrade

Ataque:

- instalar una versión antigua vulnerable;
- usar un payload anterior;
- restaurar una política antigua;
- volver a confiar en una clave retirada.

Controles:

1. Versiones mínimas permitidas.
2. Secuencias monotónicas.
3. Payload versionado.
4. Conjunto de confianza versionado.
5. Política de compatibilidad.
6. Bloqueo de versiones retiradas.
7. Actualización firmada.

Resultado seguro:

- restringir;
- requerir actualización;
- no aceptar un estado anterior más permisivo.

## Amenaza: revocación omitida

Ataque:

- borrar caché local;
- restaurar una copia antigua;
- evitar sincronización;
- eliminar registros locales;
- operar indefinidamente offline.

Controles:

1. Revocaciones firmadas.
2. Secuencia central.
3. Persistencia local.
4. Evidencia de última sincronización.
5. Límites de operación offline.
6. Gracia explícita.
7. Reconciliación obligatoria.
8. Protección contra rollback.

Resultado seguro:

- aplicar toda revocación conocida;
- restringir al superar la política offline;
- conservar historial;
- requerir sincronización o revisión.

## Amenaza: abuso de soporte

Ataque:

- emitir activaciones fuera del flujo;
- cambiar licencias manualmente;
- revocar sin autorización;
- reemplazar dispositivos fraudulentamente;
- omitir controles por urgencia operativa.

Controles:

1. Acceso temporal.
2. Permisos específicos.
3. MFA.
4. Motivo obligatorio.
5. Aprobación adicional cuando corresponda.
6. Auditoría.
7. Notificación al propietario.
8. Separación de funciones.

Resultado seguro:

- rechazar la operación;
- requerir revisión;
- conservar evidencia completa.

## Amenaza: denegación de servicio

Ataque:

- impedir validación central;
- saturar activaciones;
- bloquear distribución de revocaciones;
- dañar almacenamiento local;
- forzar reintentos indefinidos.

Controles:

1. Caché verificable.
2. Operación offline autorizada.
3. Rate limiting.
4. Reintentos controlados.
5. Backoff.
6. Recuperación local.
7. Modos degradados.
8. Observabilidad.
9. Límites de cola.
10. Protección contra tormentas de reintentos.

Resultado seguro:

- continuidad limitada;
- no autoautorizar derechos;
- no perder operaciones confirmadas;
- no saturar servicios ni dispositivos.

## Amenaza: exfiltración por logs

Ataque:

- registrar tokens;
- registrar claves;
- registrar payloads completos;
- registrar identificadores sensibles;
- registrar pruebas de posesión.

Controles:

1. Redacción.
2. Allowlist de campos.
3. No registrar secretos.
4. Acceso restringido.
5. Retención limitada.
6. Auditoría de acceso.
7. Separación entre logs técnicos y auditoría.
8. Revisión de trazas en desarrollo y producción.

Resultado seguro:

- logs útiles;
- sin material criptográfico sensible;
- sin exposición innecesaria de datos.

## Amenaza: actualización maliciosa

Ataque:

- instalar un binario modificado;
- entregar una actualización falsa;
- sustituir claves de confianza;
- ejecutar un downgrade;
- introducir código no autorizado.

Controles:

1. Actualización firmada.
2. Verificación antes de instalar.
3. Versión mínima permitida.
4. Separación de clave de actualización.
5. Rollback controlado.
6. Auditoría.
7. Canal autenticado cuando exista.
8. Verificación posterior a instalación.
9. Conservación de versión funcional previa cuando aplique.

Resultado seguro:

- no instalar;
- conservar versión funcional;
- alertar;
- requerir recuperación o revisión.

## Degradación segura

Ante incertidumbre, el sistema debe elegir explícitamente entre:

- permitir;
- permitir con restricciones;
- denegar;
- requerir revisión.

No debe:

- borrar datos;
- invalidar ventas confirmadas;
- inventar gracia;
- ampliar derechos;
- ignorar una firma inválida;
- aceptar claves desconocidas;
- reactivar dispositivos revocados;
- ocultar inconsistencias;
- sustituir evidencia por valores locales no confiables.

## Criterios de degradación

La degradación debe considerar:

- validez criptográfica;
- estado contractual;
- activación;
- confianza del dispositivo;
- calidad del reloj;
- revocaciones conocidas;
- antigüedad de la última validación;
- versión de aplicación;
- sensibilidad de la operación;
- capacidad de recuperación.

Una falla de conectividad no debe tratarse igual que una falla criptográfica.

## Operaciones permitidas en modo degradado

Según la política firmada pueden mantenerse:

- consulta de datos;
- cierre de operaciones ya iniciadas;
- impresión;
- exportación;
- respaldo;
- sincronización;
- diagnóstico;
- recuperación.

No deben habilitarse automáticamente:

- nuevas activaciones;
- ampliación de módulos;
- cambios fiscales;
- administración de licencias;
- nuevas gracias;
- reemplazos;
- operaciones de alto riesgo;
- cambios de confianza.

## Prioridad de protección

Orden conceptual:

1. Integridad de datos confirmados.
2. Protección de claves y material de confianza.
3. Aislamiento por tenant.
4. Prevención de falsificación.
5. Prevención de duplicación.
6. Trazabilidad.
7. Continuidad operativa controlada.
8. Disponibilidad de funciones no críticas.

La disponibilidad no justifica eliminar controles de integridad, autoridad o aislamiento.

## Riesgo residual

Persisten riesgos que no pueden eliminarse completamente:

- dispositivo totalmente comprometido;
- malware con privilegios elevados;
- extracción física avanzada;
- pérdida prolongada de conectividad;
- error administrativo;
- abuso interno;
- compromiso simultáneo de varios controles;
- imposibilidad de distribuir una revocación a un equipo permanentemente aislado;
- restauración de imágenes antiguas;
- manipulación de hardware;
- fallos del almacenamiento protegido;
- pérdida irreversible de una clave local.

Estos riesgos requieren:

- monitoreo;
- límites offline;
- recuperación;
- revocación;
- auditoría;
- controles compensatorios;
- revisión periódica.

## Principio de proporcionalidad

No se agregará un control si:

- no responde a una amenaza identificada;
- duplica otro control sin reducir riesgo;
- impide operación legítima sin beneficio verificable;
- aumenta complejidad sin mejorar recuperación;
- crea dependencia innecesaria;
- no puede probarse;
- no puede mantenerse.

La seguridad debe ser verificable, operable y proporcional al riesgo real.

# Actualizaciones firmadas

Las actualizaciones forman parte de la cadena de confianza.

Una aplicación comprometida no puede convertirse en una autoridad para validar licencias.

Toda actualización debe preservar la continuidad de confianza.

## Objetivos

Garantizar:

- autenticidad;
- integridad;
- origen verificable;
- compatibilidad;
- recuperación;
- auditoría.

Nunca debe asumirse confianza por el simple hecho de que un archivo pueda ejecutarse.

## Alcance

Incluye:

- aplicación POS;
- servicios locales;
- componentes auxiliares;
- políticas;
- certificados públicos;
- listas de confianza;
- reglas firmadas;
- migraciones autorizadas.

No incluye datos comerciales del cliente.

## Principios de actualización

1. Toda actualización debe verificarse antes de instalarse.

2. Ninguna actualización cambia automáticamente derechos de licencia.

3. Ninguna actualización reemplaza evidencia histórica.

4. Una actualización nunca invalida ventas confirmadas.

5. Las políticas de confianza evolucionan mediante versiones verificables.

6. La aplicación nunca confía en binarios no firmados.

7. La confianza se hereda únicamente desde una raíz válida.

## Artefacto de actualización

Campos conceptuales mínimos:

- update_id;
- update_version;
- component_id;
- target_platform;
- architecture;
- release_channel;
- issued_at;
- minimum_supported_version;
- target_version;
- payload_hash;
- package_size;
- compatibility_policy;
- migration_policy;
- rollback_policy;
- signing_key_id;
- signature.

Todos los campos que afectan instalación, compatibilidad o confianza deben estar cubiertos por la firma.

## Verificación previa

Antes de instalar, el cliente debe validar:

1. firma;
2. `signing_key_id`;
3. versión del manifiesto;
4. hash del paquete;
5. plataforma;
6. arquitectura;
7. canal;
8. versión mínima;
9. compatibilidad con licencia;
10. compatibilidad con esquema;
11. política de rollback;
12. revocaciones conocidas.

Una falla de verificación impide la instalación.

## Descarga

La descarga puede reintentarse.

Reglas:

1. Una descarga parcial no se instala.
2. El hash se valida sobre el artefacto completo.
3. El canal de transporte no sustituye la firma.
4. El archivo temporal no se considera confiable.
5. Los reintentos no cambian identidad de actualización.
6. Una descarga corrupta se elimina de forma segura.
7. El cliente evita tormentas de reintentos.

## Instalación

La instalación debe:

- verificar nuevamente el artefacto;
- conservar evidencia;
- registrar versión anterior;
- validar espacio disponible;
- bloquear concurrencia;
- proteger datos locales;
- ejecutar migraciones autorizadas;
- confirmar resultado;
- recuperar ante fallo.

La instalación no debe:

- borrar datos comerciales;
- reemplazar claves privadas de dispositivo;
- ampliar licencias;
- eliminar auditoría;
- ejecutar scripts no declarados;
- aceptar artefactos sin firma.

## Migraciones

Las migraciones incluidas en una actualización:

1. deben estar versionadas;
2. deben ser reproducibles;
3. deben declarar compatibilidad;
4. deben ejecutarse una sola vez;
5. deben conservar evidencia;
6. no deben reescribir historia silenciosamente;
7. deben tener estrategia de recuperación;
8. deben respetar aislamiento por tenant;
9. deben probarse antes de producción.

Una actualización válida no implica que toda migración sea segura para ejecutar automáticamente.

## Rollback

El rollback solo se permite cuando:

- está definido;
- la versión anterior sigue siendo confiable;
- el esquema es compatible;
- no revive vulnerabilidades prohibidas;
- no restaura políticas revocadas;
- no pierde datos.

El rollback no puede:

- volver a una clave retirada;
- reducir secuencias centrales;
- eliminar revocaciones;
- reactivar licencias;
- restaurar una política más permisiva sin autorización.

## Fallo de actualización

Ante fallo:

1. se conserva la última versión funcional cuando sea posible;
2. se registra el punto de fallo;
3. no se marca como instalada;
4. no se repite indefinidamente;
5. se permite diagnóstico;
6. se conserva evidencia;
7. se aplica recuperación o rollback autorizado.

## Actualización de confianza

La actualización del conjunto de claves confiables requiere:

- artefacto firmado por una raíz ya confiable;
- versión monotónica;
- lista explícita de altas;
- lista explícita de retiros;
- vigencia;
- compatibilidad;
- auditoría.

No se permite reemplazar todo el conjunto de confianza mediante configuración local no firmada.

## Canales

Valores conceptuales:

- `STABLE`;
- `CONTROLLED`;
- `PREVIEW`;
- `EMERGENCY`.

La licencia o política puede limitar canales permitidos.

Una actualización `PREVIEW` no debe instalarse en producción sin autorización explícita.

## Revocación de actualización

Una actualización puede revocarse por:

- vulnerabilidad;
- corrupción;
- incompatibilidad;
- error crítico;
- firma comprometida.

La revocación debe:

- identificar versión;
- indicar alcance;
- declarar acción requerida;
- estar firmada;
- conservar auditoría.

## Reglas críticas de actualización

1. Un paquete no firmado no se instala.
2. Una firma válida no reemplaza las pruebas de compatibilidad.
3. Una actualización no amplía derechos.
4. Una actualización no borra datos confirmados.
5. Una migración fallida no se oculta.
6. Un rollback no revive confianza retirada.
7. El cliente conserva evidencia de versión instalada.
8. La misma actualización es idempotente.
9. Las claves de actualización se separan cuando el riesgo lo justifica.
10. Toda actualización crítica debe poder auditarse.

# Auditoría y observabilidad

La confianza de licencias y dispositivos debe ser observable y auditable.

La observabilidad permite detectar degradación, abuso, fallos y desincronización.

La auditoría conserva evidencia de decisiones y cambios críticos.

## Principios de auditoría

1. La auditoría es append-only.
2. Los eventos críticos no se sobrescriben.
3. Los logs técnicos no sustituyen la auditoría.
4. La auditoría no contiene claves privadas.
5. Los secretos se redactan.
6. Los payloads completos solo se conservan cuando exista justificación y protección.
7. Toda decisión debe incluir motivo verificable.
8. Las correlaciones deben permitir reconstruir el flujo.
9. La observabilidad debe aislar tenants.
10. La retención debe ser explícita.

## Eventos auditables mínimos

Se auditan:

- emisión de licencia;
- sustitución de licencia;
- suspensión;
- cancelación;
- renovación;
- emisión de activación;
- activación offline;
- reactivación;
- revocación;
- reemplazo de dispositivo;
- recuperación;
- rotación de clave;
- cambio del conjunto de confianza;
- autorización de gracia;
- agotamiento de gracia;
- detección de rollback de reloj;
- detección de clonación;
- fallo de firma;
- clave desconocida;
- replay;
- actualización instalada;
- actualización fallida;
- rollback de actualización;
- intervención de soporte.

## Campos mínimos de auditoría

- audit_event_id;
- tenant_id;
- company_id opcional;
- branch_id opcional;
- actor_type;
- actor_id opcional;
- device_id opcional;
- installation_id opcional;
- license_id opcional;
- activation_id opcional;
- event_type;
- result;
- reason_code;
- policy_version;
- payload_version opcional;
- signing_key_id opcional;
- correlation_id;
- causation_id opcional;
- occurred_at;
- recorded_at;
- evidence_reference opcional.

## Actor

Valores conceptuales:

- `USER`;
- `DEVICE`;
- `SERVICE`;
- `SUPPORT`;
- `ADMINISTRATOR`;
- `SYSTEM`;
- `EXTERNAL_PROVIDER`.

Un evento automatizado debe identificar el servicio o proceso responsable.

## Resultado

Valores conceptuales:

- `SUCCESS`;
- `REJECTED`;
- `FAILED`;
- `REVIEW_REQUIRED`;
- `DEGRADED`;
- `PARTIAL`.

## Correlación

Toda operación crítica debe conservar:

- `correlation_id`;
- `operation_id` cuando aplique;
- `request_id`;
- `response_id`;
- `activation_id`;
- `license_id`;
- `device_id`.

La correlación no debe depender únicamente de timestamps.

## Métricas operativas

Métricas mínimas:

- activaciones exitosas;
- activaciones rechazadas;
- activaciones offline;
- replays detectados;
- firmas inválidas;
- claves desconocidas;
- dispositivos degradados;
- dispositivos revocados;
- licencias en gracia;
- fallos de actualización;
- rotaciones de clave;
- operaciones de soporte;
- antigüedad de última validación;
- profundidad de cola de sincronización;
- tiempo de recuperación.

## Indicadores de riesgo

Se consideran señales relevantes:

- múltiples activaciones desde una misma identidad;
- una clave usada desde instalaciones incompatibles;
- repetidos fallos de firma;
- cambios frecuentes de hardware;
- rollback de reloj;
- replays;
- uso prolongado offline;
- soporte recurrente sobre la misma licencia;
- intentos con claves retiradas;
- downgrade repetido;
- instalación de artefactos rechazados.

Una señal no implica automáticamente fraude.

Debe combinarse con contexto y política.

## Alertas

Alertas recomendadas:

- clave central comprometida;
- firma inválida repetida;
- revocación no aplicada;
- dispositivo revocado activo;
- activación duplicada;
- uso concurrente incompatible;
- gracia agotada;
- cliente demasiado desactualizado;
- actualización crítica fallida;
- manipulación del conjunto de confianza;
- acceso administrativo anómalo.

Las alertas deben tener severidad, propietario y procedimiento de respuesta.

## Severidad

Valores conceptuales:

- `INFO`;
- `LOW`;
- `MEDIUM`;
- `HIGH`;
- `CRITICAL`.

La severidad debe derivarse del impacto y probabilidad, no del nombre del evento.

## Retención

La política de retención debe diferenciar:

- auditoría contractual;
- auditoría de seguridad;
- logs técnicos;
- evidencias de incidente;
- métricas agregadas.

Reglas:

1. La auditoría contractual no se elimina antes del plazo definido.
2. Los logs técnicos pueden tener menor retención.
3. Los secretos no se conservan por retención.
4. La eliminación debe ser auditada.
5. Las retenciones se configuran por política y obligación aplicable.
6. La retención no rompe integridad referencial de evidencia.

## Privacidad

La observabilidad debe minimizar:

- datos personales;
- identificadores de hardware;
- payloads;
- información contractual sensible;
- datos de terceros.

Se aplican:

- minimización;
- redacción;
- control de acceso;
- retención;
- trazabilidad;
- propósito definido.

## Diagnóstico local

El POS puede exponer información de diagnóstico controlada:

- estado de licencia;
- estado de activación;
- calidad del reloj;
- versión de política;
- versión de aplicación;
- último contacto central;
- razón de restricción;
- estado de actualización;
- identificadores de soporte no sensibles.

No debe mostrar:

- claves;
- firmas completas;
- secretos;
- tokens reutilizables;
- datos de otros tenants.

## Acceso de soporte

El soporte solo accede a evidencia mediante:

- autorización;
- alcance;
- duración;
- motivo;
- auditoría;
- revocación.

Una exportación de diagnóstico debe estar protegida y tener vigencia limitada.

## Integridad de auditoría

La implementación debe detectar:

- eliminación;
- reordenamiento;
- modificación;
- truncamiento;
- duplicación.

El mecanismo concreto puede usar:

- secuencias;
- hashes encadenados;
- almacenamiento append-only;
- firma;
- controles equivalentes.

La técnica definitiva se decide en diseño físico e infraestructura.

## Reglas críticas de auditoría

1. Una operación crítica sin auditoría se considera incompleta.
2. Un fallo de auditoría no debe ocultarse.
3. No se registran claves privadas.
4. No se registran tokens reutilizables.
5. Un tenant no consulta auditoría de otro.
6. Soporte no elimina evidencia.
7. La correlación debe ser estable.
8. Las alertas no modifican estado por sí solas.
9. La retención es explícita.
10. La observabilidad no sustituye controles preventivos.

# Estados operativos y códigos de error

Los estados operativos representan el resultado observable de la evaluación.

Los códigos de error identifican una causa concreta y estable.

No se utilizarán mensajes libres como contrato entre componentes.

## Principios de estados y errores

1. Cada rechazo tiene un código estable.
2. El mensaje visible puede cambiar sin alterar el código.
3. Los códigos no contienen información sensible.
4. Un mismo código conserva significado.
5. Los códigos se versionan cuando cambia su semántica.
6. El frontend no inventa causas.
7. Los códigos permiten auditoría y soporte.
8. Los errores internos no se exponen directamente al usuario.
9. Los estados operativos no sustituyen los estados del dominio.
10. Una causa desconocida no se representa como éxito.

## Estado operativo general

Valores conceptuales:

- `READY`;
- `READY_WITH_RESTRICTIONS`;
- `OFFLINE_AUTHORIZED`;
- `GRACE_ACTIVE`;
- `DEGRADED`;
- `BLOCKED`;
- `REVIEW_REQUIRED`;
- `RECOVERY_REQUIRED`;
- `UPDATE_REQUIRED`;
- `UNAVAILABLE`.

## Resultado de evaluación

Campos conceptuales:

- decision;
- operational_status;
- reason_code;
- severity;
- retryable;
- user_action_required;
- support_reference opcional;
- policy_version;
- evaluated_at;
- expires_at opcional.

## Códigos de firma

- `LICENSE_SIGNATURE_INVALID`;
- `LICENSE_SIGNING_KEY_UNKNOWN`;
- `LICENSE_ALGORITHM_UNSUPPORTED`;
- `LICENSE_PAYLOAD_MALFORMED`;
- `LICENSE_PAYLOAD_VERSION_UNSUPPORTED`;
- `ACTIVATION_SIGNATURE_INVALID`;
- `REVOCATION_SIGNATURE_INVALID`;
- `UPDATE_SIGNATURE_INVALID`;
- `TRUST_STORE_INVALID`.

## Códigos contractuales

- `LICENSE_NOT_YET_VALID`;
- `LICENSE_EXPIRED`;
- `LICENSE_PAST_DUE`;
- `LICENSE_SUSPENDED`;
- `LICENSE_CANCELLED`;
- `LICENSE_REPLACED`;
- `LICENSE_TENANT_MISMATCH`;
- `LICENSE_DEPLOYMENT_MODE_MISMATCH`.

## Códigos de derechos y límites

- `FEATURE_NOT_ENTITLED`;
- `FEATURE_RESTRICTED`;
- `DEVICE_LIMIT_REACHED`;
- `BRANCH_LIMIT_REACHED`;
- `APP_VERSION_NOT_ALLOWED`;
- `OFFLINE_MODE_NOT_ALLOWED`;
- `LICENSE_LIMIT_EVALUATION_FAILED`.

## Códigos de activación

- `ACTIVATION_REQUIRED`;
- `ACTIVATION_PENDING`;
- `ACTIVATION_INVALID`;
- `ACTIVATION_EXPIRED`;
- `ACTIVATION_SUSPENDED`;
- `ACTIVATION_REVOKED`;
- `ACTIVATION_REPLACED`;
- `ACTIVATION_TENANT_MISMATCH`;
- `ACTIVATION_DEVICE_MISMATCH`;
- `ACTIVATION_INSTALLATION_MISMATCH`;
- `ACTIVATION_DUPLICATE_REQUEST`;
- `ACTIVATION_REVIEW_REQUIRED`.

## Códigos de dispositivo

- `DEVICE_UNKNOWN`;
- `DEVICE_UNTRUSTED`;
- `DEVICE_DEGRADED`;
- `DEVICE_REVOKED`;
- `DEVICE_KEY_MISSING`;
- `DEVICE_KEY_INVALID`;
- `DEVICE_KEY_REVOKED`;
- `DEVICE_KEY_COMPROMISED`;
- `DEVICE_PROOF_INVALID`;
- `DEVICE_CLONE_SUSPECTED`;
- `DEVICE_HARDWARE_CHANGE_REVIEW_REQUIRED`.

## Códigos de activación offline

- `OFFLINE_REQUEST_INVALID`;
- `OFFLINE_REQUEST_EXPIRED`;
- `OFFLINE_REQUEST_REPLAYED`;
- `OFFLINE_RESPONSE_INVALID`;
- `OFFLINE_RESPONSE_EXPIRED`;
- `OFFLINE_RESPONSE_REPLAYED`;
- `OFFLINE_RESPONSE_REQUEST_MISMATCH`;
- `OFFLINE_RESPONSE_DEVICE_MISMATCH`;
- `OFFLINE_RESPONSE_INSTALLATION_MISMATCH`;
- `OFFLINE_ACTIVATION_NOT_ALLOWED`.

## Códigos temporales

- `CLOCK_QUALITY_UNKNOWN`;
- `CLOCK_DEGRADED`;
- `CLOCK_UNTRUSTED`;
- `CLOCK_ROLLBACK_DETECTED`;
- `CLOCK_FORWARD_JUMP_DETECTED`;
- `TRUSTED_TIME_EXPIRED`;
- `TEMPORAL_STATE_UNDETERMINED`;
- `GRACE_NOT_AUTHORIZED`;
- `GRACE_NOT_STARTED`;
- `GRACE_ACTIVE`;
- `GRACE_EXHAUSTED`;
- `GRACE_REVOKED`.

## Códigos de revocación

- `LICENSE_REVOKED`;
- `ACTIVATION_REVOKED`;
- `DEVICE_REVOKED`;
- `SIGNING_KEY_REVOKED`;
- `UPDATE_KEY_REVOKED`;
- `REVOCATION_SEQUENCE_ROLLBACK`;
- `REVOCATION_STATE_STALE`.

## Códigos de actualización

- `UPDATE_NOT_SIGNED`;
- `UPDATE_SIGNATURE_INVALID`;
- `UPDATE_KEY_UNKNOWN`;
- `UPDATE_PACKAGE_CORRUPTED`;
- `UPDATE_PLATFORM_MISMATCH`;
- `UPDATE_ARCHITECTURE_MISMATCH`;
- `UPDATE_CHANNEL_NOT_ALLOWED`;
- `UPDATE_VERSION_NOT_ALLOWED`;
- `UPDATE_COMPATIBILITY_FAILED`;
- `UPDATE_MIGRATION_FAILED`;
- `UPDATE_ROLLBACK_NOT_ALLOWED`;
- `UPDATE_REQUIRED`;
- `UPDATE_RECOVERY_REQUIRED`.

## Códigos de recuperación

- `RECOVERY_REQUIRED`;
- `RECOVERY_NOT_AUTHORIZED`;
- `RECOVERY_PREVIOUS_KEY_REQUIRED`;
- `RECOVERY_IDENTITY_VERIFICATION_FAILED`;
- `RECOVERY_APPROVAL_REQUIRED`;
- `RECOVERY_PREVIOUS_ACTIVATION_NOT_FOUND`;
- `RECOVERY_PENDING_OPERATIONS`;
- `RECOVERY_COMPLETED_WITH_RESTRICTIONS`.

## Códigos de seguridad y soporte

- `SUPPORT_ACCESS_REQUIRED`;
- `SUPPORT_ACCESS_EXPIRED`;
- `SUPPORT_PERMISSION_DENIED`;
- `SUPPORT_APPROVAL_REQUIRED`;
- `SECURITY_POLICY_VIOLATION`;
- `TENANT_ISOLATION_VIOLATION`;
- `AUDIT_PERSISTENCE_FAILED`;
- `RATE_LIMIT_EXCEEDED`;
- `REPLAY_DETECTED`;
- `DOWNGRADE_BLOCKED`.

## Clasificación de reintento

Cada error declara si es:

- `RETRYABLE`;
- `RETRYABLE_AFTER_SYNC`;
- `RETRYABLE_AFTER_UPDATE`;
- `RETRYABLE_AFTER_REAUTHENTICATION`;
- `NOT_RETRYABLE`;
- `REVIEW_REQUIRED`.

Ejemplos:

| Código | Clasificación |
|---|---|
| `RATE_LIMIT_EXCEEDED` | `RETRYABLE` |
| `TRUSTED_TIME_EXPIRED` | `RETRYABLE_AFTER_SYNC` |
| `UPDATE_REQUIRED` | `RETRYABLE_AFTER_UPDATE` |
| `LICENSE_SIGNATURE_INVALID` | `NOT_RETRYABLE` |
| `DEVICE_CLONE_SUSPECTED` | `REVIEW_REQUIRED` |
| `ACTIVATION_REVOKED` | `NOT_RETRYABLE` |

## Mensajes al usuario

Los mensajes deben:

- explicar la acción disponible;
- evitar lenguaje criptográfico innecesario;
- no revelar controles internos;
- incluir referencia de soporte cuando corresponda;
- distinguir problema temporal de bloqueo definitivo.

Ejemplos conceptuales:

| Código | Mensaje visible |
|---|---|
| `UPDATE_REQUIRED` | Actualice la aplicación para continuar. |
| `GRACE_ACTIVE` | El sistema funciona temporalmente con restricciones. |
| `DEVICE_REVOKED` | Este dispositivo ya no está autorizado. |
| `CLOCK_ROLLBACK_DETECTED` | La fecha del equipo requiere verificación. |
| `RECOVERY_REQUIRED` | Se requiere recuperar la activación. |

## Respuesta técnica

Una respuesta técnica mínima debe incluir:

- code;
- decision;
- operational_status;
- retryable;
- user_action;
- correlation_id;
- occurred_at;
- policy_version.

No debe incluir:

- stack trace;
- clave;
- token;
- firma completa;
- secretos;
- datos de otro tenant.

## Reglas críticas de estados y errores

1. Un error criptográfico no se representa como error de red.
2. Una revocación no se representa como expiración.
3. Un límite excedido no se representa como licencia inválida.
4. Una gracia agotada no se representa como firma inválida.
5. Una revisión requerida no se trata como éxito.
6. Un código desconocido produce comportamiento conservador.
7. Los códigos se auditan.
8. Los mensajes no son contratos técnicos.
9. El frontend no cambia decisiones.
10. La misma causa produce un código estable.

# Escenarios de aceptación

## Escenario 1 — Licencia válida y activación online

Dado:

- licencia firmada válida;
- tenant coincidente;
- contrato activo;
- dispositivo confiable;
- límite disponible;
- versión compatible;
- conectividad disponible.

Cuando:

1. el dispositivo solicita activación;
2. demuestra posesión de su clave;
3. el servidor valida licencia, dispositivo y límites;
4. emite una activación firmada;
5. el POS valida y persiste la respuesta.

Entonces:

- la activación queda `ACTIVE`;
- el dispositivo queda autorizado;
- los derechos efectivos corresponden al payload firmado;
- se registra auditoría;
- repetir la misma solicitud idempotente no crea otra activación.

## Escenario 2 — Licencia con firma inválida

Dado:

- un artefacto con estructura aparente de licencia;
- firma inválida o contenido modificado.

Cuando:

1. el POS intenta validarlo.

Entonces:

- `SignatureValidity = INVALID_SIGNATURE`;
- la decisión es `DENY`;
- no se inicia gracia;
- no se consulta el contenido como fuente de derechos;
- se registra `LICENSE_SIGNATURE_INVALID`;
- se conserva evidencia no sensible;
- no se altera la licencia válida anterior, si existe.

## Escenario 3 — Clave de firma desconocida

Dado:

- licencia firmada;
- `signing_key_id` no incluido en el conjunto confiable.

Cuando:

1. el POS intenta verificarla.

Entonces:

- la licencia no se acepta;
- no se descarga ni adopta automáticamente la clave incluida;
- se genera `LICENSE_SIGNING_KEY_UNKNOWN`;
- puede requerirse actualización del conjunto de confianza;
- no se produce fallback inseguro;
- no se crea activación.

## Escenario 4 — Activación offline válida

Dado:

- licencia compatible con activación offline;
- dispositivo con identidad criptográfica;
- solicitud offline vigente;
- respuesta firmada vinculada a la solicitud.

Cuando:

1. el operador importa la respuesta;
2. el POS verifica firma, nonce, request, tenant, dispositivo e instalación;
3. confirma que no fue aplicada anteriormente.

Entonces:

- la activación se persiste una sola vez;
- queda vinculada al dispositivo original;
- se registra evidencia;
- el POS puede operar según la política offline;
- el resultado se sincroniza posteriormente;
- importar nuevamente la misma respuesta devuelve el resultado existente.

## Escenario 5 — Replay de activación offline

Dado:

- una respuesta offline ya aplicada;
- intento de importarla nuevamente o usarla en otra instalación.

Cuando:

1. el POS valida `request_id`, nonce, dispositivo e instalación.

Entonces:

- no se crea una nueva activación;
- si es repetición idempotente en el mismo dispositivo, devuelve el resultado existente;
- si corresponde a otro dispositivo o instalación, se rechaza;
- se genera `OFFLINE_RESPONSE_REPLAYED` o el código de mismatch correspondiente;
- se registra auditoría;
- no se amplían derechos.

## Escenario 6 — Licencia expirada con gracia autorizada

Dado:

- licencia criptográficamente válida;
- contrato expirado;
- gracia firmada vigente;
- activación activa;
- dispositivo confiable;
- versión compatible.

Cuando:

1. el POS evalúa la licencia sin conexión;
2. valida la autorización de gracia;
3. verifica alcance, vigencia y secuencia.

Entonces:

- `GraceStatus = ACTIVE`;
- la decisión es `ALLOW_WITH_RESTRICTIONS`;
- solo se habilitan capacidades autorizadas;
- no se amplían módulos ni límites;
- se registra `GRACE_ACTIVE`;
- la gracia no se reinicia por reinstalación;
- la siguiente sincronización puede aplicar un estado más restrictivo.

## Escenario 7 — Gracia agotada

Dado:

- licencia válida;
- gracia previamente autorizada;
- `ends_at` ya superado según evidencia temporal confiable.

Cuando:

1. el POS evalúa continuidad offline.

Entonces:

- `GraceStatus = EXHAUSTED`;
- no se emite una gracia nueva localmente;
- se restringen o bloquean operaciones según política;
- se conserva acceso a recuperación, diagnóstico y datos permitidos;
- se registra `GRACE_EXHAUSTED`;
- no se eliminan datos;
- no se invalidan ventas confirmadas.

## Escenario 8 — Rollback del reloj local

Dado:

- última evidencia temporal central confiable;
- tiempo monotónico registrado;
- reloj local retrocedido de forma incompatible.

Cuando:

1. el POS evalúa vigencia o gracia.

Entonces:

- se detecta rollback;
- `clock_quality` pasa a `DEGRADED` o `UNTRUSTED`;
- no se extiende licencia ni gracia;
- operaciones sensibles se restringen o pasan a revisión;
- se registra `CLOCK_ROLLBACK_DETECTED`;
- las operaciones confirmadas no se recalculan;
- se requiere nueva evidencia temporal confiable para recuperar estado.

## Escenario 9 — Dispositivo revocado intenta operar

Dado:

- licencia válida;
- activación anteriormente válida;
- revocación firmada y conocida para el dispositivo.

Cuando:

1. el POS evalúa una capacidad;
2. el dispositivo intenta sincronizar o activar.

Entonces:

- `DeviceTrustStatus = REVOKED`;
- la decisión es `DENY`;
- no se permite nueva activación;
- no se sincronizan operaciones nuevas;
- las operaciones locales existentes no se eliminan;
- se registra `DEVICE_REVOKED`;
- se ofrece flujo de recuperación o soporte cuando corresponda.

## Escenario 10 — Reemplazo autorizado de dispositivo

Dado:

- dispositivo anterior dañado o retirado;
- actor autorizado;
- licencia vigente;
- límite de dispositivos controlado;
- operaciones pendientes revisadas;
- solicitud de reemplazo aprobada.

Cuando:

1. se identifica la activación anterior;
2. se revoca o retira;
3. se crea nueva identidad de dispositivo;
4. se emite nueva activación;
5. se registra la relación de reemplazo.

Entonces:

- la activación anterior conserva historial;
- la nueva activación usa nuevo `activation_id`;
- la clave privada anterior no se copia;
- los derechos no se amplían;
- las operaciones pendientes se reconcilian según `DEC-007`;
- se audita actor, motivo y evidencia;
- el nuevo dispositivo inicia con confianza explícitamente aprobada.

## Escenario 11 — Cambio menor de hardware

Dado:

- licencia válida;
- activación activa;
- clave del dispositivo intacta;
- `installation_id` sin cambios;
- variación menor en evidencia de hardware.

Cuando:

1. el POS detecta la variación;
2. conserva la identidad criptográfica válida;
3. aplica la política de evaluación de cambios.

Entonces:

- el dispositivo no se revoca automáticamente;
- puede permanecer `TRUSTED` o pasar a `DEGRADED`;
- no se crea nueva activación;
- se registra la evidencia;
- no se amplían ni reducen derechos sin política;
- puede solicitarse validación central posterior.

## Escenario 12 — Sospecha de clonación

Dado:

- misma clave de dispositivo;
- instalaciones incompatibles o uso concurrente;
- evidencia inconsistente.

Cuando:

1. el servidor o POS detecta el patrón;
2. correlaciona dispositivo, instalación, clave y activación.

Entonces:

- `DeviceTrustStatus = REVIEW_REQUIRED` o `UNTRUSTED`;
- se bloquean operaciones sensibles;
- no se eliminan datos;
- no se revoca automáticamente sin evidencia suficiente;
- se registra `DEVICE_CLONE_SUSPECTED`;
- se inicia revisión o recuperación controlada.

## Escenario 13 — Clave privada local perdida

Dado:

- licencia válida;
- activación histórica;
- clave privada del dispositivo no disponible;
- datos locales aún presentes.

Cuando:

1. el POS intenta probar posesión;
2. la prueba falla por ausencia de la clave.

Entonces:

- no se reutiliza la activación como si nada hubiera ocurrido;
- se genera `DEVICE_KEY_MISSING`;
- se inicia recuperación;
- la activación anterior conserva historial;
- no se copian secretos;
- las operaciones pendientes se preservan;
- la nueva confianza requiere autorización.

## Escenario 14 — Actualización firmada válida

Dado:

- paquete firmado;
- clave de actualización confiable;
- plataforma y arquitectura compatibles;
- versión permitida;
- migración aprobada;
- espacio suficiente.

Cuando:

1. el cliente descarga el paquete;
2. verifica manifiesto, firma y hash;
3. instala;
4. ejecuta migraciones autorizadas;
5. confirma resultado.

Entonces:

- la nueva versión queda instalada;
- se conserva evidencia de versión anterior;
- la licencia no cambia;
- los datos confirmados no se eliminan;
- la instalación es idempotente;
- se registra auditoría.

## Escenario 15 — Actualización con firma inválida

Dado:

- paquete descargado;
- firma inválida o hash diferente.

Cuando:

1. el cliente verifica antes de instalar.

Entonces:

- la instalación se rechaza;
- no se ejecutan migraciones;
- se conserva la versión funcional;
- se genera `UPDATE_SIGNATURE_INVALID` o `UPDATE_PACKAGE_CORRUPTED`;
- se registra evidencia;
- no se adopta ninguna clave incluida en el paquete;
- se alerta según severidad.

## Escenario 16 — Downgrade bloqueado

Dado:

- una versión instalada vigente;
- una versión anterior vulnerable o retirada;
- política mínima de versión conocida.

Cuando:

1. el operador intenta instalar la versión anterior;
2. el cliente compara versión, política y revocaciones.

Entonces:

- el downgrade se rechaza;
- no se ejecutan migraciones inversas;
- se genera `DOWNGRADE_BLOCKED`;
- la versión funcional permanece activa;
- no se restauran claves ni políticas retiradas;
- se registra auditoría.

## Escenario 17 — Rotación ordinaria de clave central

Dado:

- clave actual activa;
- nueva clave generada;
- material público distribuido;
- clientes compatibles.

Cuando:

1. la nueva clave pasa a `ACTIVE`;
2. la anterior pasa a `VERIFY_ONLY`;
3. se emiten nuevos artefactos con la nueva clave.

Entonces:

- los artefactos históricos siguen verificándose;
- la clave anterior no firma nuevas licencias;
- no se altera la vigencia de artefactos existentes;
- el conjunto de confianza conserva versión;
- se audita la transición;
- no hay interrupción injustificada del servicio.

## Escenario 18 — Compromiso de clave central

Dado:

- evidencia suficiente de compromiso;
- clave de producción afectada.

Cuando:

1. se detiene su uso;
2. se marca `COMPROMISED`;
3. se genera una clave nueva;
4. se distribuye nueva confianza;
5. se identifican artefactos afectados.

Entonces:

- la clave comprometida no vuelve a `ACTIVE`;
- se revocan o sustituyen artefactos cuando corresponda;
- se conserva evidencia;
- se emiten alertas;
- se ejecuta respuesta de incidente;
- los clientes obsoletos pueden quedar restringidos.

## Escenario 19 — Revocación conocida durante operación offline

Dado:

- dispositivo sin conexión;
- revocación firmada ya almacenada localmente;
- intento de usar la activación revocada.

Cuando:

1. el POS evalúa la activación.

Entonces:

- aplica la revocación local conocida;
- no permite continuar por estar offline;
- genera `ACTIVATION_REVOKED` o `DEVICE_REVOKED`;
- no elimina datos;
- conserva operaciones confirmadas;
- ofrece recuperación cuando corresponda;
- registra auditoría.

## Escenario 20 — Revocación posterior a una copia local antigua

Dado:

- copia local restaurada;
- snapshot anterior a una revocación;
- conectividad recuperada;
- secuencia central superior.

Cuando:

1. el dispositivo sincroniza;
2. compara secuencias y estado central.

Entonces:

- prevalece la revocación más reciente;
- el snapshot antiguo no restaura autorización;
- se actualiza el estado local;
- se registra `REVOCATION_STATE_STALE`;
- no se eliminan operaciones históricas;
- la discrepancia queda auditada;
- puede requerirse recuperación.

## Escenario 21 — Gracia revocada durante operación offline

Dado:

- autorización de gracia almacenada localmente;
- revocación de gracia firmada y conocida;
- dispositivo sin conexión.

Cuando:

1. el POS evalúa continuidad operativa.

Entonces:

- `GraceStatus = REVOKED`;
- la gracia deja de habilitar capacidades;
- no se reinicia ni extiende localmente;
- se aplican restricciones;
- se conserva acceso a recuperación y diagnóstico;
- se registra `GRACE_REVOKED`;
- no se eliminan datos.

## Escenario 22 — Uso prolongado sin validación central

Dado:

- licencia válida;
- activación activa;
- dispositivo confiable;
- periodo offline autorizado agotado;
- sin conectividad.

Cuando:

1. el POS evalúa una operación nueva.

Entonces:

- no extiende automáticamente la autorización offline;
- puede pasar a `READY_WITH_RESTRICTIONS`, `BLOCKED` o `REVIEW_REQUIRED`;
- conserva operaciones confirmadas;
- permite sincronización y recuperación;
- genera `TRUSTED_TIME_EXPIRED` o código equivalente;
- registra antigüedad de última validación;
- no inventa estado contractual.

## Escenario 23 — Intervención de soporte autorizada

Dado:

- incidente de activación;
- acceso temporal aprobado;
- operador autenticado;
- motivo registrado;
- alcance limitado.

Cuando:

1. soporte consulta evidencia;
2. ejecuta una acción permitida;
3. finaliza el acceso.

Entonces:

- toda acción queda auditada;
- el acceso expira;
- soporte no modifica payloads firmados;
- no elimina revocaciones;
- no emite licencias manualmente;
- se notifica cuando corresponda;
- se conserva correlación y evidencia.

## Escenario 24 — Intento de acceso de soporte no autorizado

Dado:

- usuario sin permiso;
- acceso temporal inexistente o expirado.

Cuando:

1. intenta consultar o modificar activaciones.

Entonces:

- la operación se rechaza;
- se genera `SUPPORT_PERMISSION_DENIED` o `SUPPORT_ACCESS_EXPIRED`;
- no se expone información sensible;
- se registra auditoría;
- puede generarse alerta;
- no se modifica ningún estado.

## Escenario 25 — Recuperación sin clave anterior

Dado:

- dispositivo perdido o destruido;
- clave anterior no disponible;
- licencia vigente;
- actor autorizado;
- identidad del tenant verificada.

Cuando:

1. se solicita recuperación;
2. se aplican controles reforzados;
3. se revoca la identidad anterior;
4. se crea nueva identidad;
5. se emite nueva activación.

Entonces:

- la clave anterior no se reutiliza;
- la activación anterior conserva historial;
- la nueva activación tiene identidad propia;
- los derechos no se amplían;
- las operaciones pendientes se tratan según evidencia disponible;
- se audita motivo, actor y aprobación;
- el nuevo dispositivo no hereda confianza sin validación.

# Pruebas mínimas

Las políticas de esta decisión deben validarse mediante pruebas automatizadas, pruebas de integración y pruebas operativas controladas.

Una prueba aprobada debe verificar el resultado, el código producido, la persistencia y la auditoría correspondiente.

## Pruebas criptográficas

1. Validar una licencia firmada correctamente.
2. Rechazar una licencia cuyo payload fue modificado.
3. Rechazar una firma modificada.
4. Rechazar una clave desconocida.
5. Rechazar un algoritmo no soportado.
6. Rechazar una versión de payload no soportada.
7. Validar artefactos históricos con una clave `VERIFY_ONLY`.
8. Impedir nuevas firmas con una clave retirada.
9. Rechazar artefactos firmados en otro ambiente.
10. Verificar canonicalización idéntica entre plataformas soportadas.

## Pruebas de licencia

1. Licencia activa y vigente.
2. Licencia aún no vigente.
3. Licencia expirada.
4. Licencia suspendida.
5. Licencia cancelada.
6. Tenant diferente.
7. Modalidad incompatible.
8. Módulo no autorizado.
9. Límite de dispositivos alcanzado.
10. Versión de aplicación no permitida.
11. Licencia perpetua con actualización mayor no incluida.
12. Sustitución por una versión más reciente.

## Pruebas de activación online

1. Activación válida.
2. Solicitud idempotente repetida.
3. Prueba de posesión inválida.
4. Dispositivo desconocido.
5. Instalación incompatible.
6. Activación duplicada.
7. Activación con licencia suspendida.
8. Activación después de alcanzar el límite.
9. Activación para otro tenant.
10. Respuesta firmada alterada.

## Pruebas de activación offline

1. Solicitud válida.
2. Respuesta válida.
3. Nonce modificado.
4. Request diferente.
5. Respuesta expirada.
6. Respuesta aplicada dos veces.
7. Respuesta utilizada en otro dispositivo.
8. Respuesta utilizada en otra instalación.
9. Solicitud modificada después de emitida.
10. Activación offline no autorizada por la licencia.
11. Importación sin conectividad.
12. Sincronización posterior del resultado.

## Pruebas de dispositivo

1. Clave local válida.
2. Clave local ausente.
3. Clave local revocada.
4. Clave local comprometida.
5. Cambio menor de hardware.
6. Cambio mayor de hardware.
7. Reinstalación limpia.
8. Imagen clonada.
9. Uso concurrente incompatible.
10. Rotación de clave.
11. Pérdida de almacenamiento protegido.
12. Dispositivo revocado.

## Pruebas temporales

1. Reloj correcto.
2. Reloj atrasado dentro de tolerancia.
3. Rollback significativo.
4. Adelanto significativo.
5. Reinicio del dispositivo.
6. Ausencia prolongada de tiempo central.
7. Tiempo monotónico inconsistente.
8. Gracia vigente.
9. Gracia agotada.
10. Gracia revocada.
11. Reinstalación durante gracia.
12. Restauración de base antigua.
13. Expiración mientras el POS está abierto.
14. Recuperación después de sincronizar tiempo confiable.

## Pruebas de revocación

1. Revocación de licencia.
2. Revocación de activación.
3. Revocación de dispositivo.
4. Revocación de clave central.
5. Revocación de clave de actualización.
6. Secuencia antigua recibida después de una nueva.
7. Revocación conocida durante operación offline.
8. Restauración de snapshot anterior a la revocación.
9. Revocación repetida de forma idempotente.
10. Revocación con firma inválida.

## Pruebas de recuperación y reemplazo

1. Recuperación con clave anterior.
2. Recuperación sin clave anterior.
3. Actor no autorizado.
4. Segundo factor inválido.
5. Aprobación pendiente.
6. Operaciones locales pendientes.
7. Activación anterior inexistente.
8. Reemplazo autorizado.
9. Reemplazo repetido.
10. Intento de copiar la clave anterior.
11. Nueva activación con derechos idénticos.
12. Revocación correcta de la identidad anterior.

## Pruebas de actualización

1. Paquete firmado válido.
2. Firma inválida.
3. Hash incorrecto.
4. Plataforma incompatible.
5. Arquitectura incompatible.
6. Canal no permitido.
7. Versión retirada.
8. Downgrade prohibido.
9. Descarga parcial.
10. Migración exitosa.
11. Migración fallida.
12. Reinicio durante instalación.
13. Recuperación de versión anterior.
14. Actualización repetida.
15. Actualización del conjunto de confianza.
16. Clave de actualización revocada.

## Pruebas de auditoría

1. Emisión de licencia auditada.
2. Activación auditada.
3. Revocación auditada.
4. Reemplazo auditado.
5. Rotación auditada.
6. Acceso de soporte auditado.
7. Fallo de firma auditado.
8. Replay auditado.
9. Ausencia de claves privadas en logs.
10. Ausencia de tokens reutilizables.
11. Aislamiento por tenant.
12. Correlación completa.
13. Fallo de persistencia de auditoría.
14. Retención y eliminación controladas.

## Pruebas de resiliencia

1. Caída del servicio durante activación.
2. Respuesta tardía.
3. Reintento después de timeout.
4. Reinicio del POS antes de persistir la activación.
5. Reinicio después de persistir y antes de confirmar.
6. Cola de sincronización pendiente.
7. Pérdida temporal de almacenamiento.
8. Tormenta de reintentos.
9. Rate limiting.
10. Recuperación después de indisponibilidad central.
11. Operación offline dentro del límite.
12. Operación offline después del límite.

## Pruebas de seguridad negativa

1. Intento de editar módulos localmente.
2. Intento de ampliar límites.
3. Intento de sustituir tenant.
4. Intento de cambiar `device_id`.
5. Intento de cambiar `installation_id`.
6. Intento de sustituir la clave pública.
7. Intento de reutilizar un nonce.
8. Intento de registrar secretos en logs.
9. Intento de activar con una clave comprometida.
10. Intento de restaurar una política anterior más permisiva.
11. Intento de acceso cruzado entre tenants.
12. Intento de soporte sin autorización.

## Matriz mínima de plataformas

Las pruebas relevantes deben ejecutarse en cada plataforma oficialmente soportada.

Debe verificarse como mínimo:

- serialización determinista;
- almacenamiento protegido;
- persistencia después de reinicio;
- tiempo monotónico;
- actualización;
- recuperación;
- validación de firma;
- compatibilidad de payload.

La lista definitiva de plataformas se fija antes de producción.

## Evidencia de prueba

Cada ejecución crítica debe conservar:

- test_id;
- versión probada;
- ambiente;
- plataforma;
- entrada;
- resultado esperado;
- resultado real;
- código producido;
- evidencia de auditoría;
- fecha;
- responsable o pipeline;
- referencia del artefacto.

No se considera aprobada una prueba basada únicamente en inspección visual.

# Criterios de aceptación

`DEC-008` permanece `DONE` mientras se cumplan todos los criterios siguientes.

## Modelo de confianza

1. Está definida la autoridad central de licencias.
2. Está separada la licencia de la activación.
3. Está separada la identidad del dispositivo de la evidencia de hardware.
4. El cliente no contiene claves privadas centrales.
5. El conjunto de confianza tiene versionado explícito.
6. La raíz de confianza no depende de una clave recibida junto con el artefacto.

## Licencia y derechos

1. Los derechos y límites están incluidos en material verificable.
2. Una modificación requiere nueva versión firmada.
3. Una licencia no equivale a una activación.
4. Una licencia perpetua no habilita automáticamente versiones mayores.
5. Los derechos no sustituyen permisos de usuario.
6. El cliente no amplía módulos ni límites localmente.

## Criterios de aceptación de activación

1. La activación online exige prueba de posesión.
2. La activación offline usa solicitud y respuesta vinculadas.
3. El replay está definido y probado.
4. La misma solicitud idempotente no genera duplicados.
5. Una activación no modifica derechos contractuales.
6. Una activación revocada no se reutiliza.
7. El reemplazo genera nueva identidad o activación según política explícita.

## Criterios de aceptación del dispositivo

1. `device_id`, `installation_id` y `device_key_id` están diferenciados.
2. La identidad no depende exclusivamente de hardware.
3. La clave privada local no se transmite al servidor.
4. Está definida la pérdida de clave.
5. Está definida la rotación.
6. Está definida la sospecha de clonación.
7. Un cambio menor de hardware no provoca bloqueo irreversible automático.
8. Un dispositivo revocado no recupera confianza sin autorización.

## Criterios de aceptación de tiempo y gracia

1. El reloj local no es autoridad absoluta.
2. Existe evidencia temporal central.
3. Está definido el uso de tiempo monotónico.
4. El rollback no extiende vigencia.
5. El adelanto del reloj no cancela por sí solo una licencia.
6. La gracia es explícita y verificable.
7. La gracia no nace de un fallo de red.
8. Reinstalar no reinicia gracia.
9. Restaurar una base antigua no revive autorización.
10. La desconexión no crea derechos nuevos.

## Claves

1. Los dominios de clave están separados según riesgo real.
2. Las claves privadas centrales tienen custodia controlada.
3. Existe rotación ordinaria.
4. Existe rotación de emergencia.
5. Existe estado `VERIFY_ONLY`.
6. Una clave comprometida no vuelve a `ACTIVE`.
7. Desarrollo y producción usan claves diferentes.
8. La actualización del conjunto de confianza es autenticada.
9. Está definida la respuesta ante compromiso.
10. El acceso administrativo está auditado.

## Criterios de aceptación de actualizaciones

1. Todo paquete se verifica antes de instalar.
2. Firma y hash se validan.
3. Plataforma, arquitectura y canal se validan.
4. Las migraciones están versionadas.
5. El rollback está restringido.
6. El downgrade inseguro se bloquea.
7. Una actualización no amplía derechos.
8. Una actualización no elimina datos confirmados.
9. El fallo de instalación conserva evidencia.
10. La actualización del conjunto de confianza está firmada.

## Revocación y recuperación

1. La revocación tiene identidad y secuencia.
2. Una revocación no elimina datos.
3. Una secuencia antigua no revierte una nueva.
4. La recuperación con clave anterior está definida.
5. La recuperación sin clave anterior exige controles reforzados.
6. El reemplazo conserva trazabilidad.
7. Las operaciones pendientes se tratan según `DEC-007`.
8. La reactivación requiere autorización central.
9. Una clave comprometida no se reutiliza.
10. Una copia local antigua no prevalece sobre revocación central reciente.

## Criterios de aceptación de seguridad

1. Las amenazas principales están identificadas.
2. Cada control responde a una amenaza concreta.
3. Está definida la degradación segura.
4. Una firma inválida no genera gracia.
5. Una clave desconocida no se acepta.
6. Un error criptográfico no se oculta como error de red.
7. Un tenant no accede a otro.
8. Los secretos no aparecen en logs.
9. El soporte no puede emitir licencias fuera del flujo autorizado.
10. La disponibilidad no elimina controles de integridad.

## Auditoría y observabilidad

1. Los eventos críticos están identificados.
2. La auditoría es append-only.
3. La correlación no depende de timestamps.
4. Los códigos de error son estables.
5. Las alertas tienen severidad.
6. La retención está definida conceptualmente.
7. La privacidad está considerada.
8. El diagnóstico local no expone secretos.
9. El acceso de soporte está auditado.
10. Un fallo de auditoría no se oculta.

## Pruebas

1. Están definidas pruebas criptográficas.
2. Están definidas pruebas de licencia.
3. Están definidas pruebas de activación online.
4. Están definidas pruebas de activación offline.
5. Están definidas pruebas de dispositivo.
6. Están definidas pruebas temporales.
7. Están definidas pruebas de revocación.
8. Están definidas pruebas de recuperación.
9. Están definidas pruebas de actualización.
10. Están definidas pruebas de auditoría.
11. Están definidas pruebas de resiliencia.
12. Están definidas pruebas negativas.
13. Está definida evidencia mínima de prueba.
14. Está considerada la matriz de plataformas.

## Documentación relacionada

1. `UC-LIC-001` queda alineado.
2. `security-model.md` queda alineado.
3. `conceptual-data-model.md` queda alineado.
4. `business-rules.md` queda alineado.
5. El glosario queda alineado.
6. El backlog refleja el cierre.
7. `LIC-002` y `DEV-002` quedan habilitados según dependencias.
8. `TECH-002` es reevaluado.
9. No quedan contradicciones con `DEC-007`.
10. El estado interno y el backlog coinciden.

## Condición de cierre

El documento no puede marcarse `DONE` si:

- existe una contradicción abierta;
- hay una pregunta crítica sin resolver;
- falta alinear un documento dependiente;
- una regla no puede probarse;
- una política exige una tecnología aún no decidida;
- la recuperación no está definida;
- la revocación puede perderse;
- el reloj local puede ampliar derechos;
- un dispositivo puede autoautorizarse;
- el cliente puede emitir licencias válidas.

# Invariantes finales

## Confianza

1. La autoridad de licencia pertenece al servidor central.
2. El cliente no puede autoemitirse derechos.
3. La clave privada central nunca reside en el POS.
4. Una clave pública arbitraria no se acepta como raíz de confianza.
5. La confianza se actualiza únicamente mediante un proceso autenticado.
6. Una clave comprometida no vuelve a estado activo.
7. Una clave retirada no firma artefactos nuevos.
8. La verificación histórica no implica autorización operativa actual.
9. Los ambientes no comparten claves de producción.
10. Toda confianza tiene versión y trazabilidad.

## Licencia

1. Una licencia pertenece a un tenant.
2. Una licencia no equivale a una activación.
3. Una licencia no equivale a una sesión.
4. Una licencia no equivale a un permiso de usuario.
5. Los derechos y límites son verificables.
6. Un cambio de derechos requiere nueva versión.
7. Una licencia sustituida no se elimina.
8. Una licencia cancelada no elimina datos.
9. Una licencia perpetua no habilita actualizaciones mayores indefinidas.
10. El cliente no amplía límites localmente.

## Invariantes de activación

1. Toda activación tiene identidad global.
2. Toda activación referencia una licencia.
3. Toda activación referencia un dispositivo.
4. Toda activación referencia una instalación cuando la política lo exige.
5. Una activación no amplía derechos.
6. Una activación revocada no se reutiliza.
7. Un reemplazo crea una nueva relación verificable.
8. Una solicitud idempotente no crea activaciones duplicadas.
9. Una respuesta offline solo sirve para su solicitud original.
10. Un replay no crea nuevos efectos.

## Invariantes del dispositivo

1. `device_id` no se reutiliza.
2. `installation_id` identifica una instalación concreta.
3. La identidad no depende únicamente de hardware.
4. La clave privada del dispositivo no se transmite al servidor.
5. La misma clave no se comparte entre dispositivos.
6. La pérdida de clave requiere recuperación.
7. Un cambio menor de hardware no produce revocación irreversible automática.
8. Un dispositivo revocado no recupera confianza sin autorización.
9. Una sospecha de clonación conserva evidencia.
10. Una reinstalación no revive activaciones antiguas automáticamente.

## Invariantes de tiempo y gracia

1. El reloj local no es autoridad absoluta.
2. Cambiar el reloj no extiende derechos.
3. Reinstalar no reinicia gracia.
4. Restaurar una base antigua no revive vigencia.
5. La gracia debe estar autorizada.
6. La gracia no se infiere por desconexión.
7. La gracia no corrige una firma inválida.
8. Una gracia agotada no se reinicia localmente.
9. La secuencia central prevalece sobre timestamps locales.
10. Una discrepancia temporal queda auditada.

## Invariantes de revocación

1. Toda revocación tiene identidad.
2. Toda revocación tiene secuencia.
3. Una revocación no elimina el objeto afectado.
4. Una revocación conocida se aplica offline.
5. Una secuencia antigua no revierte una nueva.
6. Restaurar un snapshot no elimina revocaciones conocidas.
7. Una activación revocada no vuelve a activa automáticamente.
8. Una clave revocada no autentica nuevas operaciones.
9. Una revocación conserva motivo y actor.
10. Una revocación se audita.

## Invariantes de actualizaciones

1. Un paquete no firmado no se instala.
2. Una firma válida no sustituye pruebas de compatibilidad.
3. Una actualización no amplía licencias.
4. Una actualización no elimina datos confirmados.
5. Una actualización no reemplaza la clave privada del dispositivo.
6. Una migración se ejecuta una sola vez.
7. Un downgrade inseguro se bloquea.
8. Un rollback no revive confianza retirada.
9. Una actualización fallida conserva evidencia.
10. La actualización del conjunto de confianza está autenticada.

## Auditoría

1. Toda operación crítica deja evidencia.
2. La auditoría es append-only.
3. Los secretos no se registran.
4. Las claves privadas no se registran.
5. Los tokens reutilizables no se registran.
6. La correlación es estable.
7. Un tenant no consulta auditoría de otro.
8. Soporte no elimina evidencia.
9. Un fallo de auditoría no se oculta.
10. La retención es explícita.

## Invariantes de seguridad

1. Una firma inválida produce rechazo.
2. Una clave desconocida produce rechazo.
3. Un error criptográfico no se convierte en error de red.
4. Una operación sensible no continúa bajo incertidumbre no autorizada.
5. La disponibilidad no elimina controles de integridad.
6. El soporte no emite licencias fuera del flujo autorizado.
7. Un dispositivo no se autoautoriza.
8. Un frontend no decide autoridad.
9. Una alerta no modifica estado por sí sola.
10. Todo control debe responder a un riesgo real.

## Invariantes de recuperación

1. La recuperación conserva historia.
2. La recuperación no amplía derechos.
3. La recuperación no reutiliza una clave comprometida.
4. La recuperación sin clave anterior exige controles reforzados.
5. El reemplazo conserva relación con la identidad anterior.
6. Las operaciones pendientes no se eliminan.
7. La recuperación no duplica ventas ni pagos.
8. Una operación aceptada no se vuelve a aplicar.
9. La nueva activación tiene identidad propia.
10. Toda recuperación queda auditada.

## Operación offline

1. La desconexión no crea derechos nuevos.
2. La desconexión no crea gracia.
3. La operación offline exige autorización verificable.
4. La operación offline tiene límites explícitos.
5. Las revocaciones conocidas prevalecen offline.
6. Un estado local antiguo no prevalece sobre una secuencia central más reciente.
7. Las operaciones confirmadas no se recalculan al sincronizar.
8. La sincronización conserva idempotencia.
9. Las discrepancias no se ocultan.
10. `DEC-007` gobierna recuperación y sincronización operativa.

## Cierre arquitectónico

1. `DEC-008` no define tablas físicas.
2. `DEC-008` no fija proveedor criptográfico.
3. `DEC-008` no obliga HSM, TPM o mecanismo específico sin análisis posterior.
4. `DEC-008` no define precios ni planes.
5. `DEC-008` no sustituye autenticación de usuarios.
6. `DEC-008` no duplica la política local-first de `DEC-007`.
7. Las decisiones físicas deben preservar estas invariantes.
8. Toda excepción futura requiere una decisión explícita.
9. Las versiones publicadas del modelo son inmutables.
10. El cierre requiere alineación documental completa.

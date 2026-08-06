# UC-LIC-001: Evaluar licencia y autorización operativa

## Objetivo

Determinar si una capacidad solicitada puede ejecutarse según la licencia, la activación, la identidad del dispositivo, la vigencia temporal y la política offline aplicable.

Este caso de uso no emite licencias ni crea activaciones.

## Actor principal

POS, panel o servicio autorizado.

## Actores secundarios

- servicio central de licencias;
- servicio de activación;
- dispositivo autorizado;
- sistema de auditoría.

## Precondiciones

- Existe una licencia emitida.
- La aplicación dispone de un conjunto confiable de claves públicas.
- El tenant está identificado.
- El dispositivo dispone de identidad local cuando la capacidad lo requiere.
- Las políticas compatibles están disponibles localmente o mediante el servicio central.

## Entrada

- `license_payload`;
- `activation_payload` opcional;
- `tenant_id`;
- `device_id`;
- `installation_id` opcional;
- `device_key_id` opcional;
- `app_version`;
- `requested_feature`;
- `operation_context`;
- `local_time_evidence`;
- `connectivity_status`.

## Flujo principal

1. La aplicación valida estructura y versión del payload.
2. Verifica la firma mediante una clave previamente confiable.
3. Confirma que la licencia pertenece al tenant.
4. Evalúa estado contractual y vigencia.
5. Evalúa derechos, límites y versión de aplicación.
6. Valida la activación cuando la capacidad la requiere.
7. Valida el vínculo con dispositivo e instalación.
8. Evalúa confianza del dispositivo.
9. Evalúa revocaciones conocidas.
10. Evalúa calidad temporal, autorización offline y gracia.
11. Consulta el estado central cuando existe conectividad y la política lo requiere.
12. Calcula la decisión efectiva.
13. Registra auditoría y anomalías.
14. Devuelve una decisión estable con código de razón.

## Flujo híbrido conectado

Cuando existe conectividad:

1. La validación criptográfica local sigue siendo obligatoria.
2. El servicio central aporta estado contractual, secuencias y revocaciones recientes.
3. El cliente compara el estado central con la caché local.
4. Una secuencia central más reciente prevalece.
5. La caché verificable se actualiza de forma atómica.
6. Una discrepancia no se oculta.
7. La venta ya confirmada no se recalcula ni se elimina.

## Flujo offline autorizado

Cuando no existe conectividad:

1. La aplicación valida los artefactos firmados disponibles.
2. Verifica activación, dispositivo, derechos y política offline.
3. Evalúa la última evidencia temporal confiable.
4. Detecta rollback o adelanto anómalo del reloj.
5. Aplica gracia únicamente cuando fue autorizada.
6. Aplica revocaciones conocidas localmente.
7. Limita capacidades según la política firmada.
8. Conserva evidencia para sincronización posterior.

La desconexión no crea derechos, activaciones ni periodos de gracia.

## Modalidad local perpetua

La licencia local perpetua:

1. Puede validarse sin conexión permanente.
2. Sigue requiriendo firma válida.
3. Puede estar vinculada a dispositivo, instalación y versión.
4. Aplica módulos y límites contractuales.
5. No incluye automáticamente actualizaciones mayores.
6. No habilita versiones declaradas incompatibles o retiradas.
7. No permite modificar localmente derechos o límites.

## Dimensiones evaluadas

### Validez criptográfica

- `VALID`;
- `INVALID_SIGNATURE`;
- `UNKNOWN_KEY`;
- `UNSUPPORTED_ALGORITHM`;
- `MALFORMED_PAYLOAD`;
- `UNSUPPORTED_PAYLOAD_VERSION`.

### Estado contractual

- `TRIAL`;
- `ACTIVE`;
- `PAST_DUE`;
- `SUSPENDED`;
- `CANCELLED`;
- `EXPIRED`.

### Estado de gracia

- `NOT_APPLICABLE`;
- `AUTHORIZED`;
- `ACTIVE`;
- `EXHAUSTED`;
- `REVOKED`.

### Estado de activación

- `PENDING`;
- `ACTIVE`;
- `SUSPENDED`;
- `REVOKED`;
- `REPLACED`;
- `EXPIRED`;
- `REVIEW_REQUIRED`.

### Confianza del dispositivo

- `TRUSTED`;
- `DEGRADED`;
- `UNTRUSTED`;
- `REVOKED`;
- `UNKNOWN`;
- `REVIEW_REQUIRED`.

## Salida

La salida mínima contiene:

- `decision`;
- `operational_status`;
- `reason_code`;
- `license_id`;
- `activation_id` opcional;
- `device_id` opcional;
- `feature_code`;
- `retryable`;
- `user_action_required`;
- `policy_version`;
- `evaluated_at`;
- `correlation_id`.

Valores de `decision`:

- `ALLOW`;
- `ALLOW_WITH_RESTRICTIONS`;
- `DENY`;
- `REVIEW_REQUIRED`.

## Flujos alternos

### Firma inválida

- Se rechaza el artefacto.
- No se inicia gracia.
- No se interpretan sus derechos.
- Se devuelve `LICENSE_SIGNATURE_INVALID`.

### Clave desconocida

- No se acepta una clave incluida junto con la licencia.
- Se devuelve `LICENSE_SIGNING_KEY_UNKNOWN`.
- Puede requerirse actualización autenticada del conjunto de confianza.

### Activación ausente

- Si la capacidad exige activación, se devuelve `ACTIVATION_REQUIRED`.
- No se crea una activación localmente.

### Dispositivo diferente

- Se devuelve `ACTIVATION_DEVICE_MISMATCH` o `DEVICE_UNKNOWN`.
- Puede iniciarse reemplazo o recuperación.
- No se reutiliza automáticamente la activación anterior.

### Gracia vigente

- Se permite únicamente el alcance autorizado.
- La decisión es `ALLOW_WITH_RESTRICTIONS`.
- Se devuelve `GRACE_ACTIVE`.

### Gracia agotada

- No se reinicia localmente.
- Se aplican restricciones o bloqueo según política.
- Se devuelve `GRACE_EXHAUSTED`.

### Reloj no confiable

- No se amplía vigencia.
- Se degrada o restringe la operación.
- Se devuelve el código temporal correspondiente.

### Revocación conocida

- La revocación prevalece incluso sin conectividad.
- No se eliminan datos locales.
- Se devuelve el código específico de revocación.

## Reglas

1. La clave privada central nunca reside en el cliente.
2. Manipular un payload invalida su firma.
3. La licencia es distinta de la activación.
4. Una activación no amplía derechos.
5. El reloj local no constituye autoridad absoluta.
6. La gracia debe estar explícitamente autorizada.
7. Una firma inválida no genera gracia.
8. Un dispositivo revocado no se reactiva automáticamente.
9. No se eliminan datos por suspensión, expiración o revocación.
10. Una operación confirmada no se reescribe por cambios posteriores.
11. El frontend no modifica la decisión calculada.
12. Todo rechazo utiliza un código estable.
13. Los avisos deben preceder restricciones comerciales cuando la política lo permita.
14. Una operación iniciada solo puede completarse bajo las condiciones definidas por `DEC-008`.
15. La sincronización posterior se rige por `DEC-007`.

## Pruebas mínimas

- licencia activa;
- firma alterada;
- clave desconocida;
- payload no soportado;
- tenant diferente;
- licencia vencida;
- gracia vigente;
- gracia agotada;
- rollback del reloj;
- módulo no contratado;
- límite de dispositivo alcanzado;
- activación ausente;
- activación revocada;
- dispositivo diferente;
- instalación diferente;
- dispositivo revocado;
- operación offline autorizada;
- operación offline no autorizada;
- modalidad local perpetua;
- versión no permitida;
- reactivación;
- recuperación;
- solicitud repetida idempotente.

## Documentos normativos relacionados

- `docs/adr/DEC-008-device-trust-license-activation.md`;
- `docs/adr/DEC-007-local-first-data-authority.md`;
- `docs/architecture/security-model.md`;
- `docs/architecture/conceptual-data-model.md`;
- `docs/domain/business-rules.md`.
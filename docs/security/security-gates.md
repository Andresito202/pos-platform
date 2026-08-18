# Gates verificables de seguridad para Fase 1

## Estado y propósito

Estado documental: `DEFINED`.

Estado de ejecución de `SEC-G01` a `SEC-G10`: `PLANNED`.

Este documento formaliza los gates de seguridad de Fase 1. No implementa controles, no declara segura la línea base heredada y no autoriza producción, DDL, migraciones, infraestructura ni dependencias. Un gate solo puede aprobarse con evidencia ejecutable sobre el stack objetivo y el entorno al que aplica.

Los identificadores `SEC-Gxx` designan gates verificables y no reemplazan los elementos `SEC-001` a `SEC-004` del backlog. Estos últimos conservan sus estados y autoridad documental.

Fuentes normativas: modelo de seguridad y tenancy, matriz de permisos, estrategia de pruebas, ownership, `DEC-007`, `DEC-008`, `DEC-009`, `DEC-010`, `ADR-005`, contratos físicos `PHY-G01` a `PHY-G09`, contratos de integración, `SEC-004`, casos de uso de autenticación, dispositivos, licencias, sincronización, pagos y fiscalización.

## Regla general del gate

Cada gate usa obligatoriamente el patrón:

`amenaza → control → prueba → evidencia`

La mera existencia de documentación, compilación o pruebas funcionales positivas no aprueba un gate. Toda prueba debe identificar versión, commit, ambiente, plataforma, configuración/policy version, entrada, resultado esperado, resultado real, código estable producido y artefactos de ejecución. La evidencia no contiene secretos ni datos reales innecesarios.

Estados de evaluación por versión:

- `NOT_EVALUATED`: no existe evidencia ejecutable suficiente;
- `PASS`: todos los controles aplicables tienen evidencia válida;
- `FAIL`: al menos un control requerido falló;
- `BLOCKED`: falta una dependencia externa o decisión documentada; no equivale a aprobación;
- `NOT_APPLICABLE`: exige justificación explícita, aprobada y versionada.

Todos los gates se encuentran actualmente `NOT_EVALUATED`. `DEFINED` describe únicamente que su contrato documental existe.

## SEC-G01 — Tenant Isolation

Estado actual: `PLANNED` / `NOT_EVALUATED`.

### Matriz verificable

| Amenaza | Control requerido | Prueba futura | Evidencia requerida |
|---|---|---|---|
| Tenant A lee un recurso de Tenant B | `TenantContext` derivado de identidad, membership y sesión; autorización backend; repository tenant-aware | integración cross-tenant para lectura por ID conocido y enumeración | denegación estable, cero datos y traza sanitizada |
| Tenant A modifica, elimina o ejecuta una operación sobre Tenant B | predicados tenant-aware, permisos/ABAC y validación de ownership | integración para update, delete, comando e IDOR/BOLA | denegación, cero filas/efectos y auditoría cuando corresponda |
| Se crea una referencia entre tenants | FKs/constraints tenant-scoped y validación de aplicación | insertar relaciones cross-tenant en PostgreSQL y SQLite | constraint o rechazo transaccional sin mutación parcial |
| Un parámetro libre suplanta `tenant_id` | ignorar el ID como autoridad y compararlo con contexto confiable | manipulación de tenant/company/branch en API, IPC y sync | `TENANT_MISMATCH` o código equivalente estable |
| RLS se omite o filtra contexto | RLS PostgreSQL como defensa adicional, roles sin `BYPASSRLS`, contexto por transacción | suites con API, worker y cambio secuencial de tenant | cero fuga, `WITH CHECK` efectivo y ausencia de contexto residual |
| Auditoría, configuración, caché, idempotencia, secretos o export cruzan tenant | partición lógica y claves/queries tenant-aware | pruebas negativas por cada frontera | evidencia segregada y ausencia de referencias cruzadas |

### Criterio de cierre

Tenant A no puede leer, modificar, borrar, referenciar ni ejecutar operaciones sobre recursos de Tenant B. Deben pasar integration tests reales en PostgreSQL y, para datos locales aplicables, SQLite/WAL. El PoC de RLS definido en `PHY-G14` debe estar aprobado antes de usar RLS como evidencia productiva.

### Evidencia parcial disponible

El PoC aislado `poc/rls/` pasó en PostgreSQL 16.14 para RLS/FORCE, roles runtime sin `BYPASSRLS`, contexto `SET LOCAL` fail-closed, lectura/escritura cross-tenant, `WITH CHECK`, FK compuestas tenant-aware, reutilización de conexión, rollback, worker secuencial, administración global explícita e introspección/restore. Evidencia: `poc/rls/results/evidence.txt` y `poc/rls/results/summary.md` sobre commit base `b8f5802d711d23f6117a619babeb9660df30682c`.

Esta evidencia cierra `PHY-G14`, no `SEC-G01`. Aún faltan derivación de contexto desde identidad/sesión, repositories tenant-aware, API/worker reales, pruebas PostgreSQL/SQLite del stack objetivo y las demás fronteras de la matriz. El estado permanece `PLANNED / NOT_EVALUATED`; no se introduce un estado nuevo.

Dependencias: tenant model, `SEC-002`, `SEC-003`, `PHY-G14`, foundation física, contratos de cada repository y `SEC-G02`/`SEC-G03`.

## SEC-G02 — Authentication & Session Security

Estado actual: `PLANNED` / `NOT_EVALUATED`.

### Matriz verificable

| Amenaza | Control requerido | Prueba futura | Evidencia requerida |
|---|---|---|---|
| Robo o reutilización de access token | access token de corta duración, audience/scope y validación estricta | token expirado, alterado, de otro ambiente o tenant | rechazo estable sin creación de sesión paralela |
| Robo o replay de refresh token | rotación, hash protegido, detección de reutilización y revocación de familia | refresh concurrente y reutilización del token anterior | una sola rotación válida y familia revocada según política |
| Logout o cambio de contraseña no invalida acceso | sesiones revocables por dispositivo y propagación de revocación | usar access/refresh después de logout, reset o revocación | nuevas operaciones denegadas y evento de seguridad |
| Fuerza bruta o credential stuffing | backoff/bloqueo y rate limiting configurables | ráfagas por cuenta, IP/contexto y distribución | limitación sin enumerar cuentas y métricas de abuso |
| Administración crítica sin segundo factor | MFA obligatorio y reautenticación reciente según política | acceso sin MFA, MFA inválido, evidencia vencida | rechazo con razón estable y auditoría |
| Recuperación de cuenta toma control indebido | flujo separado, tokens de un solo uso, verificación reforzada y revocación | replay, expiración, cambio de correo/teléfono y recuperación concurrente | recuperación única, sesiones previas tratadas y trazabilidad |

Las duraciones de access/refresh, ventanas de reautenticación, backoff y bloqueo son configurables y versionadas; no se fijan aquí valores no cerrados.

### Criterio de cierre

Las suites demuestran login, expiración, rotación, revocación, logout, sesiones por dispositivo, MFA crítico, reautenticación, bloqueo y recuperación sin bypass ni secreto expuesto.

Dependencias: `UC-AUTH-001`, `SEC-003`, Identity, Devices, `SEC-G01`, `SEC-G03`, `SEC-G04` y `SEC-G07`.

## SEC-G03 — Authorization / RBAC / ABAC

Estado actual: `PLANNED` / `NOT_EVALUATED`.

### Matriz verificable

| Amenaza | Control requerido | Prueba futura | Evidencia requerida |
|---|---|---|---|
| Endpoint o caso de uso queda permitido por omisión | deny by default en backend y permisos atómicos | recurso nuevo/sin grant y actor sin permiso | denegación estable y prueba de cobertura de rutas/comandos |
| Frontend eleva rol, permiso o alcance | backend ignora claims/flags no confiables y reconstruye decisión efectiva | manipular rol, permiso, tenant, branch, device o importe | cero efecto y decisión auditable |
| Rol válido opera fuera de company/branch/device | ABAC versionado sobre contexto y recurso | matriz de scopes válidos e inválidos | decisión con `reason_code` y policy version |
| Actor completa un flujo sensible completo | segregación de funciones y prohibición de self-approval cuando aplique | mismo actor solicita/aprueba/ejecuta | rechazo sin transición parcial |
| Operación monetaria excede límite | límites por rol/política y aprobación superior | bordes, concurrencia y manipulación del importe | cálculo reproducible, supervisor autorizado y auditoría |

### Criterio de cierre

Todos los casos de uso críticos tienen permiso atómico, política aplicable y pruebas negativas backend para actor, tenant, company, branch, device, estado, importe, self-approval y revocación. El frontend no aparece como enforcement.

Dependencias: `SEC-001`, `SEC-002`, matriz de permisos, `SEC-G01`, `SEC-G02`, contratos de cada dominio y auditoría.

## SEC-G04 — Device Trust & License Enforcement

Estado actual: `PLANNED` / `NOT_EVALUATED`.

### Matriz verificable

| Amenaza | Control requerido | Prueba futura | Evidencia requerida |
|---|---|---|---|
| Clonación o sustitución de dispositivo/instalación | identidades separadas, prueba de posesión y key lifecycle de `DEC-008` | clave copiada, imagen clonada, instalación o device cambiado | rechazo, riesgo/alerta y evidencia criptográfica sanitizada |
| Replay de activación | request/nonce/instalación vinculados e idempotencia | misma respuesta dos veces o en otro device/installation | un solo efecto y replay auditado |
| Dispositivo revocado, suspendido o reemplazado sigue operando | estado efectivo y secuencia de revocación | operación conectada/offline después de revocación/reemplazo | denegación o restricción definida sin borrar datos |
| Reinstalación revive confianza o gracia | nueva installation identity y recuperación autorizada | reinstalación, restore antiguo y pérdida de clave | no revive activación, derechos ni gracia |
| Reloj manipulado amplía vigencia | tiempo central/monotónico y clock-quality | rollback/adelanto, reinicio y offline prolongado | decisión restrictiva y alerta, nunca extensión local |
| Licencia expirada, `PAST_DUE` o `RESTRICTED` amplía derechos | `EffectiveLicenseDecision` conforme a política firmada | capacidades permitidas/restringidas, gracia y revocación | `ALLOW`, `ALLOW_WITH_RESTRICTIONS` o `DENY` reproducible |
| Salud/última conexión oculta riesgo | `last_seen`, health y alertas administrativas no autoritativas | dispositivo ausente, degradado o sospechoso | señal observable sin mutar licencia por sí sola |

### Criterio de cierre

Pasan las suites de identidad, instalación, activación, revocación, claves, reemplazo, reinstalación, replay, tiempo, licencia, gracia, salud y alertas exigidas por `DEC-008`, sin sistema paralelo.

Dependencias: `DEC-008`, `DEC-007`, `UC-DEV-001/002`, `UC-LIC-001/002`, `SEC-G02`, `SEC-G05`, `SEC-G06` y `SEC-G07`.

## SEC-G05 — Local-first Integrity & Replay Protection

Estado actual: `PLANNED` / `NOT_EVALUATED`.

### Matriz verificable

| Amenaza | Control requerido | Prueba futura | Evidencia requerida |
|---|---|---|---|
| Reintento o doble clic duplica efectos | UUID global, `operation_id`, idempotency key, inbox/outbox y resultado persistido | mismo request/operación repetido antes/después de timeout | un efecto y mismo resultado |
| Payload cambia bajo la misma intención | payload canónico y checksum | misma key con checksum distinto | conflicto explícito, cero mutación adicional |
| Atacante con control de SQLite fabrica operación | autenticidad fuerte mediante identidad criptográfica de dispositivo de `DEC-008` cuando el riesgo lo exija | modificar payload y recalcular hash simple | rechazo de prueba/firma; hash solo no cuenta como autenticidad |
| Reordenamiento rompe causalidad | `causation_id`, versiones y `WAITING_FOR_DEPENDENCY` | entrega invertida, dependencia ausente y posterior | espera/revisión/rechazo determinista |
| Reloj local o last-write-wins altera autoridad | authority model, expected version y tiempo como evidencia | clock rollback y conflicto concurrente | conflicto visible; ningún overwrite por timestamp |
| Rechazo central borra el hecho local | estado explícito, revisión y compensación | operación offline inválida tras reconexión | `SERVER_REJECTED`/conflicto persistido y trazable |
| Offline prolongado usa reglas o permisos obsoletos | snapshots firmados/versionados, vigencia y límites | reconexión después de ventana, revocación y policy update | degradación segura y reconciliación sin pérdida |

### Criterio de cierre

Las suites SQLite/WAL y PostgreSQL demuestran atomicidad negocio+outbox, inbox+efectos, retry, duplicado, replay, reordenamiento, conflicto, rechazo central, recuperación, clock rollback y sincronización tras offline prolongado conforme a `DEC-007`.

Dependencias: `DEC-007`, `DEC-008`, `SYNC-001/002/003`, `SEC-G01`, `SEC-G04`, `SEC-G06` y contratos físicos aplicables.

## SEC-G06 — Audit & Anti-Fraud

Estado actual: `PLANNED` / `NOT_EVALUATED`.

### Matriz verificable

| Amenaza | Control requerido | Prueba futura | Evidencia requerida |
|---|---|---|---|
| Acción crítica queda sin rastro o se altera | Audit append-only en frontera transaccional | fallo de auditoría, intento de update/delete y rollback | operación revertida cuando auditoría es obligatoria; evento inmutable |
| Evidencia no permite atribución | actor, tenant, branch, device, action, resource, reason, before/after, tiempos confiables, IDs causales y reviewer | reconstrucción completa de una transición | cadena causal y política/permiso identificables |
| Abuso de anulaciones, devoluciones, refunds/reversals o descuentos | reglas configurables por volumen, frecuencia, importe, actor y periodo | umbral, borde, recurrencia y múltiples tenants | señal/alerta explicable sin decisión automática destructiva |
| Diferencias de caja o acciones fuera del patrón se ocultan | señales por diferencias, horario/contexto y configuración sensible | escenario normal y anómalo | incidencia/alerta, severidad y auditoría |
| Ataques reiterados no se detectan | señales de login, autorización, replay, device y cross-tenant | intentos repetidos distribuidos y correlacionados | métricas/alertas sanitizadas y correlación |
| Plataforma abusa privilegios globales | acceso JIT, mínimo alcance y auditoría de roles de plataforma | acceso sin aprobación, expirado o cross-tenant | denegación o sesión limitada con registro completo |

Eventos críticos mínimos: venta anulada, SaleReturn, Refund, Reversal, descuento, cambio manual de precio, apertura manual de caja, cierre con diferencia, cambio de permisos/licencia/dispositivo, recuperación, configuración sensible, Settlement/Reconciliation y acciones administrativas de plataforma.

No se requiere machine learning. Las reglas antifraude son deterministas, configurables, versionadas y producen señales; no reescriben hechos ni amplían autoridad.

### Criterio de cierre

Cada evento crítico tiene prueba positiva/negativa, persistencia append-only, aislamiento tenant, causalidad y evidencia consultable por actor autorizado. Las reglas antifraude producen resultados reproducibles y alertas sin secretos.

Dependencias: Audit ownership, matriz de permisos, `SEC-004`, `SEC-G01` a `SEC-G05`, puertos de observabilidad y políticas de cada dominio.

## SEC-G07 — Secrets & Cryptography

Estado actual: `PLANNED` / `NOT_EVALUATED`.

### Matriz verificable

| Amenaza | Control requerido | Prueba futura | Evidencia requerida |
|---|---|---|---|
| Secreto entra a Git, imagen, build, logs o diagnóstico | secret scanning, inyección segura y redacción | canary secrets en cada canal | detección/bloqueo y ausencia en artefactos |
| Credencial de un tenant sirve para otro | secretos por tenant/empresa/ambiente y referencia opaca | intercambiar referencias o contextos | denegación sin revelar existencia/valor |
| Clave comprometida sigue activa | inventario, rotación, revocación y trust set versionado | rotación ordinaria/emergencia y clave retirada | artefactos nuevos rechazados; verificación histórica según política |
| POS obtiene clave privada central | custodia central y solo material público confiable en cliente | inspección de paquete/runtime/backup | ausencia demostrada de clave privada central |
| Secretos fiscales o de pago se filtran | almacén central, adaptador de mínimo privilegio y logs redactados | errores, retries, export y soporte | referencia auditada, valor ausente |
| Backup expone datos o claves | cifrado, separación de claves y exclusión de identidad privada | extracción, restore y pérdida de medio | confidencialidad y restore sin clonar confianza |

No se seleccionan aquí Vault, KMS, HSM ni proveedor concreto. La implementación futura debe respetar `SEC-004`; la clave privada central de firma nunca reside en el POS.

### Criterio de cierre

Pasan scanning, rotación, revocación, aislamiento, redacción, backup/restore y pruebas criptográficas. Existe inventario con propietario, propósito, ambiente y ciclo de vida sin almacenar valores secretos.

Dependencias: `SEC-004`, `DEC-008`, `DEC-009`, `SEC-G01`, `SEC-G04`, `SEC-G08` y mecanismo de secretos elegido posteriormente.

## SEC-G08 — API / Webhook / Input Security

Estado actual: `PLANNED` / `NOT_EVALUATED`.

### Matriz verificable

| Amenaza | Control requerido | Prueba futura | Evidencia requerida |
|---|---|---|---|
| Input inválido, mass assignment o inyección | validación estricta server-side, allowlists, queries parametrizadas y límites | fuzz/payload inválido, campos extra, SQL/meta caracteres | rechazo estable y cero mutación |
| IDOR/BOLA | contexto confiable, ownership y autorización por objeto | IDs válidos de otro tenant/scope | rechazo indistinguible y cero fuga |
| XSS o contenido activo | encoding contextual, sanitización donde corresponda y CSP/security headers | payload almacenado/reflejado y cabeceras | contenido neutralizado y política efectiva |
| CSRF | control acorde con la estrategia de autenticación elegida | petición cross-site con/sin credencial | rechazo cuando el canal sea vulnerable; decisión documentada si no aplica |
| CORS permisivo | allowlist explícita por ambiente | origen permitido/no permitido y preflight | cabeceras exactas, sin wildcard con credenciales |
| SSRF desde integración | destinos permitidos, resolución/egress controlado y bloqueo de redes internas | loopback, metadata, redirects y DNS rebinding | conexión bloqueada y señal de seguridad |
| Abuso o agotamiento | payload/depth limits, rate limiting HTTP, timeouts y cuotas | ráfaga, slow request, body grande y dependencia lenta | `429`/rechazo, recuperación y métricas; BullMQ no cuenta como rate limiter HTTP |
| Webhook falso, duplicado o replay | firma/autenticidad, event ID, timestamp/nonce, ventana y inbox idempotente | firma inválida, evento repetido, viejo, reordenado o alterado | ack/rechazo seguro y un solo efecto |
| Webhook retiene conexión y provoca reintentos | validación mínima, respuesta rápida y procesamiento posterior cuando aplique | carga, timeout y caída después de recepción | recepción duradera/idempotente y procesamiento recuperable |

### Criterio de cierre

Las suites API, IPC e integración prueban validación, BOLA/IDOR, inyección, XSS, CSRF aplicable, CSP/headers, CORS, SSRF, límites, rate limiting, timeouts y webhooks. Toda excepción está documentada y no depende del frontend.

Dependencias: `ARCH-004`, `TECH-003`, estrategia de autenticación de `SEC-G02`, `SEC-G01`, `SEC-G03`, `SEC-G05`, `SEC-G07` y adaptadores concretos cuando existan.

## SEC-G09 — Infrastructure / Supply Chain / Backup & Recovery

Estado actual: `PLANNED` / `NOT_EVALUATED`.

### Matriz verificable

| Amenaza | Control requerido | Prueba futura | Evidencia requerida |
|---|---|---|---|
| Intercepción o exposición de red | TLS verificado, firewall, SSH endurecido y segmentación | protocolo/certificado inválido, puerto no autorizado y revisión de acceso | conexión rechazada e inventario de superficie |
| Proceso o contenedor comprometido escala privilegios | mínimo privilegio, usuario no root y permisos/egress mínimos | inspección de runtime y acceso prohibido | denegación y configuración versionada |
| Dependencia o imagen vulnerable/manipulada | lockfiles, versiones fijadas, dependency/container scanning y SBOM | build limpio y vulnerabilidad conocida | reporte asociado al artefacto y tratamiento explícito |
| Pipeline o artefacto es alterado | GitHub Actions protegido, secretos CI mínimos, build reproducible y firma | PR no confiable, cambio de workflow y verificación de firma | provenance/commit, aprobación y artefacto verificable |
| Backup no existe, se filtra o no restaura | backups cifrados, retención versionada y restore real | backup/restore PostgreSQL y SQLite/WAL en aislamiento | datos reconciliados, RPO/RTO medidos y secretos excluidos |
| Update o rollback corrompe datos/confianza | actualización firmada, backup previo, compatibilidad y rollback controlado | firma inválida, fallo de migración, downgrade y recuperación | rechazo o recuperación con evidencia, sin pérdida silenciosa |
| Región/proveedor falla | disaster recovery portable y runbooks | simulacro de indisponibilidad y recuperación | tiempos/resultados medidos y decisiones auditadas |

No se impone Kubernetes, VPS, proveedor cloud, secret manager ni topología no decidida. La arquitectura permanece portable y respeta `DEC-009`/`DEC-010`.

### Criterio de cierre

Infraestructura, pipeline, artefactos, dependencias, imágenes, SBOM, backup/restore, DR, updates y rollback tienen pruebas reales en un entorno representativo. Crear un backup sin restaurarlo no aprueba el gate.

Dependencias: `ADR-005`, `DEC-009`, `DEC-010`, `TECH-004`, `TECH-005`, `SEC-G07`, ambientes objetivo y políticas de operación.

## SEC-G10 — Security Release Gate

Estado actual: `PLANNED` / `NOT_EVALUATED`.

### Matriz verificable

| Amenaza | Control requerido | Prueba futura | Evidencia requerida |
|---|---|---|---|
| Se promueve una versión con controles críticos fallidos | evaluación agregada fail-closed de gates aplicables | uno de `SEC-G01…SEC-G09` en `FAIL`, `BLOCKED` o sin evidencia | promoción bloqueada y motivo registrado |
| Funcionalidad crítica se marca DONE solo porque compila | Definition of Done incluye gates de dominio y seguridad | cambio crítico con tests funcionales pero sin pruebas negativas | estado no promovible |
| Vulnerabilidad crítica conocida se ignora | triage, bloqueo o excepción temporal aprobada con compensación/expiración | vulnerabilidad crítica en dependencia/imagen/código | bloqueo o risk acceptance trazable y limitada |
| Incidente no tiene respuesta/recuperación | runbook, responsables y ejercicios | tabletop/simulacro y recuperación | tiempos, decisiones, brechas y seguimiento |
| Evidencia corresponde a otro commit/ambiente | provenance entre commit, build, configuración y resultados | mezclar artefactos o evidencia antigua | rechazo del paquete de evidencia |

### Evidencia mínima de release

- aislamiento cross-tenant;
- autenticación y revocación de sesión;
- MFA y reautenticación críticas;
- autorización RBAC/ABAC;
- device trust y license enforcement;
- idempotencia, replay y local-first;
- auditoría y antifraude aplicables;
- secrets y criptografía;
- API, input y webhook security;
- supply chain e infraestructura;
- backup/restore, incident response y recovery;
- ausencia de vulnerabilidades críticas conocidas sin tratamiento válido.

### Criterio de cierre

Una versión solo obtiene `PASS` cuando todos los gates aplicables están en `PASS`, los `NOT_APPLICABLE` tienen justificación aprobada y no existen vulnerabilidades críticas sin tratamiento. `BLOCKED`, `FAIL` o `NOT_EVALUATED` impiden producción.

Dependencias: `SEC-G01` a `SEC-G09`, CI/CD futuro, gestión de vulnerabilidades, release management y responsables de seguridad/operación.

## Seguridad obligatoria en cada gate funcional

Antes de cerrar un cambio crítico de Sales, Payments, Cash Register, Inventory, Licensing, Devices, Sync, Electronic Invoicing o Administration, su contrato y evidencia deben responder:

1. ¿Puede leer, modificar, referenciar o ejecutar sobre otro tenant?
2. ¿Qué actor, permiso y alcance pueden ejecutarlo?
3. ¿Puede repetirse y cuál es su identidad idempotente?
4. ¿Puede sufrir replay, reordenamiento o duplicación?
5. ¿Cómo se detecta manipulación del payload y cuándo se exige autenticidad fuerte?
6. ¿Qué autoridad decide conectado y offline?
7. ¿Qué ocurre tras offline prolongado, conflicto o rechazo central?
8. ¿Qué se audita y qué señal antifraude puede producir?
9. ¿Toca secretos, credenciales, datos personales, fiscales o de tarjeta?
10. ¿Qué ocurre ante fallo parcial, timeout o resultado incierto?
11. ¿Exige segregación de funciones o prohíbe self-approval?
12. ¿Exige MFA, reautenticación o aprobación superior?

Cada respuesta enlaza amenazas, controles, pruebas y evidencia de los `SEC-Gxx` aplicables. Una respuesta “no aplica” requiere justificación explícita.

## Mapping obligatorio para integraciones externas

El contrato `../architecture/physical-model/external-integrations-schema.md` amplía el alcance futuro de pruebas sin cambiar el estado de ningún gate:

| Gate | Riesgo/control de integración | Evidencia futura mínima |
|---|---|---|
| `SEC-G01` | RLS/FORCE, FKs tenant-aware y FK Integration+Provider para rate policy sin ambigüedad de cuenta | lectura/escritura/callback cross-tenant, Tenant inexistente, Company cruzada y provider/account swapping rechazados |
| `SEC-G03` | matriz TABLE×ROLE×OPERATION×COLUMN SET, guards old/new y permisos atómicos para configure/test/discover/map/review/activate/disable/rotate/revalidate | pruebas negativas por columna/rol, worker sin business mutation, admin read-only y segregación REGISTER/REVIEW/PROMOTE |
| `SEC-G05` | identidad inmutable, checksum, deduplicación, anti-replay, retry y outcome incierto | duplicado, payload distinto con misma key, ACK perdido, timeout ambiguo y reconciliación |
| `SEC-G06` | Audit append-only sanitizado para configuración, mapping, rotación, dispatch y revisión | causalidad completa sin secretos ni payloads provider completos |
| `SEC-G07` | secret references centrales, token lifecycle, rotación/revocación, JSON secret-key denylist y redacción | canary leakage en JSON, SQLite, renderer/PWA, Sync/Outbox/Audit, logs, errores, telemetría, backup y fixtures |
| `SEC-G08` | schemas provider-specific server-side, límites JSON de bytes/profundidad/arrays/strings, SSRF/egress allowlist, webhook y rate limiting | oversized/deep/unknown/raw payload, BOLA/IDOR, destino malicioso, callback falso/replay, 429/headers y recuperación |
| `SEC-G09` | TLS, destinos oficiales, supply chain, `btree_gist` preflight no destructivo, migration lock y backup/restore | extensión ausente/sin privilegio, carreras up/down, certificado/destino inválido, SBOM/scans y restore aislado |
| `SEC-G10` | promoción fail-closed y provenance de descriptor/checksum separan `IMPLEMENTED`, `MOCK_TESTED`, `SANDBOX_VERIFIED`, `PRODUCTION_VERIFIED` y `CERTIFIED` | self-review/self-promotion/level skipping y release sin evidencia real quedan bloqueados |

`MAT-002-MATERIALIZATION` aporta evidencia ejecutable parcial sobre migration 002: RLS/FORCE, FKs tenant-aware, grants por columna, guards, JSON físico, idempotencia, segregación de evidencia, lock/recovery y lifecycle de `btree_gist`. No evalúa identidad/API/adapters/despliegue productivo ni promueve gates; `SEC-G01..SEC-G10` permanecen `PLANNED / NOT_EVALUATED`.

`FISCAL-003-MANIFEST` y su remediación agregan únicamente mapping futuro de controles fiscales: nueve RLS/FORCE, scope branch íntegro y worker sin DRAFT (`SEC-G01`); grants literales deny-by-default y guards old/new (`SEC-G03`); numeración/idempotencia/UNKNOWN_OUTCOME/reconciliation (`SEC-G05`); evidencia append-only y raw sanitizado (`SEC-G06`); certificate/storage references opacas y detección de secretos (`SEC-G07`); límites de bytes/caracteres y artifacts (`SEC-G08`); orden canónico de locks, downgrade, rollback y `btree_gist` no destructivo (`SEC-G09`); y ausencia de claims provider/normativos (`SEC-G10`). Es diseño sin evidencia ejecutable: `SEC-G01..SEC-G10` permanecen `PLANNED / NOT_EVALUATED`.

`ExternalWebhookReceipt` no inventa mecanismos de firma: usa únicamente autenticación, firma, timestamp o nonce demostrados por el provider; lo demás permanece `UNVERIFIED`. `ProviderVerificationEvidence` puede registrar evidencia, pero no cambia por sí solo el estado de un `SEC-Gxx`.

## PCI y datos de tarjeta

La plataforma minimiza deliberadamente su alcance PCI. No almacena ni registra PAN completo, CVV/CVC ni secretos de autenticación de tarjeta, salvo necesidad futura explícita con revisión jurídica, normativa y certificación técnica. Se prefiere tokenización y procesamiento por proveedor autorizado. Tokens o referencias del proveedor se tratan como datos sensibles tenant-scoped y nunca autorizan por sí solos un resultado financiero.

## DIAN y fiscalización

- secretos fiscales se aíslan por tenant, empresa/NIT, proveedor y ambiente conforme a `SEC-004`;
- firma, certificados y tokens se custodian fuera del renderer y del dominio;
- generación y validación respetan la autoridad fiscal y el contrato neutral del módulo;
- el cliente POS no es autoridad fiscal final;
- evidencia y retención obedecen una política normativa específica y versionada;
- no se inventan periodos legales de retención sin una fuente cerrada.

## Observabilidad compatible, no implementada

Los casos de uso críticos deben poder depender de puertos conceptuales `LoggerPort`, `MetricsPort` y `AuditPort`, ubicados en la capa de aplicación correspondiente. Su existencia conceptual no autoriza OpenTelemetry, Prometheus, Grafana, Sentry ni adaptadores concretos.

Las alertas futuras deben cubrir, según contexto: fallos de login, rechazo cross-tenant, replay, dispositivo sospechoso, exceso de refunds/reversals, diferencias de caja, fallos de proveedor y anomalías de auditoría. Logger y métricas no sustituyen Audit; una alerta no modifica estado de dominio por sí sola.

## Evidencia física parcial de TECH-002/R3

La ejecución reproducible de `poc/physical-model/` aporta evidencia física parcial, no una evaluación de release. Los estados globales de `SEC-G01` a `SEC-G10` permanecen `PLANNED / NOT_EVALUATED` porque el PoC no incluye identidad autenticada del stack objetivo, repositories, API/IPC, aplicación completa, despliegue ni operación productiva.

| Gate | Amenaza/control/prueba demostrados en el subconjunto | Evidencia que aún falta |
|---|---|---|
| `SEC-G01` | RLS/FORCE, runtime sin BYPASSRLS, fail-closed sin tenant o con tenant inválido, aislamiento SELECT/INSERT/UPDATE/DELETE, FK tenant-aware y reuse de contexto | Propagación desde identidad autenticada, repositories y suite end-to-end del stack objetivo |
| `SEC-G05` | Idempotencia, checksum mismatch, Outbox 1:1, Inbox central durable, ACK perdido, retry sobre la misma intención, Checkpoint sin salto y recuperación local | Autenticidad fuerte del payload, transporte real, ventanas y alertas de replay |
| `SEC-G06` | Audit append-only, atribución causal y rollback conjunto con hechos comerciales | Integración de `AuditPort`, redacción completa, señales antifraude, retención y consulta operativa |
| `SEC-G08` | Rechazo de UUID, decimal, estado, FK, secuencia, referencia y `limit_type` inválidos | Zod/API/IPC, webhook, CORS/CSRF/rate limit y validación de aplicación |
| `SEC-G09` | Dump/restore PostgreSQL con roles separados y backup/reapertura SQLite WAL con hechos durables | DR automatizado, RPO/RTO medidos, cifrado/rotación, rollback de release y supply chain |

`SEC-G02`, `SEC-G03`, `SEC-G04`, `SEC-G07` y `SEC-G10` no reciben evidencia suficiente para registro parcial. La evidencia íntegra de la corrida está en `poc/physical-model/results/evidence.txt` y su resumen en `poc/physical-model/results/summary.md`.

## Readiness documental de TECH-002/R5

R5 cerró contratos de schema, no ejecutó controles. Para `SEC-G01`, Session ahora exige RLS/FORCE, policy tenant exclusiva para `pos_app`, servicio Identity global explícito sin BYPASSRLS y ausencia de grants para worker; falta probar esas policies y el contexto autenticado sobre DDL real. Para `SEC-G02`, refresh lookup y revocación quedan detrás del rol Identity separado; faltan implementación, hashing/token, MFA y pruebas de replay. Para `SEC-G06`, `AuditEvent.resource_reference_kind` hace verificable `INSTANCE|SYSTEM|BATCH` y la nulabilidad de `resource_id`; faltan DDL, AuditPort, redacción, antifraude y retención.

Estas mejoras son `schema readiness` únicamente. `SEC-G01`, `SEC-G02`, `SEC-G06` y todos los demás gates conservan `PLANNED / NOT_EVALUATED`; R5 no registra PASS ni evidencia runtime nueva.

## Vacíos que permanecen abiertos

- duraciones exactas de tokens, refresh, reautenticación, bloqueo y ventanas de replay;
- proveedor y mecanismo concreto de secretos/KMS/HSM/Vault;
- estrategia web definitiva que determina el control CSRF concreto;
- thresholds antifraude y responsables/escalamiento por severidad;
- valores numéricos contractuales de RPO/RTO por modalidad y tamaño de cliente, conforme a `DEC-009`;
- periodos legales de retención fiscal, auditoría y evidencia por jurisdicción;
- topología portable definitiva, firewall/segmentación y endurecimiento por ambiente;
- política formal de aceptación temporal de vulnerabilidades y SLA de remediación;
- integración del patrón RLS aprobado en `PHY-G14` con contexto autenticado, repositories y pruebas del stack objetivo;
- implementación y pruebas de los tres puertos de observabilidad.

Estos vacíos no autorizan defaults productivos. Deben cerrarse en decisiones o configuraciones versionadas antes del gate que dependa de ellos.

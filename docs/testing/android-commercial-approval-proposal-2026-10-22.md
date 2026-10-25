# Propuesta única de desbloqueo comercial — 2026-10-22

**PROPUESTA, NO APROBADA.** El propietario confirmó que no dispone todavía de activación DEV-003 ni confianza central verificadas y no ha aprobado SEC-004/D3/DEC-025. Este documento consolida la solicitud; las tablas anteriores de custodia/acceso conservan fundamento histórico, no son solicitudes adicionales. No se modifica configuración productiva por publicarlo.

El propietario no necesita inventar UUID ni proporcionar secretos. Primero debe identificar el despliegue Central Authority y su administrador autorizado, o confirmar que hay que preparar ese despliegue. Los registros y claves públicas se obtienen de esa autoridad existente mediante sus servicios/procedimientos; no de React, una cuenta compartida o SQL improvisado sobre bases persistentes.

## Una decisión conjunta y sus datos

Continuidad Windows desde `ceb10463`, 2026-10-25: la misión posterior autoriza
preparar y probar las partes independientes de aprobación, incluida la
evaluación SQL **sólo en bases temporales**. Se materializan el puerto/lifecycle
SAS del Service, el emisor con contador propuesto y una función definer
**exclusivamente de bloqueo**, además de vectores criptográficos D3 LAB V2.
[Alcance, decisiones concretas y evidencia](windows-p0-continuity-2026-10-25.md).
La función no lee datos: las validaciones de sesión/dispositivo/alcance y RLS
permanecen en su transacción llamadora. Esto precisa la alternativa de lectura
definer de la tabla inferior, sin aprobarla ni modificar esquemas productivos.
Los vectores V2 no son un formato HTTP, no son DPoP y no activan renovación.
No se añaden solicitudes paralelas: las decisiones inferiores siguen formando
esta única aprobación conjunta.

Continuidad 2026-10-25: la misión expresa del propietario «Cierre DEC-011 y
distribución confiable de SAS», sección 3, autoriza **contrato candidato y pruebas
independientes en laboratorio** mientras se obtiene aprobación del formato
productivo. Esta autorización posterior acota la frase «no se codifica el wire
format» de la tabla: sigue prohibida su adopción productiva. Se materializa
`DEC011_LAB_CANDIDATE_1`, exclusivamente `ISOLATED_VALIDATION` /
`isolated-validation`, separado de SESSION_ASSERTION, sin montaje productivo.
[Contrato, límites, pruebas y pendientes](sas-trust-candidate-2026-10-25.md).
La tabla conserva la **única solicitud pendiente**: no se considera aprobada
la raíz real, su canal de provisión, la cadencia de renovación ni el formato
productivo por haber pasado pruebas del candidato.

Continuidad P0 2026-10-24 desde `9639c9f`: [cierre técnico de provisión/confianza](commercial-provisioning-continuity-2026-10-24.md). La siguiente precisión **forma parte de esta misma solicitud y no está aprobada**. La corrección de verificación de revocaciones conserva el contrato SSA; el borrador SQL sólo se ensaya en PostgreSQL desechable. No se ha creado ni activado un formato SAS root-signed.

### Precisión para aprobación conjunta Windows: confianza, acceso y persistencia

| Decisión / archivo afectado | Recomendación concreta, aún no activada | Riesgo y consecuencia | Aprobación / evidencia necesaria |
| --- | --- | --- | --- |
| DEC-011, `packages/contracts/src/session-trust.ts` y distribución/resolver/store | Extensión explícita **separada** para SAS; conservar literalmente SESSION_ASSERTION. Firmar con raíz un sobre completo que incluya versión de esquema, propósito AUTHORIZATION_SNAPSHOT, issuer esperado, entorno, generación y conjunto íntegro de claves públicas/estados/ventanas/versiones; custodia local separada de SSA. Reutilizar Ed25519/canonicalización/store protegido existentes. Preferir raíz de producto existente con dominio de firma y propósito cerrados, sólo si el custodio autoriza su uso SAS; raíz separada si su política lo exige | El formato actual firma cada clave, **no** la generación o composición del bundle; no basta cambiar el literal de propósito. Un distribuidor que recombine artefactos antiguos puede eludir la intención de una revocación. La firma del sobre también debe cubrir omisiones. Verificar issuer/purpose/environment y raíz antes de consumir estados; persistir generación y tombstones de forma atómica, rechazar conflictos y downgrade, no resucitar key-id revocados | Propietario/seguridad/Authorization/custodio: aprobar dominio de firma, contenido del sobre, raíz y procedimiento de distribución/rotación/revocación. Claves públicas/huellas por canal independiente; ninguna privada en chat. Probar manipulación de generación/conjunto/issuer/propósito, alias SSA, raíz ajena, rollback, conflictos, reinicio y rotación. Sin esta aprobación no se codifica el wire format ni se monta publicación SAS |
| D3 access: codec aislado, DeviceProof y coordinador nativo | Mantener como candidato un perfil JWT sender-constrained propio, con issuer y audiencia canónicos, propósito/clave distintos de SSA/SAS, cliente y credencial exactos derivados del canje; no adoptar automáticamente el JWT de laboratorio. Cada petición comercial debe cubrir también audiencia/origen esperado y hash del access, además de método/ruta/cuerpo/nonce/IDs. Diseñar verificador dedicado/versionado; no alterar bytes POS-DEVICE-REQUEST-V1 existentes. Headers candidatos: Authorization conserva DeviceProof, access en un header comercial dedicado nuevo; nombre/gramática y campo firmado requieren especificación aprobada | V1 firma path y hash del cuerpo, no origin/audiencia ni access. Su combinación aislada no es DPoP. No reusar `x-isolated-business-access` en SYSTEM_TRUST ni tomar sessionId como bearer. La alternativa es implementar RFC 9449 completo como decisión distinta; renombrar DeviceProof no lo hace conforme | Seguridad/Identity: aprobar perfil exacto de claims, audiencia, algoritmo/clave, wire contract, errores, anti-confusión y cómo el autenticador nativo de HttpsAuthorizationSnapshotProvider lo produce. Probar sustitución de access, audiencia/origen/ruta/cliente/credencial, replay y rotación. RFC 9700 §2.2 / RFC 9449 fundamentan posesión y replay, no fijan este formato propio |
| D3 refresh: `identity.session_refresh_tokens` y custodia Service | Token opaco, hash central, familia/parent/replacement existentes; binding durable e inmutable de familia a cliente/credencial/instalación/dispositivo, derivado del canje. Rotación y auditoría en una transacción; reuse revoca familia; posesión fresca de la misma credencial en ruta cerrada de renovación. Recomendación inicial: no persistir refresh nativo entre reinicios hasta aprobar recuperación; pérdida exige ceremonia nueva, no fallback a un UUID | La tabla canónica hoy no contiene ese binding y el rotador aislado no implementa posesión de dispositivo. Su ventana fija de laboratorio no es política productiva. Rotación de DeviceCredential cancela familias antiguas; no transferirlas silenciosamente. Cancelación/pérdida de pipe/logout destruyen referencias temporales; no prometer borrado físico de strings en memoria de JS | Identity/seguridad/operación: aprobar ampliación del owner canónico, cliente/clave por familia, ruta/body/header, absolutos/inactividad, revocación y custodia/recuperación DPAPI. Probar dos rotaciones concurrentes, reuse, credencial diferente, auditoría fallida, expiración, desconexión y restart. No nuevo almacén paralelo ni endpoint de refresh productivo |
| Authorization / contador: `tools/target-migrations/sql/postgres/proposals/sas_sequences.*.sql` | Tabla propuesta `authorization.snapshot_sequences`, binding DEC-011 user/install/device; start 1, exacto +1, techo JS seguro, snapshot_id/checksum y timestamps; watermark retenido. Reserva UPSERT y evento canónico en la misma transacción. SQL protegido para DB desechable, sin número de migración aprobado ni registro automático | El contador no prueba identidad ni permiso ni tenant; la transacción emisora debe revalidar todas las fuentes. Borrarlo reviviría replay. Se ensaya idempotencia por checksum/lock/ledger existente; falta integrar runner y smoke/catálogos/predecesores aprobados. La tabla validation de laboratorio no se promueve | DB/Authorization: aprobar DDL, owner/RLS central-only, límites de privilegios, número/predecesores/runner, conservación y despliegue. Ensayo físico en este incremento; down sólo en vacío. No DDL productivo autorizado |
| Authorization / locks RBAC: productor central aislado y futura transacción canónica | Preferir una función **mínima** revisada para lectura/bloqueo consistente bajo owner controlado, invocación sólo del rol central; SQL estático, `search_path` fijo sin esquemas escribibles ni temp implícito, validación de sesión/tenant/membresía/device/sucursal y alcance derivado de DB dentro de la función. Conservar decisión de emisión/auditoría en la transacción central existente; ningún argumento de React concede alcance | FOR SHARE necesita UPDATE, incluso sin modificar filas. Otorgarlo en tablas RBAC al runtime aumenta autoridad y queda descartado como solución automática. SECURITY DEFINER también es elevación: requiere revisar RLS FORCE, grants EXECUTE/PUBLIC, owner, locks en orden estable, phantoms de nuevas asignaciones/grants y revocación concurrente. Un advisory lock sólo entre emisores no protege frente a todos los writers RBAC | DB/seguridad: aprobar y revisar firma/owner/RLS/punto de serialización con writers canónicos antes de crear función. El incremento prueba la denegación con privilegios actuales, **no** una implementación definer. Necesarios carreras con inserción/revocación/cambio de grants, tenant ajeno, search_path hostil, deadlock/retry y rollback |
| D3/DEC-011/012, vigencias, abuso y offline | Mantener parámetros explícitos y candidatos temporales de esta propuesta sin activarlos. Acotar emisión SSA/SAS por sesión/access/credencial/clave y transiciones; un refresh no alarga la sesión absoluta ni una prueba MFA antigua. SAS sin gracia; recuperación de conexión refresca antes de operar. DEC-011 documenta 24 h inicial como configuración SAS; no extrapolarla a SSA/BUSINESS ni sustituir con los 30 s del fixture | La menor ventana efectiva manda; un access de 5 min candidato también limita SSA/SAS en la composición actual. Sin renovación aprobada puede exigir login frecuente. Revocación offline no es instantánea; la exposición dura hasta expiración. Límites de infraestructura/readiness no son controles de abuso de autenticación | Propietario/seguridad/operación: ratificar conjunto consistente tras medir jornada, latencia, conectividad y NAT; definir actividad confiable, budgets durables y fallos de almacenamiento. Pruebas de borde, abuso distribuido, pérdida de red, reloj y recuperación; no gracia ni silencioso fallback |
| DEV-003 / operador Windows | Responsable real prepara dominio/TLS/DB, registro exacto Windows/RP y registros canónicos de empresa/sucursal/install/device, emite activación por owner Devices y entrega sólo cadena pública por canal autenticado. Verificar huellas independientemente y correspondencia con la clave generada/custodiada en el equipo; preparar/complete existentes, sin import de fixture | Configuración tipada no demuestra procedencia, autorización o posesión. `GET /ready` indica enrollment listo y commercial_auth NOT_ACTIVATED. Aún no hay entorno ni administrador confirmados; no ejecutar SQL improvisado de alta ni enrolar identidades ficticias | Propietario designa administrador/DNS-TLS/DB/custodio y entorno; operador aporta metadata pública y referencia de autorización por canal privilegiado. Después probar enrolamiento en preproducción y primer humano autorizado; no enviar claves, activaciones ni credenciales por chat |

Fundamento externo de esta precisión: [OAuth Security BCP](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.2), [DPoP completo](https://www.rfc-editor.org/rfc/rfc9449.html), [bloqueos PostgreSQL](https://www.postgresql.org/docs/16/explicit-locking.html) y [precauciones SECURITY DEFINER](https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY). Las elecciones del perfil propuesto son recomendaciones de ingeniería, no valores impuestos por estas fuentes ni aprobaciones.

P0-05 2026-10-24: [preparación ejecutable de infraestructura y aprovisionamiento](commercial-provisioning-2026-10-24.md). Perfil de Central y transporte SAS TLS preparados sin valores reales ni montaje comercial. La tabla final del informe precisa opciones/riesgos para distribución SAS, access/refresh, contador/locks/RLS y operación; integra esta misma solicitud. El formato session-trust sigue limitado a SESSION_ASSERTION, no se reutiliza para SAS. No hay nueva aprobación implícita ni DDL productivo.

P0-04, continuidad autorizada 2026-10-24: [contrato cerrado main↔Service y E2E](windows-privileged-native-channel-2026-10-24.md). Inicio, canje/preparación, commit y cancelación ya están materializados en el host aislado; sustituyen el pendiente de implementación interna anterior. La producción continúa sin coordinador provisionado y deniega estas operaciones. Las políticas, registro/despliegue, DEV-003, confianza SAS y migraciones de esta propuesta no quedan aprobados por el E2E ni por publicar el código.

Continuidad Windows 2026-10-24: [custodia comercial y preparación de despliegue](windows-commercial-custody-2026-10-24.md). El propietario confirma otra vez que no hay entorno Central Authority disponible. El adaptador interno firma desde LocalSecurityComponent y comprueba enrolamiento/credencial en cada uso; no está expuesto por el canal de producto. Para montarlo se propone que el coordinador privilegiado del Service construya y envíe sólo solicitudes comerciales concretas, y main conserve callback/PKCE/state. Revisar contrato de intercambio, binding al intento/cliente, cancelación, límites y custodia temporal antes de añadir handlers al canal autenticado existente. No aprobar ni implementar un RPC genérico de firma ni pasar claves al main. Configuración Windows puede inspeccionarse sin datos Android; eso no aprueba despliegue ni parámetros productivos.

Continuidad 2026-10-24: el [productor SAS](central-authorization-snapshot-2026-10-24.md) ya está implementado/probado en laboratorio Windows. Las menciones inferiores a productor ausente conservan su corte histórico. La autorización de laboratorio no aprueba provisión productiva, nuevos privilegios ni migraciones.

| Precisión SAS de esta misma solicitud | Candidato no activado | Fundamento / riesgo | Aprobación requerida |
| --- | --- | --- | --- |
| Clave y distribución SAS | Ed25519 con propósito exclusivo AUTHORIZATION_SNAPSHOT, entorno, key-id, ACTIVE/VERIFY_ONLY/REVOKED y ventana; confianza pública provisionada por canal privilegiado, distinta de SSA | DEC-011 y receptor existente; confiar en SSA como SAS permite confusión de propósito. El runtime productivo falla cerrado sin claves SAS | Authorization/seguridad y operador del despliegue: perfil, custodia, root/cadena, rotación y revocación reales |
| Monotonía y lectura consistente | Contador durable por usuario/instalación/dispositivo en owner Authorization, reservado con auditoría atómica; locks y checksum de fuentes | El contador del fixture no autoriza DDL productivo; FOR SHARE necesita privilegios que hoy no están concedidos para RBAC | DB/Authorization: migración y privilegios mínimos revisados; no ampliar UPDATE productivo automáticamente |
| Roles y versiones ambiguos | Conservar rechazo explícito de dos roles al mismo scope y de versiones duplicadas del mismo grant hasta aprobar precedencia/composición | Contrato SAS admite un assignment por scope. Unir permisos o elegir la versión mayor puede conceder autoridad no aprobada | Authorization/propietario: definir composición y precedencia con ejemplos de permisos revocados; laboratorio no elige por ellos |
| Sucursal y exposición de revocación | Binding tenant/company/branch/installation/device provisionado y validado; TTL explícito acotado por sesión/access/credencial/clave/transiciones | DeviceRegistry no prueba por sí solo una sucursal. DEC-011 permite revocación diferida offline hasta expiración; 30 s es sólo fixture medido funcionalmente | DEV-003/seguridad/operación: mapping real y vigencia/actualización tolerable; no activar el TTL de laboratorio como política |

| Área / parámetro | Candidato concreto que se propone | Fundamento / riesgo | Información o aprobación requerida |
| --- | --- | --- | --- |
| DEV-003: origen del binding | Configuración instalada por canal privilegiado con tenant/company/branch/installation/device obtenidos de registros centrales; identidad local DEC-020 y prepare/complete del DeviceEnrollmentService existente | Los IDs son selectores, no prueba. La credencial debe certificar la clave local, el binding y su vigencia; la nueva composición lo verifica y exige auditoría completada | Identificar entorno central, operador autorizado y registros reales de empresa/sucursal/instalación/dispositivo. Yo verificaré por lectura su correspondencia antes de instalar configuración; no pedir al operador que genere IDs |
| DEV-003: confianza y activación | Root público de despliegue y cadena operacional DEVICE_TRUST verificada; activación de un uso emitida por la autoridad canónica para este binding; confianza SSA/autorización provisionada por sus contratos propios | No usar la raíz de cifrado Android, clave de laboratorio ni credencial de otro equipo como raíz central. Cambiar clave certificada exige revocación/reaprovisionamiento explícito | El responsable del despliegue exporta únicamente artefactos públicos firmados y huellas. Comparar huella con consola/fuente independiente del despliegue antes de incorporarla al host. El secreto de activación se entrega por procedimiento protegido al host, nunca en chat/Git/argv/logs |
| SEC-004: custodia Android | AES-256-GCM no exportable para envolver semilla aleatoria de 32 bytes, HKDF por contextos canónicos; exigir hardware-backed en perfil productivo; sin autenticación OS en cada uso para servicio de fondo | Keystore protege la clave de envoltura, no vuelve inexportable la semilla ni el Ed25519 que el proceso usa en RAM. El laboratorio observó hardware-backed en este M60WL; eso no aprueba el perfil. [Android Keystore](https://developer.android.com/privacy-and-security/keystore) | Aprobar este perfil y su exposición residual a compromiso del UID/OS; validar pantalla bloqueada y arranque del servicio. No hay fallback TEST_ONLY |
| SEC-004: recuperación/distribución | Backup de secretos deshabilitado; pérdida de raíz/identidad → bloquear, revocar credencial anterior y enrolar explícitamente; actualizaciones solo con firma autorizada y preservación comprobada de datos | La reinstalación con misma firma ya tiene evidencia de laboratorio; rotación de firmante, pérdida de claves y recuperación aún no están certificadas | Designar custodio del firmante productivo, procedimiento de actualización/recuperación y aprobación del soporte Android 9. Claves privadas fuera de Git/chat; no desinstalar ni borrar la app actual para probar recuperación |
| D3: ceremonia humana y cliente | Navegador externo para contraseña/WebAuthn en RP/origen HTTPS reales; Authorization Code + PKCE S256/estado/uso único. Android: retorno HTTPS mediante App Link verificado; Electron: loopback 127.0.0.1 del main, como candidato previo | El navegador externo y los mecanismos de retorno se fundamentan en [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252). El App Link requiere asociación del dominio con paquete/certificado; debe probarse en Android 9. [Verificación Android](https://developer.android.com/training/app-links/verify-applinks). No autenticar WebAuthn desde file:// ni desde el origen de assets | Proporcionar hostname HTTPS realmente controlado y responsable de DNS/TLS; aprobar RP/origin exactos, client_id, redirect, applicationId/firmante y publicación de asociación del dominio. No se ha elegido dominio ni se ha registrado cliente |
| D3: prueba de acceso | Mantener candidato access JWT con perfil RFC 9068/7800, issuer/audience/algoritmo/propósito de claves explícitos y confirmación de la clave de dispositivo; DeviceProof liga hash del access/cuerpo/path/request-id al binding vigente; estado BUSINESS revalidado en DB por uso | [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) y [RFC 7800](https://www.rfc-editor.org/rfc/rfc7800) aportan perfiles/semántica; esta combinación requiere especificación versionada propia, no se declara DPoP ni conformidad ya implementada | Aprobar perfil completo, audiencia, clave operacional separada y contrato de consumo de códigos. Conservar identity.sessions y refresh canónicos. Ni sessionId, SSA, un booleano MFA o un objeto serializado son access |
| D3: ventanas candidatas | Challenge 120 s; MFA inicial 60 s; código nativo 60 s y un uso; access máximo 5 min acotado por sesión; sesión absoluta 8 h e inactividad 15 min; reautenticación crítica 5 min | Hipótesis de ingeniería de la solicitud anterior, no exigencias de RFC ni resultados medidos. Puede interferir con jornada/offline si no se define actividad confiable y recuperación | Aprobar tras medir interacción real/latencia, definir actividad confiable y conducta al perder Internet. No cambiar el TTL SSA/offline existente ni extrapolar GLOBAL a BUSINESS |
| D3: refresh, revocación y abuso | Refresh absoluto máximo 8 h, hash/rotación/consumo y detección de reuse transaccionales; cambio de contraseña/factor revoca sesiones/familias. Ensayo: 5 fallos/5 min por cuenta, 50/5 min por origen, backoff 1/2/4…30 s y pausa 15 min | Revocación y mitigación de replay según [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700). Los umbrales son candidatos para medir, no valores normativos; riesgo de DoS por bloqueo y NAT compartido | Aprobar origen/proxy confiable, almacenamiento transaccional y desbloqueo, probar carreras y carga. Mantener revisión Argon2id v19/19 MiB/t2/p1 según benchmark del servidor; no volver a ejecutar suites históricas sin dependencia modificada |
| DEC-025: React compartido/origen | Empaquetar el renderer existente como assets propios, cargar con WebViewAssetLoader y origen local HTTPS de assets documentado por Android. La ceremonia WebAuthn permanece en el dominio central externo | [Contenido local Android](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content) permite contenido empaquetado con esquema HTTP(S). El origen de assets no es un RP central, no concede sesión y no es un dominio comercial inventado | Aprobar esta opción de host, CSP/navegación/orígenes exactos y distribución/firma. Comprobar features del WebView instalado; no descargar código remoto privilegiado ni habilitar acceso file universal |
| DEC-025: canal nativo → servicio | Candidato: mensajería WebView con allowlist exacta de origen y main-frame → extremo nativo mismo UID → socket Unix privado de app → frames/MAC/replay/connectionId/handlers existentes. MAC/custodia en nativo/servicio, nunca en React. Binder hardware existente no exportado | [WebViewCompat.addWebMessageListener](https://developer.android.com/reference/androidx/webkit/WebViewCompat#addWebMessageListener) ofrece reglas de origen; hay que verificar feature real y fallar cerrado si falta. No exponer WebSocket de control, addJavascriptInterface libre ni quitar guard Windows | Aprobar protocolo/versión, identidad de extremo, límites, cierre/revocación y custodia. Después implementar el adapter en esta misma línea y probar origen ajeno/iframe/replay/desconexión/versiones. No está habilitado ni se considera autorizado por esta propuesta |

## Cómo obtenerlo y activarlo con seguridad

### Precisión del contrato nativo tras conectar HTTPS (misma solicitud)

La prueba HTTPS ya conecta contraseña/MFA/BUSINESS/cookie con DeviceProof, PKCE
y JWT/refresh en PostgreSQL temporal; eso no resuelve automáticamente la entrega
entre navegador externo y cliente nativo. El verificador actual firma
`/v1/business-session/assertions` y un cuerpo con `session_id`. Al abrir el navegador
el cliente aún no conoce ese BUSINESS recién autenticado. El navegador tampoco
puede custodiar la clave de dispositivo. No debe trasladarse esa clave a React
ni llamarse DPoP a la prueba existente. Las siguientes filas precisan la misma
aprobación conjunta; no son una segunda solicitud ni una configuración activada.

| Parámetro bloqueante | Propuesta concreta, no activada | Riesgo / fundamento | Aprobación y dependencia |
| --- | --- | --- | --- |
| Correlación navegador ↔ dispositivo antes de BUSINESS | Solicitud nativa previa, autenticada con la credencial instalada, vinculada de forma inmutable a `client_id`, redirect exacto, S256 y state; nonce de autoridad de un uso y 60 s como candidato. Después de contraseña/MFA, resolver esa solicitud en servidor y revalidar el dispositivo antes de emitir el código existente. No reutilizar el propósito/ruta SSA ni aceptar un sessionId como posesión | Inferencia de integración propia: evita pedir la clave al navegador y evita un puente HTTP local de firma. [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) sustenta navegador externo/PKCE, pero **no especifica este DeviceProof propio**. Requiere amenazas de login swapping, replay y mezclas de clientes/tenant; 60 s debe medirse | Owner Identity + Device Trust + seguridad deben aprobar schema, firma/propósito, URL, almacenamiento durable y consumo atómico. No se han inventado ese formato ni una tabla paralela; hasta aprobar, sólo existe la composición de prueba con proof delegado |
| Renovación nativa con access vencido | Vincular en la persistencia canónica de refresh la familia con cliente y credencial de dispositivo verificados en el canje original; resolver por hash del refresh y exigir posesión fresca de esa misma clave. Conservar la tabla existente mediante migration revisada, no vincular `identity.sessions.device_id` | La tabla actual liga refresh a BUSINESS pero no almacena cliente/credencial. No es seguro derivarlos de UUID/JSON del llamador ni depender de un access todavía vigente para renovarlo. [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700) trata replay/rotación y credenciales restringidas al emisor; [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) es una alternativa estándar que **no se declara implementada** | Aprobar perfil sender-constrained propio o DPoP completo, binding durable, revocación y recuperación; Identity/DB/seguridad. Sigue sin habilitarse grant refresh HTTP productivo. La rotación interna existente no se reconstruye |
| Retorno Electron | Mantener callback exacto registrado en `127.0.0.1:<puerto>/callback`, main exclusivo, S256/state efímeros y un uso. Si se elige puerto dinámico, aprobar expresamente la regla de registro que sólo varía ese puerto | [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) describe loopback/puertos efímeros. El contrato existente exige puerto exacto; el componente nuevo lo conserva. Riesgo de puerto ocupado mitigado con fallo cerrado, sin buscar silenciosamente otro | Responsable del despliegue proporciona registro real y aprueba puerto fijo o excepción dinámica; no cambiar redirects registrados desde React |
| Retorno Android y custodia | App Link exacto `/android/callback`, paquete y SHA-256 del firmante instalado; DAL HTTPS sin redirects y comprobación OS. Estado/verifier de un uso en memoria; reinicio exige login nuevo. El root Keystore y el pipe privado existentes no cambian | [Verificación Android](https://developer.android.com/training/app-links/verify-applinks): comprobar DAL manualmente no acredita que Android haya verificado el intent-filter. Componentes Kotlin compilan y sus contratos JVM se prueban; la Activity permanece no exportada, sin filtro de dominio ni permiso nuevo | Dominio/paquete/firmante reales, publicación DAL, firma de APK y pruebas en Android 9. SEC-004/DEC-025 deben aprobar custodia/retorno/entrega al servicio; no abrir un callback externo antes de ello |

El entry browser GET y la ceremonia visual HTTPS ya están conectados en el host
aislado: [prueba real de Electron/Chromium y PostgreSQL](commercial-browser-ceremony-2026-10-22.md).
No se montan en producción ni entregan un código nativo, SSA o permisos al POS.
Esa entrega privada sigue pendiente del binding previo especificado aquí;
la aprobación no crea grants ni una sesión POS.

**Prioridad Windows, independiente de Android:** decidir el registro Electron
(dominio/RP/origen/cliente y loopback exacto), binding previo nativo-dispositivo,
perfil de acceso/refresh, vigencias/abuso y provisión DEV-003. Se recomienda
continuar con navegador externo + S256/state y el callback exacto ya existente,
sin firma en React ni cambio del propósito SSA. La solicitud previa firmada,
su nonce de un uso y 60 s como candidato requieren aprobar el contrato durable
de la tabla anterior; no están aprobados por esta prueba. SEC-004 Android,
WebView/DEC-025 y App Links no son condiciones de este recorrido Windows; siguen
pendientes sólo para su plataforma. El productor central de grants/policy/SSA
también necesita implementación: no se sustituye con autorizaciones de prueba.

1. Identificar entorno central y administrador autorizado. Si todavía no existe despliegue, preparar su configuración/artefactos y plan de arranque revisable; no crear credenciales ficticias para saltarlo. Confirmar dominio controlado mediante su responsable y disponibilidad TLS antes de fijar RP/redirect.
2. Obtener por los servicios centrales los registros y artefactos públicos; comparar huellas por canal independiente. Mantener privadas las claves de firma. Aprobar por escrito las filas anteriores, incluyendo valores y alternativas que se sustituyan; un silencio no aprueba.
3. Tras aprobar, implementar/validar intercambio, políticas y transporte pendientes en el código existente. Aprovisionar únicamente por procedimiento confiable con auditoría. No abrir un endpoint antes de contar con autenticación/abuso y consumo único. Probar negativos/carreras/rollback en DB temporal primero.
4. Enrolar el M60WL, verificar su credencial contra la identidad local y después autenticar una persona real. Observar Central → BUSINESS → DeviceProof → secuencia 011/012 → SSA → Local Service → autorización React. La emisión central de grants/snapshot RBAC sigue siendo implementación necesaria; la aprobación del diseño no la crea.
5. Solo con ese recorrido, realizar venta/pago/recibo autorizados y certificación USB. La primera apertura física del CD350 necesita además perfil eléctrico real y autorización explícita separada para ese efecto físico, como ordenó el propietario. No se ejecuta ningún pulso por aprobar software.

## Contrato Windows propuesto el 2026-10-23 — laboratorio autorizado, producción pendiente

Esta precisión pertenece a la misma solicitud. El propietario autorizó su
materialización **solo en laboratorio aislado**, en la conversación de PR #96 y
en la orden P0 posterior a `b971e294`. La [evidencia del binding nativo](native-business-binding-2026-10-23.md)
registra el recorrido implementado. No aprueba producción, migraciones, claves
comerciales ni los valores definitivos; 60/120/60 s siguen siendo candidatos.

1. **Registro confiable:** Central publica/configura issuer, RP/origen HTTPS,
   client_id y callback loopback exacto. Main conserva verifier y state en memoria
   y usa S256. React no recibe clave de dispositivo, verifier, access o refresh.
   Android/App Links/Keystore/DEC-025 quedan fuera de esta aprobación Windows.
2. **Challenge previo:** candidato `POST /v1/commercial/native-request-challenges`,
   JSON estricto `{client_id,redirect_uri,code_challenge,code_challenge_method,state}`.
   Central valida registro exacto y S256; devuelve `{challenge_id,challenge,expires_at}`.
   Challenge aleatorio de 32 bytes, expiración 60 s como candidato, hash durable
   y asociación inmutable a esos cinco campos. No autentica usuario/dispositivo.
   Su presupuesto de abuso debe ser aprobado antes de montar una ruta pública.
3. **Posesión nativa:** candidato `POST /v1/commercial/native-requests`, cuerpo
   estricto `{purpose,challenge_id,challenge,client_id,redirect_uri,code_challenge,code_challenge_method,state}`,
   purpose candidato `BUSINESS_NATIVE_AUTHORIZATION_V1`. Main firma los bytes
   originales mediante el envoltorio DeviceProof existente: método POST, **esa
   nueva ruta**, request-id, correlation-id, timestamp, nonce, credential-id y
   SHA-256 del cuerpo bajo `POS-DEVICE-REQUEST-V1`. El laboratorio autorizado
   incorpora un verificador dedicado, sin ampliar la entrada pública ni relajar
   el verificador de `/v1/business-session/assertions`. Central resuelve clave,
   instalación, dispositivo y tenant de la credencial vigente, no del JSON.
   Consumo del challenge y registro del binding/auditoría en una transacción.
4. **Entrada browser:** Central devuelve un request-id aleatorio de 32 bytes y
   URL HTTPS propia con ese selector. El selector no es bearer ni prueba MFA.
   Lifetime del request aceptado: 120 s como candidato para medir interacción.
   Cambiará el perfil GET de laboratorio sólo mediante esa implementación aprobada.
   Browser exige contraseña y WebAuthn, muestra el dispositivo/empresa derivados
   centralmente y pide confirmación explícita del destino antes de ligar BUSINESS.
   Request-id copiado por sí solo nunca autoriza acceso ni emisión de código.
5. **Código y canje:** bajo locks, revalidar BUSINESS/MFA/membresía/tenant,
   credencial y registro; consumir el request y emitir el código de un uso junto
   al evento en la misma transacción. Código 60 s como candidato; almacenar sólo
   hash. Su binding incluye sesión, cliente, redirect, S256/state y credencial
   exacta. Callback conserva state y un uso. Canje requiere verifier y posesión
   fresca de la misma credencial, firmando la ruta `/v1/commercial/token` y sus
   bytes exactos con verificador dedicado; este requisito está implementado
   por el perfil nativo opt-in del endpoint aislado, no en producción. Rotación de credencial obliga a un
   intento nuevo; no migrar silenciosamente familias entre claves.
6. **Persistencia y entrega:** owner Identity, referencias a sesiones y Device
   Trust canónicos, hashes únicos de challenge/request/código, FK y expiraciones,
   transiciones irreversibles y auditoría atómica. La migration, privilegios y
   ubicación física de esos registros requieren revisión del owner; no adoptar
   tablas `*_validation` como almacén productivo ni crear otro sistema de sesión.
   Después del canje, perfil de access/proof aprobado, elegibilidad actual y
   reserva 011/012; la [composición SSA aislada](business-ssa-composition-2026-10-23.md)
   deriva claims canónicos y conecta el issuer existente al canal Windows. Siguen
   pendientes key lifecycle/perfil productivo y productor de política/grants.
   El dashboard sólo consume capabilities del
   backend tras activar/verificar SSA y snapshot de autorización.

| Amenaza | Condición exigida / riesgo residual |
| --- | --- |
| Login swapping / víctima abre un enlace ajeno | Binding a cliente y destino mostrado por Central, confirmación expresa y PKCE/state. Queda riesgo de phishing/engaño al confirmar; necesita revisión de seguridad, no se afirma eliminado |
| Replay y doble canje | Nonces/códigos de un uso, hashes únicos y consumo con auditoría; probar carreras y rollback. No restaurar marcas 011/012 ante fallos posteriores |
| Mezcla de cliente, tenant, dispositivo o credencial | Comparación exacta y estado actual bajo locks; rechazar incluso otra credencial ACTIVE del mismo dispositivo |
| Robo de code/access/refresh | S256 y posesión fresca de la clave; custodia main; expiración/revocación y binding durable de refresh según la fila existente. El perfil actual de laboratorio no equivale a DPoP |
| DoS / puerto ocupado / pérdida de proceso | Presupuesto durable aprobado, fallo cerrado, callback exacto sin elegir otro puerto y login nuevo al perder state/verifier |

**Recomendación y aprobación productiva pendiente:** aprobar o corregir los seis puntos
anteriores como perfil Windows versionado, incluidos 60/120/60 s candidatos,
semántica de firma por ruta, consumo y persistencia, consentimiento de destino,
sender constraint y controles de abuso de las filas previas. Proporcionar dominio,
registro y operador reales sin secretos. No se interpreta una autorización de
desarrollo como aceptación productiva. La autorización expresa posterior cubre
la implementación aislada; no aprueba despliegue ni parámetros productivos.

## Observaciones actuales del equipo, sin cambios

Lecturas ADB autorizadas 2026-10-22: M60WL conectado como device; `ro.build.version.security_patch=2019-03-05`; `dumpsys webviewupdate` indica Chrome/WebView `101.0.4951.61` activo y Google WebView `77.0.3865.92` no habilitado para todos los usuarios. No se actualizó, desinstaló o reconfiguró software. Estos datos exigen validar compatibilidad/plan de soporte antes del perfil productivo; no se infiere que soporte el bridge o una ceremonia WebAuthn correcta.

## Reconciliación necesaria para compras/inventario

La misión amplía el objetivo, pero no define por sí sola un nuevo protocolo maestro. El contrato ejecutable de snapshots, por DEC-012 §32, solo admite CASH_REGISTER. GoodsReceipt requiere proveedores/ubicaciones centrales y políticas versionadas de inventario/lotes/conversión; no se pueden sembrar en React ni recibir un JSON como maestro confiable. Se propone extender el mecanismo firmado existente, con owner central, scope/purpose/monotonía y proyección transaccional explícitos, conservando los tipos cerrados anteriores. Falta cerrar ese contrato de distribución antes de materializarlo; no hay un segundo catálogo.

PurchaseOrder/SupplierDocument/AccountsPayable/SupplierPayment siguen diferidos por el contrato de recepción actual. La implementación siguiente debe reconciliar sus casos de uso/ownership antes de persistir documentos o pagos, conservando GoodsReceipt como hecho físico confirmado. Políticas de deduplicación de lotes, costos/mermas/conversiones y reserva/expiración deben tener versiones publicadas; no se eligen campos o plazos ad hoc. D-21 y D-22 siguen abiertos. Esta reconciliación se incorpora a la misma decisión, sin activar grants o cambiar tablas cerradas automáticamente.

# Propuesta única de desbloqueo comercial — 2026-10-22

**PROPUESTA, NO APROBADA.** El propietario confirmó que no dispone todavía de activación DEV-003 ni confianza central verificadas y no ha aprobado SEC-004/D3/DEC-025. Este documento consolida la solicitud; las tablas anteriores de custodia/acceso conservan fundamento histórico, no son solicitudes adicionales. No se modifica configuración productiva por publicarlo.

El propietario no necesita inventar UUID ni proporcionar secretos. Primero debe identificar el despliegue Central Authority y su administrador autorizado, o confirmar que hay que preparar ese despliegue. Los registros y claves públicas se obtienen de esa autoridad existente mediante sus servicios/procedimientos; no de React, una cuenta compartida o SQL improvisado sobre bases persistentes.

## Una decisión conjunta y sus datos

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

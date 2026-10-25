# Access y refresh V2 vinculados al dispositivo — 2026-10-25

Base `42c79cd8942528e6ed04c554a5cd0eda276f73cc`, rama única
`feat/android-commercial-runtime`, PR #96 draft. Autorización del propietario
para materializar SAS/access-refresh registrada; no se vuelve a pedir.

## Implementación

Sobre el owner existente de access, `CommercialBusinessAccessAuthority` emite
JWT Ed25519, typ at+jwt, claims estrictos ver=2, issuer/audiencia/cliente,
BUSINESS/membresía/tenant/instalación/dispositivo/credencial y familia. Incluye
cnf.jkt calculado con la clave pública Ed25519 del dispositivo (JWK canónico).
Lifetime y ventana del firmante son dependencias explícitas. No admite tokens
LAB V1 ni un bearer sin posesión. El access nunca confiere grants por sí solo.

`CommercialProofV2 credentialId.timestamp.nonce.signature` es el wire propio
versionado de la propuesta aprobada, **no DPoP** ni un cambio de DeviceProof V1.
La firma cubre dominio POS-COMMERCIAL-POSSESSION-V2, origin, audiencia, cliente,
tenant/instalación/dispositivo, tipo/hash del token y bytes canónicos V1 de
POST/ruta cerrada/request-id/correlación/cuerpo exacto/frescura. El máximo skew
se suministra explícitamente y no supera los 120 s admitidos por el ledger 012.

El verificador de replay existente resuelve la clave y el estado actual desde
DeviceTrust, valida la firma y consume el mismo ledger 012. No crea otro almacén
de nonces ni admite una ruta arbitraria. El proveedor Service firma únicamente
refresh por esta nueva operación, revalidando custodia DPAPI, enrolamiento,
credencial/clave/binding vigentes. No se añade un método al preload o renderer.

Refresh usa JSON estricto `{grant_type:"refresh_token",client_id,refresh_token}`.
Los refresh siguen siendo opacos, 48 bytes aleatorios, 64 caracteres base64url;
se persiste sólo SHA-256. La prueba vincula también el token, no sólo el cuerpo.
Cliente/origen/audiencia de verificación proceden de registro confiable y familia
persistida, no del JSON. Rotar no requiere un access todavía vigente.

`PostgresCommercialRefreshFamilies` extiende la tabla canónica mediante el
artefacto revisable `proposals/commercial_refresh_binding.up.sql`: cliente,
credencial/instalación/dispositivo/tenant, issuer/audiencia, límite absoluto de
familia y ancla de credencial/versión de contraseña. Sin backfill de familias
anteriores ni segunda tabla. La migración no está registrada en el runner ni
aplicada en bases comerciales. Su down rechaza descartar familias vinculadas.

La raíz de familia es única; los hijos heredan su binding y límite. Triggers
impiden mutar el binding, revertir consumo/revocación o alterar un hijo para
cambiar familia. Conservan el comportamiento de las filas antiguas no vinculadas.
Sin privilegios UPDATE generales sobre RBAC ni cambios en sessions.device_id.

El canje nativo existente crea familia y access dentro de la transacción que
consume PKCE, después de DeviceProof fresca. La renovación crea hijo + access +
eventos en una transacción; si falla auditoría/firma, revierte todo ese conjunto.
La prueba 012 ya consumida permanece quemada. El refresh usado con prueba nueva
revoca la familia, por lo que sus access también dejan de verificar. Pruebas
idénticas concurrentes sólo consumen una vez; pruebas frescas concurrentes
serializan y detectan reutilización. El presupuesto de rotaciones se cuenta en
filas durables, no en memoria; no sustituye el control de abuso del HTTP público.

Se reutilizan elegibilidad BUSINESS/SSA y eventos canónicos, con locks de sesión,
usuario, membresía, tenant, empresa, dispositivo, credencial, factor y contraseña.
Se rechazan credenciales de dispositivo antiguas tras una generación posterior.
La lectura de familia revalida después de adquirir locks y conserva el orden
sesión→familia para evitar inversión con rotación/logout.

## Evidencia y límite de ejecución

35 PASS PostgreSQL temporal/Electron (28 casos nuevos V2 y 7 regresiones
afectadas), 29 PASS custodia DPAPI/SQLite (1 nuevo), 8 PASS replay V1 y 5 PASS
vocabulario de eventos. Total 77 casos funcionales distintos, 0 FAIL final;
170 casos omitidos por filtro. Pruebas y hashes en el JSON de evidencia adjunto.
La regresión Electron conserva dashboard sólo con los grants canónicos del
fixture; no fabrica permisos V2 ni autentica una persona.

Fallos iniciales corregidos: campo device_id no admitido por el contrato del
repositorio de eventos; importación directa de zod no declarada en Central.
Se usó el contrato existente de eventos y se trasladó el esquema al paquete
contracts. No se instalaron dependencias ni se relajaron gates.

Estado: núcleo de backend implementado y probado; canje→access/familia→posesión→
renovación alcanzable por el coordinador central en PostgreSQL temporal.
**No es el flujo productivo Windows completo.** El canje/HTTP de ese coordinador
sigue aislado; falta registrar/revisar migraciones Identity, montar transportes
productivos con abuso y custodia durable de tokens en Service. El proceso main
central conserva NOT_ACTIVATED y rechaza expresamente la ruta refresh.
La provisión/rotación real del firmante necesita el custodio y claves auténticos.

Siguen pendientes transición de raíz SAS y transporte remoto de provisión,
adopción SQL/runner, parámetros operativos, Central HTTPS/DEV-003 auténticos y
certificación humana/CI. No se presenta una implementación pendiente como una
mera aprobación externa. Sin cambios visuales, licencias, hardware o Android.

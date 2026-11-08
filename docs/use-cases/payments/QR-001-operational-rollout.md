# QR-001 — Nequi / Bre-B: habilitación controlada y prueba inicial

Estado: código en PR #103 Draft. **No es una certificación productiva**. No altera FACTUS Pay ni Wompi, ni confirma ingresos bancarios.

## Capacidades implementadas
- Central: PNG QR oficial validado y almacenado por tenant+empresa, destinos/llaves/nequi publicados/revocados por rol administrativo activo en sesión BUSINESS y cookie-CSRF. Sin URLs públicas ni generación sintética de QR.
- Datos: PostgreSQL 024 con RLS por empresa, auditoría/outbox, secuencias y acuses por instalación. SQLite 019 como caché verificada.
- Cajas Windows: `payment.destination.get` de solo lectura con permiso `PAYMENTS_PAYMENT_READ`; el renderer nunca envía tenant, empresa o cuentas.
- Sincronización: solicitudes de dispositivo firmado a `/v1/commercial/merchant-destinations/{snapshot,floor,ack}`, sin cookies, atadas a ruta, nonce y credencial de dispositivo ACTIVA; respuesta firmada Ed25519 por Central; verificación de firma/empresa/versiones; escritura SQLite; acuse durable. Poll cada 30 s. Si expira la configuración offline, no se anuncia como vigente.
- Los cuatro POS de una misma empresa muestran idénticos métodos publicados (aunque sus números de secuencia/tiempos de refresco pueden diferir). La propagación y revocación no son instantáneas; dependen de conectividad y caducidad.

## Precondiciones reales (sin improvisarlas)
1. Identificar la autoridad HTTPS Central del comercio y una base de datos PostgreSQL autorizada; debe utilizar la composición comercial de producción existente y el dispositivo enrolado. No asumir que existe servidor VPS ni usar credenciales de otro módulo.
2. Certificar y **aplicar 024 por el migrador canónico** `--merchant-destinations` a una base Central autorizada; ejecutar sus smoke-tests físicos y RLS con roles sin privilegios administrativos.
3. Preparar una clave Ed25519 de propósito exclusivo `MERCHANT_DESTINATION_SNAPSHOT`, independiente de firma SSA, SAS y access token. La clave privada nunca sale de Central; el dispositivo recibe la pública desde un instalador autenticado. No registrar claves en Git, logs, CI o este chat.
4. Central (solo cuando schema+HTTPS+composición comercial estén certificados):
   - `CENTRAL_MERCHANT_QR001_ENABLED=true`
   - `CENTRAL_QR001_PRIVATE_KEY_FILE=<archivo absoluto protegido, PEM Ed25519>`
   - `CENTRAL_QR001_KEY_ID=<ID operacional único>`
   - `CENTRAL_QR001_VALID_FROM=<ISO-8601>`
   - `CENTRAL_QR001_VALID_UNTIL=<ISO-8601>`
   - `CENTRAL_COMMERCIAL_PROVISION_FILE` y restantes parámetros HTTPS/Business ya existentes deben estar completos.
   - PREPRODUCTION mapea a ambiente QR `STAGING`, PRODUCTION a `PRODUCTION`.
5. Cada caja Windows enrolada:
   - `POS_CENTRAL_BASE_URL=<mismo HTTPS Central>`
   - `POS_QR001_PUBLIC_KEY_FILE=<archivo absoluto protegido PEM público>`
   - `POS_QR001_KEY_ID=<coincide con Central>`
   - `POS_QR001_ENVIRONMENT=STAGING|PRODUCTION`
   - el Service necesita DeviceIdentity/credential ACTIVE protegidos por Windows DPAPI. El archivo de firma no se obtiene del renderer.
6. Tras un inicio correcto, **Administración web comercial**: autenticar con BUSINESS+MFA y reautenticación reciente; cargar PNG QR oficial, llave o número; guardar y publicar. La interfaz de escritorio Empresa/Configuración no se ha sustituido por otra vista. Sin permiso OWNER/GENERAL_ADMIN explícito de esa empresa, solo se deniega.
7. Cajas: conectadas a Central y a su servicio local, refrescar vista de cobro; comprobar firma, versión, imagen y número. El cajero carece de cualquier ruta para editar. En offline la pantalla solo usa snapshots no expirados y no certifica créditos bancarios.

## Pruebas finales en cuatro cajas
- Empresa A con 4 instalaciones: mismo QR oficial SHA-256, llave, número y método, sin cambios por cajeros. Tras publicar nueva versión, todas se actualizan al reconectar.
- Empresa B con otro QR: nunca ve datos de A; intentar IDs ajenos en administración y pruebas firmadas resulta en rechazo.
- Intento con token, firma, nonces o certificados caducados; empresa, instalación o ambiente distinto: rechazo. Rotar clave mediante instalador seguro antes de la vigencia final.
- Revocación desde Administrador: versiones posteriores sin método activo, no cobro con un QR no verificado.
- Dos transferencias simultáneas al mismo QR por importes idénticos: ambas siguen PENDING hasta conciliación autorizada; **no** hay referencia bancaria unívoca garantizada por el QR estático.

## Formatos reales Nequi P2P y Bre-B (validación con capturas privadas, sin pagos)
- Se analizaron dos capturas privadas **JPEG de 744 × 1536 píxeles** entregadas por el propietario. Son ejemplos personales y **NO** se suben al repositorio ni a ninguna base comercial.
- El código QR Nequi identifica el tipo `P2P.NEQUI`, distinto del producto `QR Negocios` descrito por Nequi. Internamente el contrato conserva el discriminante histórico `NEQUI_BUSINESS_QR`; **ese nombre técnico no acredita un registro Negocios**. El frontend lo presenta como QR Nequi original.
- El QR Bre-B codifica una llave de pagos como parte del payload. Para la demostración se confirmó que coincide con la llave escrita por el propietario; los valores particulares no se reproducen en esta guía pública.
- Ambos payloads cumplen la estructura TLV EMV, indicador `01=11` y CRC-16; no incorporan un campo de monto `54`. **Ninguno debe hacerse pasar por QR dinámico con valor precargado**.
- En pruebas de lectura sobre estas capturas, el QR a 224 px no decodificó, pero a 280/320 px sí; Caja muestra **un solo método por vez** y reserva 320 px cuadrados para el QR denso, con ajuste responsivo.
- Para imágenes provenientes de capturas grandes se preparan recortes PNG RGB 800 × 800 con margen blanco y se comprueba que escaneen igual; el sistema acepta exclusivamente un archivo PNG limpio <=1 MiB. **El frontend no hace recorte automático de JPEG todavía**, no afirmar lo contrario.
- El servidor verifica estructura, tamaño y hash del PNG; **NO verifica la titularidad bancaria, vigencia de una llave ni el beneficiario de un QR**. El administrador debe comprobar esos datos en la app financiera antes de publicarlos.
- Se admite una imagen oficial tanto con el método Nequi QR como con `BREB_KEY`, sin modificar los métodos o cuentas de otros comercios. El número Nequi sin QR se registra como método aparte.
- Los QR personales se comparten entre bancos solo cuando la entidad y el producto concreto soportan ese flujo; no asumir interoperabilidad de un QR Nequi P2P con Bre-B Negocios.

## Segunda fase: notificación sin comisión de pasarela
Nequi Negocios puede enviar SMS de pagos mediante Llave Nequi Negocios o QR Negocios a teléfonos registrados por el comercio. **No ofrece con esta funcionalidad un webhook libre documentado**. Automatizar la entrega de SMS o notificaciones a Camacho POS necesita consentimiento, un equipo Android autorizado, validación de permisos/políticas, filtrado, anti-duplicados y pruebas reales; ni el SMS ni una alerta visual acreditan un ingreso bancario. Este PR no habilita confirmación automática ni incluye un receptor SMS productivo.

## Qué evidencia tenemos
El PR incluye pruebas de esquema PostgreSQL 16.14 en contenedor descartable, dominio, Central, SQLite, firma e IPC/React, más test del transporte HTTPS; **no** acredita Central desplegada ni cajas Windows físicas. Revisar el estado CI del HEAD y no fusionar mientras no se hayan ejecutado pruebas E2E con cuenta del comercio.

## Auditoría de transporte de tres QR (2026-11-07)
- Identificadores `x-request-id` y `x-correlation-id` emitidos como UUIDv7 en el cliente Windows, coherentes con la validación criptográfica de la ruta Central.
- Un solo método puede contener una imagen PNG <=1 MiB y su Base64; tres imágenes consumen aproximadamente 4.2 MB sin contar metadatos y firma. El transporte de snapshots admite hasta **4,400,000 bytes** de respuesta y corta la lectura por longitud real (no solo Content-Length). Floor/ACK conservan un máximo de 1024 bytes.
- El cambio no aumenta el tamaño permitido por archivo QR, no autoriza contenido desconocido y no despliega automáticamente el servicio.
- Tests nuevos verifican los identificadores de la prueba firmada y la aceptación/rechazo de cargas dentro/fuera del límite. El valor de cada imagen siempre llega firmado por Central y ligado a empresa e instalación.

## Optimización de sincronización y revocación (incremento posterior)
- La petición autenticada `floor` devuelve ahora dos enteros de Central: `floor` (secuencia ya acusada por esa instalación) y `current_sequence` (última emisión o cambio publicado en la empresa). No incluye números, llaves ni imágenes bancarias.
- Cada caja solo reutiliza la caché si ambas secuencias **coinciden exactamente** con su snapshot local y le quedan más de 15 minutos de vigencia. Un cambio publicado/revocado, falta de acuse, restauración de backup o caducidad cercana obligan a descargar y verificar un snapshot firmado completo.
- El PNG denso del primer método ya no se duplica en `destination` (campo de compatibilidad): se incluye una sola vez en `destinations[]`, manteniendo idénticos beneficiario, referencia, hash y versión. La validación rechaza diferencias y evita sustituciones.
- El chequeo ligero sigue siendo cada 30 s por dispositivo; no promete propagación instantánea si alguna caja no tiene red. Cuando Central está inaccesible, no se publica una configuración nueva y solo se muestran snapshots locales todavía vigentes.
- Las reducciones de transferencia son de diseño y pruebas unitarias. **El consumo real de red de cuatro cajas y la recuperación después de cortes deben medirse con Central HTTPS desplegada y equipos físicos**, no inferirse de tests de mocks.

## Corrección de concurrencia y recuperación (incremento de auditoría)
- La secuencia de la empresa **ya no aumenta en cada consulta de Caja**. Central conserva una generación compartida hasta que Administración cambie/revoque un método o falten aproximadamente 15 minutos para la renovación del periodo configurado (por defecto, TTL de 60 minutos → generación de 45 minutos). Esto impide que cuatro cajas se invaliden mutuamente por leer el QR.
- La consulta de un snapshot vigente es un `SELECT`; Central solo actualiza la fila de secuencia al renovar la generación. La firma sigue cubriendo el contenido completo y la identidad de empresa. La operación se ejecuta en transacción PostgreSQL SERIALIZABLE, con reintento por siguiente ciclo ante conflicto transitorio.
- Si SQLite guarda el snapshot firmado pero se corta la red antes del ACK, el siguiente ciclo solicita un nuevo artefacto firmado. Solo cuando la empresa, secuencia y contenido íntegro (incluidos bytes de los QR) coinciden y la versión sigue vigente, se admite recuperar el ACK sin tratar la misma secuencia como una venta o una nueva publicación. Se rechaza un beneficiario cambiado, revocación, caducidad o firma inválida.
- Este mecanismo evita falsos bloqueos por cierre inesperado; **no** confirma pagos Nequi/Bre-B ni acredita una transferencia.

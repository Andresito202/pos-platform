# SAS: provisión HTTPS y transición de raíz — 2026-10-25

Base local `a58be77f7b1ccc36c072eb2b5dad5e2122aca11f`, rama única
`feat/android-commercial-runtime`, PR #96 draft. Base remota observada
`42c79cd8942528e6ed04c554a5cd0eda276f73cc`. Los 19 archivos del WIP permanecen
en su commit original. Sin cambios visuales, licencias, hardware o Android.

## Materialización

El contrato separado `CAMACHO_SAS_ROOT_TRANSITION_V1` exige firmas Ed25519 de
la raíz anterior y la siguiente sobre los mismos claims completos: issuer,
authority, entorno, recipient, fingerprints, clave pública siguiente, generación
mínima y ventana de aceptación. El firmante offline recibe ambas claves de sus
custodios; no genera ni distribuye claves privadas a Service/main/React.

`AuthorizationTrustStore` conserva el pin inicial y verifica la cadena retenida
en cada lectura. Transición, bundle, generación e historial de claves/tombstones
se reemplazan juntos dentro del almacén cifrado existente. No se crea un segundo
store. Se rechazan ciclos, regresión, firmas/contexto incorrectos e historial
descartado. Reintentar el mismo paquete ya aceptado es idempotente. La ventana
limita la aceptación inicial; una transición aceptada sigue verificándose después
de esa ventana, con el bundle y las claves sujetos a sus propias vigencias.
Límite técnico: 32 transiciones retenidas. No hay reset de confianza ni recuperación
automática si se pierde la raíz/custodia o vence la confianza antes de rotar.

Central reutiliza la publicación de confianza y añade GET fijo
`/v1/authorization-trust`, con token administrado separado de enrolamiento y SSA,
rate limit previo a autenticación, TLS y respuesta no-store. Exige configuración
explícita de despliegue y comprueba issuer/entorno del artefacto. Publica material
firmado preexistente; no concede permisos ni firma con una raíz online. Esta
implementación sirve un artefacto de recipient configurado por instancia, no un
catálogo multidispositivo. El receptor verifica además su recipient y raíz.

El bootstrap privilegiado del Service admite `remote` opcional en el archivo
administrado `POS_AUTHORIZATION_TRUST_PROVISION_FILE`:

```json
{"remote":{"transport_token_file":"<ruta absoluta administrada>","timeout_ms":"<entero aprobado por operador>"}}
```

Es un fragmento documental, no configuración instalable: se conservan los demás
campos obligatorios del contrato existente, incluida `artifact_path`. Central
requiere `AUTHORIZATION_TRUST_ARTIFACT_FILE` y
`AUTHORIZATION_TRUST_TRANSPORT_TOKEN_FILE` juntos. El operador debe crear y
proteger ambos archivos y provisionar el mismo token al Service por canal seguro;
la implementación no valida ACL de instalación ni inventa valores/productores.

El endpoint se deriva del issuer confiable y una ruta fija. Se reutiliza el
fetcher HTTPS con validación del sistema, redirects prohibidos, tamaño máximo
1 MiB, UTF-8 estricto, timeout explícito y cancelación del lifecycle. No hay
fallback silencioso al archivo cuando se configura remoto. Fallos de transporte
conservan únicamente confianza DPAPI ya verificada hasta su vencimiento firmado.
No se agregan operaciones al renderer/preload ni se entregan secretos a main.

## Evidencia observada

Los reportes y hashes reproducibles están en
[windows-sas-remote-rollover-evidence-2026-10-25.json](windows-sas-remote-rollover-evidence-2026-10-25.json).
75 casos funcionales distintos PASS en este incremento, con repeticiones
focalizadas registradas separadamente y sin sumarlas como cobertura nueva:

| Grupo | PASS | Alcance real |
|---|---:|---|
| Store compartido/DPAPI | 54 | 35 LAB afectados + 11 deployment + 8 transición; incluye rechazo, rollback y reinicio |
| Transporte | 14 | 6 regresiones SSA + 8 SAS; origen/ruta, headers, límites, expiración/cancelación |
| Publicación/firmante | 4 | Artefacto acotado, scope issuer/entorno, firmas offline |
| Service main | 1 | Tres arranques reales Windows/DPAPI: raíz inicial, transición HTTPS, renovación con raíz nueva y pin original |
| Central | 1 | Proceso HTTPS real + PostgreSQL temporal; 401/200/503 y login productivo NOT_ACTIVATED |
| Electron | 1 | Regresión afectada de custodia SSA/SAS; grants canónicos del fixture, sin persona real |

TypeScript contracts/Service/Central, build Service/Electron, 16 pruebas de
arquitectura y ARCH-003: PASS. Política y diff se registran en el JSON final.
La prueba Service usa CA efímera sólo en el proceso de prueba mediante
`NODE_EXTRA_CA_CERTS`; no desactiva TLS ni modifica almacenes del equipo.

La primera ejecución PostgreSQL falló en preparación por ECONNREFUSED en 55433,
sin ejecutar esos casos. Windows reservaba ese puerto. El propietario recuperó
WinNAT y arrancó `target-migrations-postgres-1`; después se observaron contenedor
y WinNAT Running. Sólo se usó PostgreSQL tmpfs y bases aleatorias de prueba;
no se modificaron bases comerciales. Los reintentos finales aprobaron.

La evidencia V2 anterior (77 PASS, sin repetirla íntegra) se conserva en
[business-access-refresh-v2-evidence-2026-10-25.json](business-access-refresh-v2-evidence-2026-10-25.json).
La regresión Electron aparece en ambos lotes: no sumar 77 + 75 como casos únicos.

## Cierre exacto del login

IMPLEMENTADO Y VERIFICADO EN WINDOWS: provisión remota de confianza SAS,
transición dual de raíz, custodia DPAPI y reinicio del Service. Backend
access/refresh V2 implementado y probado en composición aislada con PostgreSQL.

IMPLEMENTACIÓN TODAVÍA PENDIENTE: montaje productivo del coordinador nativo,
transporte access/refresh y custodia durable/renovación de esos tokens dentro de
Service, unión de posesión V2 al recorrido productivo SSA/SAS. No basta habilitar
un endpoint ni cambiar un perfil LAB. La creación BUSINESS productiva y los
artefactos SQL de validación mantienen sus bloqueos; no se retiran sus guardas.

BLOQUEOS EXTERNOS: adopción SQL/runner y serialización RBAC (coste medido en el
incremento anterior), parámetros de vigencia/abuso y responsables de custodia,
Central HTTPS/DEV-003/RP/cliente/dispositivo/identidades y claves auténticos.
No se solicita otra aprobación general SAS/access ya otorgada. Falta certificación
con persona y autenticador físico. Actions pendiente hasta restablecimiento
informado por el propietario; no se consultó ni disparó CI ni se modificaron workflows.

Primera continuación: conectar la custodia durable y renovación V2 en el owner
Service existente, con cancelación/logout/reinicio y transporte fijo, antes de
abrir endpoints o emitir credenciales utilizables. Registrar migraciones sólo
tras aprobar el contrato SQL; mantener denegación segura sin entorno auténtico.
Licencias y caché no se iniciaron: login humano y producción siguen sin certificar.

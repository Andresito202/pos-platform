# Seguridad: 27 controles y correcciones — 2026-11-02

## Alcance y resultado

Continúa el candidato [de integración](main-integration-readiness-2026-11-02.md), publicado en `ce2ed5aec595a20dfad2bea6791f837ef64a9825`, misma rama y PR #99 Draft. **No es cierre global de seguridad ni autorización de merge/producción.** No hubo Actions, intervención administrativa de Windows 10, operación productiva, ceremonia humana ni hardware.

Fuente de requisitos: enumeración del propietario en el adjunto de ampliación. El video original no está disponible: no se certifica correspondencia literal con él; 20/21 no tienen contenido. Se revisaron owners de autenticación, transporte, persistencia, pagos, custodia, frontend y Android, con revisión independiente de arquitectura, baseline y HTTP y validación del agente principal. **Cobertura parcial:** no se afirma lectura de seguridad completa de los 1350 archivos rastreados ni auditoría de todo el historial Git.

Código final probado: `3abc72efbf7883d8c3341496956f59c4e725619d`. Commits separados: `e9ea96fa` (admisión de audit), `08884329` (Wompi) y `3abc72ef` (dependencias). El commit documental posterior no cambia ese código.

Las clasificaciones inferiores describen controles de código en el alcance revisado. `IMPLEMENTADO` no significa prueba física, servicio provisionado ni producción. Los resultados se ligan a archivos, hashes y comandos en el recibo adjunto; una prueba con doble de pool/TLS no es PostgreSQL ni TLS auténticos.

## Matriz inicial → final

| Nº | Control | Inicial | Final | Evidencia y decisión | Riesgo residual / certificación pendiente |
|---:|---|---|---|---|---|
| 1 | Autenticación de usuarios | PARCIAL | PARCIAL | `business-initial-mfa-flow.ts:42`, `business-session-authority.ts:26`, `global-administration-sessions.ts:55`: contraseña/MFA, entrega de un uso, ámbitos separados. Sin cambios al login aprobado. | SCM entre identidades, provisión y persona/autenticador pendientes; no se concede dashboard por transporte. |
| 2 | Secretos fuera del frontend | IMPLEMENTADO | IMPLEMENTADO | `preload.ts`, `channel-bridge.ts`, `native-commercial-coordinator.ts:88`: superficie cerrada; custodia Service, no export de token/clave a React. | Evidencia del entorno y de permisos de archivos se comprueba aparte; no prueba ausencia universal de secretos. |
| 3 | PostgreSQL/SQLite/multiempresa | PARCIAL | PARCIAL | `durable-browser-session-store.ts:59` en PostgreSQL; RLS foundation y contexto transaccional; SQLite single writer/WAL. | PostgreSQL 16.14 físico, roles/RLS y revocación concurrente de este HEAD bloqueados. No atribuir aislamiento a un rol Central deliberadamente autorizado entre tenants. |
| 4 | HTTPS/TLS | PARCIAL | PARCIAL | `central-deployment-configuration.ts:17`, `main.ts:151`, `native-commercial-https.ts`: TLS≥1.2, origen/host, validación de clave/leaf, transporte sin redirects. | Confianza real de CA, DNS y despliegue no probados; legacy enrollment no tiene todas las verificaciones del perfil estricto. |
| 5 | Hash de contraseñas | IMPLEMENTADO | IMPLEMENTADO | `platform-password-verifier.ts:18`: perfiles y Argon2id, sal aleatoria. Se reutilizó, sin reconstrucción. | Política y medición operativa dependen del despliegue; una prueba histórica no equivale a certificar una persona. |
| 6 | Entradas backend | IMPLEMENTADO | IMPLEMENTADO | `isolated-commercial-https.ts:34`: esquema, UTF-8, bytes, profundidad, campos/headers duplicados y encodings; schemas IPC/backend. | No supone auditoría completa de todos los parsers; fixtures no habilitan rutas productivas. |
| 7 | XSS | IMPLEMENTADO | IMPLEMENTADO | `commercial-browser-entry.ts` usa escape de configuración y `textContent`; React renderiza texto; CSP. Sin sink peligroso demostrado en el alcance buscado. | No equivale a DAST exhaustivo; mantener revisión de nuevos sinks/HTML. |
| 8 | Actividad sospechosa | PARCIAL | IMPLEMENTADO | Defecto **medio**: el audit de cada rechazo anulaba el límite de trabajo PG. Corregido en `isolated-commercial-https.ts`, con cuotas y operaciones pendientes acotadas, sin cola por solicitud; eventos append-only y muestra de abuso independiente. | Es muestreo acotado de rechazos, no registro de cada paquete ni alerta operativa certificada. Audits transaccionales de autenticación autorizada intactos. |
| 9 | Administración | IMPLEMENTADO | IMPLEMENTADO | `global-administration-http.ts:41`, `global-administration-sessions.ts`: GLOBAL, MFA, CSRF y permisos PLATFORM; no elevación BUSINESS. | Cuenta/ceremonia GLOBAL humana sin certificar. |
| 10 | Inyección SQL | IMPLEMENTADO | IMPLEMENTADO | Repositorios revisados usan parámetros para valores; nombres de tablas/modos cerrados; no se añadieron SQL dinámicos ni grants. | No se afirma revisión completa de toda consulta del repositorio. Prueba física PG pendiente. |
| 11 | Configuración/entorno | PARCIAL | PARCIAL | Perfil comercial exige parámetros/archivos confiables; ejemplos sin datos operativos. Se conserva compatibilidad legacy explícita. | Operador debe usar perfil estricto; ACL y provisión auténtica no inferidas de JSON o rutas. |
| 12 | Rate limiting/abuso | PARCIAL | IMPLEMENTADO | Defecto medio corregido: cuotas globales de **auditoría de rechazo** por categoría, derivadas de `requestsPerMinute`; admisión síncrona antes de await, sin cola, fallo conserva cuota. Limiter HTTP por dirección intacto. | General y audit son por proceso. No demuestra admisión distribuida, límite global de toda operación DB ni benchmark de despliegue. |
| 13 | CORS/orígenes | IMPLEMENTADO | IMPLEMENTADO | BUSINESS/GLOBAL exact Host/Origin/Fetch Metadata; rutas nativas rechazan cookies/origen de navegador; sin CORS comodín revisado. | Validar configuración real del proxy y navegadores. |
| 14 | CSP/HSTS/clickjacking | PARCIAL | PARCIAL | Nonce/CSP, `frame-ancestors 'none'`, DENY, nosniff/no-store en superficies revisadas. | **HSTS no encontrado en Central revisado**; falta política operativa de edge/max-age y prueba HTTPS real. No se inventó vigencia, includeSubDomains ni preload. |
| 15 | Cookies | IMPLEMENTADO | IMPLEMENTADO | Cookie opaca con hash persistido, `__Host-`, Secure/HttpOnly/Strict, rotación/revocación. | Ceremonia HTTPS humana pendiente, no se habilita cookie ficticia. |
| 16 | CSRF | IMPLEMENTADO | IMPLEMENTADO | Cookie/flow/token correlacionados y comparación de hash, origen/método/fetch-site; GLOBAL separado. | No sustituye autenticación ni la certificación de despliegue. |
| 17 | Recuperación/caducidad | PARCIAL | PARCIAL | `platform-password-recovery-repository.ts:110–386`: intentos/expiración, aprobador distinto GLOBAL+MFA, reemplazo y revocación atómicos. | No existe transporte público de recuperación probado; verificación operativa de identidad y PG pendientes. No se inventó un reset HTTP. |
| 18 | Archivos recibidos | IMPLEMENTADO | IMPLEMENTADO | CSV local: `CatalogPanel.tsx:44` y `catalog-csv.ts`: 1MiB, 1000 filas, 4096/campo, sin evaluar fórmulas/XML; backend revalida schema/permisos. | NO APLICA subir archivos por HTTP: no hay ruta identificada. No se supuso importador PDF/XLSX. |
| 19 | Importes/precios/webhooks/pagos | PARCIAL | PARCIAL | FACTUS Pay conserva hash de key→integración/tenant→inbox durable, API GET y cotejo antes de confirmar. Wompi tenía defecto **bajo**, sin caller runtime: selección/concatenación separable; corregido el perfil soportado y añadidas negativas. | Confirmación y activación auténticas pendientes. Wompi no está montado y sólo admite perfiles no ambiguos revisados; metadata no firmada nunca basta como liquidación. |
| 20 | Contenido no disponible | NO VERIFICADO | NO VERIFICADO | No inventado. | Falta fuente original. |
| 21 | Contenido no disponible | NO VERIFICADO | NO VERIFICADO | No inventado. | Falta fuente original. |
| 22 | Dependencias | PARCIAL | PARCIAL | Actualización compatible/pinneada: audit pasó de 11 incidencias high a **0 high/critical**, sin excepciones. Se conserva una moderada. | `minimatch@10.2.5`, GHSA-g3hv-75wg-m249: la corrección publicada es ≥11.0.1; no se forzó otro major sobre consumidores no validados. |
| 23 | Archivos sensibles expuestos | PARCIAL | PARCIAL | Policy prohíbe `.env`, extensiones de custodia y patrones privados rastreados; assets con allowlist, tamaño y rechazo de symlink/traversal. | No acredita ACL de archivos operativos, backups, accesos del VPS ni todo artifact local. |
| 24 | Secretos en Git/artifacts | NO VERIFICADO | NO VERIFICADO | Búsqueda acotada actual sin matches comunes y gate de rastreados PASS; no se imprimieron valores. | No se auditó exhaustivamente el historial ni todo archivo ignorado. Resultado negativo de patrones no prueba inexistencia de credenciales opacas. |
| 25 | Revocación/rotación comprometida | PARCIAL | PARCIAL | Mecanismos de revocación de sesión/familias, cambio de credencial y transición de raíz existentes conservados. | Rotación de secretos externos previamente expuestos no confirmada; no se usaron ni rotaron sin autorización específica. |
| 26 | Análisis estático/dinámico | PARCIAL | PARCIAL | Revisión Standard del código, policy, arquitectura, audit real, unidades y Electron aislado ejecutados. | CodeQL/Semgrep/Gitleaks CLI no disponibles; no se ejecutó pentest Strix ni Actions. Históricos verdes con escaneo omitido no cuentan. Tests de validador SARIF tampoco son SAST ejecutado. |
| 27 | Verificación/evidencia | PARCIAL | PARCIAL | Reproducciones antes/después, revisión independiente de bypass y regresiones afectadas; SHA/hashes/FAIL conservados. | Cobertura parcial, VM/PG/persona/proveedor y controles operativos pendientes: no cierre global artificial. |

Las rutas abreviadas de Central están bajo `apps/central-authority/src/`; las de custodia/Service bajo `apps/pos-local-service/src/security/`; los repositorios bajo `packages/database-postgres/src/`. El informe y el recibo de integración enlazado contienen rutas completas.

## Correcciones, compatibilidad y pruebas

**Auditoría de rechazo:** dos categorías fijas (`limited`/`rejected`), cada una con la cuota explícita `requestsPerMinute` por ventana de 60 segundos que ya usa el limiter. Como máximo una operación pendiente por categoría y ninguna cola de audit por solicitud. El máximo es 2×cuota por ventana y dos operaciones de auditoría pendientes por instancia, no una promesa sobre todos los queries de Central. El token se consume antes del primer await y no se devuelve si falla PG; se conserva 503 para el intento de persistencia fallido. Solicitudes suprimidas siguen rechazadas, sin éxito de autenticación. La categoría de abuso no comparte cuota ni slot pendiente con otros rechazos. El cambio no elimina ni reescribe evidencia previa.

Reproducción de protocolo con dobles: 200 solicitudes retenidas causaban 200 consultas de reloj y 50 direcciones causaban 50. Tras el cambio, la concurrencia queda en dos consultas pendientes y la muestra de abuso se preserva; se verifican churn, cuota tras error, expiración y reloj regresivo. **No es carga PostgreSQL física ni TLS real.**

**Wompi:** se verificó la [documentación oficial de eventos](https://docs.wompi.co/docs/colombia/eventos/), que indica que los campos pueden variar y que se debe respetar el orden recibido. No se cambió el algoritmo del proveedor ni se afirmó soporte universal. Se leen los campos/orden del evento, pero se rechazan perfiles no soportados. El perfil revisado exige ID, estado e importe una vez cada uno, sin campos adicionales; el estado reconocido separa ID e importe. Admite ID–estado–importe e importe–estado–ID; rechaza combinaciones ambiguas y estados futuros no revisados. Es una restricción deliberada de soporte: una ampliación necesita prueba de binding por API, no concatenación arbitraria.

Antes se aceptó mover toda la tupla firmada a `data.attacker`. La revisión independiente encontró además que importe–ID adyacentes permitían trasladar un dígito conservando el checksum; se reprodujo el FAIL y se corrigió. Pruebas finales cubren ambos ataques, campos duplicados/ausentes/extra, mutación de ID/importe/estado, ambos órdenes soportados y los cinco estados documentados. Currency/reference/email siguen siendo metadata informativa; **no constituyen evidencia financiera autenticada**. No se añadió una ruta Wompi, una activación ni otro sistema de pagos.

**Dependencias:** Zod 4.6.6, Electron 44.9.1, Vite Desktop 6.4.5, Vitest 4.1.12, Nx 23.2.1, Undici 7.30.1, follow-redirects 1.16.2 y smol-toml 1.9.0. Pin Vite 8.2.4 en desarrollo raíz satisface los peers existentes de Vitest sin forzar el Desktop de Vite 6 a 8. No se añadieron excepciones ni bajó la severidad obligatoria. Instalación `--ignore-scripts`; sólo se ejecutó después el instalador oficial Electron, con checksums integrados y sin mirror/bypass. Se preservó y comprobó el addon SQLite existente.

La actualización del parser común Zod y del ejecutable Electron justifica repetir los consumidores afectados: es regresión de dependencias modificadas, no reconstrucción del login. Las suites PG físicas siguen excluidas por la misma limitación documentada. Los resultados finales, comandos completos y hashes se publican en `evidence/security-27-closure-2026-11-02.json`, sin sumar reruns superpuestos.

FAIL conservados: reproducciones de ambos defectos; un fixture inicial vacío de clientes no cumplía el constructor y se corrigió como doble no autenticante; dos aserciones usaban nombres literales en vez del código canónico de evento y se corrigieron. SBOM y licencia inicialmente rechazaron la falta de `REVIEWED_SHA`; su resultado definitivo debe usar el SHA exacto del commit, no otro dato inventado.

### Resultados finales observados

| Ejecución | Resultado | Alcance |
|---|---|---|
| Vitest, 13 paquetes seleccionados y última versión del archivo Wompi | **2283 PASS / 0 FAIL / 18 SKIP**, 2301 casos únicos | Se reemplaza el archivo Wompi por su ejecución final de 8 casos, sin sumar reruns. 25 archivos dependientes de PostgreSQL físico quedan fuera. La prueba de listener enrollment con pool doble sí se ejecutó. |
| Nueva admisión de auditoría | **4 PASS** | 200 concurrentes, churn, errores, ventana y reloj; incluidas en el total anterior. |
| Wompi final | **8 PASS** | Reubicación de tupla, ambigüedad importe/ID, mutaciones, perfiles y estados; incluidas en el total anterior. |
| Electron 44.9.1, Playwright sin retry | **14 PASS / 0 FAIL / 0 SKIP** | 34.96 s; binario real, canal/named pipe, DPAPI de usuario interactivo y SQLite temporal. No SCM, persona ni proveedor. |
| TypeScript workspace y Central tras la corrección | **PASS** | No se debilitaron tipos para aceptar los cambios. |
| Desktop build / Service artifact / arquitectura / policy | **PASS** | Dependencias nuevas, código probado y policy después de staging. |
| Tests supply-chain | **45 PASS** | No equivalen a un pentest o SAST de producto. |
| SBOM ligado a SHA | **PASS** | 471 componentes, 16 workspaces, 471 relaciones. |
| Licencias de dependencias ligado a SHA | **PASS** | 455 componentes terceros; cero DENY/REVIEW_REQUIRED. No es activación de licencias del POS. |
| Auditoría de vulnerabilidades ligada a SHA | **PASS del gate** | 0 high/critical, 1 moderate, 0 excepciones. El audit bruto devuelve 1 por la moderada; no se ocultó. |
| SCM/VM/PostgreSQL físico/humano/proveedores | **BLOCKED / NO EJECUTADO**, según superficie | No se atribuyen PASS físicos por las pruebas anteriores. |

Los fallos iniciales y la comprobación de bypass se conservan en logs y hashes del recibo. El Service tardó 401.70 s; no se repitió una batería verde después de ella. El [recibo versionado](evidence/security-27-closure-2026-11-02.json) contiene las selecciones, comandos, SHA, hashes y metadatos del scan. El plugin informó uso acumulado de cuatro hilos: 9.706.282 tokens totales, 9.666.380 de entrada, 9.358.464 de entrada cacheada y 39.902 de salida; incluye historia/cache y **no es estimación del consumo incremental ni de facturación**.

## Pendientes que permanecen abiertos

1. Acceso legítimo a Windows Server 2022 para ejecutar el [único comando consolidado existente](windows-scm-operator-fixes-2026-11-02.md#única-invocación-delegada-windows-server-2022-powershell-elevado). Host Windows 10 intacto; gate SCM no retirado.
2. PostgreSQL temporal 16.14 y pruebas físicas actuales de migraciones/RLS/concurrencia. Nativo 16.11 y Docker inaccesible no se sustituyen por un PASS de repositorios.
3. Provisión auténtica Central/DEV-003, parámetros, claves/custodia/ACL/TLS, política de HSTS/edge/admisión multiproceso, posterior ceremonia humana y proveedores autorizados.
4. Evaluar la compatibilidad de la corrección major de minimatch; ejecutar SAST/DAST reales cuando sus herramientas estén disponibles y revisar el resto del código/historial/artefactos pendiente, sin inventar 20/21.
5. Revisión/CI del HEAD exacto cuando se autorice, manteniendo PR #99 Draft y la decisión NO-GO a main hasta cumplir sus gates. Ningún workflow fue disparado por esta misión.

El scan original queda sellado sobre `ce2ed5ae` y conserva sus dos hallazgos y cobertura parcial. Las correcciones posteriores no reescriben ese resultado; su verificación es evidencia separada. El análisis estructural eligió `local_remediation_preferred`, sin nueva arquitectura ni oportunidades inventadas. No existe certificación SCM, humana, comercial ni de seguridad global por esta entrega.

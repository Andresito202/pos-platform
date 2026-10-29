# Android operativo; contratación sólo web — 2026-10-28

Base: `05086c8d`, continuación única `feat/android-commercial-runtime`, PR #96 Draft. La preparación de dominios/lectura empresarial anterior quedó publicada antes de este incremento. No se modifica DNS, infraestructura, FACTUS, login Windows ni `oracleJdk-27`.

## Decisión aplicada

Android no comercializa acceso digital: sin precios de planes, compras, checkout/QR de licencias, renovación, enlaces de pago, administración GLOBAL ni Play Billing. El cobro de mercadería física sigue perteneciendo a los casos de uso operativos y no se elimina ni se mezcla con licencias. Las autorizaciones proceden del backend y sus snapshots; el rol o una pantalla no otorgan permisos.

## Materializado

1. `operational-boundary.mjs`: barrera real del bundler contra Central Authority, editor/paneles comerciales, clientes de precios y Play Billing. No es CSS ni un menú oculto. `bundle-runtime.mjs` registra inputs que contribuyen al bundle y SHA-256 de ambos entrypoints.
2. `package-runtime-assets.mjs` exige el informe y sus hashes antes de copiar archivos. Un bundle cambiado después de validarlo se rechaza; el informe se incorpora al manifest de assets existente. No se sustituyeron los APK ni los assets previos de laboratorio durante estas pruebas.
3. `OperationalLicenseStatusView`: componente nativo con texto informativo y botón **Consultar estado de licencia**. `TextView` sin autoLink, linksClickable ni movementMethod; sin URI, WebView o intención de navegador. El callback del botón consulta exclusivamente el Binder same-UID del Service.
4. DTO interno `OperationalLicenseInformation`: muestra el texto exacto solicitado para EXPIRED:

   **Licencia vencida**

   «El acceso a nuevas ventas está suspendido según las condiciones de tu licencia. La renovación se gestiona en camachoposcolombia.com.»

   El dominio permanece como texto. El DTO es presentación, nunca prueba de licencia ni autoridad para vender. Su constructor sigue interno; el módulo JVM de pruebas usa friend paths, sin hacerlo público ni exponerlo al renderer/Intent.
5. `LicenseCapacityGate.information`: lectura sobre el verificador de firma y estado SQLite ya existentes. Requiere digest/versión de la capacidad local aceptada; rechaza compañía ajena, manipulación y versiones aún no aceptadas. Informa estado, vigencia firmada, última aceptación local y momento de evaluación. Considera suspensión/revocación persistidas. No activa, renueva, compra, incrementa versión ni autoriza una venta por consultar.

La verificación conserva el guard de reloj existente; puede actualizar su marca de tiempo de seguridad, pero no modifica contratos, activaciones ni auditoría de aceptación de capacidad por leer información. La autorización de operaciones continúa en `authorize`, que no cambió.

## Integración actual y límite preciso

La vista está conectada al host nativo de laboratorio existente. Su Service no tiene una identidad comercial ni raíces provisionadas y devuelve honestamente **UNVERIFIED**. No se carga un archivo de fixture para mostrar una licencia vencida o activa en el dispositivo.

El lector de capacidades está implementado en su owner canónico y probado con SQLite/firma real de test. **Su conexión a un Service Android comercial aprovisionado aún está pendiente**, junto con el canje nativo V2, SSA/SAS, canal React autorizado y distribución firmada. No hay IPC público nuevo para instalar claves o poner una licencia ACTIVE. La consulta nativa actual no llama a FACTUS ni abre checkout.

Los tres días de gracia pertenecen al contrato versionado Central y ya están incorporados por el emisor al límite de la capacidad. El visor no suma otros tres días ni interpreta falta de Internet como renovación. V2 no aporta una fecha nominal de contrato/soporte separada del límite firmado: esos datos no se inventan. El soporte no se usa para caducar una capacidad perpetua. La sincronización de la fundación se identifica como sin aprovisionar; no se presenta una validación local como una consulta reciente a Central.

No se cambian los controles de acceso a datos históricos/fiscales ni se introduce un bloqueo general de pantallas por este aviso. El runtime Android aún no permite certificar la operación real de cajero, supervisor y administrador con sus grants; se mantiene el bloqueo comercial por falta de confianza, sin fabricar roles.

## Pruebas focalizadas

```powershell
node --test apps/pos-android/operational-boundary.test.mjs
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/license-capacity.test.ts -t 'information:' --reporter=json --outputFile=../../artifacts/licensing/2026-10-28/android-license-information-final.json
pnpm --filter @pos-platform/pos-local-service typecheck
pnpm --filter @pos-platform/pos-local-service exec tsc -p ../pos-android/tsconfig.runtime.json --noEmit
node tools/architecture/validate-boundaries.mjs
```

- Bundles y frontera: **3 PASS**. Bundles reales de ambos entrypoints generados en directorio temporal, ausencia de módulos prohibidos, rechazo efectivo de import de editor comercial, hash alterado rechazado y ausencia de Billing en manifest/Gradle. Los módulos de cobro físico no están en la lista prohibida; esto no se presenta como una venta física ejecutada.
- Información de licencia: **1 PASS / 4 filtradas**, SQLite real temporal y claves Ed25519 de fixture. Sin aceptación previa: UNVERIFIED; capacidad aceptada: CURRENT; después de su límite firmado: EXPIRED. Capacidad de test renovada: no cambia el estado por leer; tras aceptación por el gate existente: CURRENT. Firma manipulada/otra empresa rechazadas; suspensión persiste al reiniciar y revocación se refleja. No es una renovación financiera auténtica ni una descarga física desde Central.
- Modelo/vista nativa: **13/13 PASS**, compilación Kotlin y contratos JVM, incluido el texto exacto. Sin toque observado en un equipo físico ni APK comercial instalado. Docker Gradle 8.14/JDK17, offline, `nativeAuthContractsTest`; caché copiada a `/tmp` para evitar la contención del filesystem Windows. El constructor interno se conserva.
- TypeScript del Service y runtime Android: **PASS**. Fronteras arquitectónicas ARCH-003: **PASS**. `git diff --check`: **PASS**.
- Política del repositorio: **PASS**, 1243 archivos rastreados. PR #96 comprobada abierta y Draft; no se ejecutó ni solicitó GitHub Actions.
- No se repiten suites comerciales históricas de ventas/caja, Argon2id ni MFA. No se ejecutan Actions. No se cambió `authorize` ni el transporte Windows.

Fallos conservados: el primer test de lectura modificaba por alias el objeto de renovación al fabricar una firma alterada; se aisló ese fixture con `structuredClone`, conservando el rechazo del verificador. El primer build JVM rechazó el acceso del módulo de test al constructor interno; se configuró friend paths sólo para tests y se eliminó el `data class` para no generar un `copy` público. No se relajó la custodia ni se publicó un constructor para aprobarlo.

Evidencia SQLite local: `artifacts/licensing/2026-10-28/android-license-information-final.json`, SHA-256 `5e380e67bb3f9da0b25b36c31ff015498a69a9f29a9630cecd01e851fa011aff`. Los artefactos locales no se presentan como resultados de CI remoto. Comando JVM reproducible:

```powershell
docker run --rm --env GRADLE_USER_HOME=/tmp/camacho-auth-gradle --mount "type=bind,source=C:\Proyectos\pos-platform\apps\pos-android,target=/work" --workdir /work gradle:8.14-jdk17 sh -lc 'if [ -d /work/build/gradle-home ]; then cp -a /work/build/gradle-home /tmp/camacho-auth-gradle; fi; gradle --offline --no-daemon --max-workers=2 --project-cache-dir /tmp/camacho-operational-ui-cache nativeAuthContractsTest'
```

## Google Play: revisión, no aprobación

Se consultaron las políticas oficiales el 2026-10-28:

- [Pagos](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en): distingue acceso digital de pagos por bienes/servicios físicos. Conservar ventas físicas no autoriza cobrar licencias digitales dentro de Android.
- [Aclaraciones de pagos](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en): contempla información sin enlaces para ciertos servicios de consumo; también restringe flujos que terminan en pagos alternativos. No se añade ni enlace indirecto de administración que acabe en checkout. La clasificación del POS y su ficha completa deben pasar revisión de Google; este aviso no garantiza aprobación.
- [Target API vigente](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en): nuevas aplicaciones/actualizaciones requieren API 36 desde agosto de 2026, salvo excepciones aplicables. El probe declara target 28 y **no está listo para publicar**.
- [Restricción de ejecución desde el directorio de la aplicación](https://developer.android.com/about/versions/10/behavior-changes-10): el launcher probe extrae Node a `filesDir` y lo ejecuta. Esa estrategia requiere adaptación al empaquetado inmutable permitido al elevar el target; cambiar sólo el número del manifest rompería ese recorrido en sistemas modernos. No se hizo ese cambio cosmético ni se reconstruyó el motor.

## Pendientes reales

1. Empaquetado/launcher release compatible con el target vigente, identidad de paquete, firma auténtica y formato de distribución exigido por Play; verificación de librerías nativas y políticas de datos/permiso. No se emitió un APK/AAB comercial.
2. Provisión Android SEC-004/DEV-003 y confianza auténtica; binding nativo V2, SSA/SAS, custodia/renovación, canal y renderer operativo sin módulos web comerciales. Reutilizar motor y componentes existentes; no otro POS.
3. Conectar el lector al Service comercial real y recibir/aplicar capacidad Central firmada mediante el owner existente, con revocación y sincronización autorizadas.
4. Certificar roles, nueva venta suspendida tras gracia, historia fiscal accesible, offline, actualización de derechos y aviso/no navegación en el M60WL físico. Hoy son componentes implementados/pruebas locales, no certificación de operación Android.
5. Central/dominio/TLS y contratos privados/renovación web siguen sujetos al cierre anterior; no se trasladan a Android para eludir sus bloqueos.

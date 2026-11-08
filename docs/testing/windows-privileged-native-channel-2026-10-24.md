# P0-04 — canal privilegiado Windows, integración aislada

Base local/remota `9fa84766ac3789bdc4eab157406cd6f7fc6d9840`, rama
`feat/android-commercial-runtime`, PR #96 draft. Se continúan los 19 archivos
locales originales; no se restaura el respaldo `backup-p004-codex-20261024`.
`docs/product/oracleJdk-27/` permanece intacto y fuera del commit.

## Contrato implementado

Cuatro mensajes cerrados en contracts y en la tabla exhaustiva del canal:

| Operación main→Service | Payload autorizado | Efecto |
| --- | --- | --- |
| `commercial.native.begin` | code_challenge S256 y state | Service resuelve su registro confiable, fija credencial y conexión, registra solicitud central y devuelve URL HTTPS/attempt opaco |
| `commercial.native.complete` | attempt_id, código, verifier y state | Comprueba lease/PKCE/estado; canjea con proof fresca, obtiene SSA/SAS y verifica ambas firmas/bindings. Devuelve VERIFIED, sin activación todavía |
| `commercial.native.commit` | attempt_id | Revalida lease/credencial y firmas; activa SSA y SAS en una transacción SQLite; vincula identidad sólo después del commit |
| `commercial.native.cancel` | attempt_id | Invalida intento y aborta operaciones pendientes |

No se aceptan path/body, credencial, usuario, tenant, empresa, sucursal,
dispositivo ni grants como autoridad del llamador. Correlaciones UUIDv7, estado,
PKCE y request-id se validan; cada operación Central usa su propio request-id
y nonce del firmante canónico. El intento pertenece al `connectionId` que el
servidor crea después de MAC/handshake; no al transportSessionId del cliente.

`LocalChannelComponent` reutiliza named pipe con ACL, DPAPI, MAC, secuencias,
replay durable y negociación existentes. Sin coordinador provisionado devuelve
DENIED; no instancia un firmante por defecto. Cierre/stop libera intentos. El
adaptador main usa una conexión dedicada: cancelación/timeout la cierran y el
servicio aborta sus esperas. Separar preparación y commit evita que un canje
que sigue en vuelo active una sesión después de cancelar antes del commit.
Una activación ya confirmada se recupera mediante el contrato SSA existente;
cerrar su conexión invalida el binding, no falsifica una revocación central.

Service compone `CommercialDeviceCredentialProvider` con identidad viva de
LocalSecurityComponent, credencial cifrada, DeviceTrust y enrolamiento auditado.
Fija credential-id al inicio y lo compara antes de cada petición y del commit,
incluida una credencial nueva válida instalada a mitad del intento. No exporta
la clave. El HTTPS se ejecuta dentro de Service; tokens sólo viven en la llamada
de canje y no cruzan a main/preload/React ni se persisten. No se habilita refresh
ni se inventa una política de retención. `sid` del access se usa sólo como selector
para Central, nunca como prueba de identidad local.

Main reutiliza el callback loopback, state, PKCE y cancelación del login existente.
Recibe sólo resultados, attempt y URL. No hay nuevos canales en la allowlist del
renderer ni métodos de preload; el puente rechaza invocación nativa directa y
suplantación mediante `pos:session.recover`. Firmas SSA/SAS, stores y permisos
backend conservan sus owners. Un SAS vacío válido no concede acceso al dashboard.

## Evidencia observada y límites

- Coordinador: 12/12 focalizadas, incluyendo pipe Windows real con MAC incorrecta,
  handshake de instalación ajena, intento presentado en otra conexión, PKCE
  manipulado, replay, expiración, cancelación, canal perdido, credencial distinta,
  SAS alterado y rollback SSA ante fallo de persistencia SAS.
- Main: 34/34 focalizadas y regresiones de login/código/SSA/allowlist, incluida
  respuesta de otro intento y cancelación durante canje sin emitir commit.
- Conjunto local final: 135 PASS, 0 FAIL, 0 omitidas; incluye las 12 del
  coordinador y las regresiones afectadas de custodia, routing, IPC y SAS.
  Tabla de esquemas del canal: 4/4 adicionales. No se suman otra vez los casos
  del coordinador a los 135. Total de casos distintos seleccionados: 179 PASS,
  0 FAIL y 162 omitidos por el filtro PostgreSQL.
- PostgreSQL/Electron: 6 PASS, 0 FAIL, 162 omitidas por filtro. Dos E2E: recorrido
  previo SSA/SAS con revocación, y nuevo main→pipe→Service→DPAPI→HTTPS→Central.
  Negativos PostgreSQL: credencial distinta, cuerpo alterado, replay concurrente
  y rollback de canje/auditoría. Tras ajustes finales se revalida además el nuevo
  E2E aislado: 1 PASS, 0 FAIL, 167 omitidas; no se suma como otro caso distinto.
- El E2E nuevo autentica contraseña/WebAuthn Chromium virtual, confirma destino,
  canjea y activa SSA/SAS; recupera ACTIVE desde otra conexión y alcanza dashboard
  con sólo AUDIT_EVENT_READ derivado por el productor SQL. Catálogo directo responde
  UNAUTHORIZED. La captura fue inspeccionada; agregados sin permiso siguen cerrados.

El fixture de dispositivo se provisiona desde el padre de prueba directamente al
proceso Service por su IPC privado, se cifra con DPAPI y completa el coordinador
canónico de enrolamiento. Electron no recibe devicePrivatePem ni el secreto de
activación; el driver lo comprueba. Raíces/credenciales son efímeras de prueba:
esto no certifica DEV-003 ni un empleado humano. SSA/SAS provienen de Central y
RBAC canónicos en PostgreSQL temporal, no de grants sembrados en el renderer.

Fallos conservados: primer E2E rechazó vault de otro bundle mediante instanceof;
se corrigió la importación del driver, sin quitar la comprobación. Segundo E2E
alcanzó dashboard pero falló al guardar captura por directorio ausente; se corrigió
mkdir del arnés. Ejecuciones finales aprobadas. No hubo cambios productivos para
resolver estos dos fallos.

Una comprobación posterior no ejecutó casos: el contenedor temporal estaba
detenido y Windows había reservado 55433. Se conserva ese informe (0 casos
ejecutados, 168 omitidos y fallo de suite). Con la recuperación de WinNAT ya
autorizada se inició sólo el contenedor tmpfs, se restauró WinNAT Running y
se prepararon sus roles sin superuser/bypass para runtime. Reintento: 1/1 E2E
PASS. No se atribuye el bloqueo de infraestructura al código ni se cambió puerto.

TypeScript de contracts/local-channel/Central/Local Service/desktop, build completo
Electron y ARCH-003 con 16/16 checks aprobaron. Política de repositorio PASS con
1015 archivos rastreados, incluidos los nuevos preparados; ningún workflow modificado.

Salidas completas y captura: `artifacts/native-privileged/2026-10-24/`, resumen
publicado con hashes en [evidencia](windows-privileged-native-evidence-2026-10-24.json).
El PostgreSQL dedicado usa tmpfs y bind local 55433; cada ejecución crea/elimina
su DB aleatoria. No se modificó ninguna base comercial ni migración productiva.

## Reproducción y siguiente paso

Con el PostgreSQL temporal/roles del procedimiento existente, desde la raíz:

```powershell
pnpm --filter @pos-platform/pos-desktop build
pnpm --filter @pos-platform/pos-desktop exec esbuild src/native-business-login.ts --bundle --platform=node --format=esm --outfile=dist/native-browser-login-probe.mjs
pnpm --filter @pos-platform/pos-desktop exec esbuild ../../packages/device-trust/src/request-proof.ts --bundle --platform=node --format=esm --outfile=dist/device-proof-lab-probe.mjs
pnpm --filter @pos-platform/pos-desktop exec esbuild e2e/ssa-native-transport.ts --bundle --platform=node --format=esm --outfile=dist/ssa-native-transport-probe.mjs
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
$env:POS_E2E_AUDIT_DIRECTORY='C:\Proyectos\pos-platform\artifacts\native-privileged\2026-10-24\electron'
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-access-preparation-physical.test.ts -t 'central SAS: Electron|native binding: token rejects other credential|native binding: token proof cannot authorize|native binding: concurrent token replay|native binding: audit rollback preserves token'
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/commercial-device-credential.test.ts tests/channel-routing.test.ts tests/central-sas-reception.test.ts tests/commercial-ipc.test.ts tests/authorization-snapshot.test.ts tests/snapshot-acquisition.test.ts --no-file-parallelism
pnpm --filter @pos-platform/pos-desktop exec vitest run tests/native-commercial-service-login.test.ts tests/native-business-login.test.ts tests/native-business-code-transport.test.ts tests/native-business-assertion-delivery.test.ts tests/ipc-allowlist.test.ts
pnpm --filter @pos-platform/local-channel exec vitest run tests/response-schemas.test.ts
```

No se monta el flujo nuevo desde production-entry/main productivos. El coordinador
exige política ISOLATED_VALIDATION; el HTTPS nuevo exige NODE_ENV=test, CA explícita
y destino reservado del fixture. P0-04 queda CALLER_REACHABLE/END_TO_END **en host
aislado**, sin activar producción. No hay nuevo HTTP público ni RPC genérico de firma.

P0-01/02: faltan entorno HTTPS, administrador, RP/origen y registro reales.
P0-03: activación, cadena y binding de empresa/sucursal/instalación/dispositivo
reales. P0-05/06: confianza SAS separada, persistencia/migraciones y privilegios
revisados, perfil access/refresh, vigencias, abuso, offline y montaje productivo.
P0-07: ceremonia interactiva autorizada posterior. Se conserva la
[propuesta única](android-commercial-approval-proposal-2026-10-22.md).

CI remoto queda **pendiente de ejecución** hasta restablecimiento (1 de noviembre
de 2026 según el propietario). No se espera Actions, no se cambian workflows ni
se declara CI verde. El siguiente incremento debe conectar provisión real y
perfil de despliegue aprobado al mismo coordinador, sin reconstruir P0-04.

# Access posterior al canje → reserva SSA — 2026-10-23

Base local/remota `04928c094b03965f0722706ad8e94bb9b5203895`, misma rama
`feat/android-commercial-runtime`, PR #96 draft. Directorio concurrente
`docs/product/oracleJdk-27/` conservado. No bases comerciales, hardware ni frontend modificados.

| Implementación | Archivo | Resultado |
| --- | --- | --- |
| Identidad actual desde access ya verificado | `packages/database-postgres/src/business-session-access-repository.ts` | Obtiene fechas de la sesión persistida y reutiliza la elegibilidad vigente; IDs solos no autentican |
| Access y posesión → secuencia | `apps/central-authority/src/business-access-preparation.ts` | Verifica firma y estado live, exige proof de la misma credencial, reutiliza 012/011 y vuelve a validar después de reservar |
| Consumidor posterior al canje | `apps/central-authority/src/isolated-business-auth-coordinator.ts` | `prepareSessionAssertion` conecta las piezas anteriores, sin endpoint ni claims/SSA/grants |

La prueba HTTPS nueva autentica por contraseña y MFA, establece cookie, verifica
DeviceProof, emite/canjea código con S256 y usa el access resultante con otra
DeviceProof fresca para reservar secuencia persistida. No se crea otra sesión,
tabla ni autenticador para unir esos pasos. El nuevo consumidor funciona sólo
en ISOLATED_VALIDATION y DB temporal autorizada; conserva el bloqueo productivo.
La prueba usa el proof delegado de laboratorio existente, no el binding previo
todavía pendiente. No firma access ni SSA desde React.

Misma credencial significa **credential-id**, no sólo device-id o clave iguales.
Se rechaza una caducidad de reserva superior a la de la credencial verificada.
Nonce y reserva conservan commits independientes de sus owners: un fallo de 011
revierte su escritura pero no restaura un nonce de 012 ya consumido; una revocación
posterior rechaza el resultado dejando un hueco. La reserva no autoriza firmar
más tarde sin revalidación. Claims/política/grants y key lifecycle siguen pendientes.

## Pruebas ejecutadas en este incremento

```powershell
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/pos_target_test'
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-access-preparation-physical.test.ts -t 'access-to-sequence|resolves a current BUSINESS session|keeps a consumed nonce|revalidates session revocation|logs out the bound BUSINESS|admits exactly one concurrent preparation' --reporter=json --outputFile='C:\Proyectos\pos-platform\artifacts\auth-access\2026-10-23\access-sequence-tests.json'
```

**16/16 aprobadas, 92 omitidas**: 11 nuevas y 5 regresiones de la preparación
compartida/logout. Incluye token/UUID/JSON inválidos, selector ajeno, credencial
distinta, suspensión, revocación de sesión/credencial, replay concurrente,
secuencias concurrentes, rollback y revocación final. PostgreSQL tmpfs dedicado
reiniciado y roles de fixture no superuser/no bypass RLS preparados; cada suite
crea y elimina una DB aleatoria. Fallos previos: faltaba pos_migrator tras perder
tmpfs; un fixture usó revocation_reason en vez de la columna canónica. Corregidos
sin cambiar schema, predicados ni aserciones para obtener verde.

TypeScript Central y database-postgres aprobaron. Build desktop completo aprobado.
Una **E2E de regresión existente** con Electron real también aprobó (107 omitidas):
ceremonia HTTPS, WebAuthn Chromium, BUSINESS/logout y servicio Windows auténticos.
No se presenta como nueva E2E de SSA: el POS sigue sin recibir assertion/grants.
Comando: mismo archivo con `-t 'Electron browser ceremony'`, previo build del probe
`esbuild src/native-business-login.ts --bundle --platform=node --format=esm --outfile=dist/native-browser-login-probe.mjs`
desde pos-desktop. JSON en `artifacts/auth-access/2026-10-23/electron-regression-tests.json`;
capturas y observaciones en el subdirectorio `electron-regression/`.

## Decisión y siguiente eslabón

La [propuesta única](android-commercial-approval-proposal-2026-10-22.md) contiene
ahora contrato Windows concreto de challenge/request nativos, firma por ruta,
PKCE/state, consumo durable, canje restringido a credencial y amenazas; **pendiente
de aprobación**, sin rutas/migration activadas. Android no es un gate de Windows.
Faltan registro/autoridad/confianza reales, contrato previo aprobado, perfil
access/refresh/abuso y productor central de policy/grants/SSA. Tras aprobar el
contrato, implementar su persistencia/consumo en Identity y los verificadores
dedicados; después componer el issuer y snapshot sin datos de React como autoridad.
No se autenticó empleado humano ni se habilitó dashboard/productivo.

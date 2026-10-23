# Binding nativo BUSINESS — laboratorio Windows, 2026-10-23

Base local/remota `b971e294ee0582f503637ad541d08a88e32554ad`, única rama
`feat/android-commercial-runtime`, PR #96 draft. Se retoman los once archivos
pendientes, sin restaurarlos ni reconstruir las capacidades cerradas. Directorio
concurrente `docs/product/oracleJdk-27/` preservado. Autorización del propietario:
comentario «contrato Windows en entorno aislado» de PR #96 y orden P0 del chat.

## Código y recorrido observado

- `IsolatedNativeBusinessRequests` persiste challenge/request en Identity de la
  DB desechable; hash SHA-256 de ambos secretos aleatorios, registro exacto,
  S256/state, expiraciones y presupuesto durable serializado por cliente. La
  credencial ACTIVE y su clave pública salen de DeviceTrust existente.
- Verificador dedicado de `/v1/commercial/native-requests` y `/v1/commercial/token`,
  reutilizando crypto y ledger 012. El método público SSA conserva su ruta exacta;
  no recibe una ruta elegida por el cliente. Cuerpo crudo, nonce, identificadores,
  fecha y credencial están firmados. Auditoría exige correlación UUIDv7.
- HTTPS aislado exige selector vigente y confirmación explícita después de
  contraseña/MFA/BUSINESS. Muestra comercio, dispositivo e instalación resueltos
  por Central mediante `textContent`; no usa datos de React como autoridad.
  El perfil nuevo rechaza las entradas antiguas sin binding y el canje sin proof.
- Emisor existente consume request + emite código + audita en una transacción;
  revalida elegibilidad canónica/MFA bajo locks. Código ligado a cliente,
  callback exacto, S256/state y credencial. Canje exige proof fresca del cuerpo
  exacto y misma credencial; credencial distinta se audita REJECTED, sin falso
  evento de éxito. Reautenticación se comprueba con política explícita.
- Main conserva verifier/state y credenciales en su custodia existente. El nuevo
  adaptador solo permite abrir el origen HTTPS registrado con un selector; timeout
  y cancelación siguen disponibles mientras registra. El E2E cruza callback real
  loopback y canje HTTPS firmado; después obtiene SSA por el transporte aislado,
  reutiliza 011/012/issuer y activa/recupera ACTIVE en servicio Windows real.
- Sin snapshot, `authorization.capabilities.get` devuelve permisos vacíos y
  `AUTHORIZATION_SNAPSHOT_UNAVAILABLE`; dashboard cerrado. Firma SSA alterada,
  replay y canal perdido se rechazan. No se fabrican grants ni se cambia preload.

Nonce y secuencia mantienen los commits de sus owners. Un fallo posterior no
restaura pruebas consumidas. Registro/auditoría fallidos revierten juntos
challenge/request; canje/auditoría/credenciales fallidos revierten juntos el
código, pero el reintento requiere otra proof. No hay DDL automático en runtime,
migración productiva, endpoint público o cambios de datos comerciales.

## Ejecuciones reales y fallos conservados

Windows, PostgreSQL 16.14 en tmpfs dedicado `127.0.0.1:55433`, Electron real con
autenticador virtual CTAP2 de Chromium y firmas WebAuthn auténticas, no empleado
humano. Cada suite crea/elimina `pos_business_session_test_*`; runtime sin
superuser/bypass RLS. Claves efímeras del fixture, nunca aprovisionamiento comercial.

- Final: **32 PASS, 0 FAIL, 113 omitidas**. Son 26 casos nuevos y 6 regresiones de
  componentes modificados. Incluye dos E2E (nuevo recorrido y ceremonia anterior),
  identidad/posesión, consumo, expiración, revocación, tenant, concurrencia, PKCE,
  estado, credencial distinta, límites, reautenticación vencida y rollback.
- Desktop: **20/20**, cuatro nuevas de URL preparada/cancelación y 16 relacionadas.
- TypeScript Central/PostgreSQL/desktop, build desktop, arquitectura sin caché y
  política del repositorio: aprobados localmente. CI se consulta sobre SHA publicado.
- Primera ejecución: **20 PASS / 4 FAIL**. Tres por presupuesto compartido entre
  fixtures, corregido usando registros de cliente distintos por caso; el límite
  no se elevó. Timeout E2E: correlación UUIDv4 incompatible con auditoría UUIDv7;
  se corrigió el arnés y el rechazo temprano, sin relajar auditoría. Reintento
  posterior sin Docker no ejecutó casos; no cuenta como validación del código.
- Recuperación de infraestructura autorizada por el propietario: Windows había
  excluido 55408–55507; WinNAT se detuvo para iniciar solo el contenedor tmpfs y
  quedó restaurado Running. Roles del fixture se recrearon en el servidor temporal.
  Tras recuperarlo: 25 PASS / 1 timeout E2E; al corregir correlación, E2E 1/1 PASS;
  la ejecución final anterior confirma el conjunto completo.

Comandos desde la raíz, con Docker temporal y roles canónicos preparados:

```powershell
pnpm --filter @pos-platform/pos-desktop build
pnpm --filter @pos-platform/pos-desktop exec esbuild src/native-business-login.ts --bundle --platform=node --format=esm --outfile=dist/native-browser-login-probe.mjs
pnpm --filter @pos-platform/pos-desktop exec esbuild ../../packages/device-trust/src/request-proof.ts --bundle --platform=node --format=esm --outfile=dist/device-proof-lab-probe.mjs
pnpm --filter @pos-platform/pos-desktop exec esbuild e2e/ssa-native-transport.ts --bundle --platform=node --format=esm --outfile=dist/ssa-native-transport-probe.mjs
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/pos_target_test'
$env:POS_E2E_AUDIT_DIRECTORY='C:\Proyectos\pos-platform\artifacts\auth-native\2026-10-23\final'
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-access-preparation-physical.test.ts -t 'native binding:|Electron browser ceremony|HTTPS commercial: actual password MFA|HTTPS commercial: audit failure rolls atomic|resolves a current BUSINESS session and composes authentic DeviceProof|rejects a body changed after signing|rejects durable device request-id replay' --reporter=json --outputFile='C:\Proyectos\pos-platform\artifacts\auth-native\2026-10-23\native-binding-final-tests.json'
pnpm --filter @pos-platform/pos-desktop exec vitest run tests/native-business-login.test.ts tests/native-business-code-transport.test.ts tests/native-business-assertion-delivery.test.ts
pnpm exec nx run pos-platform-target:architecture-check --skip-nx-cache
pnpm ci:repository-policy
```

JSON y capturas locales en `artifacts/auth-native/2026-10-23/`, incluidos fallos;
observaciones del nuevo E2E y capturas con nombres distintos en `final/`. No contienen
access/refresh ni claves. El header `x-isolated-business-access` y la confianza
TLS/claves del driver son exclusivamente laboratorio. El firmante efímero usado
por main en el E2E no sustituye la custodia/enrolamiento real de LocalSecurityComponent.

## Productor de permisos y bloqueos humanos exactos

La fuente canónica existe en PostgreSQL: `authorization.user_role_assignments`,
`roles`, `role_permission_grants` y `permissions` (001, matriz vigente). El
receptor/contrato/verificador SAS también existen. No se encontró un productor
central de `SignedAuthorizationSnapshot` conectado a esas tablas. No se firma
uno desde el arnés para abrir el dashboard. Faltan resolver versiones/vigencias
de grants, preservación de retirados/revocados y combinación de roles por scope
sin duplicarlo (el contrato admite un assignment por scope), reserva monótona
durable del snapshot y custodia/perfil de su clave de autorización. Son trabajo
del owner central Authorization sobre DEC-011; SSA no transporta permisos.

Para login humano faltan despliegue HTTPS/RP/registro y operador reales, DEV-003
y confianza verificadas, adaptador nativo de firma mediante custodia real
(el E2E usa clave efímera en main), migración/revisión del almacenamiento del
binding y aprobación productiva del perfil access/refresh, tiempos y abuso,
además del productor SAS y una prueba autorizada con empleado real. Se mantiene
la [propuesta única](android-commercial-approval-proposal-2026-10-22.md); no se
reabre el binding como bloqueo de laboratorio ni se declara producción aprobada.

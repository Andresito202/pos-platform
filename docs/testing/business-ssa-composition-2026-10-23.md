# BUSINESS → SSA → Electron Windows — 2026-10-23

Base local/remota: `7fab4f9e4a21911d28a4330bd81a01e7aa99a6d5`, rama
`feat/android-commercial-runtime`, PR #96 draft. Sin cambios en schema, bases
comerciales, React, permisos, hardware ni integración Android/Linux. Se conserva
el directorio concurrente no publicado `docs/product/oracleJdk-27/`.

## Incremento ejecutable

`IsolatedBusinessAuthCoordinator.issueSessionAssertion` verifica access, exige
DeviceProof fresca de la misma credencial y reutiliza la reserva 011/012. Relee
la elegibilidad canónica y la credencial exacta bajo locks, deriva únicamente los
claims de identidad del servidor y llama al `CentralSessionAssertionIssuer`
existente. Audita antes de devolver la SSA, dentro de la transacción de guardia;
un fallo no entrega assertion ni confirma el evento. Nonce/reserva conservan los
commits de sus owners: el fallo posterior deja un hueco, nunca restaura replay.
La expiración queda limitada por sesión, access, credencial, certificado y
política explícita. Claves, entorno y tiempos se inyectan desde el host confiable.
Solo admite `ISOLATED_VALIDATION`, entorno `isolated-validation` y PostgreSQL
temporal autorizado. No habilita endpoints o emisión productiva.

`activateNativeBusinessAssertion` entrega la SSA desde main por el canal nativo
existente; valida contrato, correlación y secuencia de la respuesta. Local Service
conserva la autoridad de firma, binding, persistencia y replay. No se expone SSA,
access, refresh ni clave privada a React. El driver E2E usa DPAPI, handshake y
servicio Windows reales; recibe solo confianza pública certificada de prueba.

## Evidencia observada

- 11/11 casos focalizados PostgreSQL/Electron, 108 históricos omitidos: identidad
  verificada, raíz/clave/estado inválidos, UUID, certificado vencido, política
  ausente, revocación BUSINESS/credencial, replay concurrente y rollback auditoría.
- Una de esas 11 es E2E: contraseña/MFA HTTPS → código S256 → access → DeviceProof
  → reserva → SSA firmada por Central → main → servicio Windows → ACTIVE recuperada.
  Firma alterada, replay y canal cerrado se rechazan. Sin snapshot, capabilities
  devuelve `AUTHORIZATION_SNAPSHOT_UNAVAILABLE`, permisos vacíos y dashboard cerrado.
  La ceremonia usa las credenciales autorizadas del fixture y el binding delegado
  de laboratorio existente; no prueba el binding previo pendiente ni un humano.
- 16/16 unitarias desktop relacionadas (4 nuevas de entrega, 12 regresiones del
  archivo afectado). TypeScript Central, desktop y Local Service: exit 0. Build
  completo desktop: exit 0. ARCH-003 ejecutado sin caché: 16/16 y validador exit 0.
- Artefactos locales reproducibles: `artifacts/auth-ssa/2026-10-23/` contiene JSON
  de pruebas, `browser-observations.json` y `ssa-active-without-grants.png`.

```powershell
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/pos_target_test'
$env:POS_E2E_AUDIT_DIRECTORY='C:\Proyectos\pos-platform\artifacts\auth-ssa\2026-10-23'
pnpm --filter @pos-platform/pos-desktop build
pnpm --filter @pos-platform/pos-desktop exec esbuild e2e/ssa-native-transport.ts --bundle --platform=node --format=esm --outfile=dist/ssa-native-transport-probe.mjs
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-access-preparation-physical.test.ts -t 'business SSA composition' --reporter=json --outputFile='C:\Proyectos\pos-platform\artifacts\auth-ssa\2026-10-23\ssa-composition-tests.json'
pnpm --filter @pos-platform/pos-desktop exec vitest run tests/native-business-assertion-delivery.test.ts tests/native-business-login.test.ts tests/native-business-code-transport.test.ts
pnpm exec nx run pos-platform-target:architecture-check --skip-nx-cache
```

PostgreSQL 16.14 dedicado en tmpfs, puerto 55433; fixture crea/elimina DB aleatoria
`pos_business_session_test_*`. Runtime sin superuser/bypass RLS. Sin datos comerciales.

## Límite y siguiente implementación

La [propuesta única](android-commercial-approval-proposal-2026-10-22.md) sigue sin
aprobar: contrato Windows previo dispositivo–PKCE, firma por ruta, consumo durable,
canje con posesión, perfil access/refresh y abuso. Tras aprobación del propietario
y revisión de los owners, implementar ese contrato en Identity y el cliente main
existente. No crear otro protocolo ni adoptar tablas de validación en producción.
Faltan despliegue/dominio/RP/registro reales, activación DEV-003 y confianza pública
verificada, custodia/perfil productivo de claves/tiempos y productor central de
snapshot/grants aprobado. Este incremento compone el firmante canónico en entorno
aislado; no sustituye esos requisitos ni declara login humano o producción.

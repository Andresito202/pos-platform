# Panel GLOBAL conectado: evidencia de laboratorio Windows

Continuación de `449358d9d7c4dbcb02d9f3a44aeed0585b182bba`, misma rama
`feat/android-commercial-runtime`, PR #96 Draft. Alcance: conectar el panel
existente con Central GLOBAL HTTPS y recuperar/publicar versiones de precios.
No se reconstruyó el login BUSINESS ni se cambiaron CSS, diseño, permisos,
credenciales productivas, SQL cerrado, hardware o `oracleJdk-27/`.

## Implementación observada

- Vite produce `index.html` POS y `platform.html` desde los mismos componentes
  y estilos. Central sirve `/platform/` y los assets de un build administrado,
  únicamente por HTTPS/Host exacto, con CSP y sin listado, configuración,
  sourcemaps, traversal o preload. Su ruta es optativa en la provisión GLOBAL;
  sin configuración permanece cerrada. Ningún dominio productivo fue supuesto.
- El factor GLOBAL se resuelve en Central después de verificar la contraseña.
  Debe estar activo, verificado y tener material WebAuthn persistido. Esto no
  satisface MFA: siguen siendo obligatorios firma, UV, contador y challenge de
  un uso. El flujo BUSINESS conserva su selector explícito y su propósito.
- La entrada utiliza WebAuthn del origen HTTPS y el transporte GLOBAL existente.
  Cookies HttpOnly/Secure/SameSite=Strict; CSRF sólo en memoria, sin bearer UUID,
  sesión BUSINESS elevada, almacenamiento de contraseña o acceso al preload.
  Recargar exige una nueva ceremonia. Una autenticación válida reemplaza y
  revoca la anterior cookie GLOBAL de ese navegador, dentro de la transacción
  con evento de seguridad. Logout revoca servidor y limpia el estado del cliente.
- El panel permite mensual/anual/perpetuo, una caja incluida, precio de caja
  adicional y soporte, con importes vacíos inicialmente y autoridad del backend.
  Guarda una nueva versión; sólo informa publicación cuando Central la confirma.
  El catálogo administrativo recupera borradores persistidos y precios ACTIVE;
  publicar un precio no cobra, emite, activa ni distribuye una licencia.
- El backend vuelve a exigir GLOBAL, MFA y LICENSE_PLAN_MANAGE en cada operación,
  con bloqueo/revalidación existentes. Permisos, sesión, importes confirmados y
  versiones no se aceptan como autoridad desde React.

## Pruebas ejecutadas aquí

Windows, Electron 44.1.1/Chromium real, PostgreSQL 16 temporal en 55433. Contenedor
`target-migrations-postgres-1`: Running, mounts `[]`, datos en tmpfs. Las fixtures
crean y eliminan una DB aleatoria `pos_subscription_quotes_test_<16hex>`; no se
modificaron bases comerciales. HTTPS usa certificados efímeros con pin exacto
en una partición de prueba; no se instaló una raíz ni se desactivó TLS global.
Identidad y precios son exclusivamente fixtures. Autenticador virtual con firma
P-256 auténtica: **no persona, autenticador físico, FACTUS real ni producción**.

```powershell
pnpm --filter @pos-platform/pos-desktop run typecheck
pnpm --filter @pos-platform/central-authority run typecheck
pnpm --filter @pos-platform/contracts run typecheck
pnpm --filter @pos-platform/pos-desktop run build:renderer
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
$env:POS_E2E_AUDIT_DIRECTORY='C:/Proyectos/pos-platform/artifacts/licensing/2026-10-28/platform'
pnpm --filter @pos-platform/central-authority exec vitest run tests/subscription-quotes-physical.test.ts -t 'FACTUS API:|GLOBAL:' --reporter=json --outputFile=../../artifacts/licensing/2026-10-28/platform-final.json
pnpm --filter @pos-platform/pos-desktop exec vitest run tests/renderer/platform-client.test.ts --reporter=json --outputFile=../../artifacts/licensing/2026-10-28/platform-client-final.json
pnpm --filter @pos-platform/pos-desktop exec vitest run tests/renderer/AdminPanels.test.tsx -t 'AdministrativeControlPanel|superadmin'
pnpm architecture:check
pnpm ci:repository-policy
git diff --check
```

- Integración afectada: **2 PASS, 0 FAIL, 3 filtradas**. El caso FACTUS TLS es la
  dependencia de fixtures de pagos del caso GLOBAL, no una certificación bancaria.
  GLOBAL incluye negativas anteriores afectadas, assets rechazados, login desde
  el formulario real, Argon2 y WebAuthn, guardado, recarga, segundo MFA,
  recuperación del borrador desde SQL, publicación, logout y comprobación de
  las dos sesiones revocadas. Comprueba precios/versión exactos persistidos,
  una caja incluida, almacenamiento navegador vacío y ausencia de preload.
- Cliente nuevo: **3 PASS**. Regresión afectada del panel: **3 PASS, 24 filtradas**.
- TypeScript de los tres proyectos, renderer build, ARCH-003 y política: PASS.
  No se repitieron suites de caja/ventas, 23/25 de MFA/sesiones ni 12 de Argon2id.

Evidencia en `artifacts/licensing/2026-10-28/`: `platform-final.json`,
`platform-client-final.json`, `platform/platform-observations.json` y captura
`platform/platform-published.png`. SHA-256 de la integración final:
`34aca1557ebeab4031df65d068251e074ef6c19455aea71d98d8130998b80aaf`.
Observaciones: `42e08e1bf3e111337a3e8df6a6cece4c79e1f1b68d8f97c4e28c034c99cb4036`.
Captura: `66859ae681ce6644deb199a538f5c14df2e0a08296f4a2b33b9007afbf325830`.

Se conservan los intentos fallidos `platform-attempt-*.json`. Correcciones:
inicializar el target Chromium antes de CDP; conservar el contexto de fetch;
código de fixture conforme al contrato y comparación explícita bigint; retirar
un pattern HTML incompatible. Hubo también un 400 inicial anterior al navegador
sin traza causal suficiente: no se presenta como defecto identificado/resuelto;
es limitación conservada para certificación, pese al resultado final aprobado.
Las repeticiones no se suman como pruebas nuevas ni se ocultan como CI verde.

## Provisión y pendientes exactos

El propietario confirmó el 2026-10-28 que todavía no existen entorno ni políticas
definidos. No hay provisión comercial/GLOBAL/FACTUS configurada en esta consola.
Para hospedar el panel, el operador debe desplegar el build renderer inmutable
desde el mismo origen HTTPS aprobado y proporcionar `renderer.directory`
absoluto y `renderer.maximum_asset_bytes` explícito en la provisión existente.
Los archivos/build deben ser modificables sólo por instalador/operador confiable.
No colocar certificados privados, tokens o archivos de provisión en ese directorio.
El resto del procedimiento de Central/DEV-003 y sus políticas ya documentadas
se conserva; este incremento no inventa operador, dominio, TLS, raíces o cuentas.

| Frente | Estado exacto / siguiente requisito |
|---|---|
| Login humano Windows | Laboratorio previo conservado. Faltan Central HTTPS, responsable, TLS/claves/políticas auténticas, DEV-003, usuario/empresa/dispositivo y persona con autenticador físico. No se certificó aquí. |
| Panel GLOBAL | Conectado y probado hasta persistencia/publicación de planes y precios; despliegue auténtico pendiente. No muestra licencias ni cuentas inventadas. |
| Capacidad firmada | Sigue faltando el productor central de asignaciones, activación DEV-003, emisión/entrega y provisión automática Windows. El verificador V2 existente no los sustituye. Cash es owner de register_id; no se inventó una caja a partir de device_id ni un registro paralelo para simular activación. |
| Cobros | Transporte/verificación backend previo conservado; faltan política fiscal/soporte, cuenta receptora y custodia de credenciales auténticas. No se hicieron cobros reales. |
| Fiscal/correo | Faltan consumidores/montajes de suscripciones y configuración fiscal/numeración, proveedor/remitente/contacto verificados. Son pendientes de código y operación, no sólo credenciales. |
| Caché | Se conserva el cierre y las mediciones del 2026-10-26; no se modificó ni volvió a probar una dependencia intacta. No se inició la misión diferida de pooling. |
| CI | No ejecutado ni consultado; pendiente de restablecimiento por el propietario. PR #96 permanece Draft, sin merge. |

Resultado: avance CALLER_REACHABLE / END_TO_END **de la administración de precios
en laboratorio Windows**. No equivale al cierre total de licencias, a certificación
del login humano ni a autorización productiva.

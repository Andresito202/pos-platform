# Ceremonia HTTPS real desde Electron — 2026-10-22

Base local/remota: `feat/android-commercial-runtime@f470e4fdf58dee5169c4fde12dad3b1316b40d5a`.
PR #96 draft; #92 y #93 conservan sus bases y draft. Carpeta concurrente
`docs/product/oracleJdk-27/` intacta. No se modifican bases comerciales ni hardware.

| Componente | Antes | Después / evidencia |
| --- | --- | --- |
| Central Authority | HTTPS sólo consumido programáticamente | Host real loopback + PostgreSQL temporal + navegador Chromium en Electron |
| Inicio | Cliente nativo sin documento de acceso | GET valida registro exacto, S256/state y sirve formulario con logotipo oficial, CSP nonce y no-store |
| Callback | Listener PKCE existente | Iniciador nativo real abre el documento; listener se cancela sin código porque falta binding aprobado |
| BUSINESS | Coordinador probado por HTTP | Formulario crea otra sesión real; SQL comprueba la nueva fila y su revocación al cerrar |
| MFA | Assertions generadas por helper Node | navigator.credentials.get, UV requerida, firma generada por autenticador virtual CTAP2 de Chromium, contador CAS real avanza |
| SSA | Sin entrega productiva | Sigue sin entregar SSA; no se firma una SSA de arnés para simular login |
| Permisos | Contratos/backend existentes | Sin grants nuevos ni permisos fabricados; renderer del POS conserva NONE |
| Dashboard | Cerrado sin autoridad | Permanece cerrado; no se acredita empleado humano/productivo |

Código de aplicación nuevo: `apps/central-authority/src/commercial-browser-entry.ts`.
Consumidor conectado: `src/isolated-commercial-https.ts`, host existente con guard
ISOLATED_VALIDATION, DB aleatoria `pos_business_session_test_*` y bind exclusivo
127.0.0.1. Main productivo sigue respondiendo COMMERCIAL_AUTH_NOT_ACTIVATED.
No se rehacen password, MFA, sesiones, canje de códigos, enrolamiento o bridge.

La configuración confiable del laboratorio selecciona factor/membresía/tenant
del fixture: son selectores, nunca prueba de identidad. Las transacciones
canónicas revalidan pertenencia/estado tras contraseña y MFA. No es un selector
multiempresa productivo. La contraseña sólo vive durante ese intento HTTPS;
se limpia el campo, no se escribe en storage ni se envía al renderer del POS.
BUSINESS_VERIFIED sólo aparece tras completar el MFA y consultar la sesión
central con cookie HttpOnly y CSRF. Logout usa la revocación real existente.

## Ejecución reproducible y resultado

Prerequisitos: Windows, dependencias instaladas y fixture PostgreSQL dedicado
localhost:55433 con sus roles existentes. No ejecutar sobre DB comercial.

```powershell
pnpm --filter @pos-platform/pos-desktop build
pnpm --filter @pos-platform/pos-desktop exec esbuild src/native-business-login.ts --bundle --platform=node --format=esm --outfile=dist/native-browser-login-probe.mjs
pnpm --filter @pos-platform/central-authority typecheck
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/pos_target_test'
$env:POS_E2E_AUDIT_DIRECTORY='C:\Proyectos\pos-platform\artifacts\electron-auth\browser-ceremony-2026-10-22'
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-access-preparation-physical.test.ts -t 'HTTPS commercial|HTTPS browser entry|Electron browser ceremony' --reporter=json --outputFile='C:\Proyectos\pos-platform\artifacts\electron-auth\browser-ceremony-2026-10-22\tests.json'
pnpm architecture:check
```

**12 aprobadas / 0 fallidas / 85 omitidas**: dos nuevas (una E2E con Electron,
otra integración HTTPS negativa) y diez regresiones de las rutas modificadas.
No son 12 E2E ni autenticaciones humanas. Build completo desktop, TypeScript
Central y arquitectura 16/16 + ARCH-003 aprobados. No se repitieron 75 renderer,
23 MFA, 12 Argon ni suites comerciales. Test nuevo se omite fuera de Windows.

La E2E usa la entrada productiva Electron/preload/canal DPAPI y el servicio local
real en SQLite temporal vacío. En otra ventana HTTPS sin preload/Node ejecuta
la ceremonia mediante navegador instrumentado, no shell externo del usuario.
El certificado temporal exacto se confía sólo en esa partición del arnés, sin
instalar roots OS ni desactivar validación TLS global. Contraseña aleatoria e
identidad persistidas en DB temporal; autenticador virtual explícito. No equivale
a una persona, llave física, dispositivo enrolado o Central externa desplegada.
El pipe aleatorio del driver sólo entrega fixtures al main de prueba, nunca es
canal productivo o API del POS. No contiene grants ni transporta SSA.

Capturas y JSON locales: `artifacts/electron-auth/browser-ceremony-2026-10-22/`.
`browser-observations.json` registra fases reales, cookie protegida, borrado de
campos/storage, logout y POS cerrado. `tests.json` conserva resultados completos.
Captura inspeccionada: `browser-business-verified.png`, SHA-256
`d0b4d310e829dd400a16fa0047e6e2f9617183ce2cdfd9c4c838dac0e249947d`.
Observaciones SHA-256: `ea970c762311afdc60834a3f5d3d0e6b6bf4c878c930a4ca177f4ca13913ff23`.
Fallos iniciales: stdin vacío en Electron Windows (driver usa pipe efímero),
comparación equivocada del fingerprint de certificado (corregida con X509 del
certificado real). Ninguna aserción se retiró para aprobar.

No se encontró despliegue central: sin variables CENTRAL/D3/BUSINESS en este
proceso; API GitHub deployments vacía; Docker sólo presenta el PostgreSQL de
pruebas. `infra/central-sync` es otro servicio, no autoridad de login.
Para activar Windows sigue la [única propuesta conjunta](android-commercial-approval-proposal-2026-10-22.md),
separada ahora de Android: registro y confianza reales, binding previo firmado,
acceso/refresh/vigencias/abuso aprobados y composición de grants/SSA pendiente.
No hay sesión operativa POS ni prueba humana/productiva por este incremento.

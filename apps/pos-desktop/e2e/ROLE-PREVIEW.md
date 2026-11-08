# Camacho POS — Vista por perfil (solo laboratorio local)

Esta herramienta abre **el Electron real**, con preload, IPC, Local Service,
autorización por permiso y SQLite reales; el servicio de pruebas crea una SSA y
un snapshot SAS efímeros en una carpeta temporal independiente. No usa Central
ni un usuario comercial, no proporciona MFA/WebAuthn y no otorga acceso a datos
reales. **No se debe distribuir como login comercial ni usar para cobrar**.

## Cuentas locales de desarrollo con contraseña (sin licencia comercial)

La validación de credenciales está disponible exclusivamente para la vista de
laboratorio, **no** como un login comercial con persistencia de operaciones.
No hay ninguna contraseña fija en Git. La primera ejecución genera claves
aleatorias y guarda solamente sus hashes `scrypt` bajo
`%LOCALAPPDATA%\\CamachoPOS\\development\\accounts.v1.json`.

Una vez compilado el escritorio, crea tus cuentas y conserva las contraseñas
que aparecen **una sola vez**:

```powershell
node tools/operators/local-development-accounts.mjs init
```

Usuarios generados: `admin.local`, `supervisor.local`, `cajero.local`,
`superadmin.local`. Para abrir la vista de Cajero con su contraseña:

```powershell
pwsh -File tools/operators/open-local-role-preview.ps1 -Username cajero.local
```

Cambia `-Username` por cualquiera de las otras cuentas. El lanzador pregunta
la contraseña sin mostrarla y la verifica por stdin, luego abre el perfil
del laboratorio en Electron. No expone una credencial en argumentos de
proceso ni en variables de entorno. El entorno de pruebas sigue siendo
manipulable por quien controle el repositorio local, por lo que **estas cuentas
no son una frontera de seguridad de producción**.

> **Falta para trabajar con cambios persistentes:** integrar un login
> local de desarrollo con sesiones y base SQLite persistentes, separación de
> usuarios, ciclos de apertura/cierre, backups y un origen de firmas local
> custodiado. El test interactivo actual elimina la base al cerrar; **no
> debes usarlo para registrar trabajo que quieras conservar**.

## Revisión comercial de diseño (un solo comando)

Runtime **aislado** (`%LOCALAPPDATA%\CamachoPOS\design-review-runtime`): IDs
persistentes compartidos entre servicio y Electron, provisión firmada de
capacidad de licencia (mismo mecanismo V2 de las pruebas), caja demo y catálogo
sembrado vía `RegisterProductUseCase`. No toca datos de
`local-operator-runtime` ni de una instalación comercial.

```powershell
pwsh -File tools/operators/open-commercial-design-review.ps1
```

Tras el login local (`cajero.local` o `admin.local`), el lanzador imprime
`DESIGN_REVIEW_REGISTER_ID`. Úsalo en Caja y ventas para recorrer carrito →
cobro → denominaciones con operaciones y permisos reales. No certifica login
BUSINESS ni Central.

La provisión firmada se genera **en runtime** bajo el directorio aislado
(`trust/license-signing.private.pem`, `trust/license-capacity-provision.json`).
Esas claves y el artefacto **no viven en Git**. El `key_id` de laboratorio es
`DESIGN_REVIEW_LICENSE`. El `LicenseCapacityGate` sigue fail-closed: sin
`POS_LICENSE_CAPACITY_PROVISION_FILE` responde `LICENSE_CAPACITY_NOT_PROVISIONED`.
Esta superficie es revisión de diseño, **no** licencia ni certificación de
producción.

### Evidencia de pruebas (agente Linux, no certificación Windows)

- Unitarias `@pos-platform/pos-desktop`: **249 PASS / 0 FAIL**.
- Typecheck y build de escritorio: PASS observados.
- E2E Playwright en Linux (**no** ocultar): **6 PASS**, **5 SKIP**, **5 FAIL**:
  - FAIL `e2e/native-custody.spec.ts` — custody OS quedó en `MODULE_IMPORT`
    (`cleared/restored` falsos) en Linux.
  - FAIL `e2e/real-channel.spec.ts` (4 casos) — `local channel client is not
    connected` / timeouts al activar sesión o localizar Caja/Catálogo.
  - SKIP `local-operator-live`, `role-isolation`, `unauthenticated-startup`
    (requieren Windows / rol E2E explícito).
- El arranque Electron de revisión comercial **debe verificarse en Windows**
  con el comando de un solo paso. Un PASS de unitarias Linux no certifica el
  runtime comercial Windows.

## Windows PowerShell (desde la raíz del repositorio)

Instala dependencias y compila el escritorio una sola vez:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @pos-platform/pos-desktop build
```

Para abrir la interfaz del cajero:

```powershell
$env:POS_E2E_ROLE = "CAJERO"
$env:POS_E2E_INTERACTIVE = "1"
pnpm --filter @pos-platform/pos-desktop exec playwright test --config e2e/playwright.config.ts e2e/role-isolation.spec.ts --workers=1 --retries=0
Remove-Item Env:POS_E2E_ROLE,Env:POS_E2E_INTERACTIVE -ErrorAction SilentlyContinue
```

Cambia `CAJERO` por `SUPERVISOR`, `ADMINISTRADOR` o
`SUPERADMINISTRADOR` y vuelve a ejecutar para cambiar de perfil.
Cierra la ventana Electron para destruir el SQLite temporal; el proceso no
cambia las sesiones Windows instaladas. El banner indica explícitamente
`LABORATORIO LOCAL`, perfil y que los datos son temporales.

**Restricciones de perfiles de prueba:**

- Cajero: caja/ventas/cobros, catálogo de lectura y clientes de lectura; no
  puede consultar inventario de stock ni administrar hardware.
- Supervisor: caja y ventas, confirmación de transferencias, inventario de
  lectura y auditoría, sin administración de hardware.
- Administrador: permisos **locales implementados** de operación y hardware;
  no recibe permiso global de planes/licencias.
- Superadministrador: solo capacidad global `LICENSE_PLAN_MANAGE`; **no**
  dispone de pantallas locales como caja/ventas. La administración de planes
  pertenece a Central y todavía no se presenta como funcionalidad POS local.
  No se inventa una pantalla administrativa nueva.

Estas son matrices de **prueba**, no el catálogo comercial de roles
aprobado por Central; SUPERVISOR sigue sin habilitación comercial. La
autorización real exige una SSA y SAS firmadas por la autoridad de Central
para un usuario/dispositivo/empresa/sucursal legítimos.

La prueba automatizada de Windows repite los cuatro perfiles y comprueba que
el backend niega llamadas sin permiso aunque el cliente intente enviarlas.
Una prueba pasada no certifica login humano BUSINESS ni MFA. El
bloqueo `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` se conserva.

Cuando el VPS y el dominio estén disponibles, conectar Central y ejecutar
la ceremonia humana de MFA, las comprobaciones de identidad comercial
SCM ↔ Electron y revocación completa antes de habilitar producción.

# Camacho POS — Vista por perfil (solo laboratorio local)

Esta herramienta abre **el Electron real**, con preload, IPC, Local Service,
autorización por permiso y SQLite reales; el servicio de pruebas crea una SSA y
un snapshot SAS efímeros en una carpeta temporal independiente. No usa Central
ni un usuario comercial, no proporciona MFA/WebAuthn y no otorga acceso a datos
reales. **No se debe distribuir como login comercial ni usar para cobrar**.

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

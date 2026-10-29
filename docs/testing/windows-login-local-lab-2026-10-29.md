# P0 Windows — laboratorio local sin VPS ni dominio contratado

Línea autorizada por el propietario: `feat/p0-windows-login-install-readiness`, PR #99 / issue #98. Base de comparación local `ba16a46638953306d97b9392c04d4ecd23ca914b`; remoto incorporado por fast-forward `468e9d06792784cfdc7a68da771fb98e97f04761` (dos commits: preflight y documentación, sin cambios de autenticación).

El propietario informa 341/341 pruebas automatizadas en `ba16a466`, TypeScript y Electron compilados. No se repite esa batería ni se presenta esa cifra como una ejecución observada en esta sesión. La descripción de PR #99 todavía dice que el delta no se probó; debe conservarse la distinción entre esa descripción histórica y el informe posterior del operador.

## Implementación acotada

Se continúa el runner existente `tools/operators/windows-login-final-checks.ps1`, sin segundo sistema de login. `-IsolatedLabOnly` selecciona únicamente:

1. Comprobación real de WindowsIdentity/PowerShell del contexto actual, sin runner inyectado, sin registrar nombre/SID. No equivale a otra cuenta Windows ni a SCM.
2. Los tres escenarios `deployment` existentes: runner canónico en DB aleatoria, montaje HTTPS, contraseña/WebAuthn, código ligado a dispositivo, refresh/SSA/SAS, negativas, rollback, schema drift y presupuesto durable.
3. Los siete escenarios existentes `V2 SSA SAS integration:`: pruebas distintas SSA/SAS, revocación de familia/credencial/sesión, concurrencia, RBAC denegado y rollback; además Electron/Chromium real, pipe del Service, DPAPI CurrentUser, PKCE, posesión, BUSINESS, grants centrales y dashboard. Es un host de integración, no la instalación comercial WinSW ni una persona.

El runner exige Windows, rama aprobada, árbol limpio/SHA exacto, `-Run`, `-IncludeIsolatedPostgres` y URL de test loopback `55433/postgres`. Antes de conectar comprueba el contenedor ya existente `target-migrations-postgres-1`: ejecutándose, datos tmpfs, ningún mount persistente y un único binding 127.0.0.1:55433. No instala contenedores ni cambia WinNAT, servicios, ACL, DNS, certificados del sistema o datos comerciales. Cada suite crea/elimina su DB aleatoria. Se reutilizan los certificados efímeros y el pin de confianza por transporte/partición de test; TLS/RLS permanecen activos.

Cada ejecución guarda JSON en un directorio nuevo bajo `artifacts/windows-p0/2026-10-29/local-lab-<aleatorio>` y exige exactamente los PASS esperados (1 + 3 + 7). Un archivo filtrado/saltado no permite anunciar un PASS de laboratorio. Los outputs son evidencia técnica, no credenciales de operación ni un instalador de Central. Tras verificar aislamiento, el runner usa `applyPostgres001` canónico sobre una base aleatoria que elimina, para preparar los roles de infraestructura del cluster tmpfs recién reiniciado; no genera personas, grants de negocio ni roles alternativos.

## Comando reproducible

Con Docker y las dependencias existentes, PostgreSQL temporal del laboratorio ya disponible y el build Electron aprobado presente:

```powershell
Set-Location C:\Proyectos\pos-platform
$previousLabUrl=[Environment]::GetEnvironmentVariable('POSTGRES_TEST_URL','Process')
try {
    # Sólo este contenedor tmpfs de test, autenticación local del fixture existente.
    $env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
    powershell.exe -NoProfile -File tools/operators/windows-login-final-checks.ps1 -Run -IncludeIsolatedPostgres -IsolatedLabOnly
    if($LASTEXITCODE -ne 0){throw 'LOCAL_LOGIN_LAB_FAILED'}
} finally {
    if($null -eq $previousLabUrl){Remove-Item Env:POSTGRES_TEST_URL -ErrorAction SilentlyContinue}
    else {$env:POSTGRES_TEST_URL=$previousLabUrl}
}
```

No ejecutar sobre una URL de negocio. No usar el laboratorio para registrar un usuario productivo, trasladar claves, introducir un factor virtual en operación o abrir permanentemente el dashboard. Los escenarios usan identidades y MFA **de test**, del arnés existente, eliminados al terminar; no sustituyen al empleado ni a su autenticador.

## Comparación con el estado real del PC

Windows accesible; PostgreSQL temporal saludable en 55433, datos tmpfs. En esta consola faltan provisiones BUSINESS/GLOBAL, Service/Desktop, DEV-003, raíces SSA/SAS y parámetros operativos. Central y Service se detienen antes de abrir una DB de operación; Desktop carece de provisión del canal. Un frontend estático puede servir HTTP 200 y eso no demuestra una sesión.

`windows-login-deployment-preflight.ps1 -Interactive` separa correctamente el camino de la primera ceremonia del WinSW no implementado. Las dos correcciones posteriores a `ba16a466` no aprueban ni construyen un puente SCM. No se instalará WinSW para fingir que se resolvió DPAPI entre cuentas.

## Dependencias de la primera ceremonia humana

- Central puede ejecutarse en un equipo local autorizado; **no se exige contratar VPS** para demostrar técnicamente el flujo. Para una ceremonia humana legítima necesita un origen HTTPS registrado permitido, certificado/cadena confiables en los clientes correspondientes, roles/ledger y provisión auténticos. No cambiar el contrato para aceptar localhost, IP o un dominio de test como origen comercial; tampoco instalar una CA o modificar hosts sin autorización operativa explícita.
- Operador aprovisiona empresa, sucursal, persona con contraseña/factor físico y membresía/roles aprobados, dispositivo DEV-003, claves/raíces y políticas explícitas. No insertar manualmente grants o reutilizar claves del test. GLOBAL mantiene ceremonia y permisos propios.
- Service y Electron bajo **la misma cuenta/sesión interactiva** usan DPAPI CurrentUser y el SID de logon ya aprobados. Ejecutar primero `tools/local/launch-windows.ps1 -CheckOnly -RequireCommercialLogin`; después, sólo con provisión válida, el mismo comando sin `-CheckOnly`.
- Certificar con persona: contraseña incorrecta/correcta, UV físico, BUSINESS/callback, SSA/SAS, permisos reales/tenant ajeno, refresh, reinicio, logout y revocación; GLOBAL separado. La ausencia de permisos mantiene cerrado el dashboard.

## WinSW entre identidades: no resuelto por el laboratorio

El Service virtual y Electron interactivo no comparten CurrentUser ni SID de logon. No copiar archivos DPAPI, migrar a LocalMachine ni ampliar DACL a Everyone/Authenticated Users. Para implementar un handoff se requiere una decisión específica que fije: SID exacto de Service y usuarios Windows autorizados; autenticación kernel de ambos extremos/instancia SCM y sesión; operaciones cerradas/correlación/challenge/anti-replay; custodia exclusiva del Service; revocación al terminar sesión/cambiar usuario; recuperación y pruebas con dos cuentas reales. Ese cambio afecta el contrato canónico del canal y debe aprobarse antes de habilitarlo. La vía interactiva no lo declara implementado.

## Evidencia de esta continuación

- Prueba nueva `real Windows token:`: **1 PASS / 5 filtradas** en Windows real, sin inyección del runner. No autentica BUSINESS ni GLOBAL.
- Sintaxis PowerShell del runner: **PASS**. Resultados del laboratorio integrado se registran después de ejecutarlo sobre un SHA limpio.
- Primer intento: contenedor apagado, rechazo previo a DB; se inspeccionó tmpfs/binding y se inició el contenedor existente. Se normalizó la lectura del array JSON de Docker para PowerShell.
- Ejecución `493c0f3b`: las pruebas dieron **1 + 3 + 7 PASS, cero FAIL**, pero el wrapper falló correctamente su validación de conteo porque esperaba un solo escenario V2 y el selector también incluye seis negativas relevantes. Se corrigió el contrato del runner a siete, sin modificar pruebas ni producto. Evidencia conservada en `local-lab-77639d193b324f3da5693f130c6c779d`; no presentarla como exit 0 del wrapper.
- No contratación, despliegue público, Actions, merge, hardware, licencias ni pagos.

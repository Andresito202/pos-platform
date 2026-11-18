# Windows SCM: correcciones del laboratorio, 2026-11-02

PR #99 Draft / issue #98 abierta, misma rama `feat/p0-windows-login-install-readiness`.
Checkout inicial `05d43e10`; remoto actualizado `5e655e2cf864ae5f810be3ef5de63513af8a34a8` incorporado mediante fast-forward, árbol limpio. Código probado: `7372a408e48b9a343aae020526626daa91483650`.

## Resultado observado y límite

**15 PASS / 0 FAIL / 0 SKIP**, Node 22.19.0 y PowerShell 5.1 reales, usando exclusivamente fixtures temporales. No se iniciaron servicios ni modificaron ACL operativas, claves, certificados, bases o datos comerciales. No es ejecución SCM, prueba humana ni producción.

Esta consola está en el host Windows 10, no en Windows Server. `Get-VM -Name CamachoPOS-SCM-Lab` devolvió acceso denegado; no hay PSSession disponible ni acceso a las rutas de la VM desde esta consola. Windows 10 se utilizó solamente para lectura, edición y pruebas de compatibilidad aisladas indispensables; no para instalar o probar el servicio comercial. La existencia de infraestructura declarada en la VM no acredita acceso ni resultados observados por este agente.

## Hallazgos corregidos

| Componente | Antes | Corrección y ubicación | Evidencia | Pendiente |
|---|---|---|---|---|
| Resolución pnpm | `node -e` pierde comillas en PS 5.1; reproducción real: `require(node:fs)` y exit 1 | Código por stdin y resultado UTF-8/base64 en `windows-scm-lab-dependency-acl.ps1:28` | Ruta real con espacios y Unicode PASS | Acceso efectivo desde el token SCM en la VM |
| Inspección ACL | Una ACE Modify satisfacía la condición RX; InheritOnly podía contarse como acceso directo | `InspectRead`, mismo archivo:38, rechaza escritura preexistente y denies aplicables; comprueba acceso directo | RX, idempotencia, dry-run, Modify, deny e InheritOnly PASS | Otras pertenencias del token y ACL de dependencias cargadas deben comprobarse ejecutando el servicio |
| Aplicación parcial | Sin registro previo ni recuperación si Set-Acl falla después de aplicar | Plan completo validado antes de escribir; journal bajo `results/dependency-acl-<id>.json`; recuperación en orden inverso en `GrantRead:61` / `UndoReadChanges:90` | Rollback real, excepción posterior a escritura y cambio concurrente preservado PASS | No es transacción NTFS ni garantía atómica del árbol heredado; cualquier discrepancia exige revisar el journal |
| Binding del servicio | Provisionador no comparaba ImagePath; otro gate aceptaba una subcadena | `windows-scm-lab-binding.ps1:2`, reutilizado por reparación, provisión, gate, cinco fases y one-shot | 9 vectores de ruta dentro de 1 prueba y sintaxis de 6 scripts dentro de otra: 2 PASS | Comprobar el servicio realmente instalado y sus procesos |
| Manifiestos | Si fallaba SERVICE se borraba DESKTOP | `writeManifestPair` en `windows-scm-manifest-pair.mjs:37`: creación exclusiva y conservación de salida parcial con error explícito | 3 PASS; no sobrescribe salida concurrente ni elimina evidencia | Validación canónica/ACL y carga real de ambos manifiestos en la VM |

El reparador sigue limitado a `.pnpm`, los ancestros físicos del entrypoint Vitest y ese archivo. No usa `icacls /T`, no recorre junctions, no cambia owners ni quita denies, no añade Modify/FullControl al token SCM y no toca custodia privada DPAPI. La herencia de ACL puede propagarse a descendientes: el journal y la verificación de rollback describen **rutas directas**, no una restauración atómica de todo el árbol. No declarar resuelto el EPERM efectivo hasta observar el arranque SCM con estos cambios.

El generador conserva sus validaciones previas de claves, fingerprints y binding; los loaders/contratos y el test físico existentes siguen siendo la autoridad de aceptación. Una publicación parcial permanece bloqueada para revisión, sin limpieza automática ni regeneración de claves.

## Pruebas y evidencia

```text
node --test tools/operators/windows-scm-lab-dependency-acl.test.mjs tools/operators/windows-scm-lab-binding.test.mjs tools/operators/windows-scm-manifest-pair.test.mjs
```

Recibo publicable: [evidence/windows-scm-operator-fixes-2026-11-02.json](evidence/windows-scm-operator-fixes-2026-11-02.json), con SHA de código, hashes de los 10 archivos y conteos. TAP local: `artifacts/windows-p0/2026-11-02/scm-operators-faac1195-e514-4860-abed-eb8da7f29013/operators.tap`, SHA-256 `0f68e0c5ef18f2600a88f15e458898b9a5f9bd43ecefe4138a343cbf8a7ebc65`.

- Final: 10 pruebas ACL + 2 binding/parser + 3 publicación = **15**, sin sumar repeticiones.
- Fallo inicial conservado en el relato: 8 PASS / 1 FAIL por decodificación OEM de la ruta Unicode. Se corrigió el transporte del nombre a base64; la ejecución final anterior pasa.
- `node tools/architecture/validate-boundaries.mjs`: ARCH-003 PASS.
- `pnpm ci:repository-policy`: PASS, 1346 archivos rastreados en el SHA de código.
- `git diff --check` y sintaxis Node del escritor: PASS.
- TypeScript/build: **NO EJECUTADOS**, no cambiaron TypeScript, paquetes, addon, renderer ni entrypoints de producto. La compilación aplicable a los scripts está cubierta por el parser PS 5.1 y la ejecución Node real.
- SCM/DPAPI entre cuentas, Node/Electron físico y Central/PostgreSQL de la VM: **NO EJECUTADOS**, acceso no disponible. No atribuir aquí nuevos PASS de las baterías históricas.
- Regresiones offline/sync/licencias/pagos/Android: **NO EJECUTADAS**; no hay cambios en sus contratos/runtime y Windows 10 queda reservado para la etapa física final. No se contactaron proveedores ni servicios reales.

## Revisión de seguridad complementaria: alcance exacto

Referencia de requisitos: [OWASP ASVS 5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0). Es revisión de código acotada, **no verificación completa ni certificación ASVS**. No se dispone del video/lista original de 27 recomendaciones; los puntos 20 y 21 permanecen **NO VERIFICADOS**.

| Control | Fuente inspeccionada | Conclusión limitada |
|---|---|---|
| HTTPS, RP, PKCE/MFA y composición comercial | `apps/central-authority/src/central-commercial-runtime.ts:39–88` | Validaciones y composición existentes conservadas; provisión auténtica de la VM no comprobada |
| BUSINESS y autorización multiempresa | `packages/database-postgres/src/business-session-creation-transaction.ts:69–123` | Transacción, contexto tenant y membership activos; no se repitió la prueba RLS histórica |
| Cookies y CSRF BUSINESS | `packages/database-postgres/src/durable-browser-session-store.ts:92,153` | Cookie Secure/HttpOnly/SameSite=Strict y controles de solicitud existentes; sin nueva ceremonia |
| GLOBAL separado | `apps/central-authority/src/global-administration-http.ts:24,41–76` | TLS/origen y ceremonia propia; no se concede autoridad GLOBAL desde BUSINESS |
| Webhook vs pago | `apps/central-authority/src/factus-pay-webhook-handler.ts:20,78`; `factus-pay-quote-verifier.ts:32,45` | Inbox no confirma pago; verificación API separada conservada, sin prueba de proveedor |
| Rate limiting | `apps/central-authority/src/fixed-window-rate-limiter.ts` | Alcance explícito de un proceso, capacidad acotada y reloj regresivo denegado; no prueba de despliegue multiproceso |
| Electron | `apps/pos-desktop/src/window-security.ts:3–8` | Sandbox, aislamiento, sin Node en renderer y webSecurity conservados |
| Secretos/SCM/supply chain | Scripts corregidos y pins existentes del addon/WinSW | No se cambiaron firmas, hashes autorizados, binarios ni raíces; carga auténtica pendiente en VM |
| Android, recuperación de contraseña y auditoría integral | Fuera de los archivos corregidos | Sin nueva verificación suficiente; no elevar su estado por esta revisión |

## Única invocación delegada: Windows Server 2022, PowerShell elevado

Ejecutar **dentro de la VM existente**, nunca en el host Windows 10. No contrata, reinstala ni genera certificados. Actualiza sólo por fast-forward sobre la rama correcta y exige árbol limpio. El orquestador existente comprueba VM, cuenta virtual Manual/Stopped, ImagePath exacto, pins del wrapper y estado parcial antes de efectuar operaciones; conserva la recuperación de runner/XML/servicio en finally. Si hay custodia o recibos parciales anteriores, se detiene para revisión y no elimina nada.

```powershell
Clear-Host
$ErrorActionPreference = 'Stop'
Set-Location 'C:\CamachoLab\pos-platform'
$scmGit = 'C:\Program Files\Git\cmd\git.exe'
if ((& $scmGit branch --show-current).Trim() -ne 'feat/p0-windows-login-install-readiness') { throw 'WRONG_BRANCH' }
if (@(& $scmGit status --porcelain).Count -ne 0) { throw 'WORKTREE_NOT_CLEAN' }
& $scmGit fetch origin feat/p0-windows-login-install-readiness
if ($LASTEXITCODE -ne 0) { throw 'FETCH_FAILED' }
& $scmGit merge --ff-only origin/feat/p0-windows-login-install-readiness
if ($LASTEXITCODE -ne 0) { throw 'FAST_FORWARD_REQUIRED_NO_CHANGES_DISCARDED' }
powershell.exe -NoProfile -File .\tools\operators\windows-scm-lab-provision.ps1 -LabRoot 'C:\CamachoPosScmLab\608ba7092afe4a5b93ac14a7df23a046' -Apply -RunPhysical
if ($LASTEXITCODE -ne 0) { throw 'SCM_LAB_BLOCKED_PRESERVE_RESULTS_AND_JOURNAL' }
```

Ese comando aún no ha sido ejecutado por este agente en la VM. Un exit 0 de provisión tampoco certifica BUSINESS: revisar los resultados físicos Node/Electron y los estados explícitos `E_CENTRAL_LOGIN`/`HUMAN_MFA`. No pedir ni divulgar claves, tokens o contenido de custodia; compartir únicamente códigos, SHA y conteos sin secretos.

## Estado de cierre

Se cerraron los defectos de código y pruebas indicados. No se retiró `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`. SCM real, permisos efectivos de dependencias, recuperación de DPAPI entre reinicios y Node/Electron entre identidades siguen pendientes de la ejecución en la VM. La composición Windows–Central/BUSINESS se conserva, pero no se ha observado su configuración operativa allí. La ceremonia humana exige después Central HTTPS confiable, DEV-003 y raíces/provisiones auténticas, usuario/membership/roles autorizados y autenticador físico; GLOBAL debe probarse separadamente. No se inventaron ni aprovisionaron esos datos desde el host.

No Actions, merge, cambios en `oracleJdk-27/`, módulos comerciales, Android ni hardware. PR #99 permanece Draft e issue #98 abierta.

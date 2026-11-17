# Certificación Windows remota (lab runner) — Camacho POS Colombia

**Repositorio:** Andresito202/pos-platform  
**Rama:** `cursor/commercial-design-review-0d11`  
**PR:** #106 (Draft)  
**Alcance:** GitHub Actions `windows-2022` + Central Sync lab.  
**No es certificación física de PC del propietario.**

## Qué se ejecuta

1. **NSIS unsigned lab** (workflow `windows-nsis-installer-lab.yml`)
   - Generación del instalador electron-builder/NSIS.
   - SHA-256 en `installer-integrity.txt`.
   - Ciclo silencioso `/S`: install → ACL → launch smoke → upgrade → marker de datos → uninstall (`tools/operators/windows-nsis-lab-lifecycle.ps1`).
   - `deleteAppDataOnUninstall=false` → retención AppData esperada (datos comerciales).

2. **Pruebas comerciales reales (no role-preview)**
   - `e2e/local-operator-live.spec.ts` en Windows: Electron + Local Service + DPAPI + named pipe + passwords.
   - Capturas bajo `POS_E2E_AUDIT_DIRECTORY` → artifact `commercial-captures/`.
   - Roles: Administrador, Supervisor, Superadministrador, Cajero.
   - Sectores/licencias: PASS si navegables; SKIP si no hay entitlement en el runner.

3. **PostgreSQL proyección comercial Central**
   - Migration `028_sync_domain_projections` → `sync.domain_projections`.
   - `applyCentralDomainOperation` escribe proyección tipada (idempotente `ON CONFLICT DO NOTHING`).
   - Lab sync aplica 028 tras 004; cadena comercial completa la aplica tras 027 (`MERCHANT_NOTIFICATIONS`).
   - No se inventó un segundo motor de sync.

## Seguridad preservada

| Control | Estado lab |
|---|---|
| SCM / WinSW comercial | SKIP — no empaquetado en NSIS desktop |
| DPAPI | ejercido en live Windows |
| IPC autenticado | ejercido (named pipe) |
| TLS DEC-024 | política lab/prod existente |
| Licencias firmadas | SKIP sin material de firma en runner |
| Roles | RBAC real vía Local Service |
| Integridad artefactos | SHA-256 del instalador |
| Replay device proof | gate Central existente |
| Authenticode | BLOCKED (RT-009-B; sin certs ficticios) |

## Limitaciones reales del runner

- VM GitHub Actions ≠ PC físico del comercio.
- Instalador **unsigned** (lab).
- WinSW/SCM no viaja en el NSIS de desktop.
- Comunicación Electron instalado ↔ servicio WinSW comercial: **NOT_PROVEN**; evidencia IPC usa Electron+servicio del árbol en el mismo runner.
- Sectores/licencias firmadas pueden SKIP.
- No FACTUS, no hardware, no VPS/dominio, no merge a `main`.

## Corrección run #4 (`c4862bca` / job 134348051671)

Fallo: `launch_installed_exe` sin Local Service/DPAPI → proceso salía; informe no se copiaba si exit≠0; STEP logs tragados por pipeline.

Corrección vigente:
- Informe JSON siempre (finally) + copy en workflow aunque falle.
- STEP vía `Write-Host`; `failedSteps` explícitos (install/upgrade/uninstall).
- Rutas reales (registry uninstall + LOCALAPPDATA).
- SQLite real (`windows-nsis-lab-sqlite-marker.mjs`) preservado en upgrade.
- Launch **sin** `--no-sandbox`; Local Service + DPAPI provisionados antes.
- WinSW/SCM: SKIP justificado (no va en NSIS desktop), no FAIL→SKIP de launch.
- Licencias sectoriales firmadas: `provision-lab-sector-license.ts` + `POS_LICENSE_CAPACITY_PROVISION_FILE`.

## Veredicto

Se declara tras CI exact-head del tip que incluye este informe:

- `CERTIFICACION_WINDOWS_LAB_CERRADA` — lifecycle NSIS + live real-auth + proyección 028 + CI verde, sin overclaim físico.
- `CERTIFICACION_WINDOWS_LAB_BLOQUEADA` — si CI o lifecycle fallan, o si falta evidencia requerida del lab.

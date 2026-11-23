# Procedimiento de certificación física Windows SCM — PR #127

Estado: **procedimiento ejecutable de preparación**. No habilita SCM comercial.
No sustituye autorización del propietario para merge a `main`.
Gate vigente: `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`.
Authenticode Camacho: `RT-009-B_BLOCKED` hasta custodia real.

Rama exclusiva: `codex/scm-real-integration-20261122`. Draft PR #127. Base: `main`.

## 0. Separación obligatoria

| Superficie | Qué hace | Qué no hace |
|---|---|---|
| NSIS `customInstall` | Aborta distribución comercial | No instala servicio |
| Helper `-Action Install` | Falla cerrado en el gate comercial | No prepara certificación |
| Helper `-Action PreparePhysicalCertification` | Instala WinSW + ACL + materializa par SCM con atestación del propietario | No limpia el gate; un arranque comercial RUNNING es fallo |
| `assertWindowsScmCommercialCertification()` | Bloquea entry comercial con handoff SCM | No se bypassa por env |
| Preflight / physical vitest | Validan metadatos y transporte nativo | No conceden autoridad comercial |

## 1. Requisitos de instalación comercial (previos)

1. Windows 10/11 x64 o Server compatible, sesión elevada del propietario.
2. Payload comercial ya construido en el PC objetivo (sin `.lab-state`, `lab-data`, Role Preview ni credenciales de prueba):
   - `resources/service-payload/CamachoPOSLocalService.exe` (WinSW 2.12.0)
   - `CamachoPOSLocalService.xml.template`
   - `runtime/node.exe`
   - `local-service/pos-local-service.mjs` + native deps
   - `install-camacho-local-service.ps1`
3. Node 22 en PATH del operador (para preflight/atestación).
4. Migración Central `034_scm_checkpoints` **solo** tras autorización explícita del propietario sobre la infraestructura objetivo (no ejecutar desde este procedimiento sin esa orden).
5. Custodia independiente de:
   - firmante Central Ed25519 (archivo privado fuera del POS; KMS/HSM si existe, sin afirmarlo aquí)
   - raíz pública Ed25519 distinta del signer de cápsula SERVICE
   - provisiones SERVICE/DESKTOP + Central ya emitidas por el operador
   - candidato y política firmada `RECOVER_CANDIDATE`

## 2. Archivos y credenciales que aporta el propietario

Rutas managed bajo `C:\ProgramData\CamachoPOS\...` (nunca lab/preprod):

| Artefacto | Rol |
|---|---|
| `service-provision.json` | Handoff SERVICE + rutas de cápsula/adaptador |
| `desktop-provision.json` | Handoff DESKTOP + receptor DPAPI |
| `central-provision.json` | `origin` HTTPS, root PEM/pin, `candidate_file`, política firmada |
| Custodia privada SERVICE/DESKTOP | Fuera de lectura del preflight |
| Atestación `physical-attestation.json` | Ver esquema abajo |
| Identidades UUID reales | installation/device/tenant/company/branch (no `018f0000-…0000a[1-5]`) |
| Data directory comercial | Absoluto local, sin segmentos lab |

Esquema exacto de atestación (validador: `tools/operators/scm-physical-certification-attestation.mjs`):

```json
{
  "profile": "CAMACHO_SCM_PHYSICAL_CERTIFICATION_ATTESTATION_V1",
  "purpose": "PHYSICAL_CERTIFICATION_PREP",
  "commercial_ready": false,
  "commercial_gate": "SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN",
  "owner_authorization_id": "<id propietario ≥8 caracteres>",
  "target_machine": "<hostname>",
  "installation_id": "<uuid>",
  "device_id": "<uuid distinto>",
  "issued_at": "<ISO-8601>",
  "expires_at": "<ISO-8601 futuro>",
  "scope": [
    "WINSW_INSTALL",
    "ACL_DPAPI_EVIDENCE",
    "NATIVE_TRANSPORT_EVIDENCE"
  ]
}
```

`commercial_ready:true` o `purpose` distinto → rechazo. La atestación **no** habilita el gate.

## 3. Verificación de Authenticode y hashes

1. Calcular SHA-256 de WinSW, `node.exe`, bundle SERVICE y adaptador nativo (`certutil -hashfile … SHA256`).
2. Confrontar con `payload-integrity.json` / pines de provisión.
3. Firma Authenticode del PE Camacho: registrar `RT-009-B_BLOCKED` hasta custodia/certificado real. No inventar certificados.

## 4. Instalación autorizada de `CamachoPOSLocalService`

Desde PowerShell **elevado**, payload real (no lab):

```powershell
node tools/operators/scm-physical-certification-attestation.mjs `
  "C:\ProgramData\CamachoPOS\managed\physical-attestation.json"

node tools/operators/scm-provision-preflight.mjs `
  "C:\ProgramData\CamachoPOS\managed\service-provision.json" `
  "C:\ProgramData\CamachoPOS\managed\desktop-provision.json" `
  "C:\ProgramData\CamachoPOS\managed\central-provision.json"

powershell -NoProfile -ExecutionPolicy Bypass -File `
  ".\resources\service-payload\install-camacho-local-service.ps1" `
  -Action PreparePhysicalCertification `
  -PayloadDir ".\resources\service-payload" `
  -DataDirectory "C:\ProgramData\CamachoPOS\data" `
  -InstallationId "<uuid>" -DeviceId "<uuid>" `
  -TenantId "<uuid>" -CompanyId "<uuid>" -BranchId "<uuid>" `
  -ScmHandoffFile "C:\ProgramData\CamachoPOS\managed\service-provision.json" `
  -ScmCentralProvisionFile "C:\ProgramData\CamachoPOS\managed\central-provision.json" `
  -PhysicalCertificationAttestation "C:\ProgramData\CamachoPOS\managed\physical-attestation.json" `
  -Json
```

Evidencia esperada del helper:

- `ok=true`, `purpose=PHYSICAL_CERTIFICATION_PREP`
- `startName=NT SERVICE\CamachoPOSLocalService`, `identityOk=true`
- binding handoff `installation_id`/`device_id` = parámetros del helper
- ACL RX sobre handoff, Central, adaptador, cápsula, signer path y candidato
- `expectedCommercialGateDenial=true`
- `commercialGate=SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`
- `commercialReady=false`
- Marcadores: `physical-certification-prep.ok` (payload + ProgramData logs)
- Un arranque comercial estable (`RUNNING` con handoff SCM) es **rechazo** (`PHYSICAL_PREP_UNEXPECTED_COMMERCIAL_START`)
- Tras pérdida de autoridad Central en runtime, el proceso SERVICE debe terminar (WinSW `onfailure` puede reiniciar; la admisión exige checkpoint live de nuevo)

NSIS comercial sigue abortando. `-Action Install` sigue fallando cerrado.

## 5. SID, ACL, DPAPI y transporte nativo

1. `sc.exe qc CamachoPOSLocalService` → `START_NAME=NT SERVICE\CamachoPOSLocalService`.
2. `icacls` sobre payload, data, logs y archivos del par SCM → ACE efectiva del SID virtual (RX/M según helper).
3. Confirmar que el preflight no leyó privadas; DPAPI CurrentUser del receptor DESKTOP permanece en custodia del perfil interactivo.
4. Transporte nativo (sin habilitar entry comercial):

```powershell
$env:CAMACHO_SCM_PHYSICAL_PROVISION = "C:\ProgramData\CamachoPOS\managed\service-provision.json"
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/windows-scm-physical.test.ts
# Repetir con la provisión DESKTOP en el mismo env.
```

## 6. Inicio del Electron comercial original

1. Arrancar el Electron comercial del producto (no Role Preview / DesignReview).
2. Confirmar que el canal SCM comercial permanece bloqueado por el gate mientras no exista autorización post-evidencia.
3. Conservar logs de denegación; no inyectar flags `POS_SCM_COMMERCIAL_READY`.

## 7. Autenticación y revocación

1. Conexiones nativas válidas: handshake + lease consumido (physical test).
2. Negativos: SID/session/logon incorrectos, pin de firmante alterado → rechazo.
3. Revocación: cierre de sockets SERVICE y DESKTOP; sin operaciones posteriores.
4. Central: checkpoint revocado / pérdida de autoridad → SERVICE deja de admitir (fail-closed). No afirmar frescura tras restauración conjunta Central+local.

## 8. Reinicio, reconexión y recuperación

1. Reiniciar el host o `sc stop/start` tras la prep.
2. Revalidar SID/ACL y que el XML conserve el par SCM.
3. El arranque con handoff SCM debe seguir denegado por el gate hasta autorización expresa.
4. Tras autorización futura del gate (fuera de este procedimiento), un restart exige checkpoint live autenticado; el floor cifrado no basta como admisión offline.

## 9. Evidencias necesarias para autorizar merge a `main`

El propietario sólo debe autorizar merge cuando exista el paquete completo:

1. CI exact-head SUCCESS de la PR #127 (reutilizar el HEAD aprobado; no re-ejecutar suites históricas manualmente).
2. Atestación + preflight SERVICE/DESKTOP/Central (`commercial_ready:false`).
3. Salida JSON del helper `PreparePhysicalCertification` + `physical-certification-prep.ok`.
4. Capturas/`sc`/`icacls` de identidad virtual y ACL SCM.
5. Resultado PASS de `windows-scm-physical.test.ts` en SERVICE y DESKTOP.
6. Evidencia de denegación del gate en arranque comercial SCM.
7. Evidencia de revocación/reinicio.
8. Registro RT-009-B / Authenticode (bloqueado o certificado real, sin fingir).
9. Confirmación de que no hay rutas lab ni credenciales de prueba en el artefacto.
10. Autorización expresa escrita del propietario para merge (esta checklist no la sustituye).

## Dependencias externas (no cerradas por código)

- Migración/publicación PostgreSQL 034 en Central operativo.
- Custodia KMS/HSM o archivos privados del firmante Central (la implementación actual es archivo condicionado; no se declara KMS).
- Certificado Authenticode de producto.
- Emisión real de credenciales de dispositivo y enrolamiento.
- Decisión humana de levantar `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` tras evidencias.

## Referencias

- Integración: `docs/testing/scm-real-integration-20261122.md`
- Preflight: `docs/testing/scm-commercial-provision-preflight-20261122.md`
- Helper: `apps/pos-desktop/packaging/install-camacho-local-service.ps1`
- Gate entry: `apps/pos-local-service/src/security/windows-commercial-host-identity.ts`

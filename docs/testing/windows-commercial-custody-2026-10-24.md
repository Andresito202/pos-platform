# Windows comercial: custodia nativa y preparación de despliegue

Base local/remota `efe16803ca0cf596b2441b8acbc79e642b6246ce`, rama activa
`feat/android-commercial-runtime`, PR #96 draft. Sólo estaba sin rastrear
`docs/product/oracleJdk-27/`; se conserva intacto y fuera del commit.
El propietario volvió a confirmar que no hay Central Authority externa disponible.

## Incremento implementado

- `CommercialDeviceCredentialProvider` adapta la identidad **viva** de
  `LocalSecurityComponent`; reutiliza DeviceIdentity/DeviceProof, store cifrado,
  verificador DeviceTrust y auditoría de DeviceEnrollmentService. Exige OS_BOUND,
  binding local de instalación/dispositivo y credencial central verificada para
  tenant/company/installation/device; compara claves públicas, verifica vigencia,
  clave local activa y evento canónico de enrolamiento completado.
- Antes de cada firma vuelve a resolver identidad, credencial y confianza. No
  reutiliza una DeviceIdentity capturada después de detener el componente. Firma
  sólo las cuatro rutas comerciales ya existentes, los IDs y el cuerpo exacto,
  con nonce fresco. No implementa refresh ni acepta rutas arbitrarias. Central
  sigue revalidando revocación de dispositivo/credencial: el estado remoto no se
  deduce de un archivo local firmado.
- `LocalSecurityComponent.matchesDeviceBinding` expone sólo comparación de
  metadatos; el llamador no puede cambiar el binding de la clave mediante sus IDs.
- La inspección D3 admite target explícito WINDOWS sin exigir App Links, paquete
  o certificado Android. El default ALL conserva las validaciones previas. No
  omite RP/origen/redirect, confianza, custodia ni evidencia de aprobación Windows.
  `ready` sigue siendo inspección estructural, nunca autorización productiva.
- [Preparación de Central Authority](../../infra/central-authority/README.md) y
  [variables existentes sin valores](../../infra/central-authority/runtime.env.example):
  separan laboratorio, preproducción y producción, documentan DNS/TLS, rol DB,
  claves públicas/privadas y provisión. No se ejecutó el servicio ni se modificó DNS.

El adaptador no se monta como RPC ni se añade al preload/React. Ninguna clave
privada, access, refresh o SSA se entrega al renderer. No se modifican sync,
Android, Linux, frontend, hardware, migraciones ni bases comerciales. No se
cambia la selección de credenciales del runtime actual. El reemplazo del firmante
del driver por custodia de servicio está implementado internamente, pero su
transporte main↔Service sigue pendiente de montaje aprobado; **no se declara
RUNTIME_VERIFIED/CALLER_REACHABLE**.

## Pruebas observadas

Windows real, DPAPI CurrentUser, AES-GCM/store y SQLite temporal, claves centrales
efímeras. El fixture obtiene credencial del issuer canónico con repository de
prueba y verifica la firma root→operacional; **no es enrolamiento central remoto
ni prueba de un empleado real**. No se usa proveedor que simule OS_BOUND.

| Ejecución | Resultado |
| --- | --- |
| Adaptador comercial DPAPI + regresión LocalSecurityComponent | 27 PASS, 0 FAIL, 0 omitidas (16 nuevas + 11 regresiones) |
| Configuración D3 | 8 PASS, 0 FAIL (2 nuevas + 6 existentes afectadas) |
| TypeScript Central y Local Service | exit 0 |
| Build Electron completo | exit 0 |
| ARCH-003 + tests del validador | PASS; 16/16 |
| Política del repositorio sobre los archivos preparados | PASS; 1008 archivos rastreados |

Casos nuevos: cuatro rutas con firma auténtica y nonces diferentes; cuerpo
alterado; credencial ausente; ausencia/fallo del asiento de enrolamiento;
firma alterada; credenciales auténticas para otro tenant/company/installation/
device o clave pública; revocación operacional y local; expiración (incluido
instante exacto); shutdown; recuperación de misma clave DPAPI tras reinicio;
rechazo de otro binding local, rutas ajenas, cuerpos excesivos y TEST_ONLY.

Primer intento: fallo de import en archivo de prueba y TypeScript; no ejecutó
casos válidos del adaptador. Se corrigió al importar el provider desde su archivo
existente. Reintento: 15/15; al añadir prueba de binding y regresiones del nuevo
método, final 27/27. Los archivos de salida conservan ambos intentos en
`artifacts/windows-commercial-custody/2026-10-24/`. No se repitieron 22 SAS,
23 MFA, 12 contraseña ni E2E comerciales: sus transportes y contratos no cambiaron.
La certificación HTTP/Electron previa conserva su SHA y alcance de laboratorio.

Comandos desde la raíz:

```powershell
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/commercial-device-credential.test.ts tests/security-component.test.ts --no-file-parallelism
pnpm --filter @pos-platform/central-authority exec vitest run tests/d3-deployment-readiness.test.ts
pnpm --filter @pos-platform/central-authority --filter @pos-platform/pos-local-service run typecheck
pnpm --filter @pos-platform/pos-desktop build
node --test tools/architecture/validate-boundaries.test.mjs
node tools/architecture/validate-boundaries.mjs
pnpm ci:repository-policy
```

## Continuidad de los siete entregables

| ID | Estado exacto | Siguiente dependencia |
| --- | --- | --- |
| P0-01 | Configuración/procedimiento preparados; sin despliegue real | Administrador, entorno controlado, DNS/TLS, DB y custodios |
| P0-02 | Registro/callback existentes y validación Windows independiente probada | RP/origen/cliente/puerto exactos reales y aprobados |
| P0-03 | Reutilizado enrolamiento canónico; verificación por uso probada localmente | Registros reales de empresa/sucursal/instalación/dispositivo, activación y cadena públicas verificadas |
| P0-04 | Adaptador Service-only con DPAPI probado; no montado en transporte | Contrato privilegiado main↔Service aprobado, custodia/provisión operativa y composición runtime |
| P0-05 | Productor SAS y recepción previa de laboratorio conservados | Provisión SAS separada, proveedor HTTPS productivo y contador/migración aprobados |
| P0-06 | Sin cambios productivos ni parámetros ratificados | Owner DB/seguridad: migraciones, privilegios, access/refresh, rotación, abuso y offline |
| P0-07 | No certificado | Satisfacer P0-01–06 y ceremonia interactiva con empleado autorizado |

La [única propuesta](android-commercial-approval-proposal-2026-10-22.md) se
mantiene, sin segunda solicitud ni aprobación implícita. La siguiente implementación
concreta será componer el adaptador de firma dentro del coordinador privilegiado
del servicio y conectar el canal main↔Service **una vez revisado su contrato**;
no publicar una operación arbitraria `sign(path,body)`. En paralelo, el operador
debe identificar/provisionar el entorno descrito. No existen datos suficientes
para desplegar o autenticar una persona real de forma segura en esta sesión.

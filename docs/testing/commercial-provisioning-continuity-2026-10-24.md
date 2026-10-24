# Continuidad P0 — confianza y provisión Windows

Base local/remota `9639c9fd776a2d629fa71d0007f250af2e01a337`, rama
`feat/android-commercial-runtime`, PR #96 draft. Árbol rastreado limpio al inicio;
`docs/product/oracleJdk-27/` intacto y excluido. Continúa el
[incremento anterior](commercial-provisioning-2026-10-24.md); no repite sus 144 casos.

## Corrección implementada sobre la confianza existente

`SessionTrustKeyVerifier` retornaba REVOKED antes de verificar la firma raíz.
El store admite ese resultado como tombstone: cambiar sólo el status de una
clave auténtica podía introducir una revocación no autenticada en un bundle
posterior. Ahora autentica antes de interpretar revocación. Una revocación
auténtica sigue siendo efectiva tras expirar la clave. También rechaza raíces
privadas/no Ed25519 y material operativo privado, de otro algoritmo o malformado,
incluso firmado por la raíz. `createPublicKey` por sí solo convertiría una PEM
privada en pública: se rechaza antes de esa conversión. No cambia ningún campo
ni propósito de SESSION_ASSERTION.

La prueba del store observa que la manipulación no escribe y que una nueva
instancia conserva el estado anterior. La composición nueva resolver→refresh→SSA
prueba pérdida de red, expiración exacta, restart y recuperación con rotación
autenticada. Conservar un mapa cacheado no amplía la vigencia: el verificador SSA
sigue aplicándola por uso. No se introduce gracia offline. Es recepción de
confianza, no un nuevo formato SAS ni login humano.

## SAS: extensión delimitada, sin activar un formato no aprobado

Contrato/issuer/publicación/verifier/store/resolver actuales admiten exclusivamente
SESSION_ASSERTION. No incluyen issuer en los claims; la firma cubre **cada clave**,
no `bundle.version` ni el conjunto completo. La monotonía local rechaza generaciones
numéricamente menores; no autentica la generación del distribuidor ni evita
recombinar claves antiguas en un wrapper mayor. No se afirma resuelto ese riesgo.

La [solicitud única, precisión Windows](android-commercial-approval-proposal-2026-10-22.md#precisión-para-aprobación-conjunta-windows-confianza-acceso-y-persistencia)
propone sobre SAS completo root-signed, issuer/purpose/environment cerrados,
generación y conjunto firmados, revocación y store separados. No se amplía el
literal SESSION_ASSERTION, no hay publisher SAS nuevo y no se activa ese contrato.
La separación de material SSA/SAS anterior se conserva. Falta aprobar formato y
operación de confianza antes de materializar su distribución.

## Contador Authorization: SQL propuesto y ensayado

Artefactos `tools/target-migrations/sql/postgres/proposals/sas_sequences.{up,down}.sql`.
Sin número definitivo, descriptor productivo, CLI ni arranque automático. Ambos
scripts rechazan DB fuera del namespace aleatorio de ensayo. No crean permisos:

- Binding DEC-011 user/install/device, FK canónicas y comprobación de instalación
  contra DeviceRegistry; el contador no autentica usuario, tenant o membresía.
- Reserva UPSERT por PK, start 1, exacto +1, techo 9007199254740991, snapshot_id y
  checksum, timestamps/binding inmutables. No se permite borrar watermarks.
- RLS habilitada/forzada; sólo central y lectura del owner. UPDATE restringido a
  columnas del contador. Ningún UPDATE sobre roles, permissions o grants.
- Down sólo en vacío, rechazado con evidencia retenida incluso por el owner.
- Helper **de prueba** ensaya checksum/advisory-lock/ledger canónicos: segunda
  aplicación no-op, drift rechazado y DDL/ledger atómicos. No reemplaza al runner
  productivo; faltan integración, predecesores y smoke/catálogos aprobados. SQL
  transaccional conforme al patrón existente, sin ocultar drift con IF NOT EXISTS.

PostgreSQL temporal 16, contenedor `target-migrations-postgres-1` con tmpfs
verificado y bind `127.0.0.1:55433`; sólo DB aleatorias creadas/eliminadas por el
test. Se iniciaron el contenedor y roles canónicos en ese cluster efímero. Ninguna
base persistente, activación o credencial comercial fue modificada. El test negativo
crea otra DB desechable, observa rechazo antes de DDL y la elimina.

Un trigger temporal provoca fallo real del INSERT en `identity.security_events`:
la misma transacción revierte contador y evento. No hay auditoría paralela.
Se observan 12 reservas concurrentes, replay/jump, binding, checksum, privilegios,
reconexión y conservación tras reapply. El productor aislado conserva su tabla
validation: no se cambia silenciosamente a este borrador.

Se prueba físicamente que los privilegios actuales no permiten FOR SHARE sobre
roles/permissions/grants. No se conceden UPDATE adicionales. La recomendación de
función mínima está en la misma solicitud: exige revisión de owner/RLS/search_path,
alcance derivado de DB, nuevos grants/asignaciones concurrentes y revocación.
Un advisory lock sólo entre emisores no serializa todos los writers RBAC.
No se crea SECURITY DEFINER sin aprobar esa frontera de privilegio.

## Access/refresh, vigencias y procedimiento de provisión

La matriz conjunta delimita audiencia/origen, rutas, headers, hash del access,
binding durable, renovación/posesión, replay, almacenamiento y recuperación.
POS-DEVICE-REQUEST-V1 firma método/path/cuerpo/IDs/timestamp/nonce/credencial;
no firma origin/audiencia/hash del access por sí solo. Ese formato no es DPoP.
No se monta protocolo productivo, no se usa el header LAB en SYSTEM_TRUST y no se
convierte sessionId en bearer. Verificadores y ledger 011/012 permanecen intactos.

`identity.session_refresh_tokens` conserva hashes/familias/rotación, pero aún no
binding durable a cliente/credencial de dispositivo. El rotador aislado tiene
límites de laboratorio, no política aprobada. El coordinador Service mantiene
tokens sólo durante la llamada; no persiste refresh. No se implementa renovación
productiva sin ese contrato. SSA/SAS aisladas están acotadas por access/sesión/
credencial/clave y políticas explícitas. TTL SAS de DEC-011 no autoriza alargar
SSA/BUSINESS. No se cambian candidatos 60/120/60 s, abuso ni gracia offline.

Procedimiento para el operador una vez exista entorno y aprobación:

1. Designar administrador Central/DB, DNS-TLS y custodio de raíz. Obtener dominio
   controlado, RP, cliente Windows y redirect exacto; verificar TLS desde Windows.
   Preparar perfil existente en `infra/central-authority/runtime.env.example`, sin
   copiar nombres/CA del laboratorio ni tratar sus campos vacíos como defaults.
2. Resolver en owners canónicos empresa/sucursal/install/device y autorización
   del operador; confirmar mapping de sucursal. No generar identidades en React
   ni registrar fixtures como dispositivos reales.
3. Obtener activación de un uso de Devices y cadena pública por canal autenticado;
   cotejar huellas fuera de banda. Clave de dispositivo generada/custodiada localmente,
   nunca en main, renderer o chat. No pedir ni registrar secretos en esta conversación.
4. Tras aprobación DB/políticas, componer `DeviceEnrollmentService.prepare/complete`,
   LocalSecurityComponent, DeviceTrust y transporte existentes en preproducción;
   verificar respuesta/binding contra la clave local y auditoría canónica. No hay
   asistente Windows productivo nuevo. Restore/clone no sustituye enrolamiento.
5. Proveer SSA y, sólo con perfil aprobado, SAS separados. Arranque por procedimiento
   existente; `/ready` sólo acredita enrollment con commercial_auth NOT_ACTIVATED.
6. Tras montaje aprobado, observar persona autorizada → BUSINESS → DeviceProof →
   SSA → SAS/grants → dashboard, logout y revocación. Esa certificación no ocurrió.

No existe entorno externo confirmado; no se despliega, cambia DNS o enrola un
humano ficticio para suplirlo. Las decisiones técnicas concretas se presentan en
la solicitud única, con riesgos, archivos, recomendación y pruebas por aprobación.

## Evidencia ejecutada

[Manifest de resultados y hashes](commercial-provisioning-continuity-evidence-2026-10-24.json).
Raw local: `artifacts/commercial-provisioning-continuity/2026-10-24/`.

| Selección final | PASS | FAIL | Omitidas |
| --- | ---: | ---: | ---: |
| Confianza SSA/store/resolver/refresh, lifecycle y bootstrap afectados | 22 | 0 | 0 |
| Propuesta SQL en PostgreSQL temporal | 9 | 0 | 0 |
| Regresión Electron Service-custody dependiente de trust bootstrap | 1 | 0 | 168 |
| **Casos distintos** | **32** | **0** | **168** |

El primer lifecycle falló por importar InsecureDerivedKeyProvider desde un archivo
que no lo exporta; TypeScript también lo detectó. Se corrigió el import y el assert
de expiración antes de la selección final. Se conservan salidas iniciales fallidas.
No se ocultan como CI verde. Electron real observa DPAPI Service, clave fuera de
main, contraseña incorrecta rechazada, autenticador virtual CTAP2, SSA recuperable,
SAS SQL canónico, dashboard AUDIT_EVENT_READ y catálogo UNAUTHORIZED. No certifica
DEV-003 real ni un empleado. No se repiten suites históricas Argon2id/MFA/sesiones.

TypeScript Local Service/target-migrations, build completo Electron, 16 pruebas del
validador y fronteras ARCH-003, política del repositorio y diff-check aprobados.
Actions pendiente según propietario hasta restablecimiento previsto 2026-11-01;
workflows intactos. PR #96 draft, sin merge.

Comandos de selección, con PostgreSQL tmpfs y roles canónicos preparados:

```powershell
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/session-trust-key.test.ts tests/session-trust-key-store.test.ts tests/session-trust-key-resolver.test.ts tests/session-trust-refresh-component.test.ts tests/session-trust-lifecycle.test.ts tests/session-bootstrap-runtime.test.ts
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm --filter @pos-platform/target-migrations exec vitest run tests/sas-sequence-proposal-physical.test.ts
pnpm --filter @pos-platform/pos-local-service --filter @pos-platform/target-migrations run typecheck
pnpm --filter @pos-platform/pos-desktop build
# Probes/captura Electron: mismo procedimiento reproducible de P0-04.
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-access-preparation-physical.test.ts -t 'central SAS: Electron.*custody=true'
node --test tools/architecture/validate-boundaries.test.mjs
node tools/architecture/validate-boundaries.mjs
pnpm ci:repository-policy
git diff --check
```

| P0 | Incremento verificado | Pendiente |
| --- | --- | --- |
| 01 Central HTTPS | Composición aislada conservada; perfil previo intacto | Servidor/admin/DNS-TLS/DB y montaje aprobados |
| 02 Windows/RP | Callback/PKCE conservados en E2E | Dominio/RP/cliente/redirect reales registrados |
| 03 DEV-003 | DPAPI anterior conservada; procedimiento delimitado | Activación/registros/mapping/cadena reales |
| 05 Confianza SAS | Corrección root-verifier/lifecycle probados, extensión identificada | Aprobar y materializar sobre SAS completo/issuer/generación/store |
| 06 Migraciones/políticas | Contador propuesto, 9 pruebas físicas, sin UPDATE RBAC añadido | DDL/runner y locks/RLS; access/refresh/vigencias/abuso/offline |
| 07 Login humano | No certificado; regresión de laboratorio aprobada | Enrolamiento real y ceremonia de empleado autorizado |

Siguiente implementación concreta tras aprobar DEC-011 en la **solicitud única**:
sobre SAS completo y resolución monotónica en el owner existente, con store
separado y pruebas de generación/conjunto/manipulación/revocación. Después integrar
contador revisado y perfil access/refresh aprobado. En paralelo operativo falta
designar administrador y entorno real; el agente no puede fabricar esos datos.

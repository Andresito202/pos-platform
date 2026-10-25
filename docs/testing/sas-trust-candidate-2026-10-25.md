# Confianza SAS completa — candidato DEC-011, 2026-10-25

Base local/remota: `7d92ea4c313ac4d708100e47e3a3f686cf073c67`.
Rama `feat/android-commercial-runtime`, PR #96 draft. Sólo
`docs/product/oracleJdk-27/` estaba sin rastrear; se conserva excluido.
El diseño B estaba publicado, sin tarea visual concurrente. No se modifican
las pantallas ni password/MFA/BUSINESS/PKCE/DeviceProof/SSA/access/refresh.

## Contrato implementado y límite de autorización

La orden del propietario permite materializar un **candidato aislado** sin
aprobar su adopción productiva. La [solicitud única](android-commercial-approval-proposal-2026-10-22.md)
reconcilia expresamente esa autorización posterior con su precisión anterior.
DEC-011 conserva el owner Authorization, Ed25519, canonicalización existente,
estados de claves y `TrustedClockGuard`; no se cambia SESSION_ASSERTION.

`packages/contracts/src/authorization-trust-candidate.ts` define un sobre
`{claims,signature}`. La firma Ed25519 cubre **todos** los claims canónicos:
perfil `DEC011_LAB_CANDIDATE_1`, modo ISOLATED_VALIDATION, esquema 1,
propósito AUTHORIZATION_SNAPSHOT, entorno `isolated-validation`, issuer HTTPS
exacto, authority_id, generación entera segura, complete=true, issued_at,
valid_from/valid_until y conjunto completo de claves públicas, cada una con
identificador, propósito, estado, versión y ventana. Los campos desconocidos,
identificadores repetidos y ventanas inválidas se rechazan. El campo de clave
admite exactamente una PEM pública: no acepta PEM privada ni material añadido
tras ella. Central también exige Ed25519 y material sin duplicados antes de
firmar/publicar, sin depender del rechazo posterior del receptor. No existe perfil
productivo aceptable para este esquema.

El firmante Central `isolated-authorization-trust.ts` sólo acepta ese esquema
y una clave privada Ed25519; recibe la raíz por dependencia, no la genera.
La composición usa raíces efímeras **de prueba**; nunca una raíz comercial.
La nueva publicación GET `/v1/isolated/authorization-trust` pertenece únicamente
al servidor HTTPS existente, limitado a loopback y una base PostgreSQL
`pos_business_session_test_*` en localhost:55433. Sirve sólo el artefacto público,
no claves privadas, sesiones ni grants. Mantiene presupuesto de peticiones,
headers estrictos, host/origen exactos y no-store. No está montada en main.

## Almacén Windows y resolución

`AuthorizationTrustCandidateStore` reutiliza `EncryptedFileSecretStore`,
DPAPI CurrentUser y `TrustedClockGuard`. Exige OS_BOUND, raíz pública Ed25519,
issuer/authority/entorno y piso de generación explícitos, configurados por el
llamador confiable. No obtiene confianza del renderer o de la respuesta HTTPS.

El archivo independiente `authorization-trust-lab-candidate.secret` guarda
firma, generación e historial en el mismo sobre AES-GCM protegido por DPAPI.
El rename atómico existente confirma el cambio; un fallo conserva el anterior.
No comparte nombre ni contexto con SSA. La generación antigua/conflictiva y
retrocesos de issued_at se rechazan. El historial es acumulativo: no se pueden
omitir identificadores anteriores, sustituir material bajo el mismo ID,
retroceder versiones/estados o cambiar un tombstone REVOKED. El material público
duplicado se rechaza, incluyendo la reutilización bajo otro ID de una clave
revocada. VERIFY_ONLY mantiene verificación; REVOKED es terminal.

Antes de interpretar estado/generación se autentica la firma raíz. En cada
lectura del mapa vivo se descifra y verifica de nuevo la firma, binding,
ventana y separación con **el mapa SSA confiable actual**, por ID y SPKI, incluso
con alias o claves SSA revocadas. Las ventanas efectivas son la intersección
del bundle y de cada clave. Corrupción, expiración o rollback de reloj producen
un mapa vacío; no se conserva autorización cacheada ni hay gracia offline.
Una actualización válida puede recuperar confianza tras expirar el bundle
anterior, conservando su generación e historial autenticados.

La operación es síncrona en el **único writer Service**, por lo que las
instalaciones concurrentes en ese owner se serializan sin una ventana await
entre comparación y reemplazo. No se afirma exclusión multiproceso. DPAPI no
es un contador de hardware: un administrador que restaure la máquina/archivos
completos puede restaurar su watermark. El piso de bootstrap y la recuperación
de backups requieren procedencia/política aprobadas; borrar el store no se
considera un reset autorizado. El candidato limita el historial a 128 claves;
no implementa compactación ni rotación de raíz ni las supone aprobadas.

## Integración observada

El adaptador HTTPS cerrado sólo funciona con NODE_ENV=test, destino `.test`
resuelto a loopback, CA explícita, TLS verificado, ruta fija, plazo absoluto y
respuesta acotada a 1 MiB. Rechaza redirects, compresión, status/content-type
incorrectos, firma inválida y respuesta excesiva. No admite bearer ni emite
sesiones. La pérdida de red no escribe ni amplía vigencias.

El host existente de Service adquiere el conjunto firmado por HTTPS, persiste
con DPAPI y entrega el mapa vivo al `CommercialComponent` existente. El driver
Electron conserva ambos modos ya existentes; el que custodia credenciales en
Service no expone privadas/access/refresh a main ni renderer. Se rechazan
fuentes de confianza ambiguas. El sobre sustituye el mapa SAS público directo
en estos dos E2E, no crea un productor SAS ni un verificador alternativos.

| Componente | Implementado | Probado | Pendiente |
| --- | --- | --- | --- |
| Contrato DEC-011 | Candidato independiente completo | Firma de todos los campos, schema/binding | Ratificar formato/raíz productivos |
| Firma de conjunto SAS | Firmante Central aislado | Raíz falsa, manipulación, generación y composición | Custodio y firma operativa reales |
| Generación monotónica | Piso explícito + watermark protegido | Downgrade, conflicto, concurrencia y recuperación | Bootstrap/backup aprobados |
| Almacén independiente | Sobre DPAPI/AES-GCM atómico | Reinicio de provider/store y proceso Node separado, fallo rename | Provisión en servicio instalado |
| Rotación/revocación | Historial y tombstones autenticados | Omisión, sustitución, alias SSA, resurrección y offline | Cadencia, raíz y retención definitivas |
| Contador PostgreSQL | Borrador previo conservado sin cambios | Seis ensayos focalizados, no migración productiva | Runner/DDL/RLS/privilegios y composición emisora |
| Central/Service | HTTPS candidato → DPAPI → mapa vivo → receptor SAS existente | PostgreSQL real temporal + Service + Electron | Montaje aprobado en runtime productivo |
| Dashboard autorizado | Permisos del productor SQL canónico | Apertura limitada y cierre por revocación; operación prohibida denegada | Persona real y entorno provisionado |

## Ejecución y fallos conservados

Informes originales locales: `artifacts/sas-trust/2026-10-25/`.
El [resumen publicable](sas-trust-candidate-evidence-2026-10-25.json) conserva
recuentos, nombres, huellas y fallos iniciales sin secretos. Los casos omitidos
por filtro no se cuentan como aprobados. WebAuthn usa Chromium CTAP2 virtual
con firma real: **no es autenticación de una persona**.

Primer intento Electron: custodia Service pasó; el driver alternativo no
solicitó SAS porque sólo reconocía la configuración antigua. Se amplió su
condición al candidato; no se relajaron verificadores ni permisos. El ensayo
inicial de cuatro casos SQL omitió el caso que crea la tabla de propuesta;
falló por relación ausente. Se corrigió el filtro para incluir ese prerequisite,
sin modificar el SQL. Los informes de ambos fallos se retienen.

El primer ensayo de proceso separado conservaba abierto el writer SQLite padre:
el guard canónico rechazó el segundo writer. El fixture ahora cierra correctamente
el primero antes de arrancar el segundo; no se cambia el guard. En esa ejecución
con Electron y tipos simultáneos un caso DPAPI tardó 5,12 s y excedió el timeout
de prueba de 5 s; pasó aislado en 443 ms. Se repitió la suite de confianza en
serie con timeout de prueba de 30 s, sin modificar plazos productivos. Ambos
fallos están incluidos en la evidencia histórica, con 0 fallos en el pase final.

Resultado final: **63 casos focalizados aprobados**: 35 nuevos de confianza
DPAPI/transporte/recuperación, 17 regresiones del receptor SAS, 1 del firmante,
4 PostgreSQL/Electron (dos E2E y dos denegaciones) y 6 del borrador SQL;
**16 casos de arquitectura** adicionales. TypeScript contracts/Service/Central/Desktop,
build Electron y política locales aprobados. No son 63 pruebas nuevas ni una
certificación de producción.

Comandos reproducibles, después del build y los probes existentes:

```powershell
pnpm --filter @pos-platform/contracts typecheck
pnpm --filter @pos-platform/pos-local-service typecheck
pnpm --filter @pos-platform/central-authority typecheck
pnpm --filter @pos-platform/pos-desktop build
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/authorization-trust-candidate.test.ts tests/central-sas-reception.test.ts --no-file-parallelism --testTimeout=30000
pnpm --filter @pos-platform/central-authority exec vitest run tests/isolated-authorization-trust.test.ts
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm --filter @pos-platform/target-migrations exec vitest run tests/sas-sequence-proposal-physical.test.ts -t 'rolls back DDL|serializes concurrent|counter advance rolls|forces RLS|rejects replay|retains the watermark'
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-access-preparation-physical.test.ts -t 'central SAS: Electron|central SAS: a user without|central SAS: revoked session'
pnpm architecture:check
pnpm ci:repository-policy
```

El contenedor PostgreSQL 16 usa tmpfs; sólo se crean/eliminan DB de ensayo.
No se aplicó DDL ni se tocaron roles, permisos o datos de bases comerciales.
Las suites completas MFA/Argon2id/negocio/hardware no se repiten. CI remoto
sigue pendiente por facturación; no hay declaración de CI verde.

## Lo que falta implementar o provisionar

1. **Aprobar y aprovisionar confianza DEC-011:** formato definitivo, raíz/custodio,
   huellas independientes, issuer/authority/env, generación mínima de instalación,
   actualización autenticada, recuperación y rotación de raíz. Después conectar
   los adapters probados al bootstrap instalado y su refresh/lifecycle; no
   promover automáticamente el perfil ni la ruta de laboratorio.
2. **Integrar contador y productor con privilegios mínimos:** aprobar descriptor,
   número/predecesores/smoke/catálogos del runner para el borrador existente y
   reserva + auditoría en la transacción emisora. Resolver el bloqueo de lectura
   RBAC: el productor aislado usa FOR SHARE con privilegios sólo de fixture;
   el runtime mínimo no tiene UPDATE RBAC. La propuesta única ofrece función
   acotada o protocolo de serialización de todos los writers, aún sin aprobación.
   No se concedieron privilegios productivos ni se ocultó ese pendiente.
3. **Cerrar access/refresh D3:** audiencia/origen y hash del access bajo posesión,
   familia ligada a cliente/credencial/install/device, renovación/rotación/reuse,
   custodia DPAPI y recuperación, logout/revocación, absolutos/inactividad/MFA y
   presupuestos durables de abuso. Mantener candidato separado de DeviceProof V1;
   el header aislado no es protocolo productivo aprobado. No hay gracia SAS:
   vence → denegar; reconectar → revalidar/renovar antes de operar.
4. **Entorno y DEV-003 reales:** designar operador Central/DNS/TLS/DB/custodio,
   registrar RP/cliente/callback Windows exactos, alta autorizada de persona y
   membresía/rol/grants, activar instalación/dispositivo y verificar claves por
   canal independiente. El entorno sigue sin confirmar; no se inventan datos.
5. **Certificar Windows con una persona y CI remoto:** enrolamiento autorizado,
   MFA físico, BUSINESS → DeviceProof → SSA → SAS → permisos → dashboard,
   reinicio/renovación/revocación/offline/logout en el servicio instalado.
   Restablecer CI del HEAD exacto antes del gate de integración a main.

La siguiente implementación concreta, tras las decisiones de contrato, es la
provisión SAS validada en el bootstrap Windows del Local Service, con raíz y
floor recibidos por el canal privilegiado existente. Android SEC-004/DEC-025 no
bloquean esta línea Windows. No se declara login humano ni producción aprobados.

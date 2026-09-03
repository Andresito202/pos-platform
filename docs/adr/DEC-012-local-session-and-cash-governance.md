# DEC-012 — Identidad de sesión local (Signed Session Assertion) y gobernanza de habilitación de Cash

## Estado

`PROPUESTA`. No decidida. No implementada.

Este documento **no autoriza implementar nada**. Fija fronteras arquitectónicas para que una decisión humana posterior pueda habilitar identidad local y, después, `CASH-001`, sin rehacer la arquitectura. Siguiendo el patrón de `DEC-011` (`docs/adr/DEC-011-authorization-projection-sas.md:7`), la materialización de cada decisión aquí descrita requiere autorización explícita en un bloque posterior y firma del responsable.

Ningún `SEC-Gxx` cambia de estado por este documento. `SEC-G01` a `SEC-G10` permanecen `PLANNED / NOT_EVALUATED` (`docs/product/backlog.md:84`), y `docs/product/backlog.md:378` exige evidencia y evaluación explícitas para cualquier promoción.

## Prioridad

`P0`. `DEC-011:11` establece que todo vertical comercial —`UC-CASH-001`, `UC-CASH-002`, `UC-CASH-003`, `UC-SALES-001`— exige un usuario autenticado con permiso. Ese usuario no existe hoy en el runtime local, de modo que esta frontera bloquea la totalidad del núcleo comercial.

## 1. Contexto

La cadena de autorización está materializada y operativa:

| Bloque | Estado | Contenido |
|---|---|---|
| `AUTHZ-001` | en `main` | `evaluatePermission()`, función pura, deny by default |
| `SAS-001` | en `main` | Verificador Ed25519 del Signed Authorization Snapshot |
| `SAS-002` | en `main` | Persistencia local con anti-replay por `sequence` |
| `SAS-003` | en `main` | Adquisición/refresh con fail-closed |

`DEC-011` cerró el modelo de **autorización** offline. Dejó fuera de alcance, de forma expresa, «sesión, MFA y revocación central… que requieren autorización específica» (`DEC-011:212`).

El modelo de seguridad ya diseña la operación offline en dos mitades (`docs/architecture/security-model.md:118`): «La operación offline exige `offline_valid_until`, snapshot de permisos y versión de política conocidos». El snapshot de permisos existe; `offline_valid_until` y la sesión que lo porta, no.

## 2. Problema

`evaluatePermission()` deniega a todo actor que no sea `USER` (`packages/domain/src/authorization/decision.ts:56`, `actor.ts:31`). Producir un `Actor(USER)` exige un `user_id` verificado. El runtime local no tiene ninguno:

- `apps/pos-local-service/src/config.ts` no contiene identidad de usuario ni sesión.
- `apps/pos-local-service/src/operations/operation-confirmation-store.ts:11-17` lo declara: «This runtime has no user/session model yet… intentionally NOT a user identity».
- `local_operation_audit.actor_type` admite únicamente `'DEVICE'` y `'SYSTEM'` (`packages/database-sqlite/src/local-database.ts:167`), de modo que un acto de usuario **no es registrable** hoy.

Existen dos restricciones duras que acotan cualquier solución:

1. **SQLite no puede replicar identidad central.** `docs/architecture/physical-model/sync-base-schema.md:27`: «No replica User, credenciales, Session central, Membership editable, secretos». `docs/architecture/physical-model/foundation-schema.md:36` clasifica `Session, SessionRefreshToken` como `CENTRAL_ONLY`. Verificar una contraseña localmente contra material replicado queda por tanto excluido.
2. **La posesión de un SAS no es autenticación.** El SAS prueba que la autoridad central concedió permisos al usuario `U` en el dispositivo `D`. No prueba que la persona frente al terminal sea `U` en este momento. Derivar la identidad del operador del SAS activo convertiría «hay un snapshot en disco» en «este humano es ese usuario», que es la misma clase de error que `DEC-011:28` prohíbe al vetar derivar autoridad de variables de entorno, del `device_id` o de un seed local.

## 3. Decisiones

### D1 — Sesión local y Signed Session Assertion

Se define la **SSA (Signed Session Assertion)**: artefacto emitido por la autoridad central, firmado Ed25519 sobre `canonicalJson(claims)`, verificable offline, con envoltorio `{ claims, signature }` idéntico al de la licencia y el SAS.

1. La SSA transporta **identidad y contexto de sesión. No transporta permisos.**
2. **El SAS sigue siendo la única autoridad de autorización.** Ninguna decisión de permiso consulta la SSA.
3. SSA y SAS comparten binding `user_id` + `installation_id` + `device_id`. Una discrepancia entre ambos es `BINDING_MISMATCH` y deniega.
4. La SSA reutiliza la maquinaria criptográfica existente. No se introduce un segundo mecanismo, por el mismo criterio con que `DEC-011:38` obligó a reusar la de licencia.
5. Este documento **no cierra ni promueve `SEC-G02`**. Login, rotación de refresh, MFA, bloqueo y recuperación son alcance central y permanecen `NOT_EVALUATED`.

**Ubicación de `tenant_membership_id`: vive en la SSA, no en el SAS.**

Justificación: `DEC-011:90` separa estrictamente «`user_id` es identidad; `assignments` es autorización». Una membership vincula usuario con tenant y es, por tanto, identidad. Además, el SAS está materializado y mergeado; añadirle el campo obligaría a modificar `SAS-001` y re-verificar la cadena completa, mientras que la SSA es un contrato nuevo sin coste de compatibilidad. `docs/architecture/physical-model/device-licensing-schema.md:290` sitúa `tenant_membership_id` junto a `user_id` en el snapshot offline diseñado, lo que respalda tratarlos como el mismo lado del modelo.

### D2 — Prueba de presencia

Se autoriza incorporar una prueba de presencia local **únicamente si satisface las cinco condiciones siguientes de forma simultánea**:

1. no replica credenciales centrales;
2. no permite autenticarse contra el sistema central;
3. su alcance se limita a una sesión y se destruye al expirar la SSA;
4. dispone de protección contra fuerza bruta;
5. queda vinculada a usuario, sesión y dispositivo.

**El factor concreto NO queda fijado por esta decisión.** La evidencia disponible no autoriza elegir entre PIN, contraseña local u otro mecanismo: hacerlo sería inventar autenticación. Queda como decisión pendiente `P-2` (§13).

Condición previa: debe ratificarse expresamente que la prohibición de `sync-base-schema.md:27` alcanza a *credenciales centrales replicadas* y no a *material generado localmente, acotado a la sesión e inútil contra la autoridad central*. Si esa lectura se rechaza, la única vía compatible es una SSA de vigencia muy corta con reemisión online, lo que degrada la operación offline y tensiona `ADR-003`.

### D3 — `offline_valid_until`

Se fijan invariantes, no valores:

1. **`SSA.offline_valid_until <= SAS.expires_at`.** Estructural: la activación se rechaza si no se cumple. Una sesión que sobreviva a su snapshot produciría un usuario autenticado sin autorización evaluable, estado que debe ser inexpresable.
2. Existe un **techo máximo versionado y configurable**, por debajo del cual el valor operativo puede ajustarse.
3. **No se introduce grace period.** `DEC-011:108`: «No existe gracia offline para autorización… No se extiende un privilegio expirado».

No se fija un número. `docs/security/security-gates.md:75` establece la convención del repositorio: «Las duraciones… son configurables y versionadas; no se fijan aquí valores no cerrados». `DEC-011:112` añade que la ventana offline y la ventana de exposición a revocación son la misma magnitud, por lo que su valor es una decisión de seguridad y queda como pendiente `P-3`.

### D4 — Migración de sesión y auditoría de actor `USER`

Se autoriza **conceptualmente** una única migración local posterior que realice, de forma atómica:

1. persistencia de la SSA;
2. extensión de `local_operation_audit.actor_type` para admitir `'USER'`;
3. preservación íntegra de las filas de auditoría existentes, verificada por recuento dentro de la misma transacción;
4. recreación y verificación de los triggers append-only `no_update` y `no_delete`.

Deben ir juntas: un runtime capaz de autenticar pero incapaz de auditar al usuario es peor que ninguno de los dos, porque atribuiría actos de usuario al dispositivo y produciría un rastro falso.

`MIGRATION_005` **no se edita**. La extensión se materializa en una migración nueva, de modo que los bytes y el checksum de las migraciones ya aplicadas permanecen inmutables. SQLite no admite alterar un `CHECK`, por lo que la reconstrucción de la tabla es obligatoria y constituye el punto de mayor riesgo del conjunto.

**Esta decisión no crea `MIGRATION_007`.**

### D5 — Habilitación del DDL comercial de Cash

Se autoriza **conceptualmente** una migración comercial futura estrictamente limitada a tres tablas:

- `cash_register`
- `cash_shift`
- `cash_movement`

**No se autorizan** Sales, Inventory, Catalog, Pricing, Payments ni ningún otro dominio. El gate permanece `NO-GO` para todo lo demás (`docs/product/backlog.md:362`).

No es DDL especulativo en el sentido del riesgo `R-006` (`docs/product/backlog.md:672`): `docs/architecture/physical-model/cash-counting-schema.md` cerró `PHY-G07` y provee la fuente de diseño.

**Requisito obligatorio previo.** `cash-counting-schema.md:24` clasifica `CashRegister` como `CENTRAL_MASTER_REPLICATED` —«central; el POS consume versión autorizada»— y no existe mecanismo que siembre cajas en SQLite local. `UC-CASH-001` exige rechazar una caja inexistente o ajena al contexto, lo que presupone que las cajas legítimas están presentes. **Debe definirse el aprovisionamiento confiable de `CashRegister` antes de habilitar esta migración.** Es la misma clase de hueco que `LIC-003`/`DEV-003`, y queda como pendiente `P-5`.

La migración deberá portar además la restricción de base de datos que `UC-CASH-001:40` exige: «Debe existir una restricción que impida más de un turno abierto incompatible por tenant, sucursal, caja y terminal. La verificación previa no sustituye esa protección contra concurrencia».

**Esta decisión no crea `MIGRATION_008`.**

### D6 — Representación canónica del código de permiso

Se fija **`CASH_SHIFT_OPEN`** como representación canónica.

`packages/contracts/src/primitives.ts:5` define `STABLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]*(?:[.:-][A-Z0-9_]+)*$/`, que `PermissionCodeSchema` consume y el SAS aplica en cada snapshot. La forma documentada en `docs/security/permission-matrix.md:225`, `cash.shift.open`, es **rechazada por ese patrón**: un SAS que la transportara fallaría en la frontera de contrato.

No existe evidencia contraria que sobreviva al contrato materializado. La documentación deberá alinearse con el contrato, no al revés: relajar el patrón invalidaría un contrato ya verificado y obligaría a re-verificar `SAS-001/002/003`, mientras que corregir la matriz no tiene coste operativo.

**No se modifican `SAS-001`, `SAS-002` ni `SAS-003`.** No hace falta: sus pruebas ya ejercitan la forma en mayúscula.

La forma debe quedar fija **antes de que exista emisor central**; cambiarla después invalidaría los snapshots ya emitidos.

### D7 — Contexto confiable

Se define como objetivo arquitectónico:

1. la **identidad** procede de la SSA;
2. la **autorización** procede del SAS;
3. `company_id` y `branch_id` se **validan contra los `assignments`** del SAS mediante `assignmentCoversOperation()`, no se confían desde entorno;
4. `POS_TENANT_ID`, `POS_COMPANY_ID` y `POS_BRANCH_ID` **dejan de ser autoridad** para operaciones con actor `USER`.

`docs/security/security-gates.md:41` exige un «`TenantContext` derivado de identidad, membership y sesión», y `security-gates.md:44` tipifica como amenaza que «Un parámetro libre suplanta `tenant_id`», con el control de «ignorar el ID como autoridad y compararlo con contexto confiable». `docs/product/backlog.md:362` ya reconoce que la derivación actual desde entorno tiene «mismo nivel de confianza self-asserted que `installation_id`/`device_id`» y que derivarlos de un artefacto firmado «sigue siendo el diseño objetivo».

**La ruta `DEVICE` existente de `RT-006` se preserva íntegra** hasta que exista una migración controlada. `operation.confirm` sigue operando con actor `DEVICE` y contexto derivado de configuración local. No se introduce una segunda fuente de contexto para el mismo tipo de actor.

**Esta decisión no autoriza refactorizar `config.ts`.**

## 4. Invariantes de seguridad

1. Fail-closed en toda ruta: cualquier fallo de verificación, binding o vigencia deniega.
2. La identidad procede exclusivamente de un artefacto firmado. Un `user_id` recibido en una petición nunca es autoridad.
3. La SSA no concede permisos. El SAS no acredita identidad de presencia.
4. `SSA.offline_valid_until <= SAS.expires_at`.
5. Sin gracia offline para autorización ni para sesión.
6. `sequence` estrictamente monótona en la SSA, con el mismo criterio anti-replay de `SAS-002`: una secuencia igual es un reenvío y una menor es un replay; ninguna desplaza a la activa.
7. Un actor `DEVICE` nunca obtiene permisos comerciales, ni por inferencia ni por configuración.
8. Toda operación se audita con el `snapshot_id` y la `sequence` del SAS empleado, conforme a `DEC-011:116`.
9. La auditoría no es fuente de autorización (`DEC-011:166`).
10. Una revocación conocida prevalece sobre el artefacto local (`security-model.md:119`).

## 5. Fronteras SSA vs SAS

| | SSA | SAS |
|---|---|---|
| Responde a | quién es el operador | qué puede hacer |
| Contenido | `session_id`, `user_id`, `tenant_membership_id`, binding, vigencia, `policy_version`, evidencia MFA | `assignments[]` con permisos y ámbitos |
| Autoridad de | identidad y contexto de sesión | autorización, en exclusiva |
| Consumidor | `LocalIdentityResolver` → `Actor(USER)` | `evaluatePermission()` |
| Vigencia | `offline_valid_until` | `expires_at` |
| Definido en | este documento | `DEC-011` |

Ambos comparten binding y maquinaria criptográfica. Ninguno sustituye al otro: sin SSA no hay actor; sin SAS no hay permiso. La operación exige los dos, vigentes y coherentes entre sí.

## 6. Threat model resumido

| # | Amenaza | Control |
|---|---|---|
| A1 | `user_id` inyectado en la petición | identidad solo desde artefacto firmado |
| A2 | Terminal desatendido operado por un tercero | prueba de presencia (D2) + vigencia acotada |
| A3 | SSA de un dispositivo reutilizada en otro | binding `installation_id` + `device_id` |
| A4 | Replay de una SSA anterior | `sequence` estrictamente monótona |
| A5 | Sesión revocada sigue operando offline | `offline_valid_until` acotado; revocación conocida prevalece |
| A6 | Reloj retrasado revive sesión expirada | `TrustedClockGuard` existente |
| A7 | `DEVICE` escala a permisos comerciales | `canHoldBusinessPermissions()` existente |
| A8 | Auditoría atribuye a `DEVICE` un acto de usuario | `actor_type='USER'` real (D4) |
| A9 | Credenciales centrales filtradas desde el POS | prohibición de replicarlas (§7) |
| A10 | Suplantación de tenant por parámetro libre | contexto derivado de SSA/SAS (D7) |

A2 es la única amenaza que ningún artefacto firmado resuelve por sí solo, y la razón de existir de D2.

## 7. Datos persistibles y datos prohibidos

**Persistibles localmente:** SSA firmada íntegra con su checksum de integridad, `session_id`, `user_id`, `tenant_membership_id`, binding, `offline_valid_until`, `sequence`, `authorization_policy_version_id`, `activated_at`. Mismo patrón que `local_authorization_snapshot`.

**Prohibido persistir, en cualquier forma:** hash de contraseña, refresh token, semilla MFA, access token reutilizable contra la autoridad central, y cualquier secreto que permita autenticarse contra el sistema central desde el POS. Deriva directamente de `sync-base-schema.md:27` y `foundation-schema.md:36`.

El verificador de presencia de D2, si llega a autorizarse, debe ser material derivado, acotado a la sesión y no reutilizable contra central, custodiado por el `EncryptedFileSecretStore`/DPAPI ya existente.

## 8. Offline y online

| Exclusivo de la autoridad central | Verificable localmente offline |
|---|---|
| Verificar credenciales | Verificar la firma de la SSA |
| MFA | Comprobar binding y vigencia |
| Crear sesión y emitir SSA | Prueba de presencia |
| Revocar | Rechazar `sequence` no monótona |
| Emitir SAS | Evaluar permisos sobre el SAS |

La ventana offline es, simultáneamente, la ventana de exposición a una revocación desconocida. Es una limitación inherente al modelo offline, ya aceptada y documentada en `DEC-011:112`, y se acota mediante el techo de D3.

## 9. Compatibilidad con la arquitectura existente

- **ARCH-003.** `runtime` no puede depender de `domain` (`tools/architecture/module-boundaries.json`). El resolutor que traduce SSA + SAS a `Actor(USER)` y `OperationScope` debe residir en `application`, junto a `toRoleAssignments()`, que ya resuelve el mismo problema de capa.
- **`evaluatePermission()` no se modifica.** Recibe un `Actor(USER)` real en lugar de no poder recibirlo.
- **`SAS-001/002/003` no se modifican.**
- **`RT-006` se preserva.** La ruta `DEVICE` de `operation.confirm` sigue operando sin cambios.
- **Criptografía.** Se reutilizan `TrustedClockGuard`, el trust store de claves y el patrón de verificación de `AuthorizationSnapshotVerifier`.
- **Idempotencia y outbox.** Se reutilizan `runtime_operations` y `local_sync_outbox`. No se crea infraestructura transaccional paralela.

## 10. Migraciones futuras: autorizadas y no autorizadas

**Autorizadas conceptualmente**, cada una sujeta a autorización explícita de materialización:

| Migración | Alcance | Condición |
|---|---|---|
| Sesión local (D4) | persistencia SSA + `actor_type='USER'` + preservación de auditoría | una sola migración atómica |
| Cash (D5) | `cash_register`, `cash_shift`, `cash_movement` | exige resolver antes `P-5` |

**No autorizadas:** Sales, Inventory, Catalog, Pricing, Payments, cierre de turno, arqueo, movimientos manuales, devoluciones, reportes, y cualquier otra tabla comercial. El gate `NO-GO` de `docs/product/backlog.md:362` permanece vigente para todo lo no nombrado explícitamente arriba.

Las migraciones ya aplicadas son inmutables. Ninguna decisión de este documento edita `MIGRATION_001` a `MIGRATION_006`.

## 11. Dependencias

- `DEC-011` — modelo SAS, del que esta decisión es complemento y no sustituto.
- `security-model.md` — contrato de sesión, §112-120.
- `sync-base-schema.md` — prohibición de replicar identidad central.
- `foundation-schema.md` — `Session` como `CENTRAL_ONLY`.
- `security-gates.md` — matrices de `SEC-G01`, `SEC-G02`, `SEC-G03`.
- `cash-counting-schema.md` — modelo conceptual de caja, `PHY-G07`.
- `UC-AUTH-001`, `UC-CASH-001` — casos de uso fuente.
- Emisor central de SSA y SAS: **no existe**. Sin él, ambos artefactos solo pueden ejercitarse con material de prueba.
- `LIC-003`/`DEV-003` — aprovisionamiento; siguen inexistentes y condicionan D7 y D5.

## 12. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | La SSA acaba transportando permisos y crea una segunda ruta de autorización | prohibición explícita en D1; el SAS es la única autoridad |
| R2 | La reconstrucción de `local_operation_audit` pierde filas | aserción de recuento dentro de la transacción; triggers recreados y verificados |
| R3 | Verificador de presencia derivado de la credencial central | debe ser independiente por construcción; condición 1 de D2 |
| R4 | Abrir el gate para Cash presiona para abrirlo en el resto | tres tablas nombradas; el resto sigue `NO-GO` |
| R5 | `CashRegister` sin aprovisionamiento confiable | `P-5` es bloqueante de D5 |
| R6 | Adopción parcial de D7 deja dos fuentes de contexto | fases por tipo de actor, no por módulo |
| R7 | Confundir esta ADR con autorización para implementar | §Estado; cada bloque exige autorización propia |
| R8 | Declarar `SEC-G01/G02/G03` cerrados por avanzar aquí | ningún gate cambia; se requiere evidencia ejecutable |

## 13. Decisiones explícitamente pendientes

| # | Pendiente | Bloquea |
|---|---|---|
| `P-1` | Ratificar el alcance de `sync-base-schema.md:27` respecto de material local acotado a sesión | D2 |
| `P-2` | Elegir el factor concreto de prueba de presencia | prueba de presencia |
| `P-3` | Fijar el techo máximo de `offline_valid_until` | parametrización |
| `P-4` | Autorizar la materialización de la migración de sesión | persistencia SSA |
| `P-5` | Definir el aprovisionamiento confiable de `CashRegister` | migración Cash y `CASH-001` |
| `P-6` | Autorizar la materialización de la migración Cash | `CASH-001` |
| `P-7` | Momento y alcance de la migración controlada de `config.ts` | D7 |

Ninguna de estas pendientes puede resolverse por inferencia. Cada una requiere decisión humana registrada.

## 14. Orden de implementación posterior

Sujeto a las autorizaciones de §13; este documento no lo inicia.

```
D6  documentación alineada con el contrato        (sin dependencias)
 │
D1 + D3  contrato SSA e invariantes de vigencia
 │
D4  migración de sesión y auditoría USER          (requiere P-4)
 │
D2  prueba de presencia                           (requiere P-1, P-2)
 │
D7  contexto confiable, por fases                 (requiere P-7)
 │
D5  migración Cash                                (requiere P-5, P-6)
 │
CASH-001
```

Bloques técnicos derivados, en orden: contrato SSA; verificador; store con anti-replay; prueba de presencia; resolutor de identidad en `application`. Ninguno crea DDL comercial. `CASH-001` permanece bloqueado hasta que existan el resolutor de identidad y las dos migraciones autorizadas.

`D6` se recomienda primero por ser la de menor coste y mayor riesgo latente: mientras no se fije, cualquier emisor futuro puede producir códigos que el contrato rechaza.

## 15. Qué queda decidido

Fronteras SSA/SAS; identidad exclusivamente desde artefacto firmado; el SAS como única autoridad de autorización; ubicación de `tenant_membership_id` en la SSA; invariante `SSA.offline_valid_until <= SAS.expires_at`; ausencia de grace period; condiciones que debe cumplir cualquier prueba de presencia; alcance máximo de las dos migraciones futuras; `CASH_SHIFT_OPEN` como forma canónica; y preservación íntegra de la ruta `DEVICE` de `RT-006`.

## 16. Qué queda fuera de alcance

`SEC-G01`, `SEC-G02` y `SEC-G03`; login, MFA, rotación de refresh, bloqueo y recuperación centrales; el emisor central de SSA y SAS; backend productivo y transporte HTTP; `LIC-003`/`DEV-003`; `CASH-002`, `CASH-003` y cualquier otro vertical comercial; RLS PostgreSQL y repositories tenant-aware; UI de login; y toda tabla o migración, que requieren autorización específica.

## 17. Referencias

- `docs/adr/DEC-011-authorization-projection-sas.md`
- `docs/adr/DEC-007-local-first-data-authority.md`
- `docs/adr/DEC-008-device-trust-license-activation.md`
- `docs/adr/DEC-010-pos-runtime.md`
- `docs/architecture/security-model.md`
- `docs/architecture/physical-model/sync-base-schema.md`
- `docs/architecture/physical-model/foundation-schema.md`
- `docs/architecture/physical-model/device-licensing-schema.md`
- `docs/architecture/physical-model/cash-counting-schema.md`
- `docs/security/security-gates.md`
- `docs/security/permission-matrix.md`
- `docs/use-cases/auth/UC-AUTH-001-login.md`
- `docs/use-cases/cash/UC-CASH-001-open-register.md`
- `docs/product/backlog.md`

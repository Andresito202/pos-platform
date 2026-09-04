# DEC-012 — Identidad de sesión local (Signed Session Assertion) y gobernanza de habilitación de Cash

## Estado

`PROPUESTA`, con `P-2` **RATIFICADO** el 2026-09-03 (ver §18), `P-3` **DECIDED** por derivación el 2026-09-04 (ver §19) `P-5` **DECIDED** el 2026-09-04 (ver §20 y §21) y `P-6` evaluado con resultado **`NO-GO`** el 2026-09-04 (ver §22), de cuyos cuatro bloqueos `B1` queda resuelto (ver §23) `B2` **RESUELTO** el 2026-09-04 tras decisión de negocio (ver §24 y §25) y `B3` **RESUELTO** por derivación el 2026-09-04 (ver §26) y `B4` **RESUELTO** por derivación el 2026-09-04 (ver §27). Con los cuatro bloqueos resueltos, la condición de reevaluación de §22.4 queda satisfecha; el gate sigue **`NO-GO`** hasta que esa reevaluación se realice y se resuelvan las dependencias de §22.2.

El cuerpo de este documento se conserva exactamente como fue redactado. La ratificación de `P-2` —prueba de presencia local— se registra de forma **aditiva** en §18, sin reescribir ninguna decisión anterior ni eliminar trazabilidad. El resto de pendientes de §13 continúa abierto, y la ratificación de `P-2` **no autoriza implementar** SSA-004, presencia, login ni Cash: fija la política que esa implementación deberá respetar cuando sea autorizada por separado.

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

> **Superado parcialmente por §18.** La ratificación de `P-2` fija el factor (PIN de 6 dígitos, §18.2) y **corrige la condición 3**: lo que se destruye al expirar la SSA es el material de *sesión y presencia*, **no el verifier enrolado**, que permanece (§18.9). Exigir re-enrolamiento tras cada expiración era operativamente inviable en caja. Las condiciones 1, 2, 4 y 5 se mantienen íntegras. El texto original se conserva para preservar la trazabilidad de la decisión.

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

**Actualización posterior.** `P-2` queda `RATIFICADO` (§18) y `P-3` queda `DECIDED` por derivación (§19). Esa ratificación resuelve además la mitad abierta de `P-1`, al fijar que el material de presencia se genera localmente, se acota a la sesión y nunca es utilizable contra la autoridad central —la categoría que `P2-A` identificó como no cubierta por las reglas existentes—. `P-4` quedó materializado por `MIGRATION_007` bajo autorización explícita posterior. `P-5` queda `DECIDED`: su estructura en §20 y su única decisión abierta —la caducidad de la proyección— resuelta en §21. `P-6` fue evaluado y resultó `NO-GO` (§22); `P-7` **continúa abierto** y ninguno se ve alterado por §18, §19 ni §20.

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

## 18. Ratificación de `P-2` — prueba de presencia local

Ratificado por el propietario del sistema el 2026-09-03, sobre los análisis `P2-A` (revisión de infraestructura y amenazas), `P2-B` (cuantificación) y `P2-C` (cierre de pendientes).

Esta sección es **aditiva**: no modifica ninguna decisión de §3 a §17. Fija la política que la implementación futura deberá respetar; **no la autoriza**.

### 18.1 T2 — administrador local

**ACEPTADO como riesgo residual `HIGH`.**

Se acepta que un administrador con control completo del terminal puede extraer o manipular el material local, y que una prueba de presencia basada exclusivamente en software no puede impedirlo por completo. **No se promete resistencia frente a un administrador local comprometido.** El control efectivo frente a este escenario es organizativo: restringir quién posee privilegio administrativo sobre los terminales.

Windows Hello y TPM quedan registrados como evolución futura, condicionada a la matriz de hardware de `DEC-009:230`, y **no forman parte de esta política**.

### 18.2 Factor del cajero

PIN numérico de **6 dígitos**. Un PIN de 4 dígitos queda descartado: bajo la política de intentos y enfriamiento ratificada, su espacio se agota en un plazo inaceptable.

Propiedades obligatorias de la implementación futura:

- generado mediante CSPRNG, no elegido por el usuario en la ruta por defecto;
- individual por usuario — **el factor compartido está prohibido**;
- nunca almacenado en claro, en ningún soporte;
- almacenado únicamente como verifier derivado;
- KDF: `scrypt` (§18.11);
- nunca registrado en auditoría, logs, mensajes de error ni volcados.

### 18.3 Factor del supervisor — modelo S1

Mismo formato que el cajero: PIN numérico de 6 dígitos.

- Contador de intentos **independiente por usuario**.
- Un intento fallido de desbloqueo afecta exclusivamente al contador del **supervisor**.
- No se comparte contador entre cajero y supervisor.

Se acepta que un actor puede provocar un bloqueo temporal acotado de otro usuario. El vector queda limitado por la expiración automática del lockout.

### 18.4 Intentos

Máximo **5**.

### 18.5 Backoff

| Fallo | Retardo |
|---|---|
| 1 | 0 s |
| 2 | 0 s |
| 3 | 5 s |
| 4 | 15 s |
| 5 | `LOCKOUT` |

Los dos primeros fallos sin retardo reconocen que el error de tecleo es la causa mayoritaria real en caja; el límite de tasa lo impone el lockout, no el retardo.

### 18.6 Lockout

Tras 5 fallos:

- duración **15 minutos**;
- recuperación **automática** al expirar el período;
- recuperación **anticipada** únicamente mediante supervisor autorizado con presencia;
- **no existe auto-desbloqueo** por parte del usuario bloqueado ni desbloqueo administrativo local.

Requisitos de persistencia, exigidos por esta ratificación:

- el lockout y sus contadores **deben persistir**;
- **nunca** dependerán exclusivamente de la memoria del proceso;
- **nunca** usarán `setTimeout` como autoridad temporal;
- la expiración se evaluará mediante `TrustedClockGuard`.

El lockout y sus contadores deben sobrevivir al reinicio del proceso y del equipo.

### 18.7 Presencia — modelo P-D híbrido

| Límite | Valor |
|---|---|
| Inactividad | **10 minutos** |
| Ventana máxima | **2 horas** |

La presencia se invalida además por: cambio de operador · logout o cierre de sesión · cambio o reemplazo de SSA · expiración de SSA · lockout correspondiente · cualquier otra invalidación definida por la política versionada.

### 18.8 Operaciones sensibles

Requieren re-presencia, con independencia de las ventanas de §18.7:

`cash.shift.open` · `cash.shift.close` · `cash.expense.register` · `cash.count.*` · `cash.difference.review`

`cash.count.read` queda **fuera** de re-presencia por no producir efecto financiero.

**No se crean todavía** permisos ni casos de uso para *refund*, *void*, *price override*, *discount override*, *inventory adjustment* ni *high-value transaction*. Su incorporación exigirá política versionada y autorización formal.

La política de sensibilidad es **versionada**, no una lista fija en código: su versión debe quedar registrada en cada decisión para que una comprobación de presencia sea reproducible a posteriori.

### 18.9 Ciclo de vida del verifier

**La expiración de una SSA NO destruye el verifier del usuario.** El verifier permanece enrolado.

Lo que expira con la SSA es el material de sesión y presencia asociado a esa SSA. Una nueva SSA deberá volver a establecer presencia según las reglas de §18.7, **sin re-enrolamiento** del cajero.

### 18.10 Rollback

`PREVENTION = NO` · `DETECTION = BEST EFFORT`.

No se promete protección frente a un administrador con control completo del sistema de archivos. Se aprovecharán, cuando corresponda: la integridad autenticada del envelope · `TrustedClockGuard` · la consistencia entre base de datos y envelope · la auditoría append-only · la detección de secuencias incompatibles.

**No se diseñarán mecanismos ficticios de anti-rollback.**

### 18.11 scrypt — parámetros provisionales

| Parámetro | Valor |
|---|---|
| `N` | 32768 |
| `r` | 8 |
| `p` | 1 |
| `maxmem` | 64 MiB (67 108 864) |

`maxmem` debe fijarse **explícitamente**: Node exige un margen por encima de `128·N·r`, y omitirlo hace fallar estos parámetros en tiempo de ejecución.

**Estos parámetros NO están validados para producción.** Su estado es:

> `PROVISIONAL — REQUIRES REAL HARDWARE BENCHMARK`

Criterio de aceptación: **`p95 <= 250 ms`**.

El benchmark deberá ejecutarse sobre (1) el terminal POS de menor capacidad soportada y (2) un terminal representativo. **No se ejecutará ni se inventará benchmark alguno mientras el hardware real no esté disponible.**

**Este benchmark es precondición de la implementación definitiva de SSA-004 y de la presencia.** No es precondición de esta ratificación.

### 18.12 Qué NO cambia por esta ratificación

`SEC-G01`, `SEC-G02` y `SEC-G03` permanecen `PLANNED / NOT_EVALUATED`. No se declara autenticación ni autorización completas, ni producción lista. SSA-004, la presencia, el login y Cash siguen sin implementar y sin autorizar. `P-3`, `P-5`, `P-6` y `P-7` de §13 continúan abiertos.

## 19. Resolución de `P-3` — techo de `offline_valid_until`

Resuelto el 2026-09-04 **por derivación de evidencia normativa existente**, no por elección de un valor nuevo. Sección aditiva: no modifica §D3, cuyos tres invariantes se conservan y se completan aquí con su magnitud.

### 19.1 Evidencia determinante

`DEC-011` está **Aceptada como diseño**, decidida por el propietario del sistema el 2026-09-03 (`DEC-011:5-7`), y fija:

- `DEC-011:104` — «**TTL inicial: 24 horas.** Es una política configurable de despliegue, no una constante de negocio: no se codifica en `packages/domain`.»
- `DEC-011:196`, bajo «Qué queda configurable» — «El TTL, con valor inicial de 24 horas, expresado como política de despliegue.»
- `DEC-011:112` — «La ventana offline máxima y la ventana de exposición a revocación son la misma magnitud.»

Ese TTL gobierna `SAS.expires_at`. Combinado con el invariante 1 de §D3 —`SSA.offline_valid_until <= SAS.expires_at`—, el techo de la SSA queda determinado sin introducir ningún número nuevo.

### 19.2 Decisión

**El techo de `offline_valid_until` no es una constante independiente: es la ventana del SAS.**

```
SSA.offline_valid_until  <=  SAS.expires_at  <=  TTL de despliegue vigente
```

El TTL de despliegue vigente es **24 horas**, por `DEC-011:104`. Ése es, por tanto, el techo efectivo actual de la SSA. Si una política de despliegue posterior modifica el TTL del SAS —cosa que `DEC-011:196` autoriza expresamente—, el techo de la SSA lo sigue automáticamente, sin necesidad de revisar esta decisión.

Estado: **`DECIDED`**. Carácter: **política de despliegue configurable y versionada**, con el mismo régimen que `DEC-011` da al TTL del SAS. No se codifica como constante en `packages/domain`.

### 19.3 Autoridad

| Aspecto | Autoridad |
|---|---|
| Valor emitido en cada SSA | **Autoridad central**, dentro de los claims firmados |
| Techo máximo admisible | **Política de despliegue versionada**, derivada del TTL del SAS |
| Verificación de la ventana | Cliente local: `SessionAssertionVerifier` (SSA-002) |
| Verificación del invariante `SSA <= SAS` | **Sin punto de aplicación hoy** — ver §19.5 |

El cliente **rechaza** una SSA cuya ventana exceda el techo aunque su firma sea válida: es defensa en profundidad frente a un emisor mal configurado, no desconfianza del emisor.

### 19.4 Ventana efectiva real

La ventana efectiva no es exactamente el TTL. `TrustedClockGuard` acepta un retroceso de reloj dentro de su tolerancia, hoy `300_000 ms` (`trusted-clock.ts:3`), de modo que una SSA recién expirada puede volver a considerarse vigente durante ese margen.

```
ventana efectiva  =  TTL  +  tolerancia de retroceso  =  24 h + 5 min
```

Se registra como **residual conocido y acotado**, no como defecto. Reducirlo exigiría endurecer la tolerancia del reloj, que es una decisión propia y no forma parte de `P-3`.

### 19.5 Invariante `SSA <= SAS`: documentado, no aplicado

**Hallazgo.** El invariante 1 de §D3 no está aplicado en ningún punto del código. `SessionAssertionVerifier` no importa ni conoce el snapshot de autorización, y ningún componente evalúa hoy ambas vigencias a la vez.

En consecuencia, el estado «SSA vigente con SAS expirado» —que el invariante existe para hacer inexpresable— es hoy alcanzable si el emisor emite una SSA más larga que el SAS.

**Requisito para el bloque que introduzca el resolutor de identidad:** ese componente, que será el primero en sostener ambos artefactos a la vez, debe aplicar el invariante y denegar cuando no se cumpla. No se aplica en SSA-002 ni en SSA-003 porque ninguno de los dos ve el otro artefacto, y darles esa visibilidad rompería la separación entre identidad y autorización que `D1` establece.

### 19.6 Relación con la presencia

Las ventanas de presencia ratificadas en §18.7 —inactividad de 10 minutos y ventana máxima de 2 horas— quedan holgadamente contenidas en el techo de 24 horas. La cadena de vigencia efectiva es:

```
presence_valid_until  <=  SSA.offline_valid_until  <=  SAS.expires_at
```

**La presencia nunca amplía la ventana de confianza**; sólo puede estrecharla.

### 19.7 Qué no constituye evidencia

Los fixtures de los tests de SSA y SAS emplean ventanas de 24 horas (`2026-09-03T00:00:00Z` → `2026-09-04T00:00:00Z`). **Coinciden con el TTL normativo, pero no son su fuente**: se eligieron por legibilidad aritmética y ningún test afirma un techo. La fuente normativa es exclusivamente `DEC-011:104`. Ningún fixture debe elevarse a política.

## 20. Resolución de `P-5` — aprovisionamiento de `CashRegister`

Resuelto el 2026-09-04. Sección aditiva: no modifica §D5 ni ninguna decisión anterior. **Estado `PROVISIONAL`**: siete de los ocho puntos exigidos quedan determinados por evidencia existente; el octavo —la ventana de exposición a revocación— carece de fuente normativa y se marca como decisión humana.

### 20.1 Modelo

`cash-counting-schema.md:36-44` define `cash.cash_registers` / `cash_cash_registers` con columnas lógicas `id`, `tenant_id`, `company_id`, `branch_id`, `code`, `code_normalized`, `name`, `currency_code`, `status`, `created_at`, `retired_at NULL`, `version`, y constraints: FK compuesta a Branch, `UNIQUE (tenant_id, company_id, branch_id, code_normalized)`, estados `ACTIVE`/`RETIRED`, moneda ISO 4217 inmutable mientras existan turnos asociados, y sin delete en cascada sobre historia financiera.

Tres observaciones que gobiernan el resto de la decisión:

- **No existe `device_id` ni `installation_id` en el registro.** El ámbito es tenant/company/branch.
- **No existe `updated_at`.** El marcador de cambio es `version`.
- `retired_at` y `status` son el vector de baja; no hay borrado.

### 20.2 Autoridad central

`physical-conventions.md:76` clasifica `CENTRAL_MASTER_REPLICATED` como «PostgreSQL: sí · SQLite: proyección/versiones necesarias · **central; local no publica cambios no autorizados**», y `cash-counting-schema.md:24` lo concreta: «central; el POS consume versión autorizada».

| Operación | Autoridad |
|---|---|
| Crear, modificar, retirar, asignar a sucursal | **Central, en exclusiva** |
| Consumir la proyección | POS Local Service |
| Publicar cambios al maestro | **Nadie desde el POS** |

### 20.3 Fuente de verdad

| Central (exclusivo) | Local (proyección de sólo lectura) |
|---|---|
| Identidad del registro (`id`) | Copia verificada de la versión aceptada |
| Ámbito (`tenant`, `company`, `branch`) | — |
| Estado (`ACTIVE`/`RETIRED`) | — |
| Configuración maestra (`code`, `name`, `currency_code`) | — |
| `version` | — |

**El POS no posee estado operacional alguno *sobre el registro*.** El estado operacional vive en agregados distintos —`CashShift`, `CashMovement`, `CashCount`—, clasificados `LOCAL_AUTHORITATIVE_SYNCED` (`cash-counting-schema.md:25`). Una operación local de caja **nunca** modifica el registro maestro.

### 20.4 Mecanismo de aprovisionamiento

| Alternativa | Valoración |
|---|---|
| **A — Snapshot maestro firmado** | Compatible con el patrón ya documentado para Catalog y con la maquinaria de licencia/SAS/SSA. Ofrece firma, versionado, reemplazo atómico y verificación offline |
| **B — Sync/inbox existente** | **Descartada por evidencia.** `local_sync_inbox` transporta *resultados de operaciones* (`operation_id`, `result_json`, `server_status`), no datos maestros. Reutilizarlo exigiría desnaturalizarlo |
| **C — Autoridad → snapshot firmado → transporte → validación → proyección SQLite** | Es A con su cadena completa explicitada. **Seleccionada** |

**Decisión: C.** El patrón no se inventa aquí; ya está escrito para la misma clase de dato:

- `catalog-schema.md:243` — «POS Local Service **reemplaza snapshots por versión aceptada dentro de una transacción; no crea ni fusiona maestros**.»
- `catalog-schema.md:276` — «SQLite aplica **snapshot completo** de catálogo **atómicamente**.»
- `device-licensing-schema.md:324` — «Los payloads firmados se **reemplazan atómicamente por secuencia/version superior verificada**; nunca por timestamp de llegada ni last-write-wins.»

La proyección es de **snapshot completo por ámbito**, no incremental por fila: es lo que permite que una baja se propague por ausencia y no exija un evento de borrado.

**Lo que no existe:** el emisor central y el transporte. Es el mismo hueco que ya bloquea SSA y SAS, no uno nuevo, y no se resuelve en este bloque.

### 20.5 Trust boundary

Antes de aceptar una proyección de cajas, el POS debe probar:

| Prueba | Fuente |
|---|---|
| Firma Ed25519 válida sobre `canonicalJson(claims)` | Misma maquinaria que licencia, SAS y SSA |
| `key_id` resuelto contra el trust store, no `REVOKED` | `TrustedSigningKey` |
| `tenant_id` / `company_id` / `branch_id` del ámbito esperado | Modelo del registro |
| `sequence` estrictamente mayor que la aceptada para ese ámbito | Anti-replay |
| `issued_at` coherente con `TrustedClockGuard` | Reloj |
| Integridad de la fila almacenada | Checksum, patrón de SAS-002/SSA-003 |

**Separación que no debe perderse:** un `CashRegister` correctamente aprovisionado **no implica** que ningún usuario pueda operar sobre él. `DEC-011:88` lo fija: «Una caja es un recurso operativo, no un sujeto de autorización; el permiso se evalúa sobre `branch_id`». El maestro dice *qué cajas existen*; el SAS dice *quién puede operar en esa sucursal*.

### 20.6 Binding — opción A, ligado exclusivamente a sucursal

**Evidencia, no intuición:**

1. `cash_cash_registers` **no tiene** `device_id` ni `installation_id`.
2. `DEC-011:88` excluye deliberadamente `cash_register_id` del SAS, porque la caja no es sujeto de autorización.
3. El vínculo con el dispositivo existe, pero **en el turno, no en la caja**: `cash_cash_shifts` incluye `origin_device_id` (`cash-counting-schema.md:48`), y la unicidad de turno incompatible se expresa «por tenant, sucursal, caja y dispositivo» (`:59`).

Por tanto la caja se proyecta por sucursal, y la relación con un terminal concreto es una propiedad del turno.

**Cuestión adyacente, fuera de `P-5`:** si dos terminales pueden sostener turnos simultáneos sobre la misma caja es una regla de negocio de `UC-CASH-001`, no del aprovisionamiento. Corresponde a `P-6`.

### 20.7 Sequence / version

Dos contadores distintos que no deben confundirse:

| Contador | Ámbito | Propósito |
|---|---|---|
| `version` de cada registro | Fila del maestro | Concurrencia optimista en el lado **central** |
| `sequence` del snapshot | Proyección completa de un ámbito | **Anti-replay local** |

Regla de aceptación local, idéntica a SAS-002 y SSA-003: **estrictamente mayor**. Una secuencia igual es un reenvío; una menor, un replay; ninguna desplaza a la proyección activa. Nunca last-write-wins ni precedencia por timestamp. La secuencia persiste y sobrevive al reinicio, y una proyección obsoleta sigue fijando la cota anti-replay.

No se introduce ninguna abstracción criptográfica nueva.

### 20.8 Revocación — punto abierto

Propagación: una baja central se refleja emitiendo un snapshot posterior con `sequence` mayor en el que la caja aparece `RETIRED` o ausente. **No existe revocación instantánea offline**, y no se inventa ninguna.

Propagación por snapshot posterior; **la caducidad de la proyección se resuelve en §21**.

### 20.9 Atomicidad

`VERIFY → VALIDATE → WRITE → ACTIVATE` dentro de una única frontera transaccional, conforme a `catalog-schema.md:243` y `:276`.

Un snapshot inválido —firma, clave, ámbito, secuencia o integridad— **no destruye la proyección válida anterior**: se rechaza antes de escribir. Es la misma propiedad ya probada en SAS-002 y SSA-003.

### 20.10 Qué NO decide esta sección

No autoriza DDL, migración ni tabla alguna: `P-6` sigue abierto y el gate comercial sigue `NO-GO`. No implementa `CASH-001` ni ninguna operación de caja. No crea contrato, código ni transporte. No resuelve el emisor central. No altera `SSA-*`, `SAS-*` ni ninguna decisión previa de este documento.

## 21. Resolución de `P-5.8` — caducidad de la proyección de `CashRegister`

Resuelto el 2026-09-04. Cierra el único punto que dejaba `P-5` en estado `PROVISIONAL`. Sección aditiva; §20 se conserva y su §20.8 remite aquí.

### 21.1 Decisión

**Opción A — sin caducidad por tiempo.**

Una proyección de `CashRegister` aceptada permanece válida localmente hasta que un snapshot posterior, con secuencia estrictamente mayor, la sustituya, la marque `RETIRED` o la omita. **No se introduce ninguna ventana de frescura ni TTL.**

El riesgo de operar sobre una caja retirada mientras el POS está offline **se acepta explícitamente** como consecuencia del modelo local-first, y se resuelve por reconciliación posterior, no por bloqueo previo.

Estado: **`DECIDED`**.

### 21.2 Evidencia determinante

**1. `DEC-007` ya decidió que la caja opera offline y cuál es su conflicto esperado.** Su «Matriz inicial de autoridad por dominio» registra:

| Dominio | Operación offline | Conflicto esperado |
|---|---|---|
| Caja | **Permitida** | **Sesión cerrada o versión inconsistente** |
| Catálogo | Lectura local; cambios restringidos | **Versión desactualizada** |

Una «versión desactualizada» está tipificada como **conflicto a reconciliar**, no como condición que impida operar. Introducir un TTL convertiría un conflicto previsto y gestionado en una interrupción del servicio, contradiciendo una decisión ya tomada.

**2. El modelo asigna la expirabilidad entidad por entidad, y no se la da a los maestros.** En la tabla de `sync-base-schema.md:65-78`, la columna de ciclo de vida dice:

- `OfflineAuthorizationSnapshot` — «firmado, **expirable** y reemplazable»
- `GraceAuthorization` — «append-only, **vigencia explícita**»
- `FeatureEntitlement` — «versión emitida»
- `LicenseActivation` — «reemplazo crea otra fila»
- `DeviceActivationResponse` — «append-only, aplicación idempotente»

**`expirable` aparece únicamente en el snapshot de autorización.** Ningún maestro replicado la lleva. La caducidad no es una propiedad genérica de lo replicado: es un atributo que el modelo concede a la autorización y a la gracia porque conceden privilegio.

**3. Existe mecanismo de reconciliación y está definido.** `cash-counting-schema.md:26`: «No se utiliza last-write-wins. **Un conflicto central produce revisión, operación tardía o compensación**; nunca reescribe un movimiento, conteo o cierre confirmado.» El componente resolutor es `SyncConflict` → `SyncReview` (`sync-base-schema.md:76-77`: «resolución versionada, historia preservada», «revisor central autorizado»).

### 21.3 Por qué el TTL del SAS no se extiende al maestro

`DEC-011:104` fija 24 h para el SAS **porque el SAS concede privilegio**: `DEC-011:112` establece que su ventana offline y su ventana de exposición a revocación son la misma magnitud, y por eso su TTL «es una decisión de seguridad y no de conveniencia».

`CashRegister` **no concede privilegio**. `DEC-011:88` lo excluye deliberadamente del SAS: «Una caja es un recurso operativo, no un sujeto de autorización; el permiso se evalúa sobre `branch_id`». Un maestro obsoleto no amplía lo que un usuario puede hacer; a lo sumo permite referirse a un recurso que dejó de existir centralmente.

Igualar ambas ventanas por simetría sería un argumento de consistencia sin sustancia, y el propio repositorio rechaza ese razonamiento al tratar cada entidad por su naturaleza y no por su clase de transporte.

### 21.4 Qué reduce y qué no reduce un TTL

Un TTL **no informa** al POS de que una caja fue retirada: sólo lo detiene transcurrido un plazo, con independencia de que haya ocurrido alguna baja. Por tanto:

| | Con TTL | Sin TTL |
|---|---|---|
| Exposición dentro de la ventana | **Presente igualmente** | Presente |
| Exposición fuera de la ventana | Eliminada, deteniendo la caja | Presente, reconciliable |
| Disponibilidad offline | **Pérdida cierta** al vencer | Íntegra |
| Naturaleza del fallo | Interrupción segura pero garantizada | Conflicto raro y corregible |

El TTL cambia un riesgo *raro y reconciliable* por una indisponibilidad *cierta y periódica*. En un punto de venta, la caja detenida es un fallo de negocio inmediato; el turno abierto sobre una caja retirada es una anomalía contable corregible.

**Ninguna política local elimina la ventana de revocación offline.** Sólo la conectividad lo hace. Eso ya está aceptado en `DEC-011:112` para la autorización, con mayor motivo aquí.

### 21.5 Comportamiento offline

Idéntico a 24 h, 48 h, 7 días o un período prolongado: la proyección sigue siendo válida y la caja opera. La propiedad local-first de `ADR-003` se conserva sin degradación por antigüedad.

Al recuperar conectividad se aplica el snapshot posterior, que puede retirar cajas y desencadenar la reconciliación de las operaciones afectadas.

### 21.6 Auditoría — requisito derivado

Sin TTL, la trazabilidad exige registrar **con qué versión de la proyección se operó**. Es la aplicación directa del principio ya establecido en `DEC-011:116` para la autorización: «toda operación se audita con el `snapshot_id` y la `sequence` utilizados… Una operación ejecutada offline bajo una autorización luego revocada no puede deshacerse, pero sí detectarse. Es un requisito de auditoría, no de prevención».

**Requisito para `P-6`:** una operación de caja debe registrar la secuencia de la proyección de `CashRegister` vigente en su momento. El modelo actual de `cash_cash_shifts` no contempla ese campo; incorporarlo corresponde al bloque que autorice el DDL, no a esta decisión.

### 21.7 Opciones descartadas

**B — caducidad independiente.** Contradice `DEC-007`, que registra la operación de caja offline como «Permitida», y convierte un conflicto previsto en indisponibilidad. Sin fuente normativa que la respalde.

**C — política condicional (frescura extra para operaciones financieras).** Sin evidencia. La matriz de `DEC-007` gradúa las políticas por dominio —«Parcialmente permitida» para Devoluciones, «Uso de versión sincronizada» para Pricing— y para Caja dice «Permitida», sin condición de frescura. Adoptar C sería introducir una gradación que el documento no establece.

### 21.8 Riesgo aceptado

Una caja retirada centralmente puede sostener un turno abierto mientras el POS permanezca offline, sin límite temporal. La anomalía se detecta al reconectar y se resuelve mediante revisión, operación tardía o compensación, sin reescribir hechos confirmados.

**Se acepta expresamente**, con el mismo criterio con que `DEC-011:112` acepta que una autorización revocada siga siendo válida hasta `expires_at` mientras el dispositivo esté offline.

## 22. Evaluación de `P-6` — gate DDL de Cash

Evaluado el 2026-09-04. **Resultado: `NO-GO — PENDING DECISION`.** El gate no se abre.

El modelo físico de Cash está **notablemente cerrado** —estados, cardinalidades, idempotencia, secuencias, inmutabilidad y frontera transaccional están especificados—, pero subsisten **cuatro ambigüedades estructurales** que cambian el DDL según cómo se resuelvan. `D5` de este documento sigue siendo una autorización conceptual, no una autorización de migración.

### 22.1 Bloqueos estructurales

**B1 — Base inicial cero: contradicción normativa entre dos documentos.** — **RESUELTO en §23** (2026-09-04).


- `UC-CASH-001:29` — «El sistema valida que el valor sea **no negativo**» ⇒ cero admitido.
- `cash-counting-schema.md:105` — «**`amount > 0`**», sin excepción por tipo de movimiento.
- `cash-counting-schema.md:58` y `:225` — toda apertura crea exactamente un `OPENING_FLOAT` `POSTED` con `shift_sequence=1`, y la base inicial se deriva de ese hecho.

Abrir una caja sin base inicial es una operación de negocio corriente, pero hoy **no es representable**: exigiría un movimiento de importe cero que el CHECK prohíbe. La resolución determina el CHECK del DDL y no puede inferirse.

**B2 — «Turno incompatible» se usa sin definirse.** — **RESUELTO en §25** (2026-09-04).

El calificativo aparece en `cash-counting-schema.md:59, 66, 142, 222, 242, 289, 293` y en `UC-CASH-001:13, 27, 38, 40`, siempre sin definición. La clave del índice parcial único queda indeterminada:

- `(tenant_id, branch_id, cash_register_id)` — un solo turno por caja, cualquiera sea el terminal; o
- `(tenant_id, branch_id, cash_register_id, origin_device_id)` — un turno por terminal, permitiendo que dos terminales sostengan turnos simultáneos sobre el mismo cajón físico.

`cash-counting-schema.md:289` contempla además que «múltiples aperturas incompatibles… se llevan a revisión/cuarentena», lo que sugiere que la restricción podría no ser universalmente preventiva. Las dos lecturas producen DDL distinto y semántica financiera distinta.

**B3 — Escala decimal de `amount` ausente de la matriz normativa.** — **RESUELTO en §26** (2026-09-04).

`physical-conventions.md:137-146` fija escala para `unit_price`, base, impuesto y descuento; Payment, Refund y Reversal; componentes de Settlement; tasas y porcentajes; factores de conversión; cantidad y peso; importe fiscal normalizado; y `payable_amount`. **No fija escala para el importe de un movimiento de caja.** Adoptar `(19,6)` por analogía con Payment sería inferencia, no evidencia.

**B4 — La `sequence` de la proyección de `CashRegister` no tiene ubicación.** — **RESUELTO en §27** (2026-09-04).

§21.6 estableció que una operación de caja debe registrar con qué versión de la proyección se operó. `cash_cash_shifts` (`cash-counting-schema.md:48`) no contiene esa columna. Las tres ubicaciones posibles —columna directa en el turno, metadato de snapshot separado, o referencia indirecta— no están decididas y afectan al DDL.

### 22.2 Dependencias, no bloqueos del modelo

- **RLS y motor de destino.** `cash-counting-schema.md` no especifica políticas RLS para las tres tablas, y `D5` no declara si la primera migración de Cash es local (SQLite) o central (PostgreSQL). Si es local, RLS no aplica; si es central, sus políticas dependen del contexto confiable de `P-7`, todavía abierto.
- **Actor.** `opened_by_actor_type` / `opened_by_actor_id` no pueden resolverse contra ninguna proyección local de usuario: no existe, y `sync-base-schema.md:27` prohíbe replicar `User`. **No se creará una tabla `User` local para satisfacer el DDL**; la identidad procede de la SSA verificada.

### 22.3 Qué sí está cerrado

Se registra para no repetir su análisis cuando se reevalúe el gate: tipos y estados de movimiento; `UNIQUE (tenant_id, cash_shift_id, shift_sequence)`; `UNIQUE (tenant_id, origin_device_id, idempotency_key)`; dirección `IN`/`OUT` en lugar de signo ambiguo; moneda coherente entre movimiento, turno y caja, e inmutable mientras existan turnos; sólo `POSTED` participa en `ExpectedCash`; un `POSTED` no se edita ni elimina y la corrección exige movimiento compensatorio; secuencia de apertura en 1; estados `OPEN → CLOSING → CLOSED`; `expected_version` por mutación; claves y checksums de idempotencia independientes para apertura y cierre; frontera transaccional de apertura enumerada paso a paso; y ausencia de delete en cascada sobre historia financiera.

### 22.4 Condición de reevaluación

`P-6` podrá reevaluarse cuando `B1`, `B2`, `B3` y `B4` estén resueltos por decisión registrada. Ninguno admite resolución por inferencia. Hasta entonces el gate de DDL comercial permanece `NO-GO` conforme a `docs/product/backlog.md:362`, y no se crea migración alguna de Cash.

## 23. Resolución de `B1` — base inicial cero

Resuelto el 2026-09-04. Cierra el primero de los cuatro bloqueos de §22. **`B2`, `B3` y `B4` no se tocan.**

### 23.1 Decisión

**Cero válido.** La regla canónica es:

```
initial_float >= 0
```

Una apertura de turno con base inicial cero es válida. `OPENING_FLOAT` admite `amount >= 0`; **todo movimiento de otro tipo conserva `amount > 0`**.

### 23.2 Evidencia

**1. Jerarquía documental.** `cash-counting-schema.md:7` declara: «Este documento **materializa conceptualmente** `UC-CASH-001`, `UC-CASH-002`, `UC-CASH-003`, `DEC-002` y `DEC-007`.» El modelo físico **deriva** del caso de uso. Ante una contradicción sobre una regla de negocio, la autoridad es el caso de uso y el error está en el modelo físico.

**2. El caso de uso es inequívoco.** `UC-CASH-001:29` — «El sistema valida que el valor sea **no negativo**». Sus «Pruebas mínimas» exigen probar «**base negativa**», y **no** enumeran una prueba de rechazo de base cero. La regla es: rechazar negativo, admitir cero.

**3. El fundamento declarado de `amount > 0` no alcanza al cero.** La restricción se enuncia como «`amount > 0`; el efecto usa `IN`/`OUT`, **nunca signo ambiguo**». Su propósito es impedir que el importe codifique dirección mediante signo. Cero no tiene signo ambiguo: la restricción sobrepasaba su propia justificación.

**4. El cero es un valor monetario representable.** `physical-conventions.md:169` rechaza «exponente, coma, whitespace, `NaN`, infinito ni **cero negativo**» —no el cero— y `:171` prescribe que «`0` se representa con una sola cifra entera». El modelo decimal contempla el cero explícitamente.

**5. Negocio.** Abrir una caja sin efectivo inicial es una operación corriente. `OPENING_FLOAT` no transfiere valor: **declara** la base del turno, y esa declaración puede ser cero.

### 23.3 Alcance de la excepción

La excepción es **exclusiva de `OPENING_FLOAT`**. No existe evidencia que autorice importe cero en ningún otro tipo, y un movimiento general de importe cero —una venta de 0, un gasto de 0— carece de significado financiero.

Queda expresamente **fuera** de esta decisión, y por tanto prohibido mientras no exista evidencia propia: `IN` de cero, `OUT` de cero, ajustes de cero, gastos de cero y cualquier otro tipo con importe cero.

### 23.4 Invariantes preservados

Ninguno se altera. Con base cero sigue existiendo **exactamente un** `OPENING_FLOAT` `POSTED` con `shift_sequence = 1`; `ExpectedCash` sigue siendo un fold determinista al que ese movimiento aporta cero; la base inicial sigue derivándose del movimiento y no de un saldo mutable duplicado; el historial permanece inmutable; y la idempotencia y el aislamiento tenant no dependen del importe.

### 23.5 Documento corregido

Se corrige **únicamente la fuente inconsistente**: `cash-counting-schema.md:105`. `UC-CASH-001` es correcto tal como está y **no se modifica**.

### 23.6 Consecuencia para el DDL futuro

El CHECK general de importe deja de ser incondicional y pasa a estar condicionado por tipo: positivo estricto para todo tipo distinto de `OPENING_FLOAT`, y no negativo para `OPENING_FLOAT`. La prohibición de importes ambiguos se preserva porque la dirección sigue expresada por `IN`/`OUT` y el cero no admite lectura de signo.

**No se escribe SQL aquí, y `B1` resuelto no reabre el gate:** §22 permanece `NO-GO` mientras `B2`, `B3` y `B4` sigan abiertos.

## 24. Análisis de `B2` — «turno incompatible»

Analizado el 2026-09-04. **Resultado: `PENDING HUMAN DECISION`.** No se decide, porque las fuentes normativas se contradicen entre sí y la resolución depende de un hecho de negocio que ningún documento establece. `B1` (§23) permanece intacto; `B3`, `B4` y RLS no se tocan.

Este análisis **acota** el bloqueo: `B2` deja de ser «un término sin definir» y pasa a ser **una única pregunta de negocio**.

### 24.1 La pregunta que falta

> **¿Una misma caja física puede ser operada simultáneamente desde más de un terminal?**

Las dos opciones **sólo divergen en esa configuración**. Si cada terminal tiene su propio cajón, cada cajón es una `CashRegister` distinta y ambas reglas se comportan igual. La divergencia aparece únicamente cuando **un cajón físico es compartido por dos terminales**.

- **Si la respuesta es no** → opción **A**: unicidad por `(tenant, sucursal, caja)`.
- **Si la respuesta es sí** → opción **B**: unicidad por `(tenant, sucursal, caja, dispositivo)`.

Es un hecho de despliegue y de operación del comercio, no una propiedad derivable de la arquitectura.

### 24.2 Contradicción interna en `UC-CASH-001`

El caso de uso —fuente de máxima prioridad— se contradice consigo mismo:

| Sección | Texto | Implica |
|---|---|---|
| Flujo principal, paso 3 | «El sistema verifica que **la caja** no tenga un turno abierto incompatible» | Ámbito de **caja** |
| Excepciones | «**Caja abierta por otro usuario**», sin calificar el terminal | Ámbito de **caja** |
| Precondiciones | «**Caja física** activa» | La caja es un cajón físico |
| Pruebas mínimas | «**segunda apertura**», sin calificar el dispositivo, y separada de «dispositivo ajeno» | Ámbito de **caja** |
| **Frontera transaccional** | «restricción que impida más de un turno abierto incompatible **por tenant, sucursal, caja y terminal**» | Ámbito de **caja + terminal** |

No existe lectura en la que ambas afirmaciones sean simultáneamente correctas: añadir el terminal a la clave **debilita** la unicidad. Una de las dos es un error de redacción, y el documento no permite determinar cuál.

### 24.3 Evidencia técnica, que inclina pero no zanja

Tres observaciones respaldan la opción **A**, sin sustituir la decisión de negocio:

1. **`origin_device_id` es procedencia e idempotencia, nunca propiedad.** Aparece en `CashShift`, `CashMovement`, `CashCount` y `CashDifferenceReviewAction`, y en todos los casos su función documentada es la misma: segundo componente de la clave de idempotencia —`UNIQUE (tenant_id, origin_device_id, idempotency_key)` (`cash-counting-schema.md:108, 159, 160, 214`)—. En ningún punto expresa exclusividad ni titularidad.

2. **El turno no pertenece al terminal que lo abrió.** `UC-CASH-002` exige como precondición «El usuario tiene **acceso al turno**», no que sea el mismo dispositivo, y su entrada es `cash_shift_id`. Un turno se cierra desde donde haya acceso autorizado.

3. **Coherencia del arqueo.** `CashCount` compara **efectivo físico** contra un `expected_amount` calculado por turno (`:139`, `:141`, `:144`). Dos turnos simultáneos sobre un mismo cajón producirían dos `expected_amount` distintos contra un único `counted_amount` físico, y ninguna de las dos diferencias sería atribuible.

La tercera observación es una **deducción** a partir de hechos documentados, no una regla escrita. Por eso inclina la recomendación pero no la convierte en evidencia normativa.

### 24.4 Recomendación técnica

**Opción A**, si el negocio confirma que no se comparte cajón entre terminales. Es además la opción más segura ante la duda: rechaza también la configuración de cajón compartido, que bajo A sería una mala configuración y bajo B una operación válida.

**No se adopta sin la confirmación**, porque elegir A cuando el negocio sí comparte cajón bloquearía operación legítima, y elegir B cuando no lo comparte permitiría dos custodias simultáneas sobre el mismo efectivo.

### 24.5 Qué exige la resolución

Una vez respondida la pregunta de §24.1:

1. corregir la sección inconsistente de `UC-CASH-001` —Frontera transaccional o Excepciones, según la respuesta—;
2. definir «turno incompatible» de forma expresa en `cash-counting-schema.md`, eliminando el calificativo sin definición de sus siete apariciones;
3. registrar la resolución aquí.

Hasta entonces `B2` sigue bloqueando el gate de §22, que permanece `NO-GO`.

## 25. Resolución de `B2` — regla de turno incompatible

Resuelto el 2026-09-04 tras la decisión de negocio que §24 identificó como el único dato faltante. Cierra el segundo de los cuatro bloqueos de §22. **`B3`, `B4` y RLS no se tocan.**

### 25.1 Decisión de negocio

**Opción A — unicidad por caja física.** Una `CashRegister` representa un único cajón físico de efectivo. Dos terminales **no** pueden operar turnos independientes simultáneos sobre el mismo cajón. Un comercio que necesite dos terminales con efectivo independiente debe provisionar dos `CashRegister` distintas.

### 25.2 Regla canónica

> Para cualquier `tenant_id` + `branch_id` + `cash_register_id` existe **como máximo un** `CashShift` en estado `OPEN` o `CLOSING`, **con independencia del `origin_device_id`**.

Casos derivados:

| Caso | Resultado |
|---|---|
| Mismo dispositivo · misma caja · turno `OPEN`/`CLOSING` | **Incompatible** |
| Otro dispositivo · misma caja · turno `OPEN`/`CLOSING` | **Incompatible** |
| Mismo dispositivo · otra caja | No incompatible por esta regla |
| Misma caja · turno `CLOSED` | No impide una apertura nueva |
| Reintento idempotente de la misma solicitud | **No es una segunda apertura**; se gobierna por la idempotencia existente |

### 25.3 `origin_device_id` conserva su significado

La decisión **no altera** el campo. Sigue siendo procedencia de la operación, identificación del dispositivo originador, componente de la clave de idempotencia (`UNIQUE (tenant_id, origin_device_id, idempotency_key)`), y dimensión de auditoría y trazabilidad. **No se convierte en propiedad ni exclusividad sobre la `CashRegister`.**

### 25.4 Documentos corregidos

- **`UC-CASH-001`** — se añade la sección normativa «Turno incompatible», que define el término distinguiendo `OPEN`/`CLOSING`/`CLOSED`, la irrelevancia del dispositivo y la independencia de la idempotencia. La frontera transaccional pasa a exigir una restricción «por tenant, sucursal y caja», sin la dimensión de terminal que generaba la contradicción de §24.2. Precondición y paso 3 del flujo pasan a remitir a la definición. Las pruebas mínimas distinguen la segunda apertura desde el mismo dispositivo y desde otro.
- **`cash-counting-schema.md`** — la regla 2 de `CashShift` enuncia el unique lógico por `(tenant_id, branch_id, cash_register_id)` sobre estados `OPEN` y `CLOSING`, con independencia del dispositivo.

Las secciones que ya eran consistentes con la opción A **no se modifican**: la excepción «Caja abierta por otro usuario», la precondición «Caja física activa», el tratamiento de cuarentena de `cash-counting-schema.md:289` y la prueba obligatoria de `:293`.

### 25.5 Concurrencia — conclusiones conservadas

Se mantienen íntegras y ahora son consistentes con una regla definida: la protección de concurrencia debe existir; la verificación previa no la sustituye; las operaciones offline pueden producir conflictos que el nodo local no puede conocer en el momento; la cuarentena y la revisión tratan anomalías y **no legitiman** dos turnos simultáneos; y la idempotencia es un eje independiente de la incompatibilidad.

### 25.6 Consecuencia para el arqueo

La regla evita que dos turnos simultáneos calculen `ExpectedCash` contra el mismo efectivo físico. `CashCount` compara efectivo físico contra un `expected_amount` por turno, y su `counted_amount` sólo puede atribuirse a un turno. **No se introduce ninguna regla de arqueo nueva** y `UC-CASH-002` no se modifica.

### 25.7 Alcance

La unicidad conceptual queda determinada; **la sintaxis del índice parcial pertenece al gate DDL posterior** y no se decide aquí. `B1` (§23) permanece intacto. `B3`, `B4` y RLS siguen abiertos, de modo que el gate de §22 continúa `NO-GO`.

## 26. Resolución de `B3` — escala decimal de los importes de Cash

Resuelto el 2026-09-04 **por derivación de la matriz normativa existente**, no por elección de una escala nueva. Cierra el tercero de los cuatro bloqueos de §22. **`B4` y RLS no se tocan.**

### 26.1 Decisión

**Escala 6, precisión total 19.** `numeric(19,6)` en PostgreSQL y TEXT decimal canónico de seis decimales en SQLite.

La escala es **fija por concepto y no depende de `currency_code`**.

### 26.2 Derivación

`physical-conventions.md:137-146` admite exactamente **tres** escalas, y las dos que no son 6 están excluidas por sus propias condiciones explícitas:

| Escala | Concepto | ¿Aplica a un movimiento de caja? |
|---|---|---|
| **10** | Tasa tributaria, porcentaje de descuento, factor de conversión | **No.** Un importe no es una tasa ni un factor |
| **2** | «importe fiscal o contable normalizado», admitido «**solo después de normalización fiscal/contable explícita**» | **No.** Un movimiento de caja es un hecho operativo, no un importe ya normalizado |
| **6** | Precio, base, impuesto, descuento, Payment/Refund/Reversal, componentes de Settlement, cantidad, `payable_amount` | **Sí, por eliminación** |

Tres refuerzos independientes:

1. `:148` — «`numeric(19,2)` **no es la representación universal** del dominio financiero… Payment, Refund, Reversal y los componentes de Settlement mantienen capacidad `(19,6)`.»
2. `:135` — «La escala física es capacidad de representación; **no autoriza redondear antes del punto normativo indicado**.» Adoptar escala 2 para caja forzaría una reducción prematura al registrar el lado en efectivo de un importe que el resto del dominio conserva con seis decimales, que es exactamente lo que esa frase prohíbe.
3. Regla 4 de la representación SQLite — «La **precisión total no excede 19 dígitos**», y las ocho filas de la matriz usan `numeric(19, s)`. La precisión ya era normativa; lo que faltaba era únicamente la escala del concepto Cash.

### 26.3 Regla canónica

> Todo importe monetario de Cash —`CashMovement.amount` y los importes de arqueo `expected_amount`, `counted_amount` y `difference_amount`— se representa con **precisión total 19 y escala 6**: `numeric(19,6)` en PostgreSQL y TEXT decimal canónico de seis decimales en SQLite. La escala no depende de la moneda. El importe nunca se representa ni se calcula con `number` de JavaScript.

### 26.4 Representación

Rigen las reglas ya vigentes de `physical-conventions.md:167-175`, sin excepción para Cash:

- **Cero:** `0.000000`. Seis decimales, una sola cifra entera, y **`-0` no es admisible**.
- **Exceso de decimales:** se **rechaza**, no se trunca. La cantidad de decimales debe coincidir exactamente con la escala de la columna, y el adaptador valida la representación canónica **antes** del cast, porque el typmod de PostgreSQL normalizaría silenciosamente una escala léxica excedente.
- **Normalización:** sólo de ceros a la izquierda. No se admite exponente, coma, whitespace, `NaN` ni infinito.
- **Cálculo:** coeficiente `BigInt` más escala en el adaptador, y value object decimal en el dominio.

### 26.5 Monedas

**Opción A: escala única fija por concepto.** `currency_code` identifica la moneda ISO 4217 y garantiza coherencia entre movimiento, turno y caja —`cash-counting-schema.md:43` la hace inmutable mientras existan turnos—, pero **no determina la escala**. La matriz de `physical-conventions.md` está indexada por concepto y no por moneda, y ninguna de sus ocho filas condiciona la escala a la divisa.

El caso COP lo confirma en lugar de contradecirlo: `DEC-006` aplica `NEAREST_50_HALF_AWAY_FROM_ZERO_V1` a `payable_amount`, y la matriz precisa que «el resultado queda congelado **sin cambiar la escala de almacenamiento**». Un redondeo específico de moneda altera el valor, nunca la representación.

### 26.6 Redondeo

**NO DECIDIDO para Cash, y no bloquea.**

Las fuentes definen un modo con nombre —`NEAREST_50_HALF_AWAY_FROM_ZERO_V1`— sólo para `payable_amount` y el ajuste comercial COP, y la columna «Punto de reducción/redondeo» indica *cuándo* reduce cada concepto, no un modo general. Para Cash no existe ninguno, y **no se inventa**.

No bloquea `B3` porque ninguna operación del modelo de Cash produce decimales excedentes: los importes se registran a escala fija, `ExpectedCash` es una suma de valores de la misma escala —exacta por construcción—, y un importe que llega del lado comercial ya viene congelado a escala 6. Si un caso de uso futuro introdujera una operación que reduzca escala en Cash, ese modo deberá decidirse entonces.

### 26.7 `ExpectedCash`

Compatible. La fórmula no se modifica. Sumar y restar valores de escala 6 con coeficiente entero es exacto y determinista, sin error binario: las reglas 5 a 8 ya prohíben `number`, prohíben `SUM` nativo de SQLite sobre estas columnas y exigen que los agregados autoritativos se calculen en dominio y se persistan con control de versión dentro de la transacción.

### 26.8 Alcance

`B1` (§23) y `B2` (§25) permanecen intactos: el cero de `OPENING_FLOAT` se representa como `0.000000` y el resto de tipos conserva importe estrictamente positivo. `B4` y RLS siguen abiertos, de modo que el gate de §22 continúa `NO-GO`. La sintaxis concreta del tipo en el DDL pertenece a ese gate.

## 27. Resolución de `B4` — procedencia de la proyección de `CashRegister`

Resuelto el 2026-09-04. Cierra el cuarto y último bloqueo estructural de §22.1. **`B1`, `B2` y `B3` no se tocan.** No se autoriza DDL ni migración.

### 27.1 Decisión

**Dato:** la **`sequence` de la proyección de `CashRegister`** vigente en el momento de la apertura. Ni `CashRegister.version`, ni un identificador de snapshot, ni una combinación de ambos.

**Ubicación: alternativa A — columna directa en `CashShift`**, congelada en la apertura e inmutable durante el resto del ciclo del turno.

Estado: **`DECIDED`**.

### 27.2 Respuesta explícita a la pregunta de auditoría

La pregunta era si la auditoría necesita `A) sólo CashRegister.version`, `B) sólo snapshot.sequence`, `C) ambos`, `D) snapshot_id + sequence`, o `E) otra combinación respaldada documentalmente`.

**Respuesta: `B`.**

El requisito no se deriva aquí: ya está redactado. §21.6 lo fijó al resolver `P-5.8`:

> «una operación de caja debe registrar **la secuencia de la proyección de `CashRegister`** vigente en su momento. El modelo actual de `cash_cash_shifts` no contempla ese campo».

Esa frase nombra el dato —*la secuencia de la proyección*— y nombra la tabla —`cash_cash_shifts`—. `B4` no era una pregunta abierta sobre qué persistir, sino sobre si esa frase admitía otra lectura. No la admite: no menciona `version`, no menciona identificador de snapshot, y no menciona ninguna tabla distinta.

### 27.3 Por qué no `CashRegister.version`

§20.7 ya separó los dos contadores y les asignó propósitos que no se solapan:

| Contador | Ámbito | Propósito |
|---|---|---|
| `version` de cada registro | Fila del maestro | Concurrencia optimista en el lado **central** |
| `sequence` del snapshot | Proyección completa de un ámbito | **Anti-replay local** |

`version` es el mecanismo con el que el **central** protege una escritura concurrente sobre la fila (`physical-conventions.md:230-234`: `WHERE id = ? AND version = expected_version`). El POS **nunca escribe** el maestro —§20.2: «Publicar cambios al maestro: **Nadie desde el POS**»—, de modo que `version` no describe ninguna operación local. Persistirla en el turno registraría el estado de una fila remota, no la procedencia del artefacto que el POS verificó y aplicó.

`sequence`, en cambio, es exactamente la coordenada que el POS **acepta y almacena**: es la que la frontera de confianza de §20.5 comprueba y la que el criterio «estrictamente mayor» de §20.7 hace monótona por ámbito.

### 27.4 Por qué no `snapshot_id + sequence`

La alternativa `D` es la formulación literal de `DEC-011:116` —«toda operación se audita con el `snapshot_id` y la `sequence` utilizados»— y por eso merece descarte razonado, no omisión.

1. **`snapshot_id` existe para el SAS porque su contrato lo define.** `packages/contracts/src/authorization-snapshot.ts:78` declara `snapshot_id: UuidSchema`, y `local_authorization_snapshot` lo persiste. El contrato de la proyección de `CashRegister` **no existe**: §20.4 registra que «el emisor central y el transporte» no están materializados, y §20.5 enumera la frontera de confianza sin ningún identificador de artefacto. Exigir `snapshot_id` obligaría a inventar aquí una claim de un contrato que ningún documento ha redactado.
2. **El par (ámbito, `sequence`) ya direcciona el artefacto.** La proyección es «snapshot completo por ámbito» (§20.4) y su secuencia es estrictamente creciente para ese ámbito (§20.7). El turno porta `tenant_id`, `company_id` y `branch_id` (`cash-counting-schema.md:48`), que son ese ámbito. La tupla es por tanto suficiente para identificar sin ambigüedad qué proyección se aplicó; `snapshot_id` no añadiría poder discriminante.
3. **`DEC-011:116` rige la auditoría del SAS, no la del maestro.** Ese requisito ya está recogido como invariante 8 de este documento (§4) y se refiere al artefacto de autorización. §21.6 lo invocó como *principio* —registrar con qué versión se operó— y derivó su propio requisito con su propio dato y su propia ubicación. Trasladar además la forma exacta del SAS sería extender por simetría, y §21.3 ya rechazó ese modo de razonar para esta misma entidad.

La combinación `C` (ambos contadores) queda descartada por 27.3: añade un dato sin requisito normativo que lo pida.

### 27.5 Por qué columna directa y no metadato separado ni referencia indirecta

**Alternativa A — columna directa. Seleccionada.** Es el patrón que el propio esquema de Cash ya aplica a toda entrada versionada que congela: `cash-counting-schema.md:125` declara en `CashCount` las columnas `started_shift_version`, `movement_cutoff_sequence`, `calculation_policy_version`, `calculation_checksum`, `tolerance_policy_version` y `tolerance_policy_checksum`, y `:141` describe su semántica: «**Iniciar congela** `started_shift_version` y `movement_cutoff_sequence`». `cash_cash_movement_actions` (`:211`) hace lo mismo con `authorization_policy_version`, e `inventory-receiving-schema.md:63` con `conversion_version`. La convención está escrita y es uniforme: **la procedencia versionada de una entrada se congela como columna de la fila que la consumió**.

**Alternativa B — tabla de metadatos de snapshot separada. Descartada.** Sin precedente en el repositorio para esta clase de dato, y en conflicto con la frontera transaccional de la apertura, enumerada paso a paso en `cash-counting-schema.md:225-232` y en `UC-CASH-001:46-50`: introduciría una escritura y una relación adicionales dentro de un commit ya especificado, sin resolver nada que la columna no resuelva.

**Alternativa C — referencia indirecta a la fila de la proyección. Descartada por evidencia, no por preferencia.** La proyección se reemplaza atómicamente y por completo (§20.4, `catalog-schema.md:243` y `:276`). Una referencia a la fila proyectada **resolvería siempre a la proyección vigente, no a la utilizada**: exactamente lo contrario del requisito de §21.6. Es la única de las tres alternativas que no puede cumplir su objetivo.

### 27.6 Definición de la columna

| Propiedad | Valor | Fuente |
|---|---|---|
| Nombre | `cash_register_projection_sequence` | Patrón `<sujeto>_<coordenada>` de `started_shift_version`, `movement_cutoff_sequence`, `calculation_policy_version`, `confirmed_sequence` |
| Tabla | `cash.cash_shifts` / `cash_cash_shifts` | §21.6 |
| Tipo | `bigint` en PostgreSQL, `INTEGER` en SQLite | `sync-base-schema.md:104`, `:188`; `physical-conventions.md:230` |
| Nulabilidad | `NOT NULL` | El requisito de §21.6 no admite excepción, y `CashShift` es `LOCAL_AUTHORITATIVE_SYNCED` (`cash-counting-schema.md:25`): todo turno nace en el POS que lo opera, sobre una proyección previamente aceptada |
| Mutabilidad | Congelada en la apertura; ninguna transición posterior la modifica | `cash-counting-schema.md:141` |

El nombre sigue una convención existente; **no se introduce ningún concepto nuevo**. La columna no es clave, no participa en unicidad, no interviene en `ExpectedCash` y no condiciona ninguna transición de estado: es evidencia de procedencia.

### 27.7 Alcance de la obligación — el turno, no cada movimiento

§21.6 emplea la expresión «una operación de caja» y a continuación localiza el campo en `cash_cash_shifts`. Se adopta esa localización literal: **la obligación se satisface en la apertura del turno**, y los movimientos, conteos y cierres heredan la procedencia por pertenencia al turno.

Consecuencia registrada, no ocultada: como §21.1 decidió que la proyección **no caduca** y se sustituye por snapshot posterior, una proyección puede reemplazarse mientras un turno está abierto, y el turno seguirá declarando la secuencia con la que se abrió. La exposición es acotada porque lo que la apertura fija es lo financieramente material: la caja concreta, y su `currency_code`, que el maestro declara **inmutable mientras existan turnos asociados** (§20.1, `cash-counting-schema.md:36-44`). Un cambio de `name` o `code` no altera hecho contable alguno, y una retirada sobrevenida es precisamente la anomalía que §21.8 acepta y remite a reconciliación.

Si un bloque posterior exigiera granularidad por movimiento, será una decisión aditiva con su propia evidencia. **No se decide aquí, y no bloquea el DDL**, porque ningún documento la requiere hoy.

### 27.8 Documento corregido

`docs/architecture/physical-model/cash-counting-schema.md` — se incorpora `cash_register_projection_sequence` a las columnas lógicas de `cash.cash_shifts` / `cash_cash_shifts` y se añade la regla que fija su origen, su congelación y su exclusión de la unicidad. No se modifica ninguna otra columna, constraint o estado.

### 27.9 Qué NO decide esta sección

No autoriza DDL, migración ni tabla alguna. No implementa `CASH-001`. No define el contrato del snapshot maestro de `CashRegister` ni su emisor, que siguen sin existir (§20.4). No altera §20, §21, §23, §25 ni §26, ni ninguna decisión sobre SSA o SAS.

Con `B4` resuelto, la condición de reevaluación de §22.4 —`B1`, `B2`, `B3` y `B4` resueltos por decisión registrada— **queda satisfecha**. El gate permanece **`NO-GO`** hasta que esa reevaluación se realice en un bloque propio, que deberá además resolver las dependencias de §22.2: motor de destino de la primera migración de Cash (SQLite o PostgreSQL) y, si es central, las políticas RLS que dependen del contexto confiable de `P-7`, todavía abierto.

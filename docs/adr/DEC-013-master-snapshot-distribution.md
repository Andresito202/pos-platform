# DEC-013 — Distribución de snapshots de datos maestros

## Estado

`PROPUESTA NORMATIVA`. Cierra las decisiones de `SNAPSHOT-ISSUER-1` y `SNAPSHOT-ISSUER-2`.

`ARCHITECTURAL GATE`: **`PASS`** · `RECOVERY GATE`: **`PASS`** desde el 2026-09-04 por decisión de `RECOVERY-DECISION-1` (ver §27, que supersede el bloqueo de §17) · `MATERIALIZATION GATE`: **`NO-GO`**.

Este documento **no autoriza implementar nada**. No modifica `DEC-012`, `P-6`, `G1`, Payments ni Sales. Su función es congelar las decisiones para que la materialización no vuelva a descubrirlas.

Redacción normativa: `MUST` / `MUST NOT` designan obligaciones verificables. Donde este documento no dice `MUST`, no hay obligación derivable.

## 1. Contexto

Cuatro maestros están clasificados `CENTRAL_MASTER_REPLICATED` y el POS los necesita para operar sin conectividad:

| Maestro | Clase | Fuente |
|---|---|---|
| `CashRegister` | `CENTRAL_MASTER_REPLICATED` | `cash-counting-schema.md:24` |
| `UnitOfMeasure`; `Product`, `Variant`, `Presentation` y demás Catalog | `CENTRAL_MASTER_REPLICATED` | `catalog-schema.md:13-14` |
| `PriceList`, `ProductPrice`, `PricingPolicy`, `PricingPolicyVersion`, `RoundingPolicy` | `CENTRAL_MASTER_REPLICATED` | `pricing-schema.md:11` |
| `TaxClassification`, `TaxRule`, `TaxRuleVersion`, `TaxPolicyVersion` | `CENTRAL_MASTER_REPLICATED` | `tax-schema.md:11` |

Seis responsabilidades que este documento mantiene **estrictamente separadas** y que `MUST NOT` mezclarse:

| Responsabilidad | Qué es | Dónde vive |
|---|---|---|
| **Master authority** | Quién decide el contenido | Sistema central propietario |
| **Projection** | Copia verificada de sólo lectura | SQLite del POS |
| **Transport** | Cómo viaja el artefacto | Canal de descarga |
| **Cryptographic trust** | Qué prueba el origen | Firma Ed25519 |
| **Domain version** | Concurrencia optimista del maestro | `version` por fila, central |
| **Transport checkpoint** | Posición de descarga | `SyncCheckpoint` |

## 2. Autoridad

La autoridad reside **exclusivamente** en el sistema central propietario de cada maestro (`data-ownership.md`), y `catalog-schema.md:16` lo fija: «El POS local **no edita** estos maestros en la primera fase».

El POS Local Service:

1. `MUST NOT` crear maestros.
2. `MUST NOT` modificar maestros centrales.
3. `MUST NOT` firmar snapshots.
4. `MUST NOT` avanzar una coordenada aceptada fuera de una activación con `COMMIT`.
5. `MUST NOT` tratar su SQLite como autoridad maestra.
6. `MUST NOT` aceptar datos sin verificación completa.
7. `MUST NOT` usar el instante de llegada para decidir autoridad, orden o vigencia.

## 3. Emisor

**`ISSUER = worker central de publicación`.**

Flujo: `MASTER CHANGE → OUTBOX → BUILD CLAIMS → CANONICALIZE → SIGN → PUBLISH`.

Base documental: la mutación del maestro, el `AuditEvent` y la **outbox de distribución** comparten una transacción central — `catalog-schema.md:249,253,257`; `pricing-schema.md:50` («AuditEvent y evento/outbox de distribución»); `tax-schema.md` («emitir evento/outbox de distribución comparten una transacción central»).

El worker:

1. `MUST` operar con identidad de workload ante KMS/HSM (`secret-key-and-support-management.md:91`).
2. `MUST NOT` entregar claves privadas al POS (`:26`).
3. `MUST NOT` exponer una interfaz humana capaz de firmar contenido arbitrario.
4. `MUST` registrar evidencia suficiente para trazar cambio → artefacto.
5. `MUST` ser idempotente respecto de una publicación: reintentar `MUST NOT` producir dos artefactos distintos para la misma coordenada.
6. `MUST NOT` decidir el contenido del maestro: firma lo que la transacción central resolvió.

**Separación obligatoria:** la administración del maestro (superficie humana) y la firma/publicación (workload) `MUST` residir en componentes distintos. Un fallo de firma `MUST NOT` revertir el cambio maestro ya confirmado.

## 4. Propósito criptográfico

**`key_purpose = MASTER_SNAPSHOT`**, aplicable a `CASH_REGISTER`, `CATALOG`, `PRICING` y `TAX`. Una misma **función** criptográfica; la custodia concreta la fija el contrato de claves.

1. Una clave de licencias `MUST NOT` firmar snapshots maestros.
2. Una clave de actualizaciones `MUST NOT` firmarlos.
3. Una clave de confianza de dispositivo `MUST NOT` firmarlos.
4. Un snapshot firmado con `key_purpose` incorrecto `MUST` ser rechazado.
5. Un snapshot de otro `environment` `MUST` ser rechazado.

Fundamento: `secret-key-and-support-management.md:85` — «Comprometer una clave **no debe permitir firmar toda clase de artefacto**». Las cuatro clases documentadas (`:79-82`) separan por función y **ninguna cubre datos maestros**.

Trust anchor: `SigningKey`, catálogo global por ambiente con `key_id`, `key_purpose`, `environment`, `public_key`, `key_status`, `valid_from`, `valid_until`, `replaced_by_key_id`, y `UNIQUE (environment, key_purpose, key_id)` (`device-licensing-schema.md:266-268`). Estados `ACTIVE` / `VERIFY_ONLY` / `REVOKED`. Rotación conforme a `secret-key-and-support-management.md:99-104`: publicar la nueva pública por cadena autenticada, mantener ventana `VERIFY_ONLY`, dejar de firmar con la retirada, conservar evidencia, permitir revocación urgente y **no invalidar ventas ya confirmadas**.

## 5. Firma

```
algorithm       = Ed25519
signature input = canonicalJson(claims)
encoding        = base64url
envelope        = { claims, signature }
```

1. La firma `MUST` cubrir **todos** los claims.
2. Un checksum `MUST NOT` ser tratado como autenticación. Sirve a la integridad del contenido almacenado localmente y a nada más.
3. `MUST NOT` introducirse un algoritmo alternativo ni una canonicalización distinta.

## 6. Transporte

**`TRANSPORT = PULL / DOWNLOAD`**, mediante el mecanismo documentado en `sync-base-schema.md:23` — «**Descargas** de configuración y decisiones centrales usan **contratos versionados y checkpoints**; no se inventa una segunda máquina de deduplicación local» — con `SyncCheckpoint` en `direction = DOWNLOAD` y cursor opaco (`:192`).

El checkpoint:

1. `MUST` representar posición de transporte.
2. `MUST NOT` representar autoridad.
3. `MUST NOT` sustituir la coordenada del snapshot.
4. `MUST NOT` decidir la aceptación.
5. `MUST NOT` ordenarse por timestamp (`:192`: «No se comparan cursores por timestamp»).

El cursor `MUST` ser opaco y `MUST NOT` compararse como magnitud temporal.

Mecanismo **secundario** de recuperación: un artefacto firmado entregado por un medio alternativo (reinstalación, sucursal sin conectividad) `MUST` someterse a **la misma verificación completa**. No es el transporte primario y `MUST NOT` relajar ninguna validación.

## 7. Tipos de snapshot

`CATALOG` · `PRICING` · `TAX` · `CASH_REGISTER`. Un tipo distinto `MUST` ser rechazado. Un snapshot `MUST` declarar su `snapshot_type`, y éste `MUST` coincidir con el verificador y con el contrato de payload aplicado.

## 8. Binding

| `snapshot_type` | Binding | Derivación |
|---|---|---|
| `CATALOG` | `(tenant_id, company_id)` | Entidades tenant+company; ninguna lleva `branch_id` |
| `PRICING` | `(tenant_id, company_id)` | `PriceList` es tenant+company; `ProductPrice.branch_id` es nulable y es atributo del precio |
| `TAX` | `(tenant_id, company_id)` | `TaxClassification` y `TaxRuleVersion` son tenant+company |
| `CASH_REGISTER` | `(tenant_id, company_id, branch_id)` | `DEC-012` §31.3 — **cerrado, no se modifica** |

1. El binding `MUST` estar cubierto por la firma.
2. El consumidor `MUST` validar el binding contra el contexto local esperado, sobre claims **autenticados**.
3. Un snapshot cross-tenant, cross-company, o cross-branch para `CASH_REGISTER`, `MUST` ser rechazado.
4. Un claim de scope incorrecto `MUST NOT` corregirse: se rechaza el snapshot completo.

## 9. Coordenada

La coordenada de distribución es **`sequence`**, por binding y por `snapshot_type`, con contadores **independientes**.

```
aceptar  ⟺  incoming.sequence > accepted.sequence
```

| Caso | Resultado |
|---|---|
| `incoming < accepted` | `REJECT_OBSOLETE` |
| `incoming == accepted` | `REJECT_DUPLICATE_OR_REPLAY` |
| `incoming > accepted` | candidato a aceptación |

La coordenada `MUST` pertenecer a su binding, `MUST` estar firmada, `MUST` persistirse y `MUST` actualizarse **atómicamente** con la proyección.

`MUST NOT` usarse timestamps, instante de llegada, last-write-wins, TTL, `expires_at` ni el orden del transporte.

Fundamento general, independiente de `CashRegister`: `device-licensing-schema.md:324` — «Los payloads firmados se reemplazan atómicamente por **secuencia/version superior verificada**; nunca por timestamp de llegada ni last-write-wins».

## 10. Versión de dominio ≠ coordenada de distribución

`MUST NOT` confundirse. La `version` por fila de Catalog (`catalog-schema.md:97,162,213`), el `version_number` de `PricingPolicyVersion` y de `TaxRuleVersion`, y la `publication_idempotency_key` de Tax son **concurrencia optimista y versionado de dominio** sobre filas que el POS nunca escribe (`physical-conventions.md:230-234`). `sequence` es el **orden de publicación del snapshot dentro de su binding**. Ninguna sustituye a la otra.

## 11. Claims

| Grupo | Claim | Semántica |
|---|---|---|
| Seguridad | `key_id` | Resuelve la clave en el trust anchor |
| Seguridad | `environment` | Producción / staging / sandbox; nunca se mezclan |
| Identidad | `schema_version` | Versión del contrato de claims |
| Identidad | `snapshot_type` | Uno de los cuatro de §7 |
| Scope | `tenant_id`, `company_id` | Binding |
| Scope | `branch_id` | **Sólo** cuando el tipo lo requiere (`CASH_REGISTER`) |
| Orden | `sequence` | Coordenada de §9 |
| Metadato | `issued_at` | Requerido por `TrustedClockGuard` |
| Contenido | `payload` | Reemplazo completo del ámbito |

`MUST NOT` incluirse: `snapshot_id` (`DEC-012` §27.4: el par binding + `sequence` ya identifica), `expires_at`, TTL, instante de recepción, cursor ni ningún campo de transporte.

La identidad del snapshot se deriva de **binding + `sequence`**.

## 12. Payload

| Tipo | Contenido |
|---|---|
| `CATALOG` | `Product`, `Variant`, `Presentation`, `UnitOfMeasure` |
| `PRICING` | `PriceList`, `ProductPrice`, `PricingPolicy`, `PricingPolicyVersion`, `RoundingPolicy` |
| `TAX` | `TaxClassification`, `TaxRule`, `TaxRuleVersion`, `TaxPolicyVersion` |
| `CASH_REGISTER` | Exactamente el de `DEC-012` §31 — sin cambios |

`MUST NOT` publicarse datos ficticios ni maestros incompletos para satisfacer un `NOT NULL`.

## 13. Aceptación local

```
RECEIVE → PARSE → VERIFY SIGNATURE → RESOLVE KEY → VALIDATE ENVIRONMENT
       → VALIDATE SNAPSHOT TYPE → VALIDATE BINDING → VALIDATE SCHEMA
       → VALIDATE DOMAIN PAYLOAD → VALIDATE COORDINATE
       → [ BEGIN IMMEDIATE ]  WRITE → ACTIVATE → UPDATE COORDINATE  [ COMMIT ]
```

`WRITE`, `ACTIVATE` y la actualización de la coordenada `MUST` ser atómicos. Ante cualquier error `MUST` hacerse `ROLLBACK`, la proyección anterior `MUST` permanecer activa y la coordenada `MUST NOT` avanzar.

**Semántica de ausencia:** una entidad presente en `N` y ausente en `N+1` `MUST` conservar su fila y salir de la vista activa; `MUST NOT` inferirse un estado maestro no emitido. Es `G1` de `DEC-012` §31.1, aplicado a los cuatro tipos.

## 14. Idempotencia

Una entrega duplicada `MUST` ser inocua. Una misma coordenada `MUST NOT` producir dos activaciones efectivas. El transporte puede entregar el mismo artefacto varias veces y el consumidor `MUST` absorberlo de forma determinista.

## 15. Fuera de orden

Con `accepted = 150`, la llegada de `148, 149, 150, 151` produce: `REJECT_OBSOLETE`, `REJECT_OBSOLETE`, `REJECT_DUPLICATE_OR_REPLAY`, `ACCEPT`. El orden de llegada `MUST NOT` ser autoridad.

## 16. Semántica de fallo

`INVALID_SIGNATURE` · `UNKNOWN_KEY` · `WRONG_KEY_PURPOSE` · `REVOKED_KEY` · `WRONG_ENVIRONMENT` · `INVALID_CHECKSUM` · `INVALID_SCHEMA` · `INVALID_SNAPSHOT_TYPE` · `WRONG_SCOPE` · `INVALID_PAYLOAD` · `OBSOLETE_SEQUENCE` · `DUPLICATE_SEQUENCE` · `REPLAY` · `TRANSPORT_FAILURE` · `SQLITE_FAILURE` · `ACTIVATION_FAILURE`.

Para **todos** ellos: `MUST NOT` destruirse la proyección activa · `MUST NOT` avanzar la coordenada · `MUST` ser observable · `MUST` ser auditable cuando corresponda.

**Regla fundamental: un error nunca destruye una proyección válida.**

## 17. Recuperación y restauración — `BLOCKED` (superado por §27)

La coordenada aceptada vive en el mismo SQLite que una restauración reemplaza. Una restauración a un punto anterior **rebaja la cota anti-replay**, y con ella la garantía de monotonía.

| Caso | Tratamiento normativo |
|---|---|
| A. Restauración completa · B. parcial · C. backup anterior · G. snapshot anterior | La coordenada restaurada **no es** una coordenada aceptada legítimamente vigente |
| D. Reinstalación | Proyección vacía; primera adquisición completa |
| E. Pérdida de dispositivo | Fuera de alcance: identidad de dispositivo (`DEC-008`) |
| F. Clonación de instalación | Fuera de alcance: identidad de dispositivo (`DEC-008`) |
| H. Checkpoint más avanzado que la base | El cursor `MUST` descartarse y reestablecerse; la coordenada, no el cursor, gobierna |
| I. Base más antigua que el checkpoint | Igual que H |
| J. Corrupción de la proyección | Detectada por checksum; el POS `MUST` fallar cerrado y re-adquirir |

**Lo que sí queda cerrado:** la coordenada `MUST` actualizarse únicamente dentro de la transacción de activación; una restauración **no es** una activación y `MUST NOT` producir una coordenada aceptada.

**Lo que no puede garantizarse con lo documentado:** impedir que, tras una restauración, un artefacto **auténtico pero antiguo** —con `sequence` mayor que la restaurada y menor que la última realmente vigente— sea aceptado. El único estado durable local es el que la restauración reemplaza, de modo que la monotonía exige una fuente durable **externa**. Declararlo como riesgo residual sería ocultarlo.

**Decisión humana requerida — tres opciones, sin preferencia derivable:**

1. **Aceptar una ventana de downgrade acotada** tras una restauración, documentada como decisión de seguridad con su exposición explícita.
2. **Autorizar una aserción de coordenada firmada** por el emisor, del mismo `key_purpose`, que el POS `MUST` obtener antes de aceptar cualquier snapshot tras una restauración. Es un artefacto **nuevo** que este documento no deriva de ninguna fuente previa.
3. **Vincular la coordenada aceptada a un almacén durable fuera de la base restaurable**, definiendo su autoridad y su integración.

Mientras no se elija: **`RECOVERY GATE = BLOCKED`** y **`MATERIALIZATION GATE = NO-GO`**.

**Superado el 2026-09-04.** El texto de esta sección se conserva íntegro como registro del análisis que llevó al bloqueo. La decisión se tomó en §27, que elige la opción 2 acotada a lo que la autoridad central realmente conoce. Prevalece §27.

## 18. Offline

Estando offline el POS `MUST` operar con la última proyección válida y `MUST NOT`: inventar datos, modificar maestros centrales, considerar inválido un snapshot por antigüedad, aplicar TTL o alterar la coordenada. **No hay caducidad por tiempo** (`DEC-012` §21, extendido aquí a los cuatro tipos).

Al recuperar conectividad: `PULL → CHECKPOINT → RECEIVE → VERIFY → VALIDATE → ANTI-REPLAY → ACTIVATE`.

## 19. Auditoría

**Central:** cambio maestro · `AuditEvent` · outbox · publicación · evidencia de firma · reintentos.
**Local:** recepción · resultado de verificación · motivo de rechazo · coordenada aceptada · instante de activación · `snapshot_type` · binding · `key_id`.

`MUST` existir trazabilidad `MASTER CHANGE → OUTBOX → SIGNED SNAPSHOT → TRANSPORT → LOCAL VERIFICATION → ACTIVATION`. Un rechazo silencioso `MUST NOT` ocurrir: es indistinguible de un artefacto que nunca llegó.

## 20. `P-6` permanece intacto

`G1` · `sequence` · binding `(tenant, company, branch)` · Ed25519 · `canonicalJson(claims)` · `key_id` · `TrustedSigningKey` · `TrustedClockGuard` · `VERIFY → VALIDATE → WRITE → ACTIVATE` · proyección SQLite · sin TTL · sin LWW. **Ninguna cláusula de este documento exige modificar `CashRegister`.** `DEC-012` no se altera.

## 21. Relación con Payments y Sales

```
Catalog / Pricing / Tax  →  Sales  →  PaymentGroup  →  Payment
```

Payments `MUST NOT` convertirse en un maestro distribuido: sus hechos nacen locales (`DEC-007:887`). `PaymentStatus`, `confirmed_amount`, `authority_type`, la idempotencia, `PaymentConfirmed` y `PaymentAllocation = OUT` permanecen sin cambios. Este documento no implementa Payment ni Sale.

## 22. Modelo de amenazas

| Amenaza | Prevent | Detect | Reject | Recover |
|---|---|---|---|---|
| Transporte comprometido | Firma sobre claims | Verificación local | Firma inválida | Re-adquirir |
| POS comprometido | Sin clave privada; sin autoridad | Auditoría central | — | Re-provisión |
| Worker comprometido | Identidad de workload; KMS | Logs de claves | — | Revocación de clave |
| Clave de firma comprometida | Custodia KMS/HSM; clase aislada | Logs | `REVOKED` | Rotación urgente |
| Artefacto de staging robado | `environment` en claims firmados | Validación | `WRONG_ENVIRONMENT` | — |
| Artefacto cross-tenant / cross-company | Binding firmado | Validación | `WRONG_SCOPE` | — |
| Replay | Coordenada estricta | Comparación | `REPLAY` | — |
| Downgrade | Coordenada estricta | Comparación | `OBSOLETE_SEQUENCE` | **§17: no garantizado tras restauración** |
| Duplicado / fuera de orden | Coordenada | Comparación | `DUPLICATE` / `OBSOLETE` | — |
| Payload malformado | Schema + validación de dominio | Validación | `INVALID_PAYLOAD` | — |
| SQLite corrupto | Checksum | Verificación de integridad | Fallo cerrado | Re-adquirir |
| Backup obsoleto | — | — | — | **§17: BLOCKED** |
| Checkpoint comprometido | El cursor no decide aceptación | Coordenada | Rechazo por coordenada | Reestablecer cursor |

## 23. Tabla de decisiones

| Decisión | Estado | Autoridad | Implementación requerida | Test requerido |
|---|---|---|---|---|
| Autoridad del maestro | `CLOSED` | Central propietario | — | POS no puede escribir maestro |
| Issuer = worker central | `CLOSED` por derivación | `secret-key…:91`; outbox | Worker publicador | Sin outbox no hay artefacto |
| `key_purpose = MASTER_SNAPSHOT` | `CLOSED` por derivación | `secret-key…:85` | Registro en trust anchor | Cross-purpose rechazado |
| Firma Ed25519 sobre claims | `CLOSED` | `DEC-011`, `DEC-012` | Verificador genérico | Firma inválida rechazada |
| Transporte PULL | `CLOSED` | `sync-base-schema.md:23,192` | Endpoint + checkpoint | Cursor no decide aceptación |
| Binding por tipo | `CLOSED` | Esquemas de cada maestro | Validación | Cross-scope rechazado |
| Coordenada `sequence` | `CLOSED` | `device-licensing…:324` | Persistencia por binding | Menor/igual/mayor |
| Claims mínimos | `CLOSED` | Este documento | Contrato en `contracts` | Campo extra rechazado |
| Ausencia = `G1` | `CLOSED` | `DEC-012` §31.1 | Marcador de presencia | Ausencia no marca `RETIRED` |
| Semántica de fallo | `CLOSED` | Este documento | Códigos estables | 16 casos |
| Offline sin TTL | `CLOSED` | `DEC-012` §21 | — | Snapshot antiguo sigue válido |
| **Recuperación** | **`BLOCKED`** | **Humana** | **Pendiente** | **Downgrade tras restauración** |

## 24. Manifiesto de materialización

| # | Componente | Estado |
|---|---|---|
| 1 | Contrato de claims y envelope en `packages/contracts` | `REQUIRED` |
| 2 | Tipos de `snapshot_type`, binding y códigos de fallo | `REQUIRED` |
| 3 | Tablas SQLite: artefacto append-only + proyecciones por tipo | `REQUIRED` |
| 4 | Repositorios de proyección y de artefacto | `REQUIRED` |
| 5 | Verificador genérico reutilizando `TrustedSigningKey` y `TrustedClockGuard` | `REQUIRED` |
| 6 | Anti-replay por binding y tipo | `REQUIRED` |
| 7 | Transacción de activación atómica | `REQUIRED` |
| 8 | Integración con `SyncCheckpoint` en `DOWNLOAD` | `REQUIRED` |
| 9 | Worker emisor | `REQUIRED` (central) |
| 10 | Publicador desde outbox | `REQUIRED` (central) |
| 11 | Abstracción de KMS | `REQUIRED` (central) |
| 12 | Endpoint de descarga | `REQUIRED` (central) |
| 13 | Auditoría local y central | `REQUIRED` |
| 14 | Observabilidad de aceptación y rechazo | `REQUIRED` |
| 15 | Aserción de coordenada firmada | `OUT` hasta resolver §17 |
| 16 | Payload de `PRICING` y `TAX` | `OUT` de la primera materialización |

## 25. Manifiesto de pruebas

`REQUIRED` en todos los casos:

- **Unitarias:** canonicalización estable · verificación de firma · resolución de clave (`ACTIVE`/`VERIFY_ONLY`/`REVOKED`) · validación de binding · comparación de coordenada.
- **Integración:** activación atómica · reemplazo completo · semántica de ausencia (`G1`) · integración con checkpoint.
- **Fallo:** los 16 códigos de §16, cada uno probando que la proyección activa sobrevive y la coordenada no avanza.
- **Replay:** menor, igual, mayor, fuera de orden, duplicado.
- **Recuperación:** `OUT` hasta resolver §17; su prueba es precisamente lo que hoy no puede especificarse.

## 26. Gobernanza

Este documento no modifica `DEC-012` ni amplía ningún gate. La materialización exigirá: ratificar las dos decisiones derivadas (§3, §4), resolver §17, y una autorización explícita de migración que nombre los componentes, al modo en que `D5` nombró las tablas de Cash.

## 27. Recuperación — decisión normativa (`RECOVERY-DECISION-1`)

Decidido el 2026-09-04. **Supersede el bloqueo de §17**, cuyo texto se conserva. Sección aditiva: no altera §1-§16 ni §18-§26, ni `DEC-012`, `P-6`, `G1`, Payments o Sales.

### 27.1 Decisión

**Opción 2, acotada a lo que la autoridad central realmente conoce: `CENTRAL ACKNOWLEDGED FLOOR`.**

La autoridad central `MUST` exponer, por `(installation_id, snapshot_type, binding)`, la mayor `sequence` cuya **recepción y activación la instalación le confirmó**. Ese valor es el `acknowledged_floor`. El POS `MUST` obtenerlo antes de aceptar cualquier snapshot en una sesión, y `MUST` tomar como cota efectiva:

```
effective_floor = max(local accepted_sequence, central acknowledged_floor)
```

Se `MUST` rechazar todo snapshot con `sequence <= effective_floor`.

### 27.2 Autoridad — límite exacto

| Dato | Autoridad | Naturaleza |
|---|---|---|
| `publication_sequence` | **Central** | Hecho central; orden de publicación por binding |
| `accepted_sequence` | **Instalación** | Hecho **local**; el central no lo conoce |
| `acknowledged_floor` | **Central** | Hecho central sobre **sus propios acuses**; **cota inferior** del anterior |
| `transport checkpoint` | Ninguna | Posición de transporte |

La central `MUST NOT` afirmar cuál fue el último snapshot aceptado por una instalación: no lo sabe. Sólo afirma qué le fue confirmado. Una firma `MUST NOT` usarse para convertir en verdad un dato que la autoridad no posee.

### 27.3 Por qué la cota inferior basta

1. La aceptación de un snapshot es una **asignación idempotente de estado completo y auténtico**, no una operación con efecto acumulativo. Reaceptar `152` fija la proyección en el estado `152`; no duplica ningún hecho.
2. `DEC-012` §21 ya ratificó que la proyección **no caduca**: el POS puede operar indefinidamente sobre un estado maestro antiguo pero auténtico. Un canal que simplemente **retiene** los snapshots nuevos produce esa misma obsolescencia sin necesidad de restauración alguna.
3. Por tanto la reaceptación posterior a una restauración es una **instancia de una exposición ya aceptada**, no una clase nueva, y queda **acotada** por el `acknowledged_floor`.

### 27.4 Contrato de recuperación

**Autoridad e identidad**

1. La cota se lleva por `installation_id` (`DEC-008`), no por dispositivo ni por tenant.
2. No existe cota global entre instalaciones. `POS-A` y `POS-B` `MUST` tener cotas independientes.

**Restauración**

3. Una restauración `MUST NOT` crear, aumentar ni legitimar un `accepted_sequence`. Un valor restaurado es **candidato a cota inferior**, nunca prueba de aceptación vigente.
4. La coordenada aceptada `MUST` actualizarse únicamente dentro de la transacción de activación. Una restauración no es una activación.
5. Tras una restauración **no se exige detección**: la confirmación de la cota es **incondicional en cada sesión**, de modo que una restauración silenciosa queda cubierta por construcción.

**Offline**

6. El transporte primario es `PULL`: **offline no llega ningún snapshot**, luego una reaceptación offline es estructuralmente imposible.
7. El canal secundario de §6 `MUST NOT` usarse para activar un snapshot mientras la cota no haya sido confirmada contra la central en la misma sesión en línea.
8. Offline el POS `MUST` seguir operando sobre la proyección restaurada, que es auténtica.

**Reinstalación**

9. Una reinstalación deja al POS sin `accepted_sequence`. La cota `MUST` provenir de la central para esa `installation_id`.
10. Una identidad de instalación nueva parte de cota cero: no hay historia local en la que reintroducir nada.

**Conflicto**

11. Si `local > acknowledged_floor`, prevalece el local: la central aún no lo registró.
12. Si `acknowledged_floor > local`, prevalece la central.
13. `MUST NOT` adoptarse nunca el menor de los dos.

**Rechazo y auditoría**

14. Todo snapshot con `sequence <= effective_floor` `MUST` rechazarse como `OBSOLETE_SEQUENCE` o `DUPLICATE_SEQUENCE`.
15. El establecimiento de la cota, su origen y todo rechazo `MUST` ser auditables. Un rechazo silencioso `MUST NOT` ocurrir.

### 27.5 Acuse — estados que no deben confundirse

`DOWNLOADED` → `VERIFIED` → `VALIDATED` → `WRITTEN` → `ACTIVATED` → `ACKNOWLEDGED`.

Descargar `MUST NOT` interpretarse como aceptar; verificar `MUST NOT` como activar; activar `MUST NOT` como acusar. La central sólo conoce `ACKNOWLEDGED`. El acuse `MUST` emitirse únicamente después de un `COMMIT` de activación.

### 27.6 Riesgo residual declarado

Los snapshots **activados localmente y nunca acusados** pueden volver a aceptarse tras una restauración. La ventana es exactamente «lo activado desde el último contacto exitoso». Su reaceptación es una asignación idempotente de estado auténtico, acotada por la cota central, y estrictamente menor que la exposición por retención que la ausencia de TTL ya acepta. **No se mitiga con TTL, timestamps ni LWW.**

### 27.7 Fuera de alcance

Clonación de instalación, pérdida de dispositivo y robo de identidad pertenecen a `DEC-008`. Este documento `MUST NOT` resolverlos. Se registra la dependencia: si dos instalaciones comparten `installation_id`, la cota deja de ser propia de una instalación y la garantía de §27.4 se degrada — es una condición de `DEC-008`, no de este contrato.

### 27.8 Dependencia nueva

La central `MUST` registrar acuses por `(installation_id, snapshot_type, binding)` y exponer el `acknowledged_floor`. Es **infraestructura central adicional**, dentro del worker y del endpoint de descarga ya exigidos por §24; **no introduce una autoridad nueva** ni un artefacto criptográfico nuevo. El componente 15 de §24, «aserción de coordenada firmada», permanece `OUT`: la decisión no lo requiere.

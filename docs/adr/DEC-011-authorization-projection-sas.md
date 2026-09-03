# DEC-011 — Proyección de autorización para operación local/offline (Signed Authorization Snapshot)

## Estado

Aceptada como diseño. No implementada.

Decidida por Wilson Andrés Camacho Culma el 2026-09-03. Este documento fija la decisión arquitectónica; la materialización requiere autorización explícita en un bloque posterior.

## Prioridad

`P0`. Bloquea todo vertical comercial: `UC-CASH-001`, `UC-CASH-002`, `UC-CASH-003` y `UC-SALES-001` exigen un usuario autenticado con permiso.

## Contexto

El modelo de autorización ya existe y está materializado en `001_central_foundation`, que es `GO_AUTHORIZED` e inmutable:

```
identity.users → tenancy.tenant_memberships → "authorization".user_role_assignments
                                                → "authorization".roles
                                                → "authorization".role_permission_grants
                                                → "authorization".permissions
```

El motor de decisión que consume ese modelo se implementa en `packages/domain/src/authorization` (AUTHZ-001, PR #29). `evaluatePermission()` es una función pura, fail-closed, que recibe `RoleAssignment[]` y decide.

Falta la pieza intermedia: **el POS Local Service no tiene forma de obtener esas asignaciones**. El modelo vive en PostgreSQL central, no existe backend central ni mecanismo de sincronización, y el POS debe operar offline conforme a `DEC-010`.

Sin resolver esto, la única alternativa sería derivar autorización de variables de entorno, del `device_id` o de un seed local. Todas convierten un dato mutable y no verificado en autoridad de seguridad, y quedan prohibidas.

`DEC-008` excluye explícitamente de su alcance la «autorización RBAC o ABAC general» y establece que «un derecho no equivale a permiso de usuario». Este documento cubre exactamente ese hueco y no lo contradice.

## Decisión

Se adopta el **Signed Authorization Snapshot (SAS)**: la autoridad central emite una proyección firmada, versionada y con vigencia acotada, ligada a un usuario y a un dispositivo. El POS la verifica criptográficamente en cada carga y la traduce a los `RoleAssignment[]` que consume el motor existente.

**Principio rector:** un snapshot almacenado localmente no es autoridad. Es autoridad únicamente mientras su firma verifica, su secuencia es la más alta aceptada para su binding y su vigencia no ha expirado. Estar en disco no confiere confianza.

### Reutilización obligatoria de la maquinaria existente

No se crea un segundo mecanismo criptográfico. El SAS reutiliza exclusivamente:

| Pieza | Ubicación real |
|---|---|
| Verificación Ed25519 (`node:crypto`) | `apps/pos-local-service/src/security/license-verifier.ts` |
| `canonicalJson` | `apps/pos-local-service/src/channel/canonical-json.ts` |
| `TrustedClockGuard` | `apps/pos-local-service/src/security/trusted-clock.ts` |
| Estados de clave `ACTIVE` / `VERIFY_ONLY` / `REVOKED` | `TrustedSigningKeyStatus` en `license-verifier.ts` |
| Sobre firmado `{ claims, signature }` | patrón de `SignedLicenseSchema` en `packages/contracts/src/local-security.ts` |

### Flujo end-to-end

```
CENTRAL                                   LOCAL (POS Local Service)
users → tenant_memberships
  → user_role_assignments
  → roles → permissions
      │
      │ 1. materializa proyección para (user, installation, device)
      ▼
  SAS { claims, signature }
      │ 2. Ed25519 sobre canonicalJson(claims)
      │ 3. transporte indiferente (AuthorizationProjectionPort)
      ▼
                        4. verifica firma contra trust anchor
                        5. valida binding, sequence, vigencia y reloj
                        6. swap atómico en una transacción SQLite
                        7. proyecta → RoleAssignment[]
                        8. evaluatePermission()   ← AUTHZ-001, sin cambios
```

Los pasos 4-6 constituyen la frontera de confianza. El paso 8 ya existe y no se modifica.

## Modelo mínimo de la proyección

Contiene exactamente lo necesario para producir `RoleAssignment[]`, y nada más.

| Bloque | Campos |
|---|---|
| Identidad | `user_id` |
| Binding | `installation_id`, `device_id` |
| Versionado | `snapshot_id`, `sequence`, `issued_at`, `expires_at` |
| Autorización | `assignments[]`: `tenant_id`, `company_id \| null`, `branch_id \| null`, `status`, `valid_from`, `valid_until \| null`, `role_status`, `permissions[{ code, status }]` |

**Granularidad decidida:** un snapshot por usuario más instalación/dispositivo. No se emite un snapshot por dispositivo que contenga todos sus usuarios.

**El snapshot es un reemplazo completo, no un delta.** La ausencia de una asignación significa ausencia de permiso.

**`cash_register_id` no pertenece al SAS.** Una caja es un recurso operativo, no un sujeto de autorización; el permiso se evalúa sobre `branch_id`. Incluirla mezclaría autorización con modelo de negocio.

**Separación estricta dentro del snapshot:** `user_id` es identidad; `assignments` es autorización; el entitlement no aparece aquí y pertenece a la licencia.

## Modelo de confianza criptográfica

- **Algoritmo:** Ed25519.
- **Canonicalización:** `canonicalJson`. La firma cubre bytes canónicos, nunca una serialización JSON ad hoc.
- **Trust anchor:** claves públicas provisionadas en la instalación, con estado `ACTIVE`, `VERIFY_ONLY` o `REVOKED`.
- **Rotación:** `VERIFY_ONLY` permite validar snapshots emitidos con la clave anterior sin admitir emisiones nuevas, de modo que la rotación no requiere ventana de corte.
- **Reloj:** `TrustedClockGuard` rechaza el retroceso del reloj local, impidiendo revivir un snapshot expirado. Coherente con `DEC-007`, que prohíbe usar el reloj del dispositivo como autoridad global.

Una firma inválida provoca el rechazo completo del snapshot. No existe aceptación parcial. Se conserva el snapshot anterior sólo si sigue siendo válido; en caso contrario se deniega toda operación de negocio.

## Expiración, offline y revocación

**TTL inicial: 24 horas.** Es una política configurable de despliegue, no una constante de negocio: no se codifica en `packages/domain`, que debe permanecer independiente de decisiones operativas.

Superado `expires_at`, el snapshot deja de ser autoridad y toda operación de negocio se deniega.

**No existe gracia offline para autorización.** La licencia admite gracia porque su fallo es comercial; el de autorización es de seguridad. No se extiende un privilegio expirado.

**Revocación:** se propaga emitiendo un snapshot posterior con `sequence` mayor y sin la asignación revocada.

**Riesgo aceptado y documentado:** mientras el dispositivo permanezca offline, una autorización revocada continúa siendo válida hasta `expires_at`. Es una limitación inherente al modelo offline y no se puede eliminar sin conectividad. El TTL es lo que acota la exposición, y por eso su valor es una decisión de seguridad y no de conveniencia. La ventana offline máxima y la ventana de exposición a revocación son la misma magnitud.

Al recuperar conectividad se refresca antes de aceptar la siguiente operación de negocio.

**Detección posterior:** toda operación se audita con el `snapshot_id` y la `sequence` utilizados. Una operación ejecutada offline bajo una autorización luego revocada no puede deshacerse, pero sí detectarse. Es un requisito de auditoría, no de prevención.

## Replay y versionado

- `sequence` monotónica por binding. **La autoridad emisora es responsable de garantizar esa monotonía.**
- El consumidor acepta únicamente una `sequence` estrictamente mayor que la máxima aceptada para ese binding. **El consumidor nunca genera ni negocia la autoridad de la secuencia.**
- Un snapshot con `sequence` menor o igual se rechaza como obsoleto o replay, aunque su firma sea válida.
- El binding a `installation_id` y `device_id` impide reutilizar el snapshot de un terminal en otro.

Un snapshot válido pero obsoleto es criptográficamente auténtico e igualmente rechazado: la firma prueba origen, no vigencia.

## Actualización local atómica

Orden obligatorio dentro de una única transacción SQLite: **verificar → validar → persistir → activar**.

- La verificación ocurre antes de cualquier escritura: un snapshot inválido no llega a activarse.
- Ante cualquier fallo, rollback completo y conservación del snapshot activo anterior.
- Nunca puede existir un estado parcialmente actualizado.
- Se reutiliza la infraestructura transaccional existente; no se construye otro gestor de transacciones.

## Puerto de arquitectura

```
AuthorizationProjectionPort
  fetchLatest(binding, knownSequence) → SignedSnapshot | null

AuthorizationSnapshotStore
  loadActive(binding) → VerifiedSnapshot | null
  replace(verified) → void          // atómico

VerifiedSnapshot → RoleAssignment[]  // adaptador hacia AUTHZ-001
```

El dominio no conoce el transporte. Sustituir infraestructura gratuita por API propia, servicio administrado o infraestructura paga cambia únicamente el adaptador de `AuthorizationProjectionPort`; `evaluatePermission()` y `packages/domain` quedan intactos.

## Autorización frente a licencia/entitlement

| | Licencia / entitlement | Autorización |
|---|---|---|
| Pregunta | ¿Está habilitado este módulo en esta instalación? | ¿Puede este usuario ejecutar esta acción? |
| Sujeto | Instalación / dispositivo | Usuario |
| Autoridad | Emisor de licencias (`LIC-003`, `DEC-008`) | `users → … → permissions` |
| Orden de evaluación | Antes | Después |

Ambas son necesarias y ninguna sustituye a la otra. Una licencia válida no concede permisos de negocio y un permiso válido no habilita un módulo no licenciado. Ambas fallan cerrado. Consistente con `DEC-008`, que ya establece que un derecho no equivale a permiso de usuario.

## Auditoría

Se registran, sobre la infraestructura append-only existente: recepción de un snapshot, aceptación, rechazo con causa (`SIGNATURE_INVALID`, `STALE_SEQUENCE`, `BINDING_MISMATCH`, `EXPIRED`), expiración, reemplazo por revocación y recuperación de conectividad.

Los registros de auditoría **nunca son fuente de autorización**. No se crea un sistema de auditoría paralelo.

## Prohibiciones

Quedan prohibidos, y el diseño los impide por construcción y no por convención:

- actores `DEVICE` con permisos de negocio;
- autorización basada únicamente en tenant, company, branch o device;
- seeds temporales;
- bypass;
- permisos implícitos;
- variables de entorno como autoridad de seguridad;
- certificados autofirmados como sustituto de confianza de producción.

## Invariantes y adaptación al costo

Conforme a la regla permanente `QUALITY-INVARIANT / COST-ADAPTIVE`:

**No disminuyen por volumen de clientes:** autorización fail-closed, integridad transaccional, auditoría append-only, aislamiento multi-tenant, idempotencia, seguridad de supply-chain y firma de releases.

**Sí se adaptan al volumen:** PostgreSQL, transporte, object storage, capacidad, redundancia y observabilidad.

Nunca se reduce una garantía de seguridad o integridad para conseguir costo cero.

## Qué queda decidido

Modelo SAS; autoridad central única; el snapshot local como proyección verificable y nunca como autoridad; reutilización exclusiva de la maquinaria criptográfica existente; binding a `installation_id` + `device_id` + `user_id`; granularidad por usuario y dispositivo; contenido mínimo sin `cash_register_id`; ausencia de gracia offline; propagación de revocación por snapshot posterior; monotonía de `sequence` responsabilidad del emisor; actualización atómica con rollback; puerto de transporte; y separación estricta entre autorización y entitlement.

## Qué queda configurable

El TTL, con valor inicial de 24 horas, expresado como política de despliegue y no como constante en `packages/domain`. La frecuencia de refresco y el transporte concreto también son configurables.

## Qué queda bloqueado

El trust anchor y el material criptográfico de producción permanecen `BLOCKED` hasta disponer de material real, por la misma razón que la firma de releases en `DEC-010`. No se admiten autofirmados como sustituto.

Los tests podrán utilizar material criptográfico generado exclusivamente para testing.

## Qué requiere una autoridad central futura

La emisión de snapshots, la garantía de monotonía de `sequence`, la propagación de revocaciones y el aprovisionamiento inicial del trust anchor. Ninguna de esas piezas existe hoy: no hay backend central.

En consecuencia, el lado consumidor puede construirse y probarse con snapshots firmados en los tests, pero **no habrá demostración end-to-end mientras no exista emisor**. Un POS que nunca conecta no puede operar; es una consecuencia aceptada del modelo fail-closed.

## Qué queda fuera de alcance

`LIC-003` y `DEV-003`; backend central y emisor; `CASH-001` y cualquier vertical comercial; sesión, MFA y revocación central; certificado real de producción; y cualquier tabla o migración, que requieren autorización específica.

## Consecuencias

Positivas: el POS puede autorizar offline sin convertir datos mutables en autoridad; el motor `evaluatePermission()` no cambia; el transporte es sustituible sin tocar el dominio; y la exposición a revocación queda acotada y medida en lugar de ser indefinida.

Negativas: se depende de una autoridad central que todavía no existe; un dispositivo sin conectividad prolongada deja de operar al expirar su snapshot; y la ventana de revocación offline no puede reducirse a cero.

## Referencias

`ADR-003` local-first, `ADR-005` stack objetivo, `DEC-007` autoridad por dato, `DEC-008` device trust y activación de licencia, `DEC-010` runtime del POS, `UC-CASH-001`, y AUTHZ-001 en `packages/domain/src/authorization` (PR #29).

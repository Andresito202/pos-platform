# D-3 — Preparación de autoridad central — 2026-09-16

## Estado

`IMPLEMENTATION / TRUST BOOTSTRAP RATIFIED / NON-PRODUCTION CENTRAL BOUNDARY`

D-3 es el objetivo técnico activo después de D-2. DEC-022 fue ratificada expresamente el `2026-09-16` y autoriza la implementación D-3 sobre la línea única activa. No se ha creado todavía una autoridad central productiva ni se ha convertido el persistence gate en runtime de producto.

## DEC-022

`docs/adr/DEC-022-trust-anchor-origin.md` está en estado `RATIFICADA — 2026-09-16`.

Quedan fijados para implementación:

- trust root propio del producto, verificado fuera de banda por fingerprint;
- instalación capaz de recibir material de confianza sin conectividad;
- separación estricta entre confianza de plataforma, transporte y aplicación;
- `DEVICE_TRUST` separado de licencias, sesiones y actualización;
- Ed25519 como mecanismo base;
- private key de dispositivo generada y protegida localmente;
- binding de tenant/company/installation/device;
- enrollment one-shot con evidencia auditable;
- autoridad central como emisora de credenciales;
- restore/clone no equivalente a trust;
- lifecycle de revocación/compromiso/retirement sin colapsar semántica de seguridad.

## Bloque materializado

La línea activa contiene:

- `packages/contracts/src/device-trust.ts` — contratos Zod para claves operativas `DEVICE_TRUST`, credenciales, challenge y proof-of-possession;
- `apps/pos-local-service/src/security/device-trust-verifier.ts` — cadena root → operational key → credential → proof con fail-closed;
- `apps/pos-local-service/src/security/device-enrollment-service.ts` — preparación local de enrollment y lifecycle auditado;
- `apps/pos-local-service/src/security/d3-device-registry-runtime.ts` — frontera de emisión de credenciales;
- `apps/pos-local-service/tests/device-enrollment-service.test.ts` — gates de lifecycle local;
- `apps/pos-local-service/src/security/d3-device-registry-runtime.test.ts` — gates de emisión y atomicidad contractual.

El runtime de emisión fue corregido para impedir una transición peligrosa: consumir una activación y después intentar persistir la credencial. La operación ahora exige un único método de repositorio `consumeActivationAndIssueCredential(...)`; su implementación debe realizar ambos cambios dentro de una sola transacción. Además, la firma se calcula antes del consumo para que un error criptográfico no queme una activación.

Este bloque está **IMPLEMENTED**. La ejecución real de typecheck/Vitest todavía requiere el entorno del repositorio; no se declara `TESTED` sin esa evidencia.

## Frontera central

La implementación productiva siguiente debe materializar la persistencia detrás del contrato anterior y después conectar la frontera autenticada:

```text
activation
  ↓
atomic consume + credential issuance
  ↓
DeviceCredential
  ↓
DeviceTrustVerifier
  ↓
proof-of-possession
  ↓
Central Device Registry
  ↓
authenticated central boundary
```

No se copia `central-sync-server.ts`. El servidor de persistence gate continúa siendo evidencia de D-2, no la autoridad de dispositivos.

## Gaps concretos restantes

1. Implementación PostgreSQL del repositorio de Device Registry.
2. Migración/ledger central para identidad y credenciales de dispositivo.
3. Endpoint central de enrollment separado de `/v1/sync/batches`.
4. Middleware de autenticación de dispositivo usando trust credential + proof-of-possession.
5. Revocación/rotación conectada al registry.
6. Provider de credencial para el outbox D-2 después de enrollment real.
7. Bootstrap de `SessionAssertionVerifier` con material de confianza realmente aprovisionado, sin claves fabricadas.
8. E2E de enrollment → authentication → session.
9. Evidencia runtime de seguridad.
10. Selección productiva verificable de KMS/HSM/secret manager y despliegue.

## No reabrir

No se vuelve a auditar ni modificar por preferencia:

- Payment/Cash/Sale aprobados;
- contratos de sync ya cerrados;
- arquitectura Local Service single-writer;
- separación renderer/preload;
- Ed25519/canonicalJson/TrustedClockGuard;
- D-2 como arquitectura de outbox/persistence.

Sólo evidencia de regresión o contradicción puede reabrir esas superficies.

## Evidencia y estados

```text
D-2                         TESTED / runtime evidence pendiente
DEC-022                     RATIFICADA
D-3 trust contracts         IMPLEMENTED
D-3 verifier                IMPLEMENTED
D-3 local enrollment        IMPLEMENTED
D-3 issuance boundary      IMPLEMENTED
D-3 central persistence    PENDIENTE
D-3 central authentication PENDIENTE
D-3 session bootstrap      PENDIENTE
D-3 security E2E            PENDIENTE
D-3 runtime VERIFIED        NO
D-3 production              NO
```

## Siguiente bloque cohesivo

```text
PostgreSQL Device Registry
        ↓
atomic enrollment transaction
        ↓
central enrollment endpoint
        ↓
DeviceTrust authentication middleware
        ↓
credential provider for D-2
        ↓
session bootstrap
        ↓
real SESSION assertion path
        ↓
security E2E
```

La implementación debe reutilizar los contratos e invariantes ya materializados y no crear una segunda arquitectura de sync ni una segunda autoridad de persistencia.

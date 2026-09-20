# D-3 — Preparación de autoridad central — 2026-09-16

## Estado

`IN_PROGRESS / DEC-022 RATIFICADA / NON-PRODUCTION AUTHORITY LAYER`

D-3 está autorizado y continúa sobre la única línea de desarrollo activa. DEC-022 fue ratificada el 2026-09-16. La ratificación fija la raíz de confianza, el enrollment de un solo uso, la identidad criptográfica del dispositivo, el binding y el fail-closed como invariantes; no convierte automáticamente estos componentes en producción.

D-2 permanece pendiente de ejecución real del persistence gate. El bloqueo de GitHub Actions por billing es operativo y no constituye evidencia de PASS ni FAIL del código.

## Materializado

- contratos Zod de device trust y enrollment;
- verificador Ed25519 fail-closed;
- autenticador de frontera preparado;
- device registry contracts;
- boundary de credential issuance;
- enrollment runtime;
- emisión atómica: consumo de activation y persistencia de credential deben ocurrir en una única transacción del repositorio;
- migración PostgreSQL `004_device_trust` como artifact, con tablas de registry, credentials, one-shot activations y authentication events;
- descriptor y runner 004 con dependencia exacta de 003, checksum derivado del artifact, advisory lock global y ledger `platform.target_migration_executions`;
- gate de descriptor para columnas, dependencia y artifacts.

## Regla de atomicidad

No se acepta el patrón:

```text
consume activation
→ emitir/persistir credential
```

El límite autorizado es:

```text
firmar credential
→ BEGIN
   consumir activation
   persistir credential
  COMMIT
```

Si la transacción falla, la activation no puede quedar consumida sin credential durable.

## Cadena D-3

```text
trust anchor product-owned
        ↓
operational DEVICE_TRUST key
        ↓
device credential / proof-of-possession
        ↓
installation_id + device_id + tenant/company binding
        ↓
Central Authority
        ↓
Session bootstrap
```

TLS protege el transporte pero no sustituye device trust. Un bearer token tampoco es identidad criptográfica del dispositivo. La private key del dispositivo permanece local y fuera del renderer/preload.

## Ownership

```text
Devices       → device registry, lifecycle, device identity
Authorization → user/session authorization
Licensing     → license state
Audit         → security evidence
Sync          → transport, outbox, checkpoints
Central       → trust lifecycle, credentials, revocation, central configuration
Local Service → local operational facts and single-writer SQLite/WAL
```

Central Authority no reescribe ventas, caja, inventario o pagos locales confirmados.

## Gaps restantes

1. Integración del descriptor 004 con el ledger/runner canónico de migraciones sin duplicar autoridad.
2. Implementación PostgreSQL real del `DeviceRegistryRepository` con enrollment atómico.
3. Endpoint central de enrollment con validación completa del contrato y activation secret.
4. Autenticación central usando credential + proof-of-possession + revocation + binding.
5. Registro durable de eventos de autenticación.
6. Integración del resultado de device authentication con el bootstrap real de Session.
7. E2E de replay, revocation, rotation, binding, restore/clone denial y fail-closed.
8. Ejecución real de typecheck/Vitest y gates en CI o entorno controlado.
9. Runtime evidence de Central Authority.
10. Selección operativa verificable de KMS/HSM/secret manager para producción.

## No hacer

- no copiar `central-sync-server.ts` para crear una falsa autoridad;
- no crear un segundo endpoint de sync;
- no usar `.env`/fixtures como credenciales productivas;
- no reabrir Payment/Cash Shift/Sale/Inventory sin regresión o contradicción;
- no modificar DEC-008, DEC-010, ownership ni contratos cerrados para facilitar D-3;
- no declarar `TESTED`, `VERIFIED` o `PRODUCTION` sin evidencia ejecutable correspondiente.

## Estado de evidencia

```text
DEC-022                    RATIFICADA
D-2 outbound sync          IMPLEMENTED / runtime pendiente
D-3 trust contracts       IMPLEMENTED
D-3 verifier              IMPLEMENTED
D-3 enrollment             IMPLEMENTED / atomic boundary materialized
D-3 DB artifact            IMPLEMENTED / no aplicado todavía
D-3 migration runner       IMPLEMENTED / no ejecutado todavía
D-3 central repository     PENDIENTE
D-3 central endpoint       PENDIENTE
D-3 session bootstrap      PENDIENTE
D-3 security E2E           PENDIENTE
D-3 runtime VERIFIED       NO
Production                NO
```

## Próximo bloque cohesivo

```text
PostgreSQL DeviceRegistryRepository
        ↓
atomic enrollment transaction
        ↓
central enrollment endpoint
        ↓
authenticated device boundary
        ↓
device credential lookup/revocation
        ↓
real Session bootstrap
```

Ese bloque es el siguiente objetivo. No se debe volver a construir ni auditar desde cero lo que ya está materializado salvo evidencia de regresión o contradicción.

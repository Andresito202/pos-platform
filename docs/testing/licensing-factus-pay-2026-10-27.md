# Cierre del ingreso FACTUS Pay

Continuidad: c0657d00 → e32011b6 (017) → 72568f93 (capacidad local) →
143fd17e (checkpoint WIP publicado). Este incremento corrige y verifica el WIP;
no integra la rama histórica completa de PR #93 ni modifica 009 WebAuthn.

## Materializado

- Delta específico de PR #93, head 9804cdc1: normalización/handler y repository
  adaptados al runtime activo; no se trae su CLI de registro sin GLOBAL/MFA.
- 018 registrada en el mismo runner/lock/ledger, selector --factus-pay. Exige
  003 y 006 auténticas antes de DDL; conserva manifiestos AUTH 008–016 y precios
  008–017. Aplicación e idempotencia físicas, sin migraciones productivas.
- Main Central monta el handler en HTTPS sólo con
  CENTRAL_FACTUS_PAY_PROVISION_FILE. Perfil CAMACHO_FACTUS_PAY_INGRESS_V1,
  policy_reference, checksum 018, max_body_bytes, lock_timeout_ms,
  statement_timeout_ms y rate_limit {maximum,buckets,window_ms} obligatorios.
  No contiene secretos; no hay valores operativos productivos elegidos.
- Autenticación mediante hash de llave → tenant derivado de SQL → RLS de 002;
  revalida integración/binding con locks antes del commit. Sin ampliar acceso
  entre empresas. Límites por socket antes de consultar la llave.
- Inbox normalizado, deduplicación y auditoría en un commit. Ningún 2xx antes
  de persistencia. Conflictos de importe fallan sin sobrescribir evidencia.
  UPDATE limitado a columnas de proceso/revocación y triggers de inmutabilidad.
- Validador 003 reconoce únicamente sucesores registrados 014 y 018, mediante
  checksum APPLIED. Conserva su fingerprint original excluyendo sólo las tablas
  propias de 018; se comprobó físicamente el catálogo completo tras aplicar 018.

Referencia oficial consultada 2026-10-26:
https://pay-developers.factus.com.co/webhooks/ . La llave viaja en query; el
operador debe redactarla en logs del proxy. El callback sólo observa; la API,
correlación monetaria y transacción de activación todavía no están conectadas.

## Evidencia observada

Reportes locales en artifacts/licensing/2026-10-26 (ignorados por Git):

| Reporte | Resultado | SHA256 |
|---|---|---|
| factus-ingress-unit-final.json | 12 PASS, 0 FAIL | e098615eacb0eec1231224a52fa0f0bf78950b893a183f50b32b6f6dfff7cd56 |
| factus-physical-final.json | 1 escenario integrado PASS | e676cc472922e377eff7f523a5e2b78b4a0cef549713e4116b7598e9bd318bf5 |
| factus-predecessor.json | 1 PASS, 5 anteriores filtradas | 301214f4fcb803bb15e77cd8c381fa9b21818d2bb913c417284283da923a222a |

El escenario físico cruza HTTPS con CA efímera validada → runtime montado →
PostgreSQL 16.14 temporal, rol pos_platform_app real sin bypass. Dos tenants,
cinco duplicados concurrentes, importe alterado, tenant inyectado, llave/binding
revocados, inmutabilidad, fallo de auditoría/rollback/reintento, down con historial
rechazado. Cero licencias activadas. Fixtures no son pagos FACTUS auténticos.

Comandos reproducibles (POSTGRES_TEST_URL sólo localhost:55433 temporal):

```powershell
pnpm --filter @pos-platform/central-authority exec vitest run tests/factus-pay-physical.test.ts
pnpm --filter @pos-platform/central-authority exec vitest run tests/factus-pay-collection-event.test.ts tests/factus-pay-webhook-handler.test.ts
pnpm --filter @pos-platform/target-migrations exec vitest run tests/postgres-commercial-runner-physical.test.ts -t 'factus successor:'
```

TypeScript contracts/database-postgres/Central/target-migrations PASS.
ARCH-003 y política del repositorio PASS. El Service win32-x64 ya se construyó
en el incremento de capacidad; no hay cambios de renderer ni E2E visual nuevo.
No se repitieron suites cerradas de login, comercio o caché.

Fallos corregidos: fixture sin btree_gist; roles perdidos tras reinicio tmpfs
(fixture usa ahora applyPostgres001 canónico); dos nombres locales duplicados
y tipo demasiado estrecho en validador; 003 rechazaba columnas legítimas 014 y
fingerprint incluía 018; fixture intentaba saltar estados/binding de 002.
No se quitaron guards para aprobar las pruebas.

## Aún no cerrado

Interno: transporte/panel GLOBAL autenticado; cotización durable y coordinación
con Payments; consulta autoritativa FACTUS API; productor de capacidad central
desde pago y distribución; emisión fiscal de suscripción y notificación durable.
El owner Subscriptions queda explícito, sin segundo Payment ni licencia paralela.

Externo: política fiscal/soporte (el propietario confirmó que no está definida),
precios reales, identidad fiscal/contactos verificados, cuenta/comercio receptor,
binding/credenciales/URL HTTPS FACTUS y raíz de licencias auténticos. No hay
Central/DEV-003 ni persona certificada. PR #96 Draft; PR #93 sin merge; CI remoto
pendiente y no consultado/ejecutado. No compra real, factura enviada o producción.

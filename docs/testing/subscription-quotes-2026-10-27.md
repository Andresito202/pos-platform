# Cotizaciones persistentes

Base 186fbcf1970f0deb8b187c5fea78d700d198bb2b. Sólo incremento de Subscriptions;
017/018 y capacidad V2 intactas. Nuevo 019 en runner canónico opt-in.

Observado: dos escenarios integrados PASS, cero FAIL finales, PostgreSQL 16.14
temporal localhost:55433, contenedor Running sin mounts persistentes y con tmpfs.
Creación/idempotencia de 019; manifiestos previos intactos; MONTHLY/ANNUAL/PERPETUAL,
una caja incluida y adicionales cotizadas, precio backend congelado ante nueva
publicación, rechazo de precio cliente/plan retirado/empresa inexistente,
concurrencia con un solo insert, expiración, MFA/grant actuales, ausencia de
políticas rechazada, inmutabilidad y rollback por fallo de auditoría.

```powershell
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm --filter @pos-platform/central-authority exec vitest run tests/subscription-quotes-physical.test.ts --reporter=json --outputFile=../../artifacts/licensing/2026-10-27/subscription-quotes-final.json
```

TypeScript Central/contracts/runner, ARCH-003 y política PASS. No se repitieron
suites de login, 017/018 ni capacidad. El fixture usa sus fundamentos como setup,
sin reclasificar esas pruebas como nuevas. No existe build propio de Central:
se ejecuta mediante tsx; no se anuncia un build que no figura en package.json.

Fallos corregidos: esquema SQL authorization sin comillas y propiedad readonly
en fixture; después, FK audit_events_tenant_session_fk rechazó correctamente una
sesión GLOBAL mezclada con tenant. El evento ahora conserva scope GLOBAL y lleva
el destino en evidencia. No se relajaron constraints ni permisos.

Nivel: IMPLEMENTED/TESTED interno. No CALLER_REACHABLE vía producto, no compra ni
producción. Las identidades, precios y resultados fiscales de pruebas son fixtures
explícitas, no datos ni políticas aprobadas. No se confirmó pago ni emitió licencia.

Bloqueo de paso 1: el panel AdministrativeControlPanel(kind=superadmin) existente
no tiene formularios de planes; sus tarjetas son marcadores sin lectura GLOBAL.
central-administration.ts declara expresamente contexto interno, no API. La única
autoridad/ceremonia HTTP montada emite BUSINESS. Sin transporte/emisor GLOBAL
autenticado, conectarlo por UUID o reutilizando el bearer BUSINESS violaría los
contratos. Se mantiene sin conexión; no se reconstruye ni amplía ese login bajo
la prohibición expresa del incremento. Falta resolver ese contrato de montaje.

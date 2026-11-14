# Cotización → verificación API → Payments y outbox

Base 186fbcf1970f0deb8b187c5fea78d700d198bb2b; cotizaciones publicadas en
ed7aced6. Incremento interno, sin endpoints ni credenciales productivas.

## Materializado

- 020 en runner canónico opt-in `--subscription-payments`, después de 019;
  selectores anteriores conservados. Agregados canónicos Payments, intentos y
  asignaciones, historial protegido, permisos por columna y aislamiento de roles.
- Reserva de intención antes del proveedor; no implica QR creado ni pago.
- GET de colección por referencia inmutable en origen oficial fijo, con TLS,
  límites explícitos, custodia vinculada a cuenta/empresa/integración/generación.
  Correlación de comprador/cotización, receptor, referencia, importe y COP.
- Evidencia opaca local de un uso; consumo con revalidación y locks actuales.
  Confirmación financiera, asignación, auditoría y Operation/Outbox de Sync
  existentes comparten COMMIT. Un fallo consume evidencia pero revierte efectos;
  recuperación requiere nueva consulta API. No se activa ninguna licencia.
- Revocación de permisos durante espera impide cotizar. Reutiliza bloqueo 015;
  no altera SQL 017/018, capacidad V2, login ni frontend.

## Evidencia observada

PostgreSQL 16.14 temporal en localhost:55433; bases aleatorias creadas y
eliminadas por fixture, contenedor tmpfs sin mounts persistentes.

```powershell
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm --filter @pos-platform/central-authority exec vitest run tests/subscription-quotes-physical.test.ts --reporter=json --outputFile=../../artifacts/licensing/2026-10-27/billing-final.json
pnpm --filter @pos-platform/central-authority exec vitest run tests/subscription-quotes-physical.test.ts -t 'FACTUS API:' --reporter=json --outputFile=../../artifacts/licensing/2026-10-27/payment-outbox-final.json
```

Primera ejecución: 4 PASS, 0 FAIL. Tras añadir outbox: 1 PASS, 0 FAIL,
3 filtradas; se repitió sólo el escenario afectado. No sumar repeticiones como
pruebas distintas. Incluye migración/idempotencia, concurrencia, evidencia
falsa/repetida/vencida, importe/referencia/moneda/credencial incorrectos,
revocación durante HTTP, timeout/cancelación, fallo de auditoría y outbox con
rollback financiero, aislamiento y protección del historial. La confirmación
concurrente produce una asignación y un outbox confirmado.

SHA-256 de payment-outbox-final.json:
`0e49c89d58c6ac780a536c014bee67de8e859d9c7b975e28b01f7be16502edd8`.
TypeScript Central/database-postgres/runner, ARCH-003, política del repositorio
y git diff --check: PASS. No build propio de Central definido en package.json;
no se repitieron builds Electron ni suites cerradas ajenas al cambio. CI remoto
no ejecutado por instrucción del propietario. PR #96 se conserva Draft.

El servidor HTTPS es un fixture local con CA efímera y validación SNI del host
oficial mediante transporte inyectado sólo en prueba. NO se llamó a FACTUS real,
no demuestra cuenta sandbox ni dinero real. Tokens/precios/identidades son
fixtures. No se modificaron bases comerciales. Fallos iniciales corregidos:
lock de lectura sobre quote inmutable exigía UPDATE (se quitó el lock, no se
concedió permiso); fixture de rotación incumplía transición (ahora nueva
generación y estados canónicos). Fallos previos de cotización: ver su informe.

## Pendientes concretos

1. Transporte/emisor GLOBAL autenticado y montaje del panel existente: contexto
   interno GLOBAL no equivale a bearer HTTP; BUSINESS no concede ese acceso.
2. Montar custodia auténtica del token FACTUS y dispatcher de creación/consulta
   de recaudos. El outbox durable no equivale a consumidor ejecutándose.
3. Productor central de capacidad y distribución: reconciliar primero el
   contrato license_activations (IDs UUID de claves legado frente a IDs SPKI
   textuales actuales), fuente central de cajas y operación DeviceProof para
   provisión. No inventar cajas ni reutilizar propósito de firma distinto.
4. Pipeline fiscal para cotizaciones y entrega transaccional: no reutilizar
   una venta ficticia; faltan mapeo fiscal aprobado, datos verificados, servicio
   de correo y evidencia de entrega. No están implementados estos consumidores.
5. Políticas fiscales/soporte todavía no definidas, precios publicados y
   credenciales/cuenta/infraestructura auténticos. Cobros reales bloqueados.

Nivel observado: IMPLEMENTED/TESTED interno. No CALLER_REACHABLE desde producto,
no certificación humana, compra real, factura, correo ni licencia activada.

Fuentes del adaptador: [consulta oficial](https://pay-developers.factus.com.co/recaudos/ver/)
y [webhooks oficiales](https://pay-developers.factus.com.co/webhooks/).

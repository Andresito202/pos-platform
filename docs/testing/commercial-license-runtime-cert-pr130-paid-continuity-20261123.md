# PR #130 — continuidad de recaudo sandbox y simulador oficial FACTUS Pay

**Rama:** `cursor/commercial-license-global-c53a`  
**PR:** #130 (Draft)  
**HEAD de referencia previa:** `84158415c5de2619905114aed202c6228715f1fc`  
**Ejecución certificada previa:** Actions #1660 (`POSTGRES_035` + auth + collection open/get PASS; `provider_paid_observed=false`)

## Conclusión

`RUNTIME_VERIFIED` = **false** (NOT_VERIFIED)

No se declara pago confirmado, licencia emitida ni activación de dispositivo sin observación auténtica `status=paid` del proveedor.

## Qué ya estaba certificado (#1660)

| Capacidad | Estado |
|---|---|
| PostgreSQL 16.14 + migración 035 | PASS |
| Autenticación FACTUS Pay sandbox | PASS |
| Crear colección + GET vía adaptador Central | PASS |
| Coincidencia referencia/importe/COP | PASS |
| Suites autónomas de emisión | PASS |
| `provider_paid_observed` | false (`ready` ≠ `paid`) |

## Defecto corregido (continuidad)

El observador generaba un UUID nuevo, usaba expiración de 900s y no ofrecía canal privado de QR, lo que impedía pagar el mismo recaudo después.

### Cambios

- Continuidad durable: misma `reference_code` + `amount_scale6` + COP inmutables (`apps/central-authority/src/pr130-lab-collection-continuity.ts`).
- Expiración 86400s (default oficial FACTUS).
- QR sólo en `CAMACHO_PRIVATE_OPERATOR_DIR` (0600); nunca en artefactos/PR/logs.
- Modos `prepare` / `poll` / `observe`.
- Cotización idempotente ahora conserva `provider_reference` y recupera el mismo recaudo.
- `enqueuePendingProviderPoll` para confirmar vía GET autoritativo sin inventar `paid`.
- Lab `pr130-lab-paid-fulfillment.ts`: seed efímero + `SubscriptionLicenseFulfillment` sólo si el proveedor responde `paid`.

## Simulador oficial (humano, obligatorio)

Documentación: https://pay-developers.factus.com.co/sandbox/simulator/  
Herramienta: https://pay-api-sandbox.factus.com.co/simulator  

Procedimiento documentado: escanear el QR del recaudo sandbox y elegir el escenario de pago exitoso. **No existe** endpoint de API para forzar `paid`; no se inventan respuestas HTTP.

### Acción exacta del propietario

1. En máquina privada (no GitHub-hosted):

```bash
export CAMACHO_COMMERCIAL_RUNTIME_CERT=OWNER_AUTHORIZED_COMMERCIAL_RUNTIME_CERT
export PR130_LOCAL_OPERATOR=true
export CAMACHO_PRIVATE_OPERATOR_DIR="$HOME/.camacho/pr130-private"
export CAMACHO_CERT_EVIDENCE_DIR="$HOME/.camacho/pr130-evidence"
export REVIEWED_SHA="$(git rev-parse HEAD)"
export FACTUS_PAY_SANDBOX_EMAIL=...   # no commitear
export FACTUS_PAY_SANDBOX_PASSWORD=...
export PR130_COLLECTION_MODE=prepare
pnpm --filter @pos-platform/central-authority exec tsx ../../tools/operators/pr130-factus-pay-collection-observation.ts
```

2. Abrir `$CAMACHO_PRIVATE_OPERATOR_DIR/collection-qr.png` (privado).
3. En el simulador oficial: Iniciar Cámara → escanear QR → “Sin error (pago exitoso)” → Simular pago.
4. Guardar como secretos de repositorio (no en PR):
   - `PR130_SANDBOX_COLLECTION_REFERENCE` = `reference_code` del JSON privado
   - `PR130_SANDBOX_COLLECTION_AMOUNT` = `amount_scale6` (p. ej. `150000.000000`)
5. Dispatch del job `commercial-license-runtime-cert` en la misma rama con `OWNER_AUTHORIZED_COMMERCIAL_RUNTIME_CERT`.
6. El job hará `poll` + fulfillment lab sólo si el GET Central observa `paid`.

## Niveles honestos tras este cambio de código

| Nivel | Estado |
|---|---|
| IMPLEMENTED (continuidad + poll + enqueue GET) | sí |
| CI_PASS tip | pendiente de CI en el nuevo HEAD |
| PROVIDER_PAID_OBSERVED | **no** hasta pago simulador + GET `paid` |
| LICENSE_ISSUED | **no** hasta fulfillment tras `paid` |
| DEVICE_ACTIVATED | **no** (canal de activación no disponible en lab) |
| RUNTIME_VERIFIED | **false** |

## Restricciones respetadas

- Sin otra PR; sin merge a `main`.
- Gate wave7 FACTUS excepcional no modificado.
- Sin forjar `paid`, sin dinero real, sin QR/credenciales en artefactos públicos.

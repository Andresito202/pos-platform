# Custodia sandbox FACTUS / FACTUS Pay — procedimiento de operador

Fecha: 2026-11-17. Sin secretos. No certifica producción ni DIAN.

## Nombres exactos (no inventar otros)

### FACTUS facturación electrónica (OAuth2)

Variables **sólo para la suite de sandbox** (`pnpm test:fiscal-adapters` / `factus-sandbox.test.ts`):

- `FACTUS_SANDBOX_CLIENT_ID`
- `FACTUS_SANDBOX_CLIENT_SECRET`
- `FACTUS_SANDBOX_USERNAME`
- `FACTUS_SANDBOX_PASSWORD`

Runtime del POS Local Service: **no lee esas variables**. Depositar en el almacén cifrado SEC-004:

```text
pnpm --filter @pos-platform/pos-local-service deposit-credential
```

Stdin JSON (nunca argv ni env de proceso):

```json
{
  "provider": "FACTUS",
  "environment": "SANDBOX",
  "fields": {
    "client_id": "<desde gestor de secretos>",
    "client_secret": "<…>",
    "username": "<…>",
    "password": "<…>"
  }
}
```

Requiere `POS_COMPANY_ID`, `POS_INSTALLATION_ID`, `POS_DEVICE_ID`, `POS_DATA_DIRECTORY`, `POS_FISCAL_ENVIRONMENT=SANDBOX`. El secreto queda acotado a la **empresa** autorizada (AAD v2). Una caja no resuelve credenciales de otra empresa.

### FACTUS Pay (recaudos Caja)

Suite / laboratorio (no se commitean valores):

- `FACTUS_PAY_SANDBOX_EMAIL`
- `FACTUS_PAY_SANDBOX_PASSWORD`

Runtime Caja:

```text
pnpm --filter @pos-platform/pos-local-service deposit-factus-pay-credential
```

Stdin JSON:

```json
{
  "environment": "SANDBOX",
  "email": "<…>",
  "password": "<…>"
}
```

Token: se obtiene con `POST /auth` y se cachea cifrado; un segundo `/auth` invalida el token anterior (mutex en el cliente). Suscripciones Central siguen usando `CENTRAL_FACTUS_PAY_*` / DPAPI Windows — **no** mezclar con Caja.

## Operación comercial

1. Admin: `fiscal.numbering.sync` (FiscalPanel → «Sincronizar rangos»).
2. Tras venta cobrada: emitir `SALES_INVOICE` (`fiscal.document.issue`).
3. Nota crédito: sólo con factura `COMPLETED`+`ACCEPTED` de la misma venta.
4. Caja FACTUS Pay: «Generar QR» → cliente paga → «Verificar» (GET proveedor). Generar QR **no** cobra la venta.
5. Webhook Central: observación durable; **no** confirma venta ni licencia.

## Pruebas reales

Sin las cuatro variables FACTUS / el par Pay depositado, las suites sandbox se omiten (`describe.skipIf`). No fabricar respuestas del proveedor.

## Gate excepcional vía GitHub Actions (autorizado por el propietario)

No forma parte del CI ordinario ni de PRs. Workflow: `.github/workflows/factus-sandbox-exceptional-gate.yml` (`workflow_dispatch` únicamente).

### Cómo activarlo desde el celular

1. Abrir en el navegador: `https://github.com/Andresito202/pos-platform/actions/workflows/factus-sandbox-exceptional-gate.yml`
2. Iniciar sesión en GitHub si hace falta.
3. Pulsar **Run workflow**.
4. Rama: `cursor/commercial-design-review-0d11` (única autorizada).
5. `owner_authorization`: escribir exactamente `OWNER_AUTHORIZED_SANDBOX_ONLY`.
6. `reviewed_sha`: el SHA de 40 caracteres del commit revisado (por ejemplo el HEAD actual de esa rama).
7. Pulsar el botón verde **Run workflow**.
8. Esperar el job; descargar el artifact `factus-sandbox-exceptional-<sha>` (JSON redactado).

### Límites de claim

- El gate emite `OBSERVED_PASS` / `OBSERVED_FAIL` / `BLOCKED` / `NOT_AVAILABLE` por paso.
- **No** declara `SANDBOX_VERIFIED` automáticamente.
- FACTUS Pay: el simulador oficial de pago es UI (`https://pay-api-sandbox.factus.com.co/simulator`); no hay API headless de pago simulado. Sin escaneo en el simulador, el estado permanece el observado por GET.
- Producción y dinero real están prohibidos.

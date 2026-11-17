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

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

GitHub sólo lista workflows presentes en `main`. Por eso **no** hay un workflow
independiente `factus-sandbox-exceptional-gate.yml` ejecutable sin merge.

Se reutiliza el workflow ya existente en `main`:
**TARGET foundation validation**
(`.github/workflows/target-foundation-validation.yml`), con un job opcional
`factus-sandbox-exceptional` que sólo corre en `workflow_dispatch` cuando:

- rama = `cursor/commercial-design-review-0d11`
- `run_factus_sandbox_exceptional` = true
- `owner_authorization` = `OWNER_AUTHORIZED_SANDBOX_ONLY`

Los seis secretos se inyectan **sólo** en el paso de ejecución sandbox; el CI
ordinario de ese dispatch se omite.

### URL funcional (celular)

https://github.com/Andresito202/pos-platform/actions/workflows/target-foundation-validation.yml

### Cómo activarlo desde el celular

1. Abrir la URL anterior (iniciar sesión si hace falta).
2. Pulsar **Run workflow**.
3. Rama: `cursor/commercial-design-review-0d11` (obligatoria; usa el YAML de esa rama).
4. `run_factus_sandbox_exceptional`: **true**.
5. `owner_authorization`: `OWNER_AUTHORIZED_SANDBOX_ONLY`.
6. `reviewed_sha`: **dejar vacío** (usa el tip del dispatch) **o** pegar el tip actual de la rama. El job **rechaza** SHA atrasados (p. ej. `98513aae`); no reutilizar el SHA del hallazgo original.
7. Pulsar el botón verde **Run workflow**.
8. Esperar el job **FACTUS sandbox exceptional (owner authorized)**; descargar el artifact `factus-sandbox-exceptional-<sha>`.
9. Si FACTUS queda `OBSERVED_FAIL kind=INCOMPLETE`, el JSON del artifact incluye `findings=` (código/campo/diag) sin secretos. Pay puede pasar aunque FACTUS falle.

### Comparación OAuth vs colección Postman oficial (`api-factus-v2.json`)

| Dimensión | Postman oficial | Adapter Camacho | Docs Node/PHP Factus |
|---|---|---|---|
| Endpoint | `{{url_api}}/oauth/token` | `https://api-sandbox.factus.com.co/oauth/token` | igual |
| Método | POST | POST | POST |
| Accept | `application/json` | `application/json` | `application/json` |
| Cuerpo | `formdata` (multipart) | `application/x-www-form-urlencoded` | `urlencoded` / `asForm()` |
| Params | `grant_type,client_id,client_secret,username,password` | mismos nombres | mismos |

Probe sin secretos reales (2026-11-17): urlencoded y multipart responden igual (`401` / `invalid_client`) con credenciales inventadas → la codificación no explica el rechazo; hace falta el código OAuth del proveedor con los secretos reales (`invalid_client` vs `invalid_grant`).

El gate exceptional ejecuta `oauth_encoding_probe` (ambos encodings) y registra sólo `http_status` + `oauth_error` allowlisted.

### Límites de claim

- El gate emite `OBSERVED_PASS` / `OBSERVED_FAIL` / `BLOCKED` / `NOT_AVAILABLE` por paso.
- **No** declara `SANDBOX_VERIFIED` automáticamente.
- FACTUS Pay: el simulador oficial de pago es UI (`https://pay-api-sandbox.factus.com.co/simulator`); no hay API headless de pago simulado. Sin escaneo en el simulador, el estado permanece el observado por GET.
- El job fija `NODE_ENV=test` sólo en el paso sandbox para el almacén efímero `InsecureDerivedKeyProvider` (TEST_ONLY). No es un claim de producto.
- Ante `OBSERVED_FAIL` o crash, el gate **siempre** escribe `evidence-*.json` redacted en el artifact (no subir peldaño; sólo evidencia).
- Producción y dinero real están prohibidos.

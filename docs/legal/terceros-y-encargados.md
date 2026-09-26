# Terceros que reciben datos — Camacho POS Colombia

> **BORRADOR — DOCUMENTED únicamente. No publicar sin revisión de abogado colombiano y sin completar los campos [PENDIENTE].**
> Este texto no es asesoría legal. Redactado el 2026-09-26 a partir del repositorio en la rama
> `feat/payment-qr-provider-foundation`.

## 1. Criterio

Aquí sólo aparece un tercero si el repositorio muestra que recibe o podría recibir datos. Cada
fila dice si la integración **tiene código** o **sólo está diseñada**. Un tercero diseñado no
recibe hoy ningún dato; se lista para que su incorporación futura no pase desapercibida.

## 2. Terceros con código

| Tercero | Para qué | Qué datos recibe | Evidencia | País |
|---|---|---|---|---|
| **Factus** (proveedor tecnológico de facturación electrónica) | Emitir la factura electrónica del Comercio y transmitirla a la DIAN | El cuerpo completo de la factura, que incluye los datos del adquiriente (identificación, nombre o razón social, correo, teléfono, dirección) y los ítems vendidos | `packages/fiscal-adapters/src/factus/environment.ts:11` (`https://api.factus.com.co`); cuerpo congelado en `fiscal_electronic_document.payload_json` (`packages/database-sqlite/src/local-database.ts:1684`) | [PENDIENTE — país de procesamiento de Factus] |
| **Wompi** (pasarela de pagos) | Cobrar por QR o enlace de pago y confirmar la transacción | Referencia del pago, monto y moneda. El pagador escribe sus datos de pago **en la página de Wompi**, no en el POS. Wompi puede devolver el correo del pagador, que el POS guarda | `apps/pos-local-service/src/payments/wompi/wompi-http-client.ts:16`; `wompi-checkout-builder.ts:34`, `:65-71`; correo devuelto: `wompi-transaction.ts:26`, `:86-87` | [PENDIENTE — país de procesamiento de Wompi] |
| **DIAN** (autoridad tributaria) | Recibir la factura electrónica, por obligación legal | Lo que contiene la factura. **El POS no se conecta directamente con la DIAN**: la transmisión la hace Factus | `docs/architecture/electronic-invoicing.md` | Colombia |

En los tres casos **el Comercio es el Responsable** de los datos de su cliente y la Plataforma
actúa como Encargado (`politica-tratamiento-datos.md` §2).

## 3. Terceros sólo diseñados (no reciben datos hoy)

| Tercero | Para qué | Estado | Evidencia |
|---|---|---|---|
| Siigo | ERP, contabilidad y facturación | `DESIGNED` / `NOT_EVALUATED` | `docs/architecture/provider-integration-matrix.md:15` |
| Alegra | ERP, contabilidad, ventas | `DESIGNED` / `NOT_EVALUATED` | `docs/architecture/provider-integration-matrix.md:17` |

Si alguno pasa a tener código, esta tabla y la política se actualizan **antes** de activarlo.

## 4. Declaración: no se usa analítica de terceros

A la fecha de este borrador **el software no envía datos a ningún servicio de analítica,
telemetría, publicidad ni seguimiento**. Ninguna dependencia de ejecución del producto es un SDK de
ese tipo. Medido el 2026-09-26 leyendo todos los `package.json` del monorepo: hay **28**
dependencias externas —`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-fastify`,
`@playwright/test`, `@testing-library/react`, `@types/*` (5), `@vitejs/plugin-react`,
`better-sqlite3`, `electron`, `esbuild`, `jsdom`, `kysely`, `nx`, `pg`, `playwright`, `react`,
`react-dom`, `reflect-metadata`, `rxjs`, `tsx`, `typescript`, `vite`, `vitest` y `zod`— y ninguna
lo es. Fastify registra con `pino`, una biblioteca de logs que escribe en la salida del propio
proceso: no envía nada a terceros. Los únicos
hosts externos que el código de producción contacta son los de Factus y Wompi (§2).

`docs/security/secret-key-and-support-management.md:332` prohíbe además la telemetría no autorizada
en la modalidad `LOCAL_PERPETUAL`.

Si en el futuro se incorpora analítica, se declarará aquí, con su finalidad y los datos que reciba,
antes de activarla.

## 5. Decisiones pendientes que añadirían terceros

| Decisión | Por qué añadiría un tercero | Estado |
|---|---|---|
| Alojamiento del servicio central | El proveedor de nube procesaría todos los datos centrales | [PENDIENTE — proveedor de alojamiento y país] |
| Lista de contraseñas filtradas (`DEC-026`, brecha `G-9`) | Si se consulta un servicio externo, ese servicio recibe una derivación de cada contraseña nueva | abierta |
| Correo transaccional | Hoy no existe: la recuperación de cuenta **no usa correo** (`DEC-026` §10). Si se añade, el proveedor de correo sería un tercero | no previsto |

## 6. Herramientas usadas para construir el software

No reciben datos de usuarios. Se declaran por transparencia en `declaracion-uso-ia.md`.

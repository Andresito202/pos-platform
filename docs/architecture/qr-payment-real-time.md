# QR-001 — Pago QR en tiempo real

> **Estado de integración (2026-11-13):** el diagrama siguiente representa la arquitectura objetivo, no una cadena de abono bancario verificado en producción. Los contratos QR-001 son parte de esta línea. El flujo QR-002 con observaciones de teléfono `UNVERIFIED`, lectura de avisos en Central/Local Service y panel de Caja reside en una rama histórica divergente (`feat/nequi-breb-static-qr-phase1`) y **no está acreditado como integrado en la línea activa**. La observación no certifica importe abonado, identidad del pagador ni venta pagada. No fusionar esa rama completa; revisar capacidades exclusivas y pruebas antes de incorporación selectiva. El flujo manual `payment.transfer.confirm` existente exige comprobación humana autorizada y no es webhook bancario. Ver [controversia 6 y pruebas para Codex](../../apps/pos-desktop/e2e/ROLE-UX-CONSOLIDATION.md).

## Objetivo

La caja debe poder mostrar un QR estático configurado por el administrador y, cuando un proveedor financiero confirme un ingreso real, mostrar en la pantalla del cajero:

- pago aprobado;
- monto observado;
- identificador/referencia externa;
- identidad del pagador cuando el proveedor la entregue;
- correlación con la venta;
- confirmación sonora únicamente después de la verificación autoritativa.

## Arquitectura implementada

```text
Administrador
   |
   | configuración QR estático
   v
Autoridad de configuración
   |
   v
QR mostrado por Electron
   |
   | cliente escanea QR y paga
   v
Banco / PSP / proveedor financiero
   |
   | webhook / evento autenticado
   v
Central Authority / integración externa
   |
   | evidencia normalizada + idempotencia
   v
Sync central -> Local Service
   |
   | único escritor de Payments/Sales
   v
SQLite local
   |
   v
Electron / pantalla de caja
   |
   +--> pagador + monto + estado
   +--> cha-ching sólo tras aprobación
```

## Regla crítica: QR estático no es autoridad financiera

El contenido del QR sólo identifica el destino configurado. No prueba que el dinero llegó, cuánto llegó ni quién lo envió. Por eso `QrStaticDestinationSchema` sólo representa presentación/configuración.

`QrPaymentObservationSchema` representa evidencia externa y exige `external_transaction_id`, estado, importe, moneda y timestamp. La identidad del pagador es opcional porque depende de las capacidades del proveedor.

## Correlación

La correlación debe ser determinista:

1. proveedor + `external_transaction_id` no visto previamente;
2. estado `APPROVED`;
3. moneda idéntica;
4. importe idéntico al pago pendiente;
5. una sola coincidencia pendiente.

Si existen dos ventas pendientes con el mismo importe, el sistema devuelve `AMBIGUOUS`; nunca elige una arbitrariamente.

Una transacción externa repetida devuelve `DUPLICATE_EXTERNAL_TRANSACTION` y no crea una segunda cobertura.

## Seguridad

- Electron nunca declara que llegó dinero.
- `payment.transfer.confirm` continúa siendo una operación manual y autorizada; no debe reutilizarse como endpoint de webhook.
- El webhook del proveedor debe autenticarse en el servidor central.
- El secreto del proveedor nunca viaja al renderer ni al Local Service.
- La evidencia externa debe deduplicarse antes de mutar Payment/Sale.
- Un pago aprobado con importe incorrecto no completa la venta.
- Un estado `UNKNOWN` nunca produce `CONFIRMED`.

## Estado actual

### Materializado en este bloque

- Contratos tipados de destino QR estático.
- Contrato tipado de observación financiera externa.
- Contrato de resultado de correlación, incluyendo ambigüedad y duplicado.
- Tests de frontera para los contratos.
- Arquitectura explícita que mantiene Electron sin acceso a SQLite.

### Dependencia externa todavía necesaria

La verificación financiera real no puede ser inventada por el POS. Hace falta seleccionar y habilitar un proveedor que entregue una señal verificable para el comercio. Para Colombia, Wompi documenta actualmente `BANCOLOMBIA_QR` como un flujo QR dinámico y eventos `transaction.updated`; eso no equivale a un QR estático de una cuenta bancaria y por tanto no se ha falsificado esa semántica en el código.

La siguiente integración concreta debe implementar un adaptador de proveedor detrás de esta frontera, con webhook autenticado, persistencia de evidencia, correlación y propagación por Sync. Las credenciales reales pertenecen a la instalación del comercio y no al repositorio.

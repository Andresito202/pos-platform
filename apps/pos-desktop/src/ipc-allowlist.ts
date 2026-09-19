export const IPC_ALLOWED_CHANNELS = [
  "pos:runtime.status.get",
  "pos:operation.result.get",
  "pos:operation.confirm",
  // Superficie comercial V1 — `DEC-014` §3.2. El prefijo `pos:` pertenece a
  // esta frontera; el servicio local usa los mismos nombres sin prefijo.
  // `runtime.handshake` sigue sin exponerse: es main ↔ servicio.
  "pos:session.activate",
  "pos:session.recover",
  "pos:cash.shift.open",
  "pos:cash.shift.close",
  "pos:sale.create",
  // Payment V1 — `DEC-016`.
  "pos:payment.register.cash",
  "pos:payment.register.transfer",
  "pos:payment.register.qr",
  "pos:payment.transfer.confirm",
  "pos:payment.cancel",
  "pos:payment.get",
  // QR/Wompi — `DEC-016` §20. Reconciliación bajo demanda con evidencia real
  // del proveedor; el checkout en sí no es un canal comercial (ver
  // `NATIVE_IPC_CHANNELS`, más abajo).
  "pos:payment.qr.reconcile",
  "pos:customer.register",
  "pos:customer.get",
  "pos:customer.find",
  "pos:catalog.product.register",
  "pos:catalog.item.find",
  "pos:catalog.item.get",
  // Inventario — `MIGRATION_015`.
  "pos:inventory.stock.receive",
  "pos:inventory.stock.adjust",
  "pos:inventory.stock.get",
  // Recibo — `DEC-019`. Sólo lectura: proyecta la venta ya cobrada.
  "pos:sales.receipt.get",
] as const;

export type IpcAllowedChannel = (typeof IPC_ALLOWED_CHANNELS)[number];

export function isAllowedChannel(channel: string): channel is IpcAllowedChannel {
  return (IPC_ALLOWED_CHANNELS as readonly string[]).includes(channel);
}

/**
 * Canales que `main.ts` atiende **fuera** de `ChannelBridge` — nunca se
 * reenvían al servicio local, así que no pertenecen a `IPC_ALLOWED_CHANNELS`
 * (cuyo único propósito es esa frontera de reenvío, per `ChannelBridge`).
 *
 * `payment.qr.checkout.open` abre y observa una ventana de Electron
 * (`qr-checkout-window.ts`, `DEC-016` §20) — no hay caso de uso comercial que
 * invocar, ni sobre que validar contra el contrato de `@pos-platform/contracts`.
 */
export const NATIVE_IPC_CHANNELS = [
  "pos:payment.qr.checkout.open",
] as const;

export type NativeIpcChannel = (typeof NATIVE_IPC_CHANNELS)[number];

export function isNativeChannel(channel: string): channel is NativeIpcChannel {
  return (NATIVE_IPC_CHANNELS as readonly string[]).includes(channel);
}

export const IPC_ALLOWED_CHANNELS = [
  "pos:runtime.status.get",
  "pos:authorization.capabilities.get",
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
  "pos:payment.transfer.confirm",
  "pos:payment.cancel",
  "pos:payment.get",
  "pos:customer.register",
  "pos:customer.get",
  "pos:customer.find",
  "pos:customer.marketing.subscribe",
  "pos:customer.marketing.unsubscribe",
  "pos:customer.marketing.get",
  // Emisión fiscal — `DEC-021` F5.
  "pos:fiscal.document.issue",
  "pos:catalog.product.register",
  "pos:catalog.item.find",
  "pos:catalog.item.get",
  // Inventario — `MIGRATION_015`.
  "pos:inventory.stock.receive",
  "pos:inventory.stock.adjust",
  "pos:inventory.stock.get",
  // Recibo — `DEC-019`. Sólo lectura: proyecta la venta ya cobrada.
  "pos:sales.receipt.get",
  "pos:audit.event.list",
  "pos:admin.metrics.get",
] as const;

export type IpcAllowedChannel = (typeof IPC_ALLOWED_CHANNELS)[number];

export function isAllowedChannel(channel: string): channel is IpcAllowedChannel {
  return (IPC_ALLOWED_CHANNELS as readonly string[]).includes(channel);
}

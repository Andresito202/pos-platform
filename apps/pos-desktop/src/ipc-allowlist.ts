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
  "pos:local.operator.login",
  "pos:local.operator.session",
  "pos:local.operator.logout",
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
  // Emisión fiscal — `DEC-021` F5.
  "pos:fiscal.document.issue",
  "pos:catalog.product.register",
  "pos:catalog.item.find",
  "pos:catalog.item.get",
  // Inventario — `MIGRATION_015`.
  "pos:inventory.stock.receive",
  "pos:inventory.stock.adjust",
  "pos:inventory.stock.get",
  "pos:inventory.batch.list",
  "pos:inventory.batch.status",
  "pos:inventory.conversion.rule.approve",
  "pos:inventory.conversion.execute",
  // Recibo — `DEC-019`. Sólo lectura: proyecta la venta ya cobrada.
  "pos:sales.receipt.get",
  "pos:catalog.presentation.register",
  "pos:catalog.food_policy.upsert",
  "pos:pharmacy.establishment.upsert",
  "pos:pharmacy.profile.upsert",
  "pos:pharmacy.prescription.register",
  "pos:pharmacy.technical_receipt.register",
  "pos:pharmacy.sanitary_alert.register",
  "pos:bakery.recipe.draft.create",
  "pos:bakery.recipe.approve",
  "pos:bakery.production.order.create",
  "pos:bakery.production.order.plan",
  "pos:bakery.production.release",
  "pos:bakery.production.deviation.authorize",
  "pos:bakery.production.confirm",
  "pos:bakery.production.trace.get",
  "pos:inventory.transform.execute",
  "pos:cart.waiting.save",
  "pos:cart.waiting.list",
  "pos:cart.waiting.get",
  "pos:cart.waiting.discard",
  "pos:inventory.reservation.create",
  "pos:inventory.reservation.release",
] as const;

export type IpcAllowedChannel = (typeof IPC_ALLOWED_CHANNELS)[number];

export function isAllowedChannel(channel: string): channel is IpcAllowedChannel {
  return (IPC_ALLOWED_CHANNELS as readonly string[]).includes(channel);
}

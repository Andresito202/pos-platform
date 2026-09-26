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
  "pos:payment.transfer.confirm",
  "pos:payment.cancel",
  "pos:payment.get",
  // QR con proveedor — `DEC-016`. Se expone aunque este equipo no tenga
  // credencial: sin proveedor el servicio responde `PROVIDER_NOT_CONFIGURED`,
  // que es una negativa tipada. Ocultar el canal convertiría esa negativa en
  // «la operación no existe», que es peor diagnóstico para el cajero.
  "pos:payment.register.qr",
  // Crédito de cliente — `DEC-005`. El módulo estaba completo en el servicio
  // —caso de uso, handler, esquema y pruebas— y era inalcanzable desde el
  // producto porque estos cuatro canales nunca se añadieron aquí.
  "pos:payment.register.credit",
  "pos:credit.account.open",
  "pos:credit.account.get",
  "pos:credit.payment.register",
  "pos:customer.register",
  "pos:customer.get",
  "pos:customer.find",
  // Emisión fiscal — `DEC-021` F5.
  "pos:fiscal.document.issue",
  "pos:catalog.product.register",
  // D-19 — escritura de atributos fiscales de la presentación.
  "pos:catalog.fiscal.attribute.set",
  "pos:catalog.presentation.add",
  "pos:catalog.conversion.declare",
  "pos:catalog.item.find",
  "pos:catalog.item.get",
  "pos:catalog.item.import",
  // Inventario — `MIGRATION_015`.
  "pos:inventory.stock.receive",
  "pos:inventory.stock.adjust",
  // Abrir una paca y convertirla en unidades (`DEC-004` §1736).
  "pos:inventory.conversion.apply",
  "pos:inventory.stock.get",
  "pos:inventory.lot.receive",
  "pos:inventory.lot.list",
  // Rastro de lote: sólo lectura, para un retiro sanitario.
  "pos:inventory.lot.trace",
  // Lo que vence esta semana en toda la sucursal: sólo lectura.
  "pos:inventory.lot.expiring",
  // Recibo — `DEC-019`. Sólo lectura: proyecta la venta ya cobrada.
  "pos:sales.receipt.get",
] as const;

export type IpcAllowedChannel = (typeof IPC_ALLOWED_CHANNELS)[number];

export function isAllowedChannel(channel: string): channel is IpcAllowedChannel {
  return (IPC_ALLOWED_CHANNELS as readonly string[]).includes(channel);
}

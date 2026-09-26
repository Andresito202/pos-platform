export const RENDERER_API_KEY = "posService" as const;

export const RENDERER_API_METHODS = [
  "runtime.status.get",
  "operation.result.get",
  "operation.confirm",
  "session.activate",
  "session.recover",
  "cash.shift.open",
  "cash.shift.close",
  "sale.create",
  "payment.register.cash",
  "payment.register.transfer",
  "payment.transfer.confirm",
  "payment.cancel",
  "payment.get",
  "payment.register.qr",
  "payment.register.credit",
  "credit.account.open",
  "credit.account.get",
  "credit.payment.register",
  "customer.register",
  "customer.get",
  "customer.find",
  "fiscal.document.issue",
  "catalog.product.register",
  // D-19: sin esta operación ningún producto dado de alta aquí se puede
  // facturar, porque la línea fiscal no encuentra sus códigos DIAN.
  "catalog.fiscal.attribute.set",
  // La segunda presentación de un producto: la unidad y el paquete del mismo
  // artículo, que una tienda de barrio necesita el primer día.
  "catalog.presentation.add",
  "catalog.conversion.declare",
  "catalog.item.find",
  "catalog.item.get",
  "catalog.item.import",
  "inventory.stock.receive",
  "inventory.stock.adjust",
  "inventory.conversion.apply",
  "inventory.stock.get",
  "inventory.lot.receive",
  "inventory.lot.list",
  "inventory.lot.trace",
  "inventory.lot.expiring",
  "fiscal.document.list",
  "sales.receipt.get",
] as const;

export type RendererApiMethod = (typeof RENDERER_API_METHODS)[number];

export function isValidMethod(method: string): method is RendererApiMethod {
  return (RENDERER_API_METHODS as readonly string[]).includes(method);
}

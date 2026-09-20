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
  "catalog.item.find",
  "catalog.item.get",
  "inventory.stock.receive",
  "inventory.stock.adjust",
  "inventory.stock.get",
  "sales.receipt.get",
] as const;

export type RendererApiMethod = (typeof RENDERER_API_METHODS)[number];

export function isValidMethod(method: string): method is RendererApiMethod {
  return (RENDERER_API_METHODS as readonly string[]).includes(method);
}

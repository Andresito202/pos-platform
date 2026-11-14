export const RENDERER_API_KEY = "posService" as const;

export const RENDERER_API_METHODS = [
  "hardware.command",
  "runtime.status.get",
  "authorization.capabilities.get",
  "operation.result.get",
  "operation.confirm",
  "session.activate",
  "session.recover",
  "local.operator.login",
  "local.operator.session",
  "local.operator.logout",
  "cash.shift.open",
  "cash.shift.close",
  "sale.create",
  "cart.waiting.save",
  "cart.waiting.list",
  "cart.waiting.get",
  "cart.waiting.discard",
  "payment.register.cash",
  "payment.register.transfer",
  "payment.transfer.confirm",
  "payment.cancel",
  "payment.get",
  "customer.register",
  "customer.get",
  "customer.find",
  "customer.marketing.subscribe",
  "customer.marketing.unsubscribe",
  "customer.marketing.get",
  "fiscal.document.issue",
  "catalog.product.register",
  "catalog.item.find",
  "catalog.item.get",
  "catalog.item.list",
  "inventory.stock.receive",
  "inventory.stock.adjust",
  "inventory.stock.get",
  "sales.receipt.get",
  "audit.event.list",
  "admin.metrics.get",
  "license.offers.list",
] as const;

export type RendererApiMethod = (typeof RENDERER_API_METHODS)[number];

export function isValidMethod(method: string): method is RendererApiMethod {
  return (RENDERER_API_METHODS as readonly string[]).includes(method);
}

import { describe, it, expect } from "vitest";
import { RENDERER_API_KEY, RENDERER_API_METHODS, isValidMethod } from "../src/preload-api.js";

describe("preload-api", () => {
  it("exposes the correct API key", () => {
    expect(RENDERER_API_KEY).toBe("posService");
  });

  it("exposes exactly the ratified methods", () => {
    expect(Array.from(RENDERER_API_METHODS)).toEqual([
      "runtime.status.get",
      "authorization.capabilities.get",
      "operation.result.get",
      "operation.confirm",
      "session.activate",
      "session.recover",
      "local.operator.login",
      "local.operator.session",
      "local.operator.logout",
      "hardware.command",
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
      "payment.factus_pay.collect",
      "payment.factus_pay.verify",
      "payment.factus_pay.resume",
      "payment.cancel",
      "payment.get",
      "customer.register",
      "customer.get",
      "customer.find",
      "fiscal.document.issue",
      "fiscal.numbering.sync",
      "catalog.product.register",
      "catalog.presentation.register",
      "catalog.food_policy.upsert",
      "pharmacy.establishment.upsert",
      "pharmacy.profile.upsert",
      "pharmacy.prescription.register",
      "pharmacy.technical_receipt.register",
      "pharmacy.sanitary_alert.register",
      "bakery.recipe.draft.create",
      "bakery.recipe.approve",
      "bakery.production.order.create",
      "bakery.production.order.plan",
      "bakery.production.release",
      "bakery.production.deviation.authorize",
      "bakery.production.confirm",
      "bakery.production.trace.get",
      "catalog.item.find",
      "catalog.item.get",
      "catalog.item.list",
      "admin.metrics.get",
      "inventory.stock.receive",
      "inventory.stock.adjust",
      "inventory.stock.get",
      "inventory.batch.list",
      "inventory.batch.status",
      "inventory.conversion.rule.approve",
      "inventory.conversion.execute",
      "inventory.reservation.create",
      "inventory.reservation.release",
      "inventory.transform.execute",
      "sales.receipt.get",
    ]);
  });

  it("does not expose runtime.handshake to renderer", () => {
    expect(isValidMethod("runtime.handshake")).toBe(false);
    expect(Array.from(RENDERER_API_METHODS)).not.toContain("runtime.handshake");
  });

  it("validates all exposed methods", () => {
    for (const method of RENDERER_API_METHODS) {
      expect(isValidMethod(method)).toBe(true);
    }
  });

  it("rejects arbitrary method names", () => {
    expect(isValidMethod("fs.read")).toBe(false);
    expect(isValidMethod("shell.open")).toBe(false);
    expect(isValidMethod("ipcRenderer")).toBe(false);
    expect(isValidMethod("")).toBe(false);
    expect(isValidMethod("runtime.status.get.extra")).toBe(false);
  });
});

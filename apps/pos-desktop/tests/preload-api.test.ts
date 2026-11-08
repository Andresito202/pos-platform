import { describe, it, expect } from "vitest";
import { RENDERER_API_KEY, RENDERER_API_METHODS, isValidMethod } from "../src/preload-api.js";

describe("preload-api", () => {
  it("exposes the correct API key", () => {
    expect(RENDERER_API_KEY).toBe("posService");
  });

  it("exposes exactly the ratified methods", () => {
    expect(Array.from(RENDERER_API_METHODS)).toEqual([
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

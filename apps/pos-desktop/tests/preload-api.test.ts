import { describe, it, expect } from "vitest";
import { RENDERER_API_KEY, RENDERER_API_METHODS, isValidMethod } from "../src/preload-api.js";

describe("preload-api", () => {
  it("exposes the correct API key", () => {
    expect(RENDERER_API_KEY).toBe("posService");
  });

  it("exposes exactly the ratified methods", () => {
    expect(Array.from(RENDERER_API_METHODS)).toEqual([
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
      "catalog.fiscal.attribute.set",
      "catalog.presentation.add",
      "catalog.conversion.declare",
      "catalog.item.find",
      "catalog.item.get",
      "inventory.stock.receive",
      "inventory.stock.adjust",
      "inventory.conversion.apply",
      "inventory.stock.get",
      "inventory.lot.receive",
      "inventory.lot.list",
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

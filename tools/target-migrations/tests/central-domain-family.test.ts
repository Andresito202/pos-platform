import { describe, expect, it } from "vitest";
import { classifyDomainFamily } from "../src/central-domain-consumers.js";

describe("central domain consumers registry", () => {
  it("maps sales, payments, inventory, production and audit families", () => {
    expect(classifyDomainFamily("SALE_CREATED")).toBe("SALES");
    expect(classifyDomainFamily("SALE_CANCELLED")).toBe("SALES");
    expect(classifyDomainFamily("PAYMENT_CONFIRMED")).toBe("PAYMENTS");
    expect(classifyDomainFamily("INVENTORY_RESERVATION_CREATE")).toBe("INVENTORY");
    expect(classifyDomainFamily("INVENTORY_MOVEMENT_APPEND")).toBe("INVENTORY");
    expect(classifyDomainFamily("INVENTORY_TRANSFORM_POST")).toBe("INVENTORY");
    expect(classifyDomainFamily("BAKERY_PRODUCTION_CONFIRMED")).toBe("PRODUCTION");
    expect(classifyDomainFamily("AUDIT_EVENT_RECORDED")).toBe("AUDIT");
    expect(classifyDomainFamily("SYNC.TEST")).toBe("UNTYPED");
  });
});

import { describe, expect, it } from "vitest";
import { SaleCreateLineSchema } from "../src/ipc-commercial.js";

const line = { product_id: "018f0000-0000-7000-8000-000000000010", presentation_id: "018f0000-0000-7000-8000-000000000011", quantity: "1.000000" };
describe("D-23 sale identifier additive contract", () => {
  it("preserves omitted legacy identifiers and accepts explicit identification without identity or price authority", () => {
    expect(SaleCreateLineSchema.parse(line)).toEqual(line);
    expect(SaleCreateLineSchema.parse({ ...line, identifier: "7700000000001" }).identifier).toBe("7700000000001");
    for (const value of ["", "A".repeat(129), null]) expect(SaleCreateLineSchema.safeParse({ ...line, identifier: value }).success).toBe(false);
    expect(SaleCreateLineSchema.safeParse({ ...line, identifier: "SKU-1", price: "1.000000" }).success).toBe(false);
  });
});

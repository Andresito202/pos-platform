import { describe, expect, it } from "vitest";
import { convertReceiptQuantity, validateReceiptAllocationQuantities } from "../src/inventory/receipt-quantities.js";

describe("exact quantity preparation for canonical GoodsReceipt", () => {
  it("converts packs and weighted goods with the existing scale-6 arithmetic", () => {
    expect(convertReceiptQuantity("2.000000", "12.0000000000", 0, 0)).toBe("24.000000");
    expect(convertReceiptQuantity("1.250000", "1000.0000000000", 3, 0)).toBe("1250.000000");
    expect(convertReceiptQuantity("0.500000", "0.0000020000", 6, 6)).toBe("0.000001");
  });
  it("never rounds an unrepresentable conversion or an indivisible unit", () => {
    expect(() => convertReceiptQuantity("1.000000", "0.3333333333", 0, 6)).toThrow("CONVERSION_NOT_EXACT");
    expect(() => convertReceiptQuantity("1.000000", "0.5000000000", 0, 0)).toThrow("QUANTITY_PRECISION_EXCEEDED");
    expect(() => convertReceiptQuantity("0.000001", "1.0000000000", 3, 6)).toThrow("QUANTITY_PRECISION_EXCEEDED");
  });
  it("rejects invalid scale, nonpositive values, invalid precision and overflow", () => {
    for (const quantity of ["0.000000", "-1.000000", "1", "1e6", "10000000000000.000000"]) expect(() => convertReceiptQuantity(quantity, "1.0000000000", 6, 6)).toThrow();
    for (const factor of ["0.0000000000", "-1.0000000000", "12", "1.00000000001", "1000000000.0000000000"]) expect(() => convertReceiptQuantity("1.000000", factor, 6, 6)).toThrow();
    expect(() => convertReceiptQuantity("1.000000", "1.0000000000", 7, 6)).toThrow("PRECISION_INVALID");
    expect(() => convertReceiptQuantity("9999999999999.999999", "2.0000000000", 6, 6)).toThrow("OVERFLOW");
  });
  it("requires exact sum of positive allocation quantities and never duplicates the line", () => {
    expect(() => validateReceiptAllocationQuantities("1.250000", ["0.500000", "0.750000"], 3)).not.toThrow();
    expect(() => validateReceiptAllocationQuantities("1.250000", ["1.250000", "1.250000"], 3)).toThrow("QUANTITY_MISMATCH");
    expect(() => validateReceiptAllocationQuantities("1.250000", [], 3)).toThrow("ALLOCATIONS_INVALID");
    expect(() => validateReceiptAllocationQuantities("1.250000", ["0.000000", "1.250000"], 3)).toThrow("NOT_POSITIVE");
  });
});

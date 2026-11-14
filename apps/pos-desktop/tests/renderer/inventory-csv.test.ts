import { describe, it, expect } from "vitest";
import { previewInventoryCsv, confirmInventoryCsv, INVENTORY_CSV_COLUMNS } from "../../renderer/src/inventory-csv.js";
const batch = "12345678-1234-4234-8234-123456789012";
const presentation = "018f0000-0000-7000-8000-000000000001";
const header = INVENTORY_CSV_COLUMNS.join(";") + "\n";
const row = (id: number, qty = "2.5") => `${batch};${id};${presentation};PURCHASE_RECEIPT;${qty};PURCHASE;2026-11-10\n`;
const posted = { status: "SUCCEEDED" as const, result_code: "POSTED", result: { outcome: "POSTED", stock_sequence: 1, quantity_after: "2.500000", available: null } };
describe("inventory import uses authorized stock ledger", () => {
  it("previews exact decimals and validates complete file before any write", async () => {
    const plan = previewInventoryCsv(header + row(1), ";");
    expect(plan.rows[0]?.payload?.quantity).toBe("2.500000");
    expect(plan.rows[0]?.errors).toEqual([]);
    let calls = 0;
    for (const body of [row(1) + row(1), row(1) + row(2, "-2"), row(1) + row(2, "=SUM(A1)")]) {
      await expect(confirmInventoryCsv(previewInventoryCsv(header + body, ";"), () => {}, async () => { calls++; return posted; })).rejects.toThrow("CSV_PLAN_INVALID");
    }
    expect(calls).toBe(0);
  });
  it("keeps row identities across restart, reordering and corrections", async () => {
    const keys: string[] = [];
    const receive = async (_: unknown, key: string) => {
      keys.push(key);
      if (keys.length === 2) throw Error("lost response after commit");
      return posted;
    };
    await expect(confirmInventoryCsv(previewInventoryCsv(header + row(1) + row(2), ";"), () => {}, receive)).rejects.toThrow("CSV_TRANSPORT_UNCERTAIN");
    await confirmInventoryCsv(previewInventoryCsv(header + row(2) + row(1), ";"), () => {}, receive);
    expect(keys[0]).toBe(keys[3]); expect(keys[1]).toBe(keys[2]);
    expect(previewInventoryCsv(header + row(1, "3"), ";").rows[0]?.key).toBe(keys[0]);
  });
  it("stops on permission rejection, conflicts, pending or malformed replies", async () => {
    for (const response of [
      { status: "REJECTED" as const, result_code: "UNAUTHORIZED", result: null },
      { ...posted, status: "REJECTED" as const, result: { ...posted.result, outcome: "IDEMPOTENCY_CONFLICT" } },
      { status: "PENDING" as const, result_code: "PENDING", result: null },
      { ...posted, result: { outcome: "POSTED" } },
    ]) {
      let calls = 0;
      await expect(confirmInventoryCsv(previewInventoryCsv(header + row(1) + row(2), ";"), () => {}, async () => { calls++; return response; })).rejects.toThrow();
      expect(calls).toBe(1);
    }
  });
  it("rejects oversized, malformed and unsupported headers", () => {
    for (const source of ["a".repeat(1048577), header + '"unfinished', header.replace("quantity", "cost"), header + row(1).repeat(1001)]) {
      expect(() => previewInventoryCsv(source, ";")).toThrow();
    }
  });
});

import { describe, expect, it } from "vitest";
import { previewCatalogCsv, confirmCatalogCsv, catalogCsvTemplate } from "../../renderer/src/catalog-csv.js";
const header = "code,name,stock_controlled,presentation_name,unit_code,unit_precision,barcode,price_amount,currency_code\r\n";
const one = 'A,"Café, tostado",true,Bolsa,UND,0,77000001,1500,COP\r\n';
const two = "B,Arroz,false,Unidad,UND,0,,2500,COP\r\n";
describe("bounded catalog CSV preparation and authorized per-row orchestration", () => {
  it("reads UTF-8/BOM, quoted separators and exact decimals without treating empty fiscal values as exemption", async () => {
    const plan = await previewCatalogCsv("\uFEFF" + header + one + two);
    expect(plan.rows).toHaveLength(2); expect(plan.rows.every((row) => !row.errors.length)).toBe(true);
    expect(plan.rows[0]!.payload).toMatchObject({ name: "Café, tostado", price_amount: "1500.000000", stock_controlled: true });
    expect(plan.rows[0]!.payload?.fiscal_attributes).toBeUndefined();
    expect((await previewCatalogCsv(catalogCsvTemplate())).rows).toEqual([]);
  });
  it("detects duplicate codes/barcodes and invalid values per record without writes", async () => {
    const plan = await previewCatalogCsv(header + one + one + "C,Error,yes,Unidad,UND,7,,1.0000001,COP\r\n");
    expect(plan.rows[0]!.errors).toContain("DUPLICATE_CODE"); expect(plan.rows[1]!.errors).toContain("DUPLICATE_BARCODE");
    expect(plan.rows[2]!.errors).toContain("INVALID:price_amount");
    let calls = 0; await expect(confirmCatalogCsv(plan, () => undefined, async () => { calls++; throw new Error("unexpected"); })).rejects.toThrow("CSV_PLAN_INVALID");
    expect(calls).toBe(0);
  });
  it("rejects unknown invoice/stock columns, broken quotes, duplicate headers and oversized sources", async () => {
    for (const source of [header.replace("code,", "code,stock,"), header.replace("name,", "code,"), header + 'A,"unfinished', "a".repeat(1_048_577)]) {
      await expect(previewCatalogCsv(source)).rejects.toThrow();
    }
    const semicolon = await previewCatalogCsv(header.replaceAll(",", ";") + two.replaceAll(",", ";"), ";");
    expect(semicolon.rows[0]!.payload?.code).toBe("B");
  });
  it("resumes the identical file with identical keys after uncertain transport, leaving each row to backend authorization", async () => {
    const plan = await previewCatalogCsv(header + one + two); const keys: string[] = []; const seen: string[] = [];
    const register = async (_payload: unknown, key: string) => {
      keys.push(key);
      if (keys.length === 2) throw new Error("connection lost");
      return { status: "SUCCEEDED" as const, result_code: "REGISTERED", result: { outcome: "REGISTERED" as const, product_id: null, presentation_id: null } };
    };
    await expect(confirmCatalogCsv(plan, (result) => seen.push(result.outcome), register)).rejects.toThrow("connection lost");
    expect(seen).toEqual(["REGISTERED", "TRANSPORT_UNCERTAIN"]);
    await confirmCatalogCsv(await previewCatalogCsv(header + one + two), () => undefined, register);
    expect(keys[0]).toBe(keys[2]); expect(keys[1]).toBe(keys[3]);
  });
  it("stops on missing backend permissions and never marks pending work as registered", async () => {
    const plan = await previewCatalogCsv(header + one + two); let calls = 0;
    await expect(confirmCatalogCsv(plan, () => undefined, async () => { calls++; return { status: "REJECTED", result_code: "UNAUTHORIZED", result: null }; })).rejects.toThrow("CSV_STOPPED:UNAUTHORIZED");
    expect(calls).toBe(1);
    await expect(confirmCatalogCsv(plan, () => undefined, async () => ({ status: "PENDING", result_code: "PENDING", result: null }))).rejects.toThrow("CSV_TRANSPORT_UNCERTAIN");
  });
});

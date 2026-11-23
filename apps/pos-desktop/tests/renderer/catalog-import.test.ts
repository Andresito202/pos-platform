// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CATALOG_IMPORT_COLUMNS,
  catalogImportCsvTemplate,
  catalogImportXlsxTemplate,
  confirmCatalogImport,
  previewCatalogCsv,
  previewCatalogXlsx,
} from "../../renderer/src/catalog-import.js";
import { readSheetMatrixFromXlsx, writeSheetMatrixToXlsx } from "../../renderer/src/sheet-workbook.js";

const batch = "12345678-1234-4234-8234-123456789012";
const header = CATALOG_IMPORT_COLUMNS.join(";") + "\n";
const row = (id: number, code = `P-${id}`, price = "1500") =>
  `${batch};${id};${code};Producto ${id};Desc;Marca;Cat;;Unidad;UND;0;;;${price};COP;SI;ACTIVO\n`;

describe("catalog import planillas", () => {
  it("previews CSV without writing and rejects duplicates or bad prices", () => {
    const plan = previewCatalogCsv(header + row(1), ";");
    expect(plan.rows[0]?.draft?.priceAmount).toBe("1500.000000");
    expect(plan.rows[0]?.errors).toEqual([]);
    expect(previewCatalogCsv(header + row(1) + row(1), ";").rows[1]?.errors)
      .toContain("DUPLICATE_IMPORT_ROW");
    expect(previewCatalogCsv(header + row(1, "P-1", "-2"), ";").rows[0]?.errors)
      .toContain("PRECIO_INVALIDO");
  });

  it("round-trips XLSX template and rejects formulas or macros paths", () => {
    const bytes = catalogImportXlsxTemplate(batch);
    const matrix = readSheetMatrixFromXlsx(bytes);
    expect(matrix.sheetName).toBe("Catalogo");
    expect(matrix.rows[0]?.[0]).toBe("import_id");
    const plan = previewCatalogXlsx(bytes);
    expect(plan.rows[0]?.draft?.code).toBe("PROD-001");

    expect(() => previewCatalogCsv(catalogImportCsvTemplate(";", batch), ";")).not.toThrow();
    expect(() => writeSheetMatrixToXlsx("Macros", [[...CATALOG_IMPORT_COLUMNS]])).not.toThrow();
    expect(() => readSheetMatrixFromXlsx(writeSheetMatrixToXlsx("Hoja2", [[...CATALOG_IMPORT_COLUMNS]])))
      .toThrow("XLSX_SHEET_NAME_REJECTED");
  });

  it("registers new codes and updates existing ones with stable import keys", async () => {
    const outcomes: string[] = [];
    const keys: string[] = [];
    const list = async () => ({
      status: "SUCCEEDED" as const,
      result_code: "FOUND",
      result: { outcome: "FOUND", items: [], has_more: false },
    });
    const register = async (_payload: Record<string, unknown>, key: string) => {
      keys.push(key);
      return {
        status: "SUCCEEDED" as const,
        result_code: "REGISTERED",
        result: {
          outcome: "REGISTERED",
          product_id: "018f0000-0000-7000-8000-0000000000aa",
          presentation_id: "018f0000-0000-7000-8000-0000000000bb",
        },
      };
    };
    await confirmCatalogImport(
      previewCatalogCsv(header + row(1), ";"),
      (result) => { outcomes.push(result.outcome); },
      { list, register, update: async () => { throw new Error("no update"); }, publish: async () => { throw new Error("no publish"); } },
    );
    expect(outcomes).toEqual(["REGISTERED"]);
    expect(keys[0]).toMatch(/^catalog-import:/);

    const existing = {
      product_id: "018f0000-0000-7000-8000-0000000000aa",
      presentation_id: "018f0000-0000-7000-8000-0000000000bb",
      code: "P-1",
      name: "Producto 1",
      description: "Desc",
      brand: "Marca",
      category: "Cat",
      presentation_name: "Unidad",
      unit_code: "UND",
      unit_precision: 0,
      barcode: null,
      stock_controlled: true,
      price_amount: "1500.000000",
      currency_code: "COP",
      quantity_available: null,
      quantity_on_hand: null,
      quantity_reserved: null,
      quantity_unsellable: null,
      low_stock_threshold: null,
      availability_state: "NOT_TRACKED" as const,
      product_version: 2,
      presentation_version: 1,
      media_id: null,
    };
    const updateKeys: string[] = [];
    await confirmCatalogImport(
      previewCatalogCsv(header + row(1).replace("Producto 1", "Producto 1b"), ";"),
      (result) => { outcomes.push(result.outcome); },
      {
        list: async () => ({
          status: "SUCCEEDED",
          result_code: "FOUND",
          result: { outcome: "FOUND", items: [existing], has_more: false },
        }),
        register: async () => ({
          status: "REJECTED",
          result_code: "CODE_ALREADY_REGISTERED",
          result: {
            outcome: "CODE_ALREADY_REGISTERED",
            product_id: existing.product_id,
            presentation_id: null,
          },
        }),
        update: async (_payload, key) => {
          updateKeys.push(key);
          return {
            status: "SUCCEEDED",
            result_code: "UPDATED",
            result: {
              outcome: "UPDATED",
              product_id: existing.product_id,
              version: 3,
              presentation_version: 2,
              current_version: null,
            },
          };
        },
        publish: async () => { throw new Error("no publish"); },
      },
    );
    expect(outcomes.at(-1)).toBe("UPDATED");
    expect(updateKeys[0]?.endsWith(":update")).toBe(true);

    // Already-applied alta under the same import identity must not rewrite later edits.
    let updates = 0;
    await confirmCatalogImport(
      previewCatalogCsv(header + row(1), ";"),
      (result) => { outcomes.push(result.outcome); },
      {
        list: async () => ({
          status: "SUCCEEDED",
          result_code: "FOUND",
          result: {
            outcome: "FOUND",
            items: [{ ...existing, name: "Nombre cambiado por administrador" }],
            has_more: false,
          },
        }),
        register: async () => ({
          status: "SUCCEEDED",
          result_code: "IDEMPOTENT",
          result: {
            outcome: "IDEMPOTENT",
            product_id: existing.product_id,
            presentation_id: existing.presentation_id,
          },
        }),
        update: async () => { updates += 1; throw new Error("no update"); },
        publish: async () => { updates += 1; throw new Error("no publish"); },
      },
    );
    expect(updates).toBe(0);
    expect(outcomes.at(-1)).toBe("IDEMPOTENT");
  });

  it("requires presentacion_base with valid cantidad_por_presentacion for conversion rules", () => {
    const badQty = previewCatalogCsv(
      header + `${batch};1;P-1;Prod;Desc;Marca;Cat;;Caja;UND;0;abc;Unidad;1500;COP;SI;ACTIVO\n`,
      ";",
    );
    expect(badQty.rows[0]?.errors).toContain("CANTIDAD_PRESENTACION_INVALIDA");
    const missingBase = previewCatalogCsv(
      header + `${batch};1;P-1;Prod;Desc;Marca;Cat;;Caja;UND;0;12;;1500;COP;SI;ACTIVO\n`,
      ";",
    );
    expect(missingBase.rows[0]?.errors).toContain("PRESENTACION_BASE_REQUERIDA");
    const ok = previewCatalogCsv(
      header + `${batch};1;P-1;Prod;Desc;Marca;Cat;;Caja;UND;0;12;Unidad;1500;COP;SI;ACTIVO\n`,
      ";",
    );
    expect(ok.rows[0]?.errors).toEqual([]);
    expect(ok.rows[0]?.notes).toContain("CONVERSION_RULE_PENDING");
    expect(ok.rows[0]?.draft?.quantityPerPresentation).toBe("12");
    expect(ok.rows[0]?.draft?.basePresentationName).toBe("Unidad");
  });

  it("registers a secondary presentation and approves a persisted conversion rule", async () => {
    const base = {
      product_id: "018f0000-0000-7000-8000-0000000000aa",
      presentation_id: "018f0000-0000-7000-8000-0000000000bb",
      code: "P-1",
      name: "Producto 1",
      description: "Desc",
      brand: "Marca",
      category: "Cat",
      presentation_name: "Unidad",
      unit_code: "UND",
      unit_precision: 0,
      barcode: null,
      stock_controlled: true,
      price_amount: "1500.000000",
      currency_code: "COP",
      quantity_available: "10.000000",
      quantity_on_hand: "10.000000",
      quantity_reserved: "0.000000",
      quantity_unsellable: "0.000000",
      low_stock_threshold: null,
      availability_state: "AVAILABLE" as const,
      product_version: 1,
      presentation_version: 1,
      media_id: null,
    };
    const outcomes: string[] = [];
    const conversions: Array<Record<string, unknown>> = [];
    await confirmCatalogImport(
      previewCatalogCsv(
        header + `${batch};1;P-1;Producto 1;Desc;Marca;Cat;;Caja;UND;0;12;Unidad;15000;COP;SI;ACTIVO\n`,
        ";",
      ),
      (result) => { outcomes.push(result.outcome); },
      {
        list: async () => ({
          status: "SUCCEEDED",
          result_code: "FOUND",
          result: { outcome: "FOUND", items: [base], has_more: false },
        }),
        register: async () => { throw new Error("no register"); },
        update: async () => { throw new Error("no update"); },
        publish: async () => { throw new Error("no publish"); },
        addPresentation: async () => ({
          status: "SUCCEEDED",
          result_code: "REGISTERED",
          result: {
            outcome: "REGISTERED",
            product_id: base.product_id,
            presentation_id: "018f0000-0000-7000-8000-0000000000cc",
          },
        }),
        approveConversion: async (payload) => {
          conversions.push(payload);
          return {
            status: "SUCCEEDED",
            result_code: "APPROVED",
            result: { outcome: "APPROVED", rule_id: "018f0000-0000-7000-8000-0000000000dd" },
          };
        },
      },
    );
    expect(outcomes).toEqual(["REGISTERED"]);
    expect(conversions).toEqual([{
      source_presentation_id: "018f0000-0000-7000-8000-0000000000cc",
      target_presentation_id: base.presentation_id,
      numerator: "12",
      denominator: "1",
      version: 1,
    }]);
  });

  it("rejects unit changes on existing products and stops without inventing stock", async () => {
    const existing = {
      product_id: "018f0000-0000-7000-8000-0000000000aa",
      presentation_id: "018f0000-0000-7000-8000-0000000000bb",
      code: "P-1",
      name: "Producto 1",
      description: "Desc",
      brand: "Marca",
      category: "Cat",
      presentation_name: "Unidad",
      unit_code: "KG",
      unit_precision: 3,
      barcode: null,
      stock_controlled: true,
      price_amount: "1500.000000",
      currency_code: "COP",
      quantity_available: "1.000000",
      quantity_on_hand: "1.000000",
      quantity_reserved: "0.000000",
      quantity_unsellable: "0.000000",
      low_stock_threshold: null,
      availability_state: "AVAILABLE" as const,
      product_version: 1,
      presentation_version: 1,
      media_id: null,
    };
    await expect(confirmCatalogImport(
      previewCatalogCsv(header + row(1), ";"),
      () => {},
      {
        list: async () => ({
          status: "SUCCEEDED",
          result_code: "FOUND",
          result: { outcome: "FOUND", items: [existing], has_more: false },
        }),
        register: async () => { throw new Error("no"); },
        update: async () => { throw new Error("no"); },
        publish: async () => { throw new Error("no"); },
      },
    )).rejects.toThrow("UNIT_CHANGE_FORBIDDEN");
  });
});

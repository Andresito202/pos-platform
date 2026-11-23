// @vitest-environment node
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  catalogImportXlsxTemplate,
  previewCatalogXlsx,
} from "../../renderer/src/catalog-import.js";
import {
  readSheetMatrixFromXlsx,
  unzipXlsxBounded,
  writeSheetMatrixToXlsx,
  XLSX_MAX_ENTRY_BYTES,
  XLSX_MAX_EXPANDED_BYTES,
} from "../../renderer/src/sheet-workbook.js";

const batch = "12345678-1234-4234-8234-123456789012";

describe("xlsx zip security bounds", () => {
  it("accepts valid catalog templates within published limits", () => {
    const bytes = catalogImportXlsxTemplate(batch);
    expect(readSheetMatrixFromXlsx(bytes).sheetName).toBe("Catalogo");
    expect(previewCatalogXlsx(bytes).rows[0]?.draft?.code).toBe("PROD-001");
  });

  it("rejects a small compressed archive whose expansion exceeds entry/expanded budgets", () => {
    const fat = "A".repeat(XLSX_MAX_ENTRY_BYTES + 1);
    const zipped = zipSync({
      "[Content_Types].xml": strToU8(fat),
    }, { level: 9 });
    expect(zipped.byteLength).toBeLessThan(50_000);
    expect(zipped.byteLength).toBeLessThan(XLSX_MAX_EXPANDED_BYTES);
    expect(() => unzipXlsxBounded(zipped)).toThrow(/XLSX_(ENTRY_SIZE|EXPANDED_SIZE)_REJECTED/);
  });

  it("rejects formula sheets and unauthorized package paths", () => {
    const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`
      + `<row r="1"><c r="A1"><f>SUM(1)</f><v>1</v></c></row></sheetData></worksheet>`;
    const zipped = writeSheetMatrixToXlsx("Catalogo", [["import_id"], [batch]]);
    // Replace sheet contents by re-zipping with formula XML
    const bombed = zipSync({
      "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
      "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Catalogo" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    }, { level: 6 });
    expect(() => readSheetMatrixFromXlsx(bombed)).toThrow("XLSX_UNSAFE_SHEET_REJECTED");

    const withMacro = zipSync({
      "xl/vbaProject.bin": strToU8("MZ"),
    }, { level: 0 });
    expect(() => unzipXlsxBounded(withMacro)).toThrow("XLSX_MACROS_REJECTED");
  });

  it("rejects truncated or non-zip payloads", () => {
    expect(() => readSheetMatrixFromXlsx(new Uint8Array([0x50, 0x4b]))).toThrow();
    expect(() => readSheetMatrixFromXlsx(new Uint8Array([1, 2, 3, 4]))).toThrow("XLSX_SIGNATURE_REJECTED");
    void XLSX_MAX_EXPANDED_BYTES;
  });
});

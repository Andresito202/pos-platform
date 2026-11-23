/**
 * Minimal XLSX (OOXML) reader/writer for commercial planillas.
 * Uses fflate for ZIP with explicit compressed/expanded bounds.
 * Does not evaluate formulas or run macros.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/** Published limits for commercial planillas (compressed archive). */
export const XLSX_MAX_COMPRESSED_BYTES = 1_048_576;
/** Total expanded payload across extracted entries. */
export const XLSX_MAX_EXPANDED_BYTES = 2_097_152;
/** Single ZIP entry expanded size. */
export const XLSX_MAX_ENTRY_BYTES = 1_048_576;
export const XLSX_MAX_ZIP_ENTRIES = 64;
const MAX_BYTES = XLSX_MAX_COMPRESSED_BYTES;
const MAX_ROWS = 1001;
const MAX_COLS = 64;
const MAX_CELL = 4096;
const MAX_SHARED_STRINGS = 20_000;

const FORBIDDEN_ZIP_PATH = /(?:^|\/)(xl\/vbaProject\.bin|xl\/macrosheets\/|_vba|vbaProject|xl\/activeX\/|customXml\/)/i;
/** Harmless OOXML package prefixes; macros/OLE paths stay forbidden. */
const ALLOWED_ZIP_PREFIX = /^(?:\[Content_Types\]\.xml|_rels\/|xl\/|docProps\/)/;

export type SheetMatrix = {
  readonly sheetName: string;
  readonly rows: readonly (readonly string[])[];
};

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCharCode(Number(digits)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&amp;/g, "&");
}

function colLettersToIndex(letters: string): number {
  let index = 0;
  for (const character of letters.toUpperCase()) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

function indexToColLetters(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function parseSharedStrings(xml: string): string[] {
  if (xml.length > XLSX_MAX_ENTRY_BYTES) throw new Error("XLSX_FIELD_TOO_LONG");
  const values: string[] = [];
  const siBlocks = xml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) ?? [];
  if (siBlocks.length > MAX_SHARED_STRINGS) throw new Error("XLSX_SHARED_STRING_LIMIT");
  for (const block of siBlocks) {
    const parts = [...block.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXmlEntities(match[1] ?? ""));
    const value = parts.join("");
    if (value.length > MAX_CELL) throw new Error("XLSX_FIELD_TOO_LONG");
    values.push(value);
  }
  return values;
}

/**
 * Bounded OOXML unzip: rejects zip bombs via declared original sizes before
 * inflate, then rechecks actual expanded lengths.
 */
export function unzipXlsxBounded(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength === 0 || bytes.byteLength > XLSX_MAX_COMPRESSED_BYTES) {
    throw new Error("XLSX_SIZE_REJECTED");
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("XLSX_SIGNATURE_REJECTED");

  let entryCount = 0;
  let declaredExpanded = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        entryCount += 1;
        if (entryCount > XLSX_MAX_ZIP_ENTRIES) throw new Error("XLSX_ZIP_ENTRY_LIMIT");
        if (file.name.includes("..") || file.name.startsWith("/") || file.name.includes("\\")) {
          throw new Error("XLSX_UNSAFE_CONTENT_REJECTED");
        }
        if (FORBIDDEN_ZIP_PATH.test(file.name)) throw new Error("XLSX_MACROS_REJECTED");
        if (!ALLOWED_ZIP_PREFIX.test(file.name)) throw new Error("XLSX_UNSAFE_CONTENT_REJECTED");
        if (file.compression !== 0 && file.compression !== 8) {
          throw new Error("XLSX_COMPRESSION_REJECTED");
        }
        if (file.originalSize < 0 || file.originalSize > XLSX_MAX_ENTRY_BYTES) {
          throw new Error("XLSX_ENTRY_SIZE_REJECTED");
        }
        if (file.size < 0 || file.size > XLSX_MAX_COMPRESSED_BYTES) {
          throw new Error("XLSX_ENTRY_SIZE_REJECTED");
        }
        declaredExpanded += file.originalSize;
        if (declaredExpanded > XLSX_MAX_EXPANDED_BYTES) {
          throw new Error("XLSX_EXPANDED_SIZE_REJECTED");
        }
        return true;
      },
    });
  } catch (failure) {
    if (failure instanceof Error && failure.message.startsWith("XLSX_")) throw failure;
    throw new Error("XLSX_ZIP_INVALID");
  }

  let actualExpanded = 0;
  for (const [path, data] of Object.entries(files)) {
    if (FORBIDDEN_ZIP_PATH.test(path) || path.includes("..") || !ALLOWED_ZIP_PREFIX.test(path)) {
      throw new Error("XLSX_UNSAFE_CONTENT_REJECTED");
    }
    if (data.byteLength > XLSX_MAX_ENTRY_BYTES) throw new Error("XLSX_ENTRY_SIZE_REJECTED");
    actualExpanded += data.byteLength;
    if (actualExpanded > XLSX_MAX_EXPANDED_BYTES) throw new Error("XLSX_EXPANDED_SIZE_REJECTED");
  }
  return files;
}

function parseSheetRows(xml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];
  const rowBlocks = xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? [];
  if (rowBlocks.length > MAX_ROWS) throw new Error("XLSX_ROW_LIMIT_EXCEEDED");
  for (const rowXml of rowBlocks) {
    const rowMatch = /<row\b[^>]*\br="(\d+)"/.exec(rowXml);
    const rowNumber = rowMatch ? Number(rowMatch[1]) : rows.length + 1;
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > MAX_ROWS) {
      throw new Error("XLSX_ROW_INVALID");
    }
    while (rows.length < rowNumber - 1) rows.push([]);
    const cells: string[] = [];
    const cellBlocks = rowXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? [];
    for (const cellXml of cellBlocks) {
      const ref = /\br="([A-Z]+)(\d+)"/i.exec(cellXml);
      if (!ref) continue;
      const col = colLettersToIndex(ref[1]!);
      if (col < 0 || col >= MAX_COLS) throw new Error("XLSX_COLUMN_LIMIT_EXCEEDED");
      while (cells.length <= col) cells.push("");
      if (/<f[\s>/]/.test(cellXml) || /\bt="str"[\s\S]*?>\s*=/.test(cellXml)) {
        throw new Error("XLSX_FORMULA_REJECTED");
      }
      const type = /\bt="([^"]+)"/.exec(cellXml)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1]
        ?? /<is>[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(cellXml)?.[1]
        ?? "";
      let value = decodeXmlEntities(raw);
      if (type === "s") {
        const index = Number(value);
        if (!Number.isInteger(index) || index < 0 || index >= shared.length) {
          throw new Error("XLSX_SHARED_STRING_INVALID");
        }
        value = shared[index]!;
      } else if (type === "b") {
        value = value === "1" ? "TRUE" : "FALSE";
      } else if (type === "str" || type === "inlineStr" || type === undefined || type === "n") {
        // keep decoded text / number as string
      } else if (type === "e") {
        throw new Error("XLSX_CELL_ERROR_REJECTED");
      } else {
        throw new Error("XLSX_CELL_TYPE_REJECTED");
      }
      if (value.length > MAX_CELL) throw new Error("XLSX_FIELD_TOO_LONG");
      cells[col] = value;
    }
    rows[rowNumber - 1] = cells;
  }
  return rows;
}

function firstWorksheetPath(files: Record<string, Uint8Array>): string {
  const workbook = files["xl/workbook.xml"];
  if (!workbook) throw new Error("XLSX_WORKBOOK_MISSING");
  const workbookXml = strFromU8(workbook);
  if (/workbookProtection|sheetProtection/i.test(workbookXml)) {
    throw new Error("XLSX_PROTECTED_REJECTED");
  }
  const sheetMatches = [...workbookXml.matchAll(/<sheet\b[^>]*>/g)];
  if (sheetMatches.length !== 1) throw new Error("XLSX_SHEET_COUNT_REJECTED");
  const rels = files["xl/_rels/workbook.xml.rels"];
  if (!rels) throw new Error("XLSX_RELS_MISSING");
  const relsXml = strFromU8(rels);
  const rid = /\br:id="([^"]+)"/.exec(sheetMatches[0]![0])?.[1];
  if (!rid) throw new Error("XLSX_SHEET_ID_MISSING");
  const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(relsXml)?.[1]
    ?? new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(relsXml)?.[1];
  if (!target) throw new Error("XLSX_SHEET_TARGET_MISSING");
  const normalized = target.replace(/^\//, "").replace(/^\.\.\//, "xl/");
  const path = normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
  if (!files[path]) throw new Error("XLSX_SHEET_MISSING");
  return path;
}

export function readSheetMatrixFromXlsx(bytes: Uint8Array): SheetMatrix {
  const files = unzipXlsxBounded(bytes);
  const contentTypes = files["[Content_Types].xml"];
  if (!contentTypes) throw new Error("XLSX_CONTENT_TYPES_MISSING");
  const contentXml = strFromU8(contentTypes);
  if (/macroEnabled|vbaProject|macrosheet/i.test(contentXml)) {
    throw new Error("XLSX_MACROS_REJECTED");
  }
  const shared = files["xl/sharedStrings.xml"]
    ? parseSharedStrings(strFromU8(files["xl/sharedStrings.xml"]!))
    : [];
  const sheetPath = firstWorksheetPath(files);
  const sheetXml = strFromU8(files[sheetPath]!);
  if (/<f[\s>/]|t="e"|oleObject|vmlDrawing/i.test(sheetXml)) {
    throw new Error("XLSX_UNSAFE_SHEET_REJECTED");
  }
  const nameMatch = /name="([^"]+)"/.exec(
    strFromU8(files["xl/workbook.xml"]!).match(/<sheet\b[^>]*>/)?.[0] ?? "",
  );
  const sheetName = nameMatch ? decodeXmlEntities(nameMatch[1]!) : "Hoja1";
  if (!/^Catalogo$|^Existencias$|^Sheet1$|^Hoja1$/i.test(sheetName)) {
    throw new Error("XLSX_SHEET_NAME_REJECTED");
  }
  return { sheetName, rows: parseSheetRows(sheetXml, shared) };
}

export function writeSheetMatrixToXlsx(
  sheetName: string,
  rows: readonly (readonly string[])[],
): Uint8Array {
  if (rows.length > MAX_ROWS) throw new Error("XLSX_ROW_LIMIT_EXCEEDED");
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const indexOf = (value: string): number => {
    const existing = sharedIndex.get(value);
    if (existing !== undefined) return existing;
    const next = shared.length;
    shared.push(value);
    sharedIndex.set(value, next);
    return next;
  };
  const sheetRows = rows.map((row, rowIndex) => {
    if (row.length > MAX_COLS) throw new Error("XLSX_COLUMN_LIMIT_EXCEEDED");
    const cells = row.map((value, colIndex) => {
      if (value.length > MAX_CELL) throw new Error("XLSX_FIELD_TOO_LONG");
      const ref = `${indexToColLetters(colIndex)}${rowIndex + 1}`;
      const idx = indexOf(value);
      return `<c r="${ref}" t="s"><v>${idx}</v></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  const sharedXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">`
    + shared.map((value) => `<si><t>${xmlEscape(value)}</t></si>`).join("")
    + `</sst>`;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetData>${sheetRows}</sheetData></worksheet>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
    + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
    + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
    + `</Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    + `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`
    + `</Types>`;

  const zipped = zipSync({
    "_rels/.rels": strToU8(rootRels),
    "[Content_Types].xml": strToU8(contentTypes),
    "xl/workbook.xml": strToU8(workbookXml),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml),
    "xl/sharedStrings.xml": strToU8(sharedXml),
  }, { level: 6 });
  if (zipped.byteLength > MAX_BYTES) throw new Error("XLSX_SIZE_REJECTED");
  return zipped;
}

export function sheetRowsToCsv(rows: readonly (readonly string[])[], delimiter: "," | ";"): string {
  const escape = (value: string): string => {
    if (value.includes('"') || value.includes("\n") || value.includes("\r") || value.includes(delimiter)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };
  return `\uFEFF${rows.map((row) => row.map(escape).join(delimiter)).join("\r\n")}\r\n`;
}

export function downloadBytes(filename: string, bytes: Uint8Array, mime: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, text: string, mime: string): void {
  downloadBytes(filename, strToU8(text), mime);
}

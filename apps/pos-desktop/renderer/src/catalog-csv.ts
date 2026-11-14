import { readCsvRecords } from "./csv-records.js";
import { CatalogProductRegisterRequestSchema, type CatalogProductRegisterResult, type CatalogItemListItem, type CatalogItemResult } from "@pos-platform/contracts";
import { callCommercial, type CommercialResponse } from "./pos-service.js";
import { toScale6 } from "./scale6.js";

export const CATALOG_CSV_COLUMNS = ["code", "name", "stock_controlled", "presentation_name", "unit_code", "unit_precision", "barcode", "price_amount", "currency_code"] as const;
const FISCAL_COLUMNS = ["code_reference", "unit_measure_code", "standard_code", "tax_code", "tax_rate"] as const;
const payloadSchema = CatalogProductRegisterRequestSchema.shape.payload;
type Payload = ReturnType<typeof payloadSchema.parse>;
export interface CatalogCsvRow { readonly row: number; readonly payload: Payload | null; readonly errors: readonly string[] }
export interface CatalogCsvPlan { readonly digest: string; readonly rows: readonly CatalogCsvRow[] }


export function catalogCsvTemplate(delimiter: "," | ";" = ","): string {
  return "\uFEFF" + [...CATALOG_CSV_COLUMNS, ...FISCAL_COLUMNS].join(delimiter) + "\r\n";
}

export async function previewCatalogCsv(source: string, delimiter: "," | ";" = ","): Promise<CatalogCsvPlan> {
  const records = readCsvRecords(source.replace(/^\uFEFF/, ""), delimiter);
  const headers = records.shift();
  const allowed = new Set<string>([...CATALOG_CSV_COLUMNS, ...FISCAL_COLUMNS]);
  if (!headers || headers.length !== new Set(headers).size || CATALOG_CSV_COLUMNS.some((name) => !headers.includes(name))
    || headers.some((name) => !allowed.has(name))) throw new Error("CSV_HEADERS_INVALID");
  const digest = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const codes = new Map<string, number[]>(); const barcodes = new Map<string, number[]>();
  const rows = records.map((values, index): CatalogCsvRow => {
    const row = index + 2;
    if (values.length !== headers.length) return { row, payload: null, errors: ["COLUMN_COUNT_MISMATCH"] };
    const cells = Object.fromEntries(headers.map((header, column) => [header, values[column]!]));
    const fiscalPresent = FISCAL_COLUMNS.some((column) => (cells[column] ?? "") !== "");
    const parsed = payloadSchema.safeParse({
      code: cells["code"], name: cells["name"], stock_controlled: cells["stock_controlled"] === "true" ? true : cells["stock_controlled"] === "false" ? false : null,
      presentation_name: cells["presentation_name"], unit_code: cells["unit_code"], unit_precision: /^\d$/.test(cells["unit_precision"] ?? "") ? Number(cells["unit_precision"]) : null,
      barcode: cells["barcode"] === "" ? null : cells["barcode"], price_amount: toScale6(cells["price_amount"] ?? ""), currency_code: cells["currency_code"],
      ...(fiscalPresent ? { fiscal_attributes: { code_reference: cells["code_reference"], unit_measure_code: cells["unit_measure_code"], standard_code: cells["standard_code"], tax_code: cells["tax_code"], tax_rate: toScale6(cells["tax_rate"] ?? "") } } : {}),
    });
    if (!parsed.success) return { row, payload: null, errors: parsed.error.issues.map((issue) => `INVALID:${issue.path.join(".")}`) };
    for (const [map, value] of [[codes, parsed.data.code], [barcodes, parsed.data.barcode]] as const) {
      if (value !== null) map.set(value, [...(map.get(value) ?? []), row]);
    }
    return { row, payload: parsed.data, errors: [] };
  });
  return { digest, rows: rows.map((entry) => ({ ...entry, errors: [...entry.errors,
    ...(entry.payload && (codes.get(entry.payload.code)?.length ?? 0) > 1 ? ["DUPLICATE_CODE"] : []),
    ...(entry.payload?.barcode && (barcodes.get(entry.payload.barcode)?.length ?? 0) > 1 ? ["DUPLICATE_BARCODE"] : []),
  ] })) };
}

export interface CatalogCsvOutcome { readonly row: number; readonly outcome: string }
/** A visible match is advisory. The backend still rejects duplicates at commit;
 * inactive items or concurrent changes cannot be inferred from a preview. */
export async function matchCatalogCsv(plan: CatalogCsvPlan): Promise<CatalogCsvOutcome[]> {
  const matches: CatalogCsvOutcome[] = [];
  for (const row of plan.rows) {
    if (!row.payload || row.errors.length) continue;
    const listed = await callCommercial<{ outcome: string; items: CatalogItemListItem[]; has_more: boolean }>("catalog.item.list", { query: row.payload.code, limit: 60, offset: 0 });
    if (listed.status !== "SUCCEEDED" || listed.result?.outcome !== "FOUND") throw new Error(listed.result_code);
    let outcome = listed.result.items.some((item) => item.code === row.payload!.code) ? "EXISTENTE_POR_CODIGO" : listed.result.has_more ? "RESULTADO_PARCIAL" : "SIN_COINCIDENCIA_VISIBLE";
    if (row.payload.barcode) {
      const scanned = await callCommercial<CatalogItemResult>("catalog.item.find", { barcode: row.payload.barcode });
      if (scanned.result?.outcome === "FOUND") outcome = "EXISTENTE_POR_BARCODE";
      else if (scanned.result?.outcome !== "NOT_FOUND") throw new Error(scanned.result_code);
    }
    matches.push({ row: row.row, outcome });
  }
  return matches;
}
type Register = (payload: Payload, key: string) => Promise<CommercialResponse<CatalogProductRegisterResult>>;
/** Per-row backend transactions, never a client authorization decision or a
 * stock receipt. On transport uncertainty stop; explicit retry reuses keys.
 */
export async function confirmCatalogCsv(
  plan: CatalogCsvPlan,
  onOutcome: (result: CatalogCsvOutcome) => void,
  register: Register = (payload, key) => callCommercial("catalog.product.register", payload, key),
): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(plan.digest) || plan.rows.length === 0 || plan.rows.length > 1000
    || new Set(plan.rows.map((row) => row.row)).size !== plan.rows.length
    || plan.rows.some((row) => !Number.isSafeInteger(row.row) || row.row < 2 || row.errors.length > 0 || !payloadSchema.safeParse(row.payload).success)) throw new Error("CSV_PLAN_INVALID");
  for (const row of plan.rows) {
    let response: CommercialResponse<CatalogProductRegisterResult>;
    try { response = await register(payloadSchema.parse(row.payload), `catalog-csv:${plan.digest}:${row.row}`); }
    catch (error) { onOutcome({ row: row.row, outcome: "TRANSPORT_UNCERTAIN" }); throw error; }
    if (response.status !== "SUCCEEDED" && response.status !== "REJECTED") {
      onOutcome({ row: row.row, outcome: "TRANSPORT_UNCERTAIN" }); throw new Error("CSV_TRANSPORT_UNCERTAIN");
    }
    const outcome = response.result?.outcome ?? response.result_code;
    onOutcome({ row: row.row, outcome });
    if (["REGISTERED", "IDEMPOTENT"].includes(outcome) && response.status !== "SUCCEEDED") throw new Error("CSV_RESULT_INCONSISTENT");
    if (!["REGISTERED", "IDEMPOTENT", "CODE_ALREADY_REGISTERED", "BARCODE_ALREADY_REGISTERED", "INVALID_FISCAL_ATTRIBUTES"].includes(outcome)) throw new Error(`CSV_STOPPED:${outcome}`);
  }
}

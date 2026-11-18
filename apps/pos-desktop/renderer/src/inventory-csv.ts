import { InventoryStockReceiveRequestSchema, InventoryMovementResultSchema } from "@pos-platform/contracts";
import { readCsvRecords } from "./csv-records.js";
import { callCommercial, type CommercialResponse } from "./pos-service.js";
import { toScale6 } from "./scale6.js";

const schema = InventoryStockReceiveRequestSchema.shape.payload;
type Payload = ReturnType<typeof schema.parse>;
export const INVENTORY_CSV_COLUMNS = ["import_id", "row_id", "presentation_id", "movement_type", "quantity", "reason_code", "business_date"] as const;
export type InventoryCsvRow = { row: number; key: string; payload: Payload | null; errors: string[] };
export type InventoryCsvPlan = { rows: InventoryCsvRow[] };
export type InventoryCsvOutcome = { row: number; outcome: string; quantityAfter: string | null };

export function inventoryCsvTemplate(delimiter: "," | ";", importId: string): string {
  return "\uFEFF" + INVENTORY_CSV_COLUMNS.join(delimiter) + "\r\n" +
    [importId, "1", "", "OPENING_COUNT", "", "INITIAL_STOCK", ""].join(delimiter) + "\r\n";
}

/** An explicit import/row identity survives file editing and reordering. Changed
 * quantities with the same identity must conflict in the authoritative ledger. */
export function previewInventoryCsv(source: string, delimiter: "," | ";"): InventoryCsvPlan {
  const records = readCsvRecords(source.replace(/^\uFEFF/, ""), delimiter);
  const headers = records.shift();
  if (!headers || headers.length !== INVENTORY_CSV_COLUMNS.length || new Set(headers).size !== headers.length ||
    INVENTORY_CSV_COLUMNS.some(name => !headers.includes(name))) throw Error("CSV_HEADERS_INVALID");
  const seen = new Set<string>();
  const rows = records.map((values, index): InventoryCsvRow => {
    const row = index + 2;
    if (values.length !== headers.length) return { row, key: "", payload: null, errors: ["COLUMN_COUNT_MISMATCH"] };
    const cells = Object.fromEntries(headers.map((name, col) => [name, values[col]!]));
    const importId = cells.import_id ?? "", rowId = cells.row_id ?? "";
    const identityValid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(importId) && /^[1-9][0-9]{0,5}$/.test(rowId);
    const key = `inventory-csv:${importId}:${rowId}`;
    const errors: string[] = identityValid ? [] : ["IMPORT_OR_ROW_ID_INVALID"];
    if (seen.has(key)) errors.push("DUPLICATE_IMPORT_ROW");
    seen.add(key);
    const parsed = schema.safeParse({ presentation_id: cells.presentation_id, movement_type: cells.movement_type,
      quantity: toScale6(cells.quantity ?? ""), reason_code: cells.reason_code, business_date: cells.business_date });
    if (!parsed.success) errors.push(...parsed.error.issues.map(issue => `INVALID:${issue.path.join(".")}`));
    return { row, key, payload: parsed.success ? parsed.data : null, errors };
  });
  return { rows };
}

type Receive = (payload: Payload, key: string) => Promise<CommercialResponse<unknown>>;
export async function confirmInventoryCsv(plan: InventoryCsvPlan, onOutcome: (result: InventoryCsvOutcome) => void,
  receive: Receive = (payload, key) => callCommercial("inventory.stock.receive", payload, key)): Promise<void> {
  if (!plan.rows.length || plan.rows.length > 1000 || new Set(plan.rows.map(row => row.key)).size !== plan.rows.length ||
    plan.rows.some(row => row.errors.length || !schema.safeParse(row.payload).success ||
      !/^inventory-csv:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}:[1-9][0-9]{0,5}$/.test(row.key))) throw Error("CSV_PLAN_INVALID");
  for (const row of plan.rows) {
    let response: CommercialResponse<unknown>;
    try { response = await receive(schema.parse(row.payload), row.key); }
    catch { onOutcome({ row: row.row, outcome: "TRANSPORT_UNCERTAIN", quantityAfter: null }); throw Error("CSV_TRANSPORT_UNCERTAIN"); }
    if (response.status === "REJECTED" && response.result === null) {
      onOutcome({ row: row.row, outcome: response.result_code, quantityAfter: null });
      throw Error(`CSV_STOPPED:${response.result_code}`);
    }
    const result = InventoryMovementResultSchema.safeParse(response.result);
    if (!result.success || !["SUCCEEDED", "REJECTED"].includes(response.status)) {
      onOutcome({ row: row.row, outcome: "TRANSPORT_UNCERTAIN", quantityAfter: null }); throw Error("CSV_TRANSPORT_UNCERTAIN");
    }
    const value = result.data;
    onOutcome({ row: row.row, outcome: value.outcome, quantityAfter: value.quantity_after });
    if (response.status !== "SUCCEEDED" || !["POSTED", "IDEMPOTENT"].includes(value.outcome)) throw Error(`CSV_STOPPED:${value.outcome}`);
  }
}

import { InventoryStockReceiveRequestSchema, InventoryMovementResultSchema } from "@pos-platform/contracts";
import { notifyCatalogInventoryChanged } from "./catalog-invalidate.js";
import { readCsvRecords } from "./csv-records.js";
import { callCommercial, type CommercialResponse } from "./pos-service.js";
import { toScale6 } from "./scale6.js";
import { readSheetMatrixFromXlsx, sheetRowsToCsv, writeSheetMatrixToXlsx } from "./sheet-workbook.js";

const schema = InventoryStockReceiveRequestSchema.shape.payload;
type Payload = ReturnType<typeof schema.parse>;

export const INVENTORY_CSV_COLUMNS = [
  "import_id",
  "row_id",
  "presentation_id",
  "movement_type",
  "quantity",
  "reason_code",
  "business_date",
  "lote",
  "fecha_fabricacion",
  "fecha_vencimiento",
  "referencia_proveedor",
  "documento_recibo",
] as const;

export type InventoryCsvRow = { row: number; key: string; payload: Payload | null; errors: string[] };
export type InventoryCsvPlan = { rows: InventoryCsvRow[] };
export type InventoryCsvOutcome = { row: number; outcome: string; quantityAfter: string | null };

const LEGACY_COLUMNS = [
  "import_id",
  "row_id",
  "presentation_id",
  "movement_type",
  "quantity",
  "reason_code",
  "business_date",
] as const;

function inventoryTemplateRows(importId: string): string[][] {
  return [
    [...INVENTORY_CSV_COLUMNS],
    [importId, "1", "", "OPENING_COUNT", "", "INITIAL_STOCK", "", "", "", "", "", ""],
  ];
}

export function inventoryCsvTemplate(delimiter: "," | ";", importId: string): string {
  return sheetRowsToCsv(inventoryTemplateRows(importId), delimiter);
}

export function inventoryXlsxTemplate(importId: string): Uint8Array {
  return writeSheetMatrixToXlsx("Existencias", inventoryTemplateRows(importId));
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function previewFromRecords(records: string[][]): InventoryCsvPlan {
  const headers = records.shift();
  if (!headers || new Set(headers).size !== headers.length) throw new Error("CSV_HEADERS_INVALID");
  const legacy = headers.length === LEGACY_COLUMNS.length
    && LEGACY_COLUMNS.every((name) => headers.includes(name));
  const modern = headers.length === INVENTORY_CSV_COLUMNS.length
    && INVENTORY_CSV_COLUMNS.every((name) => headers.includes(name));
  if (!legacy && !modern) throw new Error("CSV_HEADERS_INVALID");

  const seen = new Set<string>();
  const rows = records.map((values, index): InventoryCsvRow => {
    const row = index + 2;
    if (values.length !== headers.length) {
      return { row, key: "", payload: null, errors: ["COLUMN_COUNT_MISMATCH"] };
    }
    const cells = Object.fromEntries(headers.map((name, col) => [name, values[col]!]));
    const importId = cells.import_id ?? "";
    const rowId = cells.row_id ?? "";
    const identityValid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(importId)
      && /^[1-9][0-9]{0,5}$/.test(rowId);
    const key = `inventory-csv:${importId}:${rowId}`;
    const errors: string[] = identityValid ? [] : ["IMPORT_OR_ROW_ID_INVALID"];
    if (seen.has(key)) errors.push("DUPLICATE_IMPORT_ROW");
    seen.add(key);

    const lotCode = emptyToNull(cells.lote);
    const manufacture = emptyToNull(cells.fecha_fabricacion);
    const expiry = emptyToNull(cells.fecha_vencimiento);
    const supplier = emptyToNull(cells.referencia_proveedor);
    const receipt = emptyToNull(cells.documento_recibo);
    const batchFields = [lotCode, manufacture, expiry, supplier, receipt];
    const anyBatch = batchFields.some((value) => value !== null);
    const movementType = cells.movement_type;

    let batch: Payload["batch"] | undefined;
    if (anyBatch) {
      if (movementType !== "PURCHASE_RECEIPT") {
        errors.push("BATCH_REQUIRES_PURCHASE_RECEIPT");
      }
      if (lotCode === null || supplier === null || receipt === null) {
        errors.push("BATCH_FIELDS_INCOMPLETE");
      } else {
        batch = {
          code: lotCode,
          manufacture_date: manufacture,
          expiry_date: expiry,
          supplier_reference: supplier,
          receipt_document: receipt,
        };
      }
    }

    const parsed = schema.safeParse({
      presentation_id: cells.presentation_id,
      movement_type: cells.movement_type,
      quantity: toScale6(cells.quantity ?? ""),
      reason_code: cells.reason_code,
      business_date: cells.business_date,
      ...(batch !== undefined ? { batch } : {}),
    });
    if (!parsed.success) {
      errors.push(...parsed.error.issues.map((issue) => `INVALID:${issue.path.join(".")}`));
    }
    return { row, key, payload: parsed.success ? parsed.data : null, errors };
  });
  return { rows };
}

/** An explicit import/row identity survives file editing and reordering. Changed
 * quantities with the same identity must conflict in the authoritative ledger. */
export function previewInventoryCsv(source: string, delimiter: "," | ";"): InventoryCsvPlan {
  return previewFromRecords(readCsvRecords(source.replace(/^\uFEFF/, ""), delimiter));
}

export function previewInventoryXlsx(bytes: Uint8Array): InventoryCsvPlan {
  return previewFromRecords(readSheetMatrixFromXlsx(bytes).rows.map((row) => [...row]));
}

export async function previewInventoryFile(
  file: File,
  delimiter: "," | ";",
): Promise<InventoryCsvPlan> {
  const name = file.name.toLowerCase();
  if (file.size > 1_048_576) throw new Error("ARCHIVO_DEMASIADO_GRANDE");
  if (name.endsWith(".csv")) return previewInventoryCsv(await file.text(), delimiter);
  if (name.endsWith(".xlsx")) {
    return previewInventoryXlsx(new Uint8Array(await file.arrayBuffer()));
  }
  throw new Error("FORMATO_NO_ADMITIDO");
}

type Receive = (payload: Payload, key: string) => Promise<CommercialResponse<unknown>>;
export async function confirmInventoryCsv(
  plan: InventoryCsvPlan,
  onOutcome: (result: InventoryCsvOutcome) => void,
  receive: Receive = (payload, key) => callCommercial("inventory.stock.receive", payload, key),
): Promise<void> {
  if (!plan.rows.length || plan.rows.length > 1000
    || new Set(plan.rows.map((row) => row.key)).size !== plan.rows.length
    || plan.rows.some((row) => row.errors.length || !schema.safeParse(row.payload).success
      || !/^inventory-csv:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}:[1-9][0-9]{0,5}$/.test(row.key))) {
    throw new Error("CSV_PLAN_INVALID");
  }
  let wrote = false;
  for (const row of plan.rows) {
    let response: CommercialResponse<unknown>;
    try {
      response = await receive(schema.parse(row.payload), row.key);
    } catch {
      onOutcome({ row: row.row, outcome: "TRANSPORT_UNCERTAIN", quantityAfter: null });
      throw new Error("CSV_TRANSPORT_UNCERTAIN");
    }
    if (response.status === "REJECTED" && response.result === null) {
      onOutcome({ row: row.row, outcome: response.result_code, quantityAfter: null });
      throw new Error(`CSV_STOPPED:${response.result_code}`);
    }
    const result = InventoryMovementResultSchema.safeParse(response.result);
    if (!result.success || !["SUCCEEDED", "REJECTED"].includes(response.status)) {
      onOutcome({ row: row.row, outcome: "TRANSPORT_UNCERTAIN", quantityAfter: null });
      throw new Error("CSV_TRANSPORT_UNCERTAIN");
    }
    const value = result.data;
    onOutcome({ row: row.row, outcome: value.outcome, quantityAfter: value.quantity_after });
    if (response.status !== "SUCCEEDED" || !["POSTED", "IDEMPOTENT"].includes(value.outcome)) {
      throw new Error(`CSV_STOPPED:${value.outcome}`);
    }
    wrote = true;
  }
  if (wrote) notifyCatalogInventoryChanged();
}

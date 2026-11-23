/**
 * Importación masiva de catálogo (CSV/XLSX) — operaciones diferenciadas:
 * alta (`catalog.product.register`), actualización (`catalog.product.update`)
 * y precio (`catalog.price.publish`). No escribe existencias.
 */
import {
  CatalogItemListResultSchema,
  CatalogPresentationRegisterResultSchema,
  CatalogPricePublishResultSchema,
  CatalogProductRegisterResultSchema,
  CatalogProductUpdateResultSchema,
  InventoryConversionRuleApproveResultSchema,
  type CatalogItemListItem,
  type CatalogPricePublishResult,
  type CatalogProductRegisterResult,
  type CatalogProductUpdateResult,
} from "@pos-platform/contracts";
import { notifyCatalogInventoryChanged } from "./catalog-invalidate.js";
import { readCsvRecords } from "./csv-records.js";
import { callCommercial, type CommercialResponse } from "./pos-service.js";
import { toScale6 } from "./scale6.js";
import { readSheetMatrixFromXlsx, sheetRowsToCsv, writeSheetMatrixToXlsx } from "./sheet-workbook.js";

export const CATALOG_IMPORT_COLUMNS = [
  "import_id",
  "row_id",
  "codigo_producto",
  "nombre",
  "descripcion",
  "marca",
  "categoria",
  "codigo_barras",
  "presentacion",
  "unidad",
  "precision",
  "cantidad_por_presentacion",
  "presentacion_base",
  "precio_venta",
  "moneda",
  "control_existencias",
  "estado",
] as const;

export type CatalogImportColumn = (typeof CATALOG_IMPORT_COLUMNS)[number];

export type CatalogImportDraft = {
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly brand: string | null;
  readonly category: string | null;
  readonly barcode: string | null;
  readonly presentationName: string;
  readonly unitCode: string;
  readonly unitPrecision: number;
  /** Positive integer: 1 of this presentation converts to N of presentacion_base. */
  readonly quantityPerPresentation: string | null;
  readonly basePresentationName: string | null;
  readonly priceAmount: string;
  readonly currencyCode: string;
  readonly stockControlled: boolean;
  readonly status: "ACTIVE" | "INACTIVE";
};

export type CatalogImportRow = {
  readonly row: number;
  readonly key: string;
  readonly draft: CatalogImportDraft | null;
  readonly errors: readonly string[];
  readonly notes: readonly string[];
};

export type CatalogImportPlan = { readonly rows: readonly CatalogImportRow[] };

export type CatalogImportOutcome = {
  readonly row: number;
  readonly outcome: string;
  readonly productId: string | null;
  readonly presentationId: string | null;
};

const UUID_V4 =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ROW_ID = /^[1-9][0-9]{0,5}$/;

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseStockControlled(raw: string): boolean | null {
  const value = raw.trim().toUpperCase();
  if (value === "" || value === "1" || value === "SI" || value === "SÍ" || value === "TRUE" || value === "YES") {
    return true;
  }
  if (value === "0" || value === "NO" || value === "FALSE") return false;
  return null;
}

function parseStatus(raw: string): "ACTIVE" | "INACTIVE" | null {
  const value = raw.trim().toUpperCase();
  if (value === "" || value === "ACTIVE" || value === "ACTIVO") return "ACTIVE";
  if (value === "INACTIVE" || value === "INACTIVO") return "INACTIVE";
  return null;
}

function matrixToRecords(rows: readonly (readonly string[])[]): string[][] {
  return rows.map((row) => [...row]);
}

export function catalogImportTemplateRows(importId: string): string[][] {
  return [
    [...CATALOG_IMPORT_COLUMNS],
    [
      importId,
      "1",
      "PROD-001",
      "Producto ejemplo",
      "Descripción comercial",
      "Marca",
      "Categoría",
      "",
      "Unidad",
      "UND",
      "0",
      "",
      "",
      "1500",
      "COP",
      "SI",
      "ACTIVO",
    ],
  ];
}

export function catalogImportCsvTemplate(delimiter: "," | ";", importId: string): string {
  return sheetRowsToCsv(catalogImportTemplateRows(importId), delimiter);
}

export function catalogImportXlsxTemplate(importId: string): Uint8Array {
  return writeSheetMatrixToXlsx("Catalogo", catalogImportTemplateRows(importId));
}

function previewFromRecords(records: string[][]): CatalogImportPlan {
  const headers = records.shift();
  if (
    !headers
    || headers.length !== CATALOG_IMPORT_COLUMNS.length
    || new Set(headers).size !== headers.length
    || CATALOG_IMPORT_COLUMNS.some((name) => !headers.includes(name))
  ) {
    throw new Error("CATALOG_HEADERS_INVALID");
  }
  if (records.length === 0) throw new Error("CATALOG_ROWS_EMPTY");
  if (records.length > 1000) throw new Error("CATALOG_ROW_LIMIT_EXCEEDED");

  const seen = new Set<string>();
  const seenCodes = new Set<string>();
  const rows = records.map((values, index): CatalogImportRow => {
    const row = index + 2;
    if (values.length !== headers.length) {
      return { row, key: "", draft: null, errors: ["COLUMN_COUNT_MISMATCH"], notes: [] };
    }
    const cells = Object.fromEntries(headers.map((name, col) => [name, values[col] ?? ""])) as Record<
      CatalogImportColumn,
      string
    >;
    const importId = cells.import_id.trim();
    const rowId = cells.row_id.trim();
    const identityValid = UUID_V4.test(importId) && ROW_ID.test(rowId);
    const key = `catalog-import:${importId}:${rowId}`;
    const errors: string[] = identityValid ? [] : ["IMPORT_OR_ROW_ID_INVALID"];
    if (seen.has(key)) errors.push("DUPLICATE_IMPORT_ROW");
    seen.add(key);

    const code = cells.codigo_producto.trim();
    const name = cells.nombre.trim();
    const presentationName = cells.presentacion.trim();
    const unitCode = cells.unidad.trim();
    const precisionRaw = cells.precision.trim();
    const priceRaw = cells.precio_venta.trim();
    const currencyCode = (cells.moneda.trim() || "COP").toUpperCase();
    const stockControlled = parseStockControlled(cells.control_existencias);
    const status = parseStatus(cells.estado);
    const priceAmount = toScale6(priceRaw);
    const unitPrecision = Number.parseInt(precisionRaw, 10);
    const notes: string[] = [];

    if (code === "") errors.push("CODIGO_REQUERIDO");
    if (name === "") errors.push("NOMBRE_REQUERIDO");
    if (presentationName === "") errors.push("PRESENTACION_REQUERIDA");
    if (unitCode === "") errors.push("UNIDAD_REQUERIDA");
    if (!Number.isInteger(unitPrecision) || unitPrecision < 0 || unitPrecision > 6) {
      errors.push("PRECISION_INVALIDA");
    }
    if (priceAmount === null) errors.push("PRECIO_INVALIDO");
    if (!/^[A-Z]{3}$/.test(currencyCode)) errors.push("MONEDA_INVALIDA");
    if (stockControlled === null) errors.push("CONTROL_EXISTENCIAS_INVALIDO");
    if (status === null) errors.push("ESTADO_INVALIDO");
    if (code !== "" && seenCodes.has(code.toUpperCase())) errors.push("CODIGO_DUPLICADO_EN_PLANILLA");
    if (code !== "") seenCodes.add(code.toUpperCase());

    const description = emptyToNull(cells.descripcion);
    const brand = emptyToNull(cells.marca);
    const category = emptyToNull(cells.categoria);
    const barcode = emptyToNull(cells.codigo_barras);
    const quantityRaw = emptyToNull(cells.cantidad_por_presentacion);
    const basePresentationName = emptyToNull(cells.presentacion_base);
    let quantityPerPresentation: string | null = null;
    if (quantityRaw !== null) {
      if (!/^[1-9][0-9]{0,11}$/.test(quantityRaw)) {
        errors.push("CANTIDAD_PRESENTACION_INVALIDA");
      } else if (basePresentationName === null) {
        errors.push("PRESENTACION_BASE_REQUERIDA");
      } else if (basePresentationName === presentationName) {
        errors.push("PRESENTACION_BASE_IGUAL");
      } else {
        quantityPerPresentation = quantityRaw;
        notes.push("CONVERSION_RULE_PENDING");
      }
    } else if (basePresentationName !== null) {
      errors.push("CANTIDAD_PRESENTACION_REQUERIDA");
    }
    if (description !== null && description.length > 2000) errors.push("DESCRIPCION_LARGA");
    if (brand !== null && brand.length > 120) errors.push("MARCA_LARGA");
    if (category !== null && category.length > 120) errors.push("CATEGORIA_LARGA");

    if (errors.length > 0 || priceAmount === null || stockControlled === null || status === null
      || !Number.isInteger(unitPrecision) || unitPrecision < 0 || unitPrecision > 6) {
      return { row, key, draft: null, errors, notes };
    }

    return {
      row,
      key,
      draft: {
        code,
        name,
        description,
        brand,
        category,
        barcode,
        presentationName,
        unitCode,
        unitPrecision,
        quantityPerPresentation,
        basePresentationName,
        priceAmount,
        currencyCode,
        stockControlled,
        status,
      },
      errors,
      notes,
    };
  });
  return { rows };
}

export function previewCatalogCsv(source: string, delimiter: "," | ";"): CatalogImportPlan {
  return previewFromRecords(readCsvRecords(source.replace(/^\uFEFF/, ""), delimiter));
}

export function previewCatalogXlsx(bytes: Uint8Array): CatalogImportPlan {
  const matrix = readSheetMatrixFromXlsx(bytes);
  return previewFromRecords(matrixToRecords(matrix.rows));
}

export async function previewCatalogFile(
  file: File,
  delimiter: "," | ";",
): Promise<CatalogImportPlan> {
  const name = file.name.toLowerCase();
  if (file.size > 1_048_576) throw new Error("ARCHIVO_DEMASIADO_GRANDE");
  if (name.endsWith(".csv")) {
    return previewCatalogCsv(await file.text(), delimiter);
  }
  if (name.endsWith(".xlsx")) {
    return previewCatalogXlsx(new Uint8Array(await file.arrayBuffer()));
  }
  throw new Error("FORMATO_NO_ADMITIDO");
}

type ListFn = (query: string) => Promise<CommercialResponse<unknown>>;
type RegisterFn = (
  payload: Record<string, unknown>,
  key: string,
) => Promise<CommercialResponse<unknown>>;
type UpdateFn = (
  payload: Record<string, unknown>,
  key: string,
) => Promise<CommercialResponse<unknown>>;
type PublishFn = (
  payload: Record<string, unknown>,
  key: string,
) => Promise<CommercialResponse<unknown>>;
type AddPresentationFn = (
  payload: Record<string, unknown>,
  key: string,
) => Promise<CommercialResponse<unknown>>;
type ApproveConversionFn = (
  payload: Record<string, unknown>,
  key: string,
) => Promise<CommercialResponse<unknown>>;

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

function needsProductUpdate(item: CatalogItemListItem, draft: CatalogImportDraft): boolean {
  return item.name !== draft.name
    || item.code !== draft.code
    || !sameText(item.description, draft.description)
    || !sameText(item.brand, draft.brand)
    || !sameText(item.category, draft.category)
    || item.presentation_name !== draft.presentationName
    || !sameText(item.barcode, draft.barcode)
    || draft.status === "INACTIVE";
}

export async function confirmCatalogImport(
  plan: CatalogImportPlan,
  onOutcome: (result: CatalogImportOutcome) => void,
  deps: {
    list?: ListFn;
    register?: RegisterFn;
    update?: UpdateFn;
    publish?: PublishFn;
    addPresentation?: AddPresentationFn;
    approveConversion?: ApproveConversionFn;
  } = {},
): Promise<void> {
  const list = deps.list ?? ((query) => callCommercial("catalog.item.list", { query, limit: 24, offset: 0 }));
  const register = deps.register
    ?? ((payload, key) => callCommercial("catalog.product.register", payload, key));
  const update = deps.update
    ?? ((payload, key) => callCommercial("catalog.product.update", payload, key));
  const publish = deps.publish
    ?? ((payload, key) => callCommercial("catalog.price.publish", payload, key));
  const addPresentation = deps.addPresentation
    ?? ((payload, key) => callCommercial("catalog.presentation.register", payload, key));
  const approveConversion = deps.approveConversion
    ?? ((payload, key) => callCommercial("inventory.conversion.rule.approve", payload, key));
  /** Presentations confirmed in this run: productCode|presentationName → id. */
  const knownPresentations = new Map<string, { productId: string; presentationId: string }>();

  if (
    !plan.rows.length
    || plan.rows.length > 1000
    || new Set(plan.rows.map((row) => row.key)).size !== plan.rows.length
    || plan.rows.some((row) => row.errors.length > 0 || row.draft === null
      || !/^catalog-import:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}:[1-9][0-9]{0,5}$/.test(row.key))
  ) {
    throw new Error("CATALOG_PLAN_INVALID");
  }

  let wrote = false;
  for (const row of plan.rows) {
    const draft = row.draft!;
    let listResponse: CommercialResponse<unknown>;
    try {
      listResponse = await list(draft.code);
    } catch {
      onOutcome({ row: row.row, outcome: "TRANSPORT_UNCERTAIN", productId: null, presentationId: null });
      throw new Error("CATALOG_TRANSPORT_UNCERTAIN");
    }
    const listed = CatalogItemListResultSchema.safeParse(listResponse.result);
    if (listResponse.status === "REJECTED" && listResponse.result === null) {
      onOutcome({
        row: row.row,
        outcome: listResponse.result_code,
        productId: null,
        presentationId: null,
      });
      throw new Error(`CATALOG_STOPPED:${listResponse.result_code}`);
    }
    if (!listed.success || listResponse.status !== "SUCCEEDED" || listed.data.outcome !== "FOUND") {
      onOutcome({ row: row.row, outcome: "TRANSPORT_UNCERTAIN", productId: null, presentationId: null });
      throw new Error("CATALOG_TRANSPORT_UNCERTAIN");
    }

    const presentationKey = `${draft.code.toUpperCase()}|${draft.presentationName}`;
    const exact = listed.data.items.find(
      (item) => item.code === draft.code && item.presentation_name === draft.presentationName,
    );
    const sameProduct = listed.data.items.find((item) => item.code === draft.code);

    const rememberPresentation = (productId: string, presentationId: string): void => {
      knownPresentations.set(presentationKey, { productId, presentationId });
    };

    const approvePendingConversion = async (
      productId: string,
      presentationId: string,
    ): Promise<void> => {
      if (draft.quantityPerPresentation === null || draft.basePresentationName === null) return;
      const baseKey = `${draft.code.toUpperCase()}|${draft.basePresentationName}`;
      const fromRun = knownPresentations.get(baseKey);
      const fromList = listed.data.items.find(
        (item) => item.code === draft.code && item.presentation_name === draft.basePresentationName,
      );
      const basePresentationId = fromRun?.presentationId ?? fromList?.presentation_id ?? null;
      if (basePresentationId === null) {
        onOutcome({
          row: row.row,
          outcome: "CONVERSION_BASE_NOT_FOUND",
          productId,
          presentationId,
        });
        throw new Error("CATALOG_STOPPED:CONVERSION_BASE_NOT_FOUND");
      }
      let response: CommercialResponse<unknown>;
      try {
        response = await approveConversion({
          source_presentation_id: presentationId,
          target_presentation_id: basePresentationId,
          numerator: draft.quantityPerPresentation,
          denominator: "1",
          version: 1,
        }, `${row.key}:conversion`);
      } catch {
        onOutcome({
          row: row.row,
          outcome: "TRANSPORT_UNCERTAIN",
          productId,
          presentationId,
        });
        throw new Error("CATALOG_TRANSPORT_UNCERTAIN");
      }
      const parsed = InventoryConversionRuleApproveResultSchema.safeParse(response.result);
      if (!parsed.success || response.status !== "SUCCEEDED"
        || !["APPROVED", "IDEMPOTENT"].includes(parsed.data.outcome)) {
        onOutcome({
          row: row.row,
          outcome: parsed.success ? parsed.data.outcome : response.result_code,
          productId,
          presentationId,
        });
        throw new Error(`CATALOG_STOPPED:${parsed.success ? parsed.data.outcome : response.result_code}`);
      }
    };

    if (exact === undefined && sameProduct === undefined) {
      let response: CommercialResponse<unknown>;
      try {
        response = await register({
          code: draft.code,
          name: draft.name,
          description: draft.description,
          brand: draft.brand,
          category: draft.category,
          stock_controlled: draft.stockControlled,
          presentation_name: draft.presentationName,
          unit_code: draft.unitCode,
          unit_precision: draft.unitPrecision,
          barcode: draft.barcode,
          price_amount: draft.priceAmount,
          currency_code: draft.currencyCode,
        }, row.key);
      } catch {
        onOutcome({ row: row.row, outcome: "TRANSPORT_UNCERTAIN", productId: null, presentationId: null });
        throw new Error("CATALOG_TRANSPORT_UNCERTAIN");
      }
      if (response.status === "REJECTED" && response.result === null) {
        onOutcome({
          row: row.row,
          outcome: response.result_code,
          productId: null,
          presentationId: null,
        });
        throw new Error(`CATALOG_STOPPED:${response.result_code}`);
      }
      const parsed = CatalogProductRegisterResultSchema.safeParse(response.result);
      if (!parsed.success || !["SUCCEEDED", "REJECTED"].includes(response.status)) {
        onOutcome({ row: row.row, outcome: "TRANSPORT_UNCERTAIN", productId: null, presentationId: null });
        throw new Error("CATALOG_TRANSPORT_UNCERTAIN");
      }
      const value = parsed.data;
      if (response.status !== "SUCCEEDED" || !["REGISTERED", "IDEMPOTENT"].includes(value.outcome)
        || value.product_id === null || value.presentation_id === null) {
        onOutcome({
          row: row.row,
          outcome: value.outcome,
          productId: value.product_id,
          presentationId: value.presentation_id,
        });
        throw new Error(`CATALOG_STOPPED:${value.outcome}`);
      }
      rememberPresentation(value.product_id, value.presentation_id);
      await approvePendingConversion(value.product_id, value.presentation_id);
      onOutcome({
        row: row.row,
        outcome: value.outcome,
        productId: value.product_id,
        presentationId: value.presentation_id,
      });
      wrote = true;
      continue;
    }

    if (exact === undefined && sameProduct !== undefined) {
      let response: CommercialResponse<unknown>;
      try {
        response = await addPresentation({
          product_id: sameProduct.product_id,
          presentation_name: draft.presentationName,
          unit_code: draft.unitCode,
          unit_precision: draft.unitPrecision,
          barcode: draft.barcode,
          price_amount: draft.priceAmount,
          currency_code: draft.currencyCode,
        }, row.key);
      } catch {
        onOutcome({
          row: row.row,
          outcome: "TRANSPORT_UNCERTAIN",
          productId: sameProduct.product_id,
          presentationId: null,
        });
        throw new Error("CATALOG_TRANSPORT_UNCERTAIN");
      }
      const parsed = CatalogPresentationRegisterResultSchema.safeParse(response.result);
      if (!parsed.success || response.status !== "SUCCEEDED"
        || !["REGISTERED", "IDEMPOTENT"].includes(parsed.data.outcome)
        || parsed.data.product_id === null || parsed.data.presentation_id === null) {
        onOutcome({
          row: row.row,
          outcome: parsed.success ? parsed.data.outcome : response.result_code,
          productId: sameProduct.product_id,
          presentationId: parsed.success ? parsed.data.presentation_id : null,
        });
        throw new Error(`CATALOG_STOPPED:${parsed.success ? parsed.data.outcome : response.result_code}`);
      }
      rememberPresentation(parsed.data.product_id, parsed.data.presentation_id);
      await approvePendingConversion(parsed.data.product_id, parsed.data.presentation_id);
      onOutcome({
        row: row.row,
        outcome: parsed.data.outcome,
        productId: parsed.data.product_id,
        presentationId: parsed.data.presentation_id,
      });
      wrote = true;
      continue;
    }

    if (exact === undefined) {
      onOutcome({ row: row.row, outcome: "TRANSPORT_UNCERTAIN", productId: null, presentationId: null });
      throw new Error("CATALOG_TRANSPORT_UNCERTAIN");
    }

    if (exact.unit_code !== draft.unitCode || exact.unit_precision !== draft.unitPrecision) {
      onOutcome({
        row: row.row,
        outcome: "UNIT_CHANGE_FORBIDDEN",
        productId: exact.product_id,
        presentationId: exact.presentation_id,
      });
      throw new Error("CATALOG_STOPPED:UNIT_CHANGE_FORBIDDEN");
    }

    let productId = exact.product_id;
    let presentationId = exact.presentation_id;
    let rowOutcome = "IDEMPOTENT";

    // Probe whether this import row already created the product. An IDEMPOTENT
    // register means the alta already committed under this identity — never
    // re-apply spreadsheet fields as a silent update over later admin edits.
    let registerProbe: CommercialResponse<unknown>;
    try {
      registerProbe = await register({
        code: draft.code,
        name: draft.name,
        description: draft.description,
        brand: draft.brand,
        category: draft.category,
        stock_controlled: draft.stockControlled,
        presentation_name: draft.presentationName,
        unit_code: draft.unitCode,
        unit_precision: draft.unitPrecision,
        barcode: draft.barcode,
        price_amount: draft.priceAmount,
        currency_code: draft.currencyCode,
      }, row.key);
    } catch {
      onOutcome({
        row: row.row,
        outcome: "TRANSPORT_UNCERTAIN",
        productId: exact.product_id,
        presentationId: exact.presentation_id,
      });
      throw new Error("CATALOG_TRANSPORT_UNCERTAIN");
    }
    const probed = CatalogProductRegisterResultSchema.safeParse(registerProbe.result);
    const probeOutcome = probed.success
      ? probed.data.outcome
      : registerProbe.result_code;
    if (probeOutcome === "IDEMPOTENT") {
      productId = probed.success && probed.data.product_id !== null
        ? probed.data.product_id
        : exact.product_id;
      presentationId = probed.success && probed.data.presentation_id !== null
        ? probed.data.presentation_id
        : exact.presentation_id;
      // Alta already committed under this import identity. Do not rewrite
      // commercial fields or price over later authorized edits.
      rememberPresentation(productId, presentationId);
      await approvePendingConversion(productId, presentationId);
      onOutcome({ row: row.row, outcome: "IDEMPOTENT", productId, presentationId });
      continue;
    }
    if (probeOutcome === "IDEMPOTENCY_CONFLICT") {
      onOutcome({
        row: row.row,
        outcome: "IDEMPOTENCY_CONFLICT",
        productId: exact.product_id,
        presentationId: exact.presentation_id,
      });
      throw new Error("CATALOG_STOPPED:IDEMPOTENCY_CONFLICT");
    }
    if (probeOutcome !== "CODE_ALREADY_REGISTERED" && probeOutcome !== "BARCODE_ALREADY_REGISTERED") {
      onOutcome({
        row: row.row,
        outcome: typeof probeOutcome === "string" ? probeOutcome : "TRANSPORT_UNCERTAIN",
        productId: exact.product_id,
        presentationId: exact.presentation_id,
      });
      throw new Error(`CATALOG_STOPPED:${String(probeOutcome)}`);
    }

    if (needsProductUpdate(exact, draft)) {
      let response: CommercialResponse<unknown>;
      try {
        response = await update({
          product_id: exact.product_id,
          expected_version: exact.product_version,
          name: draft.name,
          code: draft.code,
          description: draft.description,
          brand: draft.brand,
          category: draft.category,
          status: draft.status,
          presentation_id: exact.presentation_id,
          presentation_expected_version: exact.presentation_version,
          presentation_name: draft.presentationName,
          barcode: draft.barcode,
          reason: "CATALOG_IMPORT",
        }, `${row.key}:update`);
      } catch {
        onOutcome({
          row: row.row,
          outcome: "TRANSPORT_UNCERTAIN",
          productId: exact.product_id,
          presentationId: exact.presentation_id,
        });
        throw new Error("CATALOG_TRANSPORT_UNCERTAIN");
      }
      if (response.status === "REJECTED" && response.result === null) {
        onOutcome({
          row: row.row,
          outcome: response.result_code,
          productId: exact.product_id,
          presentationId: exact.presentation_id,
        });
        throw new Error(`CATALOG_STOPPED:${response.result_code}`);
      }
      const parsed = CatalogProductUpdateResultSchema.safeParse(response.result);
      if (!parsed.success || !["SUCCEEDED", "REJECTED"].includes(response.status)) {
        onOutcome({
          row: row.row,
          outcome: "TRANSPORT_UNCERTAIN",
          productId: exact.product_id,
          presentationId: exact.presentation_id,
        });
        throw new Error("CATALOG_TRANSPORT_UNCERTAIN");
      }
      const value = parsed.data;
      rowOutcome = value.outcome;
      productId = value.product_id ?? exact.product_id;
      // VERSION_CONFLICT / IDEMPOTENCY_CONFLICT: another writer changed the product
      // or this import identity already applied a different payload — do not overwrite.
      if (response.status !== "SUCCEEDED" || !["UPDATED", "IDEMPOTENT"].includes(value.outcome)) {
        onOutcome({
          row: row.row,
          outcome: value.outcome,
          productId,
          presentationId,
        });
        throw new Error(`CATALOG_STOPPED:${value.outcome}`);
      }
      wrote = true;
    }

    if (exact.price_amount !== draft.priceAmount || exact.currency_code !== draft.currencyCode) {
      let response: CommercialResponse<unknown>;
      try {
        response = await publish({
          presentation_id: presentationId,
          amount: draft.priceAmount,
          currency_code: draft.currencyCode,
        }, `${row.key}:price`);
      } catch {
        onOutcome({
          row: row.row,
          outcome: "TRANSPORT_UNCERTAIN",
          productId,
          presentationId,
        });
        throw new Error("CATALOG_TRANSPORT_UNCERTAIN");
      }
      if (response.status === "REJECTED" && response.result === null) {
        onOutcome({
          row: row.row,
          outcome: response.result_code,
          productId,
          presentationId,
        });
        throw new Error(`CATALOG_STOPPED:${response.result_code}`);
      }
      const parsed = CatalogPricePublishResultSchema.safeParse(response.result);
      if (!parsed.success || !["SUCCEEDED", "REJECTED"].includes(response.status)) {
        onOutcome({
          row: row.row,
          outcome: "TRANSPORT_UNCERTAIN",
          productId,
          presentationId,
        });
        throw new Error("CATALOG_TRANSPORT_UNCERTAIN");
      }
      const value = parsed.data as CatalogPricePublishResult;
      if (rowOutcome === "IDEMPOTENT" && !needsProductUpdate(exact, draft)) {
        rowOutcome = value.outcome;
      }
      if (response.status !== "SUCCEEDED" || !["PUBLISHED", "IDEMPOTENT"].includes(value.outcome)) {
        onOutcome({ row: row.row, outcome: value.outcome, productId, presentationId });
        throw new Error(`CATALOG_STOPPED:${value.outcome}`);
      }
      wrote = true;
    }

    rememberPresentation(productId, presentationId);
    await approvePendingConversion(productId, presentationId);
    onOutcome({
      row: row.row,
      outcome: rowOutcome,
      productId,
      presentationId,
    });
  }

  if (wrote) notifyCatalogInventoryChanged();
}

export type { CatalogProductRegisterResult, CatalogProductUpdateResult };

import * as z from "zod";
import {
  PRODUCT_STANDARD_CODES,
  TAX_CODES,
  UNIT_MEASURE_CODES,
  isVerifiedCode,
} from "./codes.js";

/**
 * Línea de documento fiscal — tercera pieza de `D-9`.
 *
 * `provider-payload-shapes.md` §FACTUS registra el `items[]` del cuerpo de
 * emisión y anota, en la misma fila, «Catalog y Tax — **NO EXISTEN**». Esto es
 * la forma canónica de esa línea: qué hay que saber de un artículo para que
 * pueda ir en una factura.
 *
 * No habla con ningún proveedor, no persiste nada y **no calcula el impuesto**.
 * Calcularlo es del motor de precios, que hoy tiene `taxUnits: 0n` fijo; esta
 * pieza declara la forma y comprueba lo comprobable contra las tablas DIAN ya
 * verificadas.
 *
 * ## El hallazgo que más condiciona el diseño
 *
 * **El POS lleva el dinero en escala 6 y el proveedor acepta dos decimales.**
 * La documentación es explícita: «todos los numéricos van como `string` con
 * máximo dos decimales». Un importe con dígitos significativos más allá del
 * segundo decimal **no se puede transmitir con fidelidad**, y redondearlo en
 * silencio emitiría una factura que no coincide con lo que el cliente pagó.
 *
 * Por eso la conversión no redondea: devuelve el valor exacto o dice que no
 * puede. No es teórico —una báscula produce `0.333333` kg— y queda registrado
 * como `D-14`.
 *
 * ## Descuento: uno u otro, y lo garantiza el tipo
 *
 * La documentación dice `discount_rate` **o** `discount_amount`, nunca ambos.
 * En vez de comprobarlo en tiempo de ejecución, el descuento es una unión
 * discriminada: **una línea con las dos formas no compila**. Es la misma
 * técnica de `CustomerIssuanceReadiness` y de `DocumentIssuanceOutcome`.
 */

/** De dónde sale cada regla, igual que en `customer.ts`. */
export const ITEM_RULE_SOURCES = ["FACTUS_OFFICIAL_DOC", "DERIVED"] as const;

export type ItemRuleSource = (typeof ITEM_RULE_SOURCES)[number];

/** Un impuesto de la línea: código DIAN y tasa. */
export interface FiscalItemTax {
  /** Código DIAN de impuesto (`TAX_CODES`): `"01"` IVA, `"04"` INC. */
  readonly code: string;
  /** Tasa en porcentaje, escala 6. `"19.000000"` es el 19 %. */
  readonly rate: string;
}

/**
 * Descuento de la línea.
 *
 * Unión discriminada a propósito: el contrato admite tasa **o** importe y nunca
 * los dos, y un tipo que no puede expresar el caso prohibido es mejor que una
 * comprobación que hay que acordarse de escribir.
 */
export type FiscalItemDiscount =
  | { readonly kind: "RATE"; readonly rate: string }
  | { readonly kind: "AMOUNT"; readonly amount: string };

export interface FiscalDocumentItem {
  /** Código del artículo en el catálogo del comerciante. */
  readonly codeReference: string;
  readonly name: string;
  /** Cantidad, escala 6. */
  readonly quantity: string;
  /** Precio unitario, escala 6. */
  readonly unitPrice: string;
  /** Código DIAN de unidad de medida (`UNIT_MEASURE_CODES`). */
  readonly unitMeasureCode: string;
  /** Código DIAN de estándar de producto (`PRODUCT_STANDARD_CODES`). */
  readonly standardCode: string;
  readonly discount: FiscalItemDiscount | null;
  readonly taxes: readonly FiscalItemTax[];
}

const SCALE6 = /^\d+\.\d{6}$/;

const Scale6Schema = z.string().regex(SCALE6);

export const FiscalItemTaxSchema: z.ZodType<FiscalItemTax> = z.strictObject({
  code: z.string().min(1).max(8),
  rate: Scale6Schema,
});

export const FiscalItemDiscountSchema: z.ZodType<FiscalItemDiscount> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("RATE"), rate: Scale6Schema }),
  z.strictObject({ kind: z.literal("AMOUNT"), amount: Scale6Schema }),
]);

export const FiscalDocumentItemSchema: z.ZodType<FiscalDocumentItem> = z.strictObject({
  codeReference: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  quantity: Scale6Schema,
  unitPrice: Scale6Schema,
  unitMeasureCode: z.string().min(1).max(8),
  standardCode: z.string().min(1).max(8),
  discount: FiscalItemDiscountSchema.nullable(),
  taxes: z.array(FiscalItemTaxSchema).max(16),
});

// ── Precisión del proveedor ──────────────────────────────────────────────────

/**
 * Resultado de llevar un importe de escala 6 a los dos decimales del proveedor.
 *
 * Sólo la rama `EXACT` lleva el valor, así que **no existe forma de transmitir
 * un importe que se perdió al convertir**: no compila.
 */
export type ProviderDecimal =
  | { readonly kind: "EXACT"; readonly value: string }
  | { readonly kind: "NOT_REPRESENTABLE" };

/**
 * Convierte escala 6 a los dos decimales del proveedor **sin redondear**.
 *
 * Redondear aquí produciría una factura que no coincide con lo cobrado, y el
 * descuadre aparecería en la contabilidad del comerciante, no en un registro
 * nuestro. Si los dígitos 3 a 6 no son todos cero, la respuesta es
 * `NOT_REPRESENTABLE` y la decisión sube a quien pueda tomarla.
 */
export function toProviderDecimal(scale6: string): ProviderDecimal {
  if (!SCALE6.test(scale6)) return { kind: "NOT_REPRESENTABLE" };
  const [integer, fractional] = scale6.split(".") as [string, string];
  const kept = fractional.slice(0, 2);
  const dropped = fractional.slice(2);
  if (dropped !== "0000") return { kind: "NOT_REPRESENTABLE" };
  return { kind: "EXACT", value: `${integer}.${kept}` };
}

// ── Comprobación ─────────────────────────────────────────────────────────────

export const FISCAL_ITEM_FINDING_CODES = [
  "UNIT_MEASURE_CODE_NOT_VERIFIED",
  "PRODUCT_STANDARD_CODE_NOT_VERIFIED",
  "TAX_CODE_NOT_VERIFIED",
  "TAXES_EMPTY",
  "QUANTITY_NOT_POSITIVE",
  "UNIT_PRICE_NOT_POSITIVE",
  "TAX_RATE_OUT_OF_RANGE",
  "DISCOUNT_RATE_OUT_OF_RANGE",
  "QUANTITY_EXCEEDS_PROVIDER_PRECISION",
  "UNIT_PRICE_EXCEEDS_PROVIDER_PRECISION",
  "DISCOUNT_EXCEEDS_PROVIDER_PRECISION",
  "TAX_RATE_EXCEEDS_PROVIDER_PRECISION",
] as const;

export type FiscalItemFindingCode = (typeof FISCAL_ITEM_FINDING_CODES)[number];

/** Código y ruta, jamás el valor. Misma regla que `PayloadValidationFinding`. */
export interface FiscalItemFinding {
  readonly code: FiscalItemFindingCode;
  readonly path: string;
  readonly source: ItemRuleSource;
}

const DOC = "FACTUS_OFFICIAL_DOC" as const;
const DER = "DERIVED" as const;

const HUNDRED_SCALE6 = 100_000_000n;

/** Escala 6 a entero, sin punto flotante. Asume formato ya validado. */
function scale6Units(text: string): bigint {
  const [integer, fractional] = text.split(".") as [string, string];
  return BigInt(integer) * 1_000_000n + BigInt(fractional);
}

/**
 * Comprueba la línea contra las tablas DIAN verificadas, las reglas
 * documentadas y la precisión que admite el proveedor.
 *
 * Devuelve **todos** los hallazgos. Una lista vacía significa «no encontré nada
 * que contradiga lo verificado»; no significa que la DIAN vaya a aceptarla.
 */
export function validateFiscalDocumentItem(
  item: FiscalDocumentItem,
): readonly FiscalItemFinding[] {
  const findings: FiscalItemFinding[] = [];
  const add = (code: FiscalItemFindingCode, path: string, source: ItemRuleSource): void => {
    findings.push({ code, path, source });
  };

  if (!isVerifiedCode(UNIT_MEASURE_CODES, item.unitMeasureCode)) {
    add("UNIT_MEASURE_CODE_NOT_VERIFIED", "unitMeasureCode", DOC);
  }
  if (!isVerifiedCode(PRODUCT_STANDARD_CODES, item.standardCode)) {
    add("PRODUCT_STANDARD_CODE_NOT_VERIFIED", "standardCode", DOC);
  }

  if (!SCALE6.test(item.quantity) || scale6Units(item.quantity) <= 0n) {
    add("QUANTITY_NOT_POSITIVE", "quantity", DER);
  } else if (toProviderDecimal(item.quantity).kind === "NOT_REPRESENTABLE") {
    // Una báscula produce `0.333333` kg. No es un caso teórico.
    add("QUANTITY_EXCEEDS_PROVIDER_PRECISION", "quantity", DOC);
  }

  if (!SCALE6.test(item.unitPrice) || scale6Units(item.unitPrice) <= 0n) {
    add("UNIT_PRICE_NOT_POSITIVE", "unitPrice", DER);
  } else if (toProviderDecimal(item.unitPrice).kind === "NOT_REPRESENTABLE") {
    add("UNIT_PRICE_EXCEEDS_PROVIDER_PRECISION", "unitPrice", DOC);
  }

  // `taxes[]` figura en el cuerpo documentado. Un array presente y vacío no es
  // «ausente»: la regla 2 del contrato —un opcional de tipo array, una vez
  // recibe datos, pasa a ser obligatorio con sus campos internos— deja ese caso
  // sin definir. Se marca en vez de suponer, igual que en `customer.ts`.
  if (item.taxes.length === 0) add("TAXES_EMPTY", "taxes", DER);

  item.taxes.forEach((tax, index) => {
    const at = `taxes[${String(index)}]`;
    if (!isVerifiedCode(TAX_CODES, tax.code)) {
      add("TAX_CODE_NOT_VERIFIED", `${at}.code`, DOC);
    }
    if (!SCALE6.test(tax.rate)) {
      add("TAX_RATE_OUT_OF_RANGE", `${at}.rate`, DER);
      return;
    }
    const units = scale6Units(tax.rate);
    // Una tasa fuera de 0–100 no es un impuesto: es un error de captura que
    // multiplicaría la base imponible.
    if (units < 0n || units > HUNDRED_SCALE6) {
      add("TAX_RATE_OUT_OF_RANGE", `${at}.rate`, DER);
    } else if (toProviderDecimal(tax.rate).kind === "NOT_REPRESENTABLE") {
      add("TAX_RATE_EXCEEDS_PROVIDER_PRECISION", `${at}.rate`, DOC);
    }
  });

  if (item.discount !== null) {
    if (item.discount.kind === "RATE") {
      if (!SCALE6.test(item.discount.rate) || scale6Units(item.discount.rate) > HUNDRED_SCALE6) {
        add("DISCOUNT_RATE_OUT_OF_RANGE", "discount.rate", DER);
      } else if (toProviderDecimal(item.discount.rate).kind === "NOT_REPRESENTABLE") {
        add("DISCOUNT_EXCEEDS_PROVIDER_PRECISION", "discount.rate", DOC);
      }
    } else if (toProviderDecimal(item.discount.amount).kind === "NOT_REPRESENTABLE") {
      add("DISCOUNT_EXCEEDS_PROVIDER_PRECISION", "discount.amount", DOC);
    }
  }

  return findings;
}

/** Por qué la línea no puede ir en un documento. */
export const ITEM_BLOCK_REASONS = ["ITEM_INVALID"] as const;

export type ItemBlockReason = (typeof ITEM_BLOCK_REASONS)[number];

/**
 * Sólo la rama `READY` lleva el `item`, de modo que emitir con una línea
 * bloqueada no compila.
 */
export type ItemIssuanceReadiness =
  | { readonly kind: "READY"; readonly item: FiscalDocumentItem }
  | {
      readonly kind: "BLOCKED";
      readonly reason: ItemBlockReason;
      readonly findings: readonly FiscalItemFinding[];
    };

export function prepareItemForIssuance(item: FiscalDocumentItem): ItemIssuanceReadiness {
  const findings = validateFiscalDocumentItem(item);
  if (findings.length > 0) return { kind: "BLOCKED", reason: "ITEM_INVALID", findings };
  return { kind: "READY", item };
}

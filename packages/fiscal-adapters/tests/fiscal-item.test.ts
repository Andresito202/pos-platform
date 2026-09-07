import { describe, expect, it } from "vitest";
import {
  FiscalDocumentItemSchema,
  ITEM_RULE_SOURCES,
  prepareItemForIssuance,
  toProviderDecimal,
  validateFiscalDocumentItem,
  type FiscalDocumentItem,
  type FiscalItemFindingCode,
} from "../src/index.js";

/**
 * Lo que más importa de este archivo no son las tablas: es que **la conversión
 * de escala 6 a los dos decimales del proveedor no redondea nunca**. Redondear
 * emitiría una factura que no coincide con lo cobrado, y el descuadre
 * aparecería en la contabilidad del comerciante.
 */

const UNIDAD: FiscalDocumentItem = {
  codeReference: "SKU-001",
  name: "Café molido 500 g",
  quantity: "2.000000",
  unitPrice: "18000.000000",
  unitMeasureCode: "94",
  standardCode: "999",
  discount: null,
  taxes: [{ code: "01", rate: "19.000000" }],
};

const codes = (item: FiscalDocumentItem): readonly FiscalItemFindingCode[] =>
  validateFiscalDocumentItem(item).map((f) => f.code);

describe("una línea correcta no produce hallazgos", () => {
  it("unidad entera con IVA", () => {
    expect(validateFiscalDocumentItem(UNIDAD)).toEqual([]);
  });

  it("con descuento por tasa", () => {
    expect(validateFiscalDocumentItem({
      ...UNIDAD, discount: { kind: "RATE", rate: "10.000000" },
    })).toEqual([]);
  });

  it("con descuento por importe", () => {
    expect(validateFiscalDocumentItem({
      ...UNIDAD, discount: { kind: "AMOUNT", amount: "1500.000000" },
    })).toEqual([]);
  });
});

describe("la precisión del proveedor: exacto o nada, nunca redondeado", () => {
  it("un importe con ceros más allá del segundo decimal se convierte exacto", () => {
    expect(toProviderDecimal("18000.000000")).toEqual({ kind: "EXACT", value: "18000.00" });
    expect(toProviderDecimal("1234.560000")).toEqual({ kind: "EXACT", value: "1234.56" });
    expect(toProviderDecimal("0.010000")).toEqual({ kind: "EXACT", value: "0.01" });
  });

  /**
   * `D-14`. Una báscula produce `0.333333` kg. Redondear a `0.33` cambiaría lo
   * facturado respecto de lo pesado y lo cobrado; la conversión se niega y la
   * decisión sube a quien pueda tomarla.
   */
  it("un importe con dígitos significativos más allá del segundo decimal NO se redondea", () => {
    expect(toProviderDecimal("0.333333")).toEqual({ kind: "NOT_REPRESENTABLE" });
    expect(toProviderDecimal("1.005000")).toEqual({ kind: "NOT_REPRESENTABLE" });
    expect(toProviderDecimal("99.999999")).toEqual({ kind: "NOT_REPRESENTABLE" });
  });

  it("sólo la rama EXACT lleva valor: no hay forma de transmitir lo que se perdió", () => {
    const perdido = toProviderDecimal("0.333333");
    expect(perdido).not.toHaveProperty("value");
  });

  it("un texto que no es escala 6 no se convierte", () => {
    expect(toProviderDecimal("18000.00")).toEqual({ kind: "NOT_REPRESENTABLE" });
    expect(toProviderDecimal("abc")).toEqual({ kind: "NOT_REPRESENTABLE" });
  });

  it("la cantidad de una báscula se marca, y la regla es del proveedor", () => {
    const findings = validateFiscalDocumentItem({ ...UNIDAD, quantity: "0.333333" });
    expect(findings).toEqual([
      {
        code: "QUANTITY_EXCEEDS_PROVIDER_PRECISION",
        path: "quantity",
        source: "FACTUS_OFFICIAL_DOC",
      },
    ]);
  });

  it("y un precio unitario con más de dos decimales también", () => {
    expect(codes({ ...UNIDAD, unitPrice: "18000.005000" })).toContain(
      "UNIT_PRICE_EXCEEDS_PROVIDER_PRECISION",
    );
  });
});

describe("los códigos DIAN de la línea", () => {
  it("una unidad de medida no verificada se rechaza", () => {
    expect(codes({ ...UNIDAD, unitMeasureCode: "KGM" })).toContain(
      "UNIT_MEASURE_CODE_NOT_VERIFIED",
    );
  });

  it("un estándar de producto no verificado se rechaza", () => {
    expect(codes({ ...UNIDAD, standardCode: "001" })).toContain(
      "PRODUCT_STANDARD_CODE_NOT_VERIFIED",
    );
  });

  it("un código de impuesto no verificado se rechaza, y el hallazgo dice cuál", () => {
    const findings = validateFiscalDocumentItem({
      ...UNIDAD,
      taxes: [{ code: "01", rate: "19.000000" }, { code: "22", rate: "5.000000" }],
    });
    expect(findings).toEqual([
      { code: "TAX_CODE_NOT_VERIFIED", path: "taxes[1].code", source: "FACTUS_OFFICIAL_DOC" },
    ]);
  });

  it("el INC verificado pasa igual que el IVA", () => {
    expect(validateFiscalDocumentItem({
      ...UNIDAD, taxes: [{ code: "04", rate: "8.000000" }],
    })).toEqual([]);
  });
});

describe("cantidades, precios y tasas", () => {
  it("cantidad cero se rechaza", () => {
    expect(codes({ ...UNIDAD, quantity: "0.000000" })).toContain("QUANTITY_NOT_POSITIVE");
  });

  it("precio unitario cero se rechaza", () => {
    expect(codes({ ...UNIDAD, unitPrice: "0.000000" })).toContain("UNIT_PRICE_NOT_POSITIVE");
  });

  /**
   * Una tasa fuera de 0–100 no es un impuesto: es un error de captura que
   * multiplicaría la base imponible.
   */
  it("una tasa mayor que 100 se rechaza", () => {
    expect(codes({ ...UNIDAD, taxes: [{ code: "01", rate: "190.000000" }] }))
      .toContain("TAX_RATE_OUT_OF_RANGE");
  });

  it("una tasa de 100 exacto es admisible: es el límite, no un error", () => {
    expect(validateFiscalDocumentItem({
      ...UNIDAD, taxes: [{ code: "01", rate: "100.000000" }],
    })).toEqual([]);
  });

  it("una tasa con más de dos decimales se marca por precisión, no por rango", () => {
    expect(codes({ ...UNIDAD, taxes: [{ code: "01", rate: "19.005000" }] }))
      .toEqual(["TAX_RATE_EXCEEDS_PROVIDER_PRECISION"]);
  });

  it("un descuento por tasa mayor que 100 se rechaza", () => {
    expect(codes({ ...UNIDAD, discount: { kind: "RATE", rate: "150.000000" } }))
      .toContain("DISCOUNT_RATE_OUT_OF_RANGE");
  });

  it("un descuento por importe con más de dos decimales se marca", () => {
    expect(codes({ ...UNIDAD, discount: { kind: "AMOUNT", amount: "1500.005000" } }))
      .toContain("DISCOUNT_EXCEEDS_PROVIDER_PRECISION");
  });
});

describe("la lista de impuestos vacía se marca en vez de suponerse", () => {
  it("un array presente y vacío no es lo mismo que ausente", () => {
    expect(validateFiscalDocumentItem({ ...UNIDAD, taxes: [] })).toEqual([
      { code: "TAXES_EMPTY", path: "taxes", source: "DERIVED" },
    ]);
  });
});

describe("el diagnóstico no filtra datos de la línea", () => {
  it("ningún hallazgo contiene el código, el nombre ni los importes", () => {
    const roto: FiscalDocumentItem = {
      codeReference: "SKU-SECRETO-9",
      name: "Producto reservado",
      quantity: "0.333333",
      unitPrice: "18000.005000",
      unitMeasureCode: "KGM",
      standardCode: "001",
      discount: { kind: "AMOUNT", amount: "1500.005000" },
      taxes: [],
    };
    const findings = validateFiscalDocumentItem(roto);
    // Sin esta línea la prueba sería vacua: una lista vacía no contiene nada.
    expect(findings).toHaveLength(6);
    const serializado = JSON.stringify(findings);
    for (const valor of [
      roto.codeReference, roto.name, roto.quantity, roto.unitPrice,
      roto.unitMeasureCode, roto.standardCode,
    ]) {
      expect(serializado).not.toContain(valor);
    }
  });

  it("toda regla declara una fuente del conjunto cerrado", () => {
    const findings = validateFiscalDocumentItem({
      ...UNIDAD, unitMeasureCode: "X", standardCode: "Y", quantity: "0.000000", taxes: [],
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(ITEM_RULE_SOURCES).toContain(finding.source);
    }
  });
});

describe("preparar la línea para emitir", () => {
  it("una línea correcta queda READY y lleva el item", () => {
    const readiness = prepareItemForIssuance(UNIDAD);
    expect(readiness.kind).toBe("READY");
    if (readiness.kind !== "READY") throw new Error("esperaba READY");
    expect(readiness.item).toEqual(UNIDAD);
  });

  it("una línea inválida queda BLOCKED y no lleva item", () => {
    const readiness = prepareItemForIssuance({ ...UNIDAD, taxes: [] });
    expect(readiness.kind).toBe("BLOCKED");
    if (readiness.kind !== "BLOCKED") throw new Error("esperaba BLOCKED");
    expect(readiness.reason).toBe("ITEM_INVALID");
    expect(readiness).not.toHaveProperty("item");
  });
});

describe("el esquema es estricto", () => {
  it("acepta la forma canónica", () => {
    expect(FiscalDocumentItemSchema.safeParse(UNIDAD).success).toBe(true);
  });

  it("rechaza una clave que no está en el contrato", () => {
    expect(FiscalDocumentItemSchema.safeParse({ ...UNIDAD, sku: "X" }).success).toBe(false);
  });

  it("rechaza un importe que no es escala 6", () => {
    expect(FiscalDocumentItemSchema.safeParse({ ...UNIDAD, unitPrice: "18000.00" }).success)
      .toBe(false);
  });

  /**
   * La afirmación estructural del módulo: el contrato admite tasa **o**
   * importe, y **nunca los dos**. No es una comprobación en tiempo de
   * ejecución, es que el tipo no puede expresarlo.
   */
  it("rechaza un descuento que traiga las dos formas a la vez", () => {
    expect(FiscalDocumentItemSchema.safeParse({
      ...UNIDAD,
      discount: { kind: "RATE", rate: "10.000000", amount: "1500.000000" },
    }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  DOCUMENT_TYPE_CODES,
  IDENTIFICATION_DOCUMENT_CODES,
  LEGAL_ORGANIZATION_CODES,
  PAYMENT_FORM_CODES,
  PAYMENT_METHOD_CODES,
  PRODUCT_STANDARD_CODES,
  TAX_CODES,
  UNIT_MEASURE_CODES,
  DianCodeSchema,
  canonicalDocumentTypeCode,
  numberingDocumentTypeCode,
  fiscalDocumentTypeForCode,
  isVerifiedCode,
  lookupCode,
  paymentRequiresDueDate,
  requiredCustomerNameField,
  selectRangesForDocumentType,
  type NumberingRangeSnapshot,
} from "../src/index.js";

/**
 * Estas pruebas fijan una regla de honestidad, no de funcionamiento: **la tabla
 * responde `null` a lo que no ha verificado.** Un código DIAN equivocado
 * produce una factura rechazada o, peor, aceptada con un dato falso.
 */

describe("los códigos verificados están, con su fuente", () => {
  it("los del cuerpo de emisión salen de la documentación oficial de FACTUS", () => {
    expect(lookupCode(IDENTIFICATION_DOCUMENT_CODES, "31")?.label).toBe("NIT");
    expect(lookupCode(IDENTIFICATION_DOCUMENT_CODES, "13")?.label).toBe("Cédula de ciudadanía");
    expect(lookupCode(UNIT_MEASURE_CODES, "94")?.label).toBe("Unidad");
    expect(lookupCode(PRODUCT_STANDARD_CODES, "999")?.label).toBe("Adopción del contribuyente");
    expect(lookupCode(TAX_CODES, "01")?.label).toBe("IVA");
    expect(lookupCode(TAX_CODES, "04")?.label).toBe("INC");
    expect(lookupCode(PAYMENT_METHOD_CODES, "10")?.label).toBe("Efectivo");
    expect(lookupCode(PAYMENT_METHOD_CODES, "42")?.label).toBe("Consignación");
  });

  it("cada entrada declara de dónde sale y ninguna es una suposición", () => {
    for (const tabla of [
      DOCUMENT_TYPE_CODES, IDENTIFICATION_DOCUMENT_CODES, LEGAL_ORGANIZATION_CODES,
      UNIT_MEASURE_CODES, PRODUCT_STANDARD_CODES, TAX_CODES,
      PAYMENT_FORM_CODES, PAYMENT_METHOD_CODES,
    ]) {
      for (const entrada of tabla.values()) {
        expect(() => DianCodeSchema.parse(entrada)).not.toThrow();
        expect(isVerifiedCode(tabla, entrada.code)).toBe(true);
      }
    }
  });
});

describe("lo no verificado responde null, nunca un valor por defecto", () => {
  it("un código ausente de la tabla no se inventa", () => {
    expect(lookupCode(IDENTIFICATION_DOCUMENT_CODES, "22")).toBeNull();
    expect(lookupCode(TAX_CODES, "99")).toBeNull();
    expect(isVerifiedCode(TAX_CODES, "99")).toBe(false);
  });

  it("`null` y `undefined` se tratan igual: no lo sé", () => {
    expect(lookupCode(TAX_CODES, null)).toBeNull();
    expect(lookupCode(TAX_CODES, undefined)).toBeNull();
  });
});

describe("traducción del código documental del proveedor", () => {
  it("traduce el único tipo cuya correspondencia está verificada", () => {
    expect(fiscalDocumentTypeForCode("01")).toBe("SALES_INVOICE");
  });

  it("traduce códigos de numeración FACTUS verificados (21 factura, 22 nota crédito)", () => {
    expect(fiscalDocumentTypeForCode("21")).toBe("SALES_INVOICE");
    expect(fiscalDocumentTypeForCode("22")).toBe("CREDIT_NOTE");
    expect(fiscalDocumentTypeForCode("Nota Crédito")).toBe("CREDIT_NOTE");
    expect(fiscalDocumentTypeForCode("Factura de Venta")).toBe("SALES_INVOICE");
    expect(fiscalDocumentTypeForCode("Factura electrónica de venta")).toBe("SALES_INVOICE");
    expect(fiscalDocumentTypeForCode("23")).toBe("DEBIT_NOTE");
    expect(fiscalDocumentTypeForCode("Nota Débito")).toBe("DEBIT_NOTE");
    expect(fiscalDocumentTypeForCode("24")).toBe("SUPPORT_DOCUMENT");
    expect(fiscalDocumentTypeForCode("Documento Soporte")).toBe("SUPPORT_DOCUMENT");
    expect(fiscalDocumentTypeForCode("25")).toBe("SUPPORT_DOCUMENT_ADJUSTMENT_NOTE");
    expect(fiscalDocumentTypeForCode("Nota de Ajuste Documento Soporte")).toBe("SUPPORT_DOCUMENT_ADJUSTMENT_NOTE");
    expect(fiscalDocumentTypeForCode("Nota Crédito desconocida")).toBeNull();
    expect(fiscalDocumentTypeForCode("30")).toBeNull();
  });

  it("NO traduce códigos DIAN no verificados para emisión", () => {
    for (const code of ["02", "03", "04", "91", "92"]) {
      expect(fiscalDocumentTypeForCode(code)).toBeNull();
    }
    expect(fiscalDocumentTypeForCode(null)).toBeNull();
  });
});

describe("dirección inversa: tipo canónico → código del proveedor", () => {
  it("devuelve el código DIAN de factura para el cuerpo de emisión", () => {
    expect(canonicalDocumentTypeCode("SALES_INVOICE")).toBe("01");
  });

  it("no inventa código de cuerpo de factura para tipos sin document field", () => {
    for (const type of ["CREDIT_NOTE", "DEBIT_NOTE", "SUPPORT_DOCUMENT", "SUPPORT_DOCUMENT_ADJUSTMENT_NOTE"] as const) {
      expect(canonicalDocumentTypeCode(type)).toBeNull();
    }
  });

  it("expone códigos de rango de numeración FACTUS verificados", () => {
    expect(numberingDocumentTypeCode("SALES_INVOICE")).toBe("21");
    expect(numberingDocumentTypeCode("CREDIT_NOTE")).toBe("22");
    expect(numberingDocumentTypeCode("DEBIT_NOTE")).toBe("23");
    expect(numberingDocumentTypeCode("SUPPORT_DOCUMENT")).toBe("24");
    expect(numberingDocumentTypeCode("SUPPORT_DOCUMENT_ADJUSTMENT_NOTE")).toBe("25");
  });

  it("es la inversa exacta de `fiscalDocumentTypeForCode` para lo verificado en factura", () => {
    const code = canonicalDocumentTypeCode("SALES_INVOICE");
    expect(code).not.toBeNull();
    expect(fiscalDocumentTypeForCode(code)).toBe("SALES_INVOICE");
  });
});

describe("reglas documentadas que dependen de un código", () => {
  it("persona jurídica exige `company`; natural exige `names`", () => {
    expect(requiredCustomerNameField("1")).toBe("company");
    expect(requiredCustomerNameField("2")).toBe("names");
    expect(requiredCustomerNameField("9")).toBeNull();
  });

  it("`due_date` sólo es obligatorio a crédito", () => {
    expect(paymentRequiresDueDate("2")).toBe(true);
    expect(paymentRequiresDueDate("1")).toBe(false);
  });
});

describe("clasificar rangos por tipo documental", () => {
  const base: NumberingRangeSnapshot = {
    rangeId: "1",
    documentType: "SALES_INVOICE",
    prefix: "SETP",
    authority: "PROVIDER",
    resolutionNumber: "18760000001",
    rangeFrom: 1,
    rangeTo: 100,
    currentNumber: 10,
    validFrom: null,
    validUntil: null,
    providerActive: true,
    providerExpired: false,
    providerDocumentCode: "01",
  };

  it("separa lo que corresponde al tipo de lo que no se sabe clasificar", () => {
    const { matching, unclassified } = selectRangesForDocumentType(
      [
        base,
        { ...base, rangeId: "2", providerDocumentCode: "03" },
        { ...base, rangeId: "3", providerDocumentCode: null },
      ],
      "SALES_INVOICE",
    );

    expect(matching.map((range) => range.rangeId)).toEqual(["1"]);
    // Lo no clasificable NO desaparece: esconderlo ocultaría que el catálogo de
    // códigos está incompleto (`D-9`).
    expect(unclassified.map((range) => range.rangeId)).toEqual(["2", "3"]);
  });

  it("un rango de otro tipo verificado no entra en `matching`", () => {
    const { matching } = selectRangesForDocumentType([base], "CREDIT_NOTE");
    // Emitir con el rango de otro tipo es un error fiscal: la DIAN autoriza
    // cada resolución para un tipo concreto.
    expect(matching).toEqual([]);
  });
});

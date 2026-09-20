import { describe, expect, it } from "vitest";
import type { FiscalCustomer, FiscalCustomerResolution } from "@pos-platform/fiscal-adapters";
import {
  assembleFactusBill,
  type BillAssemblyInput,
  type BillLineSource,
  type BillPaymentSource,
} from "../src/fiscal/factus-bill-assembly.js";

/**
 * `DEC-021` F3 exige «una prueba que compara contra un payload de referencia,
 * campo a campo». Eso es lo primero que hay aquí; el resto son los bloqueos,
 * cada uno con su motivo y su ruta.
 *
 * Todos los códigos son los verificados en `dian/codes.ts`. Ninguno inventado.
 */

const IDEMPOTENCY = "POS1-0007-018f0000";

const CUSTOMER: FiscalCustomer = {
  identificationDocumentCode: "13",
  identification: "1020304050",
  verificationDigit: null,
  legalOrganizationCode: "2",
  company: null,
  names: "Wilson Andrés Camacho Culma",
  tributeCode: "ZZ",
  fiscalResponsibilityCodes: ["R-99-PN"],
  email: "adquiriente@ejemplo.co",
  phone: "3001234567",
  address: "Calle 10 #5-20",
  countryCode: "CO",
  municipalityCode: "11001",
};

const IDENTIFIED: FiscalCustomerResolution = { kind: "IDENTIFIED", customer: CUSTOMER };

function line(overrides: Partial<BillLineSource> = {}): BillLineSource {
  return {
    lineNumber: 1,
    codeReference: "ARZ-500",
    name: "Arroz Diana",
    quantity: "2.000000",
    unitPrice: "3500.000000",
    discountAmount: "0.000000",
    fiscal: {
      unitMeasureCode: "94",
      standardCode: "999",
      taxCode: "01",
      taxRate: "0.000000",
    },
    ...overrides,
  };
}

const ACEITE: BillLineSource = line({
  lineNumber: 2,
  codeReference: "ACE-1L",
  name: "Aceite Premier 1 L",
  quantity: "3.000000",
  unitPrice: "9900.000000",
  fiscal: { unitMeasureCode: "94", standardCode: "999", taxCode: "01", taxRate: "19.000000" },
});

const CASH: BillPaymentSource = {
  paymentFormCode: "1",
  paymentMethodCode: "10",
  amount: "47400.000000",
  dueDate: null,
};

function input(overrides: Partial<BillAssemblyInput> = {}): BillAssemblyInput {
  return {
    referenceCode: IDEMPOTENCY,
    idempotencyKey: IDEMPOTENCY,
    numberingRangeId: "8",
    documentCode: "01",
    operationCode: "10",
    observation: null,
    cashRoundingAmount: "10.000000",
    customer: IDENTIFIED,
    lines: [line(), ACEITE],
    payments: [CASH],
    ...overrides,
  };
}

function codes(result: ReturnType<typeof assembleFactusBill>): string[] {
  return result.kind === "BLOCKED" ? result.reasons.map((reason) => reason.code) : [];
}

describe("assembleFactusBill — payload de referencia", () => {
  it("produce exactamente el cuerpo documentado, campo a campo", () => {
    const result = assembleFactusBill(input());
    expect(result.kind).toBe("READY");
    if (result.kind !== "READY") return;

    expect(result.payload).toEqual({
      reference_code: IDEMPOTENCY,
      document: "01",
      numbering_range_id: "8",
      operation_type: "10",
      observation: null,
      cash_rounding_amount: "10.00",
      payment_details: [
        { payment_form: "1", payment_method_code: "10", amount: "47400.00", due_date: null },
      ],
      customer: {
        identification_document_code: "13",
        identification: "1020304050",
        dv: null,
        legal_organization_code: "2",
        company: null,
        names: "Wilson Andrés Camacho Culma",
        tribute_code: "ZZ",
        responsibilities: ["R-99-PN"],
        address: "Calle 10 #5-20",
        email: "adquiriente@ejemplo.co",
        phone: "3001234567",
        country_code: "CO",
        municipality_code: "11001",
      },
      items: [
        {
          code_reference: "ARZ-500",
          name: "Arroz Diana",
          quantity: "2.00",
          price: "3500.00",
          unit_measure_code: "94",
          standard_code: "999",
          taxes: [{ code: "01", rate: "0.00" }],
        },
        {
          code_reference: "ACE-1L",
          name: "Aceite Premier 1 L",
          quantity: "3.00",
          price: "9900.00",
          unit_measure_code: "94",
          standard_code: "999",
          taxes: [{ code: "01", rate: "19.00" }],
        },
      ],
    });
  });

  it("omite el descuento cuando es cero y lo emite cuando no", () => {
    const withDiscount = assembleFactusBill(input({
      lines: [line({ discountAmount: "500.000000" })],
    }));
    expect(withDiscount.kind).toBe("READY");
    if (withDiscount.kind !== "READY") return;
    expect(withDiscount.payload.items[0]).toMatchObject({ discount_amount: "500.00" });
    // Nunca las dos formas a la vez: el contrato admite tasa **o** importe.
    expect(withDiscount.payload.items[0]).not.toHaveProperty("discount_rate");

    const plain = assembleFactusBill(input({ lines: [line()] }));
    if (plain.kind !== "READY") throw new Error("debería ensamblar");
    expect(plain.payload.items[0]).not.toHaveProperty("discount_amount");
  });

  it("admite un ajuste de redondeo negativo, que DEC-006 puede producir", () => {
    const result = assembleFactusBill(input({ cashRoundingAmount: "-40.000000" }));
    expect(result.kind).toBe("READY");
    if (result.kind !== "READY") return;
    expect(result.payload.cash_rounding_amount).toBe("-40.00");
  });

  it("un cero no lleva signo", () => {
    const result = assembleFactusBill(input({ cashRoundingAmount: "-0.000000" }));
    if (result.kind !== "READY") throw new Error("debería ensamblar");
    expect(result.payload.cash_rounding_amount).toBe("0.00");
  });
});

describe("assembleFactusBill — D-13: el adquiriente genérico no está verificado", () => {
  it("una venta de mostrador anónima bloquea, y nombra la fuente que falta", () => {
    const result = assembleFactusBill(input({
      customer: { kind: "NOT_IDENTIFIED", reason: "ANONYMOUS_COUNTER_SALE" },
    }));
    // Es el caso mayoritario de un POS colombiano y hoy no tiene salida fiscal.
    // Rellenarlo aquí con el tercero genérico de la DIAN sería inventar un dato
    // fiscal: el bloqueo se propaga tal cual.
    expect(codes(result)).toEqual(["GENERIC_ACQUIRER_NOT_VERIFIED"]);
    expect(result.kind === "BLOCKED" && result.reasons[0]!.path).toBe("customer");
  });
});

describe("assembleFactusBill — D-14: la precisión no se redondea", () => {
  it("una cantidad de báscula bloquea en lugar de redondearse", () => {
    // 0,333333 kg es lo que produce una báscula, y no cabe en dos decimales.
    const result = assembleFactusBill(input({ lines: [line({ quantity: "0.333333" })] }));
    expect(codes(result)).toEqual(["AMOUNT_NOT_REPRESENTABLE"]);
    if (result.kind !== "BLOCKED") throw new Error("debería bloquear");
    expect(result.reasons[0]!.path).toBe("items[1]");
    // El hallazgo específico del validador canónico no se pierde al traducir el
    // motivo: aplanarlo dejaría al operador sin saber qué campo corregir.
    expect(result.reasons[0]!.detail).toEqual(["QUANTITY_EXCEEDS_PROVIDER_PRECISION"]);
  });

  it("un importe con céntimos fuera de rango bloquea, en la línea y en el pago", () => {
    expect(codes(assembleFactusBill(input({ lines: [line({ unitPrice: "3500.000001" })] }))))
      .toEqual(["AMOUNT_NOT_REPRESENTABLE"]);
    expect(codes(assembleFactusBill(input({ payments: [{ ...CASH, amount: "47400.000001" }] }))))
      .toEqual(["AMOUNT_NOT_REPRESENTABLE"]);
  });

  it("un ajuste de redondeo no representable bloquea", () => {
    expect(codes(assembleFactusBill(input({ cashRoundingAmount: "10.000001" }))))
      .toEqual(["AMOUNT_NOT_REPRESENTABLE"]);
  });
});

describe("assembleFactusBill — el resto de bloqueos", () => {
  it("una presentación sin atributo fiscal no se puede declarar", () => {
    const result = assembleFactusBill(input({ lines: [line({ fiscal: null })] }));
    expect(codes(result)).toEqual(["LINE_FISCAL_ATTRIBUTE_MISSING"]);
    expect(result.kind === "BLOCKED" && result.reasons[0]!.path).toBe("items[1]");
  });

  it("un código DIAN no verificado bloquea la línea", () => {
    const result = assembleFactusBill(input({
      lines: [line({ fiscal: { unitMeasureCode: "KGM", standardCode: "999", taxCode: "01", taxRate: "0.000000" } })],
    }));
    expect(codes(result)).toEqual(["LINE_INVALID"]);
    // `KGM` es una unidad real, pero **no está en la tabla DIAN verificada** de
    // este repositorio. Se bloquea en vez de suponer su validez.
    if (result.kind !== "BLOCKED") throw new Error("debería bloquear");
    expect(result.reasons[0]!.detail).toEqual(["UNIT_MEASURE_CODE_NOT_VERIFIED"]);
  });

  it("la identidad de deduplicación no puede divergir de la clave de idempotencia", () => {
    expect(codes(assembleFactusBill(input({ referenceCode: "otra" }))))
      .toEqual(["REFERENCE_CODE_DOES_NOT_MATCH_IDEMPOTENCY_KEY"]);
  });

  it("sin líneas o sin pagos no hay factura", () => {
    expect(codes(assembleFactusBill(input({ lines: [] })))).toEqual(["NO_LINES"]);
    expect(codes(assembleFactusBill(input({ payments: [] })))).toEqual(["NO_PAYMENTS"]);
  });

  it("el ajuste de redondeo respeta el tope del proveedor", () => {
    expect(codes(assembleFactusBill(input({ cashRoundingAmount: "500.000000" })))).toEqual([]);
    expect(codes(assembleFactusBill(input({ cashRoundingAmount: "500.010000" }))))
      .toEqual(["CASH_ROUNDING_OUT_OF_RANGE"]);
    expect(codes(assembleFactusBill(input({ cashRoundingAmount: "-500.010000" }))))
      .toEqual(["CASH_ROUNDING_OUT_OF_RANGE"]);
  });

  it("un pago a crédito exige fecha de vencimiento", () => {
    expect(codes(assembleFactusBill(input({
      payments: [{ ...CASH, paymentFormCode: "2", dueDate: null }],
    })))).toEqual(["CREDIT_PAYMENT_WITHOUT_DUE_DATE"]);

    expect(codes(assembleFactusBill(input({
      payments: [{ ...CASH, paymentFormCode: "2", dueDate: "2026-10-14" }],
    })))).toEqual([]);
  });

  it("devuelve todos los motivos a la vez, no el primero", () => {
    const result = assembleFactusBill(input({
      referenceCode: "otra",
      customer: { kind: "NOT_IDENTIFIED", reason: "ANONYMOUS_COUNTER_SALE" },
      lines: [line({ fiscal: null }), line({ lineNumber: 2, quantity: "0.333333" })],
      payments: [{ ...CASH, paymentFormCode: "2", dueDate: null }],
    }));
    // El operador tiene una venta cobrada delante: descubrir los problemas de
    // uno en uno es exactamente lo que no debe pasarle.
    expect(codes(result).sort()).toEqual([
      "AMOUNT_NOT_REPRESENTABLE",
      "CREDIT_PAYMENT_WITHOUT_DUE_DATE",
      "GENERIC_ACQUIRER_NOT_VERIFIED",
      "LINE_FISCAL_ATTRIBUTE_MISSING",
      "REFERENCE_CODE_DOES_NOT_MATCH_IDEMPOTENCY_KEY",
    ]);
  });
});

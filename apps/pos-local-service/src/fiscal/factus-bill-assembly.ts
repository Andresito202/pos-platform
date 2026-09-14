import {
  prepareCustomerForIssuance,
  prepareItemForIssuance,
  toProviderDecimal,
  type FiscalCustomer,
  type FiscalCustomerResolution,
  type FiscalDocumentItem,
} from "@pos-platform/fiscal-adapters";

/**
 * Ensamblado del payload canónico de FACTUS (`DEC-021` F3).
 *
 * El adapter trata `document.payload` como **opaco**: lo serializa tal cual y
 * sólo comprueba que sea un objeto con `reference_code`. Es decir, hasta ahora
 * **nadie definía la forma del cuerpo de emisión**. Definirla es esto.
 *
 * La referencia es `docs/architecture/provider-payload-shapes.md` §FACTUS, nivel
 * `VERIFICADO_DOC`. Ningún campo se inventa: los que no aparecen allí no
 * aparecen aquí.
 *
 * ## El principio: bloquear, nunca rellenar
 *
 * Cada hueco produce un motivo con su ruta, y **se devuelven todos a la vez**.
 * Devolver sólo el primero obligaría al operador a descubrir los problemas de
 * uno en uno, cada vez con una venta ya cobrada delante.
 *
 * Sólo la rama `READY` lleva el payload, de modo que emitir con un ensamblado
 * bloqueado **no compila**. Es la misma técnica de `prepareCustomerForIssuance`
 * y de `DocumentIssuanceOutcome`.
 *
 * ## Los dos bloqueos que este bloque no puede levantar
 *
 * **`D-13` — el adquiriente genérico.** Una venta de mostrador anónima es el
 * caso mayoritario de un POS colombiano, y hoy bloquea:
 * `prepareCustomerForIssuance` devuelve `GENERIC_ACQUIRER_NOT_VERIFIED` porque
 * los valores del tercero genérico de la DIAN no están verificados en este
 * repositorio. Rellenarlos aquí sería inventar un dato fiscal. Se propaga el
 * bloqueo tal cual, con su nombre.
 *
 * **`D-14` — la precisión.** El POS lleva el dinero en escala 6 y el proveedor
 * admite dos decimales. `toProviderDecimal` devuelve el valor exacto o
 * `NOT_REPRESENTABLE`, y **nunca redondea**: redondear emitiría una factura que
 * no coincide con lo cobrado, y el descuadre aparecería en la contabilidad del
 * comerciante. Una báscula que produce `0.333333` kg bloquea, y la decisión de
 * qué hacer con ese caso es de negocio.
 */

/** Tope que FACTUS admite para el ajuste de redondeo, en pesos. */
const CASH_ROUNDING_LIMIT = 500;

const ZERO_SCALE6 = "0.000000";

export interface BillLineSource {
  readonly lineNumber: number;
  readonly codeReference: string;
  readonly name: string;
  /** Escala 6. */
  readonly quantity: string;
  /** Escala 6. */
  readonly unitPrice: string;
  /** Escala 6. `"0.000000"` cuando no hay descuento. */
  readonly discountAmount: string;
  /**
   * Atributo fiscal de la presentación (`catalog_fiscal_attribute`). `null`
   * cuando la presentación no lo tiene: sin unidad de medida, estándar de
   * producto y código de impuesto no hay línea fiscal que ensamblar.
   */
  readonly fiscal: {
    readonly unitMeasureCode: string;
    readonly standardCode: string;
    readonly taxCode: string;
    /** Escala 6, en puntos porcentuales. */
    readonly taxRate: string;
  } | null;
}

export interface BillPaymentSource {
  /** `"1"` contado, `"2"` crédito. */
  readonly paymentFormCode: string;
  /** `"10"` efectivo, `"42"` consignación. */
  readonly paymentMethodCode: string;
  /** Escala 6. */
  readonly amount: string;
  /** Obligatorio si la forma es crédito. */
  readonly dueDate: string | null;
}

export interface BillAssemblyInput {
  /** Debe ser la clave de idempotencia del documento electrónico. */
  readonly referenceCode: string;
  readonly idempotencyKey: string;
  /** Identificador del rango, tal como lo entregó el proveedor. */
  readonly numberingRangeId: string;
  /** Código DIAN del tipo documental. `"01"` factura de venta. */
  readonly documentCode: string;
  /** Tipo de operación FACTUS. `"10"` estándar. */
  readonly operationCode: string;
  readonly observation: string | null;
  /** Escala 6, con signo. Ajuste comercial de `DEC-006`. */
  readonly cashRoundingAmount: string;
  readonly customer: FiscalCustomerResolution;
  readonly lines: readonly BillLineSource[];
  readonly payments: readonly BillPaymentSource[];
}

export const BILL_BLOCK_CODES = [
  "REFERENCE_CODE_DOES_NOT_MATCH_IDEMPOTENCY_KEY",
  "NO_LINES",
  "NO_PAYMENTS",
  "LINE_FISCAL_ATTRIBUTE_MISSING",
  "LINE_INVALID",
  "AMOUNT_NOT_REPRESENTABLE",
  "CASH_ROUNDING_OUT_OF_RANGE",
  "CREDIT_PAYMENT_WITHOUT_DUE_DATE",
  "CUSTOMER_INVALID",
  "GENERIC_ACQUIRER_NOT_VERIFIED",
] as const;

export type BillBlockCode = (typeof BILL_BLOCK_CODES)[number];

export interface BillBlockReason {
  readonly code: BillBlockCode;
  /** Ruta dentro del payload, para que el operador sepa dónde mirar. */
  readonly path: string;
  /**
   * Códigos de hallazgo de la forma canónica, cuando los hay. Aplanar el
   * resultado de `validateFiscalDocumentItem` a un solo código perdería
   * exactamente lo que el operador necesita para corregir.
   */
  readonly detail?: readonly string[];
}

export interface FactusBillTax {
  readonly code: string;
  readonly rate: string;
}

export interface FactusBillItem {
  readonly code_reference: string;
  readonly name: string;
  readonly quantity: string;
  readonly price: string;
  readonly unit_measure_code: string;
  readonly standard_code: string;
  readonly discount_amount?: string;
  readonly discount_rate?: string;
  readonly taxes: readonly FactusBillTax[];
}

export interface FactusBillPaymentDetail {
  readonly payment_form: string;
  readonly payment_method_code: string;
  readonly amount: string;
  readonly due_date: string | null;
}

export interface FactusBillCustomer {
  readonly identification_document_code: string;
  readonly identification: string;
  readonly dv: string | null;
  readonly legal_organization_code: string;
  readonly company: string | null;
  readonly names: string | null;
  readonly tribute_code: string;
  readonly responsibilities: readonly string[];
  readonly address: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly country_code: string | null;
  readonly municipality_code: string | null;
}

export interface FactusBillPayload {
  readonly reference_code: string;
  readonly document: string;
  readonly numbering_range_id: string;
  readonly operation_type: string;
  readonly observation: string | null;
  readonly cash_rounding_amount: string;
  readonly payment_details: readonly FactusBillPaymentDetail[];
  readonly customer: FactusBillCustomer;
  readonly items: readonly FactusBillItem[];
}

export type BillAssembly =
  | { readonly kind: "READY"; readonly payload: FactusBillPayload }
  | { readonly kind: "BLOCKED"; readonly reasons: readonly BillBlockReason[] };

/**
 * Lleva un importe con signo a los dos decimales del proveedor.
 *
 * `toProviderDecimal` sólo acepta escala 6 sin signo, y el ajuste de redondeo de
 * `DEC-006` puede ser negativo. Se separa el signo, se convierte la magnitud y
 * se restituye: asi la regla de «exacto o nada» sigue siendo la misma.
 */
function signedProviderDecimal(scale6: string): { value: string } | null {
  const negative = scale6.startsWith("-");
  const converted = toProviderDecimal(negative ? scale6.slice(1) : scale6);
  if (converted.kind !== "EXACT") return null;
  if (!negative) return { value: converted.value };
  // `-0.00` no es un importe: el cero no tiene signo.
  return { value: /^0\.00$/.test(converted.value) ? converted.value : `-${converted.value}` };
}

/** Convierte una linea ya validada. `null` si algun importe no es exacto. */
function convertItem(item: FiscalDocumentItem): FactusBillItem | null {
  const quantity = toProviderDecimal(item.quantity);
  const price = toProviderDecimal(item.unitPrice);
  if (quantity.kind !== "EXACT" || price.kind !== "EXACT") return null;

  const taxes: FactusBillTax[] = [];
  for (const tax of item.taxes) {
    const rate = toProviderDecimal(tax.rate);
    if (rate.kind !== "EXACT") return null;
    taxes.push({ code: tax.code, rate: rate.value });
  }

  let discount: { discount_amount: string } | { discount_rate: string } | Record<string, never> = {};
  if (item.discount !== null) {
    const source = item.discount.kind === "AMOUNT" ? item.discount.amount : item.discount.rate;
    const value = toProviderDecimal(source);
    if (value.kind !== "EXACT") return null;
    discount = item.discount.kind === "AMOUNT"
      ? { discount_amount: value.value }
      : { discount_rate: value.value };
  }

  return {
    code_reference: item.codeReference,
    name: item.name,
    quantity: quantity.value,
    price: price.value,
    unit_measure_code: item.unitMeasureCode,
    standard_code: item.standardCode,
    ...discount,
    taxes,
  };
}

function toCustomerBlock(customer: FiscalCustomer): FactusBillCustomer {
  return {
    identification_document_code: customer.identificationDocumentCode,
    identification: customer.identification,
    dv: customer.verificationDigit,
    legal_organization_code: customer.legalOrganizationCode,
    company: customer.company,
    names: customer.names,
    tribute_code: customer.tributeCode,
    responsibilities: customer.fiscalResponsibilityCodes,
    address: customer.address,
    email: customer.email,
    phone: customer.phone,
    country_code: customer.countryCode,
    municipality_code: customer.municipalityCode,
  };
}

export function assembleFactusBill(input: BillAssemblyInput): BillAssembly {
  const reasons: BillBlockReason[] = [];
  const block = (code: BillBlockCode, path: string, detail?: readonly string[]): void => {
    reasons.push(detail === undefined ? { code, path } : { code, path, detail });
  };

  // La identidad que FACTUS usa para deduplicar debe ser la nuestra. El adapter
  // tambien lo corta antes de transmitir; comprobarlo aqui impide siquiera
  // construir un payload que divergiera.
  if (input.referenceCode !== input.idempotencyKey) {
    block("REFERENCE_CODE_DOES_NOT_MATCH_IDEMPOTENCY_KEY", "reference_code");
  }
  if (input.lines.length === 0) block("NO_LINES", "items");
  if (input.payments.length === 0) block("NO_PAYMENTS", "payment_details");

  const rounding = signedProviderDecimal(input.cashRoundingAmount);
  if (rounding === null) {
    block("AMOUNT_NOT_REPRESENTABLE", "cash_rounding_amount");
  } else if (Math.abs(Number(rounding.value)) > CASH_ROUNDING_LIMIT) {
    block("CASH_ROUNDING_OUT_OF_RANGE", "cash_rounding_amount");
  }

  const readiness = prepareCustomerForIssuance(input.customer);
  if (readiness.kind === "BLOCKED") block(readiness.reason, "customer");

  const items: FactusBillItem[] = [];
  for (const line of input.lines) {
    const path = `items[${line.lineNumber}]`;
    if (line.fiscal === null) {
      // Sin atributo fiscal no hay unidad de medida, estandar ni impuesto: la
      // linea no se puede declarar ante la DIAN.
      block("LINE_FISCAL_ATTRIBUTE_MISSING", path);
      continue;
    }

    // **Primero se valida en escala 6, y despues se convierte.** El orden no es
    // cosmetico: `validateFiscalDocumentItem` incluye la regla de precision del
    // proveedor y produce hallazgos mas especificos que un
    // `NOT_REPRESENTABLE` generico. Convertir antes haria correr la validacion
    // canonica contra un formato que no es el suyo, y taparia sus hallazgos.
    const candidate: FiscalDocumentItem = {
      codeReference: line.codeReference,
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      unitMeasureCode: line.fiscal.unitMeasureCode,
      standardCode: line.fiscal.standardCode,
      // El contrato admite tasa **o** importe y nunca los dos. El POS calcula
      // importe; `FiscalItemDiscount` impide llevar ambos porque no compila.
      discount: line.discountAmount === ZERO_SCALE6
        ? null
        : { kind: "AMOUNT", amount: line.discountAmount },
      taxes: [{ code: line.fiscal.taxCode, rate: line.fiscal.taxRate }],
    };

    const prepared = prepareItemForIssuance(candidate);
    if (prepared.kind === "BLOCKED") {
      const detail = prepared.findings.map((finding) => finding.code);
      // Se distingue la precision del resto: es `D-14`, y su remedio —cambiar
      // la unidad, redondear la cantidad antes de vender o rechazar la venta—
      // es una decision de negocio distinta de corregir un codigo DIAN.
      const imprecise = detail.some((code) => code.endsWith("EXCEEDS_PROVIDER_PRECISION"));
      block(imprecise ? "AMOUNT_NOT_REPRESENTABLE" : "LINE_INVALID", path, detail);
      continue;
    }

    const converted = convertItem(prepared.item);
    if (converted === null) {
      // Inalcanzable mientras el validador conserve su regla de precision. Se
      // conserva porque su ausencia solo se notaria emitiendo mal.
      block("AMOUNT_NOT_REPRESENTABLE", path);
      continue;
    }
    items.push(converted);
  }

  const paymentDetails: FactusBillPaymentDetail[] = [];
  for (const [index, payment] of input.payments.entries()) {
    const path = `payment_details[${index}]`;
    const amount = toProviderDecimal(payment.amount);
    if (amount.kind !== "EXACT") {
      block("AMOUNT_NOT_REPRESENTABLE", path);
      continue;
    }
    if (payment.paymentFormCode === "2" && payment.dueDate === null) {
      block("CREDIT_PAYMENT_WITHOUT_DUE_DATE", path);
      continue;
    }
    paymentDetails.push({
      payment_form: payment.paymentFormCode,
      payment_method_code: payment.paymentMethodCode,
      amount: amount.value,
      due_date: payment.dueDate,
    });
  }

  // Las dos condiciones de la derecha son para que el compilador estreche los
  // tipos: cuando se cumplen, su motivo ya esta en `reasons`.
  if (reasons.length > 0 || readiness.kind !== "READY" || rounding === null) {
    return { kind: "BLOCKED", reasons };
  }

  return {
    kind: "READY",
    payload: {
      reference_code: input.referenceCode,
      document: input.documentCode,
      // Se emite tal como lo entregó el proveedor y como lo guardó
      // `fiscal_numbering_range`. El repositorio normaliza el identificador de
      // rango a cadena en todas partes (`NumberingRangeSnapshot.rangeId`); si
      // `F6` observara que el proveedor exige un número, la conversión es de una
      // línea en esta frontera y quedaría respaldada por una ejecución real.
      numbering_range_id: input.numberingRangeId,
      operation_type: input.operationCode,
      observation: input.observation,
      cash_rounding_amount: rounding.value,
      payment_details: paymentDetails,
      customer: toCustomerBlock(readiness.customer),
      items,
    },
  };
}

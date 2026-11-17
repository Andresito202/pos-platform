import {
  prepareCustomerForIssuance,
  toProviderDecimal,
  type FiscalCustomer,
  type FiscalCustomerResolution,
  type FiscalDocumentItem,
} from "@pos-platform/fiscal-adapters";
import type { BillLineSource, BillPaymentSource } from "./factus-bill-assembly.js";
import { prepareItemForIssuance } from "@pos-platform/fiscal-adapters";

/**
 * Ensamblado de nota crédito FACTUS (`POST /v2/credit-notes/validate`).
 * Campos según documentación oficial — no reutiliza el cuerpo de factura.
 */

export interface CreditNoteBlockReason {
  readonly code: string;
  readonly path: string;
  readonly detail?: readonly string[];
}

export type CreditNoteAssembly =
  | { readonly kind: "READY"; readonly payload: Readonly<Record<string, unknown>> }
  | { readonly kind: "BLOCKED"; readonly reasons: readonly CreditNoteBlockReason[] };

export interface AssembleFactusCreditNoteInput {
  readonly referenceCode: string;
  readonly idempotencyKey: string;
  readonly numberingRangeId: string;
  readonly billNumber: string;
  readonly correctionConceptCode?: string;
  readonly customizationId?: string;
  readonly observation: string | null;
  readonly customer: FiscalCustomerResolution;
  readonly lines: readonly BillLineSource[];
  readonly payments: readonly BillPaymentSource[];
}

function toCustomerBlock(customer: FiscalCustomer): Record<string, unknown> {
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

function convertItem(item: FiscalDocumentItem): Record<string, unknown> | null {
  const quantity = toProviderDecimal(item.quantity);
  const price = toProviderDecimal(item.unitPrice);
  if (quantity.kind !== "EXACT" || price.kind !== "EXACT") return null;
  const taxes: { code: string; rate: string }[] = [];
  for (const tax of item.taxes) {
    const rate = toProviderDecimal(tax.rate);
    if (rate.kind !== "EXACT") return null;
    taxes.push({ code: tax.code, rate: rate.value });
  }
  return {
    code_reference: item.codeReference,
    name: item.name,
    quantity: quantity.value,
    price: price.value,
    unit_measure_code: item.unitMeasureCode,
    standard_code: item.standardCode,
    taxes,
  };
}

export function assembleFactusCreditNote(input: AssembleFactusCreditNoteInput): CreditNoteAssembly {
  const reasons: CreditNoteBlockReason[] = [];
  const block = (code: string, path: string, detail?: readonly string[]): void => {
    reasons.push(detail === undefined ? { code, path } : { code, path, detail });
  };

  if (input.referenceCode !== input.idempotencyKey) {
    block("REFERENCE_CODE_DOES_NOT_MATCH_IDEMPOTENCY_KEY", "reference_code");
  }

  const customizationId = input.customizationId ?? "20";
  const correctionConceptCode = input.correctionConceptCode ?? "2";
  if (!/^[1-6]$/.test(correctionConceptCode)) block("CORRECTION_CONCEPT_INVALID", "correction_concept_code");
  if (customizationId !== "20" && customizationId !== "22") block("CUSTOMIZATION_ID_INVALID", "customization_id");
  if (customizationId === "20" && input.billNumber.trim().length < 1) {
    block("RELATED_BILL_NUMBER_REQUIRED", "bill_number");
  }
  if (input.numberingRangeId.startsWith("derived:")) {
    block("NUMBERING_RANGE_ID_NOT_PROVIDER", "numbering_range_id");
  }
  if (input.lines.length === 0) block("NO_LINES", "items");
  if (input.payments.length === 0) block("NO_PAYMENTS", "payment_details");

  const customerPrep = prepareCustomerForIssuance(input.customer);
  let customerBlock: Record<string, unknown> | null = null;
  if (customerPrep.kind === "BLOCKED") {
    block(customerPrep.reason, "customer", customerPrep.findings.map((f) => f.code));
  } else {
    customerBlock = toCustomerBlock(customerPrep.customer);
  }

  const items: Record<string, unknown>[] = [];
  for (const line of input.lines) {
    if (line.fiscal === null) {
      block("LINE_FISCAL_ATTRIBUTE_MISSING", `items[${line.lineNumber}]`);
      continue;
    }
    const fiscalItem: FiscalDocumentItem = {
      codeReference: line.codeReference,
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      unitMeasureCode: line.fiscal.unitMeasureCode,
      standardCode: line.fiscal.standardCode,
      discount: line.discountAmount === "0.000000"
        ? null
        : { kind: "AMOUNT", amount: line.discountAmount },
      taxes: [{ code: line.fiscal.taxCode, rate: line.fiscal.taxRate }],
    };
    const ready = prepareItemForIssuance(fiscalItem);
    if (ready.kind === "BLOCKED") {
      block(ready.reason, `items[${line.lineNumber}]`, ready.findings.map((f) => f.code));
      continue;
    }
    const converted = convertItem(ready.item);
    if (converted === null) {
      block("AMOUNT_NOT_REPRESENTABLE", `items[${line.lineNumber}]`);
      continue;
    }
    items.push(converted);
  }

  const paymentDetails: Record<string, unknown>[] = [];
  for (const [index, payment] of input.payments.entries()) {
    const amount = toProviderDecimal(payment.amount);
    if (amount.kind !== "EXACT") {
      block("AMOUNT_NOT_REPRESENTABLE", `payment_details[${index}].amount`);
      continue;
    }
    paymentDetails.push({
      payment_form: payment.paymentFormCode,
      payment_method_code: payment.paymentMethodCode,
      amount: amount.value,
    });
  }

  if (reasons.length > 0) return { kind: "BLOCKED", reasons };

  const rangeId = Number(input.numberingRangeId);
  const payload: Record<string, unknown> = {
    reference_code: input.referenceCode,
    correction_concept_code: correctionConceptCode,
    customization_id: customizationId,
    numbering_range_id: Number.isFinite(rangeId) ? rangeId : input.numberingRangeId,
    payment_details: paymentDetails,
    items,
    customer: customerBlock,
  };
  if (customizationId === "20") payload.bill_number = input.billNumber;
  if (input.observation !== null) payload.observation = input.observation;
  return { kind: "READY", payload };
}

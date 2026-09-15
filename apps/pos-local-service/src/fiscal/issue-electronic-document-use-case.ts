import { createHash } from "node:crypto";
import {
  canonicalDocumentTypeCode,
  type CredentialReference,
  type DocumentIssuancePort,
  type FiscalCustomerResolution,
  type FiscalDocumentType,
  type FiscalEnvironment,
  type FiscalProvider,
} from "@pos-platform/fiscal-adapters";
import { canonicalJson } from "../channel/canonical-json.js";
import type { CatalogScope, SqliteCatalogStore } from "../catalog/sqlite-catalog-store.js";
import {
  assembleFactusBill,
  type BillBlockReason,
  type BillLineSource,
  type BillPaymentSource,
} from "./factus-bill-assembly.js";
import type { FiscalSaleSource, SqliteFiscalSaleSource } from "./fiscal-sale-source.js";
import { mapPaymentMethodToDian } from "./payment-method-mapping.js";
import {
  type DocumentScope,
  type SqliteFiscalDocumentStore,
  type StoredElectronicDocument,
} from "./sqlite-fiscal-document-store.js";

/**
 * `IssueElectronicDocumentUseCase` — `DEC-021` F4.
 *
 * Aquí se juntan F1 (identidad previa al envío), F2 (credencial) y F3
 * (payload): el punto de la descomposición donde el motor empieza a valer
 * para algo. Implementa el protocolo de
 * `docs/architecture/electronic-invoicing.md` §«Idempotencia y resultado
 * incierto», regla por regla — se cita el número junto a cada decisión para
 * que una futura lectura pueda verificarlas una a una.
 *
 * **El adquiriente es una entrada explícita, no derivada.** `sales_sales` no
 * tiene columna que la vincule con ningún cliente —`sales-schema.md:63`
 * difiere esa columna hasta que `CUST-001` exista, y `CUST-001` sigue
 * `PLANNED`— y no hace falta: `UC-EINV-001` Flujo B y `DEC-021` F3 ya listan
 * el adquiriente como parámetro separado de la venta, no como algo que se
 * obtenga con un `JOIN`. Quien llama a este caso de uso decide a qué
 * adquiriente corresponde la venta, exactamente como ya hace
 * `assembleFactusBill`.
 */

export interface IssueElectronicDocumentInput {
  readonly scope: DocumentScope;
  readonly saleId: string;
  readonly provider: FiscalProvider;
  readonly environment: FiscalEnvironment;
  readonly documentType: FiscalDocumentType;
  readonly customer: FiscalCustomerResolution;
  readonly observation: string | null;
  /** `"10"` Estándar es el único escenario que este POS modela hoy. */
  readonly operationCode?: string;
}

export type IssueElectronicDocumentResult =
  /** Ya había un documento `COMPLETED` para esta venta y tipo: no se reintenta. */
  | { readonly kind: "ALREADY_ISSUED"; readonly document: StoredElectronicDocument }
  /** Se transmitió en esta llamada y el proveedor evidenció el resultado. */
  | { readonly kind: "ISSUED"; readonly document: StoredElectronicDocument }
  /**
   * Ya existe un documento `IN_PROGRESS` o `UNKNOWN_OUTCOME`. Regla 6-7: antes
   * de repetir hay que consultar por referencia; este caso de uso no consulta
   * —eso es `DocumentStatusQueryPort`, fuera de F4— así que se niega a
   * transmitir de nuevo en vez de arriesgar una segunda factura.
   */
  | { readonly kind: "REQUIRES_RECONCILIATION"; readonly document: StoredElectronicDocument }
  /** La venta no existe en este alcance, o existe pero no está cobrada. */
  | { readonly kind: "NOT_ELIGIBLE" }
  /** No se pudo ensamblar un payload transmisible. Nada se creó ni se tocó. */
  | { readonly kind: "BLOCKED"; readonly code: string; readonly reasons?: readonly BillBlockReason[] }
  /** Se transmitió y falló técnicamente. Retriable: no es terminal. */
  | { readonly kind: "TRANSPORT_FAILED"; readonly document: StoredElectronicDocument }
  /** Regla 5: timeout después de transmitir. Exige reconciliación, no reintento. */
  | { readonly kind: "UNCERTAIN"; readonly document: StoredElectronicDocument };

const DEFAULT_OPERATION_CODE = "10";

export class IssueElectronicDocumentUseCase {
  constructor(
    private readonly saleSource: SqliteFiscalSaleSource,
    private readonly catalogStore: SqliteCatalogStore,
    private readonly documentStore: SqliteFiscalDocumentStore,
    private readonly issuancePort: DocumentIssuancePort,
    private readonly credential: CredentialReference,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: IssueElectronicDocumentInput, signal: AbortSignal): Promise<IssueElectronicDocumentResult> {
    // Identidad determinista por (venta, tipo documental), estable entre
    // reintentos (regla 3). No depende de la serie/número comercial: ésos son
    // atributos de negocio, no la identidad fiscal del intento.
    const idempotencyKey = `${input.saleId}:${input.documentType}`;

    const existing = this.documentStore.findOpenForSale(input.scope, input.saleId, input.documentType);
    if (existing !== null) {
      const resumed = this.resume(existing);
      if (resumed !== null) return resumed;
      // `existing` sigue en CREATED o FAILED: cae al camino normal y reintenta
      // con el payload ya congelado, sin volver a ensamblar (regla 8: misma
      // identidad, mismo payload).
      return this.attempt(existing, input.scope, signal);
    }

    const sale = this.saleSource.read(input.scope, input.saleId);
    if (sale === null) return { kind: "NOT_ELIGIBLE" };

    const documentCode = canonicalDocumentTypeCode(input.documentType);
    if (documentCode === null) {
      return { kind: "BLOCKED", code: "DOCUMENT_TYPE_CODE_NOT_VERIFIED" };
    }

    const range = this.documentStore.selectRange(
      input.scope, input.provider, input.environment, input.documentType, this.now().toISOString(),
    );
    if (range.kind !== "FOUND") {
      return {
        kind: "BLOCKED",
        code: range.kind === "NOT_SYNCHRONIZED" ? "NUMBERING_RANGE_NOT_SYNCHRONIZED" : "NUMBERING_RANGE_NOT_VALID",
      };
    }

    const lineMapping = this.toBillLines(input.scope, sale);
    if (lineMapping.kind === "BLOCKED") return lineMapping.result;
    const paymentMapping = toBillPayments(sale);
    if (paymentMapping.kind === "BLOCKED") return paymentMapping.result;

    const assembly = assembleFactusBill({
      referenceCode: idempotencyKey,
      idempotencyKey,
      numberingRangeId: range.range.rangeId,
      documentCode,
      operationCode: input.operationCode ?? DEFAULT_OPERATION_CODE,
      observation: input.observation,
      cashRoundingAmount: sale.commercialRoundingAdjustment,
      customer: input.customer,
      lines: lineMapping.lines,
      payments: paymentMapping.payments,
    });
    if (assembly.kind === "BLOCKED") {
      return { kind: "BLOCKED", code: "PAYLOAD_ASSEMBLY_BLOCKED", reasons: assembly.reasons };
    }

    // F1: identidad, idempotency key y payload congelado con checksum, antes
    // de cualquier intento de transmisión (`DEC-021` §2.1).
    const payloadJson = canonicalJson(assembly.payload);
    const document = this.documentStore.create({
      scope: input.scope,
      saleId: input.saleId,
      provider: input.provider,
      environment: input.environment,
      documentType: input.documentType,
      numberingRangeId: range.range.rangeId,
      idempotencyKey,
      payloadJson,
      payloadChecksum: createHash("sha256").update(payloadJson).digest("hex"),
    });

    return this.attempt(document, input.scope, signal);
  }

  /**
   * Resuelve un documento ya existente que no necesita transmitirse de nuevo.
   * `null` si en cambio hay que intentarlo (`CREATED` o `FAILED`).
   */
  private resume(document: StoredElectronicDocument): IssueElectronicDocumentResult | null {
    if (document.transportStatus === "COMPLETED") return { kind: "ALREADY_ISSUED", document };
    if (document.transportStatus === "IN_PROGRESS" || document.transportStatus === "UNKNOWN_OUTCOME") {
      return { kind: "REQUIRES_RECONCILIATION", document };
    }
    return null;
  }

  /** `CREATED|FAILED → IN_PROGRESS → (transmitir) → COMPLETED|FAILED|UNKNOWN_OUTCOME`. */
  private async attempt(
    document: StoredElectronicDocument,
    scope: DocumentScope,
    signal: AbortSignal,
  ): Promise<IssueElectronicDocumentResult> {
    this.documentStore.markInProgress(scope, document.id);

    const outcome = await this.issuancePort.issue(
      {
        electronicDocumentId: document.id,
        idempotencyKey: document.idempotencyKey,
        attemptNumber: document.attemptCount + 1,
        environment: document.environment,
        credential: this.credential,
        document: {
          documentType: document.documentType,
          payload: JSON.parse(document.payloadJson) as unknown,
          checksumSha256: document.payloadChecksum,
        },
      },
      signal,
    );

    if (outcome.kind === "EVIDENCED") {
      this.documentStore.recordCompleted({
        scope, documentId: document.id,
        normalizedResult: outcome.normalizedResult,
        providerOperationId: outcome.externalIdentity.providerOperationId,
        providerDocumentId: outcome.externalIdentity.providerDocumentId,
        issuedPrefix: outcome.externalIdentity.prefix,
        issuedNumber: outcome.externalIdentity.number,
        cufe: outcome.externalIdentity.cufe,
        providerStatusCode: outcome.providerStatus.providerCode,
        providerStatus: outcome.providerStatus.providerStatus,
        providerHttpStatus: outcome.providerStatus.httpStatus,
      });
      return { kind: "ISSUED", document: this.reload(scope, document) };
    }

    if (outcome.kind === "TECHNICAL_FAILURE") {
      this.documentStore.recordFailed({
        scope, documentId: document.id,
        diagnosticCode: outcome.diagnostic.code,
        diagnosticReference: outcome.diagnostic.diagnosticReference,
        providerStatusCode: outcome.providerStatus?.providerCode ?? null,
        providerStatus: outcome.providerStatus?.providerStatus ?? null,
        providerHttpStatus: outcome.providerStatus?.httpStatus ?? null,
      });
      return { kind: "TRANSPORT_FAILED", document: this.reload(scope, document) };
    }

    // UNCERTAIN — regla 5: timeout después de transmitir nunca aterriza en
    // COMPLETED con un resultado inferido.
    this.documentStore.recordUnknownOutcome({
      scope, documentId: document.id,
      diagnosticCode: outcome.diagnostic.code,
      diagnosticReference: outcome.diagnostic.diagnosticReference,
      providerStatusCode: outcome.providerStatus?.providerCode ?? null,
      providerStatus: outcome.providerStatus?.providerStatus ?? null,
      providerHttpStatus: outcome.providerStatus?.httpStatus ?? null,
    });
    return { kind: "UNCERTAIN", document: this.reload(scope, document) };
  }

  private reload(scope: DocumentScope, document: StoredElectronicDocument): StoredElectronicDocument {
    const fresh = this.documentStore.findByIdempotencyKey(
      scope, document.provider, document.environment, document.idempotencyKey,
    );
    if (fresh === null) throw new Error("fiscal document vanished after recording its outcome");
    return fresh;
  }

  /**
   * Traduce las líneas de la venta a `BillLineSource`, resolviendo el
   * atributo fiscal de cada presentación. Una presentación sin atributo activo
   * bloquea aquí, con el mismo código que usaría `assembleFactusBill` si la
   * línea llegara con `fiscal: null` — no se difiere la comprobación al
   * ensamblador porque `getFiscalAttribute` es quien de verdad sabe si existe.
   */
  private toBillLines(
    scope: CatalogScope,
    sale: FiscalSaleSource,
  ): { readonly kind: "OK"; readonly lines: readonly BillLineSource[] }
    | { readonly kind: "BLOCKED"; readonly result: IssueElectronicDocumentResult } {
    const lines: BillLineSource[] = [];
    const reasons: BillBlockReason[] = [];
    for (const line of sale.lines) {
      const fiscal = this.catalogStore.getFiscalAttribute(scope, line.presentationId);
      lines.push({
        lineNumber: line.lineNumber,
        codeReference: fiscal?.codeReference ?? line.presentationId,
        name: line.productNameSnapshot,
        quantity: line.quantity,
        unitPrice: line.unitPriceAmount,
        discountAmount: line.discountAmount,
        fiscal: fiscal === null ? null : {
          unitMeasureCode: fiscal.unitMeasureCode,
          standardCode: fiscal.standardCode,
          taxCode: fiscal.taxCode,
          taxRate: fiscal.taxRate,
        },
      });
      if (fiscal === null) {
        reasons.push({ code: "LINE_FISCAL_ATTRIBUTE_MISSING", path: `items[${String(line.lineNumber)}]` });
      }
    }
    if (reasons.length > 0) {
      return { kind: "BLOCKED", result: { kind: "BLOCKED", code: "PAYLOAD_ASSEMBLY_BLOCKED", reasons } };
    }
    return { kind: "OK", lines };
  }
}

function toBillPayments(
  sale: FiscalSaleSource,
): { readonly kind: "OK"; readonly payments: readonly BillPaymentSource[] }
  | { readonly kind: "BLOCKED"; readonly result: IssueElectronicDocumentResult } {
  const payments: BillPaymentSource[] = [];
  for (const [index, payment] of sale.payments.entries()) {
    const mapped = mapPaymentMethodToDian(payment.paymentMethod);
    if (mapped === null) {
      // Sin `reasons`: `BillBlockCode` (los códigos que produce
      // `assembleFactusBill`) no tiene un valor para «forma de pago sin código
      // DIAN verificado» — es un rechazo de esta capa, no del ensamblador, y
      // forzarlo dentro de ese vocabulario etiquetaría mal la causa. El índice
      // de la línea de pago que bloqueó queda en el código mismo.
      return { kind: "BLOCKED", result: { kind: "BLOCKED", code: `PAYMENT_METHOD_CODE_NOT_VERIFIED:${String(index)}` } };
    }
    payments.push({
      paymentFormCode: mapped.paymentFormCode,
      paymentMethodCode: mapped.paymentMethodCode,
      amount: payment.confirmedAmount,
      // Ningún método local admite crédito con vencimiento hoy: `CUSTOMER_CREDIT`
      // ya bloquea antes de llegar aquí, al no tener código de método
      // verificado (`payment-method-mapping.ts`).
      dueDate: null,
    });
  }
  return { kind: "OK", payments };
}

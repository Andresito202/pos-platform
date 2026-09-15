import { randomUUID } from "node:crypto";
import type { ContractError, ErrorCategory, IpcRequest } from "@pos-platform/contracts";
import type { FiscalCustomerResolution, FiscalDocumentType, FiscalEnvironment } from "@pos-platform/fiscal-adapters";
import type { ServiceConfig } from "../config.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { boundIdentityFromClaims, type BoundSessionIdentity } from "../session/session-binding-registry.js";
import type { CommercialComponent } from "./commercial-component.js";

const RESULT_SCHEMA_VERSION = "1.0.0";

type CommercialRequest = Extract<
  IpcRequest,
  {
    message_type:
      | "session.activate" | "session.recover"
      | "cash.shift.open" | "cash.shift.close" | "sale.create"
      | "payment.register.cash" | "payment.register.transfer"
      | "payment.transfer.confirm" | "payment.cancel" | "payment.get"
      | "customer.register" | "customer.get" | "customer.find"
      | "fiscal.document.issue"
      | "catalog.product.register" | "catalog.item.find" | "catalog.item.get"
      | "inventory.stock.receive" | "inventory.stock.adjust" | "inventory.stock.get"
      | "sales.receipt.get";
  }
>;

/** Códigos de rechazo propios de la frontera de sesión, no de un caso de uso. */
const SESSION_NOT_BOUND = "SESSION_NOT_BOUND";
const AUTHORIZATION_SNAPSHOT_UNAVAILABLE = "AUTHORIZATION_SNAPSHOT_UNAVAILABLE";

/**
 * Categoría de error por resultado de negocio. Un resultado desconocido cae en
 * `INTERNAL` en vez de asumirse benigno.
 */
const ERROR_CATEGORIES: Readonly<Record<string, ErrorCategory>> = {
  UNAUTHORIZED: "AUTHORIZATION",
  REGISTER_NOT_FOUND: "NOT_FOUND",
  REGISTER_INACTIVE: "CONFLICT",
  NEGATIVE_OPENING_AMOUNT: "VALIDATION",
  INCOMPATIBLE_SHIFT: "CONFLICT",
  IDEMPOTENCY_CONFLICT: "CONFLICT",
  NOT_FOUND: "NOT_FOUND",
  ALREADY_CLOSED: "CONFLICT",
  VERSION_CONFLICT: "CONFLICT",
  CATALOG_NOT_FOUND: "NOT_FOUND",
  // La venta existe pero no esta cobrada: es un conflicto de estado, no una
  // ausencia. El cajero tiene que cobrarla, no buscarla en otra caja.
  NOT_COMPLETED: "CONFLICT",
  PRICE_NOT_FOUND: "NOT_FOUND",
  CURRENCY_MISMATCH: "VALIDATION",
  QUANTITY_PRECISION_EXCEEDED: "VALIDATION",
  // No hay existencia: es un conflicto con el estado del inventario, no una
  // petición mal formada.
  INSUFFICIENT_STOCK: "CONFLICT",
  PRESENTATION_NOT_FOUND: "NOT_FOUND",
  SALE_NOT_PAYABLE: "CONFLICT",
  SALE_ALREADY_COMPLETED: "CONFLICT",
  OVERPAYMENT_NOT_ALLOWED: "CONFLICT",
  CASH_SHIFT_MISSING: "CONFLICT",
  CASH_SHIFT_NOT_OPEN: "CONFLICT",
  INSUFFICIENT_TENDER: "VALIDATION",
  PAYMENT_NOT_FOUND: "NOT_FOUND",
  PAYMENT_NOT_CONFIRMABLE: "CONFLICT",
  PAYMENT_NOT_CANCELLABLE: "CONFLICT",
  INVALID: "VALIDATION",
  IDENTITY_ALREADY_REGISTERED: "CONFLICT",
  CODE_ALREADY_REGISTERED: "CONFLICT",
  BARCODE_ALREADY_REGISTERED: "CONFLICT",
  FISCAL_NOT_CONFIGURED: "CONFLICT",
  CUSTOMER_NOT_FOUND: "NOT_FOUND",
  NOT_ELIGIBLE: "CONFLICT",
  BLOCKED: "VALIDATION",
  REQUIRES_RECONCILIATION: "CONFLICT",
  TRANSPORT_FAILED: "CONFLICT",
  UNCERTAIN: "CONFLICT",
  REJECTED: "AUTHENTICATION",
  STALE_SEQUENCE: "CONFLICT",
  BINDING_MISMATCH: "AUTHENTICATION",
  UNVERIFIABLE: "AUTHENTICATION",
  [SESSION_NOT_BOUND]: "AUTHENTICATION",
  [AUTHORIZATION_SNAPSHOT_UNAVAILABLE]: "AUTHORIZATION",
};

function messageKey(messageType: string, code: string): string {
  return `${messageType}.${code.toLowerCase()}`;
}

function contractError(messageType: string, code: string): ContractError {
  return {
    code,
    category: ERROR_CATEGORIES[code] ?? "INTERNAL",
    retryable: false,
    user_message_key: messageKey(messageType, code),
    field_errors: [],
    current_version: null,
    required_action: null,
    diagnostic_id: randomUUID(),
  };
}

function envelope(
  request: CommercialRequest,
  status: "SUCCEEDED" | "REJECTED",
  resultCode: string,
  result: unknown,
  error: ContractError | null,
): unknown {
  return {
    protocol_version: request.protocol_version,
    request_id: request.request_id,
    correlation_id: request.correlation_id,
    operation_id: request.operation_id ?? null,
    status,
    result_code: resultCode,
    result_schema_version: RESULT_SCHEMA_VERSION,
    error,
    server_time: new Date().toISOString(),
    result,
  };
}

function succeeded(request: CommercialRequest, code: string, result: unknown): unknown {
  return envelope(request, "SUCCEEDED", code, result, null);
}

function rejected(request: CommercialRequest, code: string, result: unknown): unknown {
  return envelope(request, "REJECTED", code, result, contractError(request.message_type, code));
}

/**
 * Handlers de la superficie comercial — `DEC-014` §3, `DEC-015` §5.
 *
 * Regla única de la que dependen los cuatro métodos que consumen sesión: la
 * identidad **nunca** se lee de la petición. Se resuelve por `connectionId`,
 * que el transporte asigna y que jamás viaja por el cable.
 */
export class CommercialRequestHandler {
  constructor(
    private readonly config: ServiceConfig,
    private readonly commercial: CommercialComponent,
  ) {}

  private scope(): SyncScope {
    return {
      tenantId: this.config.tenant_id,
      companyId: this.config.company_id,
      branchId: this.config.branch_id,
      deviceId: this.config.device_id,
      installationId: this.config.installation_id,
    };
  }

  /**
   * Identidad vinculada a la conexión más su snapshot de autorización vigente.
   * Devuelve un código de rechazo en lugar de identidad cuando la conexión no
   * está vinculada o cuando no hay autorización activa: en ninguno de los dos
   * casos existe un actor al que atribuir la operación.
   */
  private authenticate(
    connectionId: string,
  ): { identity: BoundSessionIdentity; snapshot: StoredAuthorizationSnapshot } | { rejection: string } {
    const identity = this.commercial.bindings.resolve(connectionId);
    if (identity === null) return { rejection: SESSION_NOT_BOUND };

    const { installationId, deviceId } = this.commercial.deviceBinding();
    const snapshot = this.commercial.authorizationStore.loadActive({
      userId: identity.userId,
      installationId,
      deviceId,
    });
    if (snapshot === null) return { rejection: AUTHORIZATION_SNAPSHOT_UNAVAILABLE };

    return { identity, snapshot };
  }

  handle(
    request: CommercialRequest,
    connectionId: string,
    // Sólo lo usa `fiscal.document.issue`: es el único caso de uso que
    // transmite por red. El resto de operaciones son transacciones SQLite
    // síncronas y no lo miran; el valor por defecto evita tocar cada
    // llamador existente por una señal que casi ninguno necesita.
    signal: AbortSignal = new AbortController().signal,
  ): unknown {
    switch (request.message_type) {
      case "session.activate": return this.activate(request, connectionId);
      case "session.recover": return this.recover(request, connectionId);
      case "cash.shift.open": return this.openShift(request, connectionId);
      case "cash.shift.close": return this.closeShift(request, connectionId);
      case "sale.create": return this.createSale(request, connectionId);
      case "payment.register.cash": return this.registerCashPayment(request, connectionId);
      case "payment.register.transfer": return this.registerTransferPayment(request, connectionId);
      case "payment.transfer.confirm": return this.confirmTransferPayment(request, connectionId);
      case "payment.cancel": return this.cancelPayment(request, connectionId);
      case "payment.get": return this.getPayment(request, connectionId);
      case "customer.register": return this.registerCustomer(request, connectionId);
      case "customer.get":
      case "customer.find": return this.readCustomer(request, connectionId);
      case "fiscal.document.issue": return this.issueDocument(request, connectionId, signal);
      case "catalog.product.register": return this.registerProduct(request, connectionId);
      case "catalog.item.find":
      case "catalog.item.get": return this.findCatalogItem(request, connectionId);
      case "inventory.stock.receive":
      case "inventory.stock.adjust": return this.moveStock(request, connectionId);
      case "inventory.stock.get": return this.getStock(request, connectionId);
      case "sales.receipt.get": return this.getReceipt(request, connectionId);
    }
  }

  // ── Payment V1 — `DEC-016` ─────────────────────────────────────────────────

  /**
   * `payment.register.cash`.
   *
   * `sale_completed` sólo puede ser `true` en un resultado `CONFIRMED` real:
   * es el único disparador admisible de la confirmación sonora futura
   * (`DEC-016` §13), y un reintento `IDEMPOTENT` nunca lo activa.
   */
  private registerCashPayment(
    request: Extract<CommercialRequest, { message_type: "payment.register.cash" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED", payment_id: null, sale_completed: false,
        confirmed_coverage: null, payable_amount: null, change_amount: null,
      });
    }

    const result = this.commercial.registerCashPayment.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        saleId: request.payload.sale_id,
        amount: request.payload.amount,
        tenderedAmount: request.payload.tendered_amount,
        idempotencyKey: request.idempotency_key as string,
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );

    if (result.kind === "CONFIRMED") {
      return succeeded(request, "CONFIRMED", {
        outcome: "CONFIRMED",
        payment_id: result.paymentId,
        sale_completed: result.saleCompleted,
        confirmed_coverage: result.confirmedCoverage,
        payable_amount: result.payableAmount,
        change_amount: result.changeAmount,
      });
    }
    if (result.kind === "IDEMPOTENT") {
      return succeeded(request, "IDEMPOTENT", {
        outcome: "IDEMPOTENT", payment_id: result.paymentId, sale_completed: false,
        confirmed_coverage: null, payable_amount: null, change_amount: null,
      });
    }
    return rejected(request, result.kind, {
      outcome: result.kind, payment_id: null, sale_completed: false,
      confirmed_coverage: null, payable_amount: null, change_amount: null,
    });
  }

  /** `payment.register.transfer` — reporte sin confirmar: no imputa ni completa. */
  private registerTransferPayment(
    request: Extract<CommercialRequest, { message_type: "payment.register.transfer" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", payment_id: null });
    }

    const result = this.commercial.registerTransferPayment.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        saleId: request.payload.sale_id,
        amount: request.payload.amount,
        providerCode: request.payload.provider_code,
        providerReference: request.payload.provider_reference,
        idempotencyKey: request.idempotency_key as string,
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );

    if (result.kind === "REGISTERED" || result.kind === "IDEMPOTENT") {
      return succeeded(request, result.kind, { outcome: result.kind, payment_id: result.paymentId });
    }
    return rejected(request, result.kind, { outcome: result.kind, payment_id: null });
  }

  /** `payment.transfer.confirm` — atestiguación manual; puede completar la venta. */
  private confirmTransferPayment(
    request: Extract<CommercialRequest, { message_type: "payment.transfer.confirm" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED", payment_id: null, sale_completed: false,
        confirmed_coverage: null, payable_amount: null,
      });
    }

    const result = this.commercial.confirmTransferPayment.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        paymentId: request.payload.payment_id,
        expectedVersion: request.payload.expected_version,
        idempotencyKey: request.idempotency_key as string,
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );

    if (result.kind === "CONFIRMED") {
      return succeeded(request, "CONFIRMED", {
        outcome: "CONFIRMED",
        payment_id: result.paymentId,
        sale_completed: result.saleCompleted,
        confirmed_coverage: result.confirmedCoverage,
        payable_amount: result.payableAmount,
      });
    }
    if (result.kind === "IDEMPOTENT") {
      return succeeded(request, "IDEMPOTENT", {
        outcome: "IDEMPOTENT", payment_id: result.paymentId, sale_completed: false,
        confirmed_coverage: null, payable_amount: null,
      });
    }
    return rejected(request, result.kind, {
      outcome: result.kind, payment_id: null, sale_completed: false,
      confirmed_coverage: null, payable_amount: null,
    });
  }

  /** `payment.cancel` — sólo pagos no confirmados (`DEC-002`). */
  private cancelPayment(
    request: Extract<CommercialRequest, { message_type: "payment.cancel" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", payment_id: null });
    }

    const result = this.commercial.cancelPayment.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        paymentId: request.payload.payment_id,
        expectedVersion: request.payload.expected_version,
        idempotencyKey: request.idempotency_key as string,
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );

    if (result.kind === "CANCELLED" || result.kind === "IDEMPOTENT") {
      return succeeded(request, result.kind, { outcome: result.kind, payment_id: result.paymentId });
    }
    return rejected(request, result.kind, { outcome: result.kind, payment_id: null });
  }

  /** `payment.get` — lectura acotada al tenant de configuración. */
  private getPayment(
    request: Extract<CommercialRequest, { message_type: "payment.get" }>,
    connectionId: string,
  ): unknown {
    const empty = {
      payment_id: null, sale_id: null, method: null, status: null,
      expected_amount: null, confirmed_amount: null, currency_code: null, version: null,
    };

    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }

    const result = this.commercial.getPayment.execute(
      this.scope(),
      authenticated.snapshot,
      { paymentId: request.payload.payment_id },
    );

    if (result.kind === "FOUND") {
      return succeeded(request, "FOUND", {
        outcome: "FOUND",
        payment_id: result.payment.paymentId,
        sale_id: result.payment.saleId,
        method: result.payment.method,
        status: result.payment.status,
        expected_amount: result.payment.expectedAmount,
        confirmed_amount: result.payment.confirmedAmount,
        currency_code: result.payment.currencyCode,
        version: result.payment.version,
      });
    }
    if (result.kind === "NOT_FOUND") {
      return rejected(request, "NOT_FOUND", { outcome: "NOT_FOUND", ...empty });
    }
    return rejected(request, "UNAUTHORIZED", { outcome: "UNAUTHORIZED", ...empty });
  }

  // ── customer.register ──────────────────────────────────────────────────────

  /**
   * `customer.register` — el adquiriente (`D-9`).
   *
   * Los hallazgos viajan al renderer con **código y ruta, nunca el valor del
   * campo**. Un adquiriente contiene identificación, correo y dirección de una
   * persona real: devolverlos en el error los llevaría a los registros del
   * renderer, que es exactamente la frontera que este handler existe para no
   * cruzar.
   */
  private registerCustomer(
    request: Extract<CommercialRequest, { message_type: "customer.register" }>,
    connectionId: string,
  ): unknown {
    const empty = { customer_id: null, version: null, findings: [] };

    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }

    const payload = request.payload;
    const result = this.commercial.registerCustomer.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        customer: {
          identificationDocumentCode: payload.identification_document_code,
          identification: payload.identification,
          verificationDigit: payload.verification_digit,
          legalOrganizationCode: payload.legal_organization_code,
          company: payload.company,
          names: payload.names,
          tributeCode: payload.tribute_code,
          fiscalResponsibilityCodes: payload.fiscal_responsibility_codes,
          email: payload.email,
          phone: payload.phone,
          address: payload.address,
          countryCode: payload.country_code,
          municipalityCode: payload.municipality_code,
        },
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );

    if (result.kind === "REGISTERED" || result.kind === "IDEMPOTENT") {
      return succeeded(request, result.kind, {
        outcome: result.kind,
        customer_id: result.customerId,
        version: result.version,
        findings: [],
      });
    }
    if (result.kind === "INVALID") {
      return rejected(request, "INVALID", {
        outcome: "INVALID",
        customer_id: null,
        version: null,
        findings: result.findings.map((finding) => ({
          code: finding.code,
          path: finding.path,
          source: finding.source,
        })),
      });
    }
    if (result.kind === "IDENTITY_ALREADY_REGISTERED") {
      return rejected(request, result.kind, {
        outcome: result.kind,
        customer_id: result.customerId,
        version: null,
        findings: [],
      });
    }
    return rejected(request, result.kind, { outcome: result.kind, ...empty });
  }

  // ── customer.get · customer.find ───────────────────────────────────────────

  /** Las dos formas de preguntar comparten resultado porque devuelven lo mismo. */
  private readCustomer(
    request: Extract<CommercialRequest, { message_type: "customer.get" | "customer.find" }>,
    connectionId: string,
  ): unknown {
    const empty = {
      customer_id: null,
      identification_document_code: null,
      identification: null,
      verification_digit: null,
      legal_organization_code: null,
      company: null,
      names: null,
      tribute_code: null,
      fiscal_responsibility_codes: [],
      email: null,
      phone: null,
      address: null,
      country_code: null,
      municipality_code: null,
      version: null,
    };

    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }

    const result = this.commercial.getCustomer.execute(
      this.scope(),
      authenticated.snapshot,
      request.message_type === "customer.get"
        ? { by: "ID", customerId: request.payload.customer_id }
        : {
            by: "IDENTITY",
            identificationDocumentCode: request.payload.identification_document_code,
            identification: request.payload.identification,
          },
    );

    if (result.kind === "FOUND") {
      return succeeded(request, "FOUND", {
        outcome: "FOUND",
        customer_id: result.customerId,
        identification_document_code: result.customer.identificationDocumentCode,
        identification: result.customer.identification,
        verification_digit: result.customer.verificationDigit,
        legal_organization_code: result.customer.legalOrganizationCode,
        company: result.customer.company,
        names: result.customer.names,
        tribute_code: result.customer.tributeCode,
        fiscal_responsibility_codes: [...result.customer.fiscalResponsibilityCodes],
        email: result.customer.email,
        phone: result.customer.phone,
        address: result.customer.address,
        country_code: result.customer.countryCode,
        municipality_code: result.customer.municipalityCode,
        version: result.version,
      });
    }
    if (result.kind === "NOT_FOUND") {
      return rejected(request, "NOT_FOUND", { outcome: "NOT_FOUND", ...empty });
    }
    return rejected(request, "UNAUTHORIZED", { outcome: "UNAUTHORIZED", ...empty });
  }

  // ── fiscal.document.issue ───────────────────────────────────────────────────

  /**
   * `fiscal.document.issue` — `DEC-021` F5.
   *
   * El adquiriente llega por referencia (`customer_id`) y se resuelve aquí
   * contra `customer.register` (`D-9`) antes de entrar al caso de uso, que
   * exige la forma canónica de `FiscalCustomer`, no un identificador — ni
   * `sales_sales` ni este handler guardan una segunda copia del adquiriente.
   *
   * Único método `async` de este handler: es el único caso de uso que
   * transmite por red (`DocumentIssuancePort.issue`). Los demás son
   * transacciones SQLite síncronas.
   */
  private async issueDocument(
    request: Extract<CommercialRequest, { message_type: "fiscal.document.issue" }>,
    connectionId: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const empty = {
      document_id: null, transport_status: null, normalized_result: null,
      cufe: null, issued_prefix: null, issued_number: null, attempt_count: null,
      block_code: null, reasons: [] as never[],
    };

    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }

    const useCase = this.commercial.issueElectronicDocument;
    if (useCase === null) {
      return rejected(request, "FISCAL_NOT_CONFIGURED", { outcome: "BLOCKED", ...empty, block_code: "FISCAL_NOT_CONFIGURED" });
    }

    const payload = request.payload;
    let customer: FiscalCustomerResolution;
    if (payload.customer.kind === "IDENTIFIED") {
      const found = this.commercial.getCustomer.execute(
        this.scope(),
        authenticated.snapshot,
        { by: "ID", customerId: payload.customer.customer_id },
      );
      if (found.kind !== "FOUND") {
        return rejected(request, "CUSTOMER_NOT_FOUND", { outcome: "BLOCKED", ...empty, block_code: "CUSTOMER_NOT_FOUND" });
      }
      customer = { kind: "IDENTIFIED", customer: found.customer };
    } else {
      customer = { kind: "NOT_IDENTIFIED", reason: payload.customer.reason };
    }

    const result = await useCase.execute(
      authenticated.snapshot,
      {
        scope: this.scope(),
        saleId: payload.sale_id,
        provider: "FACTUS",
        // Presente: `useCase` sólo es no nulo cuando `CommercialComponent`
        // encontró `config.fiscal_environment` definido (`start()`, `DEC-021` F5).
        environment: this.config.fiscal_environment as FiscalEnvironment,
        documentType: payload.document_type as FiscalDocumentType,
        customer,
        observation: payload.observation,
      },
      signal,
    );

    if (result.kind === "UNAUTHORIZED") {
      return rejected(request, "UNAUTHORIZED", { outcome: "UNAUTHORIZED", ...empty });
    }
    if (result.kind === "NOT_ELIGIBLE") {
      return rejected(request, "NOT_ELIGIBLE", { outcome: "NOT_ELIGIBLE", ...empty });
    }
    if (result.kind === "BLOCKED") {
      return rejected(request, "BLOCKED", {
        outcome: "BLOCKED", ...empty, block_code: result.code,
        reasons: (result.reasons ?? []).map((reason) => ({
          code: reason.code, path: reason.path, ...(reason.detail === undefined ? {} : { detail: [...reason.detail] }),
        })),
      });
    }

    const document = result.document;
    const documentFields = {
      document_id: document.id,
      transport_status: document.transportStatus,
      normalized_result: document.normalizedResult,
      cufe: document.cufe,
      issued_prefix: document.issuedPrefix,
      issued_number: document.issuedNumber,
      attempt_count: document.attemptCount,
      block_code: null,
      reasons: [] as never[],
    };

    if (result.kind === "ISSUED" || result.kind === "ALREADY_ISSUED") {
      return succeeded(request, result.kind, { outcome: result.kind, ...documentFields });
    }
    // REQUIRES_RECONCILIATION, TRANSPORT_FAILED, UNCERTAIN: ninguno es un
    // acierto de la petición, pero ninguno es tampoco un error de programa —
    // son desenlaces reales del protocolo de resultado incierto (`DEC-021`
    // §2.1) que el operador necesita ver, no un socket cerrado en silencio.
    return rejected(request, result.kind, { outcome: result.kind, ...documentFields });
  }

  // ── catalog.product.register ───────────────────────────────────────────────

  private registerProduct(
    request: Extract<CommercialRequest, { message_type: "catalog.product.register" }>,
    connectionId: string,
  ): unknown {
    const empty = { product_id: null, presentation_id: null };

    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }

    const payload = request.payload;
    const result = this.commercial.registerProduct.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        code: payload.code,
        name: payload.name,
        stockControlled: payload.stock_controlled,
        presentationName: payload.presentation_name,
        unitCode: payload.unit_code,
        unitPrecision: payload.unit_precision,
        barcode: payload.barcode,
        priceAmount: payload.price_amount,
        currencyCode: payload.currency_code,
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );

    if (result.kind === "REGISTERED" || result.kind === "IDEMPOTENT") {
      return succeeded(request, result.kind, {
        outcome: result.kind,
        product_id: result.productId,
        presentation_id: result.presentationId,
      });
    }
    if (result.kind === "CODE_ALREADY_REGISTERED") {
      return rejected(request, result.kind, {
        outcome: result.kind, product_id: result.productId, presentation_id: null,
      });
    }
    if (result.kind === "BARCODE_ALREADY_REGISTERED") {
      return rejected(request, result.kind, {
        outcome: result.kind, product_id: null, presentation_id: result.presentationId,
      });
    }
    return rejected(request, result.kind, { outcome: result.kind, ...empty });
  }

  // ── catalog.item.find · catalog.item.get ───────────────────────────────────

  /** Las dos formas de buscar comparten resultado porque devuelven lo mismo. */
  private findCatalogItem(
    request: Extract<CommercialRequest, { message_type: "catalog.item.find" | "catalog.item.get" }>,
    connectionId: string,
  ): unknown {
    const empty = {
      product_id: null, presentation_id: null, code: null, name: null,
      presentation_name: null, unit_code: null, unit_precision: null, barcode: null,
      stock_controlled: null, price_amount: null, currency_code: null,
    };

    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }

    const result = this.commercial.findCatalogItem.execute(
      this.scope(),
      authenticated.snapshot,
      request.message_type === "catalog.item.find"
        ? { by: "BARCODE", barcode: request.payload.barcode }
        : { by: "PRESENTATION", presentationId: request.payload.presentation_id },
    );

    if (result.kind === "FOUND") {
      const { product, presentation, price } = result.item;
      return succeeded(request, "FOUND", {
        outcome: "FOUND",
        product_id: product.id,
        presentation_id: presentation.id,
        code: product.code,
        name: product.name,
        presentation_name: presentation.name,
        unit_code: presentation.unitCode,
        unit_precision: presentation.unitPrecision,
        barcode: presentation.barcode,
        stock_controlled: product.stockControlled,
        // `null` es «sin precio activo», no gratis.
        price_amount: price?.amount ?? null,
        currency_code: price?.currencyCode ?? null,
      });
    }
    if (result.kind === "NOT_FOUND") {
      return rejected(request, "NOT_FOUND", { outcome: "NOT_FOUND", ...empty });
    }
    return rejected(request, "UNAUTHORIZED", { outcome: "UNAUTHORIZED", ...empty });
  }

  // ── Inventario — `MIGRATION_015` ───────────────────────────────────────────

  /**
   * Recepción y ajuste comparten handler porque comparten forma de respuesta,
   * **no** permiso: cada caso de uso exige el suyo y el handler no los mezcla.
   */
  private moveStock(
    request: Extract<CommercialRequest, {
      message_type: "inventory.stock.receive" | "inventory.stock.adjust";
    }>,
    connectionId: string,
  ): unknown {
    const empty = { stock_sequence: null, quantity_after: null, available: null };

    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }

    const common = {
      presentationId: request.payload.presentation_id,
      quantity: request.payload.quantity,
      reasonCode: request.payload.reason_code,
      businessDate: request.payload.business_date,
      idempotencyKey: request.idempotency_key as string,
      correlationId: request.correlation_id,
      causationId: request.causation_id ?? null,
    };

    const result = request.message_type === "inventory.stock.receive"
      ? this.commercial.receiveStock.execute(
          this.scope(), authenticated.identity.ssaSessionId, authenticated.snapshot,
          { ...common, movementType: request.payload.movement_type },
        )
      : this.commercial.adjustStock.execute(
          this.scope(), authenticated.identity.ssaSessionId, authenticated.snapshot,
          { ...common, movementType: request.payload.movement_type },
        );

    if (result.kind === "POSTED" || result.kind === "IDEMPOTENT") {
      return succeeded(request, result.kind, {
        outcome: result.kind,
        stock_sequence: result.stockSequence,
        quantity_after: result.quantityAfter,
        available: null,
      });
    }

    if (result.kind === "INSUFFICIENT_STOCK") {
      return rejected(request, result.kind, {
        outcome: result.kind, stock_sequence: null, quantity_after: null,
        available: result.available,
      });
    }

    return rejected(request, result.kind, { outcome: result.kind, ...empty });
  }

  private getStock(
    request: Extract<CommercialRequest, { message_type: "inventory.stock.get" }>,
    connectionId: string,
  ): unknown {
    const empty = { presentation_id: null, quantity_on_hand: null, last_movement_sequence: null };

    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }

    const result = this.commercial.getStock.execute(
      this.scope(), authenticated.snapshot, request.payload.presentation_id,
    );

    if (result.kind === "FOUND") {
      return succeeded(request, "FOUND", {
        outcome: "FOUND",
        presentation_id: result.stock.presentationId,
        quantity_on_hand: result.stock.quantityOnHand,
        last_movement_sequence: result.stock.lastMovementSequence,
      });
    }

    return rejected(request, result.kind, { outcome: result.kind, ...empty });
  }

  // ── sales.receipt.get — `DEC-019` ──────────────────────────────────────────

  /**
   * El recibo de una venta cobrada.
   *
   * `NOT_FOUND` y `NOT_COMPLETED` viajan separados hasta el cajero: «esa venta
   * no es de esta caja» y «esa venta todavía no está cobrada» piden reacciones
   * distintas, y colapsarlas le haría buscar un problema donde no lo hay.
   *
   * Ninguna cifra se calcula aquí. El caso de uso devuelve lo que la venta dejó
   * escrito, y este método sólo lo renombra al idioma del contrato.
   */
  private getReceipt(
    request: Extract<CommercialRequest, { message_type: "sales.receipt.get" }>,
    connectionId: string,
  ): unknown {
    const empty = {
      sale_id: null, document_series: null, sale_number: null, currency_code: null,
      business_date: null, completed_at: null, lines: null, subtotal_amount: null,
      discount_amount: null, tax_amount: null, fiscal_total_amount: null,
      commercial_rounding_adjustment: null, payable_amount: null, payments: null,
      calculation_checksum: null,
    };

    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }

    const result = this.commercial.getReceipt.execute(
      this.scope(), authenticated.snapshot, request.payload.sale_id,
    );

    if (result.kind !== "FOUND") {
      return rejected(request, result.kind, { outcome: result.kind, ...empty });
    }

    const receipt = result.receipt;
    return succeeded(request, "FOUND", {
      outcome: "FOUND",
      sale_id: receipt.saleId,
      document_series: receipt.documentSeries,
      sale_number: receipt.saleNumber,
      currency_code: receipt.currencyCode,
      business_date: receipt.businessDate,
      completed_at: receipt.completedAt,
      lines: receipt.lines.map((line) => ({
        line_number: line.lineNumber,
        product_name: line.productName,
        presentation_name: line.presentationName,
        identifier: line.identifier,
        unit_code: line.unitCode,
        unit_precision: line.unitPrecision,
        quantity: line.quantity,
        unit_price_amount: line.unitPriceAmount,
        gross_amount: line.grossAmount,
        discount_amount: line.discountAmount,
        taxable_amount: line.taxableAmount,
        tax_amount: line.taxAmount,
        line_total_amount: line.lineTotalAmount,
      })),
      subtotal_amount: receipt.subtotalAmount,
      discount_amount: receipt.discountAmount,
      tax_amount: receipt.taxAmount,
      fiscal_total_amount: receipt.fiscalTotalAmount,
      commercial_rounding_adjustment: receipt.commercialRoundingAdjustment,
      payable_amount: receipt.payableAmount,
      payments: receipt.payments.map((payment) => ({
        payment_method: payment.paymentMethod,
        confirmed_amount: payment.confirmedAmount,
        tendered_amount: payment.tenderedAmount,
        change_amount: payment.changeAmount,
        currency_code: payment.currencyCode,
        confirmed_at: payment.confirmedAt,
      })),
      calculation_checksum: receipt.calculationChecksum,
    });
  }

  // ── session.activate ───────────────────────────────────────────────────────

  /**
   * Único punto que **establece** un vínculo.
   *
   * `user_id` sale de los claims de la SSA presentada, pero eso no la convierte
   * en autoridad del llamador: la firma Ed25519 debe cubrirlos, e
   * `installation_id`/`device_id` los impone la configuración local. Una SSA
   * emitida para otro terminal es `BINDING_MISMATCH`, y una no firmada por la
   * autoridad central es `SIGNATURE_INVALID`. El vínculo se crea sólo tras
   * `ACTIVATED`.
   */
  private activate(
    request: Extract<CommercialRequest, { message_type: "session.activate" }>,
    connectionId: string,
  ): unknown {
    const signed = request.payload.session_assertion;
    const { installationId, deviceId } = this.commercial.deviceBinding();

    const outcome = this.commercial.sessionActivation.activate(signed, {
      userId: signed.claims.user_id,
      installationId,
      deviceId,
    });

    if (outcome.kind === "ACTIVATED") {
      this.commercial.bindings.bind(connectionId, boundIdentityFromClaims(signed.claims));
      return succeeded(request, "ACTIVATED", {
        outcome: "ACTIVATED",
        sequence: outcome.sequence,
        current_sequence: null,
        decision: null,
      });
    }

    if (outcome.kind === "STALE_SEQUENCE") {
      return rejected(request, "STALE_SEQUENCE", {
        outcome: "STALE_SEQUENCE",
        sequence: null,
        current_sequence: outcome.currentSequence,
        decision: null,
      });
    }

    if (outcome.kind === "BINDING_MISMATCH") {
      return rejected(request, "BINDING_MISMATCH", {
        outcome: "BINDING_MISMATCH",
        sequence: null,
        current_sequence: null,
        decision: null,
      });
    }

    return rejected(request, "REJECTED", {
      outcome: "REJECTED",
      sequence: null,
      current_sequence: null,
      decision: outcome.decision,
    });
  }

  // ── session.recover ────────────────────────────────────────────────────────

  /**
   * Rehidrata el vínculo tras un reinicio, exclusivamente desde una SSA durable
   * que vuelve a verificarse.
   *
   * La petición no aporta binding: la fila se localiza por
   * `installation_id`/`device_id` de configuración. Si el dispositivo tiene más
   * de una sesión vigente no se elige ninguna — escoger sería adivinar de quién
   * es la sesión.
   */
  private recover(
    request: Extract<CommercialRequest, { message_type: "session.recover" }>,
    connectionId: string,
  ): unknown {
    const { installationId, deviceId } = this.commercial.deviceBinding();
    const lookup = this.commercial.sessionStore.loadActiveByDevice(installationId, deviceId);

    if (lookup.kind === "NONE") {
      return succeeded(request, "NONE", {
        outcome: "NONE", session_id: null, offline_valid_until: null, decision: null,
      });
    }

    if (lookup.kind === "AMBIGUOUS") {
      return rejected(request, "UNVERIFIABLE", {
        outcome: "UNVERIFIABLE",
        session_id: null,
        offline_valid_until: null,
        decision: "AMBIGUOUS_DEVICE_SESSION",
      });
    }

    const outcome = this.commercial.sessionActivation.recover({
      userId: lookup.session.claims.user_id,
      installationId,
      deviceId,
    });

    if (outcome.kind === "ACTIVE") {
      this.commercial.bindings.bind(connectionId, boundIdentityFromClaims(outcome.session.claims));
      return succeeded(request, "ACTIVE", {
        outcome: "ACTIVE",
        session_id: outcome.session.claims.session_id,
        offline_valid_until: outcome.session.claims.offline_valid_until,
        decision: null,
      });
    }

    if (outcome.kind === "NONE") {
      return succeeded(request, "NONE", {
        outcome: "NONE", session_id: null, offline_valid_until: null, decision: null,
      });
    }

    return rejected(request, "UNVERIFIABLE", {
      outcome: "UNVERIFIABLE",
      session_id: null,
      offline_valid_until: null,
      decision: outcome.decision,
    });
  }

  // ── cash.shift.open ────────────────────────────────────────────────────────

  private openShift(
    request: Extract<CommercialRequest, { message_type: "cash.shift.open" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", shift_id: null, version: null });
    }

    const result = this.commercial.openCashShift.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        cashRegisterId: request.payload.cash_register_id,
        openingAmount: request.payload.opening_amount,
        businessDate: request.payload.business_date,
        timezoneId: request.payload.timezone_id,
        utcOffsetMinutes: request.payload.utc_offset_minutes,
        idempotencyKey: request.idempotency_key as string,
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );

    if (result.kind === "OPENED" || result.kind === "IDEMPOTENT") {
      // La versión viaja con el turno: es lo que el cierre exigirá después.
      return succeeded(request, result.kind, {
        outcome: result.kind, shift_id: result.shiftId, version: result.version,
      });
    }
    return rejected(request, result.kind, { outcome: result.kind, shift_id: null, version: null });
  }

  // ── cash.shift.close ───────────────────────────────────────────────────────

  private closeShift(
    request: Extract<CommercialRequest, { message_type: "cash.shift.close" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED",
        shift_id: null, expected_cash: null, counted_amount: null, difference_amount: null,
      });
    }

    const result = this.commercial.closeCashShift.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        shiftId: request.payload.shift_id,
        countedAmount: request.payload.counted_amount,
        expectedVersion: request.payload.expected_version,
        idempotencyKey: request.idempotency_key as string,
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );

    if (result.kind === "CLOSED") {
      return succeeded(request, "CLOSED", {
        outcome: "CLOSED",
        shift_id: result.shiftId,
        expected_cash: result.expectedCash,
        counted_amount: result.countedAmount,
        difference_amount: result.differenceAmount,
      });
    }

    // `IDEMPOTENT` no reconstruye importes: `MIGRATION_009` no persiste el
    // conteo. Es el hallazgo `M3` del gate de `4D`, expresado y no disimulado.
    if (result.kind === "IDEMPOTENT") {
      return succeeded(request, "IDEMPOTENT", {
        outcome: "IDEMPOTENT",
        shift_id: result.shiftId,
        expected_cash: null, counted_amount: null, difference_amount: null,
      });
    }

    return rejected(request, result.kind, {
      outcome: result.kind,
      shift_id: null, expected_cash: null, counted_amount: null, difference_amount: null,
    });
  }

  // ── sale.create ────────────────────────────────────────────────────────────

  private createSale(
    request: Extract<CommercialRequest, { message_type: "sale.create" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED",
        sale_id: null, sale_number: null, payable_amount: null, calculation_checksum: null,
      });
    }

    const result = this.commercial.createSale.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        cashRegisterId: request.payload.cash_register_id,
        idempotencyKey: request.idempotency_key as string,
        channel: request.payload.channel,
        businessDate: request.payload.business_date,
        timezoneId: request.payload.timezone_id,
        utcOffsetMinutes: request.payload.utc_offset_minutes,
        documentSeries: request.payload.document_series,
        currencyCode: request.payload.currency_code,
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
        lines: request.payload.lines.map((line) => ({
          productId: line.product_id,
          presentationId: line.presentation_id,
          quantity: line.quantity,
        })),
      },
    );

    if (result.kind === "CREATED" || result.kind === "IDEMPOTENT") {
      return succeeded(request, result.kind, {
        outcome: result.kind,
        sale_id: result.saleId,
        sale_number: result.saleNumber,
        payable_amount: result.payableAmount,
        calculation_checksum: result.calculationChecksum,
      });
    }

    return rejected(request, result.kind, {
      outcome: result.kind,
      sale_id: null, sale_number: null, payable_amount: null, calculation_checksum: null,
    });
  }
}

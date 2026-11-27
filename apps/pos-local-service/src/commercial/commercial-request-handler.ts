import { randomUUID } from "node:crypto";
import { scaleQuantity } from "../hardware/scale-quantity.js";
import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import { CanonicalPermission, type ContractError, type ErrorCategory, type IpcRequest , LicenseSectorEntitlement} from "@pos-platform/contracts";
import type { FiscalCustomerResolution, FiscalDocumentType, FiscalEnvironment } from "@pos-platform/fiscal-adapters";
import type { ServiceConfig } from "../config.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { boundIdentityFromClaims, type BoundSessionIdentity } from "../session/session-binding-registry.js";
import type { CommercialComponent } from "./commercial-component.js";
import { localOperatorAuthorization, type LocalAuthorizedSession } from "../security/local-operator-development-bridge.js";
import { commercialBusinessDate } from "../admin/commercial-calendar.js";

const RESULT_SCHEMA_VERSION = "1.0.0";

type CommercialRequest = Extract<
  IpcRequest,
  {
    message_type:
      | "authorization.capabilities.get"
      | "session.activate" | "session.recover"
      | "cash.shift.open" | "cash.shift.close" | "sale.create" | "sale.cancel"
      | "payment.register.cash" | "payment.register.transfer"
      | "payment.transfer.confirm" | "payment.factus_pay.collect" | "payment.factus_pay.verify" | "payment.factus_pay.resume" | "payment.cancel" | "payment.get"
      | "customer.register" | "customer.get" | "customer.find"
      | "fiscal.document.issue" | "fiscal.numbering.sync"
      | "catalog.product.register" | "catalog.product.update" | "catalog.price.publish"
      | "catalog.media.put" | "catalog.media.clear" | "catalog.media.get"
      | "catalog.item.find" | "catalog.item.get" | "catalog.item.list" | "admin.metrics.get"
      | "inventory.stock.receive" | "inventory.stock.adjust" | "inventory.stock.get"
      | "inventory.batch.list" | "inventory.batch.status"
      | "inventory.conversion.rule.approve" | "inventory.conversion.execute"
      | "inventory.reservation.create" | "inventory.reservation.release"
      | "cart.waiting.save" | "cart.waiting.list" | "cart.waiting.get" | "cart.waiting.discard"
      | "sales.receipt.get"
      | "hardware.command"
      | "catalog.presentation.register" | "catalog.food_policy.upsert"
      | "pharmacy.establishment.upsert" | "pharmacy.profile.upsert" | "pharmacy.prescription.register"
      | "pharmacy.technical_receipt.register" | "pharmacy.sanitary_alert.register"
      | "bakery.recipe.draft.create" | "bakery.recipe.approve"
      | "bakery.production.order.create" | "bakery.production.order.plan" | "bakery.production.release"
      | "bakery.production.deviation.authorize" | "bakery.production.confirm" | "bakery.production.trace.get"
      | "inventory.transform.execute"
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
  CONFIRMED_COVERAGE_REQUIRES_RECONCILIATION: "CONFLICT",
  PENDING_PAYMENTS_MUST_CANCEL: "CONFLICT",
  CONFLICT: "CONFLICT",
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
    private readonly resolveLocalOperator?: (connectionId: string) => LocalAuthorizedSession | null,
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
    if (identity === null) {
      // Explicit LOCAL development authority. No signed commercial SSA/SAS or
      // CommercialComponent binding is invented. Every business operation
      // rechecks the backend-owned connection's currently live login.
      if (this.config.local_operator_auth_store !== undefined && this.resolveLocalOperator) {
        const local = this.resolveLocalOperator(connectionId);
        if (local !== null) {
          const { userId, snapshot } = localOperatorAuthorization(local, this.config);
          return {
            identity: {
              userId,
              ssaSessionId: local.sessionId,
              tenantMembershipId: this.config.tenant_id,
              offlineValidUntil: local.expiresAt,
            },
            snapshot,
          };
        }
      }
      return { rejection: SESSION_NOT_BOUND };
    }

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
      case "authorization.capabilities.get": return this.getAuthorizationCapabilities(request, connectionId);
      case "session.activate": return this.activate(request, connectionId);
      case "session.recover": return this.recover(request, connectionId);
      case "cash.shift.open": return this.openShift(request, connectionId);
      case "cash.shift.close": return this.closeShift(request, connectionId);
      case "sale.create": return this.createSale(request, connectionId);
      case "sale.cancel": return this.cancelSale(request, connectionId);
      case "cart.waiting.save":
      case "cart.waiting.discard":
      case "cart.waiting.get":
      case "cart.waiting.list": return this.waitingCart(request, connectionId);
      case "payment.register.cash": return this.registerCashPayment(request, connectionId);
      case "payment.register.transfer": return this.registerTransferPayment(request, connectionId);
      case "payment.transfer.confirm": return this.confirmTransferPayment(request, connectionId);
      case "payment.factus_pay.collect": return this.collectFactusPay(request, connectionId, signal);
      case "payment.factus_pay.verify": return this.verifyFactusPay(request, connectionId, signal);
      case "payment.factus_pay.resume": return this.resumeFactusPay(request, connectionId, signal);
      case "payment.cancel": return this.cancelPayment(request, connectionId);
      case "payment.get": return this.getPayment(request, connectionId);
      case "customer.register": return this.registerCustomer(request, connectionId);
      case "customer.get":
      case "customer.find": return this.readCustomer(request, connectionId);
      case "fiscal.document.issue": return this.issueDocument(request, connectionId, signal);
      case "fiscal.numbering.sync": return this.syncNumberingRanges(request, connectionId, signal);
      case "catalog.product.register": return this.registerProduct(request, connectionId);
      case "catalog.product.update": return this.updateProduct(request, connectionId);
      case "catalog.price.publish": return this.publishPrice(request, connectionId);
      case "catalog.media.put": return this.putCatalogMedia(request, connectionId);
      case "catalog.media.clear": return this.clearCatalogMedia(request, connectionId);
      case "catalog.media.get": return this.getCatalogMedia(request, connectionId);
      case "catalog.item.find":
      case "catalog.item.get": return this.findCatalogItem(request, connectionId);
      case "admin.metrics.get": return this.getAdminMetrics(request, connectionId);
      case "catalog.item.list": return this.listCatalogItems(request, connectionId);
      case "inventory.stock.receive":
      case "inventory.stock.adjust": return this.moveStock(request, connectionId);
      case "inventory.stock.get": return this.getStock(request, connectionId);
      case "inventory.batch.list": return this.listBatches(request, connectionId);
      case "inventory.batch.status": return this.changeBatchStatus(request, connectionId);
      case "inventory.conversion.rule.approve": return this.approvePresentationConversion(request, connectionId);
      case "inventory.conversion.execute": return this.convertPresentation(request, connectionId);
      case "inventory.reservation.create": return this.createInventoryReservation(request, connectionId);
      case "inventory.reservation.release": return this.releaseInventoryReservation(request, connectionId);
      case "catalog.presentation.register": return this.registerPresentation(request, connectionId);
      case "catalog.food_policy.upsert": return this.upsertFoodPolicy(request, connectionId);
      case "pharmacy.establishment.upsert": return this.upsertPharmacyEstablishment(request, connectionId);
      case "pharmacy.profile.upsert": return this.upsertPharmacyProfile(request, connectionId);
      case "pharmacy.prescription.register": return this.registerPharmacyPrescription(request, connectionId);
      case "pharmacy.technical_receipt.register": return this.registerPharmacyTechnicalReceipt(request, connectionId);
      case "pharmacy.sanitary_alert.register": return this.registerPharmacySanitaryAlert(request, connectionId);
      case "bakery.recipe.draft.create": return this.createBakeryRecipeDraft(request, connectionId);
      case "bakery.recipe.approve": return this.approveBakeryRecipe(request, connectionId);
      case "bakery.production.order.create": return this.createBakeryProductionOrder(request, connectionId);
      case "bakery.production.order.plan": return this.planBakeryProductionOrder(request, connectionId);
      case "bakery.production.release": return this.releaseBakeryFinishedLot(request, connectionId);
      case "bakery.production.deviation.authorize":
        return this.authorizeBakeryProductionDeviation(request, connectionId);
      case "bakery.production.confirm": return this.confirmBakeryProduction(request, connectionId);
      case "bakery.production.trace.get": return this.getBakeryProductionTrace(request, connectionId);
      case "inventory.transform.execute": return this.executeTransform(request, connectionId);
      case "sales.receipt.get": return this.getReceipt(request, connectionId);
      case "hardware.command": return this.hardwareCommand(request, connectionId);
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
      if (result.saleCompleted && this.config.hardware_automatic_drawer_policy_file !== undefined) {
        void this.commercial.hardware.afterConfirmedCashPayment(this.scope(), authenticated.snapshot,
          { userId: authenticated.identity.userId, sessionId: authenticated.identity.ssaSessionId }, result.paymentId);
      }
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

    if (result.kind === "CONFIRMED" || result.kind === "IDEMPOTENT") {
      return succeeded(request, result.kind, {
        outcome: result.kind,
        payment_id: result.paymentId,
        sale_completed: result.saleCompleted,
        confirmed_coverage: result.confirmedCoverage,
        payable_amount: result.payableAmount,
      });
    }
    return rejected(request, result.kind, {
      outcome: result.kind, payment_id: null, sale_completed: false,
      confirmed_coverage: null, payable_amount: null,
    });
  }


  private async collectFactusPay(
    request: Extract<CommercialRequest, { message_type: "payment.factus_pay.collect" }>,
    connectionId: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    void signal;
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED",
        payment_id: null,
        reference_code: null,
        qr: null,
        provider_status: null,
      });
    }

    const expiration = request.payload.expiration_seconds ?? 900;
    const result = await this.commercial.registerFactusPayCollection.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        saleId: request.payload.sale_id,
        amount: request.payload.amount,
        expirationSeconds: expiration,
        idempotencyKey: request.idempotency_key as string,
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );

    if (result.kind === "COLLECTED" || result.kind === "IDEMPOTENT") {
      return succeeded(request, result.kind, {
        outcome: result.kind,
        payment_id: result.paymentId,
        reference_code: result.referenceCode,
        qr: result.qr,
        provider_status: result.providerStatus,
      });
    }
    if (result.kind === "REGISTERED_PROVIDER_FAILED") {
      return rejected(request, result.kind, {
        outcome: result.kind,
        payment_id: result.paymentId,
        reference_code: result.referenceCode,
        qr: null,
        provider_status: null,
      });
    }
    return rejected(request, result.kind, {
      outcome: result.kind,
      payment_id: null,
      reference_code: null,
      qr: null,
      provider_status: null,
    });
  }

  private async verifyFactusPay(
    request: Extract<CommercialRequest, { message_type: "payment.factus_pay.verify" }>,
    connectionId: string,
    _signal: AbortSignal,
  ): Promise<unknown> {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED", payment_id: null, sale_completed: false,
        confirmed_coverage: null, payable_amount: null,
      });
    }

    const result = await this.commercial.verifyFactusPayCollection.execute(
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

  private async resumeFactusPay(
    request: Extract<CommercialRequest, { message_type: "payment.factus_pay.resume" }>,
    connectionId: string,
    _signal: AbortSignal,
  ): Promise<unknown> {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED",
        payment_id: null,
        version: null,
        status: null,
        expected_amount: null,
        reference_code: null,
        qr: null,
        provider_status: null,
      });
    }

    const result = await this.commercial.resumeFactusPayCollection.execute(
      this.scope(),
      authenticated.snapshot,
      { saleId: request.payload.sale_id },
    );

    if (result.kind === "FOUND") {
      return succeeded(request, "FOUND", {
        outcome: "FOUND",
        payment_id: result.paymentId,
        version: result.version,
        status: result.status,
        expected_amount: result.expectedAmount,
        reference_code: result.referenceCode.length > 0 ? result.referenceCode : null,
        qr: result.qr,
        provider_status: result.providerStatus,
      });
    }
    return rejected(request, result.kind, {
      outcome: result.kind,
      payment_id: null,
      version: null,
      status: null,
      expected_amount: null,
      reference_code: null,
      qr: null,
      provider_status: null,
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
        ...(request.payload.include_sale_coverage
          ? { sale_confirmed_coverage: result.payment.saleConfirmedCoverage }
          : {}),
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
    const scope=this.scope();
    const access=evaluatePermission({actor:createActor("USER",authenticated.identity.userId),permission:CanonicalPermission.FISCAL_DOCUMENT_ISSUE,
      scope:createOperationScope(scope.tenantId,scope.companyId,scope.branchId),at:new Date(),assignments:toRoleAssignments(authenticated.snapshot.claims)});
    if(!access.allowed)return rejected(request,"UNAUTHORIZED",{outcome:"UNAUTHORIZED",...empty});
    const sale=this.commercial.fiscalSaleSource.read(scope,payload.sale_id);
    const linkedId=sale?.customerId ?? null;
    if (linkedId && (payload.customer.kind === "NOT_IDENTIFIED" ||
      (payload.customer.kind === "IDENTIFIED" && payload.customer.customer_id !== linkedId))) {
      return rejected(request,"BLOCKED",{outcome:"BLOCKED",...empty,block_code:"SALE_CUSTOMER_MISMATCH"});
    }
    let customer: FiscalCustomerResolution;
    if (payload.customer.kind === "IDENTIFIED" || payload.customer.kind === "SALE_CUSTOMER") {
      const customerId=payload.customer.kind === "IDENTIFIED" ? payload.customer.customer_id : linkedId;
      if(!customerId) return rejected(request,"BLOCKED",{outcome:"BLOCKED",...empty,block_code:"SALE_CUSTOMER_NOT_ASSIGNED"});
      const found = this.commercial.getCustomer.execute(scope,authenticated.snapshot,{by:"ID",customerId});
      if(found.kind!=="FOUND")return rejected(request,"BLOCKED",{outcome:"BLOCKED",...empty,block_code:"CUSTOMER_NOT_FOUND"});
      customer={kind:"IDENTIFIED",customer:found.customer};
    } else {
      customer={kind:"NOT_IDENTIFIED",reason:payload.customer.reason};
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

  private async syncNumberingRanges(
    request: Extract<CommercialRequest, { message_type: "fiscal.numbering.sync" }>,
    connectionId: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const empty = { count: null as number | null, reason_code: null as string | null };
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }
    const useCase = this.commercial.synchronizeNumberingRanges;
    const credential = this.commercial.fiscalCredentialReference;
    if (useCase === null || credential === null || this.config.fiscal_environment === undefined) {
      return rejected(request, "FISCAL_NOT_CONFIGURED", { outcome: "FISCAL_NOT_CONFIGURED", ...empty });
    }
    const scope = this.scope();
    const access = evaluatePermission({
      actor: createActor("USER", authenticated.identity.userId),
      permission: CanonicalPermission.FISCAL_DOCUMENT_ISSUE,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: new Date(),
      assignments: toRoleAssignments(authenticated.snapshot.claims),
    });
    if (!access.allowed) {
      return rejected(request, "UNAUTHORIZED", { outcome: "UNAUTHORIZED", ...empty });
    }
    const result = await useCase.execute(
      scope,
      "FACTUS",
      this.config.fiscal_environment as FiscalEnvironment,
      ["SALES_INVOICE", "CREDIT_NOTE"],
      credential,
      signal,
    );
    if (result.kind === "SYNCHRONIZED") {
      return succeeded(request, "SYNCHRONIZED", { outcome: "SYNCHRONIZED", count: result.count, reason_code: null });
    }
    return rejected(request, result.kind, {
      outcome: result.kind,
      count: null,
      reason_code: result.reasonCode,
    });
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
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.brand !== undefined ? { brand: payload.brand } : {}),
        ...(payload.category !== undefined ? { category: payload.category } : {}),
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

  private updateProduct(
    request: Extract<CommercialRequest, { message_type: "catalog.product.update" }>,
    connectionId: string,
  ): unknown {
    const empty = {
      product_id: null, version: null, presentation_version: null, current_version: null,
    };
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }
    const payload = request.payload;
    const result = this.commercial.updateProduct.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        productId: payload.product_id,
        expectedVersion: payload.expected_version,
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.code !== undefined ? { code: payload.code } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.brand !== undefined ? { brand: payload.brand } : {}),
        ...(payload.category !== undefined ? { category: payload.category } : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        ...(payload.presentation_id !== undefined
          ? { presentationId: payload.presentation_id }
          : {}),
        ...(payload.presentation_expected_version !== undefined
          ? { presentationExpectedVersion: payload.presentation_expected_version }
          : {}),
        ...(payload.presentation_name !== undefined
          ? { presentationName: payload.presentation_name }
          : {}),
        ...(payload.barcode !== undefined ? { barcode: payload.barcode } : {}),
        ...(payload.low_stock_threshold !== undefined
          ? { lowStockThreshold: payload.low_stock_threshold }
          : {}),
        reason: payload.reason ?? null,
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    if (result.kind === "UPDATED" || result.kind === "IDEMPOTENT") {
      return succeeded(request, result.kind, {
        outcome: result.kind,
        product_id: result.productId,
        version: result.version,
        presentation_version: result.presentationVersion,
        current_version: null,
      });
    }
    if (result.kind === "VERSION_CONFLICT" || result.kind === "PRESENTATION_VERSION_CONFLICT") {
      return rejected(request, result.kind, {
        outcome: result.kind, ...empty, current_version: result.currentVersion,
      });
    }
    if (result.kind === "CODE_ALREADY_REGISTERED") {
      return rejected(request, result.kind, {
        outcome: result.kind, product_id: result.productId, version: null,
        presentation_version: null, current_version: null,
      });
    }
    if (result.kind === "BARCODE_ALREADY_REGISTERED") {
      return rejected(request, result.kind, { outcome: result.kind, ...empty });
    }
    return rejected(request, result.kind, { outcome: result.kind, ...empty });
  }

  private publishPrice(
    request: Extract<CommercialRequest, { message_type: "catalog.price.publish" }>,
    connectionId: string,
  ): unknown {
    const empty = { price_id: null, presentation_id: null };
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }
    const result = this.commercial.supersedePrice.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        presentationId: request.payload.presentation_id,
        amount: request.payload.amount,
        currencyCode: request.payload.currency_code,
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    if (result.kind === "PUBLISHED" || result.kind === "IDEMPOTENT") {
      return succeeded(request, result.kind, {
        outcome: result.kind,
        price_id: result.priceId,
        presentation_id: result.presentationId,
      });
    }
    return rejected(request, result.kind, { outcome: result.kind, ...empty });
  }

  private putCatalogMedia(
    request: Extract<CommercialRequest, { message_type: "catalog.media.put" }>,
    connectionId: string,
  ): unknown {
    const empty = {
      media_id: null, product_id: null, version: null, current_version: null, reason: null,
    };
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }
    const result = this.commercial.manageCatalogMedia.put(
      this.scope(), authenticated.snapshot, {
        productId: request.payload.product_id,
        expectedVersion: request.payload.expected_version,
        contentBase64: request.payload.content_base64,
      },
    );
    if (result.kind === "ATTACHED") {
      return succeeded(request, "ATTACHED", {
        outcome: "ATTACHED",
        media_id: result.mediaId,
        product_id: result.productId,
        version: result.version,
        current_version: null,
        reason: null,
      });
    }
    if (result.kind === "VERSION_CONFLICT") {
      return rejected(request, result.kind, {
        outcome: result.kind, ...empty, current_version: result.currentVersion,
      });
    }
    if (result.kind === "INVALID") {
      return rejected(request, result.kind, { outcome: result.kind, ...empty, reason: result.reason });
    }
    return rejected(request, result.kind, { outcome: result.kind, ...empty });
  }

  private clearCatalogMedia(
    request: Extract<CommercialRequest, { message_type: "catalog.media.clear" }>,
    connectionId: string,
  ): unknown {
    const empty = {
      media_id: null, product_id: null, version: null, current_version: null, reason: null,
    };
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }
    const result = this.commercial.manageCatalogMedia.clear(
      this.scope(), authenticated.snapshot, {
        productId: request.payload.product_id,
        expectedVersion: request.payload.expected_version,
      },
    );
    if (result.kind === "ATTACHED") {
      return succeeded(request, "ATTACHED", {
        outcome: "ATTACHED",
        media_id: result.mediaId,
        product_id: result.productId,
        version: result.version,
        current_version: null,
        reason: null,
      });
    }
    if (result.kind === "VERSION_CONFLICT") {
      return rejected(request, result.kind, {
        outcome: result.kind, ...empty, current_version: result.currentVersion,
      });
    }
    return rejected(request, result.kind, { outcome: result.kind, ...empty });
  }

  private getCatalogMedia(
    request: Extract<CommercialRequest, { message_type: "catalog.media.get" }>,
    connectionId: string,
  ): unknown {
    const empty = {
      media_id: null, mime_type: null, width_px: null, height_px: null, content_base64: null,
    };
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }
    const result = this.commercial.manageCatalogMedia.get(
      this.scope(), authenticated.snapshot, request.payload.media_id,
    );
    if (result.kind === "FOUND") {
      return succeeded(request, "FOUND", {
        outcome: "FOUND",
        media_id: result.mediaId,
        mime_type: result.mimeType,
        width_px: result.widthPx,
        height_px: result.heightPx,
        content_base64: result.contentBase64,
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
      description: null, brand: null, category: null,
      presentation_name: null, unit_code: null, unit_precision: null, barcode: null,
      stock_controlled: null, price_amount: null, currency_code: null,
      quantity_available: null, quantity_on_hand: null, quantity_reserved: null,
      quantity_unsellable: null, low_stock_threshold: null,
      availability_state: null,
      product_version: null, presentation_version: null, media_id: null,
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
        description: product.description,
        brand: product.brand,
        category: product.category,
        presentation_name: presentation.name,
        unit_code: presentation.unitCode,
        unit_precision: presentation.unitPrecision,
        barcode: presentation.barcode,
        stock_controlled: product.stockControlled,
        // `null` es «sin precio activo», no gratis.
        price_amount: price?.amount ?? null,
        currency_code: price?.currencyCode ?? null,
        quantity_available: result.availability.quantity_available,
        quantity_on_hand: result.availability.quantity_on_hand,
        quantity_reserved: result.availability.quantity_reserved,
        quantity_unsellable: result.availability.quantity_unsellable,
        low_stock_threshold: result.availability.low_stock_threshold,
        availability_state: result.availability.availability_state,
        product_version: product.version,
        presentation_version: presentation.version,
        media_id: product.primaryMediaId,
      });
    }
    if (result.kind === "NOT_FOUND") {
      return rejected(request, "NOT_FOUND", { outcome: "NOT_FOUND", ...empty });
    }
    return rejected(request, "UNAUTHORIZED", { outcome: "UNAUTHORIZED", ...empty });
  }

  private getAdminMetrics(
    request: Extract<CommercialRequest, { message_type: "admin.metrics.get" }>,
    connectionId: string,
  ): unknown {
    const empty = {
      outcome: "AVAILABLE" as const,
      sales_completed_count: null,
      sales_completed_amount: null,
      sales_completed_today_count: null,
      sales_completed_today_amount: null,
      inventory_tracked_count: null,
      cash_open_shift_count: null,
      payments_confirmed_count: null,
      payments_confirmed_amount: null,
      payments_confirmed_cash_amount: null,
      payments_confirmed_transfer_amount: null,
      payments_confirmed_qr_amount: null,
      payments_pending_transfer_count: null,
      metrics_scope: "INSTALLATION_BRANCH" as const,
      metrics_period_timezone: "America/Bogota" as const,
      metrics_business_date: commercialBusinessDate(new Date()),
    };
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, empty);
    }

    const result = this.commercial.getAdminMetrics.execute(
      this.scope(),
      authenticated.snapshot,
    );
    if (result.kind === "UNAUTHORIZED") {
      return rejected(request, "UNAUTHORIZED", empty);
    }

    return succeeded(request, "AVAILABLE", {
      outcome: "AVAILABLE",
      ...result.metrics,
    });
  }

  // ── catalog.item.list ─────────────────────────────────────────────────────

  /** Lista sólo presentaciones activas con precio activo; el catálogo sigue siendo autoridad. */
  private listCatalogItems(
    request: Extract<CommercialRequest, { message_type: "catalog.item.list" }>,
    connectionId: string,
  ): unknown {
    const empty = { items: [], has_more: false };

    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }

    const result = this.commercial.listCatalogItems.execute(
      this.scope(),
      authenticated.snapshot,
      {
        query: request.payload.query,
        limit: request.payload.limit,
        offset: request.payload.offset,
      },
    );

    if (result.kind === "UNAUTHORIZED") {
      return rejected(request, "UNAUTHORIZED", { outcome: "UNAUTHORIZED", ...empty });
    }

    return succeeded(request, "FOUND", {
      outcome: "FOUND",
      items: result.items.map(({ product, presentation, price, availability }) => ({
        product_id: product.id,
        presentation_id: presentation.id,
        code: product.code,
        name: product.name,
        description: product.description,
        brand: product.brand,
        category: product.category,
        presentation_name: presentation.name,
        unit_code: presentation.unitCode,
        unit_precision: presentation.unitPrecision,
        barcode: presentation.barcode,
        stock_controlled: product.stockControlled,
        price_amount: price.amount,
        currency_code: price.currencyCode,
        quantity_available: availability.quantity_available,
        quantity_on_hand: availability.quantity_on_hand,
        quantity_reserved: availability.quantity_reserved,
        quantity_unsellable: availability.quantity_unsellable,
        low_stock_threshold: availability.low_stock_threshold,
        availability_state: availability.availability_state,
        product_version: product.version,
        presentation_version: presentation.version,
        media_id: product.primaryMediaId,
      })),
      has_more: result.hasMore,
    });
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
  private listBatches(
    request:Extract<CommercialRequest,{message_type:"inventory.batch.list"}>,
    connectionId:string,
  ):unknown{
    const rejectedResult={outcome:"UNAUTHORIZED",tracked:false,batches:[]};
    const session=this.authenticate(connectionId);
    if("rejection" in session)return rejected(request,session.rejection,rejectedResult);
    const result=this.commercial.listBatches.execute(
      this.scope(),session.snapshot,request.payload.presentation_id);
    if(result.kind==="UNAUTHORIZED")return rejected(request,"UNAUTHORIZED",rejectedResult);
    return succeeded(request,"FOUND",{outcome:"FOUND",tracked:result.tracked,batches:result.batches.map(lot=>({
      id:lot.id,batch_code:lot.batchCode,quantity_on_hand:lot.quantityOnHand,status:lot.status,
      manufacture_date:lot.manufactureDate,expiry_date:lot.expiryDate,
      supplier_reference:lot.supplierReference,receipt_document:lot.receiptDocument,
    }))});
  }

  private changeBatchStatus(
    request:Extract<CommercialRequest,{message_type:"inventory.batch.status"}>,
    connectionId:string,
  ):unknown{
    const session=this.authenticate(connectionId);
    if("rejection" in session)return rejected(request,session.rejection,{outcome:"UNAUTHORIZED"});
    const result=this.commercial.changeBatchStatus.execute(
      this.scope(),session.identity.ssaSessionId,session.snapshot,{
        lotId:request.payload.lot_id,status:request.payload.status,
        reasonCode:request.payload.reason_code,idempotencyKey:request.idempotency_key as string,
        correlationId:request.correlation_id,causationId:request.causation_id??null,
      });
    if(result.kind==="UPDATED"||result.kind==="IDEMPOTENT")
      return succeeded(request,result.kind,{outcome:result.kind});
    return rejected(request,result.kind,{outcome:result.kind});
  }

  private approvePresentationConversion(
    request:Extract<CommercialRequest,{message_type:"inventory.conversion.rule.approve"}>,
    connectionId:string,
  ):unknown{
    const invalid={outcome:"UNAUTHORIZED",rule_id:null};
    const session=this.authenticate(connectionId);
    if("rejection" in session)return rejected(request,session.rejection,invalid);
    const result=this.commercial.approvePresentationConversion.execute(
      this.scope(),session.identity.ssaSessionId,session.snapshot,{
        sourcePresentationId:request.payload.source_presentation_id,
        targetPresentationId:request.payload.target_presentation_id,
        numerator:request.payload.numerator,denominator:request.payload.denominator,
        version:request.payload.version,idempotencyKey:request.idempotency_key as string,
        correlationId:request.correlation_id,causationId:request.causation_id??null,
      });
    const response={outcome:result.kind,rule_id:result.ruleId??null};
    return result.kind==="APPROVED"||result.kind==="IDEMPOTENT"
      ?succeeded(request,result.kind,response):rejected(request,result.kind,response);
  }

  private convertPresentation(
    request:Extract<CommercialRequest,{message_type:"inventory.conversion.execute"}>,
    connectionId:string,
  ):unknown{
    const empty={outcome:"UNAUTHORIZED",conversion_id:null,target_lot_id:null,target_quantity:null};
    const session=this.authenticate(connectionId);
    if("rejection" in session)return rejected(request,session.rejection,empty);
    const result=this.commercial.convertPresentation.execute(
      this.scope(),session.identity.ssaSessionId,session.snapshot,{
        ruleId:request.payload.rule_id,sourceLotId:request.payload.source_lot_id,
        quantity:request.payload.quantity,reasonCode:request.payload.reason_code,
        businessDate:request.payload.business_date,idempotencyKey:request.idempotency_key as string,
        correlationId:request.correlation_id,causationId:request.causation_id??null,
      });
    const response={outcome:result.kind,conversion_id:result.conversionId??null,
      target_lot_id:result.targetLotId??null,target_quantity:result.targetQuantity??null};
    return result.kind==="CONVERTED"||result.kind==="IDEMPOTENT"
      ?succeeded(request,result.kind,response):rejected(request,result.kind,response);
  }

  private createInventoryReservation(
    request:Extract<CommercialRequest,{message_type:"inventory.reservation.create"}>,
    connectionId:string,
  ):unknown{
    const empty={outcome:"UNAUTHORIZED",reservation_id:null,available:null};
    const session=this.authenticate(connectionId);
    if("rejection" in session)return rejected(request,session.rejection,empty);
    const result=this.commercial.createInventoryReservation.execute(
      this.scope(),session.identity.ssaSessionId,session.snapshot,{
        presentationId:request.payload.presentation_id,
        quantity:request.payload.quantity,
        referenceId:request.payload.reference_id,
        expiresAt:request.payload.expires_at,
        idempotencyKey:request.idempotency_key as string,
        correlationId:request.correlation_id,
        causationId:request.causation_id??null,
      });
    const response={
      outcome:result.kind,
      reservation_id:"reservationId" in result?(result.reservationId??null):null,
      available:"available" in result?(result.available??null):null,
    };
    return result.kind==="RESERVED"||result.kind==="IDEMPOTENT"
      ?succeeded(request,result.kind,response):rejected(request,result.kind,response);
  }

  private releaseInventoryReservation(
    request:Extract<CommercialRequest,{message_type:"inventory.reservation.release"}>,
    connectionId:string,
  ):unknown{
    const session=this.authenticate(connectionId);
    if("rejection" in session)return rejected(request,session.rejection,{outcome:"UNAUTHORIZED"});
    const result=this.commercial.releaseInventoryReservation.execute(
      this.scope(),session.identity.ssaSessionId,session.snapshot,{
        reservationId:request.payload.reservation_id,
        reasonCode:request.payload.reason_code,
        idempotencyKey:request.idempotency_key as string,
        correlationId:request.correlation_id,
        causationId:request.causation_id??null,
      });
    const response={outcome:result.kind};
    return result.kind==="RELEASED"||result.kind==="IDEMPOTENT"
      ?succeeded(request,result.kind,response):rejected(request,result.kind,response);
  }

  // ── sales.receipt.get — `DEC-019` ──────────────────────────────────────────

  private waitingCart(request: Extract<CommercialRequest,{message_type:"cart.waiting.save"|"cart.waiting.list"|"cart.waiting.get"|"cart.waiting.discard"}>,connectionId:string):unknown {
    const auth=this.authenticate(connectionId);
    const denied={outcome:"UNAUTHORIZED",carts:[],has_more:false};
    if("rejection" in auth) return rejected(request,auth.rejection,denied);
    const scope=this.scope();
    const decision=evaluatePermission({actor:createActor("USER",auth.identity.userId),permission:CanonicalPermission.SALES_SALE_CREATE,
      scope:createOperationScope(scope.tenantId,scope.companyId,scope.branchId),at:new Date(),assignments:toRoleAssignments(auth.snapshot.claims)});
    if(!decision.allowed) return rejected(request,"UNAUTHORIZED",denied);
    if (request.message_type === "cart.waiting.save" && request.payload.cart.customer_id) {
      const customer = this.commercial.getCustomer.execute(scope, auth.snapshot,
        { by: "ID", customerId: request.payload.cart.customer_id });
      if (customer.kind !== "FOUND") return rejected(request, customer.kind,
        { outcome: customer.kind, carts: [], has_more: false });
    }
    const owner={...scope,operatorId:auth.identity.userId};
    const result=request.message_type==="cart.waiting.list" ? this.commercial.waitingCarts.list(owner)
      : request.message_type==="cart.waiting.get" ? this.commercial.waitingCarts.get(owner,request.payload.cart_id)
      : request.message_type==="cart.waiting.discard" ? this.commercial.waitingCarts.discard(owner,request.payload.cart_id,request.payload.expected_version)
      :this.commercial.waitingCarts.save(owner,request.payload.cart_id,request.payload.expected_version,request.idempotency_key!,request.payload.cart);
    return ["FOUND","SAVED","DISCARDED"].includes(result.outcome)?succeeded(request,result.outcome,result):rejected(request,result.outcome,result);
  }

  // ── sale.create ────────────────────────────────────────────────────────────


  private async hardwareCommand(request: Extract<CommercialRequest, { message_type: "hardware.command" }>, connectionId: string): Promise<unknown> {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) return rejected(request, authenticated.rejection, { kind: "UNAUTHORIZED", data: null, reason: authenticated.rejection });
    if (request.payload.action === "capture_weight") {
      const payload = request.payload;
      const fail = (reason: string) => rejected(request, reason, {kind:"REJECTED",data:null,reason});
      const scope = this.scope();
      const permission = evaluatePermission({actor:createActor("USER",authenticated.identity.userId),permission:CanonicalPermission.SALES_SALE_CREATE,scope:createOperationScope(scope.tenantId,scope.companyId,scope.branchId),at:new Date(),assignments:toRoleAssignments(authenticated.snapshot.claims)});
      if (!permission.allowed) return fail("UNAUTHORIZED");
      const scale = this.commercial.scale;
      if (!scale || scale.profile.cash_register_id !== payload.cash_register_id) return fail("SCALE_NOT_CONFIGURED_FOR_REGISTER");
      if (!this.commercial.hasOpenScaleRegister(payload.cash_register_id)) return fail("CASH_SHIFT_NOT_OPEN");
      const catalog = this.commercial.findCatalogItem.execute(scope,authenticated.snapshot,{by:"PRESENTATION",presentationId:payload.presentation_id});
      if (catalog.kind !== "FOUND" || !catalog.item.price) return fail("SCALE_PRESENTATION_NOT_SELLABLE");
      const {unitCode,unitPrecision} = catalog.item.presentation;
      if (unitCode !== "KGM" && unitCode !== "GRM") return fail("SCALE_PRESENTATION_NOT_MASS");
      const measurement = scale.reader.consume();
      if (!measurement) return fail("SCALE_NO_FRESH_STABLE_WEIGHT");
      const quantity = scaleQuantity(measurement.grams,unitCode,unitPrecision);
      if (quantity === null) return fail("QUANTITY_PRECISION_EXCEEDED");
      return succeeded(request,"WEIGHT_CAPTURED",{kind:"WEIGHT_CAPTURED",data:{quantity,presentation_id:payload.presentation_id,unit_code:unitCode},reason:null});
    }
    const result = await this.commercial.hardware.execute(this.scope(), authenticated.snapshot,
      { userId: authenticated.identity.userId, sessionId: authenticated.identity.ssaSessionId }, request.payload);
    return result.kind === "UNAUTHORIZED" || result.kind === "REJECTED" ? rejected(request, result.reason ?? result.kind, result) : succeeded(request, result.kind, result);
  }

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

  // ── authorization.capabilities.get ─────────────────────────────────────────

  /**
   * Devuelve sólo permisos efectivos para el ámbito de esta instalación.
   * Nunca entrega el snapshot firmado ni las asignaciones al renderer.
   */
  /** Signed capacity entitlement for sector modules — fails closed when provisioned. */
  private sectorDenial(entitlement: string): string | null {
    return this.commercial.requireSectorEntitlement?.(entitlement) ?? null;
  }

  private getAuthorizationCapabilities(
    request: Extract<CommercialRequest, { message_type: "authorization.capabilities.get" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED",
        entitlements: [],
        permissions: [],
      });
    }

    const assignments = toRoleAssignments(authenticated.snapshot.claims);
    const scope = createOperationScope(
      this.scope().tenantId,
      this.scope().companyId,
      this.scope().branchId,
    );
    const actor = createActor("USER", authenticated.snapshot.claims.user_id);
    const permissions = [...new Set(
      authenticated.snapshot.claims.assignments.flatMap(
        (assignment) => assignment.permissions
          .filter((permission) => permission.status === "ACTIVE")
          .map((permission) => permission.code),
      ),
    )].filter((permission) =>
      evaluatePermission({
        actor,
        permission,
        scope,
        at: new Date(),
        assignments,
      }).allowed,
    );

    return succeeded(request, "AVAILABLE", {
      outcome: "AVAILABLE",
      entitlements: [...(this.commercial.listLicenseEntitlements?.() ?? [])],
      permissions,
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

    const create = () => this.commercial.createSale.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        customerId: request.payload.customer_id ?? null,
        requireOpenCashShift: true,
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
          ...(line.identifier === undefined ? {} : { identifier: line.identifier }),
        })),
      },
    );

    // Recheck authorization even for a replay of a consumed waiting cart.
    const scope=this.scope();
    const allowed=evaluatePermission({actor:createActor("USER",authenticated.identity.userId),permission:CanonicalPermission.SALES_SALE_CREATE,
      scope:createOperationScope(scope.tenantId,scope.companyId,scope.branchId),at:new Date(),assignments:toRoleAssignments(authenticated.snapshot.claims)});
    const waiting=request.payload.waiting_cart;
    const result=!allowed.allowed ? {kind:"UNAUTHORIZED" as const} : waiting
      ? this.commercial.waitingCarts.consume({...scope,operatorId:authenticated.identity.userId},waiting.id,waiting.version,
        request.idempotency_key!,request.payload,request.payload.cash_register_id,create)
      : create();

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

  private cancelSale(
    request: Extract<CommercialRequest, { message_type: "sale.cancel" }>,
    connectionId: string,
  ): unknown {
    const denied = { outcome: "UNAUTHORIZED", sale_id: null, released_reservations: null };
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, denied);
    }
    const result = this.commercial.cancelSale.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        saleId: request.payload.sale_id,
        reasonCode: request.payload.reason_code,
        idempotencyKey: request.idempotency_key as string,
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    if (result.kind === "CANCELLED" || result.kind === "IDEMPOTENT") {
      return succeeded(request, result.kind, {
        outcome: result.kind,
        sale_id: result.saleId,
        released_reservations: result.released,
      });
    }
    if (result.kind === "UNAUTHORIZED") {
      return rejected(request, "UNAUTHORIZED", denied);
    }
    if (result.kind === "CONFLICT") {
      return rejected(request, "CONFLICT", {
        outcome: "CONFLICT", sale_id: request.payload.sale_id, released_reservations: null,
      });
    }
    return rejected(request, result.kind, {
      outcome: result.kind,
      sale_id: request.payload.sale_id,
      released_reservations: null,
    });
  }

  private registerPresentation(
    request: Extract<CommercialRequest, { message_type: "catalog.presentation.register" }>,
    connectionId: string,
  ): unknown {
    const empty = { product_id: null, presentation_id: null };
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", ...empty });
    }
    const payload = request.payload;
    const result = this.commercial.addPresentation.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        productId: payload.product_id,
        presentationName: payload.presentation_name,
        unitCode: payload.unit_code,
        unitPrecision: payload.unit_precision,
        barcode: payload.barcode,
        priceAmount: payload.price_amount,
        currencyCode: payload.currency_code,
        ...(payload.fiscal_attributes === undefined ? {} : { fiscalAttributes: {
          codeReference: payload.fiscal_attributes.code_reference,
          unitMeasureCode: payload.fiscal_attributes.unit_measure_code,
          standardCode: payload.fiscal_attributes.standard_code,
          taxCode: payload.fiscal_attributes.tax_code,
          taxRate: payload.fiscal_attributes.tax_rate,
        } }),
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
    if (result.kind === "BARCODE_ALREADY_REGISTERED") {
      return rejected(request, result.kind, {
        outcome: result.kind, product_id: null, presentation_id: result.presentationId,
      });
    }
    return rejected(request, result.kind, {
      outcome: result.kind,
      product_id: "productId" in result ? (result.productId ?? null) : null,
      presentation_id: null,
    });
  }

  private upsertFoodPolicy(
    request: Extract<CommercialRequest, { message_type: "catalog.food_policy.upsert" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", version: null });
    }
    const sector = this.sectorDenial(LicenseSectorEntitlement.SALSAMENTARIA);
    if (sector) return rejected(request, sector, { outcome: "LICENSE_BLOCKED", version: null });
    const payload = request.payload;
    const result = this.commercial.upsertFoodPolicy.execute(
      this.scope(),
      authenticated.identity.ssaSessionId,
      authenticated.snapshot,
      {
        productId: payload.product_id,
        conservationCode: payload.conservation_code,
        requiresLotTracking: payload.requires_lot_tracking,
        requiresExpiry: payload.requires_expiry,
        notes: payload.notes,
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    const response = {
      outcome: result.kind,
      version: "version" in result ? (result.version ?? null) : null,
    };
    return result.kind === "SAVED" || result.kind === "IDEMPOTENT"
      ? succeeded(request, result.kind, response)
      : rejected(request, result.kind, response);
  }

  private executeTransform(
    request: Extract<CommercialRequest, { message_type: "inventory.transform.execute" }>,
    connectionId: string,
  ): unknown {
    const empty = { outcome: "UNAUTHORIZED" as const, order_id: null, available: null };
    const session = this.authenticate(connectionId);
    if ("rejection" in session) return rejected(request, session.rejection, empty);
    const sector = this.sectorDenial(LicenseSectorEntitlement.SALSAMENTARIA);
    if (sector) return rejected(request, sector, { outcome: "LICENSE_BLOCKED", order_id: null, available: null });
    const payload = request.payload;
    const result = this.commercial.executeTransform.execute(
      this.scope(),
      session.identity.ssaSessionId,
      session.snapshot,
      {
        reasonCode: payload.reason_code,
        businessDate: payload.business_date,
        canonicalMassUnit: payload.canonical_mass_unit,
        inputs: payload.inputs.map((line) => ({
          presentationId: line.presentation_id,
          lotId: line.lot_id,
          quantity: line.quantity,
          massQuantity: line.mass_quantity,
        })),
        outputs: payload.outputs.map((line) => ({
          presentationId: line.presentation_id,
          quantity: line.quantity,
          massQuantity: line.mass_quantity,
          batchCode: line.batch_code,
        })),
        shrinkage: payload.shrinkage.map((line) => ({
          presentationId: line.presentation_id,
          lotId: line.lot_id,
          quantity: line.quantity,
          massQuantity: line.mass_quantity,
        })),
        idempotencyKey: request.idempotency_key as string,
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    const response = {
      outcome: result.kind,
      order_id: "orderId" in result ? (result.orderId ?? null) : null,
      available: "available" in result ? (result.available ?? null) : null,
    };
    return result.kind === "POSTED" || result.kind === "IDEMPOTENT"
      ? succeeded(request, result.kind, response)
      : rejected(request, result.kind, response);
  }

  private upsertPharmacyEstablishment(
    request: Extract<CommercialRequest, { message_type: "pharmacy.establishment.upsert" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", version: null });
    }
    const sector = this.sectorDenial(LicenseSectorEntitlement.FARMACIA);
    if (sector) return rejected(request, sector, { outcome: "LICENSE_BLOCKED", version: null });
    const payload = request.payload;
    const result = this.commercial.upsertPharmacyEstablishment.execute(
      this.scope(), authenticated.identity.ssaSessionId, authenticated.snapshot, {
        establishmentType: payload.establishment_type,
        authorizedOtc: payload.authorized_otc,
        authorizedPrescription: payload.authorized_prescription,
        authorizedControlledSpecial: payload.authorized_controlled_special,
        controlledAuthorizationStatus: payload.controlled_authorization_status,
        controlledAuthorizationNote: payload.controlled_authorization_note,
        technicalDirectorAttribution: payload.technical_director_attribution,
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    const response = { outcome: result.kind, version: "version" in result ? (result.version ?? null) : null };
    return result.kind === "SAVED" || result.kind === "IDEMPOTENT"
      ? succeeded(request, result.kind, response)
      : rejected(request, result.kind, response);
  }

  private upsertPharmacyProfile(
    request: Extract<CommercialRequest, { message_type: "pharmacy.profile.upsert" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", version: null });
    }
    const sector = this.sectorDenial(LicenseSectorEntitlement.FARMACIA);
    if (sector) return rejected(request, sector, { outcome: "LICENSE_BLOCKED", version: null });
    const payload = request.payload;
    const result = this.commercial.upsertPharmacyProfile.execute(
      this.scope(), authenticated.identity.ssaSessionId, authenticated.snapshot, {
        productId: payload.product_id,
        productKind: payload.product_kind,
        commercialName: payload.commercial_name,
        genericName: payload.generic_name,
        activeIngredients: payload.active_ingredients,
        concentrationText: payload.concentration_text,
        pharmaceuticalForm: payload.pharmaceutical_form,
        manufacturer: payload.manufacturer,
        sanitaryHolder: payload.sanitary_holder,
        sanitaryRegistration: payload.sanitary_registration,
        registrationVerificationStatus: payload.registration_verification_status,
        dispensationCategory: payload.dispensation_category,
        requiresPrescription: payload.requires_prescription,
        controlledSpecial: payload.controlled_special,
        storageCondition: payload.storage_condition,
        requiresLotTracking: payload.requires_lot_tracking,
        requiresExpiry: payload.requires_expiry,
        regulatoryReviewAt: payload.regulatory_review_at,
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    const response = { outcome: result.kind, version: "version" in result ? (result.version ?? null) : null };
    return result.kind === "SAVED" || result.kind === "IDEMPOTENT"
      ? succeeded(request, result.kind, response)
      : rejected(request, result.kind, response);
  }

  private registerPharmacyPrescription(
    request: Extract<CommercialRequest, { message_type: "pharmacy.prescription.register" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", prescription_id: null });
    }
    const sector = this.sectorDenial(LicenseSectorEntitlement.FARMACIA);
    if (sector) return rejected(request, sector, { outcome: "LICENSE_BLOCKED", prescription_id: null });
    const payload = request.payload;
    const result = this.commercial.registerPharmacyPrescription.execute(
      this.scope(), authenticated.identity.ssaSessionId, authenticated.snapshot, {
        productId: payload.product_id,
        prescribedQuantity: payload.prescribed_quantity,
        prescribedAt: payload.prescribed_at,
        expiresAt: payload.expires_at,
        issuerProfessionalId: payload.issuer_professional_id,
        issuerName: payload.issuer_name,
        patientReference: payload.patient_reference,
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    const response = {
      outcome: result.kind,
      prescription_id: "prescriptionId" in result ? result.prescriptionId : null,
    };
    return result.kind === "REGISTERED" || result.kind === "IDEMPOTENT"
      ? succeeded(request, result.kind, response)
      : rejected(request, result.kind, response);
  }

  private registerPharmacyTechnicalReceipt(
    request: Extract<CommercialRequest, { message_type: "pharmacy.technical_receipt.register" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", receipt_id: null });
    }
    const sector = this.sectorDenial(LicenseSectorEntitlement.FARMACIA);
    if (sector) return rejected(request, sector, { outcome: "LICENSE_BLOCKED", receipt_id: null });
    const payload = request.payload;
    const result = this.commercial.registerPharmacyTechnicalReceipt.execute(
      this.scope(), authenticated.identity.ssaSessionId, authenticated.snapshot, {
        presentationId: payload.presentation_id,
        lotId: payload.lot_id,
        sanitaryRegistration: payload.sanitary_registration,
        batchCode: payload.batch_code,
        expiryDate: payload.expiry_date,
        quantity: payload.quantity,
        storageCondition: payload.storage_condition,
        inspectionResult: payload.inspection_result,
        observations: payload.observations,
        inventoryMovementId: payload.inventory_movement_id,
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    const response = {
      outcome: result.kind,
      receipt_id: "receiptId" in result ? result.receiptId : null,
    };
    return result.kind === "RECORDED" || result.kind === "IDEMPOTENT"
      ? succeeded(request, result.kind, response)
      : rejected(request, result.kind, response);
  }

  private registerPharmacySanitaryAlert(
    request: Extract<CommercialRequest, { message_type: "pharmacy.sanitary_alert.register" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", alert_id: null });
    }
    const sector = this.sectorDenial(LicenseSectorEntitlement.FARMACIA);
    if (sector) return rejected(request, sector, { outcome: "LICENSE_BLOCKED", alert_id: null });
    const payload = request.payload;
    const result = this.commercial.registerPharmacySanitaryAlert.execute(
      this.scope(), authenticated.identity.ssaSessionId, authenticated.snapshot, {
        sourceKind: payload.source_kind,
        sourceReference: payload.source_reference,
        productId: payload.product_id,
        lotId: payload.lot_id,
        actionCode: payload.action_code,
        evidenceNote: payload.evidence_note,
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    const response = {
      outcome: result.kind,
      alert_id: "alertId" in result ? result.alertId : null,
    };
    return result.kind === "RECORDED" || result.kind === "IDEMPOTENT"
      ? succeeded(request, result.kind, response)
      : rejected(request, result.kind, response);
  }

  private createBakeryRecipeDraft(
    request: Extract<CommercialRequest, { message_type: "bakery.recipe.draft.create" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED", recipe_id: null, version: null, recipe_family_id: null,
      });
    }
    const sector = this.sectorDenial(LicenseSectorEntitlement.PASTELERIA);
    if (sector) {
      return rejected(request, sector, {
        outcome: "LICENSE_BLOCKED", recipe_id: null, version: null, recipe_family_id: null,
      });
    }
    const payload = request.payload;
    const result = this.commercial.createBakeryRecipeDraft.execute(
      this.scope(), authenticated.identity.ssaSessionId, authenticated.snapshot, {
        recipeFamilyId: payload.recipe_family_id,
        name: payload.name,
        finishedProductId: payload.finished_product_id,
        finishedPresentationId: payload.finished_presentation_id,
        baseBatchQuantity: payload.base_batch_quantity,
        expectedYieldQuantity: payload.expected_yield_quantity,
        expectedShrinkageQuantity: payload.expected_shrinkage_quantity,
        canonicalMassUnit: payload.canonical_mass_unit,
        instructions: payload.instructions,
        lines: payload.lines.map((line) => ({
          ingredientProductId: line.ingredient_product_id,
          ingredientPresentationId: line.ingredient_presentation_id,
          quantity: line.quantity,
          unitCode: line.unit_code,
          massQuantity: line.mass_quantity,
        })),
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    const response = {
      outcome: result.kind,
      recipe_id: "recipeId" in result ? result.recipeId : null,
      version: "version" in result ? result.version : null,
      recipe_family_id: "recipeFamilyId" in result ? result.recipeFamilyId : null,
    };
    return result.kind === "CREATED" || result.kind === "IDEMPOTENT"
      ? succeeded(request, result.kind, response)
      : rejected(request, result.kind, response);
  }

  private approveBakeryRecipe(
    request: Extract<CommercialRequest, { message_type: "bakery.recipe.approve" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED", recipe_id: null, version: null,
      });
    }
    const sector = this.sectorDenial(LicenseSectorEntitlement.PASTELERIA);
    if (sector) {
      return rejected(request, sector, {
        outcome: "LICENSE_BLOCKED", recipe_id: null, version: null,
      });
    }
    const result = this.commercial.approveBakeryRecipe.execute(
      this.scope(), authenticated.identity.ssaSessionId, authenticated.snapshot, {
        recipeId: request.payload.recipe_id,
        expectedVersion: request.payload.expected_version,
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    const response = {
      outcome: result.kind,
      recipe_id: "recipeId" in result ? result.recipeId : null,
      version: "version" in result ? result.version : null,
    };
    return result.kind === "APPROVED" || result.kind === "IDEMPOTENT"
      ? succeeded(request, result.kind, response)
      : rejected(request, result.kind, response);
  }

  private createBakeryProductionOrder(
    request: Extract<CommercialRequest, { message_type: "bakery.production.order.create" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED", order_id: null, recipe_version: null,
      });
    }
    const sector = this.sectorDenial(LicenseSectorEntitlement.PASTELERIA);
    if (sector) {
      return rejected(request, sector, {
        outcome: "LICENSE_BLOCKED", order_id: null, recipe_version: null,
      });
    }
    const result = this.commercial.createBakeryProductionOrder.execute(
      this.scope(), authenticated.identity.ssaSessionId, authenticated.snapshot, {
        recipeId: request.payload.recipe_id,
        plannedQuantity: request.payload.planned_quantity,
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    const response = {
      outcome: result.kind,
      order_id: "orderId" in result ? result.orderId : null,
      recipe_version: "recipeVersion" in result ? result.recipeVersion : null,
    };
    return result.kind === "CREATED" || result.kind === "IDEMPOTENT"
      ? succeeded(request, result.kind, response)
      : rejected(request, result.kind, response);
  }

  private planBakeryProductionOrder(
    request: Extract<CommercialRequest, { message_type: "bakery.production.order.plan" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED", order_id: null, shortages: null,
      });
    }
    const sector = this.sectorDenial(LicenseSectorEntitlement.PASTELERIA);
    if (sector) {
      return rejected(request, sector, {
        outcome: "LICENSE_BLOCKED", order_id: null, shortages: null,
      });
    }
    const result = this.commercial.planBakeryProductionOrder.execute(
      this.scope(), authenticated.identity.ssaSessionId, authenticated.snapshot, {
        orderId: request.payload.order_id,
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    const response = {
      outcome: result.kind,
      order_id: "orderId" in result ? result.orderId : null,
      shortages: "shortages" in result
        ? result.shortages.map((line) => ({
          presentation_id: line.presentationId,
          required: line.required,
          available: line.available,
        }))
        : null,
    };
    return result.kind === "PLANNED"
      ? succeeded(request, result.kind, response)
      : rejected(request, result.kind, response);
  }

  private releaseBakeryFinishedLot(
    request: Extract<CommercialRequest, { message_type: "bakery.production.release" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED", lot_id: null,
      });
    }
    const sector = this.sectorDenial(LicenseSectorEntitlement.PASTELERIA);
    if (sector) {
      return rejected(request, sector, {
        outcome: "LICENSE_BLOCKED", lot_id: null,
      });
    }
    const result = this.commercial.releaseBakeryFinishedLot.execute(
      this.scope(), authenticated.identity.ssaSessionId, authenticated.snapshot, {
        orderId: request.payload.order_id,
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    const response = {
      outcome: result.kind,
      lot_id: "lotId" in result ? result.lotId : null,
    };
    return result.kind === "RELEASED" || result.kind === "IDEMPOTENT"
      ? succeeded(request, result.kind, response)
      : rejected(request, result.kind, response);
  }

  private authorizeBakeryProductionDeviation(
    request: Extract<CommercialRequest, { message_type: "bakery.production.deviation.authorize" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED", approval_ids: null,
      });
    }
    const sector = this.sectorDenial(LicenseSectorEntitlement.PASTELERIA);
    if (sector) {
      return rejected(request, sector, {
        outcome: "LICENSE_BLOCKED", approval_ids: null,
      });
    }
    const payload = request.payload;
    const result = this.commercial.authorizeBakeryProductionDeviation.execute(
      this.scope(), authenticated.identity.ssaSessionId, authenticated.snapshot, {
        orderId: payload.order_id,
        deviations: payload.deviations.map((line) => ({
          kind: line.kind,
          recipePresentationId: line.recipe_presentation_id,
          ingredientPresentationId: line.ingredient_presentation_id,
          approvedQuantity: line.approved_quantity,
          equivalenceBasis: line.equivalence_basis,
          reason: line.reason,
        })),
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
        ...(payload.expires_at !== undefined ? { expiresAtIso: payload.expires_at } : {}),
      },
    );
    const response = {
      outcome: result.kind,
      approval_ids: "approvalIds" in result ? result.approvalIds : null,
    };
    return result.kind === "AUTHORIZED" || result.kind === "IDEMPOTENT"
      ? succeeded(request, result.kind, response)
      : rejected(request, String(result.kind), response);
  }

  private confirmBakeryProduction(
    request: Extract<CommercialRequest, { message_type: "bakery.production.confirm" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED", order_id: null, transform_order_id: null, finished_lot_id: null,
        cost_status: null, total_production_cost: null, unit_cost: null, sellable: null,
      });
    }
    const sector = this.sectorDenial(LicenseSectorEntitlement.PASTELERIA);
    if (sector) {
      return rejected(request, sector, {
        outcome: "LICENSE_BLOCKED", order_id: null, transform_order_id: null, finished_lot_id: null,
        cost_status: null, total_production_cost: null, unit_cost: null, sellable: null,
      });
    }
    const payload = request.payload;
    const result = this.commercial.confirmBakeryProduction.execute(
      this.scope(), authenticated.identity.ssaSessionId, authenticated.snapshot, {
        orderId: payload.order_id,
        actualQuantity: payload.actual_quantity,
        actualNetMassQuantity: payload.actual_net_mass_quantity,
        shrinkageQuantity: payload.shrinkage_quantity,
        shrinkageReason: payload.shrinkage_reason,
        productionDate: payload.production_date,
        finishedBatchCode: payload.finished_batch_code,
        consumptions: payload.consumptions.map((line) => ({
          ingredientPresentationId: line.ingredient_presentation_id,
          lotId: line.lot_id,
          plannedQuantity: line.planned_quantity,
          actualQuantity: line.actual_quantity,
          massQuantity: line.mass_quantity,
          deviationKind: line.deviation_kind ?? null,
          deviationReason: line.deviation_reason ?? null,
        })),
        recipeDeviations: (payload.recipe_deviations ?? []).map((line) => ({
          kind: line.kind,
          recipePresentationId: line.recipe_presentation_id,
          ingredientPresentationId: line.ingredient_presentation_id,
          reason: line.reason,
          approvalId: line.approval_id,
        })),
        directCosts: payload.direct_costs.map((line) => ({
          costKind: line.cost_kind,
          amount: line.amount,
          sourceNote: line.source_note,
        })),
        shrinkageAttributions: payload.shrinkage_attributions.map((line) => ({
          presentationId: line.presentation_id,
          lotId: line.lot_id,
          quantity: line.quantity,
          massQuantity: line.mass_quantity,
        })),
        idempotencyKey: request.idempotency_key ?? "",
        correlationId: request.correlation_id,
        causationId: request.causation_id ?? null,
      },
    );
    const response = {
      outcome: result.kind,
      order_id: "orderId" in result ? result.orderId : null,
      transform_order_id: "transformOrderId" in result ? result.transformOrderId : null,
      finished_lot_id: "finishedLotId" in result ? result.finishedLotId : null,
      cost_status: "costStatus" in result ? result.costStatus : null,
      total_production_cost: "totalProductionCost" in result ? result.totalProductionCost : null,
      unit_cost: "unitCost" in result ? result.unitCost : null,
      sellable: "sellable" in result ? result.sellable : null,
    };
    return result.kind === "CONFIRMED" || result.kind === "IDEMPOTENT"
      ? succeeded(request, result.kind, response)
      : rejected(request, String(result.kind), response);
  }

  private getBakeryProductionTrace(
    request: Extract<CommercialRequest, { message_type: "bakery.production.trace.get" }>,
    connectionId: string,
  ): unknown {
    const authenticated = this.authenticate(connectionId);
    if ("rejection" in authenticated) {
      return rejected(request, authenticated.rejection, {
        outcome: "UNAUTHORIZED", order_id: null, recipe_id: null, recipe_version: null,
        transform_order_id: null, finished_lot_id: null, cost_status: null,
        total_production_cost: null, unit_cost: null, sources: null,
      });
    }
    const sector = this.sectorDenial(LicenseSectorEntitlement.PASTELERIA);
    if (sector) {
      return rejected(request, sector, {
        outcome: "LICENSE_BLOCKED", order_id: null, recipe_id: null, recipe_version: null,
        transform_order_id: null, finished_lot_id: null, cost_status: null,
        total_production_cost: null, unit_cost: null, sources: null,
      });
    }
    const result = this.commercial.getBakeryProductionTrace.execute(
      this.scope(), authenticated.snapshot, request.payload.order_id,
    );
    const response = {
      outcome: result.kind,
      order_id: "orderId" in result ? result.orderId : null,
      recipe_id: "recipeId" in result ? result.recipeId : null,
      recipe_version: "recipeVersion" in result ? result.recipeVersion : null,
      transform_order_id: "transformOrderId" in result ? result.transformOrderId : null,
      finished_lot_id: "finishedLotId" in result ? result.finishedLotId : null,
      cost_status: "costStatus" in result ? result.costStatus : null,
      total_production_cost: "totalProductionCost" in result ? result.totalProductionCost : null,
      unit_cost: "unitCost" in result ? result.unitCost : null,
      sources: "sources" in result ? result.sources : null,
    };
    return result.kind === "FOUND"
      ? succeeded(request, result.kind, response)
      : rejected(request, result.kind, response);
  }
}


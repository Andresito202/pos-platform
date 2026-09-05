import { randomUUID } from "node:crypto";
import type { ContractError, ErrorCategory, IpcRequest } from "@pos-platform/contracts";
import type { ServiceConfig } from "../config.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { boundIdentityFromClaims, type BoundSessionIdentity } from "../session/session-binding-registry.js";
import type { CommercialComponent } from "./commercial-component.js";

const RESULT_SCHEMA_VERSION = "1.0.0";

type CommercialRequest = Extract<
  IpcRequest,
  { message_type: "session.activate" | "session.recover" | "cash.shift.open" | "cash.shift.close" | "sale.create" }
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
  PRICE_NOT_FOUND: "NOT_FOUND",
  CURRENCY_MISMATCH: "VALIDATION",
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

  handle(request: CommercialRequest, connectionId: string): unknown {
    switch (request.message_type) {
      case "session.activate": return this.activate(request, connectionId);
      case "session.recover": return this.recover(request, connectionId);
      case "cash.shift.open": return this.openShift(request, connectionId);
      case "cash.shift.close": return this.closeShift(request, connectionId);
      case "sale.create": return this.createSale(request, connectionId);
    }
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
      return rejected(request, authenticated.rejection, { outcome: "UNAUTHORIZED", shift_id: null });
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
      return succeeded(request, result.kind, { outcome: result.kind, shift_id: result.shiftId });
    }
    return rejected(request, result.kind, { outcome: result.kind, shift_id: null });
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

import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../channel/canonical-json.js";
import type { DurableSyncStore, SyncScope } from "../sync/durable-sync-store.js";
import { bigIntToScale6, scale6ToBigInt } from "../money.js";

/**
 * Persistencia del crédito al cliente — `DEC-005`, `CUST-002`.
 *
 * Sostiene una sola idea: **la deuda es el libro**. No hay columna de saldo;
 * `outstandingBalance` suma `customers_credit_transactions` dentro de la
 * transacción que va a decidir, igual que la cobertura de una venta se
 * recomputa desde las imputaciones (`DEC-016` §5.5). Un saldo guardado y un
 * libro pueden discrepar, y cuando discrepan sobre dinero ajeno nadie sabe
 * cuál miente.
 *
 * Lo que este almacén **no** hace: no completa ventas, no imputa cobertura y
 * no escribe caja. La venta a crédito la sigue gobernando `SqlitePaymentStore`
 * —que es quien ya sabe completar— y este almacén sólo le presta el libro.
 */

const CREDIT_PAYLOAD_SCHEMA_VERSION = "1.0.0";

export interface CreditAccountView {
  readonly accountId: string;
  readonly customerId: string;
  readonly creditLimit: string;
  readonly outstandingBalance: string;
  readonly availableCredit: string;
  readonly currencyCode: string;
}

interface CommonInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export interface OpenCreditAccountInput extends CommonInput {
  readonly accountId: string;
  readonly customerId: string;
  readonly creditLimit: string;
  readonly currencyCode: string;
  readonly operationId: string;
}

export type OpenCreditAccountOutcome =
  | { readonly kind: "OPENED"; readonly accountId: string }
  | { readonly kind: "IDEMPOTENT"; readonly accountId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "CUSTOMER_NOT_FOUND" }
  | { readonly kind: "ACCOUNT_ALREADY_EXISTS"; readonly accountId: string };

export interface RegisterRepaymentInput extends CommonInput {
  readonly transactionId: string;
  readonly customerId: string;
  readonly amount: string;
  readonly currencyCode: string;
  /** Sólo `CASH` asienta en caja; el resto no toca el turno. */
  readonly method: "CASH" | "TRANSFER";
  /** Caja donde entra el efectivo. Obligatoria si `method` es `CASH`. */
  readonly cashRegisterId: string | null;
  readonly movementId: string;
  readonly businessDate: string;
  readonly operationId: string;
}

export type RegisterRepaymentOutcome =
  | {
      readonly kind: "RECORDED";
      readonly transactionId: string;
      readonly outstandingBalance: string;
      readonly availableCredit: string;
    }
  | { readonly kind: "IDEMPOTENT"; readonly transactionId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "CREDIT_ACCOUNT_NOT_FOUND" }
  | { readonly kind: "CURRENCY_MISMATCH" }
  /** Un abono mayor que la deuda crearía saldo a favor, fuera de este alcance. */
  | { readonly kind: "REPAYMENT_EXCEEDS_BALANCE"; readonly outstandingBalance: string }
  | { readonly kind: "CASH_SHIFT_MISSING" }
  | { readonly kind: "CASH_SHIFT_NOT_OPEN" };

/** Asiento de caja para un abono en efectivo — el mismo puerto, otro motivo. */
export interface CreditCashPort {
  appendCreditRepayment(input: {
    readonly scope: SyncScope;
    readonly movementId: string;
    readonly cashShiftId: string;
    readonly amount: string;
    readonly currencyCode: string;
    readonly operatorUserId: string;
    readonly businessDate: string;
    readonly idempotencyKey: string;
    readonly requestChecksum: string;
    readonly correlationId: string;
    readonly reasonCode: string;
  }): { readonly kind: "POSTED"; readonly shiftSequence: number }
    | { readonly kind: "SHIFT_NOT_FOUND" }
    | { readonly kind: "SHIFT_NOT_OPEN" }
    | { readonly kind: "CURRENCY_MISMATCH" };

  /**
   * Turno activo de la **caja** indicada. Es el mismo selector que usa
   * `sale.create`: `DEC-012` §25.2 garantiza como máximo uno por
   * `(tenant, sucursal, caja)` y §25.3 niega que el dispositivo tenga nada que
   * decir. No se inventa una resolución por sucursal: con dos cajas abiertas
   * sería ambigua.
   */
  findActiveShiftForRegister(
    scope: SyncScope, cashRegisterId: string,
  ): { readonly shiftId: string; readonly status: "OPEN" | "CLOSING" } | null;
}

class CreditRollback<T> extends Error {
  constructor(readonly outcome: T) {
    super("credit operation rejected after write; transaction rolled back");
  }
}

function runWithRollback<T>(transaction: () => T): T {
  try {
    return transaction();
  } catch (error) {
    if (error instanceof CreditRollback) return error.outcome as T;
    throw error;
  }
}

export class SqliteCreditStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly durableSync: DurableSyncStore,
    private readonly cashPort: CreditCashPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ── Lecturas ────────────────────────────────────────────────────────────────

  /**
   * La cuenta de un cliente, con su saldo derivado.
   *
   * Acotada por `tenant_id`: una cuenta de otro comercio no resuelve aunque el
   * llamador acierte el identificador del cliente.
   */
  findAccountByCustomer(scope: SyncScope, customerId: string): CreditAccountView | null {
    const row = this.database.native.prepare(
      `SELECT id, customer_id, credit_limit, currency_code
       FROM customers_credit_accounts WHERE tenant_id=? AND customer_id=?`,
    ).get(scope.tenantId, customerId) as
      | { id: string; customer_id: string; credit_limit: string; currency_code: string }
      | undefined;

    if (row === undefined) return null;
    return this.viewOf(scope, row);
  }

  /**
   * Saldo pendiente: `Σ(INCREASE) − Σ(DECREASE)`.
   *
   * Nunca lo aporta el llamador. Se recomputa aquí, y quien decida sobre cupo
   * debe hacerlo dentro de la transacción que va a escribir — entre leer y
   * escribir fuera de ella cabe otra venta.
   */
  outstandingBalance(scope: SyncScope, accountId: string): bigint {
    const rows = this.database.native.prepare(
      `SELECT direction, amount FROM customers_credit_transactions
       WHERE tenant_id=? AND credit_account_id=?`,
    ).all(scope.tenantId, accountId) as Array<{ direction: string; amount: string }>;

    return rows.reduce(
      (total, row) => row.direction === "INCREASE"
        ? total + scale6ToBigInt(row.amount)
        : total - scale6ToBigInt(row.amount),
      0n,
    );
  }

  private viewOf(
    scope: SyncScope,
    row: { id: string; customer_id: string; credit_limit: string; currency_code: string },
  ): CreditAccountView {
    const outstanding = this.outstandingBalance(scope, row.id);
    const limit = scale6ToBigInt(row.credit_limit);
    // El disponible no baja de cero aunque un ajuste futuro dejara la deuda por
    // encima del cupo: «disponible negativo» no es una cantidad que nadie pueda
    // usar, y mostrarla invitaría a restarla.
    const available = limit > outstanding ? limit - outstanding : 0n;

    return {
      accountId: row.id,
      customerId: row.customer_id,
      creditLimit: row.credit_limit,
      outstandingBalance: bigIntToScale6(outstanding),
      availableCredit: bigIntToScale6(available),
      currencyCode: row.currency_code,
    };
  }

  // ── Escritura auxiliar ──────────────────────────────────────────────────────

  private operationIdempotency(idempotencyKey: string, checksum: string): "NEW" | "REPLAY" | "CONFLICT" {
    const row = this.database.native.prepare(
      "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
    ).get(idempotencyKey) as { payload_checksum: string } | undefined;

    if (row === undefined) return "NEW";
    return row.payload_checksum === checksum ? "REPLAY" : "CONFLICT";
  }

  private insertOperation(
    operationId: string, idempotencyKey: string, checksum: string, resultCode: string, nowIso: string,
  ): void {
    this.database.native.prepare(
      `INSERT INTO runtime_operations(operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
       VALUES (?,?,?,'SUCCEEDED',?,?,?)`,
    ).run(operationId, idempotencyKey, checksum, resultCode, nowIso, nowIso);
  }

  private writeAudit(
    input: CommonInput, actionCode: string, resourceType: string, resourceId: string,
    details: Record<string, unknown>, nowIso: string,
  ): void {
    this.database.native.prepare(
      `INSERT INTO local_operation_audit(
        tenant_id, company_id, branch_id, device_id,
        actor_type, actor_id, session_id,
        action_code, resource_type, resource_id,
        correlation_id, causation_id, reason_code, details_json, created_at
      ) VALUES (?,?,?,?,'USER',?,?,?,?,?,?,?,NULL,?,?)`,
    ).run(
      input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.scope.deviceId,
      input.operatorUserId, input.sessionId,
      actionCode, resourceType, resourceId,
      input.correlationId, input.causationId,
      canonicalJson(details), nowIso,
    );
  }

  private enqueue(
    input: CommonInput, operationId: string, aggregateType: string, aggregateId: string,
    operationType: string, payload: Record<string, unknown>, nowIso: string,
  ): void {
    const nextSequence = (this.database.native.prepare(
      `SELECT COALESCE(MAX(local_sequence), 0) + 1 AS next_sequence FROM local_sync_outbox
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?`,
    ).get(
      input.scope.tenantId, input.scope.companyId, input.scope.branchId,
      input.scope.deviceId, input.scope.installationId,
    ) as { next_sequence: number }).next_sequence;

    this.durableSync.enqueue({
      operation_id: operationId,
      tenant_id: input.scope.tenantId,
      company_id: input.scope.companyId,
      branch_id: input.scope.branchId,
      device_id: input.scope.deviceId,
      installation_id: input.scope.installationId,
      session_id: input.sessionId,
      actor_id: input.operatorUserId,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      operation_type: operationType,
      authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
      local_sequence: nextSequence,
      idempotency_key: input.idempotencyKey,
      expected_version: null,
      payload_schema_version: CREDIT_PAYLOAD_SCHEMA_VERSION,
      payload,
      payload_checksum: input.requestChecksum,
      causation_id: input.causationId,
      correlation_id: input.correlationId,
      occurred_at_local: nowIso,
      recorded_at_local: nowIso,
    });
  }

  // ── Escrituras ──────────────────────────────────────────────────────────────

  /**
   * Abre la cuenta de crédito de un cliente.
   *
   * El cupo es **explícito y obligatorio**: no hay cupo por defecto del
   * comercio. No tener cuenta es no tener crédito, y ése es el único
   * interruptor que existe en este alcance.
   */
  openAccount(input: OpenCreditAccountInput): OpenCreditAccountOutcome {
    const nowIso = this.now().toISOString();

    return runWithRollback(this.database.native.transaction((): OpenCreditAccountOutcome => {
      const operation = this.operationIdempotency(input.idempotencyKey, input.requestChecksum);
      if (operation === "CONFLICT") return { kind: "IDEMPOTENCY_CONFLICT" };

      const existing = this.database.native.prepare(
        "SELECT id FROM customers_credit_accounts WHERE tenant_id=? AND customer_id=?",
      ).get(input.scope.tenantId, input.customerId) as { id: string } | undefined;

      if (operation === "REPLAY") {
        if (existing === undefined) return { kind: "IDEMPOTENCY_CONFLICT" };
        return { kind: "IDEMPOTENT", accountId: existing.id };
      }
      if (existing !== undefined) return { kind: "ACCOUNT_ALREADY_EXISTS", accountId: existing.id };

      // El cliente se comprueba bajo el tenant verificado. `MIGRATION_020`
      // además lo sostiene con FK compuesta, así que esto no es la única
      // guarda: es la que produce un resultado de contrato en vez de una
      // excepción de SQLite.
      const customer = this.database.native.prepare(
        "SELECT 1 AS found FROM customers_customers WHERE tenant_id=? AND id=?",
      ).get(input.scope.tenantId, input.customerId) as { found: number } | undefined;
      if (customer === undefined) return { kind: "CUSTOMER_NOT_FOUND" };

      this.insertOperation(
        input.operationId, input.idempotencyKey, input.requestChecksum, "CREDIT_ACCOUNT_OPENED", nowIso,
      );

      this.database.native.prepare(
        `INSERT INTO customers_credit_accounts(
          id, tenant_id, company_id, customer_id, credit_limit, currency_code,
          opened_by_actor_type, opened_by_actor_id, origin_device_id, installation_id,
          idempotency_key, request_checksum, correlation_id, causation_id,
          version, created_at, updated_at, server_recorded_at
        ) VALUES (?,?,?,?,?,?,'USER',?,?,?,?,?,?,?,1,?,?,NULL)`,
      ).run(
        input.accountId, input.scope.tenantId, input.scope.companyId, input.customerId,
        input.creditLimit, input.currencyCode,
        input.operatorUserId, input.scope.deviceId, input.scope.installationId,
        input.idempotencyKey, input.requestChecksum, input.correlationId, input.causationId,
        nowIso, nowIso,
      );

      const details = {
        account_id: input.accountId,
        credit_limit: input.creditLimit,
        currency_code: input.currencyCode,
        customer_id: input.customerId,
      };
      this.writeAudit(input, "CREDIT_ACCOUNT_OPENED", "CREDIT_ACCOUNT", input.accountId, details, nowIso);
      this.enqueue(
        input, input.operationId, "CREDIT_ACCOUNT", input.accountId,
        "CREDIT_ACCOUNT_OPENED", details, nowIso,
      );

      return { kind: "OPENED", accountId: input.accountId };
    }));
  }

  /**
   * Asienta un abono: `CUSTOMER_PAYMENT` / `DECREASE`.
   *
   * **Un abono no es el pago de una venta.** No imputa en
   * `payments_payment_allocations` y no crea `Payment`: paga una obligación,
   * no un cobro pendiente — y de hecho no podría, porque
   * `collection_subject_type` sólo admite `'SALE'`. Reduce el saldo y, con
   * ello, libera cupo.
   *
   * En efectivo asienta `CASH_PAYMENT` por el puerto de caja, con turno
   * abierto, como cualquier otro dinero que entra al cajón.
   */
  registerRepayment(input: RegisterRepaymentInput): RegisterRepaymentOutcome {
    const nowIso = this.now().toISOString();

    return runWithRollback(this.database.native.transaction((): RegisterRepaymentOutcome => {
      const operation = this.operationIdempotency(input.idempotencyKey, input.requestChecksum);
      if (operation === "CONFLICT") return { kind: "IDEMPOTENCY_CONFLICT" };

      const account = this.database.native.prepare(
        `SELECT id, customer_id, credit_limit, currency_code
         FROM customers_credit_accounts WHERE tenant_id=? AND customer_id=?`,
      ).get(input.scope.tenantId, input.customerId) as
        | { id: string; customer_id: string; credit_limit: string; currency_code: string }
        | undefined;

      if (operation === "REPLAY") {
        const previous = this.database.native.prepare(
          `SELECT id FROM customers_credit_transactions
           WHERE tenant_id=? AND origin_device_id=? AND idempotency_key=?`,
        ).get(input.scope.tenantId, input.scope.deviceId, input.idempotencyKey) as
          | { id: string } | undefined;
        if (previous === undefined) return { kind: "IDEMPOTENCY_CONFLICT" };
        return { kind: "IDEMPOTENT", transactionId: previous.id };
      }

      if (account === undefined) return { kind: "CREDIT_ACCOUNT_NOT_FOUND" };
      if (account.currency_code !== input.currencyCode) return { kind: "CURRENCY_MISMATCH" };

      // El saldo se recomputa aquí dentro; el llamador no lo aporta.
      const outstanding = this.outstandingBalance(input.scope, account.id);
      const amount = scale6ToBigInt(input.amount);
      if (amount > outstanding) {
        return { kind: "REPAYMENT_EXCEEDS_BALANCE", outstandingBalance: bigIntToScale6(outstanding) };
      }

      // El efectivo exige turno **antes** de escribir nada. Un turno en
      // `CLOSING` se resuelve igual y lo rechaza el asiento con
      // `CASH_SHIFT_NOT_OPEN`: decir «no hay turno» mientras se cuadra sería
      // un diagnóstico falso, exactamente como en el cobro de una venta.
      let cashShiftId: string | null = null;
      if (input.method === "CASH") {
        if (input.cashRegisterId === null) return { kind: "CASH_SHIFT_MISSING" };
        const shift = this.cashPort.findActiveShiftForRegister(input.scope, input.cashRegisterId);
        if (shift === null) return { kind: "CASH_SHIFT_MISSING" };
        cashShiftId = shift.shiftId;
      }

      this.insertOperation(
        input.operationId, input.idempotencyKey, input.requestChecksum, "CREDIT_PAYMENT_RECORDED", nowIso,
      );

      this.appendTransaction({
        scope: input.scope,
        transactionId: input.transactionId,
        accountId: account.id,
        transactionType: "CUSTOMER_PAYMENT",
        direction: "DECREASE",
        amount: input.amount,
        currencyCode: input.currencyCode,
        saleId: null,
        paymentId: null,
        actorId: input.operatorUserId,
        idempotencyKey: input.idempotencyKey,
        requestChecksum: input.requestChecksum,
        correlationId: input.correlationId,
        causationId: input.causationId,
        nowIso,
      });

      if (cashShiftId !== null) {
        const posted = this.cashPort.appendCreditRepayment({
          scope: input.scope,
          movementId: input.movementId,
          cashShiftId,
          amount: input.amount,
          currencyCode: input.currencyCode,
          operatorUserId: input.operatorUserId,
          businessDate: input.businessDate,
          idempotencyKey: `credit_repayment:${input.idempotencyKey}`,
          requestChecksum: input.requestChecksum,
          correlationId: input.correlationId,
          reasonCode: "CREDIT_REPAYMENT",
        });

        // Se lanza, no se retorna: ya hay filas escritas y sólo una excepción
        // revierte la transacción.
        if (posted.kind === "SHIFT_NOT_OPEN") {
          throw new CreditRollback<RegisterRepaymentOutcome>({ kind: "CASH_SHIFT_NOT_OPEN" });
        }
        if (posted.kind === "SHIFT_NOT_FOUND") {
          throw new CreditRollback<RegisterRepaymentOutcome>({ kind: "CASH_SHIFT_MISSING" });
        }
        if (posted.kind === "CURRENCY_MISMATCH") {
          throw new CreditRollback<RegisterRepaymentOutcome>({ kind: "CURRENCY_MISMATCH" });
        }
      }

      const remaining = outstanding - amount;
      const limit = scale6ToBigInt(account.credit_limit);
      const details = {
        account_id: account.id,
        amount: input.amount,
        customer_id: input.customerId,
        method: input.method,
        outstanding_balance: bigIntToScale6(remaining),
        transaction_id: input.transactionId,
      };
      this.writeAudit(input, "CREDIT_PAYMENT_RECORDED", "CREDIT_ACCOUNT", account.id, details, nowIso);
      this.enqueue(
        input, input.operationId, "CREDIT_ACCOUNT", account.id,
        "CREDIT_PAYMENT_RECORDED", details, nowIso,
      );

      return {
        kind: "RECORDED",
        transactionId: input.transactionId,
        outstandingBalance: bigIntToScale6(remaining),
        availableCredit: bigIntToScale6(limit > remaining ? limit - remaining : 0n),
      };
    }));
  }

  /**
   * Asienta un movimiento del libro. **No abre transacción**: la obligación de
   * una venta a crédito y la confirmación de esa venta son un solo hecho, igual
   * que el asiento de caja y el pago (`DEC-016` §5.3). Quien llama aporta la
   * transacción.
   *
   * Es el único punto de escritura del libro, y sólo inserta: la tabla es
   * append-only por contrato.
   */
  appendTransaction(input: {
    readonly scope: SyncScope;
    readonly transactionId: string;
    readonly accountId: string;
    readonly transactionType: "SALE_CREDIT" | "CUSTOMER_PAYMENT";
    readonly direction: "INCREASE" | "DECREASE";
    readonly amount: string;
    readonly currencyCode: string;
    readonly saleId: string | null;
    readonly paymentId: string | null;
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly requestChecksum: string;
    readonly correlationId: string;
    readonly causationId: string | null;
    readonly nowIso: string;
  }): void {
    const nextSequence = (this.database.native.prepare(
      `SELECT COALESCE(MAX(account_sequence), 0) + 1 AS next_sequence
       FROM customers_credit_transactions WHERE tenant_id=? AND credit_account_id=?`,
    ).get(input.scope.tenantId, input.accountId) as { next_sequence: number }).next_sequence;

    this.database.native.prepare(
      `INSERT INTO customers_credit_transactions(
        id, tenant_id, company_id, branch_id, credit_account_id, account_sequence,
        transaction_type, direction, amount, currency_code,
        sale_id, payment_id, actor_type, actor_id,
        origin_device_id, installation_id,
        idempotency_key, request_checksum, correlation_id, causation_id,
        version, created_at, server_recorded_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'USER',?,?,?,?,?,?,?,1,?,NULL)`,
    ).run(
      input.transactionId, input.scope.tenantId, input.scope.companyId, input.scope.branchId,
      input.accountId, nextSequence,
      input.transactionType, input.direction, input.amount, input.currencyCode,
      input.saleId, input.paymentId, input.actorId,
      input.scope.deviceId, input.scope.installationId,
      input.idempotencyKey, input.requestChecksum, input.correlationId, input.causationId,
      input.nowIso,
    );
  }
}

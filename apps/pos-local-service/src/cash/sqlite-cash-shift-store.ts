import { createHash } from "node:crypto";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../channel/canonical-json.js";
import type { SyncScope, DurableSyncStore } from "../sync/durable-sync-store.js";
import { bigIntToScale6, scale6ToBigInt } from "../money.js";

const CASH_SHIFT_PAYLOAD_SCHEMA_VERSION = "1.0.0";

// ── Input / Output types ──────────────────────────────────────────────────────

export interface OpenShiftInput {
  readonly shiftId: string;
  readonly movementId: string;
  readonly operationId: string;
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly cashRegisterId: string;
  readonly currencyCode: string;
  readonly openingAmount: string;
  readonly businessDate: string;
  readonly timezoneId: string;
  readonly utcOffsetMinutes: number;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly cashRegisterProjectionSequence: number;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type OpenShiftOutcome =
  | { readonly kind: "OPENED"; readonly shiftId: string }
  | { readonly kind: "IDEMPOTENT"; readonly shiftId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "INCOMPATIBLE_SHIFT" };

export interface CloseShiftInput {
  readonly operationId: string;
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly shiftId: string;
  readonly countedAmount: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type CloseShiftOutcome =
  | {
      readonly kind: "CLOSED";
      readonly shiftId: string;
      readonly expectedCash: string;
      readonly countedAmount: string;
      readonly differenceAmount: string;
    }
  | { readonly kind: "IDEMPOTENT"; readonly shiftId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "ALREADY_CLOSED" }
  | { readonly kind: "VERSION_CONFLICT" };

// ── Internal row types ────────────────────────────────────────────────────────

interface ShiftIdempotencyRow {
  id: string;
  opening_request_checksum: string;
}

interface ShiftRow {
  id: string;
  status: string;
  version: number;
  cash_register_id: string;
  currency_code: string;
  closing_idempotency_key: string | null;
  closing_request_checksum: string | null;
}

interface MovementAmountRow {
  direction: string;
  amount: string;
}

interface NextSequenceRow {
  next_sequence: number;
}

/**
 * Entrada y resultado de `appendCashSale` — `DEC-016` §10.
 *
 * Coinciden estructuralmente con `CashPort` de `payments/cash-port.ts`, de modo
 * que este almacén satisface el puerto **sin que `cash/` importe de
 * `payments/`**: la dependencia apunta en un solo sentido.
 */
export interface AppendCashSaleInput {
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
}

export type AppendCashSaleOutcome =
  | { readonly kind: "POSTED"; readonly shiftSequence: number }
  | { readonly kind: "SHIFT_NOT_FOUND" }
  | { readonly kind: "SHIFT_NOT_OPEN" }
  | { readonly kind: "CURRENCY_MISMATCH" };

/**
 * Turno abierto de **este dispositivo**, para que la venta nazca vinculada a él.
 *
 * `sales_sales` admite `cash_register_id` y `cash_shift_id` nulos —su `CHECK`
 * exige que viajen juntos, no que existan—, pero `CreateSaleUseCase` los
 * escribía **siempre** `NULL`. Con un turno abierto, la venta quedaba igualmente
 * sin turno y `payment.register.cash` la rechazaba con `CASH_SHIFT_MISSING`:
 * una venta creada por el camino canónico **no se podía cobrar en efectivo**.
 *
 * Nadie lo detectó porque ninguna prueba encadenaba una venta real con un cobro:
 * `payment.test.ts` sembraba la venta con turno a mano y `sale.test.ts` nunca
 * cobraba. Las dos mitades se probaron contra fixtures incompatibles entre sí.
 *
 * La resolución es **por dispositivo**, no por caja: la venta no aporta caja y
 * el servicio local no la declara en su configuración. Un dispositivo es una
 * caja en la práctica, pero `open()` sólo impide un segundo turno en la **misma**
 * caja, así que dos turnos abiertos por el mismo dispositivo son alcanzables.
 *
 * Sólo `OPEN`: un turno en `CLOSING` se está arqueando y no admite venta nueva.
 */
export interface OpenShiftBinding {
  readonly shiftId: string;
  readonly cashRegisterId: string;
}

export type FindOpenShiftOutcome =
  | { readonly kind: "FOUND"; readonly binding: OpenShiftBinding }
  | { readonly kind: "NONE" }
  | { readonly kind: "AMBIGUOUS"; readonly count: number };

// ── Store ─────────────────────────────────────────────────────────────────────

export class SqliteCashShiftStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly durableSync: DurableSyncStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Localiza el turno abierto por este dispositivo.
   *
   * `AMBIGUOUS` no se resuelve adivinando: vincular la venta a la caja
   * equivocada imputaría el efectivo a un arqueo ajeno y nadie lo notaría. Sin
   * vínculo, el cobro en efectivo falla de forma visible y recuperable, que es
   * el modo de fallo correcto entre los dos.
   */
  findOpenShiftForDevice(scope: SyncScope): FindOpenShiftOutcome {
    const rows = this.database.native.prepare(
      `SELECT id, cash_register_id FROM cash_shift
       WHERE tenant_id=? AND branch_id=? AND origin_device_id=? AND status='OPEN'`,
    ).all(
      scope.tenantId, scope.branchId, scope.deviceId,
    ) as Array<{ id: string; cash_register_id: string }>;

    const first = rows[0];
    if (first === undefined) return { kind: "NONE" };
    if (rows.length > 1) return { kind: "AMBIGUOUS", count: rows.length };
    return { kind: "FOUND", binding: { shiftId: first.id, cashRegisterId: first.cash_register_id } };
  }

  open(input: OpenShiftInput): OpenShiftOutcome {
    const nowIso = this.now().toISOString();
    const movementIdempotencyKey = `opening_float:${input.idempotencyKey}`;
    const movementChecksum = createHash("sha256")
      .update(canonicalJson({
        idempotency_key: movementIdempotencyKey,
        movement_type: "OPENING_FLOAT",
        shift_id: input.shiftId,
      }))
      .digest("hex");

    const transaction = this.database.native.transaction((): OpenShiftOutcome => {
      // 1. Idempotencia: (tenant_id, origin_device_id, opening_idempotency_key)
      const existing = this.database.native.prepare(
        `SELECT id, opening_request_checksum
         FROM cash_shift
         WHERE tenant_id=? AND origin_device_id=? AND opening_idempotency_key=?`,
      ).get(
        input.scope.tenantId,
        input.scope.deviceId,
        input.idempotencyKey,
      ) as ShiftIdempotencyRow | undefined;

      if (existing) {
        if (existing.opening_request_checksum !== input.requestChecksum) {
          return { kind: "IDEMPOTENCY_CONFLICT" };
        }
        return { kind: "IDEMPOTENT", shiftId: existing.id };
      }

      // 2. Turno incompatible: OPEN o CLOSING en la misma caja
      //    La verificación previa no sustituye la restricción del índice único.
      const incompatible = this.database.native.prepare(
        `SELECT 1 FROM cash_shift
         WHERE tenant_id=? AND branch_id=? AND cash_register_id=?
           AND status IN ('OPEN','CLOSING')`,
      ).get(
        input.scope.tenantId,
        input.scope.branchId,
        input.cashRegisterId,
      );

      if (incompatible) return { kind: "INCOMPATIBLE_SHIFT" };

      // 3. runtime_operations
      this.database.native.prepare(
        `INSERT INTO runtime_operations(operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
         VALUES (?,?,?,'SUCCEEDED','CASH_SHIFT_OPENED',?,?)`,
      ).run(input.operationId, input.idempotencyKey, input.requestChecksum, nowIso, nowIso);

      // 4. cash_shift (status = OPEN, version = 1, last_movement_sequence = 1)
      this.database.native.prepare(
        `INSERT INTO cash_shift(
          id, tenant_id, company_id, branch_id, cash_register_id, origin_device_id,
          opened_by_actor_type, opened_by_actor_id, opened_at,
          business_date, timezone_id, utc_offset_minutes, currency_code,
          status,
          closed_by_actor_type, closed_by_actor_id, closed_at,
          opening_idempotency_key, opening_request_checksum,
          closing_idempotency_key, closing_request_checksum,
          cash_register_projection_sequence, last_movement_sequence,
          version, created_at, server_recorded_at
        ) VALUES (
          ?,?,?,?,?,?,
          'USER',?,?,
          ?,?,?,?,
          'OPEN',
          NULL,NULL,NULL,
          ?,?,
          NULL,NULL,
          ?,1,
          1,?,NULL
        )`,
      ).run(
        input.shiftId,
        input.scope.tenantId,
        input.scope.companyId,
        input.scope.branchId,
        input.cashRegisterId,
        input.scope.deviceId,
        input.operatorUserId,
        nowIso,
        input.businessDate,
        input.timezoneId,
        input.utcOffsetMinutes,
        input.currencyCode,
        input.idempotencyKey,
        input.requestChecksum,
        input.cashRegisterProjectionSequence,
        nowIso,
      );

      // 5. OPENING_FLOAT: shift_sequence = 1, status = POSTED, direction = IN
      this.database.native.prepare(
        `INSERT INTO cash_movement(
          id, tenant_id, company_id, branch_id, cash_register_id, cash_shift_id,
          shift_sequence, movement_type, direction, amount, currency_code, status,
          original_cash_movement_id, reason_code, evidence_reference,
          actor_type, actor_id,
          approved_by_actor_type, approved_by_actor_id,
          business_date, occurred_at, device_reported_at, origin_device_id,
          idempotency_key, request_checksum, correlation_id,
          version, created_at, server_recorded_at
        ) VALUES (
          ?,?,?,?,?,?,
          1,'OPENING_FLOAT','IN',?,?,'POSTED',
          NULL,'OPENING_FLOAT',NULL,
          'USER',?,
          NULL,NULL,
          ?,?,?,?,
          ?,?,?,
          1,?,NULL
        )`,
      ).run(
        input.movementId,
        input.scope.tenantId,
        input.scope.companyId,
        input.scope.branchId,
        input.cashRegisterId,
        input.shiftId,
        input.openingAmount,
        input.currencyCode,
        input.operatorUserId,
        input.businessDate,
        nowIso,
        nowIso,
        input.scope.deviceId,
        movementIdempotencyKey,
        movementChecksum,
        input.correlationId,
        nowIso,
      );

      // 6. Auditoría
      this.database.native.prepare(
        `INSERT INTO local_operation_audit(
          tenant_id, company_id, branch_id, device_id,
          actor_type, actor_id, session_id,
          action_code, resource_type, resource_id,
          correlation_id, causation_id, reason_code, details_json, created_at
        ) VALUES (?,?,?,?,'USER',?,?,'CASH_SHIFT_OPENED','CASH_SHIFT',?,?,?,NULL,?,?)`,
      ).run(
        input.scope.tenantId,
        input.scope.companyId,
        input.scope.branchId,
        input.scope.deviceId,
        input.operatorUserId,
        input.sessionId,
        input.shiftId,
        input.correlationId,
        input.causationId,
        canonicalJson({
          cash_register_id: input.cashRegisterId,
          currency_code: input.currencyCode,
          opening_amount: input.openingAmount,
          shift_id: input.shiftId,
        }),
        nowIso,
      );

      // 7. Outbox
      const nextSeq = (this.database.native.prepare(
        `SELECT COALESCE(MAX(local_sequence), 0) + 1 AS next_sequence FROM local_sync_outbox
         WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?`,
      ).get(
        input.scope.tenantId,
        input.scope.companyId,
        input.scope.branchId,
        input.scope.deviceId,
        input.scope.installationId,
      ) as NextSequenceRow).next_sequence;

      this.durableSync.enqueue({
        operation_id: input.operationId,
        tenant_id: input.scope.tenantId,
        company_id: input.scope.companyId,
        branch_id: input.scope.branchId,
        device_id: input.scope.deviceId,
        installation_id: input.scope.installationId,
        session_id: input.sessionId,
        actor_id: input.operatorUserId,
        aggregate_type: "CASH_SHIFT",
        aggregate_id: input.shiftId,
        operation_type: "CASH_SHIFT_OPENED",
        authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
        local_sequence: nextSeq,
        idempotency_key: input.idempotencyKey,
        expected_version: null,
        payload_schema_version: CASH_SHIFT_PAYLOAD_SCHEMA_VERSION,
        payload: {
          business_date: input.businessDate,
          cash_register_id: input.cashRegisterId,
          currency_code: input.currencyCode,
          opening_amount: input.openingAmount,
          shift_id: input.shiftId,
        },
        payload_checksum: input.requestChecksum,
        causation_id: input.causationId,
        correlation_id: input.correlationId,
        occurred_at_local: nowIso,
        recorded_at_local: nowIso,
      });

      return { kind: "OPENED", shiftId: input.shiftId };
    });

    return transaction();
  }

  /**
   * Asienta un movimiento `CASH_SALE` en un turno abierto — `DEC-016` §10.4.
   *
   * Adición para Payment V1. **No altera la semántica de `BLOQUE 4D`**: no toca
   * `open()` ni `close()`, y produce exactamente el movimiento que `close()` ya
   * sabe plegar (`IN` + `POSTED`).
   *
   * `shift_sequence` se asigna aquí porque es propiedad de Cash; la monotonía la
   * respalda además `cash_movement_shift_sequence_idx`.
   *
   * **No abre transacción propia**: debe invocarse dentro de la del llamador,
   * para que asiento de caja y confirmación de pago sean un solo hecho.
   *
   * `version` del turno **no** se incrementa: esa columna gobierna las
   * transiciones de ciclo de vida (`OPEN → CLOSING → CLOSED`) que `close()`
   * verifica con `expectedVersion`. Incrementarla en cada venta haría fallar
   * todo cierre con un conflicto espurio. La concurrencia de secuencias la
   * cubre el índice único, no `version`.
   */
  appendCashSale(input: AppendCashSaleInput): AppendCashSaleOutcome {
    const nowIso = this.now().toISOString();

    const shift = this.database.native.prepare(
      `SELECT status, cash_register_id, currency_code, last_movement_sequence
       FROM cash_shift WHERE tenant_id=? AND id=?`,
    ).get(input.scope.tenantId, input.cashShiftId) as
      | { status: string; cash_register_id: string; currency_code: string; last_movement_sequence: number }
      | undefined;

    if (shift === undefined) return { kind: "SHIFT_NOT_FOUND" };
    // Sin esta guarda el dinero entraría en un turno ya cuadrado y cerrado: la
    // clave foránea resolvería igual y el arqueo quedaría falseado a posteriori.
    if (shift.status !== "OPEN") return { kind: "SHIFT_NOT_OPEN" };
    if (shift.currency_code !== input.currencyCode) return { kind: "CURRENCY_MISMATCH" };

    const shiftSequence = shift.last_movement_sequence + 1;

    this.database.native.prepare(
      `INSERT INTO cash_movement(
        id, tenant_id, company_id, branch_id, cash_register_id, cash_shift_id,
        shift_sequence, movement_type, direction, amount, currency_code, status,
        original_cash_movement_id, reason_code, evidence_reference,
        actor_type, actor_id,
        approved_by_actor_type, approved_by_actor_id,
        business_date, occurred_at, device_reported_at, origin_device_id,
        idempotency_key, request_checksum, correlation_id,
        version, created_at, server_recorded_at
      ) VALUES (
        ?,?,?,?,?,?,
        ?,'CASH_SALE','IN',?,?,'POSTED',
        NULL,?,NULL,
        'USER',?,
        NULL,NULL,
        ?,?,?,?,
        ?,?,?,
        1,?,NULL
      )`,
    ).run(
      input.movementId,
      input.scope.tenantId,
      input.scope.companyId,
      input.scope.branchId,
      shift.cash_register_id,
      input.cashShiftId,
      shiftSequence,
      input.amount,
      input.currencyCode,
      input.reasonCode,
      input.operatorUserId,
      input.businessDate,
      nowIso,
      nowIso,
      input.scope.deviceId,
      input.idempotencyKey,
      input.requestChecksum,
      input.correlationId,
      nowIso,
    );

    this.database.native.prepare(
      "UPDATE cash_shift SET last_movement_sequence=? WHERE tenant_id=? AND id=?",
    ).run(shiftSequence, input.scope.tenantId, input.cashShiftId);

    return { kind: "POSTED", shiftSequence };
  }

  close(input: CloseShiftInput): CloseShiftOutcome {
    const nowIso = this.now().toISOString();

    const transaction = this.database.native.transaction((): CloseShiftOutcome => {
      // 1. Buscar turno
      const shift = this.database.native.prepare(
        `SELECT id, status, version, cash_register_id, currency_code,
                closing_idempotency_key, closing_request_checksum
         FROM cash_shift
         WHERE tenant_id=? AND id=?`,
      ).get(input.scope.tenantId, input.shiftId) as ShiftRow | undefined;

      if (!shift) return { kind: "NOT_FOUND" };

      // 2. Turno ya cerrado — idempotencia de cierre
      if (shift.status === "CLOSED") {
        if (shift.closing_idempotency_key === input.idempotencyKey) {
          if (shift.closing_request_checksum !== input.requestChecksum) {
            return { kind: "IDEMPOTENCY_CONFLICT" };
          }
          return { kind: "IDEMPOTENT", shiftId: shift.id };
        }
        return { kind: "ALREADY_CLOSED" };
      }

      // 3. Validar versión esperada
      if (shift.version !== input.expectedVersion) {
        return { kind: "VERSION_CONFLICT" };
      }

      // 4. Expected cash: suma BigInt de movimientos POSTED
      const movements = this.database.native.prepare(
        `SELECT direction, amount FROM cash_movement
         WHERE tenant_id=? AND cash_shift_id=? AND status='POSTED'`,
      ).all(input.scope.tenantId, input.shiftId) as MovementAmountRow[];

      let expectedUnits = 0n;
      for (const m of movements) {
        const units = scale6ToBigInt(m.amount);
        expectedUnits = m.direction === "IN" ? expectedUnits + units : expectedUnits - units;
      }
      const expectedCash = bigIntToScale6(expectedUnits);
      const countedUnits = scale6ToBigInt(input.countedAmount);
      const differenceAmount = bigIntToScale6(countedUnits - expectedUnits);

      // 5. OPEN→CLOSING dentro del mismo BEGIN; luego CLOSING→CLOSED.
      //    DA-1: un solo commit, sin commit intermedio. Si falla, el turno vuelve a OPEN.
      this.database.native.prepare(
        `UPDATE cash_shift SET status='CLOSING', version=version+1
         WHERE tenant_id=? AND id=? AND version=?`,
      ).run(input.scope.tenantId, input.shiftId, input.expectedVersion);

      this.database.native.prepare(
        `UPDATE cash_shift
         SET status='CLOSED',
             closed_by_actor_type='USER',
             closed_by_actor_id=?,
             closed_at=?,
             closing_idempotency_key=?,
             closing_request_checksum=?,
             version=version+1
         WHERE tenant_id=? AND id=?`,
      ).run(
        input.operatorUserId,
        nowIso,
        input.idempotencyKey,
        input.requestChecksum,
        input.scope.tenantId,
        input.shiftId,
      );

      // 6. runtime_operations
      this.database.native.prepare(
        `INSERT INTO runtime_operations(operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
         VALUES (?,?,?,'SUCCEEDED','CASH_SHIFT_CLOSED',?,?)`,
      ).run(input.operationId, input.idempotencyKey, input.requestChecksum, nowIso, nowIso);

      // 7. Auditoría
      this.database.native.prepare(
        `INSERT INTO local_operation_audit(
          tenant_id, company_id, branch_id, device_id,
          actor_type, actor_id, session_id,
          action_code, resource_type, resource_id,
          correlation_id, causation_id, reason_code, details_json, created_at
        ) VALUES (?,?,?,?,'USER',?,?,'CASH_SHIFT_CLOSED','CASH_SHIFT',?,?,?,NULL,?,?)`,
      ).run(
        input.scope.tenantId,
        input.scope.companyId,
        input.scope.branchId,
        input.scope.deviceId,
        input.operatorUserId,
        input.sessionId,
        input.shiftId,
        input.correlationId,
        input.causationId,
        canonicalJson({
          counted_amount: input.countedAmount,
          difference_amount: differenceAmount,
          expected_cash: expectedCash,
          shift_id: input.shiftId,
        }),
        nowIso,
      );

      // 8. Outbox
      const nextSeq = (this.database.native.prepare(
        `SELECT COALESCE(MAX(local_sequence), 0) + 1 AS next_sequence FROM local_sync_outbox
         WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?`,
      ).get(
        input.scope.tenantId,
        input.scope.companyId,
        input.scope.branchId,
        input.scope.deviceId,
        input.scope.installationId,
      ) as NextSequenceRow).next_sequence;

      this.durableSync.enqueue({
        operation_id: input.operationId,
        tenant_id: input.scope.tenantId,
        company_id: input.scope.companyId,
        branch_id: input.scope.branchId,
        device_id: input.scope.deviceId,
        installation_id: input.scope.installationId,
        session_id: input.sessionId,
        actor_id: input.operatorUserId,
        aggregate_type: "CASH_SHIFT",
        aggregate_id: input.shiftId,
        operation_type: "CASH_SHIFT_CLOSED",
        authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
        local_sequence: nextSeq,
        idempotency_key: input.idempotencyKey,
        expected_version: input.expectedVersion,
        payload_schema_version: CASH_SHIFT_PAYLOAD_SCHEMA_VERSION,
        payload: {
          counted_amount: input.countedAmount,
          difference_amount: differenceAmount,
          expected_cash: expectedCash,
          shift_id: input.shiftId,
        },
        payload_checksum: input.requestChecksum,
        causation_id: input.causationId,
        correlation_id: input.correlationId,
        occurred_at_local: nowIso,
        recorded_at_local: nowIso,
      });

      return {
        kind: "CLOSED",
        shiftId: input.shiftId,
        expectedCash,
        countedAmount: input.countedAmount,
        differenceAmount,
      };
    });

    return transaction();
  }
}

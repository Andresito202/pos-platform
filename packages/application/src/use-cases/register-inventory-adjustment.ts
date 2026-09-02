import {
  InventoryAdjustmentRecorded,
  InventoryDomainError,
  InventoryMovement,
  Quantity,
  calculateOnHandQuantity,
  type Actor,
  type TenantScope,
} from "@pos-platform/domain";
import type { InventoryAuthorizationPort } from "../ports/inventory-authorization-port.js";
import type { InventoryMovementRepository } from "../ports/inventory-movement-repository.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";

export interface RegisterInventoryAdjustmentCommand {
  readonly scope: TenantScope;
  readonly actor: Actor;
  readonly inventoryLocationId: string;
  readonly presentationId: string;
  readonly lotId: string | null;
  readonly adjustmentType: "POSITIVE_ADJUSTMENT" | "NEGATIVE_ADJUSTMENT";
  readonly quantity: string;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
}

export type RegisterInventoryAdjustmentResult =
  | {
      readonly kind: "REGISTERED";
      readonly movement: InventoryMovement;
      readonly onHandQuantity: Quantity;
      readonly event: InventoryAdjustmentRecorded;
    }
  | { readonly kind: "ALREADY_REGISTERED"; readonly movement: InventoryMovement }
  | { readonly kind: "REJECTED"; readonly reason: "NOT_AUTHORIZED" | "INVALID_QUANTITY" | "EMPTY_REASON_CODE" };

/**
 * UC-INVENTORY-002, "Ajustes de inventario" (steps 1-8), narrowed to what
 * is reachable without an approval-policy source: step 4 ("puede exigirse
 * aprobación separada según monto, producto o riesgo") has no defined
 * threshold anywhere in this repository, so it is not implemented — a
 * documented gap, not a silently-skipped check.
 *
 * There is no pre-existing aggregate to look up first (unlike Cash, which
 * mutates an open CashShift): an adjustment is a standalone append-only
 * fact, closer in shape to CreateProductUseCase than to
 * RegisterCashMovementUseCase. Order: authorization -> idempotency replay
 * -> domain validation (quantity, reason code) -> persist -> recompute the
 * on-hand projection. `expected_version` is deliberately not used —
 * UC-INVENTORY-002 line ~340 states it is only omitted "en la creación de
 * un hecho append-only cuya unicidad e idempotencia ya estén protegidas",
 * which is exactly this case, and there is no persisted StockBalance row
 * here to version against anyway (no adapter — DDL gate NO-GO).
 */
export class RegisterInventoryAdjustmentUseCase {
  constructor(
    private readonly repository: InventoryMovementRepository,
    private readonly authorization: InventoryAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: RegisterInventoryAdjustmentCommand): Promise<RegisterInventoryAdjustmentResult> {
    const authorized = await this.authorization.canAdjustInventory(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const existing = await this.repository.findByIdempotencyKey(command.scope, command.idempotencyKey);
    if (existing) return { kind: "ALREADY_REGISTERED", movement: existing };

    let quantity: Quantity;
    try {
      quantity = Quantity.fromString(command.quantity);
      if (!quantity.isPositive()) {
        throw new InventoryDomainError("NON_POSITIVE_MOVEMENT_QUANTITY", "quantity must be strictly positive");
      }
    } catch {
      return { kind: "REJECTED", reason: "INVALID_QUANTITY" };
    }

    let movement: InventoryMovement;
    try {
      const build = command.adjustmentType === "POSITIVE_ADJUSTMENT"
        ? InventoryMovement.positiveAdjustment
        : InventoryMovement.negativeAdjustment;
      movement = build({
        id: this.idGenerator.newId(),
        scope: command.scope,
        inventoryLocationId: command.inventoryLocationId,
        presentationId: command.presentationId,
        lotId: command.lotId,
        quantity,
        reasonCode: command.reasonCode,
        occurredAt: this.clock.now(),
      });
    } catch (error) {
      if (error instanceof InventoryDomainError && error.code === "EMPTY_REASON_CODE") {
        return { kind: "REJECTED", reason: "EMPTY_REASON_CODE" };
      }
      throw error;
    }

    await this.repository.save(movement, command.idempotencyKey);

    const posted = await this.repository.listPostedMovements(
      command.scope,
      command.inventoryLocationId,
      command.presentationId,
      command.lotId,
    );
    const onHandQuantity = calculateOnHandQuantity(posted);

    return { kind: "REGISTERED", movement, onHandQuantity, event: InventoryAdjustmentRecorded.from(movement) };
  }
}

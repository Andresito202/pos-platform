import {
  InventoryAdjusted,
  InventoryDomainError,
  InventoryMovement,
  Quantity,
  calculateOnHandQuantity,
  type Actor,
  type TenantScope,
} from "@pos-platform/domain";
import type { InventoryAuthorizationPort } from "../ports/inventory-authorization-port.js";
import type { InventoryMovementRepository } from "../ports/inventory-movement-repository.js";
import type { ProductPresentationRepository } from "../ports/product-presentation-repository.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { validateInventoryPresentation } from "../inventory/validate-inventory-presentation.js";
import { IdempotencyKeyConflictError } from "../ports/cash-shift-repository.js";

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
      readonly event: InventoryAdjusted;
    }
  | { readonly kind: "ALREADY_REGISTERED"; readonly movement: InventoryMovement }
  | {
      readonly kind: "REJECTED";
      readonly reason:
        | "NOT_AUTHORIZED"
        | "INVALID_QUANTITY"
        | "EMPTY_REASON_CODE"
        | "PRESENTATION_NOT_FOUND"
        | "PRESENTATION_NOT_INVENTORY_ENABLED"
        | "PRESENTATION_STOCK_MODE_NOT_SUPPORTED"
        | "INSUFFICIENT_STOCK";
    };

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
 * -> presentation validation -> domain validation (quantity, reason code)
 * -> non-negative on-hand guard -> persist -> recompute the on-hand
 * projection. `expected_version` is deliberately not used —
 * UC-INVENTORY-002 line ~340 states it is only omitted "en la creación de
 * un hecho append-only cuya unicidad e idempotencia ya estén protegidas",
 * which is exactly this case, and there is no persisted StockBalance row
 * here to version against anyway (no adapter — DDL gate NO-GO).
 *
 * B32 MAJOR fix (`traceability.md` §Delta B31): a `NEGATIVE_ADJUSTMENT`
 * used to persist unconditionally, even when it would drive on-hand
 * negative — UC-INVENTORY-002 regla 15/§"Salidas" regla 5 close this as
 * disallowed "salvo política explícita y autorizada"; with no
 * `InventoryPolicy` codified, the default is to deny. The guard folds
 * the SAME already-posted movements this use case already reads for the
 * return value — no new repository call.
 */
export class RegisterInventoryAdjustmentUseCase {
  constructor(
    private readonly repository: InventoryMovementRepository,
    private readonly presentationRepository: ProductPresentationRepository,
    private readonly authorization: InventoryAuthorizationPort,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(command: RegisterInventoryAdjustmentCommand): Promise<RegisterInventoryAdjustmentResult> {
    const authorized = await this.authorization.canAdjustInventory(command.actor, command.scope);
    if (!authorized) return { kind: "REJECTED", reason: "NOT_AUTHORIZED" };

    const existing = await this.repository.findByIdempotencyKey(command.scope, command.idempotencyKey);
    if (existing) return { kind: "ALREADY_REGISTERED", movement: existing };

    const presentationCheck = await validateInventoryPresentation(this.presentationRepository, command.scope, command.presentationId);
    if (presentationCheck.kind === "NOT_FOUND") return { kind: "REJECTED", reason: "PRESENTATION_NOT_FOUND" };
    if (presentationCheck.kind === "NOT_INVENTORY_ENABLED") return { kind: "REJECTED", reason: "PRESENTATION_NOT_INVENTORY_ENABLED" };
    if (presentationCheck.kind === "STOCK_MODE_NOT_SUPPORTED") return { kind: "REJECTED", reason: "PRESENTATION_STOCK_MODE_NOT_SUPPORTED" };

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

    const postedBefore = await this.repository.listPostedMovements(
      command.scope,
      command.inventoryLocationId,
      command.presentationId,
      command.lotId,
    );
    const onHandBefore = calculateOnHandQuantity(postedBefore);
    const onHandAfter = onHandBefore.add(movement.signedQuantity());
    if (!onHandAfter.isPositive() && !onHandAfter.equals(Quantity.zero())) {
      return { kind: "REJECTED", reason: "INSUFFICIENT_STOCK" };
    }

    try {
      await this.repository.save(movement, command.idempotencyKey);
    } catch (error) {
      // B33: a genuinely concurrent request can win the idempotency race
      // between this use case's own pre-check and its save() — re-run
      // the lookup first (authoritative whenever it resolves), same
      // discipline every other persisted use case in this repository
      // already follows.
      if (error instanceof IdempotencyKeyConflictError) {
        const replay = await this.repository.findByIdempotencyKey(command.scope, command.idempotencyKey);
        if (replay) return { kind: "ALREADY_REGISTERED", movement: replay };
      }
      throw error;
    }

    return { kind: "REGISTERED", movement, onHandQuantity: onHandAfter, event: InventoryAdjusted.from(movement) };
  }
}

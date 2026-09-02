import { Money } from "../money.js";
import type { CashMovement } from "./cash-movement.js";

/**
 * "ExpectedCash... se calcula desde CashMovement POSTED hasta un corte
 * explícito" (UC-CASH-003). Not an aggregate or a stored column — a pure
 * fold, shared by the withdrawal balance check and the close use case so
 * both compute it identically.
 */
export function calculateExpectedCash(postedMovements: readonly CashMovement[]): Money {
  return postedMovements.reduce((total, movement) => total.add(movement.signedAmount()), Money.zero());
}

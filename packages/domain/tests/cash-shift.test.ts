import { describe, expect, it } from "vitest";
import {
  Actor,
  CashDomainError,
  CashMovement,
  CashShift,
  CashShiftOpened,
  Money,
  TenantScope,
  type OpenCashShiftInput,
} from "../src/index.js";

function validInput(overrides: Partial<OpenCashShiftInput> = {}): OpenCashShiftInput {
  return {
    id: "018f0000-0000-7000-8000-000000000001",
    scope: new TenantScope(
      "018f0000-0000-7000-8000-000000000010",
      "018f0000-0000-7000-8000-000000000011",
      "018f0000-0000-7000-8000-000000000012",
    ),
    cashRegisterId: "018f0000-0000-7000-8000-000000000020",
    originDeviceId: "018f0000-0000-7000-8000-000000000030",
    openedByActor: Actor.device("018f0000-0000-7000-8000-000000000030"),
    openedAt: new Date("2026-09-02T08:00:00Z"),
    openingAmount: Money.fromString("50000"),
    ...overrides,
  };
}

describe("CashShift.open", () => {
  it("opens with a non-negative amount", () => {
    const shift = CashShift.open(validInput());
    expect(shift.status).toBe("OPEN");
    expect(shift.openingAmount.toString()).toBe("50000.000000");
  });

  it("rejects a negative opening amount", () => {
    expect(() => CashShift.open(validInput({ openingAmount: Money.fromString("-1") })))
      .toThrow(CashDomainError);
  });

  it("accepts a zero opening amount", () => {
    expect(() => CashShift.open(validInput({ openingAmount: Money.zero() }))).not.toThrow();
  });

  it("produces exactly one OPENING_FLOAT movement at shift_sequence=1, matching the opening amount", () => {
    const shift = CashShift.open(validInput());
    const movement = CashMovement.openingFloat(shift, "018f0000-0000-7000-8000-000000000002", shift.openedAt);
    expect(movement).toMatchObject({
      cashShiftId: shift.id,
      shiftSequence: 1,
      movementType: "OPENING_FLOAT",
      direction: "IN",
      status: "POSTED",
    });
    expect(movement.amount.equals(shift.openingAmount)).toBe(true);
  });

  it("emits CashShiftOpened referencing the shift and register", () => {
    const shift = CashShift.open(validInput());
    const event = CashShiftOpened.from(shift);
    expect(event).toMatchObject({
      type: "CashShiftOpened",
      cashShiftId: shift.id,
      cashRegisterId: shift.cashRegisterId,
    });
  });
});

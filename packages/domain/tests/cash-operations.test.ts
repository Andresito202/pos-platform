import { describe, expect, it } from "vitest";
import {
  Actor,
  CashCount,
  CashDifferenceReview,
  CashDomainError,
  CashMovement,
  CashShift,
  Money,
  TenantScope,
  calculateExpectedCash,
  type OpenCashShiftInput,
} from "../src/index.js";

function openShift(overrides: Partial<OpenCashShiftInput> = {}): CashShift {
  return CashShift.open({
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
  });
}

describe("CashMovement.register", () => {
  it("rejects a zero amount — stricter than CashShift's opening amount", () => {
    const shift = openShift();
    expect(() => CashMovement.register({
      id: "018f0000-0000-7000-8000-000000000002", shift, shiftSequence: 2,
      movementType: "CASH_DEPOSIT", direction: "IN", amount: Money.zero(), occurredAt: shift.openedAt,
    })).toThrow(CashDomainError);
  });

  it("rejects a negative amount", () => {
    const shift = openShift();
    expect(() => CashMovement.register({
      id: "018f0000-0000-7000-8000-000000000002", shift, shiftSequence: 2,
      movementType: "CASH_DEPOSIT", direction: "IN", amount: Money.fromString("-1"), occurredAt: shift.openedAt,
    })).toThrow(CashDomainError);
  });

  it("accepts a positive amount for a generic, evidenced type (CASH_DEPOSIT, direction supplied by the caller)", () => {
    const shift = openShift();
    const movement = CashMovement.register({
      id: "018f0000-0000-7000-8000-000000000002", shift, shiftSequence: 2,
      movementType: "CASH_DEPOSIT", direction: "IN", amount: Money.fromString("10000"), occurredAt: shift.openedAt,
    });
    expect(movement.status).toBe("POSTED");
    expect(movement.signedAmount().toString()).toBe("10000.000000");
  });
});

describe("CashMovement.withdrawal", () => {
  it("is always OUT and reduces expected cash when folded", () => {
    const shift = openShift();
    const withdrawal = CashMovement.withdrawal(shift, "018f0000-0000-7000-8000-000000000003", 2, Money.fromString("20000"), shift.openedAt);
    expect(withdrawal.direction).toBe("OUT");
    expect(withdrawal.signedAmount().toString()).toBe("-20000.000000");
  });
});

describe("calculateExpectedCash", () => {
  it("is zero for no movements", () => {
    expect(calculateExpectedCash([]).toString()).toBe("0.000000");
  });

  it("folds opening + deposits - withdrawals exactly (escenario retiro de UC-CASH-003)", () => {
    const shift = openShift({ openingAmount: Money.fromString("500000") });
    const opening = CashMovement.openingFloat(shift, "018f0000-0000-7000-8000-000000000002", shift.openedAt);
    const withdrawal = CashMovement.withdrawal(shift, "018f0000-0000-7000-8000-000000000003", 2, Money.fromString("300000"), shift.openedAt);
    expect(calculateExpectedCash([opening, withdrawal]).toString()).toBe("200000.000000");
  });
});

describe("CashCount.closing", () => {
  it("classifies EXACT when counted equals expected (escenario 1)", () => {
    const shift = openShift();
    const count = CashCount.closing(shift, "018f0000-0000-7000-8000-000000000004", Money.fromString("50000"), Money.fromString("50000"), 1, shift.openedAt);
    expect(count.differenceType).toBe("EXACT");
    expect(count.differenceAmount.toString()).toBe("0.000000");
  });

  it("classifies SHORTAGE when counted < expected (escenario 5: esperado 200000, contado 190000)", () => {
    const shift = openShift();
    const count = CashCount.closing(shift, "id", Money.fromString("190000"), Money.fromString("200000"), 1, shift.openedAt);
    expect(count.differenceType).toBe("SHORTAGE");
    expect(count.differenceAmount.toString()).toBe("-10000.000000");
  });

  it("classifies OVERAGE when counted > expected (escenario 6: esperado 200000, contado 205000)", () => {
    const shift = openShift();
    const count = CashCount.closing(shift, "id", Money.fromString("205000"), Money.fromString("200000"), 1, shift.openedAt);
    expect(count.differenceType).toBe("OVERAGE");
    expect(count.differenceAmount.toString()).toBe("5000.000000");
  });
});

describe("CashDifferenceReview.required", () => {
  it("references the count and shift it was raised from, status REVIEW_REQUIRED", () => {
    const shift = openShift();
    const count = CashCount.closing(shift, "count-1", Money.fromString("190000"), Money.fromString("200000"), 1, shift.openedAt);
    const review = CashDifferenceReview.required(count, "review-1", shift.openedAt);
    expect(review).toMatchObject({ status: "REVIEW_REQUIRED", cashCountId: "count-1", cashShiftId: shift.id });
  });
});

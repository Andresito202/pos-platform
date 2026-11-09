import { describe, expect, it } from "vitest";
import {
  defaultQuantityInput,
  formatQuantityDisplay,
  formatScale6Display,
  parseCopMicros,
} from "../../renderer/src/money-display.js";

describe("money-display", () => {
  it("formats whole COP amounts without six trailing decimals", () => {
    expect(formatScale6Display("3500.000000")).toBe("$3.500");
    expect(parseCopMicros("3500.000000")).toBe(3_500_000_000n);
  });

  it("keeps meaningful fractional COP digits when present", () => {
    expect(formatScale6Display("12.500000")).toBe("$12,5");
    expect(formatScale6Display("12.500100")).toBe("$12,5001");
  });

  it("formats negative scale-6 differences without inventing arithmetic", () => {
    expect(formatScale6Display("-2000.000000")).toBe("-$2.000");
    expect(formatScale6Display(null)).toBe("—");
  });

  it("applies presentation quantity precision for display defaults", () => {
    expect(defaultQuantityInput(0)).toBe("1");
    expect(defaultQuantityInput(3)).toBe("1.000");
    expect(formatQuantityDisplay("1.000000", 0)).toBe("1");
    expect(formatQuantityDisplay("1.250000", 2)).toBe("1,25");
  });
});

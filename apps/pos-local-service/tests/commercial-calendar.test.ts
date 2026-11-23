import { describe, expect, it } from "vitest";
import { commercialBusinessDate } from "../src/admin/commercial-calendar.js";

describe("commercialBusinessDate", () => {
  it("uses America/Bogota calendar day, not raw UTC date", () => {
    // 2026-09-08 04:30 UTC is still 2026-09-07 in Bogotá (UTC-5).
    expect(commercialBusinessDate(new Date("2026-09-08T04:30:00.000Z"))).toBe("2026-09-07");
    expect(commercialBusinessDate(new Date("2026-09-07T15:00:00.000Z"))).toBe("2026-09-07");
  });
});

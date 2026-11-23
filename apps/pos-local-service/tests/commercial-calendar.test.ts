import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_TIMEZONE,
  commercialBusinessDate,
} from "../src/admin/commercial-calendar.js";

describe("commercialBusinessDate", () => {
  it("uses America/Bogota calendar day, not raw UTC date", () => {
    expect(COMMERCIAL_TIMEZONE).toBe("America/Bogota");
    // 2026-09-08 04:30 UTC is still 2026-09-07 in Bogotá (UTC-5).
    expect(commercialBusinessDate(new Date("2026-09-08T04:30:00.000Z"))).toBe("2026-09-07");
    // First instant of 2026-09-08 in Bogotá is 05:00 UTC.
    expect(commercialBusinessDate(new Date("2026-09-08T05:00:00.000Z"))).toBe("2026-09-08");
    expect(commercialBusinessDate(new Date("2026-09-07T15:00:00.000Z"))).toBe("2026-09-07");
  });
});

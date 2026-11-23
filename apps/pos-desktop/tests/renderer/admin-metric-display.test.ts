import { describe, expect, it } from "vitest";
import {
  presentAdminMetricAmount,
  presentAdminMetricCount,
  presentAdminMetricQueryState,
} from "../../renderer/src/admin-metric-display.js";

describe("admin metric presentation", () => {
  it("never treats null as zero and distinguishes unavailable from forbidden", () => {
    expect(presentAdminMetricCount(null, { whenNull: "unavailable" }).label).toBe("No disponible");
    expect(presentAdminMetricCount(null, { whenNull: "forbidden" }).label).toBe("Sin permiso");
    expect(presentAdminMetricCount(0, { whenNull: "unavailable", emptyLabel: "sin filas" }).label).toBe("0");
    expect(presentAdminMetricCount(0, { whenNull: "unavailable", emptyLabel: "sin filas" }).availability).toBe("empty");
    expect(presentAdminMetricCount(12, { whenNull: "unavailable" }).label).toBe("12");
  });

  it("formats amounts only when the service published a value", () => {
    expect(presentAdminMetricAmount(null, () => "$0").label).toBe("No disponible");
    expect(presentAdminMetricAmount("3500.000000", (value) => `fmt:${value}`).label).toBe("fmt:3500.000000");
  });

  it("surfaces query error and loading without inventing metrics", () => {
    expect(presentAdminMetricQueryState({ busy: false, error: "UNAUTHORIZED", hasLoadedValue: false })?.availability)
      .toBe("error");
    expect(presentAdminMetricQueryState({ busy: true, error: null, hasLoadedValue: false })?.availability)
      .toBe("loading");
    expect(presentAdminMetricQueryState({ busy: false, error: null, hasLoadedValue: true })).toBeNull();
  });
});

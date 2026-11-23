import { describe, expect, it } from "vitest";
import {
  presentAdminMetricAmount,
  presentAdminMetricCount,
  presentAdminMetricQueryState,
} from "../../renderer/src/admin-metric-display.js";

describe("admin metric presentation", () => {
  it("never treats null as zero and distinguishes unavailable from forbidden", () => {
    expect(presentAdminMetricCount(null, { whenNull: "unavailable" }).label).toBe("Información no disponible");
    expect(presentAdminMetricCount(null, { whenNull: "forbidden" }).label).toBe("Sin permiso");
    expect(presentAdminMetricCount(null, { whenNull: "forbidden" }).detail)
      .toBe("No tienes permiso para consultar este indicador.");
    expect(presentAdminMetricCount(0, { whenNull: "unavailable", emptyLabel: "Sin movimientos registrados." }).label).toBe("0");
    expect(presentAdminMetricCount(0, { whenNull: "unavailable", emptyLabel: "Sin movimientos registrados." }).availability).toBe("empty");
    expect(presentAdminMetricCount(12, { whenNull: "unavailable" }).label).toBe("12");
  });

  it("formats amounts only when the service published a value", () => {
    expect(presentAdminMetricAmount(null, () => "$0").label).toBe("Información no disponible");
    expect(presentAdminMetricAmount("3500.000000", (value) => `fmt:${value}`).label).toBe("fmt:3500.000000");
  });

  it("surfaces query error and loading without inventing metrics", () => {
    const failed = presentAdminMetricQueryState({ busy: false, error: "UNAUTHORIZED", hasLoadedValue: false });
    expect(failed?.availability).toBe("error");
    expect(failed?.label).toBe("No fue posible cargar la información");
    expect(presentAdminMetricQueryState({ busy: true, error: null, hasLoadedValue: false })?.availability)
      .toBe("loading");
    expect(presentAdminMetricQueryState({ busy: false, error: null, hasLoadedValue: true })).toBeNull();
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { presentCatalogAvailability } from "../../renderer/src/catalog-availability-display.js";

describe("presentCatalogAvailability", () => {
  it("labels tracked available stock with unit code", () => {
    expect(presentCatalogAvailability({
      availability_state: "AVAILABLE",
      quantity_available: "17.000000",
      unit_code: "UND",
    }).label).toContain("Disponible");
  });

  it("labels low stock, restricted, verification and not tracked", () => {
    expect(presentCatalogAvailability({
      availability_state: "LOW",
      quantity_available: "4.000000",
      unit_code: "UND",
    })).toEqual({ label: "Existencias bajas · 4 UND", state: "LOW" });
    expect(presentCatalogAvailability({
      availability_state: "RESTRICTED",
      quantity_available: "10.000000",
      unit_code: "UND",
    })).toEqual({ label: "Venta restringida", state: "RESTRICTED" });
    expect(presentCatalogAvailability({
      availability_state: "VERIFICATION_REQUIRED",
      quantity_available: "12.000000",
      unit_code: "UND",
    }).label).toContain("Requiere verificación");
    expect(presentCatalogAvailability({
      availability_state: "OUT_OF_STOCK",
      quantity_available: "0.000000",
      unit_code: "UND",
    })).toEqual({ label: "Agotado", state: "OUT_OF_STOCK" });
    expect(presentCatalogAvailability({
      availability_state: "NOT_TRACKED",
      quantity_available: null,
      unit_code: "UND",
    })).toEqual({ label: "Sin control de existencias", state: "NOT_TRACKED" });
  });
});

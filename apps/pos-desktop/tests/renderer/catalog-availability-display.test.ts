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

  it("labels out of stock and not tracked without inventing quantities", () => {
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

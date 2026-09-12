import { describe, expect, it } from "vitest";
import { toScale6 } from "../../renderer/src/scale6.js";

/**
 * Lo que un cajero teclea de verdad.
 *
 * Estas pruebas existen porque el POS real, ejecutándose contra el servicio
 * real, rechazaba la venta de un cajero que tecleaba `2`: el contrato exige
 * escala 6 y nadie normalizaba. Ninguna prueba lo veía porque todas tecleaban
 * ya `"2.000000"`.
 */
describe("la cantidad tecleada se escribe como la exige el contrato", () => {
  it("un entero se completa a escala 6", () => {
    expect(toScale6("2")).toBe("2.000000");
    expect(toScale6("0")).toBe("0.000000");
  });

  it("acepta coma y punto, como acepta el teclado colombiano", () => {
    expect(toScale6("1,5")).toBe("1.500000");
    expect(toScale6("1.5")).toBe("1.500000");
  });

  it("respeta los seis decimales exactos y los espacios alrededor", () => {
    expect(toScale6("  12.345678 ")).toBe("12.345678");
  });

  it("no trunca en silencio lo que no cabe: prefiere que el cajero corrija", () => {
    expect(toScale6("1.2345678")).toBeNull();
  });

  it("rechaza lo que no es un número", () => {
    for (const invalid of ["", "  ", "abc", "-1", "1.2.3", "1e3", "٢"]) {
      expect(toScale6(invalid)).toBeNull();
    }
  });

  it("normaliza los ceros a la izquierda sin perder el valor", () => {
    expect(toScale6("007")).toBe("7.000000");
    expect(toScale6("0.5")).toBe("0.500000");
  });
});

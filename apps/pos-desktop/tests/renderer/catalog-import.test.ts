import { describe, expect, it } from "vitest";
import {
  CATALOG_IMPORT_TEMPLATE_HEADER,
  batches,
  parseCatalogFile,
} from "../../renderer/src/catalog-import.js";

/**
 * El fichero real de una tienda, no el ideal.
 *
 * Cada prueba reproduce algo que un comerciante colombiano entrega de verdad:
 * una hoja de Excel en español guardada como CSV. Un lector probado sólo con
 * CSV «de manual» fallaría con el primer fichero del primer cliente.
 */

const HEADER = CATALOG_IMPORT_TEMPLATE_HEADER;

describe("el fichero que exporta Excel en español", () => {
  it("lee `;` como separador, que es lo que Excel usa cuando la coma es decimal", () => {
    const { rows, errors } = parseCatalogFile([
      HEADER,
      "ARROZ-500;Arroz 500 g;Bolsa 500 g;UND;0;7709000000101;3200;si;40;;;;;",
    ].join("\n"));

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.item).toMatchObject({
      code: "ARROZ-500", price_amount: "3200.000000",
      initial_quantity: "40.000000", stock_controlled: true, fiscal: null,
    });
  });

  it("quita el BOM que Excel antepone, o la primera columna no casaría", () => {
    const { rows, errors } = parseCatalogFile(
      "\uFEFF" + HEADER + "\nA1;Uno;Unidad;UND;0;;1000;;;;;;;",
    );
    expect(errors).toEqual([]);
    expect(rows[0]!.item.code).toBe("A1");
  });

  it("lee tabuladores, que es lo que llega al copiar celdas de Excel y pegarlas", () => {
    const { rows, errors } = parseCatalogFile([
      "codigo\tnombre\tpresentacion\tunidad\tdecimales\tprecio",
      "A1\tArroz; grano largo\tBolsa\tUND\t0\t3200",
    ].join("\n"));
    expect(errors).toEqual([]);
    // El `;` dentro del nombre no parte nada: el separador es el tabulador.
    expect(rows[0]!.item).toMatchObject({ code: "A1", name: "Arroz; grano largo" });
  });

  it("acepta \\r\\n de Windows", () => {
    const { rows } = parseCatalogFile(HEADER + "\r\nA1;Uno;Unidad;UND;0;;1000;;;;;;;\r\n");
    expect(rows).toHaveLength(1);
  });

  it("busca las columnas por nombre: el comerciante ordena su hoja como quiere", () => {
    const { rows, errors } = parseCatalogFile([
      "precio;nombre;codigo;unidad;presentacion;decimales",
      "1500;Panela;PAN-1;und;Unidad;0",
    ].join("\n"));
    expect(errors).toEqual([]);
    expect(rows[0]!.item).toMatchObject({ code: "PAN-1", price_amount: "1500.000000", unit_code: "UND" });
  });

  it("respeta comillas: un nombre con `;` dentro es un solo campo", () => {
    const { rows } = parseCatalogFile(
      HEADER + '\nA1;"Arroz; grano largo";Unidad;UND;0;;1000;;;;;;;',
    );
    expect(rows[0]!.item.name).toBe("Arroz; grano largo");
  });

  it("acepta coma decimal en precio y existencia", () => {
    const { rows } = parseCatalogFile(HEADER + "\nQ1;Queso;Gramo;GRM;0;;12,5;si;2500;;;;;");
    expect(rows[0]!.item.price_amount).toBe("12.500000");
  });
});

describe("lo que no se adivina", () => {
  /**
   * `3.200` puede ser tres mil doscientos o tres coma dos. Interpretarlo es
   * decidir el precio por el comerciante, y un precio mil veces menor no lo
   * avisa nadie hasta que la caja no cuadra.
   */
  it("rechaza un precio con punto de miles, diciendo qué escribir", () => {
    const { rows, errors } = parseCatalogFile(HEADER + "\nA1;Uno;Unidad;UND;0;;3.200;;;;;;;");
    expect(rows).toEqual([]);
    expect(errors[0]!.line).toBe(2);
    expect(errors[0]!.problem).toContain("3200");
  });

  it("rechaza existencia inicial en cero: se deja vacía", () => {
    const { errors } = parseCatalogFile(HEADER + "\nA1;Uno;Unidad;UND;0;;1000;si;0;;;;;");
    expect(errors[0]!.problem).toContain("déjela vacía");
  });

  it("los códigos DIAN van todos o ninguno", () => {
    const { errors } = parseCatalogFile(HEADER + "\nA1;Uno;Unidad;UND;0;;1000;;;REF;94;;;");
    expect(errors[0]!.problem).toContain("todos o ninguno");
  });

  it("lee los cinco códigos DIAN cuando vienen completos", () => {
    const { rows } = parseCatalogFile(HEADER + "\nA1;Uno;Unidad;UND;0;;1000;;;REF-1;94;999;01;19");
    expect(rows[0]!.item.fiscal).toEqual({
      code_reference: "REF-1", unit_measure_code: "94", standard_code: "999",
      tax_code: "01", tax_rate: "19.000000",
    });
  });
});

describe("los errores se dicen con la línea que el comerciante ve", () => {
  it("una línea mala no se lleva a las buenas, y dice cuál es", () => {
    const { rows, errors } = parseCatalogFile([
      HEADER,
      "A1;Uno;Unidad;UND;0;;1000;;;;;;;",
      "A2;;Unidad;UND;0;;1000;;;;;;;",
      "A3;Tres;Unidad;UND;0;;1000;;;;;;;",
    ].join("\n"));

    expect(rows.map((row) => row.item.code)).toEqual(["A1", "A3"]);
    expect(errors).toEqual([{ line: 3, problem: "nombre vacío" }]);
    // Cada fila conserva su línea: el resultado del servicio se traduce a ella.
    expect(rows.map((row) => row.line)).toEqual([2, 4]);
  });

  /**
   * El servicio rechaza el LOTE entero si trae un código repetido. Se detecta
   * aquí, con las dos líneas, para que se vea que el error es del fichero.
   */
  it("un código repetido nombra la línea donde apareció primero", () => {
    const { errors } = parseCatalogFile([
      HEADER,
      "A1;Uno;Unidad;UND;0;;1000;;;;;;;",
      "A1;Otro;Unidad;UND;0;;1000;;;;;;;",
    ].join("\n"));
    expect(errors).toEqual([{ line: 3, problem: "código repetido (ya en la línea 2)" }]);
  });

  it("una cabecera sin las columnas obligatorias dice cuáles faltan", () => {
    const { errors } = parseCatalogFile("codigo;nombre\nA1;Uno");
    expect(errors[0]!.problem).toContain("presentacion");
    expect(errors[0]!.problem).toContain("precio");
  });

  it("ignora líneas vacías al final, que Excel deja", () => {
    const { rows, errors } = parseCatalogFile(HEADER + "\nA1;Uno;Unidad;UND;0;;1000;;;;;;;\n\n\n");
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});

describe("lotes de envío", () => {
  it("parte en lotes de 500, que es el tope del contrato", () => {
    const partes = batches(Array.from({ length: 1201 }, (_, i) => i));
    expect(partes.map((p) => p.length)).toEqual([500, 500, 201]);
  });
});

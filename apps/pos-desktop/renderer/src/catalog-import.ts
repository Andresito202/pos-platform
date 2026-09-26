import { toScale6 } from "./scale6.js";

/**
 * El fichero del comerciante, convertido en filas de `catalog.item.import`.
 *
 * ## Por qué existe aquí y no en el servicio
 *
 * El servicio recibe filas ya formadas y valida cada una con los casos de uso
 * de siempre. Lo que el servicio **no puede** hacer es decirle al comerciante
 * «la línea 214 de tu fichero tiene el precio vacío» — cuando la fila llega,
 * ya no existe la línea. Este lector valida **antes de enviar nada**, con el
 * número de línea que el comerciante ve en su hoja de cálculo.
 *
 * ## El fichero real, no el ideal
 *
 * - **Excel en español exporta con `;`**, porque la coma es el separador
 *   decimal. Un lector que sólo aceptara `,` fallaría con el primer fichero
 *   real de una tienda colombiana. Se detecta el separador por la cabecera.
 * - Excel antepone un **BOM** UTF-8. Si no se quita, la primera columna se
 *   llama `\uFEFFcodigo` y no casa con nada. Lo quitan **dos** cosas: el
 *   `replace` de abajo y el `trim()` de cada campo —en JavaScript `trim()`
 *   trata U+FEFF como espacio—. Medido mutando: quitar una no rompe la
 *   prueba, quitar las dos sí. El `replace` se queda porque dice la
 *   intención; el `trim()` no está ahí por el BOM y podría cambiar mañana.
 *   Va escrito como escape y no como el carácter: un BOM literal en el
 *   código es invisible, y ya hizo que una mutación no se aplicara sin avisar.
 * - Las columnas se buscan **por nombre**, no por posición: el comerciante
 *   ordena su hoja como quiere.
 * - Los precios se escriben como se escriben: `3200`, `3.200` no —eso es
 *   ambiguo y se rechaza—, `1,5` sí. La normalización es la misma que la de
 *   la caja (`toScale6`): nada de redondeos, y lo que no cabe se rechaza.
 */

export const CATALOG_IMPORT_BATCH = 500;

/** Cabecera de la plantilla. Es lo que se le da al comerciante para empezar. */
export const CATALOG_IMPORT_TEMPLATE_HEADER = [
  "codigo", "nombre", "presentacion", "unidad", "decimales", "codigo_barras",
  "precio", "controla_existencia", "existencia_inicial",
  "ref_dian", "unidad_dian", "estandar_dian", "impuesto_dian", "tarifa_impuesto",
].join(";");

const REQUIRED = ["codigo", "nombre", "presentacion", "unidad", "decimales", "precio"] as const;
const FISCAL = ["ref_dian", "unidad_dian", "estandar_dian", "impuesto_dian", "tarifa_impuesto"] as const;

export interface CatalogImportRow {
  readonly code: string;
  readonly name: string;
  readonly stock_controlled: boolean;
  readonly presentation_name: string;
  readonly unit_code: string;
  readonly unit_precision: number;
  readonly barcode: string | null;
  readonly price_amount: string;
  readonly currency_code: "COP";
  readonly initial_quantity: string | null;
  readonly fiscal: {
    readonly code_reference: string;
    readonly unit_measure_code: string;
    readonly standard_code: string;
    readonly tax_code: string;
    readonly tax_rate: string;
  } | null;
}

/** Una fila lista para enviar, con la línea del fichero de la que salió. */
export interface ParsedRow {
  readonly line: number;
  readonly item: CatalogImportRow;
}

/** Un problema de captura, con la línea que el comerciante ve en su hoja. */
export interface LineError {
  readonly line: number;
  readonly problem: string;
}

export interface ParseResult {
  readonly rows: readonly ParsedRow[];
  readonly errors: readonly LineError[];
}

/** Separa una línea respetando comillas: `"Arroz; grano largo"` es un campo. */
function splitLine(line: string, separator: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) { fields.push(current); current = ""; }
    else current += char;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/**
 * Importe o cantidad tal como lo escribe el comerciante.
 *
 * `3.200` se rechaza en vez de interpretarse: en Colombia puede ser tres mil
 * doscientos (punto de miles) o tres coma dos (punto decimal de una hoja en
 * inglés). Adivinar es decidir el precio por el comerciante, y un precio mil
 * veces menor no lo avisa nadie hasta que la caja no cuadra.
 */
function amount(raw: string): string | null {
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) return null;
  return toScale6(raw);
}

function yesNo(raw: string): boolean | null {
  const value = raw.toLowerCase();
  if (value === "" || value === "si" || value === "sí" || value === "s" || value === "1") return true;
  if (value === "no" || value === "n" || value === "0") return false;
  return null;
}

export function parseCatalogFile(text: string): ParseResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const errors: LineError[] = [];
  const rows: ParsedRow[] = [];

  const headerLine = lines[0] ?? "";
  // Tabulador primero: es lo que produce **copiar celdas de Excel y pegarlas**,
  // el camino más natural para un comerciante. Después `;` —CSV de Excel en
  // español— y por último `,`.
  const separator = headerLine.includes("\t") ? "\t" : headerLine.includes(";") ? ";" : ",";
  const header = splitLine(headerLine, separator).map((name) => name.toLowerCase());
  const column = new Map(header.map((name, index) => [name, index]));

  const missing = REQUIRED.filter((name) => !column.has(name));
  if (missing.length > 0) {
    return { rows, errors: [{ line: 1, problem: `faltan columnas: ${missing.join(", ")}` }] };
  }

  const seenCodes = new Map<string, number>();
  const seenBarcodes = new Map<string, number>();

  for (let index = 1; index < lines.length; index += 1) {
    const raw = lines[index]!;
    if (raw.trim() === "") continue;
    const line = index + 1;
    const fields = splitLine(raw, separator);
    const get = (name: string): string => {
      const at = column.get(name);
      return at === undefined ? "" : (fields[at] ?? "");
    };
    const problems: string[] = [];

    for (const name of REQUIRED) {
      if (get(name) === "") problems.push(`${name} vacío`);
    }

    const precision = Number(get("decimales"));
    if (get("decimales") !== "" && (!Number.isInteger(precision) || precision < 0 || precision > 6)) {
      problems.push("decimales debe ser un entero entre 0 y 6");
    }

    const price = get("precio") === "" ? null : amount(get("precio"));
    if (get("precio") !== "" && price === null) {
      problems.push(/^\d{1,3}(\.\d{3})+$/.test(get("precio"))
        ? `precio ambiguo «${get("precio")}»: escríbalo sin puntos (3200) o con coma decimal (3,2)`
        : "precio no válido");
    }
    if (price === "0.000000") problems.push("precio en cero");

    const stockRaw = get("existencia_inicial");
    const initial = stockRaw === "" ? null : amount(stockRaw);
    if (stockRaw !== "" && initial === null) {
      problems.push(/^\d{1,3}(\.\d{3})+$/.test(stockRaw)
        ? `existencia_inicial ambigua «${stockRaw}»: escríbala sin puntos o con coma decimal`
        : "existencia_inicial no válida");
    }
    // Cero no es existencia inicial: es no declararla. Dejarlo pasar haria
    // indistinguible «todavia no llego» de «se agoto».
    if (initial === "0.000000") problems.push("existencia_inicial en cero: déjela vacía");

    const controlled = yesNo(get("controla_existencia"));
    if (controlled === null) problems.push("controla_existencia debe ser si o no");

    const barcode = get("codigo_barras") === "" ? null : get("codigo_barras");
    if (barcode !== null && !/^[0-9A-Za-z-]{4,64}$/.test(barcode)) problems.push("codigo_barras no válido");

    // Los códigos DIAN van **todos o ninguno**. Tres de cinco no son un
    // artículo facturable a medias: son un error de captura, y enviarlo
    // produciría un rechazo lejos de la línea que lo causó.
    const fiscalValues = FISCAL.map((name) => get(name));
    const filled = fiscalValues.filter((value) => value !== "").length;
    let fiscal: CatalogImportRow["fiscal"] = null;
    if (filled > 0 && filled < FISCAL.length) {
      problems.push("códigos DIAN incompletos: van todos o ninguno");
    } else if (filled === FISCAL.length) {
      const rate = amount(fiscalValues[4]!);
      if (rate === null) problems.push("tarifa_impuesto no válida");
      else fiscal = {
        code_reference: fiscalValues[0]!, unit_measure_code: fiscalValues[1]!,
        standard_code: fiscalValues[2]!, tax_code: fiscalValues[3]!, tax_rate: rate,
      };
    }

    // Repetidos dentro del mismo fichero: el servicio rechazaría el LOTE
    // entero. Se dice aquí, con las dos líneas, que es lo que permite ver que
    // el error es del fichero y no del sistema.
    const code = get("codigo");
    if (code !== "") {
      const first = seenCodes.get(code);
      if (first !== undefined) problems.push(`código repetido (ya en la línea ${first})`);
      else seenCodes.set(code, line);
    }
    if (barcode !== null) {
      const first = seenBarcodes.get(barcode);
      if (first !== undefined) problems.push(`código de barras repetido (ya en la línea ${first})`);
      else seenBarcodes.set(barcode, line);
    }

    if (problems.length > 0) {
      for (const problem of problems) errors.push({ line, problem });
      continue;
    }

    rows.push({
      line,
      item: {
        code,
        name: get("nombre"),
        stock_controlled: controlled!,
        presentation_name: get("presentacion"),
        unit_code: get("unidad").toUpperCase(),
        unit_precision: precision,
        barcode,
        price_amount: price!,
        currency_code: "COP",
        initial_quantity: initial,
        fiscal,
      },
    });
  }

  return { rows, errors };
}

/** Parte las filas en lotes que caben en una llamada. */
export function batches<T>(items: readonly T[], size = CATALOG_IMPORT_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

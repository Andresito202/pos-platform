import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Las afirmaciones contables de los documentos, comprobadas contra el árbol.
 *
 * ## Por qué existe
 *
 * Una evidencia escrita **envejece en silencio**: sigue ahí, sigue leyéndose
 * como verdad, y nadie la vuelve a medir porque no falla nada. En dos días se
 * encontraron tres casos, todos del mismo tipo:
 *
 * - `business-readiness.md` afirmó durante **doce días** que «el renderer
 *   expone tres llamadas técnicas y **ninguna comercial**» mientras once
 *   paneles invocaban veintiocho operaciones. Es el documento que responde
 *   «¿ya le sirve esto a un comerciante real?», así que estuvo doce días
 *   respondiendo mal.
 * - La fila `A9` del tablero decía «23 tipos» y «10 de 23 sin cruzar» cuando el
 *   contrato tenía 31.
 * - `B6`, `B7` y `B10` se quedaron un bloque entero por debajo de su peldaño
 *   real porque su evidencia decía «no tiene pantalla» y las tres la tenían.
 *
 * Ninguno se detectó con una prueba: se detectaron porque alguien volvió a
 * medir a mano. Esta prueba convierte ese envejecimiento en un fallo de CI.
 *
 * ## La regla de diseño que no se puede romper
 *
 * **Si el ancla desaparece, esto FALLA; nunca pasa en silencio.** Una puerta
 * que deja de mirar y sigue en verde es peor que no tenerla: es exactamente el
 * defecto que se encontró en `architecture:check`, que devolvía `PASS` con una
 * violación viva porque Nx le servía caché. Por eso cada comprobación de abajo
 * localiza su frase primero y revienta si no la encuentra, en vez de dar por
 * buena una expresión regular que ya no casa.
 *
 * ## Qué NO se comprueba aquí, a propósito
 *
 * Sólo se fijan cifras **calculables desde el árbol**. El «26 de 31 sirve el
 * handler de producción» de `A9` se midió instrumentando el runtime y no se
 * puede recalcular leyendo ficheros: fijarlo aquí sería inventar una puerta que
 * no mide lo que dice medir.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const TABLERO = "docs/governance/tablero-materializacion.md";
const READINESS = "docs/product/business-readiness.md";

/**
 * Localiza una afirmación y devuelve sus capturas.
 *
 * La ausencia del ancla es un fallo, no un permiso para no comprobar nada: si
 * alguien reescribe la frase, esta prueba obliga a reconciliar la puerta con el
 * documento en vez de dejarla mirando al vacío.
 */
function claim(file, pattern, what) {
  const found = pattern.exec(read(file));
  assert.ok(
    found,
    `${file}: no se encuentra la afirmación sobre ${what}.\n`
    + `Si reescribiste esa frase, actualiza el patrón en tools/ci/document-claims.test.mjs.\n`
    + `Patrón: ${String(pattern)}`,
  );
  return found;
}

// ── Lo que el árbol dice de verdad ───────────────────────────────────────────

/** Los tipos que el contrato declara. Es el vocabulario de todo lo demás. */
function contractMessageTypes() {
  const source = read("packages/contracts/src/ipc.ts");
  const start = source.indexOf("IpcMessageTypeSchema = z.enum([");
  assert.notEqual(start, -1, "packages/contracts/src/ipc.ts ya no declara IpcMessageTypeSchema");
  const block = source.slice(start, source.indexOf("]);", start));
  const types = [...block.matchAll(/"([a-z][a-z0-9.]+)"/g)].map((m) => m[1]);
  assert.ok(types.length > 0, "no se pudo leer ningún tipo del contrato");
  return types;
}

/**
 * Qué operaciones invoca el renderer, y desde cuántos ficheros.
 *
 * El vocabulario sale del contrato, no de una lista de prefijos escrita aquí:
 * así una operación nueva entra sola y ninguna cadena parecida cuela como
 * falso positivo.
 */
function rendererSurface(types) {
  const vocabulary = new Set(types);
  const files = globSync("apps/pos-desktop/renderer/src/**/*.{ts,tsx}", { cwd: ROOT });
  const invoked = new Set();
  const surfaces = [];
  for (const file of files) {
    const hits = [...read(file).matchAll(/"([a-z][a-z0-9.]+)"/g)]
      .map((m) => m[1])
      .filter((candidate) => vocabulary.has(candidate));
    if (hits.length === 0) continue;
    surfaces.push(file);
    for (const hit of hits) invoked.add(hit);
  }
  return { invoked, surfaces };
}

// ── El tablero cuenta sus propias filas ──────────────────────────────────────

/**
 * Fila de capacidad, distinguida de la tabla histórica de movimientos.
 *
 * Ambas empiezan por `| A9 |`, pero la de movimientos lleva el peldaño de
 * origen en la segunda columna (`| A9 | \`IMPLEMENTED\` | \`RUNTIME_VERIFIED\` |`)
 * y la de capacidad lleva un nombre. Ese es el discriminante.
 */
function capabilityRows() {
  const rows = new Map();
  for (const line of read(TABLERO).split("\n")) {
    const match = /^\|\s*([A-E]\d{1,2})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (!match) continue;
    const [, id, name, third] = match;
    if (/^`[A-Z_]+`$/.test(name.trim())) continue;
    const rung = third.trim().replace(/`/g, "");
    if (!/^[A-Z_]+$|^—$/.test(rung)) continue;
    assert.ok(!rows.has(id), `${TABLERO}: la capacidad ${id} aparece dos veces en las tablas de bloque`);
    rows.set(id, rung);
  }
  assert.ok(rows.size > 0, `${TABLERO}: no se pudo parsear ninguna fila de capacidad`);
  return rows;
}

/** `C1..C11` se expande; `·` y espacios separan. */
function expandIds(text) {
  return text.split(/[\s·]+/).filter(Boolean).flatMap((token) => {
    const range = /^([A-E])(\d+)\.\.(?:[A-E])?(\d+)$/.exec(token);
    if (!range) return /^[A-E]\d{1,2}$/.test(token) ? [token] : [];
    const out = [];
    for (let i = Number(range[2]); i <= Number(range[3]); i += 1) out.push(`${range[1]}${i}`);
    return out;
  });
}

function declaredCounts() {
  const declared = new Map();
  for (const line of read(TABLERO).split("\n")) {
    const match = /^\|\s*(?:`([A-Z_]+)`|— \(nada\))\s*\|\s*\*\*(\d+)\*\*\s*\|\s*(.*?)\s*\|$/.exec(line);
    if (!match) continue;
    declared.set(match[1] ?? "—", { count: Number(match[2]), ids: expandIds(match[3]) });
  }
  assert.ok(declared.size > 0, `${TABLERO}: no se pudo parsear la tabla «Recuento por peldaño»`);
  return declared;
}

test("el tablero cuenta sus propias filas sin equivocarse", () => {
  // El documento afirma «recuento verificado parseando el fichero». Hasta hoy
  // nadie lo parseaba: era una afirmación sobre sí mismo que nada sostenía.
  const rows = capabilityRows();
  const declared = declaredCounts();

  for (const [rung, { count, ids }] of declared) {
    const real = [...rows.entries()].filter(([, value]) => value === rung).map(([id]) => id).sort();
    assert.deepEqual(
      [...ids].sort(), real,
      `el peldaño ${rung} lista unas capacidades y las filas del tablero dicen otras`,
    );
    assert.equal(
      count, real.length,
      `el peldaño ${rung} declara ${count} filas y en el tablero hay ${real.length}`,
    );
  }

  const sinPeldano = [...rows.entries()].filter(([, rung]) => !declared.has(rung));
  assert.deepEqual(
    sinPeldano.map(([id, rung]) => `${id}:${rung}`), [],
    "hay capacidades cuyo peldaño no aparece en la tabla de recuento",
  );

  const total = claim(TABLERO, /^\|\s*\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*/m, "el total de capacidades");
  assert.equal(
    Number(total[1]), rows.size,
    `el tablero declara ${total[1]} capacidades y sus tablas tienen ${rows.size}`,
  );
});

// ── Las cifras que los documentos citan del código ───────────────────────────

test("el número de operaciones del contrato que cita el tablero es el real", () => {
  const real = contractMessageTypes().length;
  const cited = claim(
    TABLERO, /Canal IPC comercial \(\*\*(\d+)\*\* tipos\)/, "los tipos del canal IPC (fila A9)",
  );
  assert.equal(
    Number(cited[1]), real,
    `la fila A9 dice ${cited[1]} tipos y el contrato declara ${real}. `
    + "Añadir un tipo obliga a reconciliar la fila, que es el punto.",
  );
});

test("las operaciones con pantalla que cita business-readiness son las que hay", () => {
  const types = contractMessageTypes();
  const { invoked, surfaces } = rendererSurface(types);

  const cited = claim(
    READINESS,
    /\*\*(\d+) de las (\d+) operaciones del contrato tienen pantalla\*\*, repartidas en (\d+) paneles y hooks/,
    "las operaciones con pantalla",
  );
  const [, conPantalla, delContrato, superficies] = cited.map(Number);

  assert.equal(
    delContrato, types.length,
    `business-readiness habla de ${delContrato} operaciones y el contrato declara ${types.length}`,
  );
  assert.equal(
    conPantalla, invoked.size,
    `business-readiness dice ${conPantalla} operaciones con pantalla y el renderer invoca ${invoked.size}. `
    + "Es la afirmación que estuvo doce días equivocada.",
  );
  assert.equal(
    superficies, surfaces.length,
    `business-readiness dice ${superficies} paneles y hooks y hay ${surfaces.length}`,
  );
});

test("las operaciones que business-readiness da por sin pantalla son exactamente las que no la tienen", () => {
  // No basta con que el número cuadre: una operación puede perder su pantalla y
  // otra ganarla el mismo día, y la cifra no se movería. El documento nombra
  // las tres y explica por qué; esto comprueba que sigan siendo esas tres.
  const types = contractMessageTypes();
  const { invoked } = rendererSurface(types);
  const sinPantalla = types.filter((type) => !invoked.has(type)).sort();

  const doc = read(READINESS);
  claim(READINESS, /Las (\d+) operaciones sin pantalla, y por qué/, "la sección de operaciones sin pantalla");

  for (const type of sinPantalla) {
    assert.ok(
      doc.includes(`\`${type}\``),
      `\`${type}\` no tiene pantalla y business-readiness no lo nombra ni explica por qué`,
    );
  }
  for (const type of types.filter((type) => invoked.has(type))) {
    assert.ok(
      !new RegExp(`\\|\\s*\`${type.replace(/\./g, "\\.")}\`\\s*\\|`).test(doc),
      `\`${type}\` sí tiene pantalla y business-readiness lo sigue listando como si no`,
    );
  }
});

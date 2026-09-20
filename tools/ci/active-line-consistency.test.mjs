import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * La línea activa se declara en CUATRO sitios y tienen que decir lo mismo.
 *
 * No es celo: el 2026-09-20 `CLAUDE.md`, `AGENTS.md` y `README.md` nombraban
 * `claude/pos-camacho-bloque-4c-ld43py` —una rama ya absorbida— porque llegaron
 * con una fusión y nadie los reconcilió. Cualquier agente que entrara se habría
 * ido a trabajar a la rama vacía. Esta prueba convierte esa deriva en un fallo.
 *
 * La fuente única es `tools/governance/active-line.txt`, legible por máquina.
 * Los documentos la citan; esto comprueba que la citan bien.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const ACTIVE = read("tools/governance/active-line.txt").trim();

test("la fuente de verdad nombra una rama plausible", () => {
  assert.match(ACTIVE, /^[A-Za-z0-9._/-]+$/);
  assert.ok(ACTIVE.length > 0);
  assert.notEqual(ACTIVE, "main", "`main` es la rama canónica, no la línea de trabajo");
});

/**
 * Cada herramienta lee un fichero distinto. Si uno solo se queda atrás, esa
 * herramienta se va a la rama equivocada — que es exactamente lo que pasó el
 * 2026-09-20 con `AGENTS.md`, el que lee Codex.
 *
 * Los punteros son deliberadamente cortos: duplicar el contenido recrearía la
 * deriva que esta prueba existe para impedir.
 */
const DECLARAN_LA_LINEA = [
  "START-HERE.md",                    // punto de entrada canónico
  "CLAUDE.md",                        // Claude Code (carga automática)
  "AGENTS.md",                        // Codex y agentes que siguen la convención
  "README.md",                        // humanos y GitHub
  ".cursorrules",                     // Cursor
  ".clinerules",                      // Cline
  ".windsurfrules",                   // Windsurf
  "GEMINI.md",                        // Gemini CLI
  "CONVENTIONS.md",                   // Aider
  ".github/copilot-instructions.md",  // GitHub Copilot
];

for (const file of DECLARAN_LA_LINEA) {
  test(`${file} nombra la línea activa vigente`, () => {
    assert.ok(
      read(file).includes(ACTIVE),
      `${file} no menciona "${ACTIVE}". Si la línea activa cambió, actualiza los tres documentos y la fuente de verdad a la vez.`,
    );
  });
}

test("ningún documento sigue proponiendo una línea absorbida", () => {
  // `claude/pos-camacho-bloque-4c-ld43py` puede aparecer como historia —queda
  // registrada como absorbida—, pero nunca como la rama sobre la que trabajar.
  const prohibido = /rama activa:?\s*`?claude\/pos-camacho-bloque-4c-ld43py`?/i;
  for (const file of DECLARAN_LA_LINEA) {
    assert.ok(!prohibido.test(read(file)), `${file} todavía declara activa una línea absorbida`);
  }
});

test("el guardián y el hook existen y son ejecutables por su ruta declarada", () => {
  assert.ok(read("tools/governance/check-active-line.sh").includes("active-line.txt"));
  assert.ok(read(".claude/hooks/session-start.sh").includes("check-active-line.sh"));
  const settings = JSON.parse(read(".claude/settings.json"));
  const commands = settings.hooks.SessionStart.flatMap((entry) => entry.hooks.map((h) => h.command));
  assert.ok(
    commands.some((c) => c.includes("session-start.sh")),
    "`.claude/settings.json` no registra el hook de arranque",
  );
});

test("los workflows de CI se disparan sobre la línea activa", () => {
  // Tres puertas se disparaban solo sobre la rama absorbida, asi que **nunca
  // corrian sobre la linea activa**. Una referencia asi no es prosa: es
  // funcional, y su ausencia no se nota hasta que hace falta.
  for (const file of [
    ".github/workflows/d3-live-security-e2e.yml",
    ".github/workflows/g1-2-live-session-bootstrap.yml",
    ".github/workflows/central-sync-persistence-gate.yml",
  ]) {
    const contenido = read(file);
    assert.ok(
      contenido.includes(`      - ${ACTIVE}`),
      `${file} no se dispara sobre la línea activa`,
    );
    // Puede citarla en un comentario como historia, nunca como disparador.
    assert.ok(
      !/^\s*-\s*claude\/pos-camacho-bloque-4c-ld43py\s*$/m.test(contenido),
      `${file} todavía se dispara sobre una rama absorbida`,
    );
  }
});

test("el punto de entrada explica cómo no rehacer trabajo", () => {
  const entrada = read("START-HERE.md");
  assert.ok(entrada.includes("materialization-state.md"), "START-HERE.md no dice dónde mirar lo ya hecho");
  assert.ok(/check-active-line\.sh/.test(entrada), "START-HERE.md no da el comando de comprobación");
});

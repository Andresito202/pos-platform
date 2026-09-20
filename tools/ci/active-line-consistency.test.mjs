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

for (const file of ["CLAUDE.md", "AGENTS.md", "README.md"]) {
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
  for (const file of ["CLAUDE.md", "AGENTS.md", "README.md"]) {
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

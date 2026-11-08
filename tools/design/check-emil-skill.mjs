import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path));
const canonical = read(".agents/skills/emil-design-eng/SKILL.md");
const claude = read(".claude/skills/emil-design-eng/SKILL.md");
const license = read(".agents/skills/emil-design-eng/LICENSE");
const claudeLicense = read(".claude/skills/emil-design-eng/LICENSE");
const agents = read("AGENTS.md").toString("utf8");
const documentation = read("docs/design/agent-skill-emil.md").toString("utf8");

assert.ok(canonical.equals(claude), "Skill canonical y copia Claude no coinciden");
assert.ok(license.equals(claudeLicense), "Licencias de las dos copias no coinciden");
assert.match(canonical.toString("utf8"), /^---\r?\nname: emil-design-eng\r?\n/);
assert.match(canonical.toString("utf8"), /description: .+\r?\n/);
assert.match(license.toString("utf8"), /^MIT License/);
assert.match(agents, /\.agents\/skills\/emil-design-eng\/SKILL\.md/);
assert.match(documentation, /c8a79627b59d72d764d6ab6f2c87c09a48169833/);
console.log("PASS: emil-design-eng, mirror, LICENSE, frontmatter, rutas y procedencia");

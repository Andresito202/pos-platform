import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { validateWorkspace } from "./validate-boundaries.mjs";

let root;

const policy = {
  $schemaVersion: 1,
  projects: {
    "@pos-platform/domain": { root: "packages/domain", layer: "domain", type: "library", scope: "shared" },
    "@pos-platform/application": { root: "packages/application", layer: "application", type: "library", scope: "shared" },
    "@pos-platform/database-postgres": { root: "packages/database-postgres", layer: "adapter", type: "library", scope: "central", dialect: "postgres" },
  },
  allowedLayerDependencies: {
    domain: [],
    application: ["domain"],
    adapter: ["domain", "application"],
  },
  forbiddenProjectNames: ["@pos-platform/categories"],
  forbiddenExternalImportsByLayer: {
    domain: ["react", "@nestjs/", "kysely", "pg"],
    application: ["@nestjs/", "kysely", "pg"],
  },
};

async function writeProject(name, definition, dependencies = {}) {
  const directory = join(root, definition.root);
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ name, version: "0.0.0", private: true, type: "module", dependencies }, null, 2));
  const tags = [`layer:${definition.layer}`, `type:${definition.type}`, `scope:${definition.scope}`];
  if (definition.dialect) tags.push(`dialect:${definition.dialect}`);
  await writeFile(join(directory, "project.json"), JSON.stringify({ name, root: definition.root, projectType: "library", tags }, null, 2));
}

async function validate() {
  return validateWorkspace(root, policy);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "arch-003-boundaries-"));
  await Promise.all(Object.entries(policy.projects).map(([name, definition]) => writeProject(name, definition)));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("accepts the declared layer graph", async () => {
  await writeProject("@pos-platform/application", policy.projects["@pos-platform/application"], { "@pos-platform/domain": "workspace:*" });
  await writeFile(join(root, "packages/application/src/valid.ts"), 'import "@pos-platform/domain";\n');
  assert.deepEqual(await validate(), []);
});

test("rejects domain dependencies on concrete adapters", async () => {
  await writeFile(join(root, "packages/domain/src/invalid-adapter.ts"), 'import "@pos-platform/database-postgres";\n');
  const errors = await validate();
  assert(errors.some((error) => error.includes("forbidden layer dependency")));
  await rm(join(root, "packages/domain/src/invalid-adapter.ts"));
});

test("rejects forbidden framework and driver imports in pure layers", async () => {
  await writeFile(join(root, "packages/domain/src/invalid-framework.ts"), 'import "react";\nimport "pg";\n');
  const errors = await validate();
  assert(errors.some((error) => error.includes("cannot import react")));
  assert(errors.some((error) => error.includes("cannot import pg")));
  await rm(join(root, "packages/domain/src/invalid-framework.ts"));
});

test("does not treat comments or ordinary strings as imports", async () => {
  await writeFile(join(root, "packages/domain/src/not-an-import.ts"), '// import "react";\nconst documentation = \'require("pg")\';\n');
  assert.deepEqual(await validate(), []);
});

test("rejects undeclared and artificially split sub-capability packages", async () => {
  await writeFile(join(root, "packages/domain/src/invalid-split.ts"), 'import "@pos-platform/categories";\n');
  const errors = await validate();
  assert(errors.some((error) => error.includes("undeclared workspace project @pos-platform/categories")));
  await rm(join(root, "packages/domain/src/invalid-split.ts"));
});

test("requires internal workspace imports to be declared", async () => {
  await writeFile(join(root, "packages/application/src/undeclared.ts"), 'import "@pos-platform/domain";\n');
  const errors = await validate();
  assert(errors.some((error) => error.includes("is not declared in package.json")));
});

test("requires the workspace protocol for internal dependencies", async () => {
  await writeProject("@pos-platform/application", policy.projects["@pos-platform/application"], { "@pos-platform/domain": "0.0.0" });
  await writeFile(join(root, "packages/application/src/non-workspace.ts"), 'import "@pos-platform/domain";\n');
  const errors = await validate();
  assert(errors.some((error) => error.includes("must use the workspace: protocol")));
});

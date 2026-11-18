import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectDirectDependencies, generateDependencyInventory } from "./generate-dependency-inventory.mjs";
import { discoverWorkspaceManifestPaths } from "./workspace-manifests.mjs";

function writeManifest(root, relativePath, manifest) {
  mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
  writeFileSync(path.join(root, relativePath), JSON.stringify(manifest));
}

test("collects direct dependency scopes from root, apps, packages and tools", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pos-dependency-inventory-"));
  try {
    writeManifest(root, "package.json", {
      name: "root",
      devDependencies: { nx: "23.1.2" },
    });
    writeManifest(root, "apps/desktop/package.json", {
      name: "@pos-platform/desktop",
      dependencies: { zod: "4.4.3" },
    });
    writeManifest(root, "packages/contracts/package.json", {
      name: "@pos-platform/contracts",
      dependencies: { zod: "4.4.3", "@pos-platform/domain": "workspace:*" },
    });
    writeManifest(root, "tools/migrations/package.json", {
      name: "@pos-platform/migrations",
      optionalDependencies: { pg: "8.23.0" },
    });

    const manifests = discoverWorkspaceManifestPaths(root);
    const direct = collectDirectDependencies(root, manifests);

    assert.deepEqual(direct.get("nx@23.1.2"), [
      { workspace: "root", manifestPath: "package.json", section: "devDependencies" },
    ]);
    assert.deepEqual(direct.get("zod@4.4.3"), [
      { workspace: "@pos-platform/desktop", manifestPath: "apps/desktop/package.json", section: "dependencies" },
      { workspace: "@pos-platform/contracts", manifestPath: "packages/contracts/package.json", section: "dependencies" },
    ]);
    assert.deepEqual(direct.get("pg@8.23.0"), [
      { workspace: "@pos-platform/migrations", manifestPath: "tools/migrations/package.json", section: "optionalDependencies" },
    ]);
    assert.equal(direct.has("@pos-platform/domain@workspace:*"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed when a discovered workspace manifest is invalid JSON", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pos-dependency-inventory-invalid-"));
  try {
    writeManifest(root, "package.json", { name: "root" });
    mkdirSync(path.join(root, "packages/broken"), { recursive: true });
    writeFileSync(path.join(root, "packages/broken/package.json"), "{");
    assert.throws(() => collectDirectDependencies(root), SyntaxError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ignores nested package.json fixtures under an installed package tree", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pos-dependency-inventory-nested-"));
  try {
    writeManifest(root, "package.json", { name: "root" });
    writeManifest(root, "node_modules/.pnpm/fast-uri@3.1.9/node_modules/fast-uri/package.json", {
      name: "fast-uri",
      version: "3.1.9",
      license: "BSD-3-Clause",
    });
    writeManifest(root, "node_modules/.pnpm/fast-uri@3.1.9/node_modules/fast-uri/benchmark/package.json", {
      name: "benchmark",
      version: "1.0.0",
      license: "ISC",
      private: true,
    });

    const inventory = generateDependencyInventory(root, {});
    const names = inventory.packages.map((item) => `${item.name}@${item.version}`);
    assert.deepEqual(names, ["fast-uri@3.1.9"]);
    assert.equal(names.includes("benchmark@1.0.0"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectDirectDependencies, generateDependencyInventory, isInstalledPackageManifest } from "./generate-dependency-inventory.mjs";
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

test("excludes nested dependency fixtures and benchmarks from installed package inventory", () => {
  const store = path.join("root", "node_modules", ".pnpm");
  assert.equal(
    isInstalledPackageManifest(path.join(store, "pino@10.3.1", "node_modules", "pino", "package.json"), store),
    true,
  );
  assert.equal(
    isInstalledPackageManifest(path.join(store, "pino@10.3.1", "node_modules", "pino", "test", "fixtures", "transport", "package.json"), store),
    false,
  );
  assert.equal(
    isInstalledPackageManifest(path.join(store, "secure-json-parse@4.1.0", "node_modules", "secure-json-parse", "benchmarks", "package.json"), store),
    false,
  );
  assert.equal(
    isInstalledPackageManifest(path.join(store, "scope@1.0.0", "node_modules", "@scope", "pkg", "package.json"), store),
    true,
  );
});

test("inventory ignores package.json files nested inside installed packages", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pos-dependency-inventory-fixtures-"));
  try {
    writeManifest(root, "package.json", { name: "root", version: "1.0.0" });
    writeManifest(root, "node_modules/.pnpm/pino@10.3.1/node_modules/pino/package.json", {
      name: "pino", version: "10.3.1", license: "MIT",
    });
    writeManifest(root, "node_modules/.pnpm/pino@10.3.1/node_modules/pino/test/fixtures/transport/package.json", {
      name: "transport", version: "0.0.1",
    });
    writeManifest(root, "node_modules/.pnpm/secure-json-parse@4.1.0/node_modules/secure-json-parse/package.json", {
      name: "secure-json-parse", version: "4.1.0", license: "MIT",
    });
    writeManifest(root, "node_modules/.pnpm/secure-json-parse@4.1.0/node_modules/secure-json-parse/benchmarks/package.json", {
      name: "benchmarks", version: "1.0.0",
    });
    const inventory = generateDependencyInventory(root, { REVIEWED_SHA: "a".repeat(40) });
    assert.equal(inventory.packageCount, 2);
    assert.deepEqual(inventory.reviewFindings, []);
    assert.deepEqual(inventory.packages.map(({ name }) => name), ["pino", "secure-json-parse"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

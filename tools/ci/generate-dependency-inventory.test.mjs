import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectDirectDependencies } from "./generate-dependency-inventory.mjs";
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

test("only installed package root manifests count as packages (D-42)", async () => {
  const { isInstalledPackageRootManifest } = await import("./generate-dependency-inventory.mjs");
  assert.equal(isInstalledPackageRootManifest("fastify@5.12.5/node_modules/fastify/package.json"), true);
  assert.equal(isInstalledPackageRootManifest("@fastify+cors@11.3.0/node_modules/@fastify/cors/package.json"), true);
  // Ficheros internos de un paquete: no son paquetes instalados.
  assert.equal(isInstalledPackageRootManifest("fast-uri@3.1.8/node_modules/fast-uri/benchmark/package.json"), false);
  assert.equal(isInstalledPackageRootManifest("@fastify+cors@11.3.0/node_modules/@fastify/cors/benchmark/package.json"), false);
  assert.equal(isInstalledPackageRootManifest("fastify@5.12.5/node_modules/secure-json-parse/benchmarks/package.json"), false);
  // Un scope sin nombre de paquete, o un nombre con forma de scope, no es raíz.
  assert.equal(isInstalledPackageRootManifest("x@1.0.0/node_modules/@scope/package.json"), false);
  assert.equal(isInstalledPackageRootManifest("x@1.0.0/package.json"), false);
});

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverWorkspaceManifestPaths,
  readWorkspaceManifest,
  workspaceIdentity,
} from "./workspace-manifests.mjs";

function withWorkspace(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), "pos-workspace-manifests-"));
  try {
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "root-package" }));
    for (const [relativeDir, name] of [
      ["apps/desktop", "@pos-platform/desktop"],
      ["packages/contracts", "@pos-platform/contracts"],
      ["tools/migrations", "@pos-platform/migrations"],
    ]) {
      mkdirSync(path.join(root, relativeDir), { recursive: true });
      writeFileSync(path.join(root, relativeDir, "package.json"), JSON.stringify({ name }));
    }
    mkdirSync(path.join(root, "packages/contracts/nested"), { recursive: true });
    writeFileSync(
      path.join(root, "packages/contracts/nested/package.json"),
      JSON.stringify({ name: "must-not-be-discovered" }),
    );
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("discovers exactly the reviewed workspace roots and direct children", () => {
  withWorkspace((root) => {
    assert.deepEqual(discoverWorkspaceManifestPaths(root), [
      "apps/desktop/package.json",
      "package.json",
      "packages/contracts/package.json",
      "tools/migrations/package.json",
    ]);
  });
});

test("reads manifest identity consistently for root and workspace packages", () => {
  withWorkspace((root) => {
    const appPath = "apps/desktop/package.json";
    assert.equal(workspaceIdentity("package.json", readWorkspaceManifest(root, "package.json")), "root");
    assert.equal(workspaceIdentity(appPath, readWorkspaceManifest(root, appPath)), "@pos-platform/desktop");
  });
});

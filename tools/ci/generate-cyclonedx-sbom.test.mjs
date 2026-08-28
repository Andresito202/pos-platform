import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildCycloneDxBom,
  npmPurl,
  serializeBom,
  validateCycloneDxBom,
} from "./generate-cyclonedx-sbom.mjs";

const SOURCE_SHA = "a".repeat(40);
const LOCK_SHA = "b".repeat(64);

function fixture() {
  const workspaceManifests = [
    {
      manifestPath: "package.json",
      manifest: { name: "pos-platform-target", version: "1.0.0", devDependencies: { nx: "23.1.2" } },
    },
    {
      manifestPath: "packages/contracts/package.json",
      manifest: {
        name: "@pos-platform/contracts",
        version: "1.0.0",
        dependencies: { "@pos-platform/domain": "workspace:*", zod: "4.3.5" },
      },
    },
    {
      manifestPath: "packages/domain/package.json",
      manifest: { name: "@pos-platform/domain", version: "1.0.0" },
    },
  ];
  const projects = [
    {
      name: "pos-platform-target",
      path: "/repo",
      devDependencies: {
        nx: {
          from: "nx",
          version: "23.1.2",
          dependencies: {
            chalk: { from: "chalk", version: "4.1.2" },
          },
        },
      },
    },
    {
      name: "@pos-platform/contracts",
      path: "/repo/packages/contracts",
      dependencies: {
        "@pos-platform/domain": {
          from: "@pos-platform/domain",
          version: "link:../domain",
        },
        zod: { from: "zod", version: "4.3.5" },
      },
    },
    { name: "@pos-platform/domain", path: "/repo/packages/domain" },
  ];
  return { projects, workspaceManifests };
}

test("npm PURLs encode scoped package identities canonically", () => {
  assert.equal(
    npmPurl("@pos-platform/contracts", "1.0.0"),
    "pkg:npm/%40pos-platform/contracts@1.0.0",
  );
});

test("builds a deterministic CycloneDX 1.6 graph with complete workspace coverage", () => {
  const input = fixture();
  const first = buildCycloneDxBom({
    ...input,
    sourceCommit: SOURCE_SHA,
    lockfileSha256: LOCK_SHA,
  });
  const second = buildCycloneDxBom({
    ...input,
    sourceCommit: SOURCE_SHA,
    lockfileSha256: LOCK_SHA,
  });

  assert.equal(serializeBom(first), serializeBom(second));
  assert.equal(first.specVersion, "1.6");

  const all = [first.metadata.component, ...first.components];
  assert.equal(
    all.filter((component) =>
      component.properties?.some(
        (property) => property.name === "pos-platform:first-party" && property.value === "true",
      ),
    ).length,
    3,
  );
  assert.ok(all.some((component) => component.name === "chalk"));
  assert.ok(all.some((component) => component.name === "zod"));

  const rootRef = npmPurl("pos-platform-target", "1.0.0");
  const rootEdge = first.dependencies.find((item) => item.ref === rootRef);
  assert.ok(rootEdge.dependsOn.includes(npmPurl("@pos-platform/contracts", "1.0.0")));
  assert.ok(!rootEdge.dependsOn.includes(rootRef));

  const contractEdge = first.dependencies.find(
    (item) => item.ref === npmPurl("@pos-platform/contracts", "1.0.0"),
  );
  assert.ok(contractEdge.dependsOn.includes(npmPurl("@pos-platform/domain", "1.0.0")));
  assert.ok(!all.some((component) => component.version.startsWith("link:")));
});

test("terminates cyclic dependency graphs and preserves both directions", () => {
  const cyclicA = { from: "cycle-a", version: "1.0.0", dependencies: {} };
  const cyclicB = { from: "cycle-b", version: "1.0.0", dependencies: { "cycle-a": cyclicA } };
  cyclicA.dependencies["cycle-b"] = cyclicB;

  const input = fixture();
  input.projects[0].devDependencies.nx.dependencies = { "cycle-a": cyclicA };
  const bom = buildCycloneDxBom({
    ...input,
    sourceCommit: SOURCE_SHA,
    lockfileSha256: LOCK_SHA,
  });
  const a = bom.dependencies.find((item) => item.ref === npmPurl("cycle-a", "1.0.0"));
  const b = bom.dependencies.find((item) => item.ref === npmPurl("cycle-b", "1.0.0"));
  assert.deepEqual(a.dependsOn, [npmPurl("cycle-b", "1.0.0")]);
  assert.deepEqual(b.dependsOn, [npmPurl("cycle-a", "1.0.0")]);
});

test("binds source commit and lockfile digest into deterministic evidence", () => {
  const bom = buildCycloneDxBom({
    ...fixture(),
    sourceCommit: SOURCE_SHA,
    lockfileSha256: LOCK_SHA,
  });
  const properties = new Map(bom.metadata.properties.map((item) => [item.name, item.value]));
  assert.equal(properties.get("pos-platform:source-commit"), SOURCE_SHA);
  assert.equal(properties.get("pos-platform:lockfile-sha256"), LOCK_SHA);
  assert.match(createHash("sha256").update(serializeBom(bom)).digest("hex"), /^[0-9a-f]{64}$/);
});

test("rejects invalid reviewed SHAs and missing root manifests", () => {
  assert.throws(
    () => buildCycloneDxBom({ ...fixture(), sourceCommit: "short", lockfileSha256: LOCK_SHA }),
    /exact 40-character/,
  );
  const input = fixture();
  assert.throws(
    () =>
      buildCycloneDxBom({
        projects: input.projects,
        workspaceManifests: input.workspaceManifests.slice(1),
        sourceCommit: SOURCE_SHA,
        lockfileSha256: LOCK_SHA,
      }),
    /root package\.json is missing/,
  );
});

test("rejects dangling and tampered relationships", () => {
  const bom = buildCycloneDxBom({
    ...fixture(),
    sourceCommit: SOURCE_SHA,
    lockfileSha256: LOCK_SHA,
  });
  const tampered = structuredClone(bom);
  tampered.dependencies[0].dependsOn.push("pkg:npm/missing@1.0.0");
  assert.throws(
    () =>
      validateCycloneDxBom(tampered, {
        expectedSourceCommit: SOURCE_SHA,
        expectedWorkspaceCount: 3,
      }),
    /unknown dependency target/,
  );

  assert.throws(
    () =>
      validateCycloneDxBom(bom, {
        expectedSourceCommit: "c".repeat(40),
        expectedWorkspaceCount: 3,
      }),
    /does not match the reviewed SHA/,
  );
});

test("rejects empty third-party graphs", () => {
  const input = fixture();
  input.projects = input.projects.map((project) => ({
    name: project.name,
    path: project.path,
  }));
  assert.throws(
    () =>
      buildCycloneDxBom({
        ...input,
        sourceCommit: SOURCE_SHA,
        lockfileSha256: LOCK_SHA,
      }),
    /no third-party dependency components/,
  );
});

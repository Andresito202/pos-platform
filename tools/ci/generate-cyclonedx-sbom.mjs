import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnPnpm } from "./pnpm-exec.mjs";
import { fileURLToPath } from "node:url";
import {
  discoverWorkspaceManifestPaths,
  readWorkspaceManifest,
  workspaceIdentity,
} from "./workspace-manifests.mjs";

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"];
const CYCLONEDX_SPEC_VERSION = "1.6";
const GENERATOR_VERSION = "1.0.0";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function npmPurl(name, version) {
  if (typeof name !== "string" || !name || typeof version !== "string" || !version) {
    throw new TypeError("npmPurl requires non-empty name and version");
  }
  const encodedName = name.startsWith("@")
    ? `%40${name.slice(1).split("/").map(encodeURIComponent).join("/")}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function sbomWorkspaceIdentity(manifestPath, manifest) {
  if (typeof manifest?.name === "string" && manifest.name.trim()) return manifest.name.trim();
  return workspaceIdentity(manifestPath, manifest);
}

function workspaceVersion(manifest) {
  return typeof manifest.version === "string" && manifest.version.trim()
    ? manifest.version.trim()
    : "0.0.0";
}

function dependencyEntries(container) {
  return DEPENDENCY_SECTIONS.flatMap((section) =>
    Object.entries(container?.[section] ?? {}).map(([name, value]) => ({ name, value })),
  );
}

function nodeIdentity(name, node) {
  const actualName = typeof node?.from === "string" && node.from ? node.from : name;
  const version = typeof node?.version === "string" ? node.version : null;
  return { name: actualName, version };
}

export function buildCycloneDxBom({
  projects,
  workspaceManifests,
  sourceCommit,
  lockfileSha256,
  repository = "Andresito202/pos-platform",
}) {
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error("pnpm dependency graph must contain at least one project");
  }
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) {
    throw new Error("sourceCommit must be an exact 40-character lowercase Git SHA");
  }
  if (!/^[0-9a-f]{64}$/.test(lockfileSha256 ?? "")) {
    throw new Error("lockfileSha256 must be a lowercase SHA-256 digest");
  }
  if (!Array.isArray(workspaceManifests) || workspaceManifests.length === 0) {
    throw new Error("workspace manifests must not be empty");
  }

  const components = new Map();
  const edges = new Map();
  const workspaceByName = new Map();
  const workspaceRefsByPath = new Map();
  const expanding = new Set();

  for (const entry of workspaceManifests) {
    const name = sbomWorkspaceIdentity(entry.manifestPath, entry.manifest);
    const version = workspaceVersion(entry.manifest);
    const ref = npmPurl(name, version);
    if (workspaceByName.has(name)) throw new Error(`duplicate workspace identity: ${name}`);
    workspaceByName.set(name, ref);
    workspaceRefsByPath.set(entry.manifestPath === "package.json" ? "" : entry.manifestPath.slice(0, -"/package.json".length), ref);
    components.set(ref, {
      type: entry.manifestPath === "package.json" ? "application" : "library",
      "bom-ref": ref,
      name,
      version,
      purl: ref,
      properties: [
        { name: "pos-platform:first-party", value: "true" },
        { name: "pos-platform:manifest", value: entry.manifestPath },
      ],
    });
    edges.set(ref, new Set());
  }

  function registerNode(name, node) {
    const identity = nodeIdentity(name, node);
    if (!identity.version) throw new Error(`dependency ${identity.name} is missing an exact version`);

    if (identity.version.startsWith("link:")) {
      const workspaceRef = workspaceByName.get(identity.name);
      if (!workspaceRef) throw new Error(`workspace dependency ${identity.name} cannot be resolved`);
      return workspaceRef;
    }

    const ref = npmPurl(identity.name, identity.version);
    if (!components.has(ref)) {
      components.set(ref, {
        type: "library",
        "bom-ref": ref,
        name: identity.name,
        version: identity.version,
        purl: ref,
        properties: [{ name: "pos-platform:first-party", value: "false" }],
      });
      edges.set(ref, new Set());
    }

    if (expanding.has(ref)) return ref;
    expanding.add(ref);
    try {
      for (const dependency of dependencyEntries(node)) {
        const childRef = registerNode(dependency.name, dependency.value);
        edges.get(ref).add(childRef);
      }
    } finally {
      expanding.delete(ref);
    }
    return ref;
  }

  const projectByName = new Map(projects.map((project) => [project.name, project]));
  for (const workspace of workspaceManifests) {
    const workspaceName = sbomWorkspaceIdentity(workspace.manifestPath, workspace.manifest);
    const workspaceRef = workspaceByName.get(workspaceName);
    const project = projectByName.get(workspace.manifest.name)
      ?? (workspace.manifestPath === "package.json" ? projects.find((item) => item.path && !item.path.includes("/packages/") && !item.path.includes("/tools/") && !item.path.includes("/apps/")) : null);

    if (!project) {
      const declared = dependencyEntries(workspace.manifest);
      if (declared.length > 0) throw new Error(`pnpm graph is missing workspace ${workspaceName}`);
      continue;
    }

    for (const dependency of dependencyEntries(project)) {
      const dependencyRef = registerNode(dependency.name, dependency.value);
      edges.get(workspaceRef).add(dependencyRef);
    }
  }

  const rootManifest = workspaceManifests.find((entry) => entry.manifestPath === "package.json");
  if (!rootManifest) throw new Error("root package.json is missing from workspace manifests");
  const rootRef = workspaceByName.get(sbomWorkspaceIdentity("package.json", rootManifest.manifest));
  for (const [manifestPath, ref] of workspaceRefsByPath) {
    if (manifestPath !== "") edges.get(rootRef).add(ref);
  }

  const sortedComponents = [...components.values()].sort((a, b) =>
    a["bom-ref"].localeCompare(b["bom-ref"]),
  );
  const dependencies = [...edges.entries()]
    .map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() }))
    .sort((a, b) => a.ref.localeCompare(b.ref));

  const bom = {
    bomFormat: "CycloneDX",
    specVersion: CYCLONEDX_SPEC_VERSION,
    version: 1,
    metadata: {
      tools: {
        components: [{
          type: "application",
          name: "pos-platform-cyclonedx-generator",
          version: GENERATOR_VERSION,
        }],
      },
      component: components.get(rootRef),
      properties: [
        { name: "pos-platform:repository", value: repository },
        { name: "pos-platform:source-commit", value: sourceCommit },
        { name: "pos-platform:package-manager", value: "pnpm@9.15.0" },
        { name: "pos-platform:lockfile-sha256", value: lockfileSha256 },
      ],
    },
    components: sortedComponents.filter((component) => component["bom-ref"] !== rootRef),
    dependencies,
  };

  validateCycloneDxBom(bom, {
    expectedSourceCommit: sourceCommit,
    expectedWorkspaceCount: workspaceManifests.length,
  });
  return bom;
}

export function validateCycloneDxBom(bom, { expectedSourceCommit, expectedWorkspaceCount } = {}) {
  if (bom?.bomFormat !== "CycloneDX" || bom?.specVersion !== CYCLONEDX_SPEC_VERSION || bom?.version !== 1) {
    throw new Error("SBOM must be CycloneDX 1.6 with document version 1");
  }
  const allComponents = [bom.metadata?.component, ...(bom.components ?? [])].filter(Boolean);
  if (allComponents.length === 0) throw new Error("SBOM component graph is empty");

  const refs = new Set();
  for (const component of allComponents) {
    if (!component["bom-ref"] || !component.name || !component.version || !component.purl) {
      throw new Error("every SBOM component requires bom-ref, name, version and purl");
    }
    if (refs.has(component["bom-ref"])) throw new Error(`duplicate bom-ref: ${component["bom-ref"]}`);
    if (component["bom-ref"] !== component.purl) throw new Error("bom-ref and purl must use the same canonical identity");
    refs.add(component["bom-ref"]);
  }

  const dependencyRefs = new Set();
  for (const relationship of bom.dependencies ?? []) {
    if (!refs.has(relationship.ref)) throw new Error(`unknown dependency source: ${relationship.ref}`);
    if (dependencyRefs.has(relationship.ref)) throw new Error(`duplicate dependency relationship: ${relationship.ref}`);
    dependencyRefs.add(relationship.ref);
    for (const target of relationship.dependsOn ?? []) {
      if (!refs.has(target)) throw new Error(`unknown dependency target: ${target}`);
    }
  }
  if (dependencyRefs.size !== refs.size) throw new Error("every component must have one dependency relationship entry");

  const properties = new Map((bom.metadata?.properties ?? []).map((item) => [item.name, item.value]));
  if (expectedSourceCommit && properties.get("pos-platform:source-commit") !== expectedSourceCommit) {
    throw new Error("SBOM source commit does not match the reviewed SHA");
  }
  const workspaceCount = allComponents.filter((component) =>
    component.properties?.some((item) => item.name === "pos-platform:first-party" && item.value === "true"),
  ).length;
  if (expectedWorkspaceCount !== undefined && workspaceCount !== expectedWorkspaceCount) {
    throw new Error(`SBOM workspace coverage mismatch: expected ${expectedWorkspaceCount}, found ${workspaceCount}`);
  }
  if (allComponents.length <= workspaceCount) throw new Error("SBOM contains no third-party dependency components");

  return { componentCount: allComponents.length, workspaceCount, relationshipCount: dependencyRefs.size };
}

export function serializeBom(bom) {
  return `${JSON.stringify(bom, null, 2)}\n`;
}

function main() {
  const root = process.cwd();
  const sourceCommit = process.env.REVIEWED_SHA ?? process.env.GITHUB_SHA;
  const lockfile = readFileSync(path.join(root, "pnpm-lock.yaml"));
  const execution = spawnPnpm(["list", "--json", "--recursive", "--depth", "Infinity"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (execution.error) throw execution.error;
  if (execution.status !== 0) {
    throw new Error(`pnpm list failed with exit code ${execution.status}: ${execution.stderr.trim()}`);
  }

  let projects;
  try {
    projects = JSON.parse(execution.stdout);
  } catch {
    throw new Error("pnpm list did not return valid JSON");
  }

  const manifestPaths = discoverWorkspaceManifestPaths(root);
  const workspaceManifests = manifestPaths.map((manifestPath) => ({
    manifestPath,
    manifest: readWorkspaceManifest(root, manifestPath),
  }));
  const bom = buildCycloneDxBom({
    projects,
    workspaceManifests,
    sourceCommit,
    lockfileSha256: sha256(lockfile),
  });
  const serialized = serializeBom(bom);
  const digest = sha256(serialized);
  const outputDirectory = path.join(root, "artifacts", "ci");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(path.join(outputDirectory, "bom.cdx.json"), serialized, "utf8");
  writeFileSync(path.join(outputDirectory, "bom.cdx.json.sha256"), `${digest}  bom.cdx.json\n`, "utf8");

  const validation = validateCycloneDxBom(bom, {
    expectedSourceCommit: sourceCommit,
    expectedWorkspaceCount: workspaceManifests.length,
  });
  console.log(
    `CycloneDX SBOM PASS: ${validation.componentCount} components, ${validation.workspaceCount} workspaces, ${validation.relationshipCount} relationship entries, sha256=${digest}.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

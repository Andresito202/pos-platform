import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnPnpm } from "./pnpm-exec.mjs";
import {
  discoverWorkspaceManifestPaths,
  readWorkspaceManifest,
  workspaceIdentity,
} from "./workspace-manifests.mjs";

export function collectDirectDependencies(root, manifestPaths = discoverWorkspaceManifestPaths(root)) {
  const direct = new Map();

  for (const manifestPath of manifestPaths) {
    const manifest = readWorkspaceManifest(root, manifestPath);
    const workspace = workspaceIdentity(manifestPath, manifest);

    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, version] of Object.entries(manifest[section] ?? {})) {
        if (typeof version !== "string" || version.startsWith("workspace:")) continue;
        const key = `${name}@${version}`;
        const current = direct.get(key) ?? [];
        current.push({ workspace, manifestPath, section });
        direct.set(key, current);
      }
    }
  }

  return direct;
}

function walkForPackageJson(directory, results) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkForPackageJson(fullPath, results);
    } else if (entry.isFile() && entry.name === "package.json") {
      results.push(fullPath);
    }
  }
}

/**
 * Only inspect package-root manifests in pnpm's virtual store. Nested fixtures,
 * benchmarks and test projects inside a dependency are not installed packages.
 */
export function isInstalledPackageManifest(packageJsonPath, pnpmStore) {
  const relative = path.relative(pnpmStore, packageJsonPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const segments = relative.split(path.sep);
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0) return false;
  const packageSegments = segments.slice(nodeModulesIndex + 1);
  if (packageSegments.length === 2 && packageSegments[1] === "package.json") return true;
  return packageSegments.length === 3
    && packageSegments[0].startsWith("@")
    && packageSegments[2] === "package.json";
}

export function collectDependencyGraphKeys(projects) {
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error("pnpm dependency graph must contain at least one project");
  }

  const keys = new Set();
  const visited = new Set();

  function visitContainer(container) {
    if (!container || typeof container !== "object" || visited.has(container)) return;
    visited.add(container);

    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [declaredName, node] of Object.entries(container[section] ?? {})) {
        if (!node || typeof node !== "object") {
          throw new Error(`pnpm graph entry ${declaredName} is invalid`);
        }
        const name = typeof node.from === "string" && node.from ? node.from : declaredName;
        const version = typeof node.version === "string" ? node.version : null;
        if (!version) throw new Error(`pnpm graph dependency ${name} is missing an exact version`);
        if (!version.startsWith("link:")) keys.add(`${name}@${version}`);
        visitContainer(node);
      }
    }
  }

  for (const project of projects) visitContainer(project);
  if (keys.size === 0) throw new Error("pnpm dependency graph contains no third-party package identities");
  return keys;
}

export function normalizedLicense(manifest) {
  if (typeof manifest.license === "string" && manifest.license.trim()) return manifest.license.trim();
  if (manifest.license && typeof manifest.license.type === "string") return manifest.license.type.trim();
  if (Array.isArray(manifest.licenses)) {
    const values = manifest.licenses
      .map((license) => (typeof license === "string" ? license : license?.type))
      .filter((license) => typeof license === "string" && license.trim())
      .map((license) => license.trim());
    if (values.length > 0) return values.join(" OR ");
  }
  return null;
}

export function generateDependencyInventory(root, env = process.env, activePackageKeys = null) {
  const pnpmStore = path.join(root, "node_modules", ".pnpm");
  if (!existsSync(pnpmStore)) {
    throw new Error("Dependency inventory requires a completed pnpm install. node_modules/.pnpm was not found.");
  }

  const manifestPaths = discoverWorkspaceManifestPaths(root);
  const directDependencies = collectDirectDependencies(root, manifestPaths);
  const packageJsonPaths = [];
  walkForPackageJson(pnpmStore, packageJsonPaths);
  const installedPackageJsonPaths = packageJsonPaths.filter((manifestPath) =>
    isInstalledPackageManifest(manifestPath, pnpmStore),
  );

  const packages = new Map();
  const reviewFindings = [];
  const restrictedLicensePattern = /\b(?:AGPL(?:-\d+(?:\.\d+)?)?|GPL(?:-\d+(?:\.\d+)?)?|LGPL(?:-\d+(?:\.\d+)?)?|SSPL(?:-\d+(?:\.\d+)?)?|BUSL(?:-\d+(?:\.\d+)?)?|UNLICENSED)\b|Commons Clause/i;

  for (const packageJsonPath of installedPackageJsonPaths) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    } catch {
      reviewFindings.push({
        package: path.relative(root, packageJsonPath),
        reason: "UNREADABLE_OR_INVALID_PACKAGE_MANIFEST",
      });
      continue;
    }

    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") continue;

    const key = `${manifest.name}@${manifest.version}`;
    if (activePackageKeys && !activePackageKeys.has(key)) continue;
    if (packages.has(key)) continue;

    const license = normalizedLicense(manifest);
    const directScopes = directDependencies.get(key) ?? [];
    const item = {
      name: manifest.name,
      version: manifest.version,
      license,
      direct: directScopes.length > 0,
      directScopes,
    };
    packages.set(key, item);

    if (!license) {
      reviewFindings.push({ package: key, reason: "MISSING_LICENSE_METADATA" });
    } else if (restrictedLicensePattern.test(license)) {
      reviewFindings.push({ package: key, reason: "RESTRICTED_LICENSE_REQUIRES_REVIEW", license });
    }
  }

  const sortedPackages = [...packages.values()].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    return byName !== 0 ? byName : a.version.localeCompare(b.version);
  });

  return {
    schema: "pos-platform-dependency-inventory/v1",
    sourceCommit: env.REVIEWED_SHA ?? env.GITHUB_SHA ?? null,
    packageManager: "pnpm@9.15.0",
    generatedAt: new Date().toISOString(),
    workspaceManifestCount: manifestPaths.length,
    workspaceManifests: manifestPaths,
    packageCount: sortedPackages.length,
    directPackageCount: sortedPackages.filter((item) => item.direct).length,
    reviewFindingCount: reviewFindings.length,
    reviewFindings,
    packages: sortedPackages,
    limitations: [
      "This is a CI dependency/license inventory, not a standards-compliant SBOM.",
      "License metadata is package-declared metadata and is not a legal approval or compatibility opinion.",
      "A dedicated SBOM and license-compliance gate remains required before TECH-004 can be DONE.",
    ],
  };
}

function main() {
  const root = process.cwd();
  const outputDirectory = path.join(root, "artifacts", "ci");
  const outputPath = path.join(outputDirectory, "dependency-inventory.json");

  let inventory;
  try {
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
    const activePackageKeys = collectDependencyGraphKeys(projects);
    inventory = generateDependencyInventory(root, process.env, activePackageKeys);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");

  if (inventory.packageCount === 0) {
    console.error("Dependency inventory found zero installed packages; refusing to report a false PASS.");
    process.exitCode = 1;
    return;
  }

  if (inventory.reviewFindingCount > 0) {
    console.error(`Dependency inventory requires review for ${inventory.reviewFindingCount} package(s).`);
    for (const finding of inventory.reviewFindings) {
      console.error(`- ${finding.package}: ${finding.reason}${finding.license ? ` (${finding.license})` : ""}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Dependency inventory PASS: ${inventory.packageCount} packages, ${inventory.directPackageCount} direct, ${inventory.workspaceManifestCount} workspace manifests, 0 license review findings.`,
  );
  console.log(`Inventory written to ${path.relative(root, outputPath)}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

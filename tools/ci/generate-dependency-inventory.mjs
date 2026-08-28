import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

function normalizedLicense(manifest) {
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

export function generateDependencyInventory(root, env = process.env) {
  const pnpmStore = path.join(root, "node_modules", ".pnpm");
  if (!existsSync(pnpmStore)) {
    throw new Error("Dependency inventory requires a completed pnpm install. node_modules/.pnpm was not found.");
  }

  const manifestPaths = discoverWorkspaceManifestPaths(root);
  const directDependencies = collectDirectDependencies(root, manifestPaths);
  const packageJsonPaths = [];
  walkForPackageJson(pnpmStore, packageJsonPaths);

  const packages = new Map();
  const reviewFindings = [];
  const restrictedLicensePattern = /\b(?:AGPL(?:-\d+(?:\.\d+)?)?|GPL(?:-\d+(?:\.\d+)?)?|LGPL(?:-\d+(?:\.\d+)?)?|SSPL(?:-\d+(?:\.\d+)?)?|BUSL(?:-\d+(?:\.\d+)?)?|UNLICENSED)\b|Commons Clause/i;

  for (const packageJsonPath of packageJsonPaths) {
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
    inventory = generateDependencyInventory(root);
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

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pnpmStore = path.join(root, 'node_modules', '.pnpm');
const outputDirectory = path.join(root, 'artifacts', 'ci');
const outputPath = path.join(outputDirectory, 'dependency-inventory.json');

if (!existsSync(pnpmStore)) {
  console.error('Dependency inventory requires a completed pnpm install. node_modules/.pnpm was not found.');
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function collectDirectDependencies() {
  const direct = new Map();
  const manifests = [
    ['package.json', 'root'],
    ['tools/target-migrations/package.json', '@pos-platform/target-migrations'],
  ];

  for (const [manifestPath, workspace] of manifests) {
    const manifest = readJson(path.join(root, manifestPath));
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, version] of Object.entries(manifest[section] ?? {})) {
        const key = `${name}@${version}`;
        const current = direct.get(key) ?? [];
        current.push({ workspace, section });
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
    } else if (entry.isFile() && entry.name === 'package.json') {
      results.push(fullPath);
    }
  }
}

function normalizedLicense(manifest) {
  if (typeof manifest.license === 'string' && manifest.license.trim()) {
    return manifest.license.trim();
  }
  if (manifest.license && typeof manifest.license.type === 'string') {
    return manifest.license.type.trim();
  }
  if (Array.isArray(manifest.licenses)) {
    const values = manifest.licenses
      .map((license) => (typeof license === 'string' ? license : license?.type))
      .filter((license) => typeof license === 'string' && license.trim())
      .map((license) => license.trim());
    if (values.length > 0) {
      return values.join(' OR ');
    }
  }
  return null;
}

const packageJsonPaths = [];
walkForPackageJson(pnpmStore, packageJsonPaths);

const directDependencies = collectDirectDependencies();
const packages = new Map();
const reviewFindings = [];
const restrictedLicensePattern = /\b(?:AGPL(?:-\d+(?:\.\d+)?)?|GPL(?:-\d+(?:\.\d+)?)?|LGPL(?:-\d+(?:\.\d+)?)?|SSPL(?:-\d+(?:\.\d+)?)?|BUSL(?:-\d+(?:\.\d+)?)?|UNLICENSED)\b|Commons Clause/i;

for (const packageJsonPath of packageJsonPaths) {
  let manifest;
  try {
    manifest = readJson(packageJsonPath);
  } catch {
    reviewFindings.push({
      package: path.relative(root, packageJsonPath),
      reason: 'UNREADABLE_OR_INVALID_PACKAGE_MANIFEST',
    });
    continue;
  }

  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    continue;
  }

  const key = `${manifest.name}@${manifest.version}`;
  if (packages.has(key)) {
    continue;
  }

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
    reviewFindings.push({ package: key, reason: 'MISSING_LICENSE_METADATA' });
  } else if (restrictedLicensePattern.test(license)) {
    reviewFindings.push({ package: key, reason: 'RESTRICTED_LICENSE_REQUIRES_REVIEW', license });
  }
}

const sortedPackages = [...packages.values()].sort((a, b) => {
  const byName = a.name.localeCompare(b.name);
  return byName !== 0 ? byName : a.version.localeCompare(b.version);
});

const inventory = {
  schema: 'pos-platform-dependency-inventory/v1',
  sourceCommit: process.env.REVIEWED_SHA ?? process.env.GITHUB_SHA ?? null,
  packageManager: 'pnpm@9.15.0',
  generatedAt: new Date().toISOString(),
  packageCount: sortedPackages.length,
  directPackageCount: sortedPackages.filter((item) => item.direct).length,
  reviewFindingCount: reviewFindings.length,
  reviewFindings,
  packages: sortedPackages,
  limitations: [
    'This is a CI dependency/license inventory, not a standards-compliant SBOM.',
    'License metadata is package-declared metadata and is not a legal approval or compatibility opinion.',
    'A dedicated SBOM and license-compliance gate remains required before TECH-004 can be DONE.',
  ],
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');

if (sortedPackages.length === 0) {
  console.error('Dependency inventory found zero installed packages; refusing to report a false PASS.');
  process.exit(1);
}

if (reviewFindings.length > 0) {
  console.error(`Dependency inventory requires review for ${reviewFindings.length} package(s).`);
  for (const finding of reviewFindings) {
    console.error(`- ${finding.package}: ${finding.reason}${finding.license ? ` (${finding.license})` : ''}`);
  }
  process.exit(1);
}

console.log(`Dependency inventory PASS: ${sortedPackages.length} packages, ${inventory.directPackageCount} direct, 0 license review findings.`);
console.log(`Inventory written to ${path.relative(root, outputPath)}.`);

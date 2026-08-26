import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const violations = [];

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function addViolation(message) {
  violations.push(message);
}

const exactSemver = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const manifestPaths = ['package.json', 'tools/target-migrations/package.json'];
const forbiddenLifecycleScripts = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
  'publish',
  'postpublish',
]);

for (const manifestPath of manifestPaths) {
  const manifest = readJson(manifestPath);

  if (manifest.private !== true) {
    addViolation(`${manifestPath}: package must remain private`);
  }

  for (const scriptName of Object.keys(manifest.scripts ?? {})) {
    if (forbiddenLifecycleScripts.has(scriptName)) {
      addViolation(`${manifestPath}: lifecycle script '${scriptName}' is forbidden in the current TARGET baseline`);
    }
  }

  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      if (!exactSemver.test(specifier)) {
        addViolation(`${manifestPath}: ${section}.${name} must use an exact SemVer version, found '${specifier}'`);
      }
    }
  }
}

const rootManifest = readJson('package.json');
if (rootManifest.packageManager !== 'pnpm@9.15.0') {
  addViolation(`package.json: packageManager must remain exactly 'pnpm@9.15.0'`);
}

const workspace = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8').replace(/\r\n/g, '\n').trim();
if (workspace !== 'packages:\n  - tools/*') {
  addViolation('pnpm-workspace.yaml: workspace scope changed; expand it only in an explicitly reviewed runtime/Nx change');
}

const lockfile = readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
if (!lockfile.startsWith("lockfileVersion: '9.0'\n")) {
  addViolation("pnpm-lock.yaml: expected lockfileVersion '9.0'");
}

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const sensitiveBasenames = new Set([
  '.env',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);
const sensitiveExtensions = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore']);

const secretPatterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-classic-token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['github-fine-grained-token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['openai-secret-key', /\bsk-(?:proj|org|svcacct)-[A-Za-z0-9_-]{20,}\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];

for (const relativePath of trackedFiles) {
  const base = path.basename(relativePath);
  const extension = path.extname(relativePath).toLowerCase();

  if (sensitiveBasenames.has(base) || sensitiveExtensions.has(extension)) {
    addViolation(`${relativePath}: sensitive credential/key file must not be tracked`);
    continue;
  }

  const buffer = readFileSync(path.join(root, relativePath));
  if (buffer.includes(0)) {
    continue;
  }

  const text = buffer.toString('utf8');
  for (const [patternName, pattern] of secretPatterns) {
    if (pattern.test(text)) {
      addViolation(`${relativePath}: matched secret pattern '${patternName}' (value intentionally not printed)`);
    }
  }
}

if (violations.length > 0) {
  console.error('Repository policy validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`Repository policy validation PASS (${trackedFiles.length} tracked files scanned).`);

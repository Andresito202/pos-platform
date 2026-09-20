import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { discoverWorkspaceManifestPaths } from './workspace-manifests.mjs';

const root = process.cwd();
const violations = [];

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function addViolation(message) {
  violations.push(message);
}

function patternFromFragments(...fragments) {
  return new RegExp(fragments.join(''));
}

const exactSemver = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const workspaceSpecifier = /^workspace:(?:\*|\^|~|(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;
const manifestPaths = discoverWorkspaceManifestPaths(root);
const governedWorkspaceNames = new Set(
  manifestPaths
    .filter((manifestPath) => manifestPath.startsWith('packages/') || manifestPath.startsWith('apps/'))
    .map((manifestPath) => readJson(manifestPath).name),
);
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
      const isGovernedWorkspaceReference = governedWorkspaceNames.has(name) && workspaceSpecifier.test(specifier);
      if (!exactSemver.test(specifier) && !isGovernedWorkspaceReference) {
        addViolation(`${manifestPath}: ${section}.${name} must use exact SemVer or a governed workspace: specifier, found '${specifier}'`);
      }
    }
  }
}

const rootManifest = readJson('package.json');
if (rootManifest.packageManager !== 'pnpm@9.15.0') {
  addViolation(`package.json: packageManager must remain exactly 'pnpm@9.15.0'`);
}

const workspace = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8').replace(/\r\n/g, '\n').trim();
const expectedWorkspace = 'packages:\n  - apps/*\n  - packages/*\n  - tools/*';
if (workspace !== expectedWorkspace) {
  addViolation('pnpm-workspace.yaml: workspace scope must match the reviewed ARCH-003 Nx roots');
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

/**
 * Etiquetas PEM que **no** contienen material privado.
 *
 * Una clave pública de raíz de confianza existe para distribuirse: es lo que
 * permite verificar contra una raíz conocida. Prohibirla por su extensión
 * confunde el continente con el contenido, y la prueba de que la heurística no
 * miraba el material es que un `.json` con un PEM incrustado pasaba sin
 * abrirse mientras el `.pem` de al lado se rechazaba sin leerse.
 */
const publicPemLabels = new Set(['PUBLIC KEY', 'CERTIFICATE']);

const pemBlock = /-----BEGIN ([A-Z0-9 ]+)-----[\r\n]+[A-Za-z0-9+/=\s]*?-----END \1-----/g;

/**
 * `true` sólo si el fichero **entero** son bloques PEM y **todos** son
 * públicos.
 *
 * Exige las dos cosas a la vez a propósito. Bastaría con «contiene un bloque
 * público» para que una clave privada anexada debajo entrase con él; aquí lo
 * que queda fuera de los bloques tiene que ser espacio en blanco y nada más,
 * así que anexar material lo convierte en violación en vez de en excepción.
 *
 * No es una lista de rutas permitidas: una ruta permitida deja de mirar el
 * contenido para siempre y admite cualquier cosa que después se escriba con
 * ese nombre. Esto vuelve a decidir con cada fichero y cada commit.
 */
function isExclusivelyPublicPem(buffer) {
  if (buffer.includes(0)) return false;
  const text = buffer.toString('utf8');
  let blocks = 0;
  for (const match of text.matchAll(pemBlock)) {
    if (!publicPemLabels.has(match[1])) return false;
    blocks += 1;
  }
  if (blocks === 0) return false;
  return text.replace(pemBlock, '').trim() === '';
}

const secretPatterns = [
  ['private-key', patternFromFragments('-'.repeat(5), 'BEGIN ', '(?:RSA |EC |OPENSSH )?', 'PRIVATE KEY', '-'.repeat(5))],
  ['aws-access-key', patternFromFragments('\\bA', 'KIA', '[0-9A-Z]{16}\\b')],
  ['github-classic-token', patternFromFragments('\\bgh', '[pousr]_', '[A-Za-z0-9]{30,}\\b')],
  ['github-fine-grained-token', patternFromFragments('\\bgithub', '_pat_', '[A-Za-z0-9_]{20,}\\b')],
  ['openai-secret-key', patternFromFragments('\\bs', 'k-', '(?:proj|org|svcacct)-', '[A-Za-z0-9_-]{20,}\\b')],
  ['slack-token', patternFromFragments('\\bx', 'ox[baprs]-', '[A-Za-z0-9-]{20,}\\b')],
  ['google-api-key', patternFromFragments('\\bAI', 'za', '[0-9A-Za-z_-]{35}\\b')],
  ['jwt', patternFromFragments('\\bey', 'J[A-Za-z0-9_-]{10,}\\.', '[A-Za-z0-9_-]{10,}\\.', '[A-Za-z0-9_-]{10,}\\b')],
];

function readTrackedRegularFile(relativePath) {
  const absolutePath = path.join(root, relativePath);
  let fileDescriptor;

  try {
    fileDescriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(fileDescriptor);
    if (!stats.isFile()) {
      addViolation(`${relativePath}: tracked entry must resolve to a regular non-symlink file`);
      return null;
    }
    return readFileSync(fileDescriptor);
  } catch {
    addViolation(`${relativePath}: tracked entry could not be opened as a regular non-symlink file`);
    return null;
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
  }
}

for (const relativePath of trackedFiles) {
  const base = path.basename(relativePath);
  const extension = path.extname(relativePath).toLowerCase();

  // Los nombres de la lista son nombres de clave privada por convención
  // (`id_rsa`, `id_ed25519`): no existe un fichero público que se llame así,
  // de modo que **no** admiten excepción por contenido.
  if (sensitiveBasenames.has(base)) {
    addViolation(`${relativePath}: sensitive credential/key file must not be tracked`);
    continue;
  }

  const buffer = readTrackedRegularFile(relativePath);
  if (buffer === null) continue;

  if (sensitiveExtensions.has(extension) && !isExclusivelyPublicPem(buffer)) {
    addViolation(`${relativePath}: sensitive credential/key file must not be tracked`);
    continue;
  }

  // Sin `continue` cuando se admite: un fichero que entra por ser público
  // sigue pasando por el escaneo de contenido de abajo, que es el que caza una
  // clave privada de verdad. La regla de extensión nunca fue la única.
  if (buffer.includes(0)) continue;

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

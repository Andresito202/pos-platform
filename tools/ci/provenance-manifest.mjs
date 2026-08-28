import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'pos-platform-provenance-manifest/v1';
const INDEX_SCHEMA = 'pos-platform-provenance-source-index/v1';
const ROLES = ['target', 'inventory', 'vulnerability', 'sbom', 'license', 'codeql'];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sha256File = (file) => sha256(readFileSync(file));

function assertSha(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(label + ' is invalid');
}

function walk(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('missing evidence directory: ' + root);
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(child));
    else if (entry.isFile()) out.push(child);
    else throw new Error('non-regular evidence entry: ' + child);
  }
  return out.sort();
}

function one(dir, suffix, label) {
  const matches = walk(dir).filter((file) => file.endsWith(suffix));
  if (matches.length !== 1) throw new Error(label + ' expected exactly one file');
  return matches[0];
}

function readJson(file, label) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(label + ' is not valid JSON'); }
}

function rel(root, file) {
  const value = path.relative(root, file).split(path.sep).join('/');
  if (!value || value.startsWith('../') || path.isAbsolute(value)) throw new Error('evidence path escaped root');
  return value;
}

function record(root, file) {
  return { path: rel(root, file), sha256: sha256File(file), size: statSync(file).size };
}

function companion(file, checksum) {
  const expected = readFileSync(checksum, 'utf8').trim().split(/\s+/)[0];
  assertSha(expected, /^[0-9a-f]{64}$/, 'companion digest');
  const actual = sha256File(file);
  if (actual !== expected) throw new Error(path.basename(file) + ' checksum mismatch');
  return actual;
}

function sourceCommitFromSbom(bom) {
  const props = bom && bom.metadata && Array.isArray(bom.metadata.properties) ? bom.metadata.properties : [];
  const item = props.find((entry) => entry.name === 'pos-platform:source-commit');
  return item ? item.value : null;
}

function roleItem(index, role) {
  const matches = index.artifacts.filter((item) => item.role === role);
  if (matches.length !== 1) throw new Error('expected exactly one ' + role + ' artifact');
  return matches[0];
}

export function buildProvenanceManifest({ root, sourceIndex, metadata }) {
  if (!sourceIndex || sourceIndex.schema !== INDEX_SCHEMA || !Array.isArray(sourceIndex.artifacts)) throw new Error('invalid provenance source index');
  assertSha(metadata.reviewedSha, /^[0-9a-f]{40}$/, 'reviewed SHA');
  if (sourceIndex.reviewedSha !== metadata.reviewedSha) throw new Error('provenance index SHA mismatch');
  if (sourceIndex.targetRunId !== metadata.runId || sourceIndex.targetRunAttempt !== metadata.runAttempt) throw new Error('TARGET run identity mismatch');
  if (!Number.isInteger(sourceIndex.codeqlRunId) || sourceIndex.codeqlRunId <= 0) throw new Error('CodeQL run id is invalid');
  if (!Number.isInteger(metadata.runId) || metadata.runId <= 0 || !Number.isInteger(metadata.runAttempt) || metadata.runAttempt <= 0) throw new Error('TARGET run metadata is invalid');
  for (const value of [metadata.repository, metadata.branch, metadata.ref, metadata.event, metadata.workflowName, metadata.workflowRef, metadata.pnpmVersion, metadata.codeqlVersion, metadata.codeqlSha, metadata.uploadVersion, metadata.uploadSha, metadata.nativeReason]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('required provenance metadata is missing');
  }
  assertSha(metadata.codeqlSha, /^[0-9a-f]{40}$/, 'CodeQL action SHA');
  assertSha(metadata.uploadSha, /^[0-9a-f]{40}$/, 'upload-artifact SHA');
  if (metadata.nativeStatus !== 'BLOCKED_BY_PLATFORM') throw new Error('native attestation status must remain BLOCKED_BY_PLATFORM');

  const expectedNames = {
    target: 'target-exact-head-' + metadata.reviewedSha,
    inventory: 'target-dependency-inventory-' + metadata.reviewedSha,
    vulnerability: 'dependency-vulnerability-audit-' + metadata.reviewedSha,
    sbom: 'cyclonedx-sbom-' + metadata.reviewedSha,
    license: 'license-compatibility-' + metadata.reviewedSha,
    codeql: 'codeql-sarif-' + metadata.reviewedSha,
  };
  const byRole = new Map();
  for (const role of ROLES) {
    const item = roleItem(sourceIndex, role);
    assertSha(item.githubArtifactDigest, /^sha256:[0-9a-f]{64}$/, role + ' artifact digest');
    if (!Number.isInteger(item.artifactId) || item.artifactId <= 0) throw new Error(role + ' artifact id is invalid');
    if (item.name !== expectedNames[role]) throw new Error(role + ' artifact name mismatch');
    const expectedRun = role === 'codeql' ? sourceIndex.codeqlRunId : metadata.runId;
    if (item.workflowRunId !== expectedRun) throw new Error(role + ' workflow run mismatch');
    const directory = 'artifacts/ci/provenance-input/' + role;
    if (item.directory !== directory) throw new Error(role + ' directory mismatch');
    byRole.set(role, { ...item, absoluteDirectory: path.join(root, directory) });
  }

  const target = one(byRole.get('target').absoluteDirectory, 'target-exact-head-validation.md', 'TARGET evidence');
  const inventory = one(byRole.get('inventory').absoluteDirectory, 'dependency-inventory.json', 'inventory');
  const vuln = one(byRole.get('vulnerability').absoluteDirectory, 'dependency-vulnerability-evaluation.json', 'vulnerability report');
  const vulnRaw = one(byRole.get('vulnerability').absoluteDirectory, 'dependency-audit.json', 'vulnerability raw');
  const sbom = one(byRole.get('sbom').absoluteDirectory, 'bom.cdx.json', 'SBOM');
  const sbomSum = one(byRole.get('sbom').absoluteDirectory, 'bom.cdx.json.sha256', 'SBOM checksum');
  const license = one(byRole.get('license').absoluteDirectory, 'license-compatibility-report.json', 'license report');
  const licenseSum = one(byRole.get('license').absoluteDirectory, 'license-compatibility-report.json.sha256', 'license checksum');
  const sarif = walk(byRole.get('codeql').absoluteDirectory).filter((file) => file.endsWith('.sarif'));
  if (sarif.length === 0) throw new Error('CodeQL artifact contains no SARIF');

  if (readJson(inventory, 'inventory').sourceCommit !== metadata.reviewedSha) throw new Error('inventory source SHA mismatch');
  if (readJson(vuln, 'vulnerability report').sourceCommit !== metadata.reviewedSha) throw new Error('vulnerability source SHA mismatch');
  if (sourceCommitFromSbom(readJson(sbom, 'SBOM')) !== metadata.reviewedSha) throw new Error('SBOM source SHA mismatch');
  if (readJson(license, 'license report').sourceCommit !== metadata.reviewedSha) throw new Error('license source SHA mismatch');
  if (!readFileSync(target, 'utf8').includes('reviewed_sha: ' + metadata.reviewedSha)) throw new Error('TARGET evidence SHA mismatch');

  const lockfile = path.join(root, 'pnpm-lock.yaml');
  if (!existsSync(lockfile)) throw new Error('pnpm-lock.yaml is missing');
  const sarifRecords = sarif.map((file) => record(root, file));
  const sarifAggregate = sha256(sarifRecords.map((item) => item.path + ':' + item.sha256).join('\n'));

  const manifest = {
    schema: SCHEMA,
    generator: { name: 'pos-platform-provenance-generator', version: '1.0.0' },
    repository: metadata.repository,
    source: { commit: metadata.reviewedSha, branch: metadata.branch, ref: metadata.ref, event: metadata.event },
    workflow: { name: metadata.workflowName, runId: metadata.runId, runAttempt: metadata.runAttempt, workflowRef: metadata.workflowRef, codeqlRunId: sourceIndex.codeqlRunId },
    tools: { node: process.version, pnpm: metadata.pnpmVersion, codeqlActionVersion: metadata.codeqlVersion, codeqlActionSha: metadata.codeqlSha, uploadArtifactVersion: metadata.uploadVersion, uploadArtifactSha: metadata.uploadSha },
    nativeAttestation: { status: metadata.nativeStatus, reason: metadata.nativeReason },
    digests: {
      lockfileSha256: sha256File(lockfile),
      targetEvidenceSha256: sha256File(target),
      dependencyInventorySha256: sha256File(inventory),
      vulnerabilityReportSha256: sha256File(vuln),
      vulnerabilityRawSha256: sha256File(vulnRaw),
      sbomSha256: companion(sbom, sbomSum),
      licenseReportSha256: companion(license, licenseSum),
      sarifAggregateSha256: sarifAggregate,
    },
    artifacts: ROLES.map((role) => ({ role, name: byRole.get(role).name, artifactId: byRole.get(role).artifactId, githubArtifactDigest: byRole.get(role).githubArtifactDigest, workflowRunId: byRole.get(role).workflowRunId })),
    files: { target: record(root, target), inventory: record(root, inventory), vulnerability: record(root, vuln), vulnerabilityRaw: record(root, vulnRaw), sbom: record(root, sbom), license: record(root, license), sarif: sarifRecords },
  };
  validateProvenanceManifest(manifest, { root, sourceIndex, metadata });
  return manifest;
}

export function validateProvenanceManifest(manifest, { root, sourceIndex, metadata }) {
  if (!manifest || manifest.schema !== SCHEMA || manifest.source?.commit !== metadata.reviewedSha) throw new Error('invalid provenance manifest identity');
  const indexed = new Map(sourceIndex.artifacts.map((item) => [item.role, item]));
  for (const artifact of manifest.artifacts || []) {
    const source = indexed.get(artifact.role);
    if (!source || source.artifactId !== artifact.artifactId || source.githubArtifactDigest !== artifact.githubArtifactDigest) throw new Error('artifact metadata mismatch for ' + artifact.role);
  }
  if ((manifest.artifacts || []).length !== ROLES.length) throw new Error('artifact coverage mismatch');

  const verify = (item, label) => {
    const file = path.join(root, item.path);
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(label + ' evidence file missing');
    if (statSync(file).size !== item.size) throw new Error(label + ' evidence size mismatch');
    const actual = sha256File(file);
    if (actual !== item.sha256) throw new Error(label + ' evidence digest mismatch');
    return actual;
  };
  const actual = {
    targetEvidenceSha256: verify(manifest.files.target, 'TARGET'),
    dependencyInventorySha256: verify(manifest.files.inventory, 'inventory'),
    vulnerabilityReportSha256: verify(manifest.files.vulnerability, 'vulnerability'),
    vulnerabilityRawSha256: verify(manifest.files.vulnerabilityRaw, 'vulnerability raw'),
    sbomSha256: verify(manifest.files.sbom, 'SBOM'),
    licenseReportSha256: verify(manifest.files.license, 'license'),
    lockfileSha256: sha256File(path.join(root, 'pnpm-lock.yaml')),
  };
  const sarif = manifest.files.sarif.map((item, index) => ({ ...item, sha256: verify(item, 'SARIF[' + index + ']') }));
  actual.sarifAggregateSha256 = sha256(sarif.map((item) => item.path + ':' + item.sha256).join('\n'));
  for (const [key, value] of Object.entries(actual)) {
    assertSha(manifest.digests?.[key], /^[0-9a-f]{64}$/, key);
    if (manifest.digests[key] !== value) throw new Error('provenance digest mismatch: ' + key);
  }
  return true;
}

export const serializeProvenanceManifest = (manifest) => JSON.stringify(manifest, null, 2) + '\n';

function main() {
  const root = process.cwd();
  const sourceIndex = readJson(path.join(root, 'artifacts/ci/provenance-source-index.json'), 'provenance source index');
  const metadata = {
    repository: process.env.GITHUB_REPOSITORY,
    reviewedSha: process.env.REVIEWED_SHA,
    branch: process.env.PROVENANCE_BRANCH,
    ref: process.env.GITHUB_REF,
    event: process.env.GITHUB_EVENT_NAME,
    workflowName: process.env.GITHUB_WORKFLOW,
    workflowRef: process.env.GITHUB_WORKFLOW_REF,
    runId: Number(process.env.GITHUB_RUN_ID),
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    pnpmVersion: process.env.PROVENANCE_PNPM_VERSION,
    codeqlVersion: process.env.PROVENANCE_CODEQL_VERSION,
    codeqlSha: process.env.PROVENANCE_CODEQL_SHA,
    uploadVersion: process.env.PROVENANCE_UPLOAD_VERSION,
    uploadSha: process.env.PROVENANCE_UPLOAD_SHA,
    nativeStatus: process.env.GITHUB_NATIVE_ATTESTATION_STATUS,
    nativeReason: process.env.GITHUB_NATIVE_ATTESTATION_REASON,
  };
  const manifest = buildProvenanceManifest({ root, sourceIndex, metadata });
  const serialized = serializeProvenanceManifest(manifest);
  const output = path.join(root, 'artifacts/ci/provenance-manifest.json');
  writeFileSync(output, serialized, 'utf8');
  writeFileSync(output + '.sha256', sha256(serialized) + '  provenance-manifest.json\n', 'utf8');
  console.log('Provenance manifest PASS: 6 source artifacts, ' + manifest.files.sarif.length + ' SARIF file(s), sha256=' + sha256(serialized) + '.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

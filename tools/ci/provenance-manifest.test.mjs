import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildProvenanceManifest, serializeProvenanceManifest, validateProvenanceManifest } from './provenance-manifest.mjs';

const SHA = 'a'.repeat(40);
const hash = (value) => createHash('sha256').update(value).digest('hex');

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'prov-'));
  writeFileSync(path.join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  const names = { target: 'target-exact-head-', inventory: 'target-dependency-inventory-', vulnerability: 'dependency-vulnerability-audit-', sbom: 'cyclonedx-sbom-', license: 'license-compatibility-', codeql: 'codeql-sarif-' };
  const roles = Object.keys(names);
  const artifacts = roles.map((role, i) => ({ role, name: names[role] + SHA, artifactId: i + 1, githubArtifactDigest: 'sha256:' + 'b'.repeat(64), workflowRunId: role === 'codeql' ? 200 : 100, directory: 'artifacts/ci/provenance-input/' + role }));
  for (const item of artifacts) mkdirSync(path.join(root, item.directory), { recursive: true });
  writeFileSync(path.join(root, artifacts[0].directory, 'target-exact-head-validation.md'), 'reviewed_sha: ' + SHA + '\n');
  writeFileSync(path.join(root, artifacts[1].directory, 'dependency-inventory.json'), JSON.stringify({ sourceCommit: SHA }));
  writeFileSync(path.join(root, artifacts[2].directory, 'dependency-audit.json'), '{}');
  writeFileSync(path.join(root, artifacts[2].directory, 'dependency-vulnerability-evaluation.json'), JSON.stringify({ sourceCommit: SHA }));
  const sbom = JSON.stringify({ metadata: { properties: [{ name: 'pos-platform:source-commit', value: SHA }] } });
  const sbomPath = path.join(root, artifacts[3].directory, 'bom.cdx.json');
  writeFileSync(sbomPath, sbom); writeFileSync(sbomPath + '.sha256', hash(sbom) + '  bom.cdx.json\n');
  const license = JSON.stringify({ sourceCommit: SHA });
  const licensePath = path.join(root, artifacts[4].directory, 'license-compatibility-report.json');
  writeFileSync(licensePath, license); writeFileSync(licensePath + '.sha256', hash(license) + '  license-compatibility-report.json\n');
  writeFileSync(path.join(root, artifacts[5].directory, 'javascript.sarif'), JSON.stringify({ version: '2.1.0', runs: [] }));
  const sourceIndex = { schema: 'pos-platform-provenance-source-index/v1', reviewedSha: SHA, targetRunId: 100, targetRunAttempt: 1, codeqlRunId: 200, artifacts };
  const metadata = { repository: 'Andresito202/pos-platform', reviewedSha: SHA, branch: 'feature', ref: 'refs/pull/15/merge', event: 'pull_request', workflowName: 'TARGET foundation validation', workflowRef: 'workflow-ref', runId: 100, runAttempt: 1, pnpmVersion: '9.15.0', codeqlVersion: '4.37.9', codeqlSha: 'c'.repeat(40), uploadVersion: '7.0.1', uploadSha: 'd'.repeat(40), nativeStatus: 'BLOCKED_BY_PLATFORM', nativeReason: 'PRIVATE_REPOSITORY_ENTERPRISE_CLOUD_PREREQUISITE_NOT_ESTABLISHED' };
  return { root, sourceIndex, metadata };
}

test('provenance is deterministic for identical evidence', () => { const f = fixture(); assert.equal(serializeProvenanceManifest(buildProvenanceManifest(f)), serializeProvenanceManifest(buildProvenanceManifest(f))); });
test('tamper changes are detected', () => { const f = fixture(); const m = buildProvenanceManifest(f); const p = path.join(f.root, m.files.target.path); writeFileSync(p, readFileSync(p, 'utf8') + 'tampered\n'); assert.throws(() => validateProvenanceManifest(m, f), /TARGET evidence (size|digest) mismatch/); });
test('artifact digest substitution is detected', () => { const f = fixture(); const m = buildProvenanceManifest(f); f.sourceIndex.artifacts[0].githubArtifactDigest = 'sha256:' + 'e'.repeat(64); assert.throws(() => validateProvenanceManifest(m, f), /artifact metadata mismatch for target/); });
test('missing source artifact fails closed', () => { const f = fixture(); f.sourceIndex.artifacts = f.sourceIndex.artifacts.filter((item) => item.role !== 'codeql'); assert.throws(() => buildProvenanceManifest(f), /exactly one codeql artifact/); });

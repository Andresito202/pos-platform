import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateDependencyAudit,
  validateVulnerabilityPolicy,
} from "./validate-dependency-audit.mjs";

const now = new Date("2026-08-28T12:00:00Z");

function policy(exceptions = []) {
  return {
    schema: "pos-platform-dependency-vulnerability-policy/v1",
    blockingSeverities: ["high", "critical"],
    exceptions,
  };
}

function report(advisories = {}) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  // Como pnpm: se cuentan hallazgos, no avisos. El helper sumaba uno por aviso
  // y, como todas las fixtures tenían un solo hallazgo, ocultaba el defecto.
  for (const advisory of Object.values(advisories)) {
    counts[advisory.severity] += advisory.findings.length;
  }
  return { advisories, metadata: { vulnerabilities: counts } };
}

function advisory(severity, version = "1.2.3", id = "GHSA-aaaa-bbbb-cccc") {
  return {
    id: 100,
    github_advisory_id: id,
    module_name: "example-package",
    title: "Example advisory",
    url: `https://github.com/advisories/${id}`,
    severity,
    findings: [{ version, paths: [".>example-package"], dev: false, optional: false, bundled: false }],
  };
}

test("accepts an empty valid audit report", () => {
  const result = evaluateDependencyAudit(report(), policy(), { now });
  assert.equal(result.advisoryCount, 0);
  assert.deepEqual(result.blocking, []);
});

test("records moderate and low vulnerabilities for triage without blocking", () => {
  const result = evaluateDependencyAudit(
    report({ 1: advisory("moderate"), 2: { ...advisory("low", "2.0.0", "GHSA-dddd-eeee-ffff"), id: 101 } }),
    policy(),
    { now },
  );
  assert.equal(result.blocking.length, 0);
  assert.equal(result.triage.length, 2);
});

test("blocks high and critical vulnerabilities without an exception", () => {
  const result = evaluateDependencyAudit(
    report({ 1: advisory("high"), 2: { ...advisory("critical", "2.0.0", "GHSA-dddd-eeee-ffff"), id: 101 } }),
    policy(),
    { now },
  );
  assert.equal(result.blocking.length, 2);
});

test("accepts a scoped non-expired exception for the exact installed version", () => {
  const exception = {
    advisory: "GHSA-aaaa-bbbb-cccc",
    package: "example-package",
    affected_version: "1.2.3",
    reason: "No reachable vulnerable path in the current executable surface.",
    exploitability: "Reviewed against current trust boundaries and call graph.",
    owner: "security-owner",
    approved_at: "2026-08-28T11:00:00Z",
    expires_at: "2026-09-28T11:00:00Z",
    removal_condition: "Remove when the dependency is upgraded or the vulnerable path becomes reachable.",
  };
  const result = evaluateDependencyAudit(report({ 1: advisory("high") }), policy([exception]), { now });
  assert.equal(result.blocking.length, 0);
  assert.equal(result.acceptedExceptions.length, 1);
});

test("rejects expired exceptions", () => {
  const expired = {
    advisory: "GHSA-aaaa-bbbb-cccc",
    package: "example-package",
    affected_version: "1.2.3",
    reason: "Temporary exception.",
    exploitability: "Reviewed.",
    owner: "security-owner",
    approved_at: "2026-07-01T00:00:00Z",
    expires_at: "2026-08-01T00:00:00Z",
    removal_condition: "Upgrade dependency.",
  };
  assert.throws(() => validateVulnerabilityPolicy(policy([expired]), now), /expired/);
});

test("fails closed on registry/tool error output", () => {
  assert.throws(
    () => evaluateDependencyAudit({ error: { code: "ERR_PNPM_AUDIT_BAD_RESPONSE" } }, policy(), { now }),
    /registry\/tool error/,
  );
});

test("fails closed when metadata counts disagree with advisory evidence", () => {
  const malformed = report({ 1: advisory("high") });
  malformed.metadata.vulnerabilities.high = 0;
  assert.throws(() => evaluateDependencyAudit(malformed, policy(), { now }), /does not match advisories/);
});

test("policy cannot weaken the mandatory high and critical floor", () => {
  assert.throws(
    () => validateVulnerabilityPolicy({
      schema: "pos-platform-dependency-vulnerability-policy/v1",
      blockingSeverities: ["critical"],
      exceptions: [],
    }, now),
    /must include high/,
  );
});

/**
 * Regresión del 2026-09-11.
 *
 * `pnpm audit` emitió dos avisos `moderate` con **dos hallazgos cada uno** y
 * `metadata.vulnerabilities.moderate = 4`. El gate contaba avisos, veía 2, y
 * abortaba con «does not match advisories» **antes** de evaluar el aviso `high`
 * bloqueante del mismo informe: un fallo espurio que además escondía el real.
 */
test("cuenta hallazgos como pnpm, no avisos, cuando uno afecta a varios", () => {
  const multiFinding = {
    ...advisory("moderate"),
    findings: [
      { version: "4.1.10", paths: ["a>example-package"], dev: false, optional: false, bundled: false },
      { version: "4.1.10", paths: ["b>example-package"], dev: false, optional: false, bundled: false },
    ],
  };

  const evaluated = evaluateDependencyAudit(
    report({ 1: multiFinding, 2: { ...advisory("high", "1.6.1", "GHSA-7w5x-hrqm-74c2"), id: 101 } }),
    policy(),
    { now },
  );

  // Dos avisos, tres hallazgos: el `high` se evalúa y bloquea, que es lo que el
  // recuento equivocado impedía llegar a ver.
  assert.equal(evaluated.advisoryCount, 2);
  assert.equal(evaluated.severityCounts.moderate, 2);
  assert.equal(evaluated.blocking.length, 1);
  assert.equal(evaluated.blocking[0].severity, "high");
});

const KNOWN_SEVERITIES = Object.freeze(["info", "low", "moderate", "high", "critical"]);
const KNOWN_SEVERITY_SET = new Set(KNOWN_SEVERITIES);
const REQUIRED_EXCEPTION_FIELDS = Object.freeze([
  "advisory",
  "package",
  "affected_version",
  "reason",
  "exploitability",
  "owner",
  "approved_at",
  "expires_at",
  "removal_condition",
]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function parseUtcTimestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new TypeError(`${label} must be an RFC3339 UTC timestamp ending in Z`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new TypeError(`${label} must be a valid timestamp`);
  return timestamp;
}

export function validateVulnerabilityPolicy(policy, now = new Date()) {
  assertPlainObject(policy, "vulnerability policy");
  if (policy.schema !== "pos-platform-dependency-vulnerability-policy/v1") {
    throw new Error("unsupported vulnerability policy schema");
  }
  if (!Array.isArray(policy.blockingSeverities)) {
    throw new TypeError("blockingSeverities must be an array");
  }
  const severities = new Set(policy.blockingSeverities);
  for (const severity of severities) {
    if (!KNOWN_SEVERITY_SET.has(severity)) throw new Error(`unknown blocking severity: ${severity}`);
  }
  for (const mandatory of ["high", "critical"]) {
    if (!severities.has(mandatory)) throw new Error(`blockingSeverities must include ${mandatory}`);
  }

  if (!Array.isArray(policy.exceptions)) throw new TypeError("exceptions must be an array");
  const normalized = [];
  const identities = new Set();
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("now must be a valid date");

  for (const [index, exception] of policy.exceptions.entries()) {
    assertPlainObject(exception, `exceptions[${index}]`);
    const keys = Object.keys(exception).sort();
    const expected = [...REQUIRED_EXCEPTION_FIELDS].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expected)) {
      throw new Error(`exceptions[${index}] must contain exactly the reviewed fields`);
    }

    for (const field of ["advisory", "package", "affected_version", "reason", "exploitability", "owner", "removal_condition"]) {
      if (typeof exception[field] !== "string" || !exception[field].trim()) {
        throw new TypeError(`exceptions[${index}].${field} must be a non-empty string`);
      }
    }

    const approvedAt = parseUtcTimestamp(exception.approved_at, `exceptions[${index}].approved_at`);
    const expiresAt = parseUtcTimestamp(exception.expires_at, `exceptions[${index}].expires_at`);
    if (expiresAt <= approvedAt) throw new Error(`exceptions[${index}] must expire after approval`);
    if (expiresAt <= nowMs) throw new Error(`exceptions[${index}] is expired`);

    const identity = `${exception.advisory}|${exception.package}|${exception.affected_version}`;
    if (identities.has(identity)) throw new Error(`duplicate vulnerability exception: ${identity}`);
    identities.add(identity);
    normalized.push({ ...exception });
  }

  return {
    blockingSeverities: severities,
    exceptions: normalized,
  };
}

function advisoryIdentity(key, advisory) {
  if (typeof advisory.github_advisory_id === "string" && advisory.github_advisory_id.trim()) {
    return advisory.github_advisory_id.trim();
  }
  if (Array.isArray(advisory.cves) && typeof advisory.cves[0] === "string" && advisory.cves[0].trim()) {
    return advisory.cves[0].trim();
  }
  if (typeof advisory.id === "number" || typeof advisory.id === "string") return `PNPM-${advisory.id}`;
  return `PNPM-${key}`;
}

export function evaluateDependencyAudit(report, policy, options = {}) {
  assertPlainObject(report, "pnpm audit report");
  if ("error" in report) throw new Error("pnpm audit reported a registry/tool error");

  const validatedPolicy = validateVulnerabilityPolicy(policy, options.now ?? new Date());
  assertPlainObject(report.advisories, "pnpm audit report advisories");
  assertPlainObject(report.metadata, "pnpm audit report metadata");
  assertPlainObject(report.metadata.vulnerabilities, "pnpm audit report vulnerability counts");

  const observedCounts = Object.fromEntries(KNOWN_SEVERITIES.map((severity) => [severity, 0]));
  const advisories = [];
  const blocking = [];
  const triage = [];
  const acceptedExceptions = [];

  for (const [key, advisory] of Object.entries(report.advisories)) {
    assertPlainObject(advisory, `advisories.${key}`);
    if (!KNOWN_SEVERITY_SET.has(advisory.severity)) {
      throw new Error(`advisories.${key} has unknown severity`);
    }
    if (typeof advisory.module_name !== "string" || !advisory.module_name.trim()) {
      throw new TypeError(`advisories.${key}.module_name must be a non-empty string`);
    }
    if (!Array.isArray(advisory.findings) || advisory.findings.length === 0) {
      throw new Error(`advisories.${key} must contain at least one installed finding`);
    }

    const id = advisoryIdentity(key, advisory);
    observedCounts[advisory.severity] += 1;
    const versions = [...new Set(advisory.findings.map((finding, findingIndex) => {
      assertPlainObject(finding, `advisories.${key}.findings[${findingIndex}]`);
      if (typeof finding.version !== "string" || !finding.version.trim()) {
        throw new TypeError(`advisories.${key}.findings[${findingIndex}].version must be a non-empty string`);
      }
      return finding.version.trim();
    }))].sort();

    const normalized = {
      advisory: id,
      package: advisory.module_name.trim(),
      severity: advisory.severity,
      affected_versions: versions,
      title: typeof advisory.title === "string" ? advisory.title : "",
      url: typeof advisory.url === "string" ? advisory.url : "",
    };
    advisories.push(normalized);

    for (const version of versions) {
      const exception = validatedPolicy.exceptions.find((candidate) =>
        candidate.advisory === id
        && candidate.package === normalized.package
        && candidate.affected_version === version
      );

      if (validatedPolicy.blockingSeverities.has(advisory.severity)) {
        if (exception) {
          acceptedExceptions.push({ advisory: id, package: normalized.package, affected_version: version, expires_at: exception.expires_at });
        } else {
          blocking.push({ advisory: id, package: normalized.package, affected_version: version, severity: advisory.severity });
        }
      } else {
        triage.push({ advisory: id, package: normalized.package, affected_version: version, severity: advisory.severity });
      }
    }
  }

  for (const severity of KNOWN_SEVERITIES) {
    const reported = report.metadata.vulnerabilities[severity];
    if (!Number.isInteger(reported) || reported < 0) {
      throw new TypeError(`metadata.vulnerabilities.${severity} must be a non-negative integer`);
    }
    if (reported !== observedCounts[severity]) {
      throw new Error(`metadata.vulnerabilities.${severity} does not match advisories`);
    }
  }

  advisories.sort((a, b) => a.advisory.localeCompare(b.advisory));
  return {
    advisoryCount: advisories.length,
    severityCounts: observedCounts,
    advisories,
    blocking,
    triage,
    acceptedExceptions,
  };
}

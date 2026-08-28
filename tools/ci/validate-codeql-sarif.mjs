import fs from "node:fs";
import path from "node:path";

const HIGH_SECURITY_SEVERITY = 7;

function collectSarifFiles(targetPath) {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return targetPath.endsWith(".sarif") ? [targetPath] : [];
  return fs.readdirSync(targetPath, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(targetPath, entry.name);
    return entry.isDirectory() ? collectSarifFiles(child) : entry.name.endsWith(".sarif") ? [child] : [];
  });
}

export function evaluateSarifDocuments(documents) {
  let runs = 0;
  let results = 0;
  const blocking = [];

  for (const document of documents) {
    if (!document || typeof document !== "object" || !Array.isArray(document.runs)) {
      throw new TypeError("SARIF document must contain a runs array");
    }

    for (const run of document.runs) {
      runs += 1;
      const rules = new Map(
        (run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule]),
      );

      for (const result of run.results ?? []) {
        results += 1;
        const rule = rules.get(result.ruleId);
        const rawSecuritySeverity =
          result.properties?.["security-severity"]
          ?? rule?.properties?.["security-severity"];
        const securitySeverity =
          rawSecuritySeverity === undefined ? null : Number(rawSecuritySeverity);
        const level = result.level ?? rule?.defaultConfiguration?.level ?? "warning";

        if (
          level === "error"
          || (Number.isFinite(securitySeverity) && securitySeverity >= HIGH_SECURITY_SEVERITY)
        ) {
          blocking.push({
            rule_id: result.ruleId ?? "UNKNOWN_RULE",
            level,
            security_severity: securitySeverity,
          });
        }
      }
    }
  }

  if (runs === 0) throw new Error("SARIF evidence contains no analysis runs");

  return { runs, results, blocking };
}

function main() {
  const targetPath = process.argv[2];
  if (!targetPath) {
    console.error("Usage: node tools/ci/validate-codeql-sarif.mjs <sarif-file-or-directory>");
    process.exitCode = 2;
    return;
  }

  const files = collectSarifFiles(targetPath);
  if (files.length === 0) throw new Error("No SARIF files found");

  const documents = files.map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
  const summary = evaluateSarifDocuments(documents);

  console.log(
    `CodeQL SARIF policy evaluated ${files.length} file(s), ${summary.runs} run(s), ${summary.results} result(s), ${summary.blocking.length} blocking result(s).`,
  );

  if (summary.blocking.length > 0) {
    for (const finding of summary.blocking) {
      console.error(
        `::error::Blocking CodeQL finding rule=${finding.rule_id} level=${finding.level} security_severity=${finding.security_severity ?? "unset"}`,
      );
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSarifDocuments } from "./validate-codeql-sarif.mjs";

function sarif(results, rules = []) {
  return {
    version: "2.1.0",
    runs: [{ tool: { driver: { name: "CodeQL", rules } }, results }],
  };
}

test("accepts an empty CodeQL result set with an analysis run", () => {
  assert.deepEqual(evaluateSarifDocuments([sarif([])]), {
    runs: 1,
    results: 0,
    blocking: [],
  });
});

test("blocks high security severity inherited from the rule", () => {
  const summary = evaluateSarifDocuments([
    sarif(
      [{ ruleId: "js/example", level: "warning" }],
      [{ id: "js/example", properties: { "security-severity": "8.1" } }],
    ),
  ]);
  assert.equal(summary.blocking.length, 1);
  assert.equal(summary.blocking[0].rule_id, "js/example");
});

test("blocks SARIF error-level results even without security severity", () => {
  const summary = evaluateSarifDocuments([
    sarif([{ ruleId: "js/error", level: "error" }]),
  ]);
  assert.equal(summary.blocking.length, 1);
});

test("does not block medium findings while preserving their count", () => {
  const summary = evaluateSarifDocuments([
    sarif(
      [{ ruleId: "js/medium", level: "warning" }],
      [{ id: "js/medium", properties: { "security-severity": "5.5" } }],
    ),
  ]);
  assert.equal(summary.results, 1);
  assert.deepEqual(summary.blocking, []);
});

test("fails closed when no analysis run exists", () => {
  assert.throws(
    () => evaluateSarifDocuments([{ version: "2.1.0", runs: [] }]),
    /no analysis runs/,
  );
});

test("fails closed on malformed SARIF", () => {
  assert.throws(
    () => evaluateSarifDocuments([{ version: "2.1.0" }]),
    /runs array/,
  );
});

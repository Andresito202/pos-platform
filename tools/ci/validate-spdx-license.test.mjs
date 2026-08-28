import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSpdxLicenseExpression, parseSpdxExpression, validateLicensePolicy } from "./validate-spdx-license.mjs";

function policy() {
  return {
    schema:"pos-platform-license-compatibility-policy/v1",
    allow:{MIT:["preserve-license-text"],"Apache-2.0":["preserve-license-text"],"MPL-2.0":["preserve-license-text"]},
    review:["LGPL-3.0-only","NOASSERTION","NONE"],
    deny:["AGPL-3.0-only","AGPL-3.0-or-later","BUSL-1.1","GPL-2.0-only","GPL-2.0-or-later","GPL-3.0-only","GPL-3.0-or-later","SSPL-1.0","UNLICENSED"],
    allowWith:{"Apache-2.0 WITH LLVM-exception":["preserve-license-text"]},
  };
}
test("parses AND tighter than OR",()=>{ const ast=parseSpdxExpression("MIT OR Apache-2.0 AND MPL-2.0"); assert.equal(ast.type,"OR"); assert.equal(ast.right.type,"AND"); });
test("MIT OR GPL is ALLOW",()=>{ const r=evaluateSpdxLicenseExpression("MIT OR GPL-3.0-only",policy()); assert.equal(r.decision,"ALLOW"); assert.deepEqual(r.selected,["MIT"]); });
test("MIT AND GPL is DENY",()=>assert.equal(evaluateSpdxLicenseExpression("MIT AND GPL-3.0-only",policy()).decision,"DENY"));
test("unknown ids require review unless OR has ALLOW",()=>{
  assert.equal(evaluateSpdxLicenseExpression("Unknown-License",policy()).decision,"REVIEW_REQUIRED");
  assert.equal(evaluateSpdxLicenseExpression("Unknown-License OR MIT",policy()).decision,"ALLOW");
  assert.equal(evaluateSpdxLicenseExpression("Unknown-License AND MIT",policy()).decision,"REVIEW_REQUIRED");
});
test("WITH requires explicit reviewed combination",()=>{
  assert.equal(evaluateSpdxLicenseExpression("Apache-2.0 WITH LLVM-exception",policy()).decision,"ALLOW");
  assert.equal(evaluateSpdxLicenseExpression("Apache-2.0 WITH Classpath-exception-2.0",policy()).decision,"REVIEW_REQUIRED");
});
test("invalid expression is review-required",()=>assert.equal(evaluateSpdxLicenseExpression("MIT OR (",policy()).decision,"REVIEW_REQUIRED"));
test("mandatory deny floor cannot be weakened",()=>{
  const p=policy(); p.deny=p.deny.filter((id)=>id!=="GPL-3.0-only");
  assert.throws(()=>validateLicensePolicy(p),/deny floor must include GPL-3.0-only/);
});

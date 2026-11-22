import assert from "node:assert/strict";
import { test } from "node:test";
import { basename } from "node:path";
import { resolveNsisServiceArtifact } from "./resolve-nsis-service-artifact.mjs";

const root = "C:/synthetic/service-artifacts";
const interactive = "pos-local-service-0.0.0-win32-x64.tar.gz";
const scm = "pos-local-service-0.0.0-win32-x64-scm-candidate.tar.gz";

test("default selection remains INTERACTIVE when its artifact exists", () => {
  const result = resolveNsisServiceArtifact(root, undefined, path => basename(path) === interactive);
  assert.equal(result.profile, "INTERACTIVE");
  assert.equal(basename(result.artifact), interactive);
});

test("explicit INTERACTIVE selection remains supported", () => {
  const result = resolveNsisServiceArtifact(root, "INTERACTIVE", path => basename(path) === interactive);
  assert.equal(result.profile, "INTERACTIVE");
});

test("SCM_CANDIDATE only selects candidate even when interactive is also available", () => {
  const result = resolveNsisServiceArtifact(root, "SCM_CANDIDATE", () => true);
  assert.equal(result.profile, "SCM_CANDIDATE");
  assert.equal(basename(result.artifact), scm);
});

test("SCM_CANDIDATE fails closed when only INTERACTIVE exists", () => {
  assert.throws(
    () => resolveNsisServiceArtifact(root, "SCM_CANDIDATE", path => basename(path) === interactive),
    /SCM_CANDIDATE_ARTIFACT_MISSING/,
  );
});

test("INTERACTIVE fails when only SCM_CANDIDATE exists", () => {
  assert.throws(
    () => resolveNsisServiceArtifact(root, "INTERACTIVE", path => basename(path) === scm),
    /LOCAL_SERVICE_ARTIFACT_MISSING/,
  );
});

test("unknown profile cannot downgrade to INTERACTIVE", () => {
  assert.throws(
    () => resolveNsisServiceArtifact(root, "SCM_CANDIDATE ", () => true),
    /NSIS_SERVICE_PROFILE_REJECTED/,
  );
});

test("missing artifacts fail without mutations", () => {
  assert.throws(
    () => resolveNsisServiceArtifact(root, undefined, () => false),
    /LOCAL_SERVICE_ARTIFACT_MISSING/,
  );
});

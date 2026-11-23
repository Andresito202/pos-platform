import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCommercialNsisReleaseReady } from "../../apps/pos-desktop/scripts/assert-commercial-nsis-release.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const installer = join(root, "apps/pos-desktop/packaging/install-camacho-local-service.ps1");
const hook = join(root, "apps/pos-desktop/packaging/installer.nsh");
const pack = join(root, "apps/pos-desktop/scripts/pack-windows-nsis.mjs");
const ps = readFileSync(installer, "utf8");
const nsh = readFileSync(hook, "utf8");

test("commercial pack cannot downgrade to interactive or implicit profile", () => {
  assert.throws(() => assertCommercialNsisReleaseReady({}), /NSIS_COMMERCIAL_RELEASE_PROFILE_REQUIRED/);
  assert.throws(() => assertCommercialNsisReleaseReady({ POS_NSIS_RELEASE_PROFILE: "LAB" }), /NSIS_COMMERCIAL_RELEASE_PROFILE_REQUIRED/);
  assert.throws(() => assertCommercialNsisReleaseReady({ POS_NSIS_RELEASE_PROFILE: "COMMERCIAL" }), /NSIS_SCM_CANDIDATE_REQUIRED/);
  assert.throws(() => assertCommercialNsisReleaseReady({
    POS_NSIS_RELEASE_PROFILE: "COMMERCIAL", POS_NSIS_SERVICE_PROFILE: "INTERACTIVE",
  }), /NSIS_SCM_CANDIDATE_REQUIRED/);
});

test("untrusted environment flags cannot bypass commercial certification", () => {
  assert.throws(() => assertCommercialNsisReleaseReady({
    POS_NSIS_RELEASE_PROFILE: "COMMERCIAL",
    POS_NSIS_SERVICE_PROFILE: "SCM_CANDIDATE",
    POS_SCM_COMMERCIAL_READY: "true",
    POS_AUTHENTICODE_SIGNED: "true",
  }), /SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN/);
});

test("packer refuses before materializing desktop/NSIS resources", () => {
  const result = spawnSync(process.execPath, [pack], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, POS_NSIS_RELEASE_PROFILE: "COMMERCIAL", POS_NSIS_SERVICE_PROFILE: "SCM_CANDIDATE" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN/);
  assert.doesNotMatch(result.stderr, /PACK_WINDOWS_NSIS_DIST_MISSING/);
});

test("packaging hook cannot auto-install diagnostic or physical-prep service", () => {
  assert.match(nsh, /Abort "SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN"/);
  assert.doesNotMatch(nsh, /-Action Install|-Action PreparePhysicalCertification|-InstallProfile LAB/);
});

test("installer rejects before SCM or data mutations and has no sample defaults", () => {
  const install = ps.indexOf("  'Install' {");
  const guard = ps.indexOf("    Assert-CommercialProvisionReady", install);
  const marker = ps.indexOf("    Clear-ScmInstallOkMarker", install);
  assert.ok(install >= 0 && guard > install && marker > guard);
  assert.doesNotMatch(ps, /\[string\]\$(?:InstallationId|DeviceId|TenantId|CompanyId|BranchId)\s*=/);
  assert.doesNotMatch(ps, /return \(Join-Path \$env:ProgramData 'CamachoPOS\\lab-data'\)/);
  assert.match(ps, /COMMERCIAL_DATA_DIRECTORY_REQUIRED/);
  assert.match(ps, /COMMERCIAL_LAB_DIRECTORY_REJECTED/);
  assert.match(ps, /COMMERCIAL_IDENTITY_INVALID_OR_SAMPLE/);
  assert.match(ps, /SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN/);
  assert.match(ps, /\$ScmHandoffFile/);
  assert.match(ps, /\$ScmCentralProvisionFile/);
  assert.match(ps, /SCM_CENTRAL_PROVISION_REQUIRED/);
  assert.match(ps, /Apply-ScmProvisionEnv/);
  assert.match(ps, /__CAMACHO_POS_WINDOWS_SCM_HANDOFF_FILE__/);
  assert.match(ps, /__CAMACHO_POS_WINDOWS_SCM_CENTRAL_PROVISION_FILE__/);
});

test("physical certification prep is explicit, attested, and commercially gated", () => {
  assert.match(ps, /PreparePhysicalCertification/);
  assert.match(ps, /Assert-PhysicalCertificationAttestation/);
  assert.match(ps, /Assert-ScmProvisionBinding/);
  assert.match(ps, /SCM_HANDOFF_IDENTITY_MISMATCH/);
  assert.match(ps, /PHYSICAL_ATTESTATION_REQUIRED/);
  assert.match(ps, /PHYSICAL_PREP_UNEXPECTED_COMMERCIAL_START/);
  assert.match(ps, /physical-certification-prep\.ok/);
  assert.match(ps, /Grant-ServiceRuntimeAcls/);
  assert.match(ps, /SCM_PROVISION_ACL_TARGET_MISSING/);
  assert.match(ps, /expectedCommercialGateDenial/);
  assert.doesNotMatch(ps, /commercialReady\s*=\s*\$true|commercial_ready\s*=\s*true/);
  const prep = ps.indexOf("  'PreparePhysicalCertification' {");
  const install = ps.indexOf("  'Install' {");
  assert.ok(prep > install);
  assert.match(ps.slice(prep), /commercialGate = 'SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN'/);
});

test("staged WinSW template builder requires the authenticated SCM pair placeholders", async () => {
  const stage = readFileSync(join(root, "apps/pos-desktop/scripts/stage-nsis-service-payload.mjs"), "utf8");
  assert.match(stage, /POS_WINDOWS_SCM_HANDOFF_FILE/);
  assert.match(stage, /POS_WINDOWS_SCM_CENTRAL_PROVISION_FILE/);
  assert.match(stage, /SCM_CENTRAL_PROVISION_REQUIRED/);
  assert.match(stage, /WINSW_TEMPLATE_SCM_OR_LOGPATH_INCOMPLETE/);
  assert.match(stage, /<logpath>/);
  assert.doesNotMatch(stage, /POS_SCM_COMMERCIAL_READY|commercialLogin:\s*true/);
});

test("PowerShell helper parses without executing installation", { skip: process.platform !== "win32" }, () => {
  const literalPath = installer.replaceAll("'", "''");
  const cmd = `$tokens=$null; $errors=$null; $source=[IO.File]::ReadAllText('${literalPath}'); [void][System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors); if($errors.Count -ne 0){$errors | Out-String | Write-Error; exit 1}`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

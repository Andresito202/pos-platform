import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const helperPath = join(repo, "apps/pos-desktop/packaging/install-camacho-local-service.ps1");
const nsisPath = join(repo, "apps/pos-desktop/packaging/installer.nsh");
const helper = readFileSync(helperPath, "utf8");
const nsis = readFileSync(nsisPath, "utf8");

test("NSIS explicitly requests the LAB profile", () => {
  assert.match(nsis, /-Action Install -InstallProfile LAB -PayloadDir/);
  assert.doesNotMatch(nsis, /-Action Install -PayloadDir/);
});

test("installation profile is required; commercial preflight executes before marker and SCM mutation", () => {
  assert.match(helper, /\[ValidateSet\('LAB', 'COMMERCIAL'\)\]\[string\]\$InstallProfile,/);
  const install = helper.indexOf("  'Install' {");
  const check = helper.indexOf("if ($InstallProfile -eq 'COMMERCIAL') { Assert-CommercialInstallPreflight }", install);
  const marker = helper.indexOf("Clear-ScmInstallOkMarker", install);
  assert.ok(install >= 0 && check > install && marker > check);
  assert.match(helper, /INSTALL_PROFILE_REQUIRED/);
});

test("commercial preflight rejects missing, relative and lab data and sample identities", () => {
  for (const error of [
    "COMMERCIAL_DATA_DIRECTORY_REQUIRED",
    "COMMERCIAL_DATA_DIRECTORY_NOT_ABSOLUTE",
    "COMMERCIAL_LAB_DIRECTORY_REJECTED",
    "COMMERCIAL_SAMPLE_IDENTITY_REJECTED",
    "SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN",
  ]) assert.ok(helper.includes(error), error);
  assert.match(helper, /function Assert-CommercialInstallPreflight/);
});

test("PowerShell installer syntax parses on Windows", { skip: process.platform !== "win32" }, () => {
  const cmd = '$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($args[0],[ref]$tokens,[ref]$errors); if($errors.Count -ne 0){$errors | Out-String | Write-Error; exit 1}';
  const run = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd, helperPath], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

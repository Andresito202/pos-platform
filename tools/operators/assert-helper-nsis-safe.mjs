#!/usr/bin/env node
/**
 * Static gate: install-camacho-local-service.ps1 must stay nsExec-safe.
 * Observed failures under NSIS nsExec on windows-2022:
 *   - Get-FileHash → Microsoft.PowerShell.Utility
 *   - Get-Acl/Set-Acl → Microsoft.PowerShell.Security
 * Critical path must use System32 tools (sc/icacls/certutil) + BCL.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const helperPath = resolve(
  'apps/pos-desktop/packaging/install-camacho-local-service.ps1',
);
const nshPath = resolve('apps/pos-desktop/packaging/installer.nsh');
const helperRaw = readFileSync(helperPath, 'utf8');
const nsh = readFileSync(nshPath, 'utf8');
// Strip PowerShell block/line comments before forbidden scans.
const helper = helperRaw
  .replace(/<#[\s\S]*?#>/g, '')
  .replace(/^\s*#.*$/gm, '');

const forbidden = [
  { re: /\bGet-Acl\b/, why: 'Microsoft.PowerShell.Security fails under nsExec' },
  { re: /\bSet-Acl\b/, why: 'Microsoft.PowerShell.Security fails under nsExec' },
  { re: /\bGet-FileHash\b/, why: 'Microsoft.PowerShell.Utility often fails under nsExec' },
  { re: /\bGet-Service\b/, why: 'prefer sc.exe queryex under nsExec' },
  { re: /\bStop-Service\b/, why: 'prefer sc.exe stop under nsExec' },
  { re: /\bStart-Service\b/, why: 'prefer WinSW start / sc.exe start under nsExec' },
  { re: /\bGet-CimInstance\b/, why: 'prefer sc.exe qc for StartName under nsExec' },
  {
    re: /\b(Users|Everyone|Authenticated Users)\\/i,
    why: 'no broad ACL principals',
  },
];

const required = [
  { re: /icacls\.exe/, why: 'native ACL grant tool' },
  { re: /sc\.exe/, why: 'native SCM query/stop/delete' },
  { re: /certutil\.exe/, why: 'native SHA-256' },
  { re: /Resolve-System32Tool/, why: 'verified System32 paths' },
  { re: /Format-NativeArg/, why: 'quote paths with spaces for Start-Process' },
  { re: /Format-NativeArgumentList/, why: 'join quoted argv for native tools' },
  { re: /Assert-EffectiveAclViaIcacls/, why: 'effective ACL verification' },
  { re: /Clear-ScmInstallOkMarker/, why: 'stale marker cleanup' },
  { re: /NT SERVICE\\CamachoPOSLocalService|NT SERVICE\\\$serviceId/, why: 'virtual account identity' },
];

const nshForbidden = [
  { re: /\$COMMONAPPDATA/, why: 'unknown NSIS var → makensis warning 6000' },
];
const nshRequired = [
  { re: /\$INSTDIR\\resources\\service-payload\\scm-install\.ok/, why: 'INSTDIR marker' },
  { re: /Abort "WINSW_SCM_REGISTRATION_FAILED"/, why: 'fail-closed Abort' },
];

let failed = 0;
for (const f of forbidden) {
  if (f.re.test(helper)) {
    console.error(`FAIL forbidden ${f.re} (${f.why})`);
    failed++;
  } else {
    console.log(`PASS forbidden absent: ${f.re}`);
  }
}

for (const r of required) {
  if (!r.re.test(helperRaw)) {
    console.error(`FAIL required missing ${r.re} (${r.why})`);
    failed++;
  } else {
    console.log(`PASS required: ${r.re}`);
  }
}

for (const f of nshForbidden) {
  if (f.re.test(nsh) && !/; Do NOT use \$COMMONAPPDATA/.test(nsh)) {
    // comments mentioning the ban are OK if the only matches are comments
    const live = nsh.split(/\r?\n/).filter((l) => f.re.test(l) && !/^\s*;/.test(l));
    if (live.length) {
      console.error(`FAIL nsh forbidden ${f.re} (${f.why})`);
      failed++;
    } else {
      console.log(`PASS nsh forbidden only in comments: ${f.re}`);
    }
  } else if (f.re.test(nsh)) {
    const live = nsh.split(/\r?\n/).filter((l) => f.re.test(l) && !/^\s*;/.test(l));
    if (live.length) {
      console.error(`FAIL nsh forbidden live use ${f.re}`);
      failed++;
    } else {
      console.log(`PASS nsh forbidden only in comments: ${f.re}`);
    }
  } else {
    console.log(`PASS nsh forbidden absent: ${f.re}`);
  }
}

for (const r of nshRequired) {
  if (!r.re.test(nsh)) {
    console.error(`FAIL nsh required missing ${r.re} (${r.why})`);
    failed++;
  } else {
    console.log(`PASS nsh required: ${r.re}`);
  }
}

if (failed) {
  console.error(`assert-helper-nsis-safe FAILED checks=${failed}`);
  process.exit(1);
}
console.log('assert-helper-nsis-safe PASS');

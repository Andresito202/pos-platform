#!/usr/bin/env node
/**
 * nsExec-equivalent regression for Format-NativeArg quoting rules.
 * Mirrors the PowerShell helper logic so paths with spaces never reach
 * icacls/sc/certutil as split argv tokens (CI: Invalid parameter "Files\\Camacho").
 */
function formatNativeArg(value) {
  const v = String(value);
  if (!/[\s"&<>|()^]/.test(v)) return v;
  return `"${v.replace(/"/g, '""')}"`;
}

function formatNativeArgumentList(args) {
  return args.map(formatNativeArg).join(' ');
}

const cases = [
  {
    name: 'program-files path + SID grant',
    args: [
      'C:\\Program Files\\Camacho POS Colombia\\resources\\service-payload',
      '/grant',
      '*S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569:(OI)(CI)RX',
    ],
    expect:
      '"C:\\Program Files\\Camacho POS Colombia\\resources\\service-payload" /grant "*S-1-5-80-2399233179-3901739178-3110492099-2767556519-659945569:(OI)(CI)RX"',
  },
  {
    name: 'programdata path modify',
    args: [
      'C:\\ProgramData\\CamachoPOS\\lab-data',
      '/grant',
      '*S-1-5-80-1:(OI)(CI)M',
    ],
    expect: 'C:\\ProgramData\\CamachoPOS\\lab-data /grant "*S-1-5-80-1:(OI)(CI)M"',
  },
  {
    name: 'sc queryex no spaces',
    args: ['queryex', 'CamachoPOSLocalService'],
    expect: 'queryex CamachoPOSLocalService',
  },
  {
    name: 'certutil hashfile with spaces',
    args: [
      '-hashfile',
      'C:\\Program Files\\Camacho POS Colombia\\resources\\service-payload\\CamachoPOSLocalService.exe',
      'SHA256',
    ],
    expect:
      '-hashfile "C:\\Program Files\\Camacho POS Colombia\\resources\\service-payload\\CamachoPOSLocalService.exe" SHA256',
  },
];

let failed = 0;
for (const c of cases) {
  const got = formatNativeArgumentList(c.args);
  if (got !== c.expect) {
    console.error(`FAIL ${c.name}\n  got:    ${got}\n  expect: ${c.expect}`);
    failed++;
  } else {
    console.log(`PASS ${c.name}`);
  }
}

// Ensure Program Files path is always quoted (the CI failure mode).
const pf = formatNativeArg(
  'C:\\Program Files\\Camacho POS Colombia\\resources\\service-payload',
);
if (!pf.startsWith('"') || !pf.endsWith('"')) {
  console.error('FAIL Program Files path must be quoted');
  failed++;
} else {
  console.log('PASS Program Files path quoted');
}

if (failed) {
  console.error(`test-native-arg-quoting FAILED=${failed}`);
  process.exit(1);
}
console.log('test-native-arg-quoting PASS');

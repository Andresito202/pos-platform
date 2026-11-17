/**
 * Probe for REAL local-operator role-home captures (CAJERO / SUPERVISOR / ADMINISTRADOR).
 *
 * Does NOT use role-preview or visual-preview. On Linux this path is SKIP:
 * production start.bundle.mjs needs Windows DPAPI + named pipes; local-operator
 * auth store needs NODE_ENV=development while Linux service boot needs NODE_ENV=test;
 * LocalChannelComponent mounts only on win32.
 *
 * Exit 0 with status SKIP on Linux; on win32 prints that local-operator-live is the path.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = process.env.POS_E2E_AUDIT_DIRECTORY ?? "/opt/cursor/artifacts/bloque6";
mkdirSync(outDir, { recursive: true });

const result = {
  status: process.platform === "win32" ? "DEFER_TO_LOCAL_OPERATOR_LIVE" : "SKIP",
  platform: process.platform,
  requested: [
    { role: "CAJERO", home: "sale-panel", path: null },
    { role: "SUPERVISOR", home: "inventory", path: null },
    { role: "ADMINISTRADOR", home: "dashboard", path: null },
  ],
  captures_created: [],
  blockers:
    process.platform === "win32"
      ? []
      : [
          "POS Local Service production runtime requires Windows (main.ts; NODE_ENV=development)",
          "LOCAL_OPERATOR_AUTH_DEVELOPMENT_ONLY vs Linux requires NODE_ENV=test",
          "LocalChannelComponent only mounted on win32 — no local_channel_endpoint on Linux test boot",
          "POS_DESKTOP_PROVISIONING_FAILED: production desktop requires Windows named pipes + DPAPI",
          "real-service-host POSIX has no password-backed local.operator.login registry",
        ],
  observed_at: new Date().toISOString(),
  evidence_file: join(outDir, "ROLE_HOME_CAPTURE_SKIP.md"),
};

writeFileSync(join(outDir, "role-home-capture.status.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exit(0);

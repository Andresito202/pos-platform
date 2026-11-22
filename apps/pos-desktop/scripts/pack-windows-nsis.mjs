#!/usr/bin/env node
/**
 * Materializes the DEC-010 electron-builder + NSIS installer for Camacho POS.
 *
 * Prerequisites: `pnpm --filter @pos-platform/pos-desktop build` already run,
 * and `electron-builder` installed as a desktop devDependency.
 *
 * Does NOT claim Authenticode signing (RT-009-B BLOCKED). Does NOT disable
 * SCM/DPAPI/IPC. Exit codes:
 * - 0: installer artifact generated (unsigned unless cert configured externally)
 * - 2: electron-builder missing
 * - 3: desktop dist missing
 */
import { copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assertCommercialNsisReleaseReady } from "./assert-commercial-nsis-release.mjs";

// Fail before touching any staging files, invoking build tools, or producing EXEs.
assertCommercialNsisReleaseReady(process.env);

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");
const distEntry = join(desktop, "dist", "start.bundle.mjs");
const renderer = join(desktop, "dist", "renderer", "index.html");

if (!existsSync(distEntry) || !existsSync(renderer)) {
  console.error("PACK_WINDOWS_NSIS_DIST_MISSING: run pnpm --filter @pos-platform/pos-desktop build first");
  process.exit(3);
}

const stageScript = join(here, "stage-nsis-service-payload.mjs");
const stage = spawnSync(process.execPath, [stageScript], { cwd: desktop, stdio: "inherit" });
if (stage.status !== 0) {
  console.error("PACK_WINDOWS_NSIS_SERVICE_PAYLOAD_STAGE_FAILED");
  process.exit(stage.status === null ? 1 : stage.status);
}

const helperSrc = join(desktop, "packaging", "install-camacho-local-service.ps1");
const helperDest = join(desktop, "packaging", "service-payload", "install-camacho-local-service.ps1");
if (!existsSync(helperSrc)) {
  console.error("PACK_WINDOWS_NSIS_SERVICE_HELPER_MISSING");
  process.exit(4);
}
copyFileSync(helperSrc, helperDest);

const require = createRequire(join(desktop, "package.json"));
let builderBin;
try {
  builderBin = require.resolve("electron-builder/cli.js");
} catch {
  console.error(
    "PACK_WINDOWS_NSIS_BUILDER_MISSING: add electron-builder as a desktop devDependency to generate the NSIS artifact. Config is present at electron-builder.yml (DEC-010). Signing remains RT-009-B BLOCKED.",
  );
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  [builderBin, "--win", "nsis", "--x64", "--config", join(desktop, "electron-builder.yml")],
  { cwd: desktop, stdio: "inherit", env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } },
);
process.exit(result.status === null ? 1 : result.status);

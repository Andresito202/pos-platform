#!/usr/bin/env node
/**
 * Lab staging: bundle SERVICE enrollment into a short-path CJS under labRoot\bin
 * so NT SERVICE\CamachoPOSLocalService can run without RX on the full monorepo
 * (icacls /T on pnpm trees hits MAX_PATH and leaves the virtual account blocked).
 */
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync } from "node:fs";

const fail = (code) => {
  throw new Error(code);
};

const labRoot = process.argv[2];
if (typeof labRoot !== "string" || !/^[A-Za-z]:\\CamachoPosScmLab\\[a-f0-9]{32}$/i.test(labRoot) || resolve(labRoot) !== labRoot) {
  fail("LAB_ROOT_REJECTED");
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const entry = join(here, "windows-nsis-scm-commercial-enroll-service.mjs");
const outDir = join(labRoot, "bin");
const outfile = join(outDir, "enroll-service.cjs");
mkdirSync(outDir, { recursive: true });
if (existsSync(outfile)) fail("ENROLL_BUNDLE_EXISTS");

const requireFromService = createRequire(join(repo, "apps/pos-local-service/package.json"));
const esbuild = requireFromService("esbuild");

const result = await esbuild.build({
  absWorkingDir: repo,
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  logLevel: "silent",
  write: true,
  // Keep Node builtins external; pack workspace TS + zod into the short-path CJS.
  packages: "bundle",
});
if (result.errors?.length) fail("ENROLL_BUNDLE_FAILED");
if (!existsSync(outfile)) fail("ENROLL_BUNDLE_MISSING");
process.stdout.write(`${outfile}\n`);

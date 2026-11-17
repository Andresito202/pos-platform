#!/usr/bin/env node
/**
 * Stages WinSW + POS Local Service payload for electron-builder extraResources.
 *
 * Reuses:
 * - buildServiceDescriptor (commercialLogin=false — gate SCM_COMMERCIAL… preserved)
 * - Official WinSW v2.12.0 WinSW-x64.exe with pinned SHA-256 (05b82d46…)
 * - Existing LOCAL_SERVICE win32-x64 artifact from pos-local-service
 * - Official Node win-x64 zip pinned by SHA-256
 *
 * Does NOT embed secrets, fake Authenticode, or clear SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN.
 * Authenticode of Camacho product remains RT-009-B BLOCKED; WinSW official PE may be unsigned
 * (see docs/testing/windows-g1g2-physical-certification-plan). Lab install verifies hash, not BinaryReviewReady.
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");
const repo = join(desktop, "..", "..");
const outDir = join(desktop, "packaging", "service-payload");

const WINSW = {
  url: "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe",
  sha256: "05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da",
  version: "2.12.0",
};

// Node 22.19.0 matches CI setup-node pin in windows-nsis-installer-lab.yml.
const NODE = {
  version: "22.19.0",
  url: "https://nodejs.org/dist/v22.19.0/node-v22.19.0-win-x64.zip",
  // Official SHASUMS256.txt line for node-v22.19.0-win-x64.zip (verified at staging time).
  sha256: null, // filled after fetching SHASUMS256.txt
};

const SERVICE_ID = "CamachoPOSLocalService";

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`DOWNLOAD_FAILED:${url}:${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function resolveNodeSha() {
  const res = await fetch(`https://nodejs.org/dist/v${NODE.version}/SHASUMS256.txt`);
  if (!res.ok) throw new Error(`NODE_SHASUMS_FETCH_FAILED:${res.status}`);
  const text = await res.text();
  const line = text.split("\n").find((l) => l.includes(`node-v${NODE.version}-win-x64.zip`));
  if (!line) throw new Error("NODE_SHASUM_LINE_MISSING");
  const hash = line.trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("NODE_SHASUM_INVALID");
  NODE.sha256 = hash;
}

function extractZip(zipPath, destDir) {
  // Use PowerShell on Windows; unzip on Linux/mac for CI staging ahead of Windows pack.
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`],
      { stdio: "inherit" },
    );
    return;
  }
  execFileSync("unzip", ["-qo", zipPath, "-d", destDir], { stdio: "inherit" });
}

function extractTarGz(tarGz, destDir) {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    // tar is available on Windows 10+ / GHA windows-2022
    execFileSync("tar", ["-xzf", tarGz, "-C", destDir], { stdio: "inherit" });
    return;
  }
  execFileSync("tar", ["-xzf", tarGz, "-C", destDir], { stdio: "inherit" });
}

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const cache = join(desktop, "packaging", ".cache");
  mkdirSync(cache, { recursive: true });

  // --- WinSW ---
  const winswCache = join(cache, "WinSW-x64-2.12.0.exe");
  if (!existsSync(winswCache) || sha256(winswCache) !== WINSW.sha256) {
    await download(WINSW.url, winswCache);
  }
  if (sha256(winswCache) !== WINSW.sha256) throw new Error("WINSW_SHA256_MISMATCH");
  const winswOut = join(outDir, `${SERVICE_ID}.exe`);
  cpSync(winswCache, winswOut);

  // --- Node runtime ---
  await resolveNodeSha();
  const nodeZip = join(cache, `node-v${NODE.version}-win-x64.zip`);
  if (!existsSync(nodeZip) || sha256(nodeZip) !== NODE.sha256) {
    await download(NODE.url, nodeZip);
  }
  if (sha256(nodeZip) !== NODE.sha256) throw new Error("NODE_SHA256_MISMATCH");
  const nodeExtract = join(cache, `node-v${NODE.version}-win-x64`);
  rmSync(nodeExtract, { recursive: true, force: true });
  extractZip(nodeZip, cache);
  const nodeExe = join(nodeExtract, "node.exe");
  if (!existsSync(nodeExe)) throw new Error("NODE_EXE_MISSING_AFTER_EXTRACT");
  mkdirSync(join(outDir, "runtime"), { recursive: true });
  cpSync(nodeExe, join(outDir, "runtime", "node.exe"));

  // --- Local Service artifact ---
  // Prefer INTERACTIVE: SCM_CANDIDATE ships a structural native stub (512 B) and
  // commercialLogin remains gated. INTERACTIVE is the approved same-user channel.
  const artifactDir = join(repo, "apps", "pos-local-service", "dist");
  const interactiveArtifact = join(artifactDir, "pos-local-service-0.0.0-win32-x64.tar.gz");
  const scmArtifact = join(artifactDir, "pos-local-service-0.0.0-win32-x64-scm-candidate.tar.gz");
  const wantScm = process.env.POS_NSIS_SERVICE_PROFILE === "SCM_CANDIDATE";
  const artifact = wantScm && existsSync(scmArtifact) ? scmArtifact : interactiveArtifact;
  if (!existsSync(artifact)) {
    throw new Error(
      "LOCAL_SERVICE_ARTIFACT_MISSING: run POS_ARTIFACT_TARGET=win32-x64 pnpm --filter @pos-platform/pos-local-service build:artifact",
    );
  }
  const serviceExtract = join(outDir, "local-service");
  mkdirSync(serviceExtract, { recursive: true });
  extractTarGz(artifact, serviceExtract);
  const bundle = join(serviceExtract, "pos-local-service.mjs");
  if (!existsSync(bundle)) throw new Error("LOCAL_SERVICE_BUNDLE_MISSING_IN_ARTIFACT");

  // --- WinSW XML matching windows-service-descriptor.ts (commercialLogin=false) ---
  const buildServiceDescriptor = (input) => {
    if (input.commercialLogin === true) throw new Error("SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN");
    if (Object.hasOwn(input.environment, "POS_WINDOWS_COMMERCIAL_PROVISION_FILE")) {
      throw new Error("SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN");
    }
    const req = [
      "POS_DATA_DIRECTORY",
      "POS_INSTALLATION_ID",
      "POS_DEVICE_ID",
      "POS_SERVICE_VERSION",
      "POS_PROTOCOL_MIN",
      "POS_PROTOCOL_MAX",
      "POS_TENANT_ID",
      "POS_COMPANY_ID",
      "POS_BRANCH_ID",
    ];
    for (const k of req) if (!(k in input.environment)) throw new Error(`missing ${k}`);
    const esc = (s) =>
      String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    const envLines = req.map((k) => `  <env name="${k}" value="${esc(input.environment[k])}"/>`);
    return [
      "<service>",
      `  <id>${SERVICE_ID}</id>`,
      "  <name>Camacho POS Local Service</name>",
      "  <description>Autoridad local de Camacho POS: base de datos, caja, venta, pago y sincronizacion.</description>",
      `  <executable>${esc(input.nodeExecutable)}</executable>`,
      `  <arguments>${esc(`"${input.bundle}"`)}</arguments>`,
      `  <workingdirectory>${esc(input.workingDirectory)}</workingdirectory>`,
      "  <startmode>Automatic</startmode>",
      "  <serviceaccount>",
      `    <username>NT SERVICE\\${SERVICE_ID}</username>`,
      "    <allowservicelogon>true</allowservicelogon>",
      "  </serviceaccount>",
      "  <stoptimeout>30 sec</stoptimeout>",
      "  <stopparentprocessfirst>false</stopparentprocessfirst>",
      '  <onfailure action="restart" delay="1 sec"/>',
      '  <onfailure action="restart" delay="2 sec"/>',
      '  <onfailure action="restart" delay="4 sec"/>',
      '  <onfailure action="restart" delay="8 sec"/>',
      '  <onfailure action="restart" delay="60 sec"/>',
      "  <resetfailure>1 hour</resetfailure>",
      '  <log mode="roll-by-size">',
      "    <sizeThreshold>10240</sizeThreshold>",
      "    <keepFiles>8</keepFiles>",
      "  </log>",
      ...envLines,
      "</service>",
      "",
    ].join("\n");
  };

  // Placeholders replaced at install time by installer.nsh / lifecycle (PROGRAMDATA paths).
  // Using tokens that the elevated install script substitutes.
  const xml = buildServiceDescriptor({
    nodeExecutable: "__CAMACHO_SERVICE_NODE__",
    bundle: "__CAMACHO_SERVICE_BUNDLE__",
    workingDirectory: "__CAMACHO_SERVICE_WORKDIR__",
    environment: {
      POS_DATA_DIRECTORY: "__CAMACHO_POS_DATA_DIRECTORY__",
      POS_INSTALLATION_ID: "__CAMACHO_POS_INSTALLATION_ID__",
      POS_DEVICE_ID: "__CAMACHO_POS_DEVICE_ID__",
      POS_SERVICE_VERSION: "1.0.0",
      POS_PROTOCOL_MIN: "1.0.0",
      POS_PROTOCOL_MAX: "1.0.0",
      POS_TENANT_ID: "__CAMACHO_POS_TENANT_ID__",
      POS_COMPANY_ID: "__CAMACHO_POS_COMPANY_ID__",
      POS_BRANCH_ID: "__CAMACHO_POS_BRANCH_ID__",
    },
    commercialLogin: false,
  });
  writeFileSync(join(outDir, `${SERVICE_ID}.xml.template`), xml, "utf8");

  const integrity = {
    winsw: { file: `${SERVICE_ID}.exe`, sha256: WINSW.sha256, version: WINSW.version, source: WINSW.url },
    node: { file: "runtime/node.exe", version: NODE.version, zipSha256: NODE.sha256 },
    localServiceArtifact: {
      file: artifact.split(/[/\\]/).pop(),
      sha256: sha256(artifact),
      profile: artifact.includes("scm-candidate") ? "SCM_CANDIDATE" : "INTERACTIVE",
      commercial_scm_gate: "SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN",
    },
    authenticode_product: "RT-009-B_BLOCKED",
    note: "WinSW official hash pinned; Camacho PE unsigned until RT-009-B. commercialLogin=false in descriptor.",
  };
  writeFileSync(join(outDir, "payload-integrity.json"), `${JSON.stringify(integrity, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ staged: outDir, integrity }, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

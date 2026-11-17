#!/usr/bin/env node
/**
 * Stages WinSW + POS Local Service payload for electron-builder extraResources.
 *
 * Reuses official WinSW 2.12.0 (SHA pinned) + Node 22.19.0 win-x64 (SHA pinned) +
 * LOCAL_SERVICE win32-x64 artifact. commercialLogin=false; SCM_COMMERCIAL… preserved.
 *
 * Extract: use `tar` for zip/tar.gz on all hosts (PowerShell 7 Expand-Archive breaks on
 * GHA windows-2022 with ExtractToDirectory overload errors → NODE_EXE_MISSING_AFTER_EXTRACT).
 */
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
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
  minBytes: 1_000_000,
};

// Pinned from https://nodejs.org/dist/v22.19.0/SHASUMS256.txt (node-v22.19.0-win-x64.zip).
const NODE = {
  version: "22.19.0",
  url: "https://nodejs.org/dist/v22.19.0/node-v22.19.0-win-x64.zip",
  sha256: "ea3fad0e67a991d8477d8c01344b56e69c676ccb733f065b22436994b1253f86",
  minBytes: 20_000_000,
};

const SERVICE_ID = "CamachoPOSLocalService";

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function assertSha(file, expected, label) {
  const got = sha256File(file);
  if (got !== expected.toLowerCase()) {
    throw new Error(`${label}_SHA256_MISMATCH:expected=${expected};got=${got}`);
  }
  return got;
}

function assertMinSize(file, minBytes, label) {
  const size = statSync(file).size;
  if (size < minBytes) throw new Error(`${label}_TOO_SMALL:bytes=${size};min=${minBytes}`);
  return size;
}

/** PE Machine = 0x8664 (AMD64) for win-x64. */
function assertPeAmd64(file, label) {
  const fd = readFileSync(file);
  if (fd.length < 0x40 || fd[0] !== 0x4d || fd[1] !== 0x5a) {
    throw new Error(`${label}_NOT_PE_MZ`);
  }
  const peOffset = fd.readUInt32LE(0x3c);
  if (peOffset + 6 >= fd.length || fd.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
    throw new Error(`${label}_NOT_PE_HEADER`);
  }
  const machine = fd.readUInt16LE(peOffset + 4);
  if (machine !== 0x8664) {
    throw new Error(`${label}_NOT_AMD64:machine=0x${machine.toString(16)}`);
  }
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`DOWNLOAD_FAILED:${url}:${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

/**
 * Extract zip. Never use PowerShell Expand-Archive: on GHA windows-2022 / PS7 the
 * Archive module calls a 3-arg ExtractToDirectory overload that does not exist
 * ("Cannot find an overload... argument count: 3"), leaving NODE_EXE_MISSING.
 *
 * - win32: bsdtar (`tar.exe -xf` supports zip) then .NET ZipFile 2-arg fallback
 * - posix: unzip
 */
function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    try {
      execFileSync("tar.exe", ["-xf", zipPath, "-C", destDir], { stdio: "inherit" });
      return;
    } catch (first) {
      process.stdout.write(`TAR_ZIP_FALLBACK:${first instanceof Error ? first.message : String(first)}\n`);
    }
    const zipLit = zipPath.replace(/'/g, "''");
    const destLit = destDir.replace(/'/g, "''");
    const ps = [
      "Add-Type -AssemblyName System.IO.Compression.FileSystem",
      `$zip='${zipLit}'`,
      `$dest='${destLit}'`,
      // 2-arg ExtractToDirectory only — do not pass overwrite bool (3-arg missing on runner).
      "[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $dest)",
    ].join("; ");
    execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
    return;
  }
  execFileSync("unzip", ["-qo", zipPath, "-d", destDir], { stdio: "inherit" });
}

/** Extract .tar.gz (LOCAL_SERVICE artifact) with system tar on all hosts. */
function extractTarGz(archivePath, destDir) {
  mkdirSync(destDir, { recursive: true });
  const tarBin = process.platform === "win32" ? "tar.exe" : "tar";
  execFileSync(tarBin, ["-xzf", archivePath, "-C", destDir], { stdio: "inherit" });
}

function findFile(root, name) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name === name) return full;
    }
  }
  return null;
}

function listRelativeFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(root, full).split("\\").join("/"));
    }
  };
  walk(root);
  return out.sort();
}

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const cache = join(desktop, "packaging", ".cache");
  mkdirSync(cache, { recursive: true });

  // --- WinSW (single PE, no extract) ---
  const winswCache = join(cache, "WinSW-x64-2.12.0.exe");
  if (!existsSync(winswCache) || sha256File(winswCache) !== WINSW.sha256) {
    process.stdout.write(`DOWNLOAD_WINSW ${WINSW.url}\n`);
    await download(WINSW.url, winswCache);
  }
  assertMinSize(winswCache, WINSW.minBytes, "WINSW");
  assertSha(winswCache, WINSW.sha256, "WINSW");
  assertPeAmd64(winswCache, "WINSW");
  const winswOut = join(outDir, `${SERVICE_ID}.exe`);
  cpSync(winswCache, winswOut);
  assertSha(winswOut, WINSW.sha256, "WINSW_STAGED");

  // --- Node runtime (zip → tar extract → find node.exe) ---
  const nodeZip = join(cache, `node-v${NODE.version}-win-x64.zip`);
  if (!existsSync(nodeZip) || sha256File(nodeZip) !== NODE.sha256) {
    process.stdout.write(`DOWNLOAD_NODE ${NODE.url}\n`);
    await download(NODE.url, nodeZip);
  }
  assertMinSize(nodeZip, NODE.minBytes, "NODE_ZIP");
  assertSha(nodeZip, NODE.sha256, "NODE_ZIP");

  const nodeExtractRoot = join(cache, `node-extract-${NODE.version}`);
  rmSync(nodeExtractRoot, { recursive: true, force: true });
  mkdirSync(nodeExtractRoot, { recursive: true });
  process.stdout.write(`EXTRACT_NODE archive=${nodeZip} dest=${nodeExtractRoot}\n`);
  extractZip(nodeZip, nodeExtractRoot);

  const nodeExe = findFile(nodeExtractRoot, "node.exe");
  if (!nodeExe) {
    const listing = listRelativeFiles(nodeExtractRoot).slice(0, 40).join(",");
    throw new Error(`NODE_EXE_MISSING_AFTER_EXTRACT:listing=${listing}`);
  }
  assertPeAmd64(nodeExe, "NODE");
  mkdirSync(join(outDir, "runtime"), { recursive: true });
  const nodeStaged = join(outDir, "runtime", "node.exe");
  cpSync(nodeExe, nodeStaged);
  assertPeAmd64(nodeStaged, "NODE_STAGED");
  process.stdout.write(`NODE_STAGED path=${nodeStaged} bytes=${statSync(nodeStaged).size} from=${nodeExe}\n`);

  // --- Local Service artifact ---
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
  const artifactSha = sha256File(artifact);
  const serviceExtract = join(outDir, "local-service");
  mkdirSync(serviceExtract, { recursive: true });
  process.stdout.write(`EXTRACT_SERVICE archive=${artifact} dest=${serviceExtract}\n`);
  extractTarGz(artifact, serviceExtract);

  const bundle = findFile(serviceExtract, "pos-local-service.mjs");
  if (!bundle) throw new Error("LOCAL_SERVICE_BUNDLE_MISSING_IN_ARTIFACT");
  const sqliteNode = findFile(join(serviceExtract, "node_modules", "better-sqlite3"), "win32-x64.node");
  if (!sqliteNode) throw new Error("BETTER_SQLITE3_WIN32_X64_MISSING_IN_ARTIFACT");

  // --- WinSW XML (commercialLogin=false; mirrors windows-service-descriptor.ts) ---
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
      // WinSW logs must not write under Program Files (virtual account has no write).
      `  <logpath>${esc(input.logDirectory)}</logpath>`,
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

  const xml = buildServiceDescriptor({
    nodeExecutable: "__CAMACHO_SERVICE_NODE__",
    bundle: "__CAMACHO_SERVICE_BUNDLE__",
    workingDirectory: "__CAMACHO_SERVICE_WORKDIR__",
    logDirectory: "__CAMACHO_SERVICE_LOGDIR__",
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
  const xmlPath = join(outDir, `${SERVICE_ID}.xml.template`);
  writeFileSync(xmlPath, xml, "utf8");

  const helperSrc = join(desktop, "packaging", "install-camacho-local-service.ps1");
  if (!existsSync(helperSrc)) throw new Error("SERVICE_INSTALL_HELPER_MISSING");
  cpSync(helperSrc, join(outDir, "install-camacho-local-service.ps1"));

  // --- Pre-publish gate: every NSIS resource must exist ---
  const required = [
    join(outDir, `${SERVICE_ID}.exe`),
    join(outDir, `${SERVICE_ID}.xml.template`),
    join(outDir, "runtime", "node.exe"),
    join(outDir, "local-service", "pos-local-service.mjs"),
    join(outDir, "install-camacho-local-service.ps1"),
    sqliteNode,
  ];
  const missing = required.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    throw new Error(`NSIS_PAYLOAD_INCOMPLETE:${missing.join("|")}`);
  }

  const integrity = {
    winsw: {
      file: `${SERVICE_ID}.exe`,
      sha256: WINSW.sha256,
      version: WINSW.version,
      source: WINSW.url,
      arch: "amd64",
      bytes: statSync(winswOut).size,
    },
    node: {
      file: "runtime/node.exe",
      version: NODE.version,
      zipSha256: NODE.sha256,
      arch: "amd64",
      bytes: statSync(nodeStaged).size,
    },
    localServiceArtifact: {
      file: artifact.split(/[/\\]/).pop(),
      sha256: artifactSha,
      profile: artifact.includes("scm-candidate") ? "SCM_CANDIDATE" : "INTERACTIVE",
      commercial_scm_gate: "SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN",
      bundle: relative(outDir, bundle).split("\\").join("/"),
      betterSqlite3: relative(outDir, sqliteNode).split("\\").join("/"),
    },
    authenticode_product: "RT-009-B_BLOCKED",
    extractTool: process.platform === "win32" ? "tar.exe_or_ZipFile_2arg" : "unzip_and_tar",
    note: "WinSW/Node SHA+PE amd64 verified; commercialLogin=false; Expand-Archive not used (PS7 overload bug).",
  };
  writeFileSync(join(outDir, "payload-integrity.json"), `${JSON.stringify(integrity, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ staged: outDir, integrity, requiredOk: true }, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

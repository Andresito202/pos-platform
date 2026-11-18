#!/usr/bin/env node
/**
 * Lab-only enrollment under the REAL process identity.
 * SERVICE: NT SERVICE\CamachoPOSLocalService Session 0 (DPAPI CurrentUser of the service).
 * DESKTOP: interactive logon (DPAPI CurrentUser of the desktop user).
 * Never issues BUSINESS sessions, never clears Authenticode, never prints private keys.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const fail = (code) => { throw new Error(code); };
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

function uuidV7() {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function absoluteWindows(p) {
  return typeof p === "string" && /^[A-Za-z]:\\/.test(p) && resolve(p) === p;
}

const [, , mode, labRoot, publication, installationIdArg, deviceIdArg] = process.argv;
if (!["SERVICE", "DESKTOP", "PAIR"].includes(mode)) fail("ENROLL_MODE_REJECTED");
if (!absoluteWindows(labRoot) || !/^[A-Za-z]:\\CamachoPosScmLab\\[a-f0-9]{32}$/i.test(labRoot)) {
  fail("LAB_ROOT_REJECTED");
}
if (!/^[a-f0-9]{32}$/.test(publication)) fail("PUBLICATION_REJECTED");

const installationId = installationIdArg && installationIdArg !== "-" ? installationIdArg : uuidV7();
const deviceId = deviceIdArg && deviceIdArg !== "-" ? deviceIdArg : uuidV7();
if (installationId[14] !== "7" || deviceId[14] !== "7") fail("UUID_V7_REQUIRED");

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const requireRepo = createRequire(join(repo, "package.json"));

async function loadChannel(name) {
  return import(pathToFileURL(join(repo, "packages/local-channel/src", name)).href);
}

function sealInstallerManaged(filePath, serviceSid) {
  // ACL sealing is performed by the PowerShell operator after this writer.
  // This only ensures CreateNew semantics and path shape.
  if (!absoluteWindows(filePath)) fail("MANAGED_PATH_REJECTED");
  if (existsSync(filePath)) fail("MANAGED_OUTPUT_EXISTS");
}

if (mode === "SERVICE" || mode === "DESKTOP") {
  const { currentHandoffIdentity } = await loadChannel("windows-handoff-native.ts");
  const id = currentHandoffIdentity();
  if (mode === "SERVICE") {
    if (!id.service || id.interactive || id.sessionId !== 0) fail("SERVICE_IDENTITY_REQUIRED");
    const { prepareWindowsServiceSigner } = await loadChannel("windows-service-signer.ts");
    const privateDir = join(labRoot, "service", "private");
    mkdirSync(privateDir, { recursive: true });
    const signerPrivate = join(privateDir, `signer-commercial-${deviceId}.dpapi.json`);
    sealInstallerManaged(signerPrivate, id.sid);
    const pub = prepareWindowsServiceSigner(signerPrivate, installationId, deviceId);
    const out = join(labRoot, "results", `commercial-service-${publication}.json`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({
      ...pub,
      installation_id: installationId,
      device_id: deviceId,
      profile: "CAMACHO_LAB_COMMERCIAL_CHANNEL_ENROLLMENT",
      publication,
      role: "SERVICE",
      signer_private_file: signerPrivate,
      createdAt: new Date().toISOString(),
      businessSessionIssued: false,
    }, null, 2) + "\n", { flag: "wx" });
    console.log("LAB_CHANNEL_ENROLLMENT=SERVICE_PREPARED_NOT_CERTIFIED");
  } else {
    if (!id.interactive || id.service || id.sessionId <= 0) fail("DESKTOP_IDENTITY_REQUIRED");
    const { prepareWindowsHandoffReceiver } = await loadChannel("windows-handoff.ts");
    const privateDir = join(labRoot, "desktop", "private");
    mkdirSync(privateDir, { recursive: true });
    const receiverPrivate = join(privateDir, `receiver-commercial-${deviceId}.dpapi.json`);
    sealInstallerManaged(receiverPrivate, id.sid);
    const pub = prepareWindowsHandoffReceiver(receiverPrivate, installationId, deviceId);
    const out = join(labRoot, "desktop", `commercial-desktop-${publication}.json`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({
      ...pub,
      installation_id: installationId,
      device_id: deviceId,
      profile: "CAMACHO_LAB_COMMERCIAL_CHANNEL_ENROLLMENT",
      publication,
      role: "DESKTOP",
      receiver_file: receiverPrivate,
      createdAt: new Date().toISOString(),
      businessSessionIssued: false,
    }, null, 2) + "\n", { flag: "wx" });
    console.log("LAB_CHANNEL_ENROLLMENT=DESKTOP_PREPARED_NOT_CERTIFIED");
  }
} else {
  // PAIR: build installer-owned manifests from public enrollments + pinned addon.
  const serviceEnroll = JSON.parse(readFileSync(join(labRoot, "results", `commercial-service-${publication}.json`), "utf8"));
  const desktopEnroll = JSON.parse(readFileSync(join(labRoot, "desktop", `commercial-desktop-${publication}.json`), "utf8"));
  if (serviceEnroll.installation_id !== installationId || desktopEnroll.installation_id !== installationId) {
    fail("INSTALLATION_BINDING_MISMATCH");
  }
  if (serviceEnroll.device_id !== deviceId || desktopEnroll.device_id !== deviceId) fail("DEVICE_BINDING_MISMATCH");

  const compiledAddon = join(repo, "packages/local-channel/native/build/Release/camacho_windows_pipe.node");
  if (!existsSync(compiledAddon)) fail("NATIVE_ADDON_MISSING");
  const adapterDir = join(labRoot, "service");
  mkdirSync(adapterDir, { recursive: true });
  const adapter = join(adapterDir, "camacho_windows_pipe.node");
  if (!existsSync(adapter)) copyFileSync(compiledAddon, adapter);
  if (sha(readFileSync(adapter)) !== sha(readFileSync(compiledAddon))) fail("ADAPTER_HASH_MISMATCH");

  const now = new Date();
  const handoff = {
    profile: "CAMACHO_WINDOWS_CHANNEL_HANDOFF_CANDIDATE_V1",
    service_id: "CamachoPOSLocalService",
    service_sid: serviceEnroll.service_sid,
    installation_id: installationId,
    device_id: deviceId,
    recipient_sid: desktopEnroll.recipient_sid,
    recipient_logon_sid: desktopEnroll.recipient_logon_sid,
    recipient_session_id: desktopEnroll.recipient_session_id,
    recipient_public_key_pem: desktopEnroll.recipient_public_key_pem,
    recipient_key_sha256: desktopEnroll.recipient_key_sha256,
    capsule_file: join(labRoot, "results", `commercial-capsule-${publication}.json`),
    not_before: new Date(now.getTime() - 60_000).toISOString(),
    expires_at: new Date(now.getTime() + 60 * 60_000).toISOString(),
    revision: 1,
    poll_ms: 250,
    policy_reference: "NSIS_SCM_COMMERCIAL_CHANNEL_LAB_ONLY",
  };
  const shared = {
    version: 1,
    handoff,
    adapter_file: adapter,
    adapter_sha256: sha(readFileSync(adapter)),
    signer_public_key_pem: serviceEnroll.public_key_pem,
    signer_spki_sha256: serviceEnroll.spki_sha256,
  };
  const serviceManifest = {
    ...shared,
    role: "SERVICE",
    signer_private_file: serviceEnroll.signer_private_file,
  };
  const desktopManifest = {
    ...shared,
    role: "DESKTOP",
    receiver_file: desktopEnroll.receiver_file,
  };
  const serviceOut = join(labRoot, "service", `commercial-provision-${publication}.json`);
  const desktopOut = join(labRoot, "desktop", `commercial-provision-${publication}.json`);
  if (existsSync(serviceOut) || existsSync(desktopOut)) fail("PROVISION_ALREADY_EXISTS");
  writeFileSync(desktopOut, JSON.stringify(desktopManifest, null, 2) + "\n", { flag: "wx" });
  writeFileSync(serviceOut, JSON.stringify(serviceManifest, null, 2) + "\n", { flag: "wx" });
  // Validate with the real schema before the operator seals ACLs.
  const { WindowsScmHandoffProvisionSchema } = await import(
    pathToFileURL(join(repo, "packages/contracts/src/windows-channel-handoff.ts")).href
  );
  WindowsScmHandoffProvisionSchema.parse(serviceManifest);
  WindowsScmHandoffProvisionSchema.parse(desktopManifest);
  writeFileSync(join(labRoot, "results", `commercial-pair-${publication}.json`), JSON.stringify({
    profile: "CAMACHO_NSIS_SCM_COMMERCIAL_PAIR_V1",
    publication,
    installation_id: installationId,
    device_id: deviceId,
    service_manifest: serviceOut,
    desktop_manifest: desktopOut,
    adapter,
    adapter_sha256: shared.adapter_sha256,
  }, null, 2) + "\n", { flag: "wx" });
  console.log("PAIRED_MANIFESTS_CREATED=YES");
  console.log(`SERVICE_MANIFEST=${serviceOut}`);
  console.log(`DESKTOP_MANIFEST=${desktopOut}`);
  console.log(`INSTALLATION_ID=${installationId}`);
  console.log(`DEVICE_ID=${deviceId}`);
}

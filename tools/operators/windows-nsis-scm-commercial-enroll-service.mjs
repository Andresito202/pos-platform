#!/usr/bin/env node
/**
 * SERVICE-only enrollment entry (bundled to short-path CJS for NT SERVICE).
 * Must run as NT SERVICE\CamachoPOSLocalService in Session 0.
 * Does not issue BUSINESS sessions or clear Authenticode.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { currentHandoffIdentity } from "../../packages/local-channel/src/windows-handoff-native.ts";
import { prepareWindowsServiceSigner } from "../../packages/local-channel/src/windows-service-signer.ts";

const fail = (code) => {
  throw new Error(code);
};

const [, , labRoot, publication, installationId, deviceId] = process.argv;
if (typeof labRoot !== "string" || !/^[A-Za-z]:\\CamachoPosScmLab\\[a-f0-9]{32}$/i.test(labRoot) || resolve(labRoot) !== labRoot) {
  fail("LAB_ROOT_REJECTED");
}
if (!/^[a-f0-9]{32}$/.test(publication ?? "")) fail("PUBLICATION_REJECTED");
if (!installationId || installationId[14] !== "7" || !deviceId || deviceId[14] !== "7") fail("UUID_V7_REQUIRED");

const id = currentHandoffIdentity();
if (!id.service || id.interactive || id.sessionId !== 0) fail("SERVICE_IDENTITY_REQUIRED");

const privateDir = join(labRoot, "service", "private");
mkdirSync(privateDir, { recursive: true });
const signerPrivate = join(privateDir, `signer-commercial-${deviceId}.dpapi.json`);
if (existsSync(signerPrivate)) fail("MANAGED_OUTPUT_EXISTS");

const pub = prepareWindowsServiceSigner(signerPrivate, installationId, deviceId);
const out = join(labRoot, "results", `commercial-service-${publication}.json`);
mkdirSync(dirname(out), { recursive: true });
if (existsSync(out)) fail("MANAGED_OUTPUT_EXISTS");
writeFileSync(
  out,
  `${JSON.stringify(
    {
      ...pub,
      installation_id: installationId,
      device_id: deviceId,
      profile: "CAMACHO_LAB_COMMERCIAL_CHANNEL_ENROLLMENT",
      publication,
      role: "SERVICE",
      signer_private_file: signerPrivate,
      createdAt: new Date().toISOString(),
      businessSessionIssued: false,
    },
    null,
    2,
  )}\n`,
  { flag: "wx" },
);
console.log("LAB_CHANNEL_ENROLLMENT=SERVICE_PREPARED_NOT_CERTIFIED");

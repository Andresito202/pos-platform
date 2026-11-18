#!/usr/bin/env node
/**
 * Commercial ops against the LIVE WinSW product Local Service under NT SERVICE.
 * Uses the same connectWindowsScmClient path as Electron production-entry.
 * No interactive Local Service substitute. No BUSINESS/GLOBAL claim.
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fail = (code) => { throw new Error(code); };
const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const provisionFile = process.env.POS_WINDOWS_SCM_HANDOFF_FILE;
if (process.platform !== "win32" || !provisionFile) fail("DESKTOP_PROVISION_REQUIRED");

const channel = await import(pathToFileURL(join(repo, "packages/local-channel/src/index.ts")).href);
const p = channel.readWindowsScmProvision(provisionFile, "DESKTOP");
const range = { min: "1.0.0", max: "1.0.0" };
const handshake = () => ({
  protocol_version: "1.0.0",
  message_type: "runtime.handshake",
  request_id: randomUUID(),
  correlation_id: randomUUID(),
  payload_schema_version: "1.0.0",
  payload: {
    desktop_version: "1.0.0",
    service_version: "1.0.0",
    protocol_min: "1.0.0",
    protocol_max: "1.0.0",
    installation_id: p.handoff.installation_id,
    device_id: p.handoff.device_id,
    schema_version: "5",
    service_state: "READY",
  },
});
const status = () => ({
  protocol_version: "1.0.0",
  message_type: "runtime.status.get",
  request_id: randomUUID(),
  correlation_id: randomUUID(),
  payload_schema_version: "1.0.0",
  payload: {},
});

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Negative: forged recipient session must not connect.
let negativeRejected = false;
try {
  await channel.connectWindowsScmClient({
    ...p,
    handoff: { ...p.handoff, recipient_session_id: 0 },
  }, handshake(), range);
} catch {
  negativeRejected = true;
}
if (!negativeRejected) fail("NEGATIVE_SESSION_IMPERSONATION_NOT_REJECTED");

// Negative: wrong signer pin.
negativeRejected = false;
try {
  await channel.connectWindowsScmClient({
    ...p,
    signer_spki_sha256: "0".repeat(64),
  }, handshake(), range);
} catch {
  negativeRejected = true;
}
if (!negativeRejected) fail("NEGATIVE_SIGNER_PIN_NOT_REJECTED");

const a = await channel.connectWindowsScmClient(p, handshake(), range);
let b;
try {
  const r1 = await a.request(status());
  if (r1.status !== "SUCCEEDED") fail("AUTHENTICATED_STATUS_REJECTED");
  b = await channel.connectWindowsScmClient(p, handshake(), range);
  const r2 = await b.request(status());
  if (r2.status !== "SUCCEEDED") fail("SECOND_LEASE_MEMBER_REJECTED");
  console.log("SCM_COMMERCIAL_AUTHENTICATED_OPS=PASS");
  console.log("SCM_COMMERCIAL_DUAL_MEMBER_LEASE=PASS");
  console.log("SCM_COMMERCIAL_NEGATIVE_IMPERSONATION=PASS");
  console.log("SCM_COMMERCIAL_NEGATIVE_SIGNER_PIN=PASS");
} finally {
  await a.close().catch(() => undefined);
  await b?.close().catch(() => undefined);
}

// After both clients close, a fresh connect may obtain a NEW lease while the
// provision remains valid (transport only). Prove reconnect works.
await pause(500);
const c = await channel.connectWindowsScmClient(p, handshake(), range);
try {
  const r3 = await c.request(status());
  if (r3.status !== "SUCCEEDED") fail("RECONNECT_AFTER_CLOSE_REJECTED");
  console.log("SCM_COMMERCIAL_RECONNECT_AFTER_CLOSE=PASS");
} finally {
  await c.close().catch(() => undefined);
}

console.log("SCM_COMMERCIAL_CHANNEL_PRODUCT_OPS=PASS");
console.log("BUSINESS_SESSION_ISSUED=false");
console.log("AUTHENTICODE=RT-009-B_BLOCKED");

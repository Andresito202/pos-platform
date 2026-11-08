#!/usr/bin/env node
// Ephemeral CI-only native named-pipe identity exchange. No payload, no Central,
// no production provision or private key. Never permitted outside the GitHub lab.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [, , mode, configFile] = process.argv;
if (!["service", "desktop"].includes(mode) || !configFile ||
    process.platform !== "win32" || process.arch !== "x64" ||
    !configFile.match(/^[A-Za-z]:\\[^\r\n"]+\\native-policy\.json$/i))
  throw Error("LAB_MODE_OR_PATH_REJECTED");
const config = JSON.parse(readFileSync(configFile, "utf8"));
if (config.profile !== "CAMACHO_EPHEMERAL_NATIVE_PIPE_G1_ONLY" ||
    !config.endpoint.match(/^\\\\\.\\pipe\\camacho-pos-[0-9a-f-]{36}-scm$/i) ||
    !config.service.match(/^S-1-5-80-(?:[0-9]+-){4}[0-9]+$/) ||
    !config.recipient.match(/^S-1-5-21-(?:[0-9]+-){3,}[0-9]+$/) ||
    !config.logon.match(/^S-1-5-5-[0-9]+-[0-9]+$/) ||
    !Number.isInteger(config.session) || config.session < 1 ||
    !config.addon.match(/^[A-Za-z]:\\[^\r\n"]+\.node$/i))
  throw Error("LAB_POLICY_REJECTED");

const native = createRequire(import.meta.url)(resolve(config.addon));
const args = [config.endpoint, config.service, config.recipient, config.logon, config.session];
const stamp = (file, payload) => writeFileSync(resolve(config.results, file),
  JSON.stringify({ profile:"CAMACHO_EPHEMERAL_NATIVE_G1_V1", ...payload }) + "\n",
  { flag:"wx" });
let listener;
let connection;
try {
  if (mode === "service") {
    listener = native.listen(...args); // Native code checks real SCM PID ancestry, SID, session 0.
    stamp("native-ready.json", {state:"LISTENING"});
    connection = await native.accept(listener, 5000); // Actual kernel peer-token attestation.
    native.recheck(connection.handle);
    if (connection.peer.sid !== config.recipient ||
        connection.peer.logonSid !== config.logon ||
        connection.peer.sessionId !== config.session)
      throw Error("NATIVE_SERVICE_PEER_MISMATCH");
    stamp("native-service-pass.json", {status:"PASS", peer_role:"DESKTOP"});
  } else {
    connection = await native.connect(...args, 5000); // Actual SCM process-tree attestation.
    native.recheck(connection.handle);
    if (connection.peer.sid !== config.service || connection.peer.sessionId !== 0)
      throw Error("NATIVE_DESKTOP_PEER_MISMATCH");
    stamp("native-desktop-pass.json", {status:"PASS", peer_role:"SCM_SERVICE"});
  }
} catch (e) {
  try { stamp("native-"+mode+"-failure.json", {status:"FAIL", code:"NATIVE_CHANNEL_REJECTED"}); } catch {}
  throw Error("EPHEMERAL_NATIVE_G1_FAILED");
} finally {
  if (connection) native.release(connection.handle);
  if (listener) native.stop(listener);
}

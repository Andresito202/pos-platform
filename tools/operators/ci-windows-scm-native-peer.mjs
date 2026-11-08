#!/usr/bin/env node
// Ephemeral CI-only native named-pipe identity exchange. No payload, no Central,
// no production provision or private key. Never permitted outside the GitHub lab.
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const [, , mode, configFile] = process.argv;
if (!["service", "desktop"].includes(mode) || !configFile ||
    process.platform !== "win32" || process.arch !== "x64" ||
    !configFile.match(/^[A-Za-z]:\\[^\r\n"]+\\native-policy\.json$/i))
  throw Error("LAB_MODE_OR_PATH_REJECTED");
// Hosted runner has no logon SID. Use the real SID of a disposable
// Windows local user's ONE persistent interactive logon process instead.
if (mode === "desktop") {
  const query = (args) => {
    const result = spawnSync("whoami.exe", args, {
      encoding: "utf8", shell: false, timeout: 10_000, windowsHide: true,
    });
    if (result.status !== 0 || result.error) throw Error("NATIVE_CI_IDENTITY_QUERY_FAILED");
    return result.stdout;
  };
  const userSid = [...query(["/user"]).matchAll(/S-1-5-21-(?:[0-9]+-){3,}[0-9]+/g)].map(x => x[0]);
  const logonSid = [...query(["/logonid"]).matchAll(/S-1-5-5-[0-9]+-[0-9]+/g)].map(x => x[0]);
  const sessionResult = spawnSync("powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "(Get-Process -Id " + process.pid + ").SessionId"],
    { encoding:"utf8", timeout:10_000, shell:false, windowsHide:true });
  const session = Number((sessionResult.stdout ?? "").trim());
  if (userSid.length !== 1 || logonSid.length !== 1 ||
      sessionResult.status !== 0 || !Number.isInteger(session) || session < 1)
    throw Error("NATIVE_CI_REAL_INTERACTIVE_TOKEN_REQUIRED");
  writeFileSync(join(dirname(configFile), "native-client-identity.json"),
    JSON.stringify({user_sid:userSid[0],logon_sid:logonSid[0],session}) + "\n",
    { flag:"wx" });
  const deadline = Date.now() + 35_000;
  while (!existsSync(configFile) && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 100));
  if (!existsSync(configFile)) throw Error("NATIVE_CI_POLICY_NOT_PROVISIONED");
}
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
let phase="INITIAL";
try {
  if (mode === "service") {
    phase="SERVICE_LISTEN";
    listener = native.listen(...args); // Native code checks real SCM PID ancestry, SID, session 0.
    stamp("native-ready.json", {state:"LISTENING"});
    phase="SERVICE_ACCEPT";
    connection = await native.accept(listener, 5000); // Actual kernel peer-token attestation.
    phase="SERVICE_RECHECK";
    native.recheck(connection.handle);
    phase="SERVICE_PEER_MATCH";
    if (connection.peer.sid !== config.recipient ||
        connection.peer.logonSid !== config.logon ||
        connection.peer.sessionId !== config.session)
      throw Error("NATIVE_SERVICE_PEER_MISMATCH");
    stamp("native-service-pass.json", {status:"PASS", peer_role:"DESKTOP"});
  } else {
    const deadline = Date.now() + 25_000;
    while (!existsSync(join(config.results, "native-ready.json")) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 100));
    if (!existsSync(join(config.results, "native-ready.json")))
      throw Error("NATIVE_CI_SERVICE_NOT_LISTENING");
    phase="DESKTOP_CONNECT";
    connection = await native.connect(...args, 5000); // Actual SCM process-tree attestation.
    phase="DESKTOP_RECHECK";
    native.recheck(connection.handle);
    phase="DESKTOP_PEER_MATCH";
    if (connection.peer.sid !== config.service || connection.peer.sessionId !== 0)
      throw Error("NATIVE_DESKTOP_PEER_MISMATCH");
    stamp("native-desktop-pass.json", {status:"PASS", peer_role:"SCM_SERVICE"});
  }
} catch (e) {
  try { stamp("native-"+mode+"-failure.json", {status:"FAIL", phase, code:"NATIVE_CHANNEL_REJECTED"}); } catch {}
  throw Error("EPHEMERAL_NATIVE_G1_FAILED");
} finally {
  if (connection) native.release(connection.handle);
  if (listener) native.stop(listener);
}

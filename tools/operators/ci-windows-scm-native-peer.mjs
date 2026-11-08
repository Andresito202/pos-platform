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
  // Disposable runner only: classify whether the unprivileged Desktop token
  // can query the SCM process token. This is diagnosis, never an auth fallback.
  // No PID, SID, token bytes, native error details or secrets are logged.
  const nativeStage = mode === "desktop" && phase === "DESKTOP_CONNECT" &&
    e instanceof Error && [
      "DESKTOP_SELF_IDENTITY", "DESKTOP_PIPE_OPEN",
      "DESKTOP_PREFACE", "DESKTOP_SERVER_ATTESTATION"
    ].includes(e.message) ? e.message : "NOT_CLASSIFIED";
  let scmTokenQuery = "NOT_CHECKED";
  if (mode === "desktop" && phase === "DESKTOP_CONNECT") {
    const probe = String.raw`
$ErrorActionPreference='Stop'
try {
  $status=& sc.exe queryex CamachoPOSLocalService
  $line=@($status | Where-Object {$_ -match '^\s*PID\s*:\s*([0-9]+)\s*$'})
  if($LASTEXITCODE -ne 0 -or $line.Count -ne 1){throw 'SCM_QUERY_FAILED'}
  $pidNumber=[int]([regex]::Match($line[0],':\s*([0-9]+)').Groups[1].Value)
  if($pidNumber -le 0){throw 'SCM_NOT_RUNNING'}
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CamachoCiTokenProbe {
 [DllImport("kernel32.dll",SetLastError=true)]
 public static extern IntPtr OpenProcess(uint access,bool inherit,uint processId);
 [DllImport("advapi32.dll",SetLastError=true)]
 [return:MarshalAs(UnmanagedType.Bool)]
 public static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
 [DllImport("kernel32.dll",SetLastError=true)]
 [return:MarshalAs(UnmanagedType.Bool)]
 public static extern bool CloseHandle(IntPtr handle);
}
'@
  $process=[CamachoCiTokenProbe]::OpenProcess(0x1000,$false,[uint32]$pidNumber)
  if($process -eq [IntPtr]::Zero){ 'PROCESS_OPEN_DENIED';exit 0 }
  try {
    $token=[IntPtr]::Zero
    if(-not [CamachoCiTokenProbe]::OpenProcessToken($process,0x0008,[ref]$token)){
      'TOKEN_QUERY_DENIED';exit 0
    }
    try { 'TOKEN_QUERY_ALLOWED' }
    finally { [void][CamachoCiTokenProbe]::CloseHandle($token) }
  } finally { [void][CamachoCiTokenProbe]::CloseHandle($process) }
} catch { 'TOKEN_PROBE_INCONCLUSIVE' }
`;
    try {
      const result = spawnSync("powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", probe],
        {encoding:"utf8", shell:false, timeout:10_000, windowsHide:true});
      const classification=(result.stdout || "").trim();
      if(result.status === 0 && [
        "PROCESS_OPEN_DENIED", "TOKEN_QUERY_DENIED", "TOKEN_QUERY_ALLOWED",
        "TOKEN_PROBE_INCONCLUSIVE"
      ].includes(classification)) scmTokenQuery=classification;
      else scmTokenQuery="TOKEN_PROBE_INCONCLUSIVE";
    } catch { scmTokenQuery="TOKEN_PROBE_INCONCLUSIVE"; }
  }
  try { stamp("native-"+mode+"-failure.json", {
    status:"FAIL", phase, code:"NATIVE_CHANNEL_REJECTED",
    scm_token_query:scmTokenQuery, native_stage:nativeStage
  }); } catch {}
  throw Error("EPHEMERAL_NATIVE_G1_FAILED");
} finally {
  if (connection) native.release(connection.handle);
  if (listener) native.stop(listener);
}

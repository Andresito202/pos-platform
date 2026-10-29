import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";

const LOCAL_CHANNEL_SECRET_NAME = "local-channel-auth";
const INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface EncryptedSecret { readonly version: 1; readonly iv: string; readonly tag: string; readonly ciphertext: string; }

const DPAPI_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$path = $env:POS_DPAPI_KEY_PATH
$context = $env:POS_DPAPI_CONTEXT
if ([string]::IsNullOrWhiteSpace($path) -or [string]::IsNullOrWhiteSpace($context)) { throw "DPAPI path and context are required" }
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $entropy = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($context)) } finally { $sha.Dispose() }
if ([System.IO.File]::Exists($path)) {
  $protected = [System.IO.File]::ReadAllBytes($path)
  $key = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
} else {
  if ($env:POS_DPAPI_ALLOW_CREATE -ne '1') { throw "LOCAL_CHANNEL_DPAPI_KEY_NOT_PROVISIONED" }
  $key = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($key) } finally { $rng.Dispose() }
  $protected = [System.Security.Cryptography.ProtectedData]::Protect($key, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [System.IO.File]::WriteAllBytes($path, $protected)
}
if ($key.Length -ne 32) { throw "DPAPI root key length is invalid" }
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
if ($env:POS_DPAPI_ALLOW_CREATE -eq '1') {
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetOwner($identity.User)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity.User, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
  [void]$acl.AddAccessRule($rule)
  [System.IO.File]::SetAccessControl($path, $acl)
} else {
  # Desktop is a reader, never an ACL/ownership administrator.
  $acl = [System.IO.File]::GetAccessControl($path)
  if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $identity.User.Value) {
    throw "LOCAL_CHANNEL_DPAPI_ACL_REJECTED"
  }
  foreach ($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -ne $identity.User.Value) {
      throw "LOCAL_CHANNEL_DPAPI_ACL_REJECTED"
    }
  }
}
$output = [Convert]::ToBase64String($key)
[Array]::Clear($key, 0, $key.Length)
Write-Output $output
`;

function requireValue(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required for production desktop bootstrap`);
  return value.trim();
}

function resolveEndpoint(installationId: string, platform: NodeJS.Platform): string {
  if (!INSTALLATION_ID.test(installationId)) throw new Error("invalid installation id for production desktop bootstrap");
  if (platform !== "win32") throw new Error("production desktop bootstrap requires Windows named pipes");
  return `\\\\.\\pipe\\camacho-pos-${installationId.toLowerCase()}`;
}

function loadRootKey(dataDirectory: string, installationId: string, platform: NodeJS.Platform, allowCreate: boolean): Buffer {
  if (platform !== "win32") throw new Error("local channel production secret requires Windows DPAPI");
  const securityDirectory = join(dataDirectory, "security");
  const dpapiDirectory = join(securityDirectory, "dpapi");
  if (allowCreate) {
    mkdirSync(securityDirectory, { recursive: true, mode: 0o700 });
    mkdirSync(dpapiDirectory, { recursive: true, mode: 0o700 });
  }
  const context = `local-channel:${installationId}`;
  const contextHash = createHash("sha256").update(context).digest("hex");
  const path = join(dpapiDirectory, `root-key-${contextHash}.dpapi`);
  if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) {
    throw new Error("LOCAL_CHANNEL_DPAPI_KEY_FILE_REJECTED");
  }
  if (!allowCreate && !existsSync(path)) {
    throw new Error("LOCAL_CHANNEL_DPAPI_KEY_NOT_PROVISIONED");
  }
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", DPAPI_SCRIPT], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024, env: { ...process.env, POS_DPAPI_KEY_PATH: path, POS_DPAPI_CONTEXT: context, POS_DPAPI_ALLOW_CREATE: allowCreate ? "1" : "0" } });
  if (result.error) throw new Error("Windows DPAPI invocation failed", { cause: result.error });
  if (result.status !== 0) {
    const diagnostic = result.stderr.trim().slice(0, 1_024);
    throw new Error(`Windows DPAPI key operation failed${diagnostic ? `: ${diagnostic}` : ""}`);
  }
  const encoded = result.stdout.trim();
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encoded) { key.fill(0); throw new Error("Windows DPAPI returned an invalid root key"); }
  return key;
}

function decodeBase64Url(value: unknown, bytes: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("LOCAL_CHANNEL_SECRET_ENVELOPE_REJECTED");
  }
  const result = Buffer.from(value, "base64url");
  if (result.length !== bytes || result.toString("base64url") !== value) {
    result.fill(0);
    throw new Error("LOCAL_CHANNEL_SECRET_ENVELOPE_REJECTED");
  }
  return result;
}

function readSecret(path: string, key: Buffer, context: string): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 96 || stat.size > 2048) {
    throw new Error("LOCAL_CHANNEL_SECRET_FILE_REJECTED");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("LOCAL_CHANNEL_SECRET_ENVELOPE_REJECTED");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("LOCAL_CHANNEL_SECRET_ENVELOPE_REJECTED");
  }
  const record = raw as Record<string, unknown>;
  const fields = Object.keys(record).sort();
  if (record.version !== 1 || fields.join(",") !== "ciphertext,iv,tag,version") {
    throw new Error("LOCAL_CHANNEL_SECRET_ENVELOPE_REJECTED");
  }
  const iv = decodeBase64Url(record.iv, 12);
  const tag = decodeBase64Url(record.tag, 16);
  const ciphertext = decodeBase64Url(record.ciphertext, 32);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    const secret = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (secret.length !== 32) { secret.fill(0); throw new Error("LOCAL_CHANNEL_SECRET_LENGTH_REJECTED"); }
    return secret;
  } catch {
    throw new Error("LOCAL_CHANNEL_SECRET_AUTHENTICATION_FAILED");
  } finally {
    iv.fill(0);
    tag.fill(0);
    ciphertext.fill(0);
  }
}

function writeSecret(dataDirectory: string, key: Buffer, context: string, secret: Buffer): void {
  const target = join(dataDirectory, "security", `${LOCAL_CHANNEL_SECRET_NAME}.secret`);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  const value: EncryptedSecret = { version: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
  const temporary = `${target}.tmp.${randomUUID()}`;
  writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  try { renameSync(temporary, target); } catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
}

export interface ProductionDesktopProvisioning { readonly endpoint: string; readonly installationId: string; readonly deviceId: string; readonly channelSecret: Buffer; }

export function loadProductionDesktopProvisioning(environment: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): ProductionDesktopProvisioning {
  const dataDirectory = requireValue("POS_DATA_DIRECTORY", environment.POS_DATA_DIRECTORY);
  if (!isAbsolute(dataDirectory)) throw new Error("LOCAL_CHANNEL_DATA_DIRECTORY_MUST_BE_ABSOLUTE");
  const installationId = requireValue("POS_INSTALLATION_ID", environment.POS_INSTALLATION_ID);
  const deviceId = requireValue("POS_DEVICE_ID", environment.POS_DEVICE_ID);
  const endpoint = resolveEndpoint(installationId, platform);
  // Desktop is a consumer, NEVER the authority that provisions the shared MAC key.
  // A first-run renderer/main must not create a new channel identity for the Service.
  const path = join(dataDirectory, "security", `${LOCAL_CHANNEL_SECRET_NAME}.secret`);
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
    throw new Error("LOCAL_CHANNEL_SECRET_NOT_PROVISIONED");
  }
  const rootKey = loadRootKey(dataDirectory, installationId, platform, false);
  try {
    const secret = readSecret(path, rootKey, `local-channel:${installationId}`);
    if (secret.byteLength !== 32) { secret.fill(0); throw new Error("persisted local channel secret has invalid length"); }
    return { endpoint, installationId, deviceId, channelSecret: secret };
  } finally { rootKey.fill(0); }
}

/** Service-only bootstrap: creates the OS-bound channel secret on first start.
 * Never call from Desktop. It must run under the same Windows identity as the
 * authorized Desktop until cross-account SCM handoff has been implemented. */
export function loadOrCreateWindowsLocalChannelSecret(dataDirectory: string, installationId: string, platform: NodeJS.Platform = process.platform): Buffer {
  if (!INSTALLATION_ID.test(installationId)) throw new Error("invalid installation id for service channel bootstrap");
  if (!isAbsolute(dataDirectory)) throw new Error("Windows service channel data directory must be absolute");
  if (platform !== "win32") throw new Error("Windows channel provisioning requires Windows DPAPI");
  const rootKey = loadRootKey(dataDirectory, installationId, platform, true);
  const context = `local-channel:${installationId}`;
  const path = join(dataDirectory, "security", `${LOCAL_CHANNEL_SECRET_NAME}.secret`);
  try {
    if (existsSync(path)) {
      const secret = readSecret(path, rootKey, context);
      if (secret.byteLength !== 32) { secret.fill(0); throw new Error("persisted local channel secret has invalid length"); }
      return secret;
    }
    const secret = randomBytes(32);
    try { writeSecret(dataDirectory, rootKey, context, secret); return Buffer.from(secret); }
    finally { secret.fill(0); }
  } finally { rootKey.fill(0); }
}

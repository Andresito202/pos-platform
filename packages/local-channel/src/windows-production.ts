import { randomBytes, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const LOCAL_CHANNEL_SECRET_NAME = "local-channel-auth";
const DPAPI_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

$path = $env:POS_DPAPI_KEY_PATH
$context = $env:POS_DPAPI_CONTEXT
if ([string]::IsNullOrWhiteSpace($path) -or [string]::IsNullOrWhiteSpace($context)) {
  throw "DPAPI path and context are required"
}

$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $entropy = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($context))
} finally {
  $sha.Dispose()
}

if ([System.IO.File]::Exists($path)) {
  $protected = [System.IO.File]::ReadAllBytes($path)
  $key = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $protected,
    $entropy,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
} else {
  $key = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($key)
  } finally {
    $rng.Dispose()
  }

  $protected = [System.Security.Cryptography.ProtectedData]::Protect(
    $key,
    $entropy,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [System.IO.File]::WriteAllBytes($path, $protected)
}

if ($key.Length -ne 32) {
  throw "DPAPI root key length is invalid"
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetOwner($identity.User)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
  $identity.User,
  [System.Security.AccessControl.FileSystemRights]::FullControl,
  [System.Security.AccessControl.AccessControlType]::Allow
)
[void]$acl.AddAccessRule($rule)
[System.IO.File]::SetAccessControl($path, $acl)

$output = [Convert]::ToBase64String($key)
[Array]::Clear($key, 0, $key.Length)
Write-Output $output
`;

const INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ProductionDesktopProvisioning {
  readonly endpoint: string;
  readonly installationId: string;
  readonly deviceId: string;
  readonly channelSecret: Buffer;
}

function requireValue(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required for production desktop bootstrap`);
  }
  return value.trim();
}

function resolveEndpoint(installationId: string, platform: NodeJS.Platform): string {
  if (!INSTALLATION_ID.test(installationId)) {
    throw new Error("invalid installation id for production desktop bootstrap");
  }
  if (platform !== "win32") {
    throw new Error("production desktop bootstrap requires Windows named pipes");
  }
  return `\\\\.\\pipe\\camacho-pos-${installationId.toLowerCase()}`;
}

function loadOrCreateChannelSecret(
  dataDirectory: string,
  installationId: string,
  platform: NodeJS.Platform,
): Buffer {
  if (platform !== "win32") {
    throw new Error("local channel production secret requires Windows DPAPI");
  }

  const securityDirectory = join(dataDirectory, "security");
  const dpapiDirectory = join(securityDirectory, "dpapi");
  mkdirSync(securityDirectory, { recursive: true, mode: 0o700 });

  const context = `local-channel:${installationId}`;
  const contextHash = createHash("sha256").update(context).digest("hex");
  const path = join(dpapiDirectory, `root-key-${contextHash}.dpapi`);
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", DPAPI_SCRIPT],
    {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024,
      env: {
        ...process.env,
        POS_DPAPI_KEY_PATH: path,
        POS_DPAPI_CONTEXT: context,
      },
    },
  );

  if (result.error) throw new Error("Windows DPAPI invocation failed", { cause: result.error });
  if (result.status !== 0) {
    const diagnostic = result.stderr.trim().slice(0, 1_024);
    throw new Error(`Windows DPAPI key operation failed${diagnostic ? `: ${diagnostic}` : ""}`);
  }

  const encoded = result.stdout.trim();
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encoded) {
    key.fill(0);
    throw new Error("Windows DPAPI returned an invalid root key");
  }

  // Reuse the existing encrypted-secret format used by the service. The
  // service owns the encrypted store implementation; this function only
  // provisions the shared OS-bound channel credential.
  const secretPath = join(securityDirectory, `${LOCAL_CHANNEL_SECRET_NAME}.bin`);
  throw new Error(
    `shared channel secret provisioning is not yet installed at ${secretPath}; root key was resolved but no plaintext secret was persisted`,
  );
}

export function loadProductionDesktopProvisioning(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): ProductionDesktopProvisioning {
  const dataDirectory = requireValue("POS_DATA_DIRECTORY", environment.POS_DATA_DIRECTORY);
  const installationId = requireValue("POS_INSTALLATION_ID", environment.POS_INSTALLATION_ID);
  const deviceId = requireValue("POS_DEVICE_ID", environment.POS_DEVICE_ID);
  const endpoint = resolveEndpoint(installationId, platform);
  const channelSecret = loadOrCreateChannelSecret(dataDirectory, installationId, platform);
  return { endpoint, installationId, deviceId, channelSecret };
}

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { SecretStoreKeyProvider } from "./encrypted-secret-store.js";

const DPAPI_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"

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
Set-Acl -LiteralPath $path -AclObject $acl

$output = [Convert]::ToBase64String($key)
[Array]::Clear($key, 0, $key.Length)
Write-Output $output
`;

export class WindowsDpapiKeyProvider implements SecretStoreKeyProvider {
  readonly protection = "OS_BOUND" as const;

  constructor(
    private readonly directory: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    if (!isAbsolute(directory)) throw new Error("DPAPI key directory must be absolute");
  }

  loadKey(context: string): Buffer {
    if (this.platform !== "win32") {
      throw new Error("Windows DPAPI key provider requires Windows");
    }
    if (!context) throw new Error("DPAPI key context is required");

    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const contextHash = createHash("sha256").update(context).digest("hex");
    const path = join(this.directory, `root-key-${contextHash}.dpapi`);
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

    if (result.error) {
      throw new Error("Windows DPAPI invocation failed", { cause: result.error });
    }
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
    return key;
  }
}

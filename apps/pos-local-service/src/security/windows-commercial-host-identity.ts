import { spawnSync } from "node:child_process";

/**
 * A commercial channel secured by DPAPI CurrentUser and a per-logon named-pipe
 * DACL must run as the authorized interactive user until an independently
 * authenticated SCM↔Desktop handoff exists.
 *
 * This only checks the OS execution context; it NEVER grants a BUSINESS or
 * GLOBAL identity, validates MFA, or substitutes for the Central device proof.
 * It deliberately does not accept a user SID/identity from environment vars.
 */
const VERIFY_INTERACTIVE_IDENTITY = String.raw`
$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsAuthenticated -or $identity.IsSystem -or $identity.IsAnonymous) { exit 11 }
$name = $identity.Name
if ($name.StartsWith("NT SERVICE\", [StringComparison]::OrdinalIgnoreCase) -or
    $name.StartsWith("NT AUTHORITY\", [StringComparison]::OrdinalIgnoreCase)) { exit 12 }
$interactive = @("S-1-5-4", "S-1-5-14")
$memberships = @($identity.Groups | ForEach-Object { $_.Value })
if (@($memberships | Where-Object { $_ -in $interactive }).Count -eq 0) { exit 13 }
Write-Output "COMMERCIAL_INTERACTIVE_CONTEXT_VERIFIED"
`;

type CommandResult = { readonly status: number | null; readonly stdout?: string; readonly error?: Error };
type IdentityRunner = (script: string) => CommandResult;

function runWindowsIdentityInspection(script: string): CommandResult {
  return spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 4096,
  });
}

export function assertWindowsCommercialInteractiveHost(
  platform: NodeJS.Platform = process.platform,
  runner: IdentityRunner = runWindowsIdentityInspection,
): void {
  if (platform !== "win32") {
    throw new Error("COMMERCIAL_WINDOWS_HOST_REQUIRED");
  }
  let result: CommandResult;
  try {
    result = runner(VERIFY_INTERACTIVE_IDENTITY);
  } catch {
    throw new Error("COMMERCIAL_WINDOWS_IDENTITY_INSPECTION_FAILED");
  }
  if (result.error || result.status === null) {
    throw new Error("COMMERCIAL_WINDOWS_IDENTITY_INSPECTION_FAILED");
  }
  if (result.status !== 0 || result.stdout?.trim() !== "COMMERCIAL_INTERACTIVE_CONTEXT_VERIFIED") {
    throw new Error("COMMERCIAL_WINDOWS_INTERACTIVE_IDENTITY_REQUIRED");
  }
}

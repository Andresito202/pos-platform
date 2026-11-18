import { spawnSync } from "node:child_process";
import { join } from "node:path";

/**
 * A commercial channel secured by DPAPI CurrentUser and a per-logon named-pipe
 * DACL must run as the authorized interactive user until an independently
 * authenticated SCM↔Desktop handoff exists.
 *
 * This only checks the OS execution context; it NEVER grants a BUSINESS or
 * GLOBAL identity, validates MFA, or substitutes for the Central device proof.
 * It deliberately does not accept a user SID/identity from environment vars.
 */

function windowsPowerShellExecutable(): string {
  const root = process.env.SystemRoot ?? process.env.WINDIR;
  if (typeof root === "string" && root.length > 0) {
    return join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  }
  return "powershell.exe";
}
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

/**
 * SCM commercial handoff may start only under the real virtual service account
 * in Session 0. G1 native peer attestation on the NSIS-installed SCM account
 * (HEAD 76253bb6) proved identity interop; this gate no longer blocks that
 * proven path with an unconditional throw. It still refuses any non-service
 * host. No environment switch, provision boolean or lab flag bypasses it.
 */
const VERIFY_SCM_SERVICE_IDENTITY = String.raw`
$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsAuthenticated -or $identity.IsSystem -or $identity.IsAnonymous) { exit 21 }
if ($identity.Name -ne 'NT SERVICE\CamachoPOSLocalService') { exit 22 }
if ([Diagnostics.Process]::GetCurrentProcess().SessionId -ne 0) { exit 23 }
Write-Output "SCM_COMMERCIAL_SERVICE_CONTEXT_VERIFIED"
`;

type CommandResult = { readonly status: number | null; readonly stdout?: string; readonly error?: Error };

type IdentityRunner = (script: string) => CommandResult;

function runWindowsIdentityInspection(script: string): CommandResult {
  const invoke = (): CommandResult =>
    spawnSync(windowsPowerShellExecutable(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 4096,
      timeout: 15_000,
      killSignal: "SIGKILL",
    });
  // One retry only for spawn/timeout (status null / error). Never retries a
  // completed non-zero identity exit (11/12/13/21/22/23) — those stay fail-closed.
  const first = invoke();
  if (first.error || first.status === null) {
    return invoke();
  }
  return first;
}

/**
 * Fail-closed SCM commercial entry: requires the real
 * `NT SERVICE\CamachoPOSLocalService` Session-0 host. Does not certify
 * BUSINESS/GLOBAL login, MFA, or Authenticode (RT-009-B remains blocked).
 */
export function assertWindowsScmCommercialCertification(
  platform: NodeJS.Platform = process.platform,
  runner: IdentityRunner = runWindowsIdentityInspection,
): void {
  if (platform !== "win32") {
    throw new Error("SCM_COMMERCIAL_WINDOWS_REQUIRED");
  }
  let result: CommandResult;
  try {
    result = runner(VERIFY_SCM_SERVICE_IDENTITY);
  } catch {
    throw new Error("SCM_COMMERCIAL_SERVICE_IDENTITY_INSPECTION_FAILED");
  }
  if (result.error || result.status === null) {
    throw new Error("SCM_COMMERCIAL_SERVICE_IDENTITY_INSPECTION_FAILED");
  }
  if (result.status !== 0 || result.stdout?.trim() !== "SCM_COMMERCIAL_SERVICE_CONTEXT_VERIFIED") {
    throw new Error("SCM_COMMERCIAL_SERVICE_CONTEXT_REQUIRED");
  }
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

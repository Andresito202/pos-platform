import { spawnSync } from "node:child_process";

const WINDOWS_PIPE_SECURITY_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

public static class PosPlatformPipeSecurity
{
    private const int GENERIC_ALL = unchecked((int)0x10000000);
    private const uint GENERIC_READ = 0x80000000;
    private const uint GENERIC_WRITE = 0x40000000;
    private const uint READ_CONTROL = 0x00020000;
    private const uint WRITE_DAC = 0x00040000;
    private const uint OPEN_EXISTING = 3;
    private const int ERROR_PIPE_BUSY = 231;

    private const int SE_KERNEL_OBJECT = 6;
    private const uint OWNER_SECURITY_INFORMATION = 0x00000001;
    private const uint DACL_SECURITY_INFORMATION = 0x00000004;
    private const uint SDDL_REVISION_1 = 1;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFileW(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        IntPtr lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        IntPtr hTemplateFile
    );

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool WaitNamedPipeW(string lpNamedPipeName, uint nTimeOut);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint SetSecurityInfo(
        IntPtr handle,
        int ObjectType,
        uint SecurityInfo,
        IntPtr psidOwner,
        IntPtr psidGroup,
        IntPtr pDacl,
        IntPtr pSacl
    );

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint GetSecurityInfo(
        IntPtr handle,
        int ObjectType,
        uint SecurityInfo,
        out IntPtr ppsidOwner,
        out IntPtr ppsidGroup,
        out IntPtr ppDacl,
        IntPtr ppSacl,
        out IntPtr ppSecurityDescriptor
    );

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(
        IntPtr SecurityDescriptor,
        uint RequestedStringSDRevision,
        uint SecurityInformation,
        out IntPtr StringSecurityDescriptor,
        out uint StringSecurityDescriptorLen
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LocalFree(IntPtr hMem);

    private static IntPtr OpenPipe(string pipePath, uint additionalAccess)
    {
        IntPtr pipeHandle = new IntPtr(-1);
        for (int attempt = 0; attempt < 4; attempt++)
        {
            pipeHandle = CreateFileW(
                pipePath,
                GENERIC_READ | GENERIC_WRITE | READ_CONTROL | additionalAccess,
                0,
                IntPtr.Zero,
                OPEN_EXISTING,
                0,
                IntPtr.Zero
            );
            if (pipeHandle != new IntPtr(-1)) return pipeHandle;

            int error = Marshal.GetLastWin32Error();
            if (error != ERROR_PIPE_BUSY)
                throw new Win32Exception(error, "CreateFileW named-pipe access failed");

            if (!WaitNamedPipeW(pipePath, 2000))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "WaitNamedPipeW failed");
        }

        throw new Win32Exception(Marshal.GetLastWin32Error(), "Named pipe remained unavailable");
    }

    public static string HardenNamedPipe(string pipePath)
    {
        IntPtr pipeHandle = new IntPtr(-1);
        IntPtr aclPointer = IntPtr.Zero;

        try
        {
            pipeHandle = OpenPipe(pipePath, WRITE_DAC);

            SecurityIdentifier currentUser = WindowsIdentity.GetCurrent().User;
            SecurityIdentifier localSystem =
                new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);

            RawAcl acl = new RawAcl(2, currentUser.Equals(localSystem) ? 1 : 2);
            acl.InsertAce(
                0,
                new CommonAce(
                    AceFlags.None,
                    AceQualifier.AccessAllowed,
                    GENERIC_ALL,
                    localSystem,
                    false,
                    null
                )
            );
            if (!currentUser.Equals(localSystem))
            {
                acl.InsertAce(
                    1,
                    new CommonAce(
                        AceFlags.None,
                        AceQualifier.AccessAllowed,
                        GENERIC_ALL,
                        currentUser,
                        false,
                        null
                    )
                );
            }

            byte[] aclBytes = new byte[acl.BinaryLength];
            acl.GetBinaryForm(aclBytes, 0);
            aclPointer = Marshal.AllocHGlobal(aclBytes.Length);
            Marshal.Copy(aclBytes, 0, aclPointer, aclBytes.Length);

            uint result = SetSecurityInfo(
                pipeHandle,
                SE_KERNEL_OBJECT,
                DACL_SECURITY_INFORMATION,
                IntPtr.Zero,
                IntPtr.Zero,
                aclPointer,
                IntPtr.Zero
            );
            if (result != 0)
                throw new Win32Exception((int)result, "SetSecurityInfo named-pipe DACL failed");

            return currentUser.Value;
        }
        finally
        {
            if (aclPointer != IntPtr.Zero) Marshal.FreeHGlobal(aclPointer);
            if (pipeHandle != new IntPtr(-1)) CloseHandle(pipeHandle);
        }
    }

    public static string InspectNamedPipe(string pipePath)
    {
        IntPtr pipeHandle = new IntPtr(-1);
        IntPtr securityDescriptor = IntPtr.Zero;
        IntPtr sddlPointer = IntPtr.Zero;

        try
        {
            pipeHandle = OpenPipe(pipePath, 0);

            IntPtr owner;
            IntPtr group;
            IntPtr dacl;
            uint securityResult = GetSecurityInfo(
                pipeHandle,
                SE_KERNEL_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                out owner,
                out group,
                out dacl,
                IntPtr.Zero,
                out securityDescriptor
            );
            if (securityResult != 0)
                throw new Win32Exception((int)securityResult, "GetSecurityInfo failed");

            uint sddlLength;
            if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(
                securityDescriptor,
                SDDL_REVISION_1,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                out sddlPointer,
                out sddlLength
            ))
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "ConvertSecurityDescriptorToStringSecurityDescriptorW failed"
                );

            return Marshal.PtrToStringUni(sddlPointer) ?? "";
        }
        finally
        {
            if (sddlPointer != IntPtr.Zero) LocalFree(sddlPointer);
            if (securityDescriptor != IntPtr.Zero) LocalFree(securityDescriptor);
            if (pipeHandle != new IntPtr(-1)) CloseHandle(pipeHandle);
        }
    }
}
'@

$action = $env:POS_PIPE_SECURITY_ACTION
$path = $env:POS_PIPE_SECURITY_PATH
if ([string]::IsNullOrWhiteSpace($path)) {
  throw "named-pipe path is required"
}

if ($action -eq "harden") {
  $sid = [PosPlatformPipeSecurity]::HardenNamedPipe($path)
  [pscustomobject]@{ currentSid = $sid } | ConvertTo-Json -Compress
  exit 0
}

if ($action -eq "inspect") {
  $sddl = [PosPlatformPipeSecurity]::InspectNamedPipe($path)
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  [pscustomobject]@{ currentSid = $sid; sddl = $sddl } | ConvertTo-Json -Compress
  exit 0
}

throw "unknown pipe security action"
`;

interface PipeSecurityResult {
  readonly currentSid: string;
  readonly sddl?: string;
}

export interface WindowsNamedPipeSecurityReport {
  readonly currentSid: string;
  readonly sddl: string;
  readonly allowedTrustees: readonly string[];
}

function invokePipeSecurity(
  action: "harden" | "inspect",
  endpoint: string,
): PipeSecurityResult {
  if (process.platform !== "win32") {
    throw new Error("Windows named-pipe security requires Windows");
  }

  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_PIPE_SECURITY_SCRIPT],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 64 * 1024,
      env: {
        ...process.env,
        POS_PIPE_SECURITY_ACTION: action,
        POS_PIPE_SECURITY_PATH: endpoint,
      },
    },
  );

  if (result.error) {
    throw new Error("Windows named-pipe security helper failed", { cause: result.error });
  }
  if (result.status !== 0) {
    const diagnostic = result.stderr.trim().slice(0, 2_048);
    throw new Error(
      `Windows named-pipe security helper rejected ${action}${diagnostic ? `: ${diagnostic}` : ""}`,
    );
  }

  try {
    const parsed = JSON.parse(result.stdout.trim()) as PipeSecurityResult;
    if (!/^S-1-[0-9-]+$/.test(parsed.currentSid)) {
      throw new Error("current Windows SID is invalid");
    }
    return parsed;
  } catch (error) {
    throw new Error("Windows named-pipe security helper returned invalid JSON", { cause: error });
  }
}

export function hardenWindowsNamedPipeSecurity(endpoint: string): string {
  if (!endpoint.startsWith("\\\\.\\pipe\\")) {
    throw new Error("named-pipe DACL hardening requires a local Windows named-pipe endpoint");
  }
  return invokePipeSecurity("harden", endpoint).currentSid;
}

function allowedAceTrustees(sddl: string): string[] {
  const trustees: string[] = [];
  for (const match of sddl.matchAll(/\(([^)]+)\)/g)) {
    const fields = match[1]!.split(";");
    if (fields.length < 6) {
      throw new Error("Windows named-pipe DACL contains a malformed ACE");
    }
    if (fields[0] !== "A") {
      throw new Error(`Windows named-pipe DACL contains unsupported ACE type: ${fields[0]}`);
    }
    trustees.push(fields[5]!);
  }
  return trustees;
}

export function inspectWindowsNamedPipeSecurity(endpoint: string): WindowsNamedPipeSecurityReport {
  if (!endpoint.startsWith("\\\\.\\pipe\\")) {
    throw new Error("Windows named-pipe security inspection requires a local named-pipe endpoint");
  }

  const result = invokePipeSecurity("inspect", endpoint);
  const sddl = result.sddl;
  if (!sddl || !sddl.includes("D:")) {
    throw new Error("Windows named-pipe security descriptor does not contain a DACL");
  }

  const allowedTrustees = allowedAceTrustees(sddl);
  const permitted = new Set([
    result.currentSid,
    "SY",
    "S-1-5-18",
    "OW",
  ]);
  const unauthorized = allowedTrustees.filter((trustee) => !permitted.has(trustee));
  if (unauthorized.length > 0) {
    throw new Error(
      `Windows named-pipe DACL grants access to unauthorized trustees: ${unauthorized.join(", ")}`,
    );
  }

  const hasCurrentIdentity = allowedTrustees.includes(result.currentSid)
    || (result.currentSid === "S-1-5-18" && (
      allowedTrustees.includes("SY") || allowedTrustees.includes("S-1-5-18")
    ));
  if (!hasCurrentIdentity) {
    throw new Error("Windows named-pipe DACL does not grant the service identity access");
  }

  return {
    currentSid: result.currentSid,
    sddl,
    allowedTrustees,
  };
}

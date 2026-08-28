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
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint TOKEN_QUERY = 0x0008;
    private const uint TOKEN_ADJUST_DEFAULT = 0x0080;
    private const int TOKEN_DEFAULT_DACL_CLASS = 6;
    private const int GENERIC_ALL = unchecked((int)0x10000000);

    private const uint GENERIC_READ = 0x80000000;
    private const uint GENERIC_WRITE = 0x40000000;
    private const uint READ_CONTROL = 0x00020000;
    private const uint OPEN_EXISTING = 3;
    private const int ERROR_PIPE_BUSY = 231;

    private const int SE_KERNEL_OBJECT = 6;
    private const uint OWNER_SECURITY_INFORMATION = 0x00000001;
    private const uint DACL_SECURITY_INFORMATION = 0x00000004;
    private const uint SDDL_REVISION_1 = 1;

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_DEFAULT_DACL
    {
        public IntPtr DefaultDacl;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(
        uint dwDesiredAccess,
        bool bInheritHandle,
        uint dwProcessId
    );

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(
        IntPtr ProcessHandle,
        uint DesiredAccess,
        out IntPtr TokenHandle
    );

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetTokenInformation(
        IntPtr TokenHandle,
        int TokenInformationClass,
        IntPtr TokenInformation,
        int TokenInformationLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

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
    private static extern IntPtr LocalFree(IntPtr hMem);

    public static string RestrictProcessDefaultDacl(uint processId)
    {
        IntPtr processHandle = IntPtr.Zero;
        IntPtr tokenHandle = IntPtr.Zero;
        IntPtr aclPointer = IntPtr.Zero;
        IntPtr tokenInfoPointer = IntPtr.Zero;

        try
        {
            processHandle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
            if (processHandle == IntPtr.Zero)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess failed");

            if (!OpenProcessToken(
                processHandle,
                TOKEN_QUERY | TOKEN_ADJUST_DEFAULT,
                out tokenHandle
            ))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcessToken failed");

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

            TOKEN_DEFAULT_DACL tokenDefaultDacl = new TOKEN_DEFAULT_DACL
            {
                DefaultDacl = aclPointer
            };
            int tokenInfoSize = Marshal.SizeOf(typeof(TOKEN_DEFAULT_DACL));
            tokenInfoPointer = Marshal.AllocHGlobal(tokenInfoSize);
            Marshal.StructureToPtr(tokenDefaultDacl, tokenInfoPointer, false);

            if (!SetTokenInformation(
                tokenHandle,
                TOKEN_DEFAULT_DACL_CLASS,
                tokenInfoPointer,
                tokenInfoSize
            ))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "SetTokenInformation failed");

            return currentUser.Value;
        }
        finally
        {
            if (tokenInfoPointer != IntPtr.Zero) Marshal.FreeHGlobal(tokenInfoPointer);
            if (aclPointer != IntPtr.Zero) Marshal.FreeHGlobal(aclPointer);
            if (tokenHandle != IntPtr.Zero) CloseHandle(tokenHandle);
            if (processHandle != IntPtr.Zero) CloseHandle(processHandle);
        }
    }

    public static string InspectNamedPipe(string pipePath)
    {
        IntPtr pipeHandle = new IntPtr(-1);
        IntPtr securityDescriptor = IntPtr.Zero;
        IntPtr sddlPointer = IntPtr.Zero;

        try
        {
            for (int attempt = 0; attempt < 3; attempt++)
            {
                pipeHandle = CreateFileW(
                    pipePath,
                    GENERIC_READ | GENERIC_WRITE | READ_CONTROL,
                    0,
                    IntPtr.Zero,
                    OPEN_EXISTING,
                    0,
                    IntPtr.Zero
                );
                if (pipeHandle != new IntPtr(-1)) break;

                int error = Marshal.GetLastWin32Error();
                if (error != ERROR_PIPE_BUSY || !WaitNamedPipeW(pipePath, 2000))
                    throw new Win32Exception(error, "CreateFileW named-pipe inspection failed");
            }

            if (pipeHandle == new IntPtr(-1))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Named pipe remained unavailable");

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
if ($action -eq "restrict") {
  $pidValue = [uint32]::Parse($env:POS_PIPE_OWNER_PID)
  $sid = [PosPlatformPipeSecurity]::RestrictProcessDefaultDacl($pidValue)
  [pscustomobject]@{ currentSid = $sid } | ConvertTo-Json -Compress
  exit 0
}

if ($action -eq "inspect") {
  $path = $env:POS_PIPE_SECURITY_PATH
  if ([string]::IsNullOrWhiteSpace($path)) {
    throw "named-pipe path is required"
  }
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

let processDefaultDaclRestricted = false;
let restrictedSid: string | undefined;

function invokePipeSecurity(
  action: "restrict" | "inspect",
  endpoint?: string,
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
        POS_PIPE_OWNER_PID: String(process.pid),
        ...(endpoint === undefined ? {} : { POS_PIPE_SECURITY_PATH: endpoint }),
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

export function restrictCurrentProcessNamedPipeDefaults(): string {
  if (process.platform !== "win32") {
    throw new Error("named-pipe DACL hardening requires Windows");
  }
  if (processDefaultDaclRestricted && restrictedSid) return restrictedSid;

  const result = invokePipeSecurity("restrict");
  processDefaultDaclRestricted = true;
  restrictedSid = result.currentSid;
  return result.currentSid;
}

function allowedAceTrustees(sddl: string): string[] {
  const trustees: string[] = [];
  for (const match of sddl.matchAll(/\(([^)]+)\)/g)) {
    const fields = match[1]!.split(";");
    if (fields.length < 6 || fields[0] !== "A") continue;
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

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const LOCAL_CHANNEL_SECRET_NAME = "local-channel-auth";
const INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface EncryptedSecret { readonly version: 1; readonly iv: string; readonly tag: string; readonly ciphertext: string; }

/**
 * Deriva la clave raiz del equipo con DPAPI, ligada al usuario de Windows.
 *
 * **Vive aqui y se exporta porque habia dos copias.** El servicio tenia la
 * suya y este fichero otra, identicas en significado y distintas en formato:
 * dos superficies para el mismo script, sin nada que las compare. Arreglar una
 * no habria alcanzado a la otra y nada habria fallado al no alcanzarla — que es
 * como envejecio `business-readiness.md`.
 *
 * El paquete no puede importar del servicio, asi que el script vive en el
 * paquete y el servicio lo importa: exactamente el movimiento que ya hizo
 * `canonicalJson` por la misma razon.
 *
 * Usa `powershell.exe` y no `pwsh` a proposito: `ProtectedData` esta en el
 * ensamblado `System.Security` de Windows PowerShell 5.1, y en PowerShell 7
 * exige un paquete NuGet que un equipo de mostrador no tiene.
 */
export const DPAPI_SCRIPT = String.raw`
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
$owner = ([System.IO.File]::GetAccessControl($path)).GetOwner([System.Security.Principal.SecurityIdentifier])
$acl = New-Object System.Security.AccessControl.FileSecurity
# Reescribir el dueño exige WRITE_OWNER aunque el dueño no cambie, y un usuario
# sin elevar no lo tiene sobre el fichero que el mismo acaba de crear bajo
# C:\<carpeta>: Windows 10/11 solo le hereda Modificar (Authenticated Users).
# Siendo ya el dueño, la DACL basta con WRITE_DAC, que el dueño tiene siempre.
# Mismo estado final: dueño = usuario actual y una sola regla, la suya.
if (-not $identity.User.Equals($owner)) {
  $acl.SetOwner($identity.User)
}
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
  $identity.User,
  [System.Security.AccessControl.FileSystemRights]::FullControl,
  [System.Security.AccessControl.AccessControlType]::Allow
)
[void]$acl.AddAccessRule($rule)
try {
  [System.IO.File]::SetAccessControl($path, $acl)
} catch {
  throw "DPAPI root key ACL cannot be restricted (owner $($owner.Value), current user $($identity.User.Value)): $($_.Exception.Message)"
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

function loadRootKey(dataDirectory: string, installationId: string, platform: NodeJS.Platform): Buffer {
  if (platform !== "win32") throw new Error("local channel production secret requires Windows DPAPI");
  const securityDirectory = join(dataDirectory, "security");
  const dpapiDirectory = join(securityDirectory, "dpapi");
  mkdirSync(securityDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(dpapiDirectory, { recursive: true, mode: 0o700 });
  const context = `local-channel:${installationId}`;
  const contextHash = createHash("sha256").update(context).digest("hex");
  const path = join(dpapiDirectory, `root-key-${contextHash}.dpapi`);
  return runDpapiRootKey(path, context);
}

/**
 * Ejecuta el script y valida lo que devuelve.
 *
 * Tambien estaba duplicada, palabra por palabra, en el servicio. El
 * diagnostico de `stderr` se acota a 1 KiB y se propaga: es lo unico que un
 * operador va a ver si DPAPI falla en su equipo, asi que no se traga.
 */
export function runDpapiRootKey(path: string, context: string): Buffer {
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", DPAPI_SCRIPT],
    {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024,
      env: { ...process.env, POS_DPAPI_KEY_PATH: path, POS_DPAPI_CONTEXT: context },
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
  return key;
}

function readSecret(path: string, key: Buffer, context: string): Buffer {
  if (lstatSync(path).isSymbolicLink()) throw new Error("secret file cannot be a symbolic link");
  const value = JSON.parse(readFileSync(path, "utf8")) as EncryptedSecret;
  if (value.version !== 1) throw new Error("unsupported secret envelope version");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  try { return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64url")), decipher.final()]); }
  catch { throw new Error("secret envelope authentication failed"); }
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
  const installationId = requireValue("POS_INSTALLATION_ID", environment.POS_INSTALLATION_ID);
  const deviceId = requireValue("POS_DEVICE_ID", environment.POS_DEVICE_ID);
  const endpoint = resolveEndpoint(installationId, platform);
  const rootKey = loadRootKey(dataDirectory, installationId, platform);
  const securityDirectory = join(dataDirectory, "security");
  mkdirSync(securityDirectory, { recursive: true, mode: 0o700 });
  const path = join(securityDirectory, `${LOCAL_CHANNEL_SECRET_NAME}.secret`);
  const context = `local-channel:${installationId}`;
  try {
    if (existsSync(path)) {
      const secret = readSecret(path, rootKey, context);
      if (secret.byteLength !== 32) { secret.fill(0); throw new Error("persisted local channel secret has invalid length"); }
      return { endpoint, installationId, deviceId, channelSecret: secret };
    }
    const secret = randomBytes(32);
    try { writeSecret(dataDirectory, rootKey, context, secret); return { endpoint, installationId, deviceId, channelSecret: Buffer.from(secret) }; }
    finally { secret.fill(0); }
  } finally { rootKey.fill(0); }
}

export function loadOrCreateWindowsLocalChannelSecret(dataDirectory: string, installationId: string, platform: NodeJS.Platform = process.platform): Buffer {
  const provisioning = loadProductionDesktopProvisioning({ POS_DATA_DIRECTORY: dataDirectory, POS_INSTALLATION_ID: installationId, POS_DEVICE_ID: "00000000-0000-4000-8000-000000000000" }, platform);
  return provisioning.channelSecret;
}

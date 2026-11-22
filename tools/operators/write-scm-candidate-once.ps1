#requires -Version 5.1
<#
  Privileged, create-once candidate record storage. No runtime activation,
  service installation, private keys, directory creation, or ACL broadening.
  The caller supplies an already validated candidate through standard input.
  The trust anchor is the pre-existing installer-owned, protected directory.
#>
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Reject([string]$Code) { throw $Code }
function Assert-Path([string]$Path) {
  if ($Path -notmatch '^[A-Za-z]:\\' -or
      [IO.Path]::GetFullPath($Path) -ne $Path) {
    Reject 'SCM_STORE_LOCAL_CANONICAL_PATH_REQUIRED'
  }
  $segments = $Path -split '\\'
  if (@($segments | Where-Object {
      $_ -match '^(?i:lab-data|\.lab-state|preprod|camachoposcmlab|design-review-runtime)$'
    }).Count -gt 0) { Reject 'SCM_STORE_NONCOMMERCIAL_PATH' }
  $cursor = $Path
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Reject 'SCM_STORE_REPARSE_PATH_REJECTED'
      }
    }
    $parent = [IO.Path]::GetDirectoryName($cursor)
    if (-not $parent -or $parent -eq $cursor) { break }
    $cursor = $parent
  }
}
function Assert-ProtectedRoot([string]$Path) {
  Assert-Path $Path
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    Reject 'SCM_STORE_ROOT_NOT_PROVISIONED'
  }
  $acl = Get-Acl -LiteralPath $Path
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  $trusted = @('S-1-5-18', 'S-1-5-32-544')
  if (-not $acl.AreAccessRulesProtected -or $owner -notin $trusted) {
    Reject 'SCM_STORE_ROOT_OWNER_REJECTED'
  }
  $danger = [Security.AccessControl.FileSystemRights]::Write -bor
    [Security.AccessControl.FileSystemRights]::Delete -bor
    [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne 'Allow') { Reject 'SCM_STORE_COMPLEX_ACL_REJECTED' }
    if (($rule.FileSystemRights -band $danger) -ne 0 -and
        $rule.IdentityReference.Value -notin $trusted) {
      Reject 'SCM_STORE_WRITABLE_BY_UNTRUSTED_SID'
    }
  }
}
function New-TrustedFileAcl {
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544'))
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
    $id = New-Object Security.Principal.SecurityIdentifier $sid
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
      $id,[Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.AccessControlType]::Allow)
    [void]$acl.AddAccessRule($rule)
  }
  return $acl
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Reject 'SCM_STORE_ELEVATION_REQUIRED'
}

$requestText = [Console]::In.ReadToEnd()
if ([Text.Encoding]::UTF8.GetByteCount($requestText) -gt 131072) {
  Reject 'SCM_STORE_REQUEST_LIMIT'
}
$request = $requestText | ConvertFrom-Json
if (@($request.PSObject.Properties.Name | Sort-Object) -join '|' -cne
    'file|payload|root|sha256') { Reject 'SCM_STORE_REQUEST_SHAPE' }
$root = [string]$request.root
$file = [string]$request.file
Assert-ProtectedRoot $root
if ($file -cne (Join-Path $root 'candidate-pair.json')) {
  Reject 'SCM_STORE_FILE_BINDING_REJECTED'
}
Assert-Path $file
if (Test-Path -LiteralPath $file) { Reject 'SCM_STORE_ALREADY_PROVISIONED' }
$payload = [string]$request.payload
$bytes = [Text.Encoding]::UTF8.GetBytes($payload)
if ($bytes.Length -lt 1 -or $bytes.Length -gt 65536) {
  Reject 'SCM_STORE_RECORD_SIZE_REJECTED'
}
$sha = [Security.Cryptography.SHA256]::Create()
try { $digest = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() }
finally { $sha.Dispose() }
if ($digest -cne [string]$request.sha256) { Reject 'SCM_STORE_HASH_MISMATCH' }
# CreateNew prevents replacement. Temp and final reside in the same directory,
# so the publish move cannot expose a partial file or cross volumes.
$temporary = Join-Path $root ('.scm-candidate-' + [Guid]::NewGuid().ToString('N') + '.tmp')
$created = $false
try {
  $acl = New-TrustedFileAcl
  $stream = New-Object IO.FileStream(
    $temporary,[IO.FileMode]::CreateNew,
    [Security.AccessControl.FileSystemRights]::Write,
    [IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,$acl)
  $created = $true
  try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) }
  finally { $stream.Dispose() }
  # File.Move without an overwrite option fails if another installer wins.
  [IO.File]::Move($temporary,$file)
  $created = $false
  Assert-ProtectedRoot $root
  $finalAcl = Get-Acl -LiteralPath $file
  $finalOwner = $finalAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if (-not $finalAcl.AreAccessRulesProtected -or
      $finalOwner -notin @('S-1-5-18','S-1-5-32-544')) {
    Reject 'SCM_STORE_FINAL_ACL_REJECTED'
  }
  [Console]::Write('SCM_CANDIDATE_STORED')
} finally {
  [Array]::Clear($bytes,0,$bytes.Length)
  if ($created -and (Test-Path -LiteralPath $temporary)) {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
}

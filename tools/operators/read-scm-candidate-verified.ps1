#requires -Version 5.1
<#
  Read-only recovery of an installer-owned candidate record.
  Never executes SCM, creates directories, grants ACLs or modifies a record.
  Returns base64 of public-only candidate JSON to a trusted operator process.
  The operator MUST independently verify the expected SHA-256.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Deny([string]$reason) { throw $reason }
function Assert-SafePath([string]$path) {
  if ($path -notmatch '^[A-Za-z]:\\' -or [IO.Path]::GetFullPath($path) -cne $path) {
    Deny 'SCM_RECOVERY_CANONICAL_PATH_REQUIRED'
  }
  $segments = $path -split '\\'
  if (@($segments | Where-Object {
    $_ -match '^(?i:lab-data|\.lab-state|preprod|camachoposcmlab|design-review-runtime)$'
  }).Count -gt 0) { Deny 'SCM_RECOVERY_NONCOMMERCIAL_PATH_REJECTED' }
  $cursor = $path
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      if (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Deny 'SCM_RECOVERY_REPARSE_PATH_REJECTED'
      }
    }
    $parent = [IO.Path]::GetDirectoryName($cursor)
    if (-not $parent -or $parent -eq $cursor) { break }
    $cursor = $parent
  }
}
function Assert-ProtectedAcl($acl) {
  $trusted = @('S-1-5-18','S-1-5-32-544')
  if (-not $acl.AreAccessRulesProtected -or
      $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) {
    Deny 'SCM_RECOVERY_OWNER_REJECTED'
  }
  foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne 'Allow' -or
        $rule.IdentityReference.Value -notin $trusted) {
      Deny 'SCM_RECOVERY_ACL_REJECTED'
    }
  }
}
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Deny 'SCM_RECOVERY_ELEVATION_REQUIRED'
}
$requestText = [Console]::In.ReadToEnd()
if ([Text.Encoding]::UTF8.GetByteCount($requestText) -gt 4096) {
  Deny 'SCM_RECOVERY_REQUEST_LIMIT'
}
$request = $requestText | ConvertFrom-Json
if (@($request.PSObject.Properties.Name | Sort-Object) -join '|' -cne 'root') {
  Deny 'SCM_RECOVERY_REQUEST_SHAPE'
}
$root = [string]$request.root
Assert-SafePath $root
if (-not (Test-Path -LiteralPath $root -PathType Container)) {
  Deny 'SCM_RECOVERY_ROOT_MISSING'
}
Assert-ProtectedAcl (Get-Acl -LiteralPath $root)
$file = Join-Path $root 'candidate-pair.json'
Assert-SafePath $file
# Hold the file handle while inspecting its ACL and reading its contents.
$stream = New-Object IO.FileStream(
  $file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
$bytes = $null
try {
  if ($stream.Length -le 0 -or $stream.Length -gt 65536) {
    Deny 'SCM_RECOVERY_RECORD_SIZE_REJECTED'
  }
  Assert-ProtectedAcl ($stream.GetAccessControl())
  $bytes = New-Object byte[] ([int]$stream.Length)
  $offset = 0
  while ($offset -lt $bytes.Length) {
    $count = $stream.Read($bytes,$offset,$bytes.Length-$offset)
    if ($count -le 0) { Deny 'SCM_RECOVERY_READ_FAILED' }
    $offset += $count
  }
  [Console]::Write([Convert]::ToBase64String($bytes))
} finally {
  $stream.Dispose()
  if ($bytes) { [Array]::Clear($bytes,0,$bytes.Length) }
}

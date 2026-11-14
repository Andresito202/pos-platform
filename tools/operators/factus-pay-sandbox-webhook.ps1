[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Generate','Inspect','CopyToClipboard')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$SecretFile,
  [Parameter(Mandatory=$true)][string]$BindingFile
)
$ErrorActionPreference='Stop';Set-PSDebug -Off
Add-Type -AssemblyName System.Security
function Private-Path([string]$Path){
  $item=Get-Item -LiteralPath $Path -Force;$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'REPARSE'}
  $acl=Get-Acl -LiteralPath $Path
  if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'OWNER'}
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid.Value,'S-1-5-18')){throw 'ACL'}
  }
}
function Save-Private([string]$Path,[string]$Content){
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=New-Object Security.AccessControl.FileSecurity
  $acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
  [void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')))
  $stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{[IO.File]::SetAccessControl($Path,$acl);$bytes=[Text.Encoding]::UTF8.GetBytes($Content);$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
$plain=$null;$key=$null;$random=$null
try{
  if($env:OS -ne 'Windows_NT'){throw 'WINDOWS_REQUIRED'}
  foreach($path in @($SecretFile,$BindingFile)){if(-not [IO.Path]::IsPathRooted($path)){throw 'ABSOLUTE_PATH_REQUIRED'}}
  $SecretFile=[IO.Path]::GetFullPath($SecretFile);$BindingFile=[IO.Path]::GetFullPath($BindingFile)
  $repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')).TrimEnd('\')+'\'
  if($SecretFile.StartsWith($repo,[StringComparison]::OrdinalIgnoreCase) -or $BindingFile.StartsWith($repo,[StringComparison]::OrdinalIgnoreCase)){throw 'OUTSIDE_GIT_REQUIRED'}
  $parent=[IO.Path]::GetDirectoryName($SecretFile);Private-Path $parent;Private-Path $BindingFile
  for($cursor=$parent;$cursor;$cursor=[IO.Path]::GetDirectoryName($cursor)){
    if(((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'UNSAFE_PARENT'}
  }
  if((Get-Item -LiteralPath $BindingFile).Length -gt 16384){throw 'BINDING_TOO_LARGE'}
  $binding=Get-Content -LiteralPath $BindingFile -Raw|ConvertFrom-Json
  if($binding.environment -ne 'SANDBOX' -or @($binding.PSObject.Properties).Count -ne 4){throw 'SANDBOX_BINDING_REQUIRED'}
  foreach($field in @('tenantId','companyId','integrationId')){if(-not [Guid]::TryParse([string]$binding.$field,[ref]([Guid]::Empty))){throw 'REGISTERED_BINDING_REQUIRED'}}
  $entropy=[Text.Encoding]::UTF8.GetBytes('CAMACHO_FACTUS_PAY_WEBHOOK_OPERATOR_V1')
  if($Mode -eq 'Generate'){
    if((Test-Path -LiteralPath $SecretFile) -or (Test-Path -LiteralPath ($SecretFile+'.registration.json'))){throw 'EXISTING_SECRET_PRESERVED'}
    $random=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try{$rng.GetBytes($random)}finally{$rng.Dispose()}
    $key=[Convert]::ToBase64String($random).TrimEnd('=').Replace('+','-').Replace('/','_')
    $plain=[Text.Encoding]::UTF8.GetBytes($key)
    $cipher=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    Save-Private $SecretFile (@{kind='FACTUS_PAY_WEBHOOK_SECRET';binding=$binding;protectedKey=[Convert]::ToBase64String($cipher)}|ConvertTo-Json -Depth 5 -Compress)
  }else{
    Private-Path $SecretFile;if((Get-Item -LiteralPath $SecretFile).Length -gt 16384){throw 'SECRET_TOO_LARGE'}
    $stored=Get-Content -LiteralPath $SecretFile -Raw|ConvertFrom-Json
    if($stored.kind -ne 'FACTUS_PAY_WEBHOOK_SECRET'){throw 'SECRET_PURPOSE_REJECTED'}
    foreach($field in $binding.PSObject.Properties.Name){if([string]$stored.binding.$field -cne [string]$binding.$field){throw 'SECRET_BINDING_REJECTED'}}
    $plain=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($stored.protectedKey),$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $key=[Text.Encoding]::UTF8.GetString($plain);if($key -notmatch '^[A-Za-z0-9_-]{43}$'){throw 'SECRET_REJECTED'}
  }
  $sha=[Security.Cryptography.SHA256]::Create();try{$hash=([BitConverter]::ToString($sha.ComputeHash($plain))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
  if($Mode -eq 'Generate'){
    Save-Private ($SecretFile+'.registration.json') (@{binding=$binding;secret_sha256=$hash;registrationStatus='NOT_REGISTERED'}|ConvertTo-Json -Depth 5 -Compress)
  }
  if($Mode -eq 'CopyToClipboard'){
    if((Read-Host 'After secure panel login, type COPY SANDBOX WEBHOOK') -cne 'COPY SANDBOX WEBHOOK'){throw 'OPERATOR_CANCELLED'}
    Set-Clipboard -Value $key
    Write-Host 'Key copied without console output. Paste personally into FACTUS Pay Sandbox, then clear clipboard. Disable clipboard history/cloud sync first.'
  }
  [pscustomobject]@{environment='SANDBOX';purpose='WEBHOOK_ONLY';protected=$true;secret_sha256=$hash;networkCalled=$false;centralProvisioned=$false}|ConvertTo-Json -Compress
}catch{[Console]::Error.WriteLine('FACTUS_PAY_WEBHOOK_PREPARATION_REJECTED');exit 1}
finally{if($plain){[Array]::Clear($plain,0,$plain.Length)};if($random){[Array]::Clear($random,0,$random.Length)};$key=$null}

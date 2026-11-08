#requires -Version 5.1
<# Read-only. Does not download, execute, install, stop or configure WinSW. #>
[CmdletBinding()]
param(
 [string]$WinSWPath,
 [string]$ExpectedSha256,
 [string]$ApprovedSignerThumbprint,
 [switch]$Json
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'WINSW_READINESS_REQUIRES_WINDOWS'}
$blocks=New-Object 'System.Collections.Generic.List[string]'
$hashMatched=$false;$signatureTrusted=$false;$versionMatched=$false;$pathSafe=$false
if([string]::IsNullOrWhiteSpace($WinSWPath) -or -not [IO.Path]::IsPathRooted($WinSWPath) -or -not [IO.File]::Exists($WinSWPath)){
 [void]$blocks.Add('WINSW_AUTHORIZED_BINARY_MISSING')
}else{
 try{
  $file=Get-Item -LiteralPath $WinSWPath -Force
  if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'REPARSE'}
  $hash=(Get-FileHash -LiteralPath $WinSWPath -Algorithm SHA256).Hash
  $hashMatched=$ExpectedSha256 -match '^[a-fA-F0-9]{64}$' -and $hash -eq $ExpectedSha256
  $sig=Get-AuthenticodeSignature -LiteralPath $WinSWPath
  $signatureTrusted=$sig.Status -eq 'Valid' -and $null -ne $sig.SignerCertificate -and $ApprovedSignerThumbprint -match '^[a-fA-F0-9]{40}$' -and $sig.SignerCertificate.Thumbprint -eq $ApprovedSignerThumbprint
  $versionMatched=$file.VersionInfo.ProductVersion -match '^2\.12\.0(?:[.+ -]|$)'
  # A writable binary or ancestor permits service code substitution. Inspect
  # effective direct ACEs conservatively; reject complex deny ACLs rather than
  # claim a complete AccessCheck implementation.
  $trusted=@('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  $write=[Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  $cursor=$file.FullName
  while($cursor){
   $item=Get-Item -LiteralPath $cursor -Force
   if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'REPARSE'}
   $acl=Get-Acl -LiteralPath $cursor
   if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted){throw 'OWNER'}
   foreach($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($ace.AccessControlType -ne 'Allow'){throw 'COMPLEX_ACL'}
    if(($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and ($ace.FileSystemRights -band $write) -ne 0 -and $ace.IdentityReference.Value -notin $trusted){throw 'WRITABLE_PATH'}
   }
   $parent=[IO.Path]::GetDirectoryName($cursor);if($parent -eq $cursor){break};$cursor=$parent
  }
  $pathSafe=$true
 }catch{[void]$blocks.Add('WINSW_FILE_OR_ACL_REJECTED')}
 if(-not $hashMatched){[void]$blocks.Add('WINSW_APPROVED_HASH_REQUIRED_OR_MISMATCH')}
 if(-not $signatureTrusted){[void]$blocks.Add('WINSW_APPROVED_AUTHENTICODE_SIGNER_REQUIRED')}
 if(-not $versionMatched){[void]$blocks.Add('WINSW_APPROVED_VERSION_MISMATCH')}
}
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$service=Get-Service -Name 'CamachoPOSLocalService' -ErrorAction SilentlyContinue
$report=[pscustomobject]@{
 CandidateVersion='2.12.0';OfficialRelease='https://github.com/winsw/winsw/releases/tag/v2.12.0'
 BinaryHashMatched=$hashMatched;AuthenticodeSignerMatched=$signatureTrusted;VersionMatched=$versionMatched;PathAclAccepted=$pathSafe
 Elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
 ServiceRegistered=($null -ne $service);BinaryReviewReady=($blocks.Count -eq 0)
 ScmCommercialLoginReady=$false;HumanLoginCertified=$false;Blocks=@($blocks.ToArray())
}
if($Json){$report | ConvertTo-Json -Depth 4}else{$report | Format-List}
if($blocks.Count -gt 0){exit 2}

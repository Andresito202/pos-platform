[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Inspect','ImportToken','Authenticate','VerifyReadOnly')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$CustodyFile,
  [Parameter(Mandatory=$true)][string]$BindingFile,
  [switch]$ReplaceExisting
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Set-PSDebug -Off
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Net.Http
function Assert-PrivatePath([string]$Path){
  $item=Get-Item -LiteralPath $Path -Force
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'UNSAFE_PATH'}
  $acl=Get-Acl -LiteralPath $Path
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid){throw 'PRIVATE_SERVICE_OWNER_REQUIRED'}
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid,'S-1-5-18')){throw 'PRIVATE_SERVICE_ACL_REQUIRED'}
  }
}
function Make-PrivateFile([string]$Path){
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl=New-Object Security.AccessControl.FileSecurity
  $acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
  $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')
  [void]$acl.AddAccessRule($rule);[IO.File]::SetAccessControl($Path,$acl)
}
function Reveal([Security.SecureString]$Secure){
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try{return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
}
function Read-Provider($Client,[string]$Method,[string]$Path,[string]$Token,[string]$Body){
  $req=New-Object Net.Http.HttpRequestMessage((New-Object Net.Http.HttpMethod($Method)),('https://pay-api-sandbox.factus.com.co'+$Path))
  $req.Headers.Accept.ParseAdd('application/json')
  if($Token){$req.Headers.Authorization=New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer',$Token)}
  if($Body){$req.Content=New-Object Net.Http.StringContent($Body,[Text.Encoding]::UTF8,'application/json')}
  try{
    $res=$Client.SendAsync($req,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    try{
      if(-not $res.IsSuccessStatusCode -or $res.Content.Headers.ContentType.MediaType -ne 'application/json'){throw 'PROVIDER_RESPONSE_REJECTED'}
      $stream=$res.Content.ReadAsStreamAsync().GetAwaiter().GetResult();$memory=New-Object IO.MemoryStream;$chunk=New-Object byte[] 4096
      try{while(($n=$stream.Read($chunk,0,$chunk.Length)) -gt 0){if($memory.Length+$n -gt 1048576){throw 'PROVIDER_RESPONSE_TOO_LARGE'};$memory.Write($chunk,0,$n)}
        return ([Text.Encoding]::UTF8.GetString($memory.ToArray())|ConvertFrom-Json)
      }finally{$stream.Dispose();$memory.Dispose();[Array]::Clear($chunk,0,$chunk.Length)}
    }finally{$res.Dispose()}
  }finally{$req.Dispose()}
}
$client=$null;$handler=$null;$password=$null;$email=$null;$token=$null;$payload=$null;$plain=$null;$temp=$null
try{
  if($env:OS -ne 'Windows_NT'){throw 'WINDOWS_REQUIRED'}
  foreach($path in @($CustodyFile,$BindingFile)){if(-not [IO.Path]::IsPathRooted($path)){throw 'ABSOLUTE_PATH_REQUIRED'}}
  $CustodyFile=[IO.Path]::GetFullPath($CustodyFile);$BindingFile=[IO.Path]::GetFullPath($BindingFile)
  $repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')).TrimEnd('\')+'\'
  if($CustodyFile.StartsWith($repo,[StringComparison]::OrdinalIgnoreCase) -or $BindingFile.StartsWith($repo,[StringComparison]::OrdinalIgnoreCase)){throw 'OUTSIDE_REPOSITORY_REQUIRED'}
  $parent=[IO.Path]::GetDirectoryName($CustodyFile)
  # Never chmod an existing broad directory or take over someone else's store.
  Assert-PrivatePath $parent;Assert-PrivatePath $BindingFile
  if((Get-Item -LiteralPath $BindingFile).Length -gt 16384){throw 'BINDING_TOO_LARGE'}
  for($cursor=$parent;$cursor;$cursor=[IO.Path]::GetDirectoryName($cursor)){
    if(((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'UNSAFE_PARENT'}
  }
  $binding=Get-Content -LiteralPath $BindingFile -Raw|ConvertFrom-Json
  if($binding.environment -ne 'SANDBOX' -or @($binding.PSObject.Properties).Count -ne 7){throw 'EXACT_SANDBOX_BINDING_REQUIRED'}
  foreach($field in @('tenantId','companyId','integrationId')){if(-not [Guid]::TryParse([string]$binding.$field,[ref]([Guid]::Empty))){throw 'REGISTERED_BINDING_REQUIRED'}}
  if(-not $binding.credentialReference -or -not $binding.providerAccountReference -or $binding.generation -lt 1 -or [Math]::Floor($binding.generation) -ne $binding.generation){throw 'REGISTERED_BINDING_REQUIRED'}
  $existing=Test-Path -LiteralPath $CustodyFile
  if($existing){Assert-PrivatePath $CustodyFile
    if((Get-Item -LiteralPath $CustodyFile).Length -gt 65536){throw 'CUSTODY_TOO_LARGE'}
    $existingStore=Get-Content -LiteralPath $CustodyFile -Raw|ConvertFrom-Json
    if($existingStore.profile -ne 'CAMACHO_FACTUS_PAY_API_CUSTODY_V1'){throw 'CUSTODY_PROFILE_REJECTED'}
    if($Mode -in @('ImportToken','Authenticate')){
      if(@($existingStore.credentials).Count -ne 1){throw 'PRESERVE_OTHER_ACCOUNT_CREDENTIALS'}
      foreach($field in $binding.PSObject.Properties.Name){if([string]$existingStore.credentials[0].binding.$field -cne [string]$binding.$field){throw 'PRESERVE_DIFFERENT_BINDING'}}
    }
  }
  if($Mode -eq 'Inspect'){
    $protected=$false;$entries=0
    if($existing){$store=Get-Content -LiteralPath $CustodyFile -Raw|ConvertFrom-Json;if($store.profile -ne 'CAMACHO_FACTUS_PAY_API_CUSTODY_V1'){throw 'CUSTODY_PROFILE_REJECTED'};$entries=@($store.credentials).Count;$protected=@($store.credentials|Where-Object {$_.protectedCredential.provider -eq 'WINDOWS_DPAPI_CURRENT_USER'}).Count -eq $entries}
    [pscustomobject]@{environment='SANDBOX';exists=$existing;entries=$entries;dpapiProtected=$protected;networkCalled=$false;tokenValidityVerified=$false}|ConvertTo-Json -Compress
    exit 0
  }
  if($Mode -eq 'VerifyReadOnly'){
    if(-not $existing){throw 'CUSTODY_NOT_PROVISIONED'}
    if((Read-Host 'Authorize SANDBOX GET only: type VERIFY SANDBOX') -cne 'VERIFY SANDBOX'){throw 'OPERATOR_CANCELLED'}
    $store=Get-Content -LiteralPath $CustodyFile -Raw|ConvertFrom-Json
    if($store.profile -ne 'CAMACHO_FACTUS_PAY_API_CUSTODY_V1' -or @($store.credentials).Count -ne 1){throw 'SINGLE_MANAGED_CREDENTIAL_REQUIRED'}
    $row=$store.credentials[0]
    if($row.protectedCredential.provider -ne 'WINDOWS_DPAPI_CURRENT_USER'){throw 'DPAPI_CUSTODY_REQUIRED'}
    $plain=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($row.protectedCredential.data),[Text.Encoding]::UTF8.GetBytes('CAMACHO_FACTUS_PAY_API_CUSTODY_V1'),[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $inner=[Text.Encoding]::UTF8.GetString($plain)|ConvertFrom-Json
    foreach($field in $binding.PSObject.Properties.Name){if([string]$inner.binding.$field -cne [string]$binding.$field -or [string]$row.binding.$field -cne [string]$binding.$field){throw 'CREDENTIAL_BINDING_REJECTED'}}
    if($null -ne $inner.expiresAt -and [DateTimeOffset]::Parse($inner.expiresAt) -le [DateTimeOffset]::UtcNow){throw 'CUSTODY_EXPIRED'}
    $token=$inner.accessToken
  }else{
    if($existing -and -not $ReplaceExisting){throw 'EXISTING_CUSTODY_PRESERVED'}
    Write-Host ('Environment SANDBOX; registered account: '+$binding.providerAccountReference+'; integration: '+$binding.integrationId)
    if($Mode -eq 'Authenticate'){
      Write-Host 'WARNING: authenticating revokes the previous provider token. No automatic retries.'
      if((Read-Host 'After owner approval, type AUTHENTICATE SANDBOX') -cne 'AUTHENTICATE SANDBOX'){throw 'OPERATOR_CANCELLED'}
      $email=Read-Host 'FACTUS Pay email (hidden)' -AsSecureString
      $password=Read-Host 'FACTUS Pay password (hidden)' -AsSecureString
    }else{
      if((Read-Host 'Import existing token without authenticating: type IMPORT SANDBOX') -cne 'IMPORT SANDBOX'){throw 'OPERATOR_CANCELLED'}
      $secret=Read-Host 'Existing FACTUS Pay token (hidden)' -AsSecureString
      try{$token=Reveal $secret}finally{$secret.Dispose()}
    }
  }
  if($Mode -in @('Authenticate','VerifyReadOnly')){
    $handler=New-Object Net.Http.HttpClientHandler;$handler.AllowAutoRedirect=$false;$handler.UseCookies=$false
    $client=New-Object Net.Http.HttpClient($handler);$client.Timeout=[TimeSpan]::FromSeconds(20)
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    if($Mode -eq 'Authenticate'){
      $payload=@{email=(Reveal $email);password=(Reveal $password)}|ConvertTo-Json -Compress
      $authenticated=Read-Provider $client 'POST' '/auth' '' $payload;$token=$authenticated.token;$authenticated=$null;$payload=$null
    }else{
      if(-not $token -or $token.Length -gt 8192 -or $token -match '[\r\n]'){throw 'TOKEN_REJECTED'}
      $listing=Read-Provider $client 'GET' '/v1/collections' $token ''
      if($listing.status -ne 'success' -or -not ($listing.data -is [Array])){throw 'COLLECTION_LIST_REJECTED'}
      $detailRetrieved=$false
      if($listing.data.Count -gt 0){
        $reference=$listing.data[0].reference_code
        if(-not ($reference -is [string]) -or -not $reference -or $reference.Length -gt 100){throw 'COLLECTION_REFERENCE_REJECTED'}
        $detail=Read-Provider $client 'GET' ('/v1/collections/'+[Uri]::EscapeDataString($reference)) $token ''
        if($detail.status -ne 'success' -or $detail.data.reference_code -cne $reference){throw 'COLLECTION_DETAIL_REJECTED'}
        $detailRetrieved=$true
      }
      # Read-only diagnosis, not a Payment confirmation or fiscal certification.
      [pscustomobject]@{environment='SANDBOX';readOnly=$true;listVerified=$true;firstPageCount=$listing.data.Count;createdCollection=$false;authenticated=$false;detailRetrieved=$detailRetrieved;paymentConfirmed=$false}|ConvertTo-Json -Compress
      exit 0
    }
  }
  if(-not ($token -is [string]) -or -not $token -or $token.Length -gt 8192 -or $token -match '[\r\n]'){throw 'TOKEN_REJECTED'}
  # The provider token is non-expiring; null is not a fabricated provider expiry.
  $plain=[Text.Encoding]::UTF8.GetBytes((@{binding=$binding;accessToken=$token;expiresAt=$null}|ConvertTo-Json -Depth 6 -Compress))
  $cipher=[Security.Cryptography.ProtectedData]::Protect($plain,[Text.Encoding]::UTF8.GetBytes('CAMACHO_FACTUS_PAY_API_CUSTODY_V1'),[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $output=@{profile='CAMACHO_FACTUS_PAY_API_CUSTODY_V1';credentials=@(@{binding=$binding;protectedCredential=@{provider='WINDOWS_DPAPI_CURRENT_USER';data=[Convert]::ToBase64String($cipher)}})}|ConvertTo-Json -Depth 8 -Compress
  $temp=Join-Path $parent ('.custody-'+[Guid]::NewGuid().ToString('N')+'.tmp')
  $stream=[IO.File]::Open($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{Make-PrivateFile $temp;$bytes=[Text.Encoding]::UTF8.GetBytes($output);$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
  if($existing){[IO.File]::Replace($temp,$CustodyFile,$null)}else{[IO.File]::Move($temp,$CustodyFile)};$temp=$null
  Assert-PrivatePath $CustodyFile
  [pscustomobject]@{environment='SANDBOX';provisioned=$true;protection='WINDOWS_DPAPI_CURRENT_USER';passwordStored=$false;providerExpiry=$null;networkCalled=($Mode -eq 'Authenticate')}|ConvertTo-Json -Compress
}catch{
  # Never print provider bodies, exception objects or request content.
  [Console]::Error.WriteLine('FACTUS_PAY_CUSTODY_OPERATION_REJECTED; verify paths, owner, binding and authorized mode.');exit 1
}finally{
  if($client){$client.Dispose()};if($handler){$handler.Dispose()};if($email){$email.Dispose()};if($password){$password.Dispose()}
  if($plain){[Array]::Clear($plain,0,$plain.Length)};$token=$null;$payload=$null
  if($temp -and [IO.File]::Exists($temp)){[IO.File]::Delete($temp)}
}

#requires -Version 5.1
<#
  CAMACHO POS - PostgreSQL 16.14 Windows/Docker PREPRODUCTION role bootstrap.
  Default is read-only. -Provision is an EXPLICIT one-time role creation.
  No migrations, real users, services or authentication shortcuts.
  Credentials are never command arguments, console output or repository files.
#>
[CmdletBinding()]
param([switch]$Provision)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$name='camacho-pos-central-preprod'
$volume='camacho-pos-central-preprod-data'
$db='camacho_pos_preprod'
$port='55435'
$directory=Join-Path $env:LOCALAPPDATA 'CamachoPOS\preprod'
$passfile=Join-Path $directory 'pgpass.conf'
$adminFile=Join-Path $directory 'postgres-password.txt'
$caFile=Join-Path $directory 'pg-server-ca.crt'
$roles=@('pos_schema_owner','pos_migrator','pos_app','pos_worker','pos_platform_app','pos_platform_admin','pos_reporting')
$logins=@('pos_migrator','pos_app','pos_worker','pos_platform_app','pos_platform_admin')

function FailIfDockerError([string]$code) {
  if($LASTEXITCODE -ne 0){throw $code}
}
function Scalar([string]$query) {
  $result=@(& docker exec -u postgres $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d $db -Atc $query)
  FailIfDockerError 'PREPROD_SQL_INSPECTION_FAILED'
  if($result.Count -ne 1){throw 'PREPROD_UNEXPECTED_SQL_RESULT'}
  return [string]$result[0]
}
function CheckPrivateDirectory {
  if(-not (Test-Path -LiteralPath $directory -PathType Container)){throw 'PREPROD_PRIVATE_DIRECTORY_MISSING'}
  $id=[Security.Principal.WindowsIdentity]::GetCurrent()
  $acl=Get-Acl -LiteralPath $directory
  $owner=([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value
  if($owner -ne $id.User.Value -or -not $acl.AreAccessRulesProtected){
    throw 'PREPROD_PRIVATE_DIRECTORY_OWNER_OR_INHERITANCE_UNSAFE'
  }
  $allowed=@($id.User.Value,'S-1-5-18','S-1-5-32-544')
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
       $rule.IdentityReference.Value -notin $allowed){throw 'PREPROD_PRIVATE_DIRECTORY_ACL_TOO_BROAD'}
  }
}
function RandomPassword {
  $bytes=New-Object byte[] 48
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  try{
    $rng.GetBytes($bytes)
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
  }finally{
    [Array]::Clear($bytes,0,$bytes.Length)
    $rng.Dispose()
  }
}
if($env:OS -ne 'Windows_NT'){throw 'PREPROD_BOOTSTRAP_REQUIRES_WINDOWS'}
$raw=@(& docker inspect $name)
FailIfDockerError 'PREPROD_CONTAINER_NOT_FOUND'
$info=($raw -join [Environment]::NewLine | ConvertFrom-Json)[0]
if(-not $info.State.Running -or $info.Config.Image -ne 'postgres:16.14'){throw 'PREPROD_WRONG_CONTAINER'}
$mount=@($info.Mounts | Where-Object {$_.Type -eq 'volume' -and $_.Name -eq $volume -and $_.Destination -eq '/var/lib/postgresql/data'})
$bind=@($info.NetworkSettings.Ports.'5432/tcp')
if($mount.Count -ne 1 -or $bind.Count -ne 1 -or $bind[0].HostIp -ne '127.0.0.1' -or $bind[0].HostPort -ne $port){
  throw 'PREPROD_PORT_OR_VOLUME_MISMATCH'
}
$version=Scalar 'SHOW server_version_num;'
$ssl=Scalar 'SHOW ssl;'
$encryption=Scalar 'SHOW password_encryption;'
$actualDb=Scalar 'SELECT current_database();'
$names=(($roles | ForEach-Object {"'$_'"}) -join ',')
$present=Scalar ("SELECT count(*) FROM pg_roles WHERE rolname IN ("+$names+");")
$ledger=Scalar "SELECT CASE WHEN to_regclass('platform.target_migration_executions') IS NULL THEN 'ABSENT' ELSE 'PRESENT' END;"
$unsafe=Scalar "SELECT count(*) FROM pg_hba_file_rules WHERE type LIKE 'host%' AND (auth_method IS NULL OR auth_method <> 'scram-sha-256');"
if($version -ne '160014' -or $ssl -ne 'on' -or $encryption -ne 'scram-sha-256' -or
   $actualDb -ne $db -or $unsafe -ne '0'){throw 'PREPROD_TLS_OR_SCRAM_OR_VERSION_FAILED'}
Write-Output 'PREPROD_VERSION_TLS_SCRAM: PASS'
Write-Output ('OFFICIAL_ROLES_PRESENT: '+$present+'/7')
Write-Output ('MIGRATION_LEDGER: '+$ledger)
if(-not $Provision){Write-Output 'READ_ONLY: no changes';exit 0}
if($present -ne '0' -or $ledger -ne 'ABSENT'){throw 'PREPROD_BOOTSTRAP_NOT_FRESH'}
CheckPrivateDirectory
if(-not (Test-Path -LiteralPath $adminFile -PathType Leaf)){throw 'PREPROD_ADMIN_PASSWORD_FILE_MISSING'}
if((Test-Path -LiteralPath $passfile) -or (Test-Path -LiteralPath $caFile)){throw 'PREPROD_CREDENTIAL_FILES_EXIST_STOP'}
$adminPassword=[IO.File]::ReadAllText($adminFile).Trim()
if($adminPassword.Length -lt 32){throw 'PREPROD_ADMIN_PASSWORD_INVALID'}
$secret=@{}
$lines=New-Object 'System.Collections.Generic.List[string]'
$lines.Add(('127.0.0.1:{0}:{1}:postgres:{2}' -f $port,$db,$adminPassword))
foreach($role in $logins){
  $secret[$role]=RandomPassword
  $lines.Add(('127.0.0.1:{0}:{1}:{2}:{3}' -f $port,$db,$role,$secret[$role]))
}
# Exclusive creation under the private directory. No secret goes to docker args.
$stream=[IO.FileStream]::new($passfile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{
  $writer=[IO.StreamWriter]::new($stream,[System.Text.UTF8Encoding]::new($false))
  try{foreach($line in $lines){$writer.WriteLine($line)};$writer.Flush();$stream.Flush($true)}
  finally{$writer.Dispose()}
}finally{$stream.Dispose()}
& docker cp ($name+':/var/lib/postgresql/data/server.crt') $caFile | Out-Null
FailIfDockerError 'PREPROD_TLS_PUBLIC_CERT_COPY_FAILED'
CheckPrivateDirectory
$sql=New-Object 'System.Collections.Generic.List[string]'
$sql.Add('BEGIN;')
$sql.Add('CREATE ROLE pos_schema_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT NOBYPASSRLS;')
foreach($role in $logins){
  $bypass=if($role -eq 'pos_platform_admin'){'BYPASSRLS'}else{'NOBYPASSRLS'}
  $sql.Add(("CREATE ROLE {0} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT {1} ENCRYPTED PASSWORD '{2}';" -f $role,$bypass,$secret[$role]))
}
$sql.Add('CREATE ROLE pos_reporting NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT NOBYPASSRLS;')
$sql.Add('GRANT pos_schema_owner TO pos_migrator;')
$sql.Add('GRANT CREATE ON DATABASE camacho_pos_preprod TO pos_schema_owner;')
$sql.Add('COMMIT;')
try{
  ($sql -join [Environment]::NewLine) | & docker exec -i -u postgres $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d $db
  FailIfDockerError 'PREPROD_ROLE_BOOTSTRAP_FAILED_REVIEW_STATE'
}finally{
  $adminPassword=$null
  $secret.Clear()
  $lines.Clear()
  $sql.Clear()
}
$after=Scalar ("SELECT count(*) FROM pg_roles WHERE rolname IN ("+$names+");")
$member=Scalar "SELECT pg_has_role('pos_migrator','pos_schema_owner','MEMBER');"
$privileged=Scalar "SELECT count(*) FROM pg_roles WHERE rolname IN ('pos_migrator','pos_app','pos_worker','pos_platform_app') AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole);"
if($after -ne '7' -or $member -ne 't' -or $privileged -ne '0'){throw 'PREPROD_ROLE_VERIFICATION_FAILED'}
Write-Output 'CANONICAL_POS_ROLES_7_OF_7: PASS'
Write-Output 'MIGRATOR_MEMBERSHIP: PASS'
Write-Output 'RUNTIME_NON_PRIVILEGED: PASS'
Write-Output 'CREDENTIAL_FILE_AND_CA: PROTECTED_OFF_REPOSITORY'
Write-Output 'MIGRATIONS: NOT_STARTED'

#requires -Version 5.1
<#
.SYNOPSIS
  Controlled host preparation for the existing G1/G2 physical Windows SCM lab.
.DESCRIPTION
  Two phases separated by a mandatory operator-controlled reboot:
    PrepareHost : dump/verify the active dedicated PostgreSQL preprod container,
                  stop that ONE container, then enable Hyper-V without reboot.
    CreateVM    : require Hyper-V, >=5 GiB available RAM and a supplied ISO,
                  create but do not boot one isolated Gen-2 VM on drive E.
  Never modifies PostgreSQL data or volumes, installs an SCM service, writes
  installer credentials, exposes a secret, or bypasses the commercial gate.
  Failure to back up means NO Docker stop, NO feature enablement.
  This script does not replace VM guest provisioning nor the physical test.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('PrepareHost','CreateVM')][string]$Phase,
  [switch]$Apply,
  [string]$IsoPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$container='camacho-pos-central-preprod'
$vm='CamachoPOS-SCM-Lab'
$diskRoot='E:\CamachoPosScmLab'
$stoppedByUs=$false

function Require([bool]$condition,[string]$message){
  if(-not $condition){throw $message}
}
function HasAdministratorToken {
  $id=[Security.Principal.WindowsIdentity]::GetCurrent()
  $principal=[Security.Principal.WindowsPrincipal]::new($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function ProtectedDirectory([string]$dir) {
  [void][IO.Directory]::CreateDirectory($dir)
  $me=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $acl.SetOwner($me)
  $acl.SetAccessRuleProtection($true,$false)
  foreach($sid in @($me.Value,'S-1-5-18','S-1-5-32-544')){
    $id=New-Object Security.Principal.SecurityIdentifier($sid)
    $rule=New-Object Security.AccessControl.FileSystemAccessRule(
      $id,[Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow
    )
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $dir -AclObject $acl
  $observed=Get-Acl -LiteralPath $dir
  Require $observed.AreAccessRulesProtected 'BACKUP_ACL_INHERITANCE_NOT_DISABLED'
}
function ReadPreprod {
  $raw=@(& docker.exe inspect $container 2>$null)
  Require ($LASTEXITCODE -eq 0) 'PREPROD_CONTAINER_INSPECT_FAILED'
  $items=ConvertFrom-Json -InputObject ($raw -join [Environment]::NewLine)
  $item=@($items)[0]
  Require ($null -ne $item) 'PREPROD_CONTAINER_NOT_FOUND'
  Require ([string]$item.Name -eq ('/'+$container)) 'PREPROD_CONTAINER_NAME_MISMATCH'
  Require ($item.Config.Image -match '(?i)postgres') 'PREPROD_CONTAINER_IMAGE_UNEXPECTED'
  Require (@($item.Mounts).Count -gt 0) 'PREPROD_PERSISTENT_VOLUME_NOT_VERIFIED'
  Require ([bool]$item.State.Running) 'PREPROD_NOT_RUNNING'
  $user='postgres'
  foreach($entry in @($item.Config.Env)){
    if($entry -cmatch '^POSTGRES_USER=(.+)$'){$user=$Matches[1]}
  }
  Require ($user -cmatch '^[a-zA-Z_][a-zA-Z_0-9]{0,62}$') 'PREPROD_DATABASE_USERNAME_UNSAFE'
  return [pscustomobject]@{
    Name=$container; User=$user; ContainerId=[string]$item.Id
    Image=[string]$item.Config.Image
    MountDestinations=@($item.Mounts | ForEach-Object {$_.Destination})
  }
}
function BackupPreprod($preprod) {
  # The parent must not retain an inherited Users/Everyone delete or write
  # permission that could replace or exfiltrate a backup child.
  ProtectedDirectory $diskRoot
  $dir=Join-Path $diskRoot ('host-backup-'+[Guid]::NewGuid().ToString('N'))
  ProtectedDirectory $dir
  $file=Join-Path $dir 'preprod-pg-dumpall.sql'
  $psi=New-Object Diagnostics.ProcessStartInfo
  $psi.FileName=(Get-Command docker.exe -ErrorAction Stop).Source
  $psi.Arguments='exec '+$container+' pg_dumpall --username '+$preprod.User+' --no-password'
  $psi.RedirectStandardOutput=$true
  $psi.RedirectStandardError=$true
  $psi.CreateNoWindow=$true
  $psi.UseShellExecute=$false
  $proc=New-Object Diagnostics.Process
  $proc.StartInfo=$psi
  $fs=$null
  try{
    Require ($proc.Start()) 'BACKUP_PROCESS_START_FAILED'
    $stderrTask=$proc.StandardError.ReadToEndAsync()
    $fs=[IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $proc.StandardOutput.BaseStream.CopyTo($fs)
    $fs.Flush($true)
    $fs.Dispose();$fs=$null
    Require ($proc.WaitForExit(120000)) 'PREPROD_BACKUP_TIMEOUT'
    Require ($proc.ExitCode -eq 0) 'PREPROD_BACKUP_FAILED_KEEP_CONTAINER_RUNNING'
    $detail=Get-Item -LiteralPath $file
    Require ($detail.Length -ge 512) 'PREPROD_BACKUP_EMPTY'
    $stream=[IO.File]::OpenRead($file)
    try{
      $reader=New-Object IO.StreamReader($stream)
      $intro=$reader.ReadLine()+$reader.ReadLine()+$reader.ReadLine()
      Require ($intro.Contains('PostgreSQL database cluster dump')) 'PREPROD_BACKUP_FORMAT_UNRECOGNIZED'
    }finally{$stream.Dispose()}
    $digest=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    $metadata=[ordered]@{
      format='camacho-pos-preprod-logical-backup/v1'
      container_name=$preprod.Name
      container_id=$preprod.ContainerId
      image=$preprod.Image
      mounts=$preprod.MountDestinations
      timestamp_utc=[DateTime]::UtcNow.ToString('o')
      size_bytes=$detail.Length
      sha256=$digest
      restore_tested=$false
    }
    [IO.File]::WriteAllText((Join-Path $dir 'receipt.json'),
      (ConvertTo-Json -InputObject $metadata -Depth 6),
      (New-Object Text.UTF8Encoding($false)))
    Write-Host ('PREPROD_LOGICAL_BACKUP=PASS')
    Write-Host ('PREPROD_BACKUP_RECEIPT='+ (Join-Path $dir 'receipt.json'))
    return $file
  }finally{
    if($null -ne $fs){$fs.Dispose()}
    if(-not $proc.HasExited){try{$proc.Kill()}catch{}}
    $proc.Dispose()
  }
}
function AssertHost {
  Require ($env:OS -eq 'Windows_NT') 'WINDOWS_REQUIRED'
  Require (HasAdministratorToken) 'ELEVATED_POWERSHELL_REQUIRED'
  $machine=Get-CimInstance Win32_ComputerSystem
  Require ($machine.Manufacturer -match '(?i)TOSHIBA' -and $machine.Model -like '*Satellite P55-B*') 'HOST_IDENTITY_UNEXPECTED'
  $drive=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='E:'"
  Require ($null -ne $drive -and $drive.FreeSpace -gt 120GB) 'E_DISK_FREE_120GB_REQUIRED'
  $feature=Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All
  Require ($feature.State -in @('Enabled','Disabled','EnablePending')) 'HYPERV_STATE_UNEXPECTED'
  Write-Host ('HYPERV_CURRENT_STATE='+$feature.State)
  Write-Host ('E_FREE_GB='+[math]::Round($drive.FreeSpace/1GB,1))
  return $feature.State
}

try {
  $state=AssertHost
  Require ([bool]$Apply) 'DRY_RUN_ONLY_PASS_APPLY_TO_EXECUTE'
  if($Phase -eq 'PrepareHost'){
    Require ($state -ne 'EnablePending') 'HYPERV_PENDING_REBOOT'
    if($state -eq 'Enabled'){
      Write-Host 'HYPERV_ALREADY_ENABLED=YES'
      Write-Host 'HOST_PREPARATION=NO_CHANGES'
      exit 0
    }
    $preprod=ReadPreprod
    Write-Host ('PREPROD_CONTAINER='+$preprod.Name)
    $backup=BackupPreprod $preprod
    Require ((Test-Path -LiteralPath $backup -PathType Leaf)) 'BACKUP_DISAPPEARED'
    # A verified pg_dumpall exit + nonempty format/header + checksum is
    # NOT a restore test. Never delete or replace the existing Docker volume.
    try{
      & docker.exe stop '--time' '90' $container | Out-Null
      Require ($LASTEXITCODE -eq 0) 'PREPROD_STOP_FAILED'
      $stoppedByUs=$true
      $inspect=@(& docker.exe inspect $container)
      $item=@((ConvertFrom-Json -InputObject ($inspect -join [Environment]::NewLine)))[0]
      Require (-not [bool]$item.State.Running) 'PREPROD_STILL_RUNNING'
      Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All -NoRestart -ErrorAction Stop | Out-Null
      Write-Host 'HYPERV_FEATURE_SETUP=COMPLETE_RESTART_REQUIRED'
      Write-Host 'PREPROD_DOCKER_CONTAINER=STOPPED_AFTER_BACKUP'
      Write-Host 'ACTION_REQUIRED=SAVE_WORK_THEN_REBOOT_WINDOWS_MANUALLY'
    }catch{
      if($stoppedByUs){
        try{& docker.exe start $container | Out-Null}catch{}
      }
      throw
    }
  }else{
    Require ($state -eq 'Enabled') 'HYPERV_NOT_READY_REBOOT_OR_INSTALL_REQUIRED'
    Require (Get-Command New-VM -ErrorAction SilentlyContinue) 'HYPERV_MANAGEMENT_TOOLS_REQUIRED'
    $memory=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory * 1KB
    Require ($memory -ge 5GB) 'AVAILABLE_RAM_5GB_REQUIRED_CLOSE_APPS_BEFORE_VM_CREATION'
    Require (-not [string]::IsNullOrWhiteSpace($IsoPath)) 'WINDOWS_ISO_REQUIRED'
    $iso=[IO.Path]::GetFullPath($IsoPath)
    Require ($iso -match '(?i)^[a-z]:\\' -and $iso.EndsWith('.iso',[StringComparison]::OrdinalIgnoreCase)) 'WINDOWS_ISO_LOCAL_FILE_REQUIRED'
    $isoFile=Get-Item -LiteralPath $iso -ErrorAction Stop
    Require (-not $isoFile.PSIsContainer -and $isoFile.Length -ge 2GB) 'WINDOWS_ISO_INVALID_OR_TOO_SMALL'
    Require (Test-Path -LiteralPath $diskRoot -PathType Container) 'LAB_BACKUP_PREPARATION_REQUIRED'
    $rootAcl=Get-Acl -LiteralPath $diskRoot
    Require ($rootAcl.AreAccessRulesProtected) 'LAB_ROOT_ACL_INHERITANCE_REJECTED'
    Require ($null -eq (Get-VM -Name $vm -ErrorAction SilentlyContinue)) 'LAB_VM_ALREADY_EXISTS_NO_OVERWRITE'
    $vmsRoot=Join-Path $diskRoot 'VMs'
    ProtectedDirectory $vmsRoot
    $vmDir=Join-Path $vmsRoot ([Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($vmDir)
    $vhd=Join-Path $vmDir 'CamachoPOS-SCM-Lab.vhdx'
    New-VM -Name $vm -Generation 2 -Path $vmDir -MemoryStartupBytes 4GB -NewVHDPath $vhd -NewVHDSizeBytes 70GB -ErrorAction Stop | Out-Null
    Set-VMProcessor -VMName $vm -Count 2 -ErrorAction Stop
    Set-VM -Name $vm -AutomaticStartAction Nothing -AutomaticStopAction ShutDown -ErrorAction Stop
    Add-VMDvdDrive -VMName $vm -Path $iso -ErrorAction Stop
    $dvd=Get-VMDvdDrive -VMName $vm
    Set-VMFirmware -VMName $vm -FirstBootDevice $dvd -ErrorAction Stop
    # No auto-start, no Windows account, no service installation.
    Write-Host ('LAB_VM_CREATED='+$vm)
    Write-Host ('LAB_VM_FILES='+$vmDir)
    Write-Host ('LAB_VHDX='+$vhd)
    Write-Host 'LAB_VM_STARTED=NO'
    Write-Host 'SCM_PHYSICAL_INTEROP=NOT_VERIFIED'
  }
}catch{
  Write-Error ('SCM_VM_HOST_REJECTED: '+$_.Exception.Message)
  exit 1
}

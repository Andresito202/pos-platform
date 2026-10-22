#requires -Version 5.1
param([Parameter(Mandatory=$true)][string]$AdbPath,[Parameter(Mandatory=$true)][string]$Serial,[Parameter(Mandatory=$true)][string]$EvidenceDirectory,[switch]$ExistingCustodyOnly)
$ErrorActionPreference='Stop'
[void](New-Item -ItemType Directory -Force -Path $EvidenceDirectory)
$package='co.camachopos.android.runtimeprobe'
function Adb([string[]]$Arguments) { $result=& $AdbPath -s $Serial @Arguments; if($LASTEXITCODE -ne 0){throw 'ADB_SERVICE_TEST_FAILED'};return $result }
if(((Adb @('get-state')) -join '').Trim() -ne 'device'){throw 'AUTHORIZED_DEVICE_REQUIRED'}
function Screen {
  Adb @('shell','uiautomator','dump','/sdcard/camacho-service-view.xml') | Out-Null
  $file=Join-Path $EvidenceDirectory 'view.xml';Adb @('pull','/sdcard/camacho-service-view.xml',$file) | Out-Null
  return [xml](Get-Content -LiteralPath $file -Raw -Encoding UTF8)
}
function Button([string]$Label) {
  $view=Screen
  $nodes=@($view.SelectNodes('//node[@class="android.widget.Button" and @package="co.camachopos.android.runtimeprobe"]') | Where-Object {$_.text -eq $Label})
  if($nodes.Count -ne 1 -or $nodes[0].bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$'){throw 'OWN_SERVICE_CONTROL_NOT_IDENTIFIED'}
  $x=[int](([int]$Matches[1]+[int]$Matches[3])/2);$y=[int](([int]$Matches[2]+[int]$Matches[4])/2)
  Adb @('shell','input','tap',"$x","$y") | Out-Null
}
function Wait-State([string]$Expected,[string]$Name) {
  $deadline=[DateTime]::UtcNow.AddSeconds(120)
  do {
    Button 'ESTADO DEL SERVICIO LOCAL'
    $screen=Screen
    $text=(@($screen.SelectNodes('//node[@class="android.widget.TextView" and @package="co.camachopos.android.runtimeprobe"]')) | ForEach-Object {$_.text}) -join "`n"
    if($text.StartsWith('{')) {
      $status=$text | ConvertFrom-Json
      if($status.state -eq 'FAILED'){throw 'REAL_ANDROID_SERVICE_FAILED'}
      if($status.state -eq $Expected) {
        if($status.commercial_access -ne 'BLOCKED_PENDING_TRUSTED_PROVISIONING' -or $status.external_channel -ne 'CLOSED' -or $status.local_security -ne 'NOT_PROVISIONED' -or $status.components.Count -ne 1 -or $status.components[0] -ne 'local-database' -or $status.process_id -lt 1 -or $status.key_protection -ne 'OS_BOUND'){throw 'SERVICE_AUTHORIZATION_BOUNDARY_FAILED'}
        $status | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $EvidenceDirectory "$Name.json")
        return $status
      }
    }
  } while([DateTime]::UtcNow -lt $deadline)
  throw 'ANDROID_SERVICE_STATE_TIMEOUT'
}
Adb @('shell','am','start','-W','-n',"$package/co.camachopos.android.RuntimeProbeActivity") | Out-Null
Button 'INICIAR SERVICIO LOCAL SIN APROVISIONAR'
$first=Wait-State 'READY' 'started'
if($ExistingCustodyOnly) {
  if(-not $first.sealed_store_restored){throw 'EXISTING_CUSTODY_WAS_NOT_PRESERVED'}
  Button 'DETENER SERVICIO LOCAL';$null=Wait-State 'STOPPED' 'final-stopped'
  Write-Output 'ANDROID_CUSTODY_UPDATE_PASS: previously sealed canonical store reopened after in-place package installation; service stopped without commercial access.'
  exit 0
}
Adb @('shell','input','keyevent','KEYCODE_HOME') | Out-Null
Start-Sleep -Seconds 3
Adb @('shell','am','start','-W','-n',"$package/co.camachopos.android.RuntimeProbeActivity") | Out-Null
$background=Wait-State 'READY' 'after-background'
if($first.process_id -ne $background.process_id){throw 'SERVICE_DID_NOT_SURVIVE_ACTIVITY_BACKGROUND'}
Button 'DETENER SERVICIO LOCAL';$null=Wait-State 'STOPPED' 'stopped'
Button 'INICIAR SERVICIO LOCAL SIN APROVISIONAR';$restarted=Wait-State 'READY' 'restarted'
if($first.process_id -eq $restarted.process_id){throw 'NEW_NODE_PROCESS_NOT_OBSERVED'}
if(-not $restarted.sealed_store_restored){throw 'ENCRYPTED_STORE_NOT_RESTORED'}
Button 'DETENER SERVICIO LOCAL';$null=Wait-State 'STOPPED' 'final-stopped'
# Restart only our host process after graceful service stop, to re-open Android Keystore custody.
Adb @('shell','am','force-stop',$package) | Out-Null
Adb @('shell','am','start','-W','-n',"$package/co.camachopos.android.RuntimeProbeActivity") | Out-Null
Button 'INICIAR SERVICIO LOCAL SIN APROVISIONAR';$hostRestarted=Wait-State 'READY' 'host-process-restarted'
if(-not $hostRestarted.sealed_store_restored -or $hostRestarted.process_id -eq $restarted.process_id){throw 'KEYSTORE_HOST_RESTART_FAILED'}
Button 'DETENER SERVICIO LOCAL';$null=Wait-State 'STOPPED' 'custody-final-stopped'
Adb @('shell','screencap','-p','/sdcard/camacho-service-final.png') | Out-Null
Adb @('pull','/sdcard/camacho-service-final.png',(Join-Path $EvidenceDirectory 'final.png')) | Out-Null
Write-Output 'ANDROID_SERVICE_PASS: canonical lifecycle, background continuity, graceful shutdown, new Node and host processes, canonical encrypted-store restoration through Android Keystore. No commercial authority or external channel.'

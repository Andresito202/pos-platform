#requires -Version 5.1
param([Parameter(Mandatory=$true)][string]$AdbPath,[Parameter(Mandatory=$true)][string]$Serial,[Parameter(Mandatory=$true)][string]$EvidenceDirectory)
$ErrorActionPreference='Stop'
$package='co.camachopos.android.runtimeprobe'
$activity='co.camachopos.android.RuntimeProbeActivity'
[void](New-Item -ItemType Directory -Force -Path $EvidenceDirectory)
function Adb([string[]]$Arguments){
    $output=& $AdbPath -s $Serial @Arguments
    if($LASTEXITCODE -ne 0){throw "ADB_PROBE_COMMAND_FAILED: $($Arguments[0])"}
    return $output
}
if(((Adb @('get-state')) -join '').Trim() -ne 'device'){throw 'EXPLICIT_AUTHORIZED_DEVICE_REQUIRED'}
function Read-Screen([string]$Name){
    $remote="/sdcard/camacho-runtime-$Name.xml"
    Adb @('shell','uiautomator','dump',$remote) | Out-Null
    $local=Join-Path $EvidenceDirectory "$Name.xml"
    Adb @('pull',$remote,$local) | Out-Null
    return [xml](Get-Content -LiteralPath $local -Raw -Encoding UTF8)
}
function Run-Probe([string]$Name){
    Adb @('shell','am','start','-W','-n',"$package/$activity") | Out-Null
    $screen=Read-Screen "$Name-initial"
    $buttons=@($screen.SelectNodes('//node[@class="android.widget.Button" and @package="co.camachopos.android.runtimeprobe"]'))
    if($buttons.Count -ne 1 -or $buttons[0].text -notlike 'EJECUTAR MOTOR*' -or $buttons[0].bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$'){throw 'OWN_PROBE_ACTION_NOT_IDENTIFIED'}
    $x=[int](([int]$Matches[1]+[int]$Matches[3])/2);$y=[int](([int]$Matches[2]+[int]$Matches[4])/2)
    Adb @('shell','input','tap',"$x","$y") | Out-Null
    $deadline=[DateTime]::UtcNow.AddSeconds(120)
    do {
        $view=Read-Screen "$Name-result"
        $text=(@($view.SelectNodes('//node[@class="android.widget.TextView" and @package="co.camachopos.android.runtimeprobe"]')) | ForEach-Object {$_.text}) -join "`n"
        if($text.StartsWith('FAILED:')){throw $text}
        if($text.StartsWith('PASS:')){break}
    } while([DateTime]::UtcNow -lt $deadline)
    if(-not $text.StartsWith('PASS:')){throw 'RUNTIME_PROBE_TIMEOUT'}
    $first=$text.IndexOf('{');$last=$text.LastIndexOf('}')
    $result=$text.Substring($first,$last-$first+1) | ConvertFrom-Json
    if(-not $result.passed -or $result.platform -ne 'android' -or $result.arch -ne 'arm64' -or $result.node -ne 'v24.18.0' -or [int]$result.napi -lt 10 -or $result.integrity -ne 'ok' -or $result.sqliteJournal -ne 'wal' -or $result.migrations.Count -ne 18 -or -not $result.secondWriterRejected -or -not $result.writeReadRollbackReopen -or $result.businessSession -or $result.commercialSale -or $result.hardwareCommand){throw 'REAL_ENGINE_ASSERTION_FAILED'}
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory "$Name.json") -Encoding UTF8
    return $result
}
$one=Run-Probe 'first'
# Stop only this newly created diagnostic package, never the SQLite baseline probe or any POS service.
Adb @('shell','am','force-stop',$package) | Out-Null
$two=Run-Probe 'after-process-restart'
if(-not $two.previousSuccessfulProcess -or $one.migrationFingerprint -ne $two.migrationFingerprint -or -not $one.persistedValue -or $one.persistedValue -ne $two.persistedValue){throw 'DURABLE_ENGINE_STATE_NOT_PRESERVED'}
$remote='/sdcard/camacho-runtime-engine-pass.png'
Adb @('shell','screencap','-p',$remote) | Out-Null
Adb @('pull',$remote,(Join-Path $EvidenceDirectory 'engine-pass.png')) | Out-Null
Write-Output "DEVICE_ENGINE_PASS: Node $($two.node), N-API $($two.napi), migrations 1-18, WAL, rollback, writer exclusion, close/reopen and app-process restart. NO LOGIN / SALE / HARDWARE."

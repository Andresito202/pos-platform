#requires -Version 5.1
param(
    [Parameter(Mandatory=$true)][string]$AdbPath,
    [string]$Serial,
    [switch]$InstallApk,
    [string]$ApkPath,
    [string]$ExpectedApkSha256,
    [string]$ExpectedModel,
    [string]$ExpectedBuild
)
$ErrorActionPreference='Stop'
if(-not (Test-Path -LiteralPath $AdbPath -PathType Leaf)){throw 'OFFICIAL_ADB_EXECUTABLE_REQUIRED'}
& $AdbPath devices -l
if($LASTEXITCODE -ne 0){throw 'ADB_LIST_FAILED'}
if(-not $Serial){
    if($InstallApk){throw 'EXPLICIT_DEVICE_SERIAL_REQUIRED'}
    return
}
$state=((& $AdbPath -s $Serial get-state) -join '').Trim()
if($LASTEXITCODE -ne 0 -or $state -ne 'device'){throw 'ADB_DEVICE_NOT_AUTHORIZED'}
function Read-Property([string]$Name){
    $value=((& $AdbPath -s $Serial shell getprop $Name) -join '').Trim()
    if($LASTEXITCODE -ne 0){throw 'DEVICE_PROPERTY_READ_FAILED'}
    return $value
}
$identity=[ordered]@{
    model=Read-Property 'ro.product.model'
    manufacturer=Read-Property 'ro.product.manufacturer'
    android=Read-Property 'ro.build.version.release'
    sdk=Read-Property 'ro.build.version.sdk'
    build=Read-Property 'ro.build.display.id'
    abis=Read-Property 'ro.product.cpu.abilist'
}
$identity | ConvertTo-Json
if(-not $InstallApk){return}
if(-not $ExpectedModel -or -not $ExpectedBuild){throw 'PHYSICALLY_CHECKED_MODEL_AND_BUILD_REQUIRED'}
if($identity.model -ne $ExpectedModel -or $identity.build -ne $ExpectedBuild -or [int]$identity.sdk -lt 28){throw 'ANDROID_DEVICE_IDENTITY_MISMATCH'}
if(-not $ApkPath -or -not $ExpectedApkSha256 -or (Get-FileHash -LiteralPath $ApkPath -Algorithm SHA256).Hash -ne $ExpectedApkSha256){throw 'APK_DIGEST_MISMATCH'}
$present=((& $AdbPath -s $Serial shell pm path co.camachopos.hardware.lab) -join '').Trim()
if($present){throw 'LAB_APP_ALREADY_INSTALLED: preserve its ledger; review update separately, never uninstall to bypass replay'}
& $AdbPath -s $Serial install --no-streaming $ApkPath
if($LASTEXITCODE -ne 0){throw 'APK_INSTALL_FAILED'}
Write-Output 'APK_INSTALLED_ONLY: no USB permissions granted and no print/pulse issued. Open Camacho Hardware LAB on the terminal.'

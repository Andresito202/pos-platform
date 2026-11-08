#requires -Version 5.1
param([string]$KitDirectory = 'artifacts/android-hardware/mi-kit')
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$kit=[IO.Path]::GetFullPath((Join-Path $root $KitDirectory))
$project=$PSScriptRoot
$signer=Join-Path $root 'apps\pos-local-service\native\android-hardware\host\tools'
$key=Join-Path $kit 'apk-signing\lab-apk.p12'
$envfile=Join-Path $kit 'private\apk.env'
foreach($f in @($key,$envfile,(Join-Path $signer 'SignApk.java'))) {
  if(-not (Test-Path -LiteralPath $f -PathType Leaf)){throw "MISSING_REQUIRED_INPUT: $f"}
}
& docker run --rm --env GRADLE_USER_HOME=/work/build/gradle-home --env-file $envfile --mount "type=bind,source=$project,target=/work" --mount "type=bind,source=$signer,target=/signer,readonly" --mount "type=bind,source=$(Split-Path $key -Parent),target=/keys,readonly" --workdir /work gradle:8.14-jdk17 gradle --no-daemon --max-workers=2 probeApk '-PsignerSource=/signer/SignApk.java' '-PprobeSigning=/keys/lab-apk.p12'
if($LASTEXITCODE -ne 0){throw "SQLITE_PROBE_BUILD_FAILED"}
$apk=Join-Path $project 'build\probe-apk\camacho-sqlite-probe.apk'
if(-not (Test-Path $apk)){throw 'SQLITE_PROBE_APK_NOT_FOUND'}
Get-FileHash $apk -Algorithm SHA256

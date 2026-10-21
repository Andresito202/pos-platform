#requires -Version 5.1
param([Parameter(Mandatory=$true)][string]$KitDirectory)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$kit=if([IO.Path]::IsPathRooted($KitDirectory)){$KitDirectory}else{Join-Path $root $KitDirectory}
$signer=Join-Path $root 'apps\pos-local-service\native\android-hardware\host\tools'
$key=Join-Path $kit 'apk-signing\lab-apk.p12'
$envfile=Join-Path $kit 'private\apk.env'
foreach($f in @($key,$envfile,(Join-Path $signer 'SignApk.java'),(Join-Path $PSScriptRoot 'build\runtime-assets\runtime\files.json'))){
    if(-not (Test-Path -LiteralPath $f -PathType Leaf)){throw "RUNTIME_PROBE_INPUT_MISSING: $f"}
}
& docker run --rm --env GRADLE_USER_HOME=/work/build/gradle-home --env-file $envfile --mount "type=bind,source=$PSScriptRoot,target=/work" --mount "type=bind,source=$signer,target=/signer,readonly" --mount "type=bind,source=$(Split-Path $key -Parent),target=/keys,readonly" --workdir /work gradle:8.14-jdk17 gradle --no-daemon --max-workers=2 runtimeProbeApk '-PsignerSource=/signer/SignApk.java' '-PprobeSigning=/keys/lab-apk.p12' '-PruntimeAssets=/work/build/runtime-assets'
if($LASTEXITCODE -ne 0){throw 'RUNTIME_PROBE_APK_BUILD_FAILED'}
Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'build\runtime-apk\camacho-node-runtime-probe.apk') -Algorithm SHA256

#requires -Version 5.1
param([Parameter(Mandatory=$true)][string]$KitDirectory,[string]$InstalledRuntimeDirectory)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$kit=if([IO.Path]::IsPathRooted($KitDirectory)){$KitDirectory}else{Join-Path $root $KitDirectory}
$signer=Join-Path $root 'apps\pos-local-service\native\android-hardware\host\tools'
$key=Join-Path $kit 'apk-signing\lab-apk.p12'
$envfile=Join-Path $kit 'private\apk.env'
$assets='/work/build/runtime-assets'
$variant=@()
$output=Join-Path $PSScriptRoot 'build\runtime-apk\camacho-node-runtime-probe.apk'
$assetManifest=Join-Path $PSScriptRoot 'build\runtime-assets\runtime\files.json'
if($InstalledRuntimeDirectory){
    $candidate=(Resolve-Path -LiteralPath $InstalledRuntimeDirectory).Path
    $allowed=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'build'))+[IO.Path]::DirectorySeparatorChar
    if(-not $candidate.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'INSTALLED_CANDIDATE_MUST_BE_IN_ANDROID_BUILD_DIRECTORY'}
    $relative=$candidate.Substring($allowed.Length).Replace('\','/')
    if($relative -notmatch '^[A-Za-z0-9_/-]+$'){throw 'INSTALLED_CANDIDATE_PATH_REJECTED'}
    if(-not (Test-Path -LiteralPath (Join-Path $candidate 'preparation.json') -PathType Leaf)){throw 'INSTALLED_PREPARATION_REQUIRED'}
    $assets="/work/build/$relative/assets";$variant=@("-PinstalledRuntime=/work/build/$relative")
    $assetManifest=Join-Path $candidate 'assets\runtime\files.json'
    $output=Join-Path $PSScriptRoot 'build\installed-runtime-apk\camacho-installed-runtime-candidate.apk'
}
foreach($f in @($key,$envfile,(Join-Path $signer 'SignApk.java'),$assetManifest)){
    if(-not (Test-Path -LiteralPath $f -PathType Leaf)){throw "RUNTIME_PROBE_INPUT_MISSING: $f"}
}
# Gradle immutable-cache renames are not reliable on a Windows bind mount.
# Seed the container-local cache, retaining the pinned/offline dependencies;
# do not delete or move the user's existing cache or signing material.
$gradle="if [ -d /work/build/gradle-home ]; then cp -a /work/build/gradle-home /tmp/camacho-auth-gradle; fi; gradle --offline --no-daemon --max-workers=2 --project-cache-dir /tmp/camacho-auth-project-cache runtimeProbeApk -PsignerSource=/signer/SignApk.java -PprobeSigning=/keys/lab-apk.p12 -PruntimeAssets=$assets $($variant -join ' ')"
& docker run --rm --env GRADLE_USER_HOME=/tmp/camacho-auth-gradle --env-file $envfile --mount "type=bind,source=$PSScriptRoot,target=/work" --mount "type=bind,source=$signer,target=/signer,readonly" --mount "type=bind,source=$(Split-Path $key -Parent),target=/keys,readonly" --workdir /work gradle:8.14-jdk17 sh -lc $gradle
if($LASTEXITCODE -ne 0){throw 'RUNTIME_PROBE_APK_BUILD_FAILED'}
Get-FileHash -LiteralPath $output -Algorithm SHA256

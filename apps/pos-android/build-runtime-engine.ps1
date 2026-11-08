#requires -Version 5.1
param([Parameter(Mandatory=$true)][string]$NdkZip,[Parameter(Mandatory=$true)][string]$KitDirectory)
$ErrorActionPreference='Stop'
$ndk=(Resolve-Path -LiteralPath $NdkZip).Path
if((Get-FileHash -LiteralPath $ndk -Algorithm SHA256).Hash -ne '601246087A682D1944E1E16DD85BC6E49560FE8B6D61255BE2829178C8ED15D9') { throw 'ANDROID_NDK_R27D_DIGEST_MISMATCH' }
function Checked-Docker([string[]]$Arguments) { & docker @Arguments; if($LASTEXITCODE -ne 0){throw 'ANDROID_ENGINE_BUILD_STEP_FAILED'} }
& node (Join-Path $PSScriptRoot 'prepare-runtime.mjs')
if($LASTEXITCODE -ne 0){throw 'RUNTIME_INPUT_PREPARATION_FAILED'}
$mount="type=bind,source=$PSScriptRoot,target=/work"
Checked-Docker @('run','--rm','--mount',$mount,'gradle:8.14-jdk17','python3','/work/verify-runtime-inputs.py','/work/build/runtime-inputs')
Checked-Docker @('run','--rm','--mount',$mount,'gradle:8.14-jdk17','python3','/work/extract-runtime.py','/work/build/runtime-inputs','/work/build/runtime-root')
# Only extracts the explicitly pinned public toolchain into its dedicated Docker volume.
Checked-Docker @('run','--rm','--mount','type=volume,source=camacho-android-ndk-r27d,target=/ndk','--mount',"type=bind,source=$ndk,target=/input/ndk.zip,readonly",'gradle:8.14-jdk17','unzip','-q','-n','/input/ndk.zip','-d','/ndk')
Checked-Docker @('run','--rm','--mount',$mount,'--mount','type=volume,source=camacho-android-ndk-r27d,target=/ndk,readonly','gradle:8.14-jdk17','python3','/work/compile-runtime-addon.py','/work','/ndk/android-ndk-r27d')
& node (Join-Path $PSScriptRoot 'package-runtime-assets.mjs')
if($LASTEXITCODE -ne 0){throw 'RUNTIME_ASSET_PACKAGING_FAILED'}
& (Join-Path $PSScriptRoot 'build-runtime-probe.ps1') -KitDirectory $KitDirectory
Checked-Docker @('run','--rm','--mount',$mount,'gradle:8.14-jdk17','python3','/work/verify-runtime-apk.py','/work/build/runtime-apk/camacho-node-runtime-probe.apk','/work/build/runtime-assets')
# Does not install an APK, operate hardware or modify any POS database.

#requires -Version 5.1
param([Parameter(Mandatory=$true)][string]$KitDirectory)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$native=Join-Path $root 'apps\pos-local-service\native\android-hardware'
$kit=[IO.Path]::GetFullPath($KitDirectory)
foreach($file in @('assets\lab-policy.json','private\apk.env','private\authority.pem')){
    if(-not (Test-Path -LiteralPath (Join-Path $kit $file) -PathType Leaf)){throw "LAB_KIT_MISSING: $file"}
}
# Do not expose authority private key to the build container; only APK signing material.
$signing=Join-Path $kit 'apk-signing'
[void](New-Item -ItemType Directory -Path $signing -Force)
$account=[Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $signing /inheritance:r /grant:r "${account}:(OI)(CI)F" | Out-Null
if($LASTEXITCODE -ne 0){throw 'LAB_SIGNING_ACL_FAILED'}
$key=Join-Path $signing 'lab-apk.p12'
if(-not (Test-Path -LiteralPath $key)){
    & docker run --rm --env-file (Join-Path $kit 'private\apk.env') --mount "type=bind,source=$signing,target=/sign" gradle:8.14-jdk17 keytool -genkeypair -noprompt -alias hardware-lab -keyalg RSA -keysize 3072 -validity 30 -dname 'CN=Camacho Hardware Isolated Laboratory' -storetype PKCS12 -keystore /sign/lab-apk.p12 -storepass:env CAMACHO_LAB_APK_PASSWORD
    if($LASTEXITCODE -ne 0){throw 'LAB_APK_KEY_GENERATION_FAILED'}
}
& docker run --rm --env GRADLE_USER_HOME=/work/build/gradle-home --env-file (Join-Path $kit 'private\apk.env') --mount "type=bind,source=$native,target=/work" --mount "type=bind,source=$kit\assets,target=/lab-assets,readonly" --mount "type=bind,source=$signing,target=/sign,readonly" --workdir /work gradle:8.14-jdk17 gradle --no-daemon --max-workers=2 test labApk '-PlabAssets=/lab-assets' '-PlabSigning=/sign/lab-apk.p12'
if($LASTEXITCODE -ne 0){throw 'LAB_APK_BUILD_FAILED'}
Get-FileHash -LiteralPath (Join-Path $native 'build\lab-apk\camacho-hardware-lab.apk') -Algorithm SHA256

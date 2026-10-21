param([switch]$Laboratory,[switch]$SkipBuild,[switch]$VerifyAndClose)
$ErrorActionPreference='Stop'
if(-not $Laboratory){throw 'LABORATORY_FLAG_REQUIRED: prueba aislada, sin login comercial'}
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Push-Location $root
try {
    if(-not $SkipBuild){
        & pnpm --filter '@pos-platform/pos-desktop' build
        if($LASTEXITCODE -ne 0){throw 'DESKTOP_BUILD_FAILED'}
    }
    $tsx=& node -p "require.resolve('tsx/cli',{paths:['./apps/pos-local-service']})"
    $arguments=@($tsx,'tools/local/launch-hardware-lab.mts','--laboratory')
    if($VerifyAndClose){$arguments+='--verify-and-close'}
    Write-Host 'LABORATORIO AISLADO: identidades y SSA de prueba, SQLite temporal. No login comercial.'
    & node @arguments
    if($LASTEXITCODE -ne 0){throw 'HARDWARE_LAB_FAILED'}
}finally{Pop-Location}

#requires -Version 5.1
[CmdletBinding()]
param([string]$AdbPath)
$ErrorActionPreference='Stop'
$printers=@(Get-Printer | Select-Object Name,DriverName,PrinterStatus)
$matches=@(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object {$_.FriendlyName -match 'Android|ADB|M60|Gprinter|USB Printing'} | Select-Object FriendlyName,Class,Status)
$adbStatus='ADB_UNAVAILABLE'
$android=@()
if(-not $AdbPath){$found=Get-Command adb -ErrorAction SilentlyContinue;if($found){$AdbPath=$found.Source}}
if($AdbPath){
  if(-not (Test-Path -LiteralPath $AdbPath -PathType Leaf)){throw 'ADB_EXECUTABLE_NOT_FOUND'}
  # Does not enable debugging, authorize a device, connect over LAN or install APKs.
  $lines=@(& $AdbPath devices -l)
  if($LASTEXITCODE -ne 0){throw 'ADB_INVENTORY_FAILED'}
  $adbStatus='ADB_PRESENT'
  foreach($line in $lines){
    if($line -match '^([^\s]+)\s+(device|unauthorized|offline)\b'){
      $state=$Matches[2];$serial=$Matches[1]
      $item=[ordered]@{state=$state;model=$null;android=$null;abi=$null}
      if($state -eq 'device'){
        $item.model=((& $AdbPath -s $serial shell getprop ro.product.model) -join '').Trim()
        $item.android=((& $AdbPath -s $serial shell getprop ro.build.version.release) -join '').Trim()
        $item.abi=((& $AdbPath -s $serial shell getprop ro.product.cpu.abi) -join '').Trim()
      }
      $android+=[pscustomobject]$item
    }
  }
}
[pscustomobject]@{schema_version='1.0.0';spooler=(Get-Service Spooler).Status.ToString();queues=$printers;usbCandidates=$matches;adb=$adbStatus;android=$android;physicalPulseSent=$false;printSent=$false} | ConvertTo-Json -Depth 5

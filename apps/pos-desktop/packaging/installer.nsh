; Camacho POS — NSIS hooks for WinSW / SCM Local Service.
; Requires elevation (perMachine). Does not delete commercial AppData.
; commercialLogin / cross-session IPC gate remains NOT_PROVEN.

!macro customInstall
  DetailPrint "Camacho: registering POS Local Service (WinSW/SCM)"
  nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\service-payload\install-camacho-local-service.ps1" -Action Install -PayloadDir "$INSTDIR\resources\service-payload" -Json'
  Pop $0
  DetailPrint "Camacho service install exit=$0"
  ; Non-zero is recorded but does not abort silent lab installs; lifecycle report asserts SCM.
!macroend

!macro customUnInstall
  DetailPrint "Camacho: removing POS Local Service (WinSW/SCM); preserving AppData"
  nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\service-payload\install-camacho-local-service.ps1" -Action Uninstall -PayloadDir "$INSTDIR\resources\service-payload" -Json'
  Pop $0
  DetailPrint "Camacho service uninstall exit=$0"
!macroend

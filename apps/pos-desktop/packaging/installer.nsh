; Camacho POS — NSIS hooks for WinSW / SCM Local Service.
; Requires elevation (perMachine). Does not delete commercial AppData.
; commercialLogin / cross-session IPC gate remains NOT_PROVEN.
; Fail-closed: install/upgrade MUST register CamachoPOSLocalService or Abort.

!macro customInstall
  DetailPrint "Camacho: registering POS Local Service (WinSW/SCM)"
  nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\service-payload\install-camacho-local-service.ps1" -Action Install -PayloadDir "$INSTDIR\resources\service-payload" -Json'
  Pop $0
  DetailPrint "Camacho service install exit=$0"
  StrCmp $0 "0" camacho_scm_install_ok 0
    DetailPrint "Camacho SCM registration failed (exit=$0) — aborting installer"
    Abort "WINSW_SCM_REGISTRATION_FAILED"
  camacho_scm_install_ok:
!macroend

!macro customUnInstall
  DetailPrint "Camacho: removing POS Local Service (WinSW/SCM); preserving AppData"
  ; Prefer the helper while the payload still exists (stop + winsw uninstall + sc delete).
  nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\service-payload\install-camacho-local-service.ps1" -Action Uninstall -PayloadDir "$INSTDIR\resources\service-payload" -Json'
  Pop $0
  DetailPrint "Camacho service uninstall helper exit=$0"
  ; Belt-and-suspenders: even if the helper/payload was already removed, clear SCM.
  nsExec::ExecToLog '"$WINDIR\System32\sc.exe" stop CamachoPOSLocalService'
  Pop $1
  DetailPrint "Camacho sc stop exit=$1"
  nsExec::ExecToLog '"$WINDIR\System32\sc.exe" delete CamachoPOSLocalService'
  Pop $2
  DetailPrint "Camacho sc delete exit=$2"
!macroend

; Camacho POS — NSIS hooks for WinSW / SCM Local Service.
; Requires elevation (perMachine). Does not delete commercial AppData.
; commercialLogin / cross-session IPC gate remains NOT_PROVEN.
; Fail-closed: install/upgrade MUST leave scm-install.ok + registered service.

!macro customInstall
  DetailPrint "Camacho: registering POS Local Service (WinSW/SCM)"
  ; Clear prior success marker so upgrade cannot reuse a stale OK file.
  Delete "$COMMONAPPDATA\CamachoPOS\logs\scm-install.ok"
  nsExec::ExecToLog '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\service-payload\install-camacho-local-service.ps1" -Action Install -PayloadDir "$INSTDIR\resources\service-payload" -Json'
  Pop $0
  DetailPrint "Camacho service install exit=$0"
  ; Authoritative acceptance: helper writes scm-install.ok only after NT SERVICE bind + Running.
  IfFileExists "$COMMONAPPDATA\CamachoPOS\logs\scm-install.ok" +3 0
    DetailPrint "Camacho SCM registration missing scm-install.ok (helper exit=$0) — aborting installer"
    Abort "WINSW_SCM_REGISTRATION_FAILED"
!macroend

!macro customUnInstall
  DetailPrint "Camacho: removing POS Local Service (WinSW/SCM); preserving AppData"
  Delete "$COMMONAPPDATA\CamachoPOS\logs\scm-install.ok"
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

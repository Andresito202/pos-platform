; Camacho POS Colombia — Windows NSIS commercial safety boundary.
; No test, sample or diagnostic service may be installed by this product hook.
; Cross-session SERVICE/DESKTOP authentication and signing remain uncertified.

!macro customInstall
  DetailPrint "Camacho POS commercial SCM release is not certified"
  Abort "SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN"
!macroend

!macro customUnInstall
  DetailPrint "Camacho: removing POS Local Service (WinSW/SCM); preserving AppData"
  Delete "$INSTDIR\resources\service-payload\scm-install.ok"
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

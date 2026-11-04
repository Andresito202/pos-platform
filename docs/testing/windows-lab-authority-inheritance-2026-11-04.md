# Protección de herencia de la autoridad de laboratorio

La ejecución real aportada por el propietario confirmó: administrador elevado,
sesión Windows 1, propietario BUILTIN/Administradores y tres ACE Allow FullControl
(SYSTEM, Administradores y el usuario Administrador de la VM). La carpeta
authority conserva herencia (`AreAccessRulesProtected=False`). El preflight
rechazó correctamente la custodia; el mensaje posterior de pnpm sobre tsx no
demuestra una dependencia ausente.

El operador `windows-login-lab-authority-acl.ps1 -Run` se limita a la carpeta
authority del laboratorio autorizado, en WIN-QH2KNH6JRL3 / Server 2022. Sin
`-Run` no hace nada. Verifica identidad interactiva, elevación, propietario y
exactamente los tres SID/permisos observados; rechaza rutas con puntos de
reanálisis, incluidos sus ancestros. No concede permisos ni usa recursión.

Antes de cambiar nada guarda un descriptor SDDL exclusivo en results y detecta
cambios concurrentes previos. Aplica `SetAccessRuleProtection(true,true)`:
bloquea herencia futura preservando las reglas heredadas como explícitas.
[Semántica documentada por Microsoft](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.objectsecurity.setaccessruleprotection).
Comprueba propietario y todas las tuplas SID/derechos/herencia/propagación/tipo
antes y después (excluye únicamente la marca IsInherited que debe cambiar).
No escribe claves, tokens, certificados, SQLite, PostgreSQL ni configuración SCM.
Windows puede propagar reglas de directorio; no se solicitan accesos nuevos ni
se ejecuta Set-Acl sobre archivos o subcarpetas.

Si falla, intenta restaurar sólo cuando el descriptor actual coincide exactamente
con el que intentó escribir; un descriptor inesperado se conserva para revisión.
Mantiene siempre el respaldo y exige detenerse ante error. Una segunda ejecución
sobre permisos esperados ya protegidos devuelve UNCHANGED_PROTECTED.

Validación local: dos pruebas observadas, sintaxis PowerShell, ejecución sin Run
y rechazo de una ruta ajena antes de tocar ACL. Ninguna prueba modificó ACL del
host. No se ejecutó el cambio efectivo en la VM desde esta consola; permanece
pendiente la ejecución del propietario y la consulta viva posterior. Estas
pruebas no certifican login, custodia física ni DEV-003.

No se vuelve a ejecutar MFA, KDF o publicación ADMIN. Tras reparar se ejecuta
únicamente windows-login-lab-commercial-readiness.mts para conocer el registro
actual y la compatibilidad UUID del dispositivo, conservando el gate SCM.

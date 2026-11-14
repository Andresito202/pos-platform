# Continuidad humana y publicación ADMIN del laboratorio — 2026-11-04

## Estado y alcance

La rama activa conserva por fast-forward los siete commits de la VM desde
`b41f36b92a373c1ac1a8d909deaef8a8a502617b` hasta
`05d81ac0bcbf35a7cb39e85d0b7173e3f06831ec`, sin reescribirlos ni fusionar main.
Se incorporan el parche local de enrolamiento y su prueba exportados por el
propietario. Blob reconstruido del operador de enrolamiento:
`0b827e1150a08e1a6ada7e579158898a6cfedbea`. No se repite la ceremonia aprobada.

Evidencia humana **observada por el propietario y comunicada en esta sesión**:
`LAB_REAL_HUMAN_ENROLLMENT=PASS`; recibo filtrado
`CAMACHO_LAB_REAL_HUMAN_WEBAUTHN`, UV required, sesión y rol bootstrap revocados,
`businessSessionIssued:false`, `completedAt:2026-11-04T05:39:37.856Z`.
No equivale a login BUSINESS, activación SSA/SAS ni certificación productiva.
El método concreto de autenticador no se infiere del recibo.

La consulta real aportada por el propietario se ejecutó con TLS verify-full y
`pos_platform_app`, `BEGIN READ ONLY … ROLLBACK`, y devolvió cero roles BUSINESS.
El preflight anterior sólo reflejó referencias ausentes en su proceso; no
invalidó el MFA ni demostró inexistencia de certificados/archivos en la VM.

## Decisión del propietario

Empresa **Camacho POS Laboratorio**, sucursal **Principal**, Administrador.
Aprobación explícita en esta conversación del perfil `GENERAL_ADMIN` con los
17 códigos enumerados en `LAB_ADMIN_POLICY`, limitado a ese ámbito y a la base
aislada. Se excluyen GLOBAL, licencias, hardware y emisión fiscal. La
publicación no sustituye autenticación, prueba de dispositivo ni políticas de
sesión. No se introducen tablas, migraciones ni endpoints.

## Implementación

- `tools/operators/windows-login-lab-business-context.mts`: CLI local exige
  operador Windows interactivo elevado, directorio del laboratorio, base exacta,
  PostgreSQL 16.14 y TLS verificado. Reutiliza el pool y los escritores canónicos
  de tenant/empresa/sucursal. Publica membresía ADMIN, rol versionado, permisos,
  grants y asignación exacta; no usa el onboarding OWNER para conceder otro rol.
  Revalida en PostgreSQL cuenta, contraseña activa y factor/material persistido.
  El recibo de enrolamiento **sólo selecciona** la identidad; nunca acredita una
  sesión ni sirve de prueba MFA para el futuro login.
- La transacción única incluye auditoría append-only. Locks conflictivos de
  tabla cubren escritores RBAC, con timeout explícito del operador. Se conservan
  los privilegios SQL existentes: no GRANT, DDL, UPDATE general ni bypass RLS.
- Repetición exacta devuelve UNCHANGED sin duplicar; conflicto de datos,
  revocación, grants extra/faltantes o ámbito diferente rechazan sin repararlos
  silenciosamente. El estado inicial inesperado se conserva para revisión.
- `--verify-transaction` ejecuta la publicación y fuerza rollback; una consulta
  posterior independiente verifica ausencia de efectos nuevos. Sólo `--apply`
  persiste, sin crear sesiones, tokens, DeviceProof, SSA o SAS.
- `windows-login-lab-business-context.ps1`: orquesta pruebas nuevas, verificación
  real con rollback y, sólo con `-Apply`, aplicación y reintento idempotente.
  Guarda evidencia fuera de Git, sin credenciales. El timeout de 5000 ms usado
  por el actualizador es exclusivamente de esta operación de laboratorio.
- `windows-login-lab-update.ps1`: comprueba rama, ancestry y HEAD remoto esperado;
  cualquier cambio local debe coincidir con el blob publicado antes de staging
  y fast-forward. Trabajo concurrente diferente bloquea sin reset/stash/restore.
  No modifica main, servicios, claves, certificados o workflows.

## Validación local y límites

Pruebas nuevas/focalizadas: 14 del publicador, 7 del enrolamiento exportado y
una de preservación Git con repositorios temporales y helpers PowerShell reales.
Los tests del publicador usan un doble transaccional: **no acreditan PostgreSQL
real**, RLS o concurrencia física. La prueba Git no es una prueba de login.
TypeScript explícito de los cuatro archivos MTS y sintaxis PowerShell se
verifican separadamente. Arquitectura y política se ejecutan localmente.
Recuentos, hashes y errores corregidos: recibo JSON hermano de evidencia.

Fallos observados durante este incremento: invocación inicial de TypeScript 6
requirió `--ignoreConfig`; se corrigieron dos errores de tipos. La prueba del
actualizador detectó recursión por colisión del helper `Git` con el comando
`git` en PowerShell; se corrigió invocando `git.exe`. Se incorporaron timeouts
de prueba. Los fallos no se cuentan como ejecuciones satisfactorias.

## Ejecución real pendiente

No hay canal de ejecución administrativa autorizado desde esta consola hacia
la VM: Hyper-V denegó acceso y WinRM requiere autenticación/trust no configurados.
No se modificó la seguridad del Windows 10 para eludirlo. Por tanto **todavía
no se aplicó esta publicación a la base de la VM** ni se acredita su resultado.

El actualizador se distribuye con el SHA publicado como parámetro, fuera de
Git para evitar autorreferencia. Dentro de Server 2022, desde un directorio que
contenga su copia, el comando de operador comienza así; sustituir únicamente
el marcador por el SHA exacto publicado en la entrega:

```powershell
Clear-Host
powershell.exe -NoProfile -File .\windows-login-lab-update.ps1 -ExpectedHead <SHA_PUBLICADO> -LabRoot C:\CamachoPosScmLab\608ba7092afe4a5b93ac14a7df23a046 -Run -ApplyBusinessContext
```

Primero debe obtenerse `VERIFIED_ROLLED_BACK`; después `CREATED` y `UNCHANGED`.
Un error detiene el proceso y conserva evidencia. No saltar a la aplicación si
la verificación real falla. El script no ejecuta pruebas físicas G1/G2 ni inicia
SCM. Sin ejecutar el comando dentro del entorno objetivo, el estado es
**IMPLEMENTADO / UNIT_TESTED, PUBLICACIÓN EN VM PENDIENTE**.

## Qué sigue faltando para login completo

1. Ejecución física satisfactoria del operador anterior en la VM.
2. Provisión comercial Central con referencias reales de contexto, cliente,
   parámetros explícitos, confianza y claves de laboratorio ya custodiadas.
3. Registro y posesión auténtica del dispositivo; no basta el ID o una clave
   pública copiada. Conservar el gate SCM vigente mientras corresponda.
4. Login nuevo con contraseña y el factor registrado → BUSINESS → SSA/SAS →
   permisos efectivos → dashboard → renovación/logout/revocación. El alta de
   MFA no sirve como evidencia de esa sesión posterior.

No hay producción certificada, CI verde declarado, Actions solicitados, pagos
reales ni modificaciones de `oracleJdk-27/`. El commit de publicación usa
`[skip ci]` para los eventos push/pull_request existentes, sin editar workflows;
no se ejecuta workflow_dispatch. PR #99 permanece Draft.

# FACTUS Pay Sandbox — custodia e ingreso local

Estado: IMPLEMENTADO Y PROBADO LOCALMENTE con DPAPI real y token ficticio exclusivo de prueba. **FACTUS_PAY_SANDBOX_NOT_VERIFIED**: el propietario tiene cuenta, pero no hay custodia operativa ni binding auténtico confirmados en esta consola. No se llamó al proveedor ni se modificó un token auténtico.

## Reutilización y límites

`ManagedFactusPayCredentials`, perfil `CAMACHO_FACTUS_PAY_API_CUSTODY_V1`, sigue siendo el resolver canónico. Ahora permite una fila protegida con Windows DPAPI CurrentUser; la fila cifrada incluye binding y token y se revalida contra la identidad registrada por PostgreSQL en cada operación. No llega al renderer, no se añade otra autoridad ni tabla. Se conservan las filas históricas con `expiresAt` explícito; no se las presenta como cifradas.

Según la [documentación oficial de autenticación](https://pay-developers.factus.com.co/autenticacion/), el token no vence por tiempo y una autenticación invalida el anterior. `expiresAt:null` representa esa ausencia de caducidad; los valores históricos con fecha siguen caducando. No se deshabilitan generación, revocación, cuenta, ambiente ni comprobación del pago por API. La herramienta no autentica por arranque, inspección, importación ni verificación.

La protección CurrentUser exige ejecutar la herramienta y Central con la misma cuenta Windows. El archivo no es portátil a un VPS Linux ni a otra identidad: allí deberá utilizarse la custodia de secretos del operador y el formato del resolver con permisos de servicio, sin copiar un blob DPAPI inútil ni volver a autenticar automáticamente. Un administrador de la máquina puede controlar el proceso: DPAPI no protege frente al administrador del host comprometido.

## Preparación por el operador

1. Confirmar en la Central auténtica los siete campos no secretos: `tenantId`, `companyId`, `integrationId`, `credentialReference`, `generation`, `environment:SANDBOX` y `providerAccountReference`. Deben provenir de los registros existentes, no de fixtures ni de UUID inventados. Sin esa provisión, detener el ingreso operacional.
2. Elegir una carpeta de custodia nueva fuera del repositorio, bajo la cuenta que ejecutará Central. Restringirla a esa identidad; no tomar posesión ni cambiar ACL de carpetas ajenas. Un administrador puede prepararla con estas operaciones, usando la identidad de servicio correcta:

```powershell
$directorio = Read-Host 'Ruta absoluta de carpeta NUEVA de custodia fuera de Git'
if (Test-Path -LiteralPath $directorio) { throw 'Usa una carpeta nueva; no se altera una existente' }
[void][IO.Directory]::CreateDirectory($directorio)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
[void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
[IO.Directory]::SetAccessControl($directorio,$acl)
```

3. Guardar sólo el binding auténtico en un JSON dentro de esa carpeta, con los siete nombres indicados y tipos correctos; quitar herencia y conservar sólo ACL de la identidad de servicio en ese archivo. El script rechaza ACL amplias, reparse points, archivo dentro del repositorio y ambiente productivo. No escribir correo/contraseña ni token en ese JSON.
4. Definir estas rutas **no secretas** en la consola local:

```powershell
$archivoBinding = Read-Host 'Ruta absoluta al binding registrado y protegido'
$archivoCustodia = Read-Host 'Ruta absoluta elegida para la custodia de API'
powershell.exe -NoProfile -File tools/operators/factus-pay-sandbox-custody.ps1 -Mode Inspect -CustodyFile $archivoCustodia -BindingFile $archivoBinding
```

La inspección informa existencia, cantidad de entradas y protección; `networkCalled:false`, `tokenValidityVerified:false`. No autentica ni imprime tokens. Si existe custodia para otra cuenta o varias entradas, esta herramienta no la sobrescribe: requiere reconciliación del operador.

## Ingreso personal protegido

Si ya existe un token válido autorizado, conservarlo e importarlo sin autenticación:

```powershell
powershell.exe -NoProfile -File tools/operators/factus-pay-sandbox-custody.ps1 -Mode ImportToken -CustodyFile $archivoCustodia -BindingFile $archivoBinding
```

Solicita `IMPORT SANDBOX` y después el token oculto. Para una custodia existente se requiere además `-ReplaceExisting`, mismo binding y aprobación concreta de sustitución. No cambia el token en FACTUS; sólo su custodia local. No borra otras cuentas.

**Sólo después de aprobación puntual del propietario para revocar el token anterior**, el comando implementado es:

```powershell
powershell.exe -NoProfile -File tools/operators/factus-pay-sandbox-custody.ps1 -Mode Authenticate -CustodyFile $archivoCustodia -BindingFile $archivoBinding
```

Muestra cuenta registrada/ambiente, exige `AUTHENTICATE SANDBOX` y solicita email y contraseña con captura oculta. Realiza una sola llamada al `/auth` oficial, TLS/certificado/hostname normales, sin redirects ni reintentos. Guarda exclusivamente el token y binding cifrados; no conserva la contraseña. Escritura atómica y ACL de servicio. Los errores no vuelcan cuerpos del proveedor ni excepciones con secretos. Strings de .NET/JavaScript no pueden borrarse con garantía; se liberan referencias y se limpian buffers/BSTR cuando es viable.

Si la respuesta se pierde después de que FACTUS autentique, el token anterior puede haberse revocado aunque no se haya guardado el nuevo. No reintentar automáticamente: reconciliar con el propietario/proveedor. Ese efecto externo no admite rollback local.

## Integración con Central y comprobación posterior

- Configuración existente: `CENTRAL_FACTUS_PAY_COLLECTIONS_PROVISION_FILE`; su `credentials_file` debe apuntar a `$archivoCustodia`. El archivo de provisión debe contener los registros y políticas auténticos ya exigidos por `FactusPayCollectionsProvisionSchema`. No se crean políticas fiscales ficticias para poder montarlo.
- No guardar credenciales en argumentos, `.env` versionado, historial, logs o capturas. Los comandos reciben rutas y modos, nunca la contraseña o token. La herramienta rechaza rutas dentro del repositorio y nunca imprime el contenido del archivo.
- Después de autorización para usar el token, la lectura administrativa es:

```powershell
powershell.exe -NoProfile -File tools/operators/factus-pay-sandbox-custody.ps1 -Mode VerifyReadOnly -CustodyFile $archivoCustodia -BindingFile $archivoBinding
```

Exige `VERIFY SANDBOX`, lista la primera página oficial, y consulta por GET la primera referencia existente si la hay, sin inventarla ni crear recaudos. Sólo devuelve indicadores sanitizados; no imprime QR, llaves bancarias, token ni datos personales. `paymentConfirmed:false`: el verificador canónico del pago sigue correlacionando cotización, referencia, cuenta, moneda, importe, estado y generación antes de activar derechos. La lista vacía deja el detalle pendiente.

## Pruebas observadas

```powershell
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm --filter @pos-platform/central-authority exec vitest run tests/factus-pay-windows-custody.test.ts tests/subscription-quotes-physical.test.ts -t 'existing custody:|FACTUS API:' --reporter=json --outputFile=../../artifacts/licensing/2026-10-28/factus-custody-final.json
```

2 PASS, 6 filtrados: importación protegida con secreto de fixture, DPAPI CurrentUser real, inspección sin red, rechazo de reemplazo implícito, binding diferente, manipulación de ciphertext y ACL abierta. PostgreSQL temporal + doble HTTPS prueban consumo de token sin vencimiento temporal y rechazo de credencial con vencimiento histórico. No se ejecutaron los modos Authenticate/VerifyReadOnly contra FACTUS; no hay certificación auténtica.

FACTUS Facturación V2 permanece separado y sin utilizar: rotación del Client Secret anterior no confirmada; se preserva la evidencia histórica de OAuth/numeración del 6 de septiembre de 2026.

SHA-256 `factus-custody-final.json`: `1e3c6e97592c8d79b2a9582e88c23faaa1b55cf05c70b316a708395bbea5b0bc`.

SHA-256 `factus-custody-operator-final.json`: `543892e570052447dff5d75f3e993311e0618f116e3fda99a8acb9aa80850535`.

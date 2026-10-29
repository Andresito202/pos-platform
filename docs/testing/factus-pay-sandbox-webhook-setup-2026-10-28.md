# FACTUS Pay Sandbox — dos campos del panel

Actualización de destinos autorizados por el propietario: la URL futura queda fijada en `https://central.camachoposcolombia.com/v1/webhooks/factus-pay/collections`, sin `?key=`. El dominio todavía no se ha comprado ni desplegado; esta selección no verifica DNS/TLS ni configura el portal. Las referencias inferiores a un host pendiente describen el estado anterior a esta decisión y conservan su evidencia histórica.

La misión de catálogo quedó documentada en [pricing-v2-closure-2026-10-28.md](pricing-v2-closure-2026-10-28.md), commit `1ffa70d857dbbfcaa681683963bcf2666f7e8175`. La herramienta de credenciales API quedó publicada en `4ef252fd`. Esta preparación posterior no modifica login, licencias, precios, FACTUS V2, handler, inbox ni contratos.

## CAMPO 1 — URL del webhook

**No hay URL definitiva verificada.** No existe VPS, origen Central ni autorización DNS confirmados. No se configuró el panel FACTUS. No se presupone un subdominio de `andrescamacho.dev`.

Formato pendiente de completar, **no registrarlo literalmente**:

```text
https://<HOST_CENTRAL_PUBLICO_AUTORIZADO>/v1/webhooks/factus-pay/collections
```

Cuando el operador haya desplegado y verificado TLS, el valor exacto será `CENTRAL_AUTHORITY_ORIGIN` más `/v1/webhooks/factus-pay/collections`. El origen debe coincidir con el certificado y Host admitidos por Central. No añadir `?key=`: FACTUS lo añade automáticamente. No registrar localhost, IP privada, un túnel temporal o una URL de laboratorio como si fuera el despliegue auténtico.

La [documentación oficial de webhooks](https://pay-developers.factus.com.co/webhooks/) exige HTTPS público, POST JSON y llave por query. Admite respuesta 204 y requiere persistir antes de responder éxito. Coincide con el handler actual y su repositorio PostgreSQL; no exige cookie, sesión GLOBAL ni CSRF para esta ruta. La llave se valida contra SHA-256 de la tabla existente y sólo resuelve una integración activa, con credencial activa y ámbito derivado del hash.

El operador debe evitar que el servidor, proxy y observabilidad registren la query `key`, incluso en errores. No se cambia DNS ni se contrata infraestructura en esta sesión.

## CAMPO 2 — Llave

Herramienta implementada: `tools/operators/factus-pay-sandbox-webhook.ps1`. Es distinta de la custodia del token API: el token no es una llave de webhook y la generación de esta llave no llama `/auth` ni revoca tokens del proveedor.

### Preparación personal, una vez existan los registros auténticos

1. Usar la carpeta privada externa a Git preparada por el operador, con owner y ACL de su identidad de custodia Windows, conforme a [factus-pay-secure-operator-2026-10-28.md](factus-pay-secure-operator-2026-10-28.md). No usar una carpeta compartida ni cambiar permisos de un almacén ajeno.
2. Crear un archivo de binding **no secreto**, con exactamente `tenantId`, `companyId`, `integrationId` y `environment:"SANDBOX"`, tomados de la empresa e integración FACTUS_PAY reales. Proteger ese archivo con ACL sin herencia para la misma identidad. Sin esos registros no generar una llave operacional.
3. Elegir un archivo nuevo fuera del repositorio y ejecutar:

```powershell
$bindingWebhook = Read-Host 'Ruta absoluta al binding Sandbox auténtico y protegido'
$secretoWebhook = Read-Host 'Ruta absoluta NUEVA para custodia de la llave webhook'
powershell.exe -NoProfile -File tools/operators/factus-pay-sandbox-webhook.ps1 -Mode Generate -SecretFile $secretoWebhook -BindingFile $bindingWebhook
```

Genera 32 bytes aleatorios criptográficos, codificados en 43 caracteres base64url; cifra la llave con DPAPI CurrentUser y propósito separado. Guarda un recibo `$secretoWebhook.registration.json` que contiene **sólo binding y SHA-256**, marcado `NOT_REGISTERED`. No imprime la llave. Los archivos nuevos se crean sin compartir y con ACL privada; nunca sustituye una llave existente. La generación no aprovisiona Central ni cambia el panel FACTUS.

La inspección posterior descifra en memoria y calcula el mismo hash sin revelar contenido:

```powershell
powershell.exe -NoProfile -File tools/operators/factus-pay-sandbox-webhook.ps1 -Mode Inspect -SecretFile $secretoWebhook -BindingFile $bindingWebhook
```

### Provisión en Central, pendiente de infraestructura auténtica

El administrador autorizado deberá registrar únicamente el hash en `integrations.factus_pay_webhook_keys`, existente desde 018, con UUIDv7 canónico, tenant/company/integration auténticos, `ACTIVE` y fecha del servidor. Debe comprobar en la misma transacción la integración `provider_code_snapshot='FACTUS_PAY'`, `environment='SANDBOX'`, empresa/tenant correctos y estado `ACTIVE`, y su binding de credencial activo. No alterar una llave anterior ni conceder permisos adicionales por este procedimiento. Conservar la evidencia administrativa del cambio, UUID y hash, sin la llave.

No hay nuevos DDL, tablas, endpoints ni un segundo mecanismo de resolución. Esta sesión **no insertó** una llave operativa ni inventó la identidad del administrador. El recibo local no sustituye esa autorización; `centralProvisioned:false` sólo informa preparación local y no consulta la base.

El despliegue existente monta el receptor con `CENTRAL_FACTUS_PAY_PROVISION_FILE`, archivo `CAMACHO_FACTUS_PAY_INGRESS_V1`. Debe contener la referencia de política, checksum real de 018 y límites operativos aprobados (`max_body_bytes`, SQL y rate limit), sin secreto. Es distinto de `CENTRAL_FACTUS_PAY_COLLECTIONS_PROVISION_FILE` y su `credentials_file` para la API. Central exige rol de runtime, ledger y RLS correctos; sin provisión no se habilita el handler.

### Recuperación protegida y pegado personal

Después de verificar la URL pública, el registro del hash y la sesión personal del operador en el panel Sandbox:

1. Desactivar historial y sincronización de portapapeles de Windows y herramientas que lo capturen. No compartir pantalla ni grabar el campo secreto.
2. Ejecutar bajo la misma identidad que protegió el archivo:

```powershell
powershell.exe -NoProfile -File tools/operators/factus-pay-sandbox-webhook.ps1 -Mode CopyToClipboard -SecretFile $secretoWebhook -BindingFile $bindingWebhook
```

3. Confirmar `COPY SANDBOX WEBHOOK`. La llave se copia sin aparecer en la consola. Pegar personalmente en **Llave** del panel, guardar la configuración y limpiar inmediatamente:

```powershell
Set-Clipboard -Value ''
```

No ejecutar `Get-Content` para revelar el secreto, no pasarlo como argumento y no pegarlo en el chat. El portapapeles es un transporte deliberado del operador y otras aplicaciones pueden leerlo durante ese intervalo. Si no puede controlarse esa exposición, no usar el modo de copia en ese equipo. No se ejecutó ese modo durante las pruebas ni se alteró el portapapeles del propietario.

DPAPI CurrentUser requiere la misma identidad/máquina para recuperar la llave; no trasladar el blob a Linux esperando descifrarlo. El VPS sólo necesita el hash, nunca la llave en texto plano. Mantener el respaldo cifrado bajo custodia del propietario hasta registrar personalmente el campo del proveedor.

## Pruebas locales y cierre auténtico pendiente

```powershell
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm --filter @pos-platform/central-authority exec vitest run tests/factus-pay-physical.test.ts --reporter=json --outputFile=../../artifacts/licensing/2026-10-28/webhook-physical.json
pnpm --filter @pos-platform/central-authority exec vitest run tests/factus-pay-webhook-operator.test.ts --reporter=json --outputFile=../../artifacts/licensing/2026-10-28/webhook-operator.json
```

- 1 PASS: handler/runtime existentes por HTTPS temporal, llave válida e incorrecta, 204/401/503, duplicados concurrentes, inbox durable, separación de empresas, revocación y rollback ante fallo de auditoría; cero licencias activadas. Sólo base PostgreSQL aleatoria temporal, eliminada al terminar.
- 1 PASS Windows: generación aleatoria, archivo DPAPI real, hash reproducible después de recuperar, recibo sin registro, preservación del archivo al repetir generación y rechazo de binding distinto. Ningún secreto de prueba se registró en una Central operativa ni en FACTUS.
- TypeScript y política se verifican para los archivos añadidos. Los POST de laboratorio no son notificaciones externas auténticas.

Después del despliegue autorizado: comprobar TLS y accesibilidad pública, registrar personalmente ambos campos y observar una notificación **real** de un recaudo Sandbox legítimo autorizado. No crear uno sólo para obtener un PASS. Correlacionar recepción durable/deduplicada y consulta API posterior con referencia, cuenta/empresa, moneda, importe y estado. La confirmación de Payment y activación de Licensing siguen en sus autoridades existentes; un webhook no las concede.

**ESTADO: PREPARADO LOCALMENTE. Pendientes: origen HTTPS auténtico, binding y registro administrativo del hash, configuración personal del panel y evidencia real de FACTUS Pay Sandbox.** Sin producción, cambios DNS, contratación, emisión fiscal, pagos nuevos ni Actions.

SHA-256 `webhook-physical.json`: `4471e5c00c3d2512fe1ab3ac3d62cefd00b7188be973578c04479a155b14835f`.

SHA-256 `webhook-operator.json`: `ac8bcb4469f619025961d43e48f757d71fd2551d80ca7d8bf813d3e08f212650`.

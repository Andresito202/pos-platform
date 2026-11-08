# Central real: despliegue y certificación por operador

No se asigna un servidor ni un subdominio de `andrescamacho.dev`. Tener ese
dominio no autoriza cambios DNS. No se instalaron servicios ni se contactaron
cuentas auténticas: en la consola inspeccionada faltan las variables/archivos
operativos. El propietario declara cuentas sandbox; eso no prueba su provisión.

## Preparación ejecutable

1. El operador proporciona proveedor/VPS, sistema operativo, IP pública, nombre
   HTTPS exacto autorizado, responsable, ambiente PREPRODUCTION y base destino.
   Provisiona TLS de CA confiable para ese nombre. Mantiene PostgreSQL en red
   privada y acceso administrativo separado. No termina TLS en un proxy HTTP:
   los handlers actuales exigen TLSSocket y rechazan X-Forwarded/Forwarded. Si
   usa un balanceador, debe conservar el TLS hasta este listener.
2. Despliega el SHA revisado de esta rama sin ejecutar Actions. Usa las versiones
   del workspace (pnpm 9.15.0 y Node compatible con el runtime ya probado). El
   runner vigente exige PostgreSQL **16.14**; es un requisito de compatibilidad,
   no autorización para omitir parches futuros. No sustituir el chequeo de versión.
3. Crea los roles/base mediante los procedimientos existentes del operador. Los
   predecesores 001/003/004/006/007 deben tener sus checksums APPLIED correctos.
   No aplicar propuestas sueltas ni conceder UPDATE general sobre RBAC/claves.
   Inspecciona primero el manifiesto, que no conecta a PostgreSQL:

   ```powershell
   pnpm --filter @pos-platform/target-migrations run postgres:commercial:apply --license-activations --manifest
   ```

   Para aplicar en el VPS, el operador carga por canal protegido
   `POSTGRES_MIGRATOR_URL` con rol `pos_migrator`, `POSTGRES_EXPECTED_DATABASE`,
   `REPOSITORY_COMMIT` exacto y los dos `POSTGRES_MIGRATION_*_TIMEOUT_MS` aprobados.
   Después ejecuta el mismo comando sin `--manifest`. No usar URL migrator en
   el runtime. Nunca ejecutar esto contra una base comercial sin aprobación y
   respaldo. El nuevo target extiende el runner canónico; AUTHENTICATION no cambia.
4. Provisiona los archivos secretos fuera del build renderer, sólo legibles por
   la cuenta de servicio. Configura `CENTRAL_DATABASE_URL` para `pos_platform_app`
   sin superuser/BYPASSRLS ni membresía de owner; TLS PostgreSQL `verify-full`.
   Usa la CA pública por la configuración PostgreSQL/Node correspondiente; nunca
   `NODE_TLS_REJECT_UNAUTHORIZED=0`. No pegar URLs con contraseña en chat/logs.
5. Completa `CENTRAL_DEPLOYMENT_ENVIRONMENT`, `CENTRAL_AUTHORITY_ORIGIN`, puerto,
   timeouts, límite de cuerpo y vigencia DEV-003. Los nombres exactos están en
   `central-deployment-configuration.ts`; no se eligen aquí valores operativos.
   TLS: `CENTRAL_TLS_KEY_FILE` y `CENTRAL_TLS_CERT_FILE`; enrolamiento:
   `D3_ISSUER_PRIVATE_KEY_FILE`, `D3_ENROLLMENT_TRANSPORT_TOKEN_FILE`.
6. Firma/provisiona SSA y SAS con las herramientas y contratos existentes,
   claves operativas distintas y raíces públicas/fingerprints verificados por
   canal independiente. Publicación: `SESSION_TRUST_ARTIFACT_FILE`, su token
   separado y `AUTHORIZATION_TRUST_ARTIFACT_FILE`/token separado. Completa
   `CENTRAL_COMMERCIAL_PROVISION_FILE` según CentralCommercialProvisionSchema
   y `CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE` según su schema actual.
   Estos archivos fijan RP, origen, registro Electron/callback exacto, recipient,
   checksums y límites aprobados. No reutilizar parámetros de laboratorio.
7. Provisiona usuario real, contraseña y WebAuthn por la ceremonia existente;
   asigna sólo roles/grants aprobados. Registra empresa/sucursal, instalación,
   dispositivo y activación DEV-003 reales. Los UUID aislados no autentican.
8. Ejecuta en la cuenta de servicio el preflight **offline y sin secretos**:

   ```powershell
   pnpm --filter @pos-platform/central-authority run deployment:preflight
   pnpm --filter @pos-platform/central-authority run typecheck
   pnpm --filter @pos-platform/pos-desktop run build:renderer
   pnpm --filter @pos-platform/central-authority start
   ```

   El preflight sólo inventaría presencia/archivos/configuración/TLS local; no
   autentica cuentas ni valida conectividad remota. En el VPS, ejecutar `start`
   con supervisor de procesos del operador, cuenta sin privilegios, directorio
   de trabajo y entorno protegidos. No poner secretos en argumentos del proceso.
   Probar TLS desde Windows sin bypass y el endpoint de readiness existente.
   Un HTTP 200 de readiness no certifica el login humano.
9. Instala Service/Electron Windows con su procedimiento vigente. Configura
   `POS_WINDOWS_COMMERCIAL_PROVISION_FILE`, `POS_AUTHORIZATION_TRUST_PROVISION_FILE`,
   `POS_CENTRAL_BASE_URL` y el binding auténtico. Las claves privadas siguen en
   DPAPI del Service, no en main/preload/React. El renderer file:// no ejecuta
   WebAuthn: se abre la ceremonia en el navegador HTTPS de Central.

## Activación de capacidad

El operador registra la **clave pública** LICENSE en
`licensing.trusted_signing_keys` con ambiente, SPKI checksum, estado y ventana
de firma. La privada permanece en archivo/custodia de Central; el runtime sólo
lee el registro mediante función SQL acotada. No puede insertar/actualizar trust.
`CENTRAL_LICENSE_ACTIVATION_PROVISION_FILE` usa LicenseActivationProvisionSchema,
checksum 022 y política versionada; no genera claves ni concede features.

Un GLOBAL con LICENSE_ISSUE llama `/v1/platform/licenses/allocate` con la licencia
pagada, credencial exacta y IDs de Cash/sucursal verificados por el operador.
Eso guarda PENDING, no un artefacto utilizable. Cash sigue siendo owner de las
cajas; esta operación no crea CashRegister ni permisos de usuario.

Windows recibe por provisión administrativa la activation_id, la ruta absoluta
de `POS_LICENSE_CAPACITY_PROVISION_FILE` y las claves **públicas previamente
verificadas** en `license_activation` de su configuración comercial. Especifica
`poll_ms`; la ruta debe coincidir exactamente con la configuración del Service.
El Service firma sólo `/v1/licensing/activations/resolve`, descarga, valida contra
esos pins y reemplaza atómicamente el artefacto público. Las claves devueltas por
la red nunca crean confianza. No hay método de firma libre ni IPC para provisionar.

Se incluyen una caja y sólo adicionales confirmadas por Payments. Los registros
reservados históricamente no se liberan por un simple cambio de dispositivo o
revocación: falta un protocolo de liberación con evidencia de revocación offline.
Esta denegación conservadora impide doble asignación; no se anuncia reasignación
libre. Una revocación GLOBAL exige LICENSE_REVOKE separado, se firma y persiste
append-only, y el Service la aplica/audita en SQLite. Repetirla no duplica efectos.

## Ceremonia humana: registro de aceptación

Ejecutar únicamente con entorno/identidades/credenciales autorizados. Guardar SHA,
Windows/Service/Electron, origen, ambiente, timestamps del servidor, IDs públicos
de correlación y resultados; nunca contraseña, cookies, access/refresh o claves.

| Paso | Evidencia requerida para PASS |
|---|---|
| Contraseña incorrecta | Denegación Central; sin BUSINESS, SSA ni acceso al dashboard. |
| Contraseña correcta + MFA físico | Persona opera autenticador enrolado y UV; challenge consumido una vez, evento y contador persistidos. |
| BUSINESS → Windows | DeviceProof exacta, código/PKCE de un uso, SSA/SAS auténticos; permisos leídos del backend y dashboard permitido sólo si corresponden. |
| GLOBAL separado | Nuevo MFA y cookie GLOBAL; BUSINESS no autoriza edición de planes. Verificar cada operación con grant efectivo. |
| Rol/empresa | Cajero sin administración; supervisor sólo sucursal asignada; usuario de otra empresa denegado. No sembrar grants para aprobar. |
| Renovación y reinicio | Access/refresh rota bajo DPAPI, reinicio recupera únicamente estado válido; replay de código/token se rechaza. |
| Logout y revocación | Central revoca; credenciales temporales destruidas; reabrir POS no recupera sesión revocada. Probar revocación administrativa aparte. |
| Red/expiración | Resultado conforme a políticas aprobadas; no ampliar vigencias desde cliente ni conceder dashboard sin autorización. |
| Licencia | Pago verificado → asignación → DeviceProof → capacidad firmada → gate de la caja real; adicional no pagada rechazada, expiración y revocación persistentes. |

El ejecutor humano firma el registro sólo después de observar los resultados.
Software WebAuthn virtual, fixtures y pruebas unitarias nunca certifican esa tabla.

## Servicios externos

FACTUS Pay y facturación electrónica conservan custodias y autoridades distintas.
Pay exige merchant/integration/account real SANDBOX y token vigente en el archivo
usado por ManagedFactusPayCredentials; primero consulta GET de una referencia
autorizada. No ejecutar POST /auth por rutina ni crear recaudo sin cotización y
políticas aprobadas. La [consulta oficial](https://pay-developers.factus.com.co/recaudos/ver/)
es por reference_code; la [creación](https://pay-developers.factus.com.co/recaudos/crear/)
usa importe en COP, hasta dos decimales y referencia idempotente.

FACTUS V2: conservar la evidencia histórica OAuth/rangos. Las cuatro variables
FACTUS_SANDBOX_* están ausentes aquí. No utilizar un secreto compartido antes de
su rotación ni emitir documentos fiscales de ventas en esta misión. Que exista
una cuenta sandbox no sustituye credenciales rotadas, permisos y empresa fiscal.
Correo: no montar un proveedor o remitente no seleccionado/autorizado.

## Datos no secretos que debe entregar el operador

| Bloqueo | Configuración concreta | Dato a entregar | Prueba auténtica de cierre |
|---|---|---|---|
| VPS/TLS | Variables CENTRAL_* y archivos TLS | Proveedor, SO, IP, URL autorizada, responsable, ambiente | TLS desde Windows, CA/hostname correctos y readiness del destino real. |
| PostgreSQL | CENTRAL_DATABASE_URL y runner | Base/host, responsable, manifiesto y timeouts aprobados; sin contraseña | Ledger real, rol mínimo y runner idempotente en base autorizada. |
| Raíces/operacionales | Provisiones SSA/SAS/LICENSE/DEV-003 | Key IDs, propósito, ambiente, fingerprints públicos y custodio | Cadena/pins auténticos, firma/correspondencia y revocación verificadas. |
| Identidad/dispositivo | Identity, organization y device_registry | Empresa/sucursal y IDs públicos de usuario/instalación/dispositivo, tipo de autenticador | Ceremonia física y recorrido Windows de la tabla anterior. |
| Fiscal/soporte | Política confiable de SubscriptionQuotes y referencias aprobadas | Tratamiento tributario, precio con/sin impuesto, términos y responsable fiscal | Cotización real aceptada, sin default tributario ni cambios retroactivos. |
| Pay | Provisión collections y custodia managed | Cuenta receptora, integration/account IDs, ambiente y referencia sandbox autorizada | GET oficial autenticado correlacionado; recaudo controlado sólo tras autorización. |
| Facturación | Custodia fiscal/configuración/num. | Emisor verificado, entorno, numeración y confirmación de rotación del secreto | Permisos/OAuth/rangos con credencial vigente; emisión sólo en misión autorizada. |
| Correo | Futuro montaje Notifications | Proveedor, remitente verificado, buzón autorizado y responsable | Entrega observada con ID del proveedor y estados independientes. |

Producción, certificación humana y CI siguen BLOQUEADOS hasta su evidencia real.

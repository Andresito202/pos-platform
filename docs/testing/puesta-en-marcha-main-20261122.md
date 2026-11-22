# Puesta en marcha comercial desde main — 2026-11-22

## A. Git y protección

PR [#115](https://github.com/Andresito202/pos-platform/pull/115) MERGED el 2026-11-21. Se refrescó origin/main y se comprobó baa5fd8568ebc3d080f7e474b0d986ff45f5dbc7, con padres f166b451 y 2b0ad709. Ambos árboles (merge y HEAD de PR) son dd37f222e1b16a518258c8d8cdcca42b53a39f26: no hay delta inesperado. Los cinco workflows post-merge finalizaron SUCCESS: TARGET foundation 44938353067 (incluido Main push governance), CodeQL 44938353087, Central Sync 44938353089, D-3 44938353204 y G1.2 44938353116. FACTUS excepcional permaneció SKIPPED.

El checkout Windows pasó de la rama Codex a main mediante switch y pull --ff-only. No había modificaciones rastreadas. Los 19 archivos no rastreados conservaron su SHA-256; permanecen .claude-desactivado/, Android/native y data/. No se borraron datos, refs o respaldos. El propietario autorizó una excepción exclusiva para publicar esta reconciliación documental mediante la rama existente y otra PR; no autoriza desarrollo paralelo ni cambios directos a main.

## B. PostgreSQL

**EXISTE Y ES VÁLIDO, alcance limitado:** servicio postgresql-x64-16 Running/Auto, ejecutable nativo PG16 y PG_VERSION=16, proceso escuchando en 5432. La negociación PostgreSQL SSLRequest seguida por TLSv1.3 verificó localhost usando explícitamente el certificado existente server.crt como ancla; rejectUnauthorized=true. No hubo autenticación SQL. No demuestra confianza instalada en clientes, identidad de base, minor version, grants o RLS.

**NO SE PUDO VERIFICAR:** camacho_pos, pos_platform_app, roles administrativos/migrador, ledger/checksums 029–032, historia del backfill, grants/FORCE RLS y estado de 033. No existe conexión autorizada disponible en los perfiles inspeccionados. CENTRAL_DATABASE_URL y POSTGRES_MIGRATOR_URL no están en Process/User/Machine. No hay perfil PostgreSQL en AppData/Roaming. El pgpass legítimo encontrado bajo LocalAppData/CamachoPOS/preprod corresponde a 55435 y otra base: no se reutilizó, ni se mostró su contenido. No se probaron contraseñas ni se usó superusuario.

**Respaldos:** existen respaldos de código en C:/Respaldos/CamachoPOS y una copia SQLite pre-migración bajo local-operator-runtime/data/backups. Los dos SQL encontrados en el respaldo de código son los artefactos up/down de 033, no un dump de camacho_pos. No se localizó un respaldo PostgreSQL comercial verificable en las ubicaciones inspeccionadas; su ausencia global no se presume. Falta identificarlo y validar restaurabilidad antes de una mutación comercial.

El manifiesto oficial se obtuvo sin conexión ni ejecución SQL:

```powershell
pnpm --filter @pos-platform/target-migrations postgres:commercial:apply --cash-register-bindings --manifest
```

033_cash_register_license_bindings SHA-256: `1e70c77482520017f192d93af835dd2ec555ccb697b32d0dcbcbda978771eda9`.

**No se aplicó 033.** Desbloqueo: el responsable de base habilita por canal seguro acceso TLS verify-full a camacho_pos:5432 con perfil de lectura para inspección; acredita respaldo y reconcilia cualquier maestro faltante, varias licencias por caja o historia de pagos/quote incompatible. Después, un perfil pos_migrator autorizado usa la CLI existente con POSTGRES_EXPECTED_DATABASE=camacho_pos, REPOSITORY_COMMIT verificado y timeouts explícitos, únicamente --cash-register-bindings. Validar primero checksums 029–032 y predecessor 032; no reaplicar historia. Confirmar después ledger/checksum 033, FK caja-licencia, reserva, grants y FORCE RLS. La CLI no se ejecuta en modo aplicación hasta satisfacer estos requisitos. No se contactó 55433 ni el contenedor de pruebas.

## C. Central / GLOBAL / BUSINESS / licencias

**EXISTE PERO REQUIERE CONFIGURACIÓN:** LocalAppData/CamachoPOS/central-runtime contiene certificado, clave TLS, token de enrolamiento y clave de emisor. Se inspeccionó metadata y certificado público; no se mostraron secretos. El certificado está vigente, autofirmado y limitado a localhost/127.0.0.1. No acredita un origen comercial ni autorización de las claves existentes. validateCommercialHttpsOrigin rechaza localhost; no se lo elude.

**NO EXISTE en las ubicaciones inspeccionadas:** provisión comercial GLOBAL y BUSINESS. La única provisión de capacidad encontrada está dentro de design-review-runtime; se preservó y no se trasladó a producción. No se presume una inexistencia en todo el equipo. No hay CENTRAL_* de conexión, TLS, origen o provisión en los ámbitos Process/User/Machine, perfiles PowerShell y configuración VS Code inspeccionados. No hay servicio Central registrado ni proceso Node identificado con su entrada original; no hay listener en 443/8443.

**Bloqueo exacto:** faltan una conexión runtime pos_platform_app validada y origen HTTPS autorizado con cadena de confianza y clave correspondientes; además provisiones GLOBAL/BUSINESS/licencias compatibles con sus esquemas, checksums (incluido 033), verificadores, RP/WebAuthn, materiales legítimos de firma, enrolamiento y trust de sesiones. Las claves existentes no se adoptan por mera presencia. El responsable debe proporcionar/configurar esos archivos mediante canal seguro. No se crean credenciales, identidades, claves ni certificados provisionales.

Solo después: entrada original `pnpm --filter @pos-platform/central-authority start`, observación de proceso y /health con TLS confiable, rutas /platform/, /business/ y /v1/business/, MFA humano, autoridad GLOBAL separada, motor de licencias y negativos. El estado de /health no acredita operación empresarial.

## D. Windows y artefactos

**EXISTE PERO REQUIERE CONFIGURACIÓN:** PosLocalService Stopped/Disabled bajo .\\Usuario y binario apps/pos-local-service/.lab-state/service/pos-local-service.exe. Sin provisión comercial en el entorno registrado. No se habilitó ni modificó. No se instaló CamachoPOSLocalService.

**Bloqueo independiente demostrado en código:** windows-service-descriptor.ts rechaza commercialLogin/POS_WINDOWS_COMMERCIAL_PROVISION_FILE; main.ts llama assertWindowsScmCommercialCertification ante windows_scm_handoff_file; esta función lanza SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN. El instalador WinSW existente conserva ese gate, defaults de laboratorio y separación DPAPI CurrentUser/NT SERVICE. Configurar la base no lo resuelve. Hace falta materializar y verificar el handoff comercial entre identidades mediante el procedimiento existente; no cambiar un booleano ni retirar el gate para arrancar.

**Datos preservados:** local-operator-runtime contiene SQLite/WAL, backup pre-migración, installation.json y materiales DPAPI/canal. Su presencia no acredita autorización BUSINESS ni permite convertirlos en provisión comercial. No se abrieron para escritura ni se cambiaron claves/ACL.

**Artefactos preparados:** Electron instalado y build oficial `pnpm --filter @pos-platform/pos-desktop build` PASS sobre baa5fd85. Main, entry, preload y renderer originales generados; recursos de login/logo presentes. Dos advertencias PURE de Zod, sin fallo. Los 70 archivos del dist anterior se copiaron y verificaron SHA-256 en C:/Respaldos/CamachoPOS/arranque-main-20261122/desktop-dist antes del build. No se arrancó Electron porque no hay provisión/canal comercial validado; no se abrió Role Preview, Design Review ni otro POS.

## E. Operaciones reales

Ninguna operación comercial nueva se acreditó desde la interfaz en esta ejecución. Permanecen pendientes login humano, cuatro roles y negativos, aislamiento empresa/sucursal, administrar cajas, seleccionar/vincular licencia, distribución firmada, turno/venta/cobro y revocación. No se introdujeron datos ficticios. Hardware, FACTUS y FACTUS Pay se conservan para pruebas posteriores del propietario.

## F. Acciones de desbloqueo

1. Responsable de PostgreSQL: perfil de lectura autorizado camacho_pos:5432 con TLS y respaldo restaurable; después migrador autorizado para 033 según preflight.
2. Responsable de Central: origen/certificado comercial confiable y provisiones legítimas GLOBAL/BUSINESS/licencias/enrolamiento/WebAuthn/trust compatibles con el esquema.
3. Frente Windows existente: resolver y demostrar el handoff SCM comercial entre identidad de servicio y usuario, conservando DPAPI, ACL, SQLite y gate fail-closed; instalar por el procedimiento oficial con IDs reales. No activar el servicio .lab-state.

## G. Evidencia y límites

Nuevas ejecuciones: inspección Git y CI post-merge; hashes de preservación; inventario acotado de servicios/configuraciones/artefactos y respaldos; handshake TLS de PostgreSQL sin SQL; manifiesto 033; respaldo de compilados y build oficial desktop; diff documental revisado y git apply --check. No se repitieron suites acreditadas de 2b0ad709. Se reutiliza su evidencia de CI y el informe business-cash-consolidation-20261121.md, distinguiendo dobles de PostgreSQL aislado. Ninguna prueba aislada acredita camacho_pos ni el runtime comercial Windows. La misión no está operativa ni terminada en su criterio comercial.

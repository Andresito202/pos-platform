# Auditoría cruzada de login P0 y cobros QR — 2026-11-08

**Fuente:** inspección de código GitHub de PR #99 (`2d9b560a6a70c240f8af58614e616f586a42d5cf` antes de este recibo) y PR #103 (`0e836491f73d074434eebb8ec60951e6da2f9544`), documentación versionada de ensayos Windows, y GitHub Actions QR #42454052518 (SUCCESS).

**No es certificación de producción.** Registro de estado para no perder el avance al pasar a roles, licencias, caché e inventario. No se modifican gates de seguridad, servicio Windows, pagos ni base de datos.

## 1. Interfaz QR: comprobar montaje antes de aceptar UX

- **Administración web Central:** `apps/central-authority/src/commercial-browser-entry.ts` contiene formulario de método, referencia, PNG, carga `upload`, borrador, `publish` y `revoke`; requiere sesión BUSINESS/MFA y `merchantAdminEnabled`. No está integrada como formulario dentro de Empresa/Configuración del escritorio.
- **Caja (corrección de auditoría):** `MerchantPaymentMethods.tsx` **sí estaba montado** en `components/SalePanel.tsx` dentro de la venta creada (línea 248 del SHA anterior), no en App directamente. Lee `payment.destination.get` con permiso `PAYMENTS_PAYMENT_READ`; muestra QR firmado de 320 px, llave y monto solicitado. Se retiró el botón ficticio «QR integrado» deshabilitado y se agregó una regresión desde SalePanel que verifica render, permisos y ausencia de confirmación de dinero. **CI QR-001/QR-002 SUCCESS:** run #42455293429, SHA `6cb6bf42697a226c907f0efbb4534e7b2a3229ff`. Falta aún E2E físico con Central/dispositivos/QR bancarios reales y capturas de GUI comercial; la cobertura automatizada no equivale a despliegue.
- **Avisos QR-002:** observaciones SMS no verificadas, importe/pagador si el texto los permite, sin asociación automática a venta y sin conciliación bancaria. La lectura es por polling, no prueba de push bancario ni tiempo real garantizado.
- **CI QR:** GitHub Actions #42454052518 ejecutó PostgreSQL 16.14, typechecks y suites focalizadas incluido 027 y revocación/ingestión: **SUCCESS** para `0e836491f73d074434eebb8ec60951e6da2f9544`. No implica despliegue, Android receptor real o banco.
- **Pendientes QR comerciales:** conflictos PR #103; Central provisionada y migraciones aplicadas en entorno autorizado; enrollment del teléfono y permiso del usuario, consentimiento administrado, pruebas de cuatro cajas/offline, QR originales y beneficiarios reales, respuesta ante revocación, verificación bancaria independiente. Las flags QR-002 siguen off.

## 2. Login Windows P0 — diferenciación rigurosa

- PR #99 sigue **Draft**. Las pruebas de módulos y los informes históricos no certifican el candidato final.
- **G1 físico subcontrol:** `docs/testing/windows-login-lab-peer-token-2026-11-03.md` registra pruebas de SCM Service y Desktop nativos, incluida repetición Electron 1/1 en cada rol con named pipe real, token peer del OS, pin firmante, MAC. **Aprobado en ese runtime/identidades**, NO en el inicio comercial completo.
- **G2 de transporte subcontrol:** el mismo ensayo prueba 2 operaciones, lease/replay, revocación y cierre de sockets. **No equivale a G2 BUSINESS**, sesiones, permisos o refresh.
- **Bloqueo explícito de código:** `apps/pos-local-service/src/security/windows-commercial-host-identity.ts:assertWindowsScmCommercialCertification()` arroja siempre `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`; `apps/pos-local-service/src/main.ts` lo invoca antes de cargar provisión SCM. `windows-service-descriptor.ts` también prohíbe `commercialLogin`. No retirar ni eludir estos gates sin evidencia del binding comercial exacto y revisión de seguridad.
- **Última evidencia VM:** `docs/testing/windows-lab-commercial-live-prerequisites-2026-11-04.md`: la inspección V2 ya confirmó PostgreSQL/TLS y contexto humano activo; la identidad device UUIDv7 del Service **no está registrada en Central**, el par comercial SCM no coincide y falta provisión BUSINESS. El nuevo operador `tools/operators/windows-scm-commercial-binding.ps1` está codificado con pruebas unitarias pero su ejecución real queda pendiente. **No repetir el enrolamiento humano/MFA ya efectuado por reflejo**; revisar su recibo y vigencia antes de decidir si se requiere otra intervención.
- **P0 aún no certificado:** 1) ejecutar binding comercial v7 en VM, confirmar ACL/custodia/pins sin tocar arnés v4; 2) ejecutar G1/G2 con ese par y entradas reales; 3) enrolar DEV-003 Service con desafío fresco/posesión y registrar identidad v7 en Central sin claves expuestas; 4) crear/verificar provisión BUSINESS exacta y distribución SSA/SAS; 5) revisar con evidencia el cambio mínimo que sustituya el gate SCM, conservando denegación fail-closed; 6) recorrer humano BUSINESS contraseña/UV/PKCE→SSA/SAS→RBAC→dashboard por roles, expiración/refresh, cierre/revocación y recuperación con servicio real; 7) validar GLOBAL independiente; 8) completar pruebas Windows/SQL físicas y evidencias SHA/ACL/servicio, firmar dictamen.
- **No asumir** que un login de navegador aislado, MFA registrada o unas pruebas de canal equivalen a login comercial SCM funcional. No ejecutar comandos de VM desde host sin acceso/autorización.

## 3. Orden operativo para desbloquear funcionalidades

1. Mantener PR #99 y PR #103 aislados; resolver solo los bloques concretos. Certificar G1/G2 comercial de la identidad v7 antes de destapar el gate.
2. Completar Central/DEV-003/SSA/SAS y un único camino feliz BUSINESS real; realizar inmediatamente negativos de tenant, rol, sesión expirada, logout/revoke y fallo de red. No inventar usuarios, claves ni dispositivos.
3. Ya con login acreditado, validar permisos reales de Cajero, Supervisor, Administrador y Superadministrador; continuar licencias/caducidad/offline, caché/snapshot e importación masiva de inventario como frentes independientes, sin confundir el cierre de login con certificación de todo el POS.
4. QR pendiente independiente: montar componente de cobro en Caja si hay ruta/autorización concreta, conectar configuración administrativa con experiencia de negocio aprobada y realizar E2E en entorno real; sin autocierre de ventas por SMS.

## Criterios de salida

- **Login P0 = CERTIFICADO** solo con pruebas físicas firmadas de Service+Electron+Central+cuenta/rol/tenant legítimos sobre el commit exacto, incluyendo negativos, refresh, revocación, logout y recuperación. No alcanza con tests mock.
- **QR-002 automatizado = PASS** para el SHA citado; **comercial = PENDIENTE** hasta captura/consentimiento/conciliación reales y despliegue controlado.
- **Cajero QR visual = MONTADO Y AUTOMATIZADO (run #42455293429)**; pendiente de E2E físico comercial y validación de QR bancario real.

## 4. CI Windows P0 ejecutada — 2026-11-08

- **SHA probado:** `7a415f4217aef8687914a9e8ebe1d83a2a631a14` (PR #99).
- **GitHub Actions:** [Windows login P0 isolated validation #42456761732](https://github.com/Andresito202/pos-platform/actions/runs/42456761732): **SUCCESS** en runner `windows-2022`; 202 PASS, 2 SKIP, 0 FAIL, typechecks contratos/canal/Local Service/Central/Desktop PASS.
- Pruebas de servicio: 57 PASS; canal: 19 PASS/1 SKIP; handoff firmado: 23 PASS/1 SKIP; Central: 50 PASS; Electron: 53 PASS. Un test de receiver Windows físico fue excluido explícitamente del workflow hospedado porque exige custodia e identidad SCM de laboratorio autorizadas; no se declaró que haya pasado.
- El inspector `tools/operators/windows-winsw-readiness.ps1` **conserva su política de producción original** tras revertir una regresión durante depuración. La suite exige que la falta de ACL/firma/versionado no habilite WinSW comercial.
- Este PASS solo certifica los componentes seleccionados bajo Windows CI y el comportamiento de rechazo seguro; **no** prueba servicio WinSW real, clave DPAPI del token virtual, binding comercial UUIDv7, DEV-003, Central desplegada, contraseña/UV/PKCE humanos ni sesión BUSINESS/GLOBAL hasta el dashboard.
- El rechazo `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` permanece incondicional en la entrada comercial. Para retirarlo se necesitan evidencia física del par comercial y revisión mínima de seguridad antes de aprobar un cambio. No modificar el gate por obtener CI verde.
- **Continuidad QR:** ejecución [#42455293429](https://github.com/Andresito202/pos-platform/actions/runs/42455293429) en SHA `6cb6bf42697a226c907f0efbb4534e7b2a3229ff`: SUCCESS de la integración de Caja y migraciones, sin despliegue comercial.

### Siguiente aceptación obligatoria

1. Ejecutar en VM Windows Server 2022 la vinculación comercial SCM del dispositivo UUIDv7 con hashes y ACL verificadas.
2. Probar físicamente ambas identidades SERVICE/DESKTOP y propiedades G1/G2 en ese vínculo; sin fixtures ni host equivocado.
3. Registrar DEV-003 con posesión actual y provisión BUSINESS en Central, verificar SSA/SAS.
4. Tras la revisión del gate SCM, ejecutar el inicio completo BUSINESS, roles/tenants, expiración, renovación, logout y revocación y el flujo GLOBAL separado.
5. Registrar evidencia exacta de commit, OS, identidades, recibos y 0 skips en las pruebas físicas exigidas; mantener PR Draft hasta entonces.

## 5. Ejecución independiente de frentes P0 — GitHub Actions #42457375454

- **Commit exacto ejecutado:** `ab9810afe07a9574ac2346fbf141842b517e99db`.
- **Resultado CI final: SUCCESS, tres jobs concurrentes y sin fallos:** (1) `login-p0` en `windows-2022`, (2) `commercial-binding-contracts` en Ubuntu y (3) `device-business-contracts` en Ubuntu.
- [Evidencia](https://github.com/Andresito202/pos-platform/actions/runs/42457375454): tres conclusiones `success`; pruebas de binding/publicación UUIDv7 en runner aislado: 7 + 9 + 12 PASS.
- `login-p0` repite TypeScript, protección de identidad SCM/DPAPI/leases, handoff, Central y Electron; no instala WinSW ni conecta una sesión BUSINESS real.
- `device-business-contracts` valida implementación DEV-003 y contratos de inicio de sesión/SSA con fixtures, no registra la identidad del servicio en Central ni crea provisión de producción.
- Las validaciones 1 (binding nativo real), 2 (SCM↔Electron con identidad comercial UUIDv7), 3 (DEV-003 y provisión BUSINESS real), 4 (desbloqueo revisado de gate SCM) y 5 (login humano con dashboard, refresh, logout y revocación) siguen **PENDIENTES de ejecución física/autoridad de Central en la VM**. No se ejecutaron ni fueron marcadas como PASS por las pruebas del runner.
- Las fases 1→2→3→4→5 tienen dependencias causales: pueden prepararse y probar sus unidades en paralelo, pero **no certificarse simultáneamente de forma independiente**. Cada evidencia depende del control de identidad y del aprovisionamiento anterior.
- El gate `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` y el estado Draft del PR #99 siguen activos; no se modificó el runtime de producción durante este incremento.

## 6. Ampliación de evidencia sin PC — 2026-11-08

**GitHub Actions #42457877871: SUCCESS en cuatro jobs**, HEAD probado `a08fc8e9395c4284bce6bf7e7e4feeb2dcee0be0`. Se añadió PostgreSQL 16.14 en contenedor efímero aislado, para la prueba `native-authorization-full-composition-physical.test.ts`: **5 PASS, 0 FAIL**, incluyendo callback PKCE, consumo de código de un solo uso y concurrencia; el servicio PostgreSQL fue realmente iniciado por CI. Los jobs Windows P0, DEV-003/BUSINESS (fixtures) y binding UUIDv7 (contratos) también concluyeron `success`.

**Límite innegociable:** los cinco gates de certificación comercial física siguen SIN CERTIFICAR porque el runner no es la VM Hyper-V original, no conoce su DeviceIdentity ni los secretos DPAPI, no ha iniciado el Service bajo la cuenta `NT SERVICE\CamachoPOSLocalService` de ese laboratorio, ni ha registrado DEV-003 de esa identidad en Central. Un runner hospedado no puede acreditar posesión de una clave que no posee. La sesión humana MFA histórica no se repite por defecto y tampoco se presenta como sesión BUSINESS actual.

El inspector de servicio permanece fail-closed; no se ha eliminado `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`, creado/registrado dispositivo, desplegado Central ni fusionado PR #99. No adjudicar a CI el cierre de los gates físicos.

## 7. Alternativa sin PC: Windows Server 2022 hospedado con DPAPI real

[GitHub Actions #42459348643](https://github.com/Andresito202/pos-platform/actions/runs/42459348643) sobre commit `6a90cda52b4d9889bf42f98347dd163855500712`: **SUCCESS en cinco jobs**.

- Login P0 Windows: TypeScript, transporte/leases, Central y Electron en entorno aislado: PASS.
- Receptor nativo DPAPI de Windows real: **1 PASS y 23 SKIP** en la ejecución focalizada `windows-handoff.test.ts -t "real Windows receiver:"`. Comprueba token interactivo, ACL de propietario, DPAPI CurrentUser, denegación de sobrescritura/contexto equivocado y alteraciones.
- UUIDv7 SCM/provisión BUSINESS: contratos PASS, sin instalar un servicio.
- DEV-003/BUSINESS: contratos PASS, sin registro real de dispositivo.
- OAuth/PKCE con PostgreSQL 16.14 efímero: PASS, 5 pruebas.

**Ajuste verificable:** `packages/local-channel/src/windows-handoff-native.ts` importa explícitamente `Microsoft.PowerShell.Security`. El runner prepara `PSModulePath` Windows y ejecuta el test desde PowerShell 5.1. No cambia autorización, ACL, identidades o reglas de negación.

**NO está acreditado:** la cuenta virtual SCM de la VM original, sus claves DPAPI y DeviceIdentity UUIDv7 existentes, el handshake comercial real SERVICE↔DESKTOP con esa identidad, inscripción DEV-003 en Central autorizada, retiro del gate SCM, ni un recorrido BUSINESS humano hasta Caja, refresh, logout y revocación.

**Alternativa para una futura certificación de artefacto sin PC:** aprovisionar automáticamente un laboratorio nuevo y desechable en Windows Server 2022 con wrapper WinSW aprobado, dos identidades OS reales, claves nuevas, Central aislada y pruebas E2E. Eso certificaría una instalación nueva, **no** la provisión privada preexistente del equipo. La implementación E2E del laboratorio nuevo sigue pendiente. Mantener el PR Draft y `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` activo.

## 8. CI real de servicio SCM virtual y addon Windows — sin PC

**Addon nativo:** [GitHub Actions #42459742604](https://github.com/Andresito202/pos-platform/actions/runs/42459742604), commit `0a9ddd4fbca7676b9e06e7edfdd4029e91fa0761`, **SUCCESS**. Compiló `camacho_windows_pipe.node` Windows x64 y superó carga y rechazo de suplantación de cuenta SCM en los procesos Node y Electron. No abrió una conexión comercial SERVICE↔DESKTOP.

**Servicio real separado:** [GitHub Actions #42460107925](https://github.com/Andresito202/pos-platform/actions/runs/42460107925), commit `8b07579819be0c6ad28446cf69ca19c88f90d7b9`, **SUCCESS** sobre Windows Server 2022, con recibos:
- `SCM_VIRTUAL_ACCOUNT_REAL=PASS`
- `SCM_SERVICE_SESSION_0=PASS`
- `SCM_SERVICE_DPAPI_CURRENTUSER=PASS`
- `DESKTOP_DPAPI_CROSS_IDENTITY_DENIED=PASS`
- `COMMERCIAL_SCM_ELECTRON_HANDSHAKE=NOT_TESTED`

El servicio **es un probe separado compilado en la VM de Actions**, no el ejecutable comercial Camacho ni WinSW. Se instala de forma desechable y se solicita su eliminación al terminar. La prueba nunca usa claves, usuarios o archivos de la VM del propietario.

**Certificación parcial acreditada:** capacidad de hospedar cuenta de servicio virtual real, control de sesión 0, custodia DPAPI y separación criptográfica de identidades; compilación nativa Windows con smoketests Node/Electron.

**Pendientes para certificar una instalación comercial sin PC:** (1) probar canal nativo `WindowsScmChannelTransport` ↔ `connectWindowsScmClient` en el servicio real, con manifiestos y claves administradas por cada SID; (2) reemplazar el servicio probe por el envoltorio comercial WinSW firmado y verificado; (3) hacer DEV-003 en Central desechable con autenticación BUSINESS y evidencias de posesión; (4) comprobar el gate SCM, la sesión comercial, RBAC, refresh, logout y revoke. No está acreditado E2E ni autorización de producción, y PR #99 debe permanecer Draft hasta cumplirlos.

## 9. CI G1 nativo SCM ↔ escritorio con usuario temporal — diagnóstico 2026-11-08

**No certificado / gate permanece activo.** El trabajo más reciente de Actions crea una cuenta Windows local desechable con token interactivo verdadero, SID `S-1-5-5-*` consultado con `whoami /logonid`, sesión OS > 0, ACL mínimas en el laboratorio, y conserva la identidad virtual `NT SERVICE\\CamachoPOSLocalService` en sesión 0. No usa SID inventado ni altera la VM original.

- Evidencia de token interactivo temporal real: [run #42461678633](https://github.com/Andresito202/pos-platform/actions/runs/42461678633): **SUCCESS**, un SID de logon auténtico (sin divulgarlo) y token interactivo.
- La compilación de `camacho_windows_pipe.node`, carga Node/Electron y rechazo de suplantación aprobaron de nuevo.
- Intento integrado G1 [run #42462137074](https://github.com/Andresito202/pos-platform/actions/runs/42462137074) sobre SHA `ae0e69e5f2ba19e915219a65d4d8c9659fd6d4af`: **FAILURE** en el paso de enlace nativo, con recibo de fallo `G1_NATIVE_DESKTOP_FAIL_PHASE=DESKTOP_CONNECT`. El listener SCM ya estaba disponible, pero el cliente no completó `native.connect`; **no** se generaron los dos recibos de éxito. No se debe interpretar como G1 aprobado ni sustituir con un fixture.
- El probe de DPAPI, servicio virtual sesión 0 y separación de identidades previamente certificado sigue válido para su alcance específico; la nueva batería G1 no pasó.
- Cambios CI: `tools/operators/ci-windows-scm-native-peer.mjs`, `ci-windows-scm-identity-service.ps1`, y prueba de inicio de sesión local desechable. La limpieza solicita terminar el cliente, borrar la cuenta y el servicio en finally. La rama sigue en Draft.
- Diagnóstico siguiente: distinguir fallo de política DACL/named pipe versus la atestación kernel del proceso servidor mediante medición CI acotada, sin exponer SID/DPAPI. Repetir sobre el commit corregido y exigir `G1_NATIVE_SCM_TO_INTERACTIVE_IDENTITY=PASS`, `G1_NATIVE_PEER_RECHECK=PASS` y ambos recibos. Revisar compatibilidad de cliente con Electron real (en esta prueba el lado Desktop corre Node). Después G2, DEV-003 real en Central y recorrido BUSINESS antes de cualquier retiro de `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`.
- Este intento **no** desbloquea la ruta comercial, no enlaza DEV-003 ni certifica los roles o MFA del usuario. PR #99 no debe fusionarse como certificado.


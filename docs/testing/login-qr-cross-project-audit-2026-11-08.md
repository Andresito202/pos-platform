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

# Dependencias precisas para cobro y activación de licencias

La publicación de ofertas/precios está implementada en 5352ddc9. SQL 017 se
registró en e32011b6 y el gate local de capacidad en 72568f93. Esta lista
delimita lo todavía no implementado y sus contratos; no autoriza activar ofertas,
credenciales, permisos o precios productivos por copiar un ejemplo.

| Dependencia | Estado real / resolución propuesta |
|---|---|
| Administración | Montaje GLOBAL HTTPS opt-in implementado y probado con contraseña/WebAuthn, cookie opaca canónica, CSRF, abuso durable y permisos reales. Endpoints de planes/precios llegan a SQL. Falta hospedar/conectar el panel existente a ese contexto, no convertir el bearer BUSINESS en GLOBAL. Ver licensing-global-runtime-2026-10-27.md. |
| Facturación de planes | 019 conserva cotizaciones inmutables y Payments 020 confirma dinero con API. Endpoint GLOBAL de cotización conectado al servicio, bloqueado sin política fiscal/soporte confiable. El montaje aún no tiene ese proveedor ni aceptación del cliente en superficie de producto. |
| Capacidad firmada | V2 y gate del Service verifican 1 + adicionales firmadas, asignaciones explícitas, binding, vigencia, versión y revocación antes de abrir caja. V1 no adquiere cupo. Falta el productor central que derive adicionales del pago confirmado, serialice asignaciones globales y distribuya el artefacto. El campo firmado no demuestra por sí solo que exista esa compra. |
| Soporte y términos | El propietario confirmó que no hay política fiscal/soporte definida. OPTIONAL_SAME_TERM sigue como candidato de borrador: falta impuestos aplicables, inclusión/exclusión en precio, vigencia y renovación del soporte PERPETUAL. No emitir cotización pagable con tasas o términos supuestos. |
| FACTUS Pay | 018 conserva ingreso autenticado. 020 verifica API y confirma Payments/outbox. Procesador opt-in montado en Central crea recaudos idempotentes para intenciones persistidas, guarda preparación sin pago y consulta GET separado; custodia vinculada releída por operación. Probado con PostgreSQL/HTTPS local, no proveedor real. Faltan datos auténticos y habilitación operativa. Webhook no activa licencias. |
| Datos auténticos | Faltan integración/binding de FACTUS Pay, credenciales custodiadas, URL HTTPS de callback y cuenta administradora autorizadas. Empresa/datos fiscales y contactos deben verificarse en su backend real; no se fabrican en fixtures ni se solicitan secretos por chat. |
| Activación | Pago confirmado → contrato en licensing.licenses/entitlements y outbox ya implementado/probado, exige GLOBAL LICENSE_ISSUE explícito y políticas aprobadas. Responde NOT_ACTIVATED. Falta asignación central de cajas, emisor/distribución de capacidad firmada y recepción Windows, conforme a reconciliación DEV-003 aprobada el 2026-10-27. |
| Factura y entrega | Faltan correlación fiscal y notificación transaccional. Pago, activación, emisión fiscal y entrega son estados separados con evidencia; no marcar enviado por haber generado un PDF ni pagado por un callback de navegador. |

No hay precios de producción sembrados. No hay endpoint administrativo inseguro,
cobro de prueba presentado como real, activación simulada, factura ni email
declarados enviados. SQL de ofertas ya está en el runner canónico mediante
--licensing; --factus-pay añade 018 con dependencia 003 verificada. El selector
de autenticación conserva 008–016. Las decisiones anteriores son específicas de
licenciamiento; no reabren las aprobaciones SAS/access/refresh o SQL de login.

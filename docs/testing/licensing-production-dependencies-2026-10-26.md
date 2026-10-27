# Dependencias precisas para cobro y activación de licencias

La publicación de ofertas/precios está implementada en 5352ddc9. SQL 017 se
registró en e32011b6 y el gate local de capacidad en 72568f93. Esta lista
delimita lo todavía no implementado y sus contratos; no autoriza activar ofertas,
credenciales, permisos o precios productivos por copiar un ejemplo.

| Dependencia | Estado real / resolución propuesta |
|---|---|
| Administración | El repositorio verifica GLOBAL/MFA y LICENSE_PLAN_MANAGE real. Falta conectar el transporte GLOBAL autenticado y el panel existente. No aceptar sessionId HTTP como credencial ni equiparar administrador BUSINESS con superadministrador. |
| Facturación de planes | Subscriptions posee cotizaciones y referencias de cobro. 019 y SubscriptionQuotes persisten precio/versiones/términos y referencia de recaudo inmutables, revalidando GLOBAL/MFA/grant; sin dependencia fiscal/soporte confiable, rechazan. Falta transporte de producto y coordinación con Payment canónico; no se declara cobro ni aceptación implementados. |
| Capacidad firmada | V2 y gate del Service verifican 1 + adicionales firmadas, asignaciones explícitas, binding, vigencia, versión y revocación antes de abrir caja. V1 no adquiere cupo. Falta el productor central que derive adicionales del pago confirmado, serialice asignaciones globales y distribuya el artefacto. El campo firmado no demuestra por sí solo que exista esa compra. |
| Soporte y términos | El propietario confirmó que no hay política fiscal/soporte definida. OPTIONAL_SAME_TERM sigue como candidato de borrador: falta impuestos aplicables, inclusión/exclusión en precio, vigencia y renovación del soporte PERPETUAL. No emitir cotización pagable con tasas o términos supuestos. |
| FACTUS Pay | Ingreso reconciliado de PR #93 como 018, sin tocar 009 WebAuthn: HTTPS opt-in, autenticación por hash, RLS, inbox/auditoría atómicos e idempotencia física. Falta confirmar mediante API y correlacionar referencia única, comercio receptor, comprador, importe y moneda con cotización/pago persistidos. El webhook no activa licencias. |
| Datos auténticos | Faltan integración/binding de FACTUS Pay, credenciales custodiadas, URL HTTPS de callback y cuenta administradora autorizadas. Empresa/datos fiscales y contactos deben verificarse en su backend real; no se fabrican en fixtures ni se solicitan secretos por chat. |
| Activación | Falta conectar evidencia de pago autoritativa → emisión/licencia/entitlements persistidos → artefacto firmado verificable → sincronización y cupo de cajas. No activar desde el checkbox, redirección del proveedor o resultado optimista de React. |
| Factura y entrega | Faltan correlación fiscal y notificación transaccional. Pago, activación, emisión fiscal y entrega son estados separados con evidencia; no marcar enviado por haber generado un PDF ni pagado por un callback de navegador. |

No hay precios de producción sembrados. No hay endpoint administrativo inseguro,
cobro de prueba presentado como real, activación simulada, factura ni email
declarados enviados. SQL de ofertas ya está en el runner canónico mediante
--licensing; --factus-pay añade 018 con dependencia 003 verificada. El selector
de autenticación conserva 008–016. Las decisiones anteriores son específicas de
licenciamiento; no reabren las aprobaciones SAS/access/refresh o SQL de login.

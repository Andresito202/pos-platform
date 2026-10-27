# Dependencias precisas para cobro y activación de licencias

La publicación de ofertas/precios está implementada en 5352ddc9. Esta lista
delimita lo todavía no implementado y sus contratos; no autoriza activar ofertas,
credenciales, permisos o precios productivos por copiar un ejemplo.

| Dependencia | Estado real / resolución propuesta |
|---|---|
| Administración | El repositorio verifica GLOBAL/MFA y LICENSE_PLAN_MANAGE real. Falta conectar el transporte GLOBAL autenticado y el panel existente. No aceptar sessionId HTTP como credencial ni equiparar administrador BUSINESS con superadministrador. |
| Facturación de planes | Subscriptions figura en module-map; data-ownership todavía no asigna sus agregados de cotización/cobro. Reconciliar ese owner antes de introducir persistencia comercial de suscripciones. Propuesta: Subscriptions posee oferta aceptada/cotización y referencias de cobro; Payments conserva confirmación monetaria; Licensing conserva derechos y firma. No crear otro Payment ni otro sistema de identidad. |
| Capacidad firmada | SignedLicense actual contiene flags de entitlements, no cantidad de cajas. La cantidad 1 + adicionales pagadas está probada en la oferta, pero aún no se transporta ni se aplica como límite firmado. Hace falta contrato versionado de capacidad, política legacy y enforcement en alta/activación de cajas antes de cobrar o prometer esa capacidad. No convertir device_id en una caja ni inferir límites ausentes. |
| Soporte y términos | OPTIONAL_SAME_TERM sólo se admite en borradores. Definir vigencia, renovación y qué significa soporte para PERPETUAL; no prometer soporte perpetuo ni una suscripción recurrente por inferencia. Publicar precios aprobados mediante nuevas versiones, sin sobrescribir historia. |
| FACTUS Pay | PR #93 Draft, delta histórico sin integrar: normaliza paid e inbox, pero no confirma pago canónico. Su migración 009 colisiona con 009 WebAuthn de esta línea. Reconciliar el delta específico/identificador/runner y correlacionar referencia única, tenant, importe y moneda con la cotización persistida. No fusionar su rama histórica ni tratar el webhook como activación. |
| Datos auténticos | Faltan integración/binding de FACTUS Pay, credenciales custodiadas, URL HTTPS de callback y cuenta administradora autorizadas. Empresa/datos fiscales y contactos deben verificarse en su backend real; no se fabrican en fixtures ni se solicitan secretos por chat. |
| Activación | Falta conectar evidencia de pago autoritativa → emisión/licencia/entitlements persistidos → artefacto firmado verificable → sincronización y cupo de cajas. No activar desde el checkbox, redirección del proveedor o resultado optimista de React. |
| Factura y entrega | Faltan correlación fiscal y notificación transaccional. Pago, activación, emisión fiscal y entrega son estados separados con evidencia; no marcar enviado por haber generado un PDF ni pagado por un callback de navegador. |

No hay precios de producción sembrados. No hay endpoint administrativo inseguro,
cobro de prueba presentado como real, activación simulada, factura ni email
declarados enviados. SQL de ofertas sigue como propuesta ensayada temporalmente,
fuera del runner de autenticación. Las decisiones anteriores son específicas de
licenciamiento; no reabren las aprobaciones SAS/access/refresh o SQL de login.

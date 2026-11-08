# Cotizaciones de suscripción — 019

Owner Subscriptions, conforme a data-ownership y solicitud del propietario de
2026-10-27. licensing.plans/plan_entitlements conservan catálogo y precios;
Payments conserva dinero; Licensing conserva derechos. No se añade un Payment
o License alternativo ni un estado conjunto pago/activación/factura/entrega.

subscriptions.license_quotes es evidencia inmutable de una oferta vigente:
comprador tenant/company y comercio receptor tenant/company/integration separados,
plan/version, snapshots de precios/features y términos, moneda/escala explícita,
importe calculado por backend, una caja incluida y adicionales cotizadas,
idempotencia, checksum, sesión/actor GLOBAL y vigencia. Una referencia de recaudo
única se genera en Central, separada del ID que trae la solicitud; no es prueba
de pago ni un token de acceso. No se asignan cajas o dispositivos desde la quote.

Sólo pos_platform_app SELECT/INSERT; sin UPDATE/DELETE/TRUNCATE y con triggers
append-only incluso para el owner. RLS forzada. Un rollback destructivo se niega
si hay evidencia. Runner existente --subscriptions añade 019 después de 018;
--licensing, --factus-pay y el manifiesto de autenticación no cambian su alcance.

Servicio interno, sin endpoint: el sessionId procede de transporte GLOBAL
autenticado, no de JSON/React. Revalida MFA/rol/grant LICENSE_PLAN_MANAGE real;
ese permiso permite cotizar el precio administrado, no confirmar pagos o emitir
licencias. La interfaz de términos es exclusivamente una dependencia confiable
del servidor; no se acepta como input de cliente. No hay implementación productiva
por defecto de esa dependencia: faltan política fiscal, soporte y verificación
de cliente auténticas. Un callback de prueba no constituye su aprobación.

No se calculan impuestos supuestos. Tax/contrato suministran resultado fiscal,
inclusión/exclusión del precio, escala monetaria, referencias de verificación y
ventanas de servicio/soporte/cotización explícitas. Si falta, se rechaza la
emisión. El soporte de perpetuo debe tener fin explícito cuando se selecciona;
la licencia perpetua no infiere soporte perpetuo. La validez mensual/anual la
define esa política, sin asumir días/renovaciones en este servicio.

Cotizar no es aceptar, cobrar, confirmar ni activar. Esas operaciones mantienen
owners, autoridad y evidencia independientes. No hay nueva autoridad de login.

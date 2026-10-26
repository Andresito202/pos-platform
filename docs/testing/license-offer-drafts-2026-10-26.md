# Licencias: borradores de precios backend

Después del cierre técnico Windows 85134b88. No altera el login ni las licencias
existentes. Es un incremento interno; no declara listo el panel comercial.

Reutiliza licensing.plans de 006 y el repositorio GLOBAL/MFA/permisos existente.
LicenseOfferDrafts persiste planes MONTHLY, ANNUAL y PERPETUAL en estado DRAFT.
Una caja incluida es obligatoria; adicionales y soporte se cotizan con importes
enteros leídos de PostgreSQL. Cada edición crea otra versión y mantiene la
anterior. Preview no acepta precios del cliente, calcula con BigInt y rechaza
overflow. No calcula impuestos ni inicia cobro/activación.

La operación requiere sesión GLOBAL previamente autenticada por el transporte y
el grant explícito LICENSE_PLAN_MANAGE, vigente en las tablas canónicas. Un UUID
por HTTP no autentica a nadie: no se ha montado un endpoint ni se permite usar
esta API interna desde React. No se crean permisos/grants/administradores en
producción. Se mantienen SERIALIZABLE, versión esperada y auditoría atómica; un
conflicto concurrente se devuelve, no se sobrescribe ni se reintenta a ciegas.

El delta SQL aditivo está en proposals/license_offer_pricing.up/down.sql:
columnas en la tabla existente, sin tablas de precios paralelas. Las filas legacy
quedan NULL y no reciben precios, capacidad ni soporte implícitos. Guard protege
precio por versión y down impide borrar historia. No está en el runner comercial
de autenticación ni se aplicó a bases persistentes; falta adopción de su contrato.
OPTIONAL_SAME_TERM es propuesta acotada de borrador, no aprobación de facturación
recurrente o soporte perpetuo. No se publicaron precios definitivos.

Prueba física temporal observada (license-offer-drafts-final.json): 1 escenario
integrado PASS, 0 FAIL, con versiones/replay, una caja y extras, mensual/anual/
perpetuo, rechazo sin grant y de BUSINESS, revocación del permiso, modificación
SQL directa denegada, concurrencia con un ganador, overflow, rollback de auditoría
y down con historial bloqueado. Cero licencias activadas. Fallos iniciales:
created_at ausente en fixture; alias de permiso importado incorrecto; down no
veía historial por forced RLS. Corregidos antes del PASS mediante lectura exclusiva
del schema owner, sin ampliar permisos de aplicación sobre RBAC.

Pendiente real: transporte autenticado GLOBAL/panel superadministrador, adopción
SQL, publicación de ofertas, impuestos/cotización comercial durable, confirmación
de cliente y verificaciones, correlación de pago, activación firmada Licensing,
factura y notificación con estados independientes. PR #93 sigue Draft sin merge:
su inbox FACTUS Pay aún no confirma un pago canónico. No se importa su rama ni se
inventa una confirmación para activar una licencia. El login humano permanece
sujeto al aprovisionamiento y certificación descritos en windows-login-closure.

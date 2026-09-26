# Documentos legales y de privacidad — Camacho POS Colombia

> **Estado: `DOCUMENTED`, BORRADOR.** Nada de esta carpeta está publicado ni aprobado por un
> abogado. Ningún texto se muestra hoy dentro del software. Antes de publicar hay que completar los
> campos `[PENDIENTE]` y pasar revisión legal.

Pedido por el propietario el 2026-09-26: política de privacidad, declaración de uso de
inteligencia artificial, borrado de datos a petición del usuario, términos y condiciones,
declaración de que se recopilan datos y lista de terceros que los reciben.

| Documento | Qué cubre |
|---|---|
| [`politica-tratamiento-datos.md`](politica-tratamiento-datos.md) | Política de privacidad (Ley 1581 de 2012 y Decreto 1377 de 2013), incluida la **declaración de qué datos se recopilan** |
| [`aviso-privacidad.md`](aviso-privacidad.md) | Aviso corto para mostrar donde se recogen datos, y modelo de aviso para el Comercio |
| [`terminos-y-condiciones.md`](terminos-y-condiciones.md) | Términos del servicio para el Comercio |
| [`declaracion-uso-ia.md`](declaracion-uso-ia.md) | Uso de IA: en el desarrollo sí; sobre datos personales, no |
| [`terceros-y-encargados.md`](terceros-y-encargados.md) | Terceros que reciben datos; **no se usa analítica** |
| [`derecho-supresion.md`](derecho-supresion.md) | Cómo se atiende una petición de borrado y sus límites legales |

## Lo que está hecho y lo que no

| Pieza | Estado |
|---|---|
| Textos borrador | `DOCUMENTED` |
| Citas legales | consultadas en fuentes oficiales el 2026-09-26; **sin revisión de abogado** |
| Revisión de abogado | no hecha |
| Mostrar aviso y pedir autorización en el software | **no existe** |
| Borrar o anonimizar datos de una persona | **no existe**; diseño pendiente en `DEC-027` |
| Exportar los datos de un Titular o de un Comercio | **no existe** |
| Marcar un registro como «reclamo en trámite» | **no existe** |

## Inventario de datos personales

Dónde vive cada dato personal según el repositorio, a la fecha. Es la base para diseñar la
supresión (`DEC-027`).

| Dato | Tabla | Evidencia |
|---|---|---|
| Correo, teléfono, nombre del usuario | `identity.users` (central) | `tools/target-migrations/sql/postgres/001_central_foundation.up.sql:28-34` |
| Verificador de contraseña, intentos, bloqueo | `identity.user_credentials` (central) | `001_central_foundation.up.sql:136` |
| Factor MFA | `identity.mfa_factors` (central) | `001_central_foundation.up.sql:158` |
| Sesión | `identity.sessions` (central); `local_session_assertion` (local) | `001_central_foundation.up.sql:257`; `packages/database-sqlite/src/local-database.ts:228` |
| IP y eventos de seguridad | `identity.security_events` (central, append-only) | `001_central_foundation.up.sql:307-316` |
| Auditoría de acciones | `audit.audit_events` (central); `local_operation_audit` (local); ambas append-only | `001_central_foundation.up.sql:438`; `local-database.ts:161` |
| Datos de la empresa y sedes | `organization.companies`, `organization.branches` | `001_central_foundation.up.sql:60-90` |
| Adquiriente / cliente del Comercio | `customers_customers` (local, sincronizado) | `local-database.ts:912-934` |
| Crédito del cliente | `customers_credit_accounts`, `customers_credit_transactions` | `local-database.ts:1468`, `:1499` |
| Cliente de la venta | `sales_sales.customer_id` | `local-database.ts:1412-1414` |
| Factura electrónica (incluye al adquiriente) | `fiscal_electronic_document.payload_json` (inmutable) | `local-database.ts:1684`, `:1756` |
| Correo del pagador por pasarela | pago Wompi, auditoría y outbox | `apps/pos-local-service/src/payments/wompi/wompi-transaction.ts:26` |

## Campos `[PENDIENTE]`

Datos del responsable (razón social, NIT, domicilio, correo, teléfono, área de protección de
datos) · modelo de contrato de transmisión Comercio–Plataforma · texto y mecanismo de autorización
en el alta de cuenta · aviso de autorización al registrar un cliente del Comercio · canal gratuito
de consultas y reclamos · procedimiento manual interno de reclamos y su responsable · plazos de
retención (credenciales retiradas, auditoría, datos al terminar el servicio, documentos fiscales,
vigencia de las bases) · proveedor de alojamiento y país, y calificación de
transferencia/transmisión internacional · país de procesamiento de Factus y de Wompi ·
procedimiento de notificación de incidentes · regla para adquirientes menores de edad ·
evaluación de obligación RNBD · fecha de vigencia y medio de publicación · validación legal de la
relación art. 8 lit. e Ley 1581 / art. 9 Decreto 1377 · regla interna de no compartir datos reales
con herramientas de IA · precios, SLA, límites de responsabilidad, preaviso, ley aplicable y
jurisdicción · fecha de inicio de la oferta comercial.

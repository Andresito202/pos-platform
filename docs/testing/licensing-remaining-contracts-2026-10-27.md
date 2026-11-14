# Decisiones concretas para conectar administración y activación

Cambios contractuales 1 y 2 aprobados expresamente por el propietario en esta
conversación el 2026-10-27: «Aprobar ambos cambios contractuales». La aprobación
no fija valores operativos ni aporta credenciales o infraestructura auténticas.
Continúa 6ea50268. La ejecución/evidencia se registra por incremento.

## Reconciliación necesaria

1. Administración: central-administration.ts define contexto GLOBAL interno y
   declara que no es API/bearer. El host HTTPS actual emite BUSINESS. Propuesta:
   extender ese mismo host con ceremonia GLOBAL separada, reutilizando contraseña
   y WebAuthn existentes; receipt MFA de un uso ligado a propósito GLOBAL,
   sesión en identity.sessions sin tenant/membership, cookie HTTPS opaca custodiada
   por servidor con CSRF/origen exacto y límites explícitos. Nunca elevar un
   bearer BUSINESS. Cada operación revalida MFA y permiso central actual. No
   crear segunda identidad, almacén de factores, roles o grants. RP, origen,
   vigencias y abuso serán configuración aprobada, no valores asumidos.
2. Activación: device-licensing-schema.md exige UUID/FK devices.device_keys y
   trusted signing keys; Central implementa DEV-003 en identity.device_registry /
   device_credentials con identificadores textuales de clave. Propuesta:
   reconciliar el contrato físico de activación con ese registro vigente,
   conservar licensing.licenses y entitlements y añadir sólo su activación
   canónica. Credencial exacta/instalación/empresa deben coincidir y estar
   vigentes bajo lock; nueva operación específica de DeviceProof, con nonce,
   propósito/ruta, consumo único y auditoría. No reutilizar firmas de login.
   Capacidad V2 no cambia: pago confirmado y asignación de cajas identificadas
   por Cash, nunca número de dispositivos. Una clave central autorizada para
   LICENSE debe proceder del trust real y custodia del operador, no generarse
   silenciosamente en runtime.

Amenazas a cerrar: elevación BUSINESS→GLOBAL, replay de MFA/cookies/códigos,
CSRF/confusión de origen, credencial reemplazada, activación para otra empresa,
reasignación concurrente de caja, firma con propósito equivocado y rollback de
versión. La aprobación de desarrollar no prueba estas propiedades ni aprueba
los valores operativos.

La regla de AGENTS.md exige reconciliar contradicciones antes de implementar.
La decisión expresa permite continuar estas dos extensiones sobre la línea
existente; no autoriza otra identidad, concesiones implícitas o producción.

## Datos externos que no sustituye una aprobación de código

- Fiscal/soporte: tratamiento tributario validado, precios con/sin impuestos,
  perfil fiscal por concepto, cliente fiscal verificado, períodos y condiciones
  de soporte (especialmente perpetuo), responsable y referencias versionadas.
- FACTUS: cuenta receptora/integración/credencial registrada, entorno y custodia
  real del access token con vencimiento. No compartir secretos en chat.
- Emisión: conexión/configuración fiscal y numeración autorizadas; consumidor
  del evento confirmado que produzca documento fiscal desde la cotización.
- Entrega: proveedor y remitente autorizados, contacto verificado, transporte
  custodiado y evidencia del proveedor. No existe montaje Central de correo.
- Central HTTPS/DEV-003 y claves de confianza auténticas para certificar destino.

## Estado que debe conservar la interfaz

Pago confirmado, licencia emitida/activada, factura aceptada y correo entregado
son hechos independientes. No mostrar éxito de una fase por éxito de otra. El
outbox financiero durable existente no demuestra consumidores de Licensing,
Fiscal o Notifications ejecutándose; esos montajes todavía requieren código.

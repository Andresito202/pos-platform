# Identidad, login y recuperación de contraseña

## Decisión materializada

La recuperación de contraseña pertenece a Identity/Central Authority. El POS local no replica credenciales centrales.

### Flujo de autoservicio

1. El usuario selecciona "¿Olvidaste tu contraseña?" desde el login.
2. Ingresa el correo registrado.
3. El backend responde de forma indistinguible exista o no la cuenta.
4. Si existe una cuenta elegible, Central Authority genera un token criptográficamente aleatorio, almacena únicamente su hash y envía un enlace HTTPS al correo registrado.
5. El enlace es de un solo uso, tiene expiración corta y queda invalidado al consumirlo, expirar o alcanzar el límite de intentos.
6. El usuario define y confirma una nueva contraseña.
7. La nueva contraseña se almacena como verifier derivado mediante KDF resistente a ataques offline; nunca se registra en logs, auditoría ni correo.
8. Se invalidan sesiones activas según la política de seguridad y se notifica el cambio al correo registrado.

### Recuperación asistida por Superadministrador

El Superadministrador no cambia ni conoce la contraseña.

Puede iniciar un proceso de recuperación asistida únicamente después de autenticarse con sus propios privilegios reforzados y dejar evidencia de la verificación de identidad del administrador del comercio. La acción genera el mismo flujo de recuperación por correo registrado. No existe una operación de "establecer contraseña" desde el panel administrativo.

La información usada para la verificación debe corresponder a datos de alta que ya reposan en Central Authority. No se deben crear preguntas basadas en información pública o fácilmente obtenible.

### Preguntas de seguridad

No se implementan como mecanismo único de recuperación. La guía de NIST considera el conocimiento basado en preguntas una forma de autenticación débil para este propósito; OWASP tampoco recomienda preguntas como único mecanismo. Si posteriormente se añade un segundo factor de recuperación, será complementario al enlace/código enviado al canal registrado.

### Roles y paneles

El login resuelve primero identidad; después la autorización resuelve el panel y las acciones:

- PLATFORM_OWNER: plataforma, comercios, licencias, planes y soporte autorizado.
- BILLING_ADMIN: planes, pagos, renovaciones y suscripción.
- SECURITY_ADMIN: seguridad, sesiones y revocaciones.
- SUPPORT_AGENT: soporte temporal y auditado.
- OWNER: empresa, sucursales, usuarios, seguridad y operación autorizada.
- GENERAL_ADMIN: administración delegada.
- demás roles: únicamente su alcance operativo.

Ocultar botones no constituye seguridad. Cada operación se valida en backend.

## Estado

MATERIALIZADO COMO FUNDACIÓN DE PERSISTENCIA — LOGIN Y DESPACHO DE CORREO AÚN REQUIEREN LA SIGUIENTE SUBFASE DE IDENTITY/CENTRAL AUTHORITY.

La migración 007_password_recovery añade la persistencia del proceso, con RLS forzado, token almacenado por hash, expiración, consumo único, límite de intentos y trazabilidad del actor que inicia el proceso.

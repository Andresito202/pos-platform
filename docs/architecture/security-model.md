# Modelo de seguridad

## Controles fundamentales

- autenticación segura;
- MFA para propietarios y administradores críticos;
- sesiones por dispositivo;
- tokens de corta duración;
- rotación y revocación;
- RBAC;
- ABAC;
- aislamiento multiempresa;
- aislamiento por sucursal;
- validación en backend;
- auditoría;
- rate limiting;
- protección contra IDOR y BOLA;
- cifrado de secretos;
- reautenticación para acciones sensibles;
- actualizaciones firmadas;
- licencias firmadas;
- logs sin secretos.

## Cambios críticos

Exigen protección reforzada:

- correo principal;
- teléfono;
- propietario;
- razón social;
- NIT;
- dirección principal;
- sucursales;
- QR de recaudo;
- cuenta bancaria;
- permisos administrativos;
- configuración fiscal;
- licencias;
- políticas de seguridad.

## Flujo requerido

Solicitar cambio
→ reautenticar
→ validar segundo factor
→ registrar motivo
→ aplicar cambio versionado
→ auditar
→ notificar al propietario

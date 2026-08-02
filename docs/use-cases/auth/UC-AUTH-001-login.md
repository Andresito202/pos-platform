# UC-AUTH-001: Iniciar sesión

## Actor principal

Usuario registrado.

## Precondiciones

- El usuario existe.
- La cuenta está activa.
- El tenant y la empresa están habilitados.
- El dispositivo cumple la política aplicable.

## Entrada

- identificador de usuario;
- contraseña o mecanismo de autenticación;
- identificador del dispositivo;
- segundo factor cuando corresponda.

## Flujo principal

1. El usuario envía sus credenciales.
2. El sistema valida el formato.
3. El sistema localiza la cuenta sin revelar si existe.
4. El sistema verifica la contraseña o credencial.
5. El sistema comprueba estado del usuario, tenant, empresa y licencia.
6. El sistema evalúa MFA y riesgo.
7. El usuario completa el segundo factor cuando aplique.
8. El sistema crea una sesión vinculada al dispositivo.
9. El sistema emite tokens de acceso y renovación.
10. El sistema registra auditoría.
11. La aplicación recibe el contexto autorizado.

## Flujos alternativos

### Credenciales inválidas

- Se responde con error genérico.
- Se incrementa el contador de intentos.
- Puede aplicarse espera progresiva o bloqueo temporal.

### Cuenta inactiva

- Se rechaza el acceso.
- Se registra el evento.

### Licencia restringida

- Se aplica el comportamiento definido por modalidad y periodo de gracia.

### Dispositivo no autorizado

- Se solicita registro o aprobación.

### MFA requerido

- No se crea sesión completa hasta validar el factor.

## Postcondiciones

- Existe una sesión revocable.
- El usuario recibe solo el contexto permitido.
- El acceso queda auditado.

## Seguridad

- No revelar existencia de cuentas.
- Rate limiting.
- Protección de credenciales.
- Tokens de corta duración.
- Refresh token rotativo.
- Revocación.
- Auditoría de IP y dispositivo.

## Pruebas mínimas

- login correcto;
- contraseña incorrecta;
- usuario inactivo;
- tenant suspendido;
- dispositivo revocado;
- MFA correcto e incorrecto;
- fuerza bruta;
- sesión revocada.

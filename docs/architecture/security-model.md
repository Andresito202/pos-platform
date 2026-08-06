# Modelo de seguridad

## Objetivo

Definir los controles transversales mínimos de seguridad para identidad, autorización, licencias, dispositivos, datos, operaciones críticas, soporte y actualizaciones.

Este documento resume principios generales.

Las políticas operativas detalladas de confianza de dispositivo, licencias firmadas, activación, gracia, revocación, recuperación y actualizaciones se definen en:

- `docs/adr/DEC-008-device-trust-license-activation.md`.

La sincronización local-first, autoridad por dato, idempotencia y recuperación operativa se definen en:

- `docs/adr/DEC-007-local-first-data-authority.md`.

## Controles fundamentales

- autenticación segura;
- MFA para propietarios y administradores críticos;
- sesiones por dispositivo;
- tokens de corta duración;
- rotación y revocación;
- RBAC;
- ABAC cuando exista una necesidad verificable;
- aislamiento por tenant;
- aislamiento por empresa;
- aislamiento por sucursal;
- validación autoritativa en backend;
- autorización explícita;
- auditoría append-only;
- rate limiting;
- protección contra IDOR y BOLA;
- cifrado de secretos;
- reautenticación para acciones sensibles;
- licencias firmadas;
- activaciones verificables;
- identidad criptográfica de dispositivo;
- almacenamiento protegido de claves locales;
- actualizaciones firmadas;
- validación de integridad;
- logs sin secretos;
- recuperación controlada;
- degradación segura.

## Principios de confianza

1. El cliente no es autoridad sobre licencias, derechos, revocaciones ni límites.
2. Las claves privadas centrales no residen en el POS.
3. El cliente valida artefactos mediante material público previamente confiable.
4. Una firma inválida produce rechazo.
5. Una clave desconocida no se acepta por fallback.
6. La identidad del dispositivo no depende exclusivamente de hardware.
7. El reloj local no constituye autoridad temporal absoluta.
8. La ausencia de conexión no crea derechos ni gracia.
9. Una revocación no elimina datos.
10. Una actualización no amplía licencias.
11. Una operación confirmada no se reescribe por cambios posteriores.
12. La disponibilidad no elimina controles de integridad o aislamiento.

## Aislamiento

Toda operación debe verificar, según corresponda:

- `tenant_id`;
- `company_id`;
- `branch_id`;
- actor;
- dispositivo;
- recurso;
- permiso;
- alcance.

Reglas:

1. Un tenant no accede a datos de otro.
2. Una empresa no accede a otra sin autorización explícita.
3. Una sucursal no amplía su alcance por datos enviados desde el cliente.
4. El backend vuelve a validar toda frontera.
5. Los identificadores no sustituyen autorización.
6. Los filtros del frontend no son controles de seguridad.

## Identidad y sesiones

Las sesiones deben:

- vincularse a un usuario autenticado;
- identificar dispositivo o cliente cuando corresponda;
- tener vigencia limitada;
- permitir revocación;
- registrar contexto;
- exigir reautenticación para acciones sensibles.

Una sesión válida no implica:

- licencia válida;
- activación válida;
- dispositivo confiable;
- permiso suficiente;
- acceso entre tenants.

## Licencias y dispositivos

Reglas generales:

1. La licencia es distinta de la activación.
2. La activación es distinta de la sesión.
3. El dispositivo tiene identidad operativa y criptográfica.
4. Los derechos se calculan a partir de artefactos verificables.
5. Una activación no amplía derechos.
6. Un dispositivo revocado no recupera confianza automáticamente.
7. La gracia debe estar autorizada.
8. La recuperación conserva trazabilidad.
9. La operación offline está limitada por política explícita.
10. `DEC-008` es la especificación normativa de este dominio.

## Claves y secretos

Las claves y secretos:

- se separan por ambiente;
- se separan por función cuando el riesgo lo justifica;
- no se incluyen en repositorios;
- no se registran en logs;
- requieren acceso mínimo;
- tienen rotación;
- tienen revocación;
- tienen recuperación o retiro controlado;
- deben conservar trazabilidad de uso.

Las claves privadas del dispositivo no se transmiten al servidor.

Las claves privadas centrales no se distribuyen a clientes.

## Actualizaciones

Toda actualización debe:

1. tener origen verificable;
2. validar firma e integridad;
3. validar plataforma y compatibilidad;
4. declarar versión;
5. declarar migraciones;
6. conservar evidencia;
7. impedir downgrade inseguro;
8. no borrar datos confirmados;
9. no reemplazar claves privadas locales;
10. permitir recuperación ante fallo.

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
- activaciones;
- dispositivos autorizados;
- claves confiables;
- políticas de seguridad;
- configuración de soporte;
- actualizaciones críticas.

## Flujo requerido para cambios críticos

Solicitar cambio
→ reautenticar
→ validar segundo factor
→ validar autorización y alcance
→ registrar motivo
→ aplicar cambio versionado
→ auditar
→ notificar al propietario cuando corresponda

## Soporte

El acceso de soporte debe ser:

- temporal;
- limitado;
- aprobado;
- auditado;
- revocable;
- asociado a un motivo.

Soporte no puede:

- emitir licencias fuera del servicio autorizado;
- modificar payloads firmados;
- eliminar revocaciones;
- borrar auditoría;
- acceder a otros tenants;
- extraer secretos.

## Logs y auditoría

Los logs técnicos:

- no contienen claves privadas;
- no contienen tokens reutilizables;
- no contienen secretos;
- aplican redacción;
- tienen retención explícita;
- se aíslan por ambiente.

La auditoría:

- es append-only;
- conserva actor, motivo y correlación;
- no se sustituye por logs técnicos;
- no se elimina mediante soporte;
- permite reconstruir decisiones críticas.

## Degradación segura

Ante incertidumbre, el sistema elige explícitamente entre:

- permitir;
- permitir con restricciones;
- denegar;
- requerir revisión.

Nunca debe:

- inventar derechos;
- ignorar firma inválida;
- aceptar claves desconocidas;
- reactivar dispositivos revocados;
- borrar datos;
- ocultar discrepancias;
- convertir errores criptográficos en errores de red.

## Reglas estructurales

1. Todo control crítico debe poder probarse.
2. Todo cambio sensible debe auditarse.
3. Toda autoridad debe estar definida por dominio.
4. Toda excepción debe ser explícita.
5. Toda integración externa se considera no confiable hasta verificarse.
6. Toda entrada del cliente se valida nuevamente en backend.
7. Toda operación crítica conserva identidad e idempotencia.
8. Toda recuperación conserva evidencia.
9. Todo tenant permanece aislado.
10. Ningún control se agrega sin responder a un riesgo real.

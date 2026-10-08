# Inventario de SDKs y dependencias de terceros — privacidad

**Producto:** Camacho POS Colombia  
**Fecha de auditoría:** 2026-10-07  
**Estado:** MATERIALIZADO — revisión sobre manifests y código de la línea activa

## 1. Regla

Este inventario separa dos controles que no deben confundirse:

- **seguridad de cadena de suministro:** SBOM, vulnerabilidades, licencias, procedencia y CodeQL;
- **privacidad del SDK:** qué datos recopila una dependencia, si inicia comunicaciones propias, para qué finalidad y qué datos salen del equipo.

Los controles de supply chain ya existentes no se consideran por sí solos una auditoría de privacidad.

## 2. Dependencias externas de runtime verificadas

La auditoría revisó los manifests de los paquetes de ejecución actuales. Las dependencias externas directas de runtime relevantes son:

| Dependencia | Uso observado | Telemetría/analítica propia del producto observada | Acción |
|---|---|---|---|
| Electron 44.1.1 | Shell de escritorio | No se encontró uso de `crashReporter`, auto-update o SDK analítico en el código auditado | Mantener revisión al actualizar Electron |
| React 19.1.0 / react-dom 19.1.0 | UI local | No tienen una integración analítica propia del producto | Mantener |
| Zod 4.4.3 | Validación de contratos | No comunicación de red por el uso observado | Mantener |
| better-sqlite3 13.0.3 | Persistencia SQLite local | No comunicación de red por el uso observado | Mantener |
| Kysely 0.29.5 | Acceso tipado a base de datos | No SDK analítico | Mantener |
| pg 8.23.0 | Acceso PostgreSQL | El paquete es un driver; la comunicación ocurre sólo cuando el código del producto abre una conexión configurada | Auditar destinos/configuración antes de cada integración |
| Playwright / Vitest / Testing Library / Vite / esbuild / TypeScript | Desarrollo y pruebas | No forman parte de la superficie operativa instalada como SDK de negocio | Mantener fuera del producto final |

## 3. Integraciones de analítica/telemetría

Se buscó explícitamente en el repositorio:

- `Sentry`;
- `PostHog`;
- `Datadog`;
- `Google Analytics`;
- `crashReporter`;
- `autoUpdater`;
- patrones de `telemetry` y `analytics`.

No se encontró una integración de analítica comercial o de tracking de usuario.

El `DesktopLogger` existente se utiliza para eventos operativos y errores locales; no se ha identificado en el código auditado como un SDK externo de publicidad o analítica.

## 4. Datos y red

La aplicación es local-first y el repositorio contiene integraciones de red específicas para las capacidades que realmente las requieren.

La existencia de una dependencia de red no significa que el proveedor de la dependencia reciba automáticamente datos del cliente. Debe distinguirse:

1. dependencia instalada;
2. llamada de red efectivamente ejecutada;
3. destino;
4. payload;
5. finalidad;
6. retención;
7. base jurídica/autorización aplicable.

## 5. Gates ya existentes

La auditoría no duplica los controles ya materializados:

- inventario de dependencias;
- SBOM CycloneDX;
- auditoría de vulnerabilidades;
- compatibilidad de licencias;
- procedencia;
- CodeQL/SAST.

Esos controles deben seguir ejecutándose como gates de CI.

## 6. Gate de privacidad para futuras dependencias

Antes de introducir un SDK o dependencia que pueda:

- recopilar datos del usuario;
- realizar telemetría;
- acceder a archivos, contactos, cámara, micrófono o ubicación;
- enviar datos a terceros;
- identificar dispositivos;
- realizar publicidad o analítica;

deberá registrarse:

- finalidad;
- datos tratados;
- origen;
- destino;
- comunicaciones de red;
- retención;
- configuración para desactivar telemetría;
- licencia;
- versión;
- evidencia de prueba;
- necesidad y proporcionalidad;
- impacto sobre la Política de Privacidad.

No se aprueba una dependencia por el solo hecho de que pase el gate de vulnerabilidades o licencias.

## 7. Resultado

**Supply chain:** materializada.  
**Inventario inicial de privacidad de SDKs:** materializado.  
**Auditoría de privacidad de cada dependencia transitiva:** no declarada como completa; sería una afirmación falsa sin revisar cada paquete del lockfile.

Este documento no autoriza introducir SDKs nuevos ni crea una segunda política de privacidad.

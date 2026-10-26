# Central comercial V2: cierre de composición

Continuidad: e1f9d4f98345eb3224844377a497c1a573673d01. Rama única
feat/android-commercial-runtime. No DDL productivo, Actions ni merge.

La composición optativa CENTRAL_COMMERCIAL_PROVISION_FILE conecta en el listener
HTTPS existente los owners de contraseña, MFA, BUSINESS, navegador, binding,
código, access/refresh V2, SSA y SAS. No crea identidades ni permisos. Exige
manifiesto exacto 008–016 APPLIED, runtime pos_platform_app sin superuser ni
BYPASSRLS, políticas explícitas, claves operacionales distintas y raíces públicas
verificadas. El runner ofrece --manifest sin conexión a base de datos.

Se corrigieron dos defectos descubiertos al ejecutar el montaje canónico:
preflight sin contexto tenant para RLS y comprobación de inserción contra la
tabla de laboratorio. La migración 016 local todavía no desplegada contenía un
cuantificador regex de PostgreSQL fuera de rango; ahora valida longitud y alfabeto
por separado. Ningún archivo histórico 001–013 ni propuesta experimental cambia.
016 también contiene presupuesto durable y monotónico de intentos por solicitud.

Ejecución observada, PostgreSQL 16.14 temporal en localhost:55433 y HTTPS real
con certificado efímero confiado solamente por el cliente de prueba:

- central-commercial-deployment-physical.test.ts: 3 PASS, 0 FAIL.
  Runner real → binding DeviceProof → contraseña incorrecta rechazada → contraseña
  y firma WebAuthn → BUSINESS → código y consumo único → access/refresh V2 → SSA
  y SAS → rechazo de proof repetida → renovación → logout navegador → revocación.
  El SAS contiene cero asignaciones: no se concede dashboard artificialmente.
  Contexto serializado/pool equivocado/drift/política ausente rechazados.
  Presupuesto concurrente: cuatro intentos admitidos y cuatro limitados; reducción
  del contador rechazada en SQL.
- postgres-commercial-runner-physical.test.ts: 3 PASS, 0 FAIL tras cambiar 016.
  Aplicación concurrente/idempotente, privilegios mínimos, timeout obligatorio,
  predecesor ausente y rollback de DDL.
- Arquitectura: 16 PASS y ARCH-003 PASS. Política: PASS.

Informes locales: artifacts/windows-p0/2026-10-26/central-deployment-final.json y
commercial-runner-final.json. No sumar repeticiones de diagnóstico. Fallos iniciales
del fixture (importación de Pool, par code/code_normalized, nombres de respuesta)
se corrigieron; el primer typecheck detectó cookie opcional incompatible y se
corrigió. No se ejecutaron suites de caja, ventas, hardware ni Argon2id completo.

Nivel: IMPLEMENTED y TESTED en montaje canónico temporal; no PRODUCTION ni
certificación con persona. Las identidades y firmas de prueba son efímeras.
No existe Central HTTPS/DEV-003 auténtico confirmado por el propietario.
Configuración no publicada = rutas sin activar. La instalación debe proporcionar
dominio/certificado reales, base y operador, manifiesto aprobado, parámetros,
claves operacionales bajo custodia, raíces verificadas e identidad/dispositivo
enrolados. No se seleccionan esos valores desde ejemplos.

Próximo cierre técnico: entrada main Electron y logout nativo con revocación
central y denegación durable local. El logout navegador probado aquí no sustituye
ese trabajo. CI remoto sigue pendiente hasta su restablecimiento autorizado.

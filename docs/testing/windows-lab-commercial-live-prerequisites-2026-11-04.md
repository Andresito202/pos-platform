# Prerrequisitos vivos del login Windows — 2026-11-04

Continúa exclusivamente PR #99; las integraciones visuales, caja y PR #100
siguen separadas. No se modifican main, la rama histórica ni archivos concurrentes.

El propietario ha reanudado el trabajo para completar el laboratorio y luego
certificar. El perfil de parámetros propuesto permanece limitado al laboratorio;
su aceptación no convierte los artefactos existentes en provisión BUSINESS.

La siguiente comprobación no repite MFA, KDF, DPAPI o publicación ADMIN.
`windows-login-lab-commercial-readiness.mts --inspect --lab-root <raíz>`:

- Reutiliza el control de administrador interactivo Server 2022 y custodia de
  la autoridad del publicador. No altera ACL ni lee service/private.
- Consulta PostgreSQL con TLS verify-full, rol pos_platform_app y los checksums
  canónicos 008–016. Usa BEGIN READ ONLY y ROLLBACK, sin DDL/GRANT/INSERT/UPDATE.
- Los recibos seleccionan un contexto publicado coherente. En PostgreSQL
  revalida la cuenta, contraseña vigente, factor/material, membresía, empresa y
  sucursal. Esto NO verifica nuevamente una contraseña ni inicia sesión.
- Comprueba el registro ACTUAL del dispositivo, ámbito, clave pública y
  credenciales vigentes. No confunde deviceRegistered=false histórico con el
  contenido actual del registro, ni una clave pública con posesión fresca.
- Detecta una incompatibilidad posible antes de escribir DEV-003: el
  aprovisionador SCM original genera GUID mediante NewGuid (UUID v4) si no
  recibe identidad previa; la tabla canónica exige UUID v7 para device_id.
  Se informa la versión real, sin inventar UUID, cambiar identidad, aflojar
  el CHECK ni manipular DPAPI. La incompatibilidad aún necesita ejecución en VM
  para determinar si afecta a los identificadores concretos de este laboratorio.
- Separa el bloqueo BUSINESS de la provisión GLOBAL ausente y guarda un recibo
  nuevo con booleanos/versiones; no imprime claves, tokens, contraseñas, URLs
  de base de datos ni datos personales. No inicia SCM ni listeners.

Las cinco pruebas nuevas cubren v4/v7, binding contradictorio y selección de
recibos publicados frente a candidatos con rollback/conflictos. Son pruebas
unitarias; la consulta viva de la VM queda pendiente hasta ejecutar el operador.
Se repiten únicamente las 12 pruebas del publicador afectado por la extracción
de su control de operador, no las suites de contraseña/MFA/SCM ya cerradas.

Pendientes de implementación separados de configuración:

1. La entrada real del Service conserva el gate SCM incondicional. No se ha
   eliminado ni sustituido por flags de entorno o booleans de provisión.
2. DeviceEnrollmentService está implementado, pero el arranque Windows no
   instancia un flujo de enrolamiento equivalente al consumidor Android. No
   basta configurar CENTRAL_COMMERCIAL_PROVISION_FILE para certificar DEV-003.
3. Con el resultado vivo se podrá completar la provisión correcta y la unión
   nativa dentro del alcance permitido; si hay UUID incompatibles, antes de
   escribir debe definirse una transición que preserve las custodias existentes.

No se declara la certificación del login ni se atribuyen estos bloqueos a un
VPS: son dependencias concretas del laboratorio y de su composición Windows.

## Corrección observada después de proteger la autoridad

El propietario ejecutó el reparador en la VM: PROTECTED_SAME_PERMISSIONS,
con respaldo authority-acl-before-ef12fda9712c48b6b4936bda68226963.sddl.txt.
La consulta siguiente superó ese control pero falló con PostgreSQL 42703.
El defecto del operador era `co.name`; la migración canónica 001 declara
`organization.companies.trade_name`. Se corrige sólo ese identificador, sin
DDL, cambios de datos ni relajación del ámbito o de la membresía.

La regresión comprueba todas las referencias alias/columna del SELECT frente
a las declaraciones canónicas 001/010 y reproduce el rechazo de co.name.
Es una comprobación estática acotada; no es un parser SQL general ni una
ejecución PostgreSQL. La consulta corregida debe ejecutarse todavía en la VM.
El aviso de pgpass no motivó actualización de dependencias ni cambios de
credenciales. El mensaje de pnpm sobre tsx sigue siendo secundario al error SQL.

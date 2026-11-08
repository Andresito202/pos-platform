# GLOBAL HTTPS, recaudos y contrato de licencia

Base publicada: 6ea502681dbb81ef523faf13b7a7e077fa271bf9.
El propietario aprobó expresamente los dos cambios contractuales de
licensing-remaining-contracts-2026-10-27.md durante esta ejecución. No aprobó
valores operativos, impuestos, soporte, cuentas o credenciales de producción.

## Código conectado

- Central main monta GLOBAL opt-in con `CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE`:
  mismo listener HTTPS, propósito GLOBAL_AUTHENTICATE separado, contraseña y
  firma WebAuthn existentes, UV obligatoria, sesión GLOBAL en identity.sessions,
  cookies opacas HttpOnly/Secure/SameSite y CSRF en custodia canónica 013.
  No se crean usuarios/factores/grants ni se eleva BUSINESS.
- 021 en runner canónico `--global-administration`: extensión no destructiva de
  tablas de Identity, pares tenant/membership nulos sólo para GLOBAL, validación
  física de scope y propósito al insertar cookie/handoff. Conserva estados,
  historial y permisos existentes. Manifest de autenticación 008–016 intacto.
  Función acotada GLOBAL aplica SHARE con timeout, sin tenant ficticio ni UPDATE
  general. Presupuestos de intentos por dirección/cuenta sobreviven reinicio en
  identity.security_events; no almacena contraseña ni IP/correo en claro allí.
- Endpoints cerrados POST `/v1/platform/login/begin`, `/login/complete`,
  `/session`, `/logout`, `/license-offers/list`, `/license-offers/save`,
  `/license-offers/publish`, `/quotes/issue`, `/licenses/issue` bajo el mismo prefijo.
  Planes y precios llegan a servicios SQL reales después de revalidación GLOBAL,
  MFA y permiso. UUID o bearer BUSINESS no autentican esos endpoints.
- Central main monta procesamiento de intenciones PENDING con
  `CENTRAL_FACTUS_PAY_COLLECTIONS_PROVISION_FILE`: POST oficial idempotente por
  referencia persistida, QR guardado sin confirmar pago, GET autenticado separado
  y confirmación Payments/outbox. Nunca crea recaudo por existir una quote sola.
  Custodia de tokens en archivo administrativo separado, binding exacto,
  expiración y lectura por operación; rotación del archivo no deja caché obsoleta.
  Caducidad conduce a REVIEW_REQUIRED durable, no activación tardía silenciosa.
- Licensing escribe licensing.licenses/license_entitlements existentes sólo tras
  pago canónico confirmado y permiso GLOBAL explícito LICENSE_ISSUE (operación
  D-1 existente, no equivalente a LICENSE_PLAN_MANAGE). Congela features de quote;
  no crea grants. Contrato, entitlements, Sync/outbox y auditoría son atómicos.
  Devuelve NOT_ACTIVATED: no firma ni distribuye capacidad de dispositivo todavía.

## Pruebas observadas y reproducción

PostgreSQL 16.14 temporal localhost:55433, tmpfs sin mounts persistentes. Bases
aleatorias eliminadas por fixtures. Dos servidores HTTPS locales con certificados
efímeros y CA/SNI verificados; no llamadas ni pagos en FACTUS real. WebAuthn usa
autenticador software con firma real P-256 y Argon2 existente, no persona física.

```powershell
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm --filter @pos-platform/central-authority exec vitest run tests/subscription-quotes-physical.test.ts -t 'FACTUS API:|GLOBAL:' --reporter=json --outputFile=../../artifacts/licensing/2026-10-27/licensing-fulfillment-final.json
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-initial-mfa-physical.test.ts tests/business-session-authority-physical.test.ts -t 'commits real UV/signature|persists BUSINESS from genuine' --reporter=json --outputFile=../../artifacts/licensing/2026-10-27/global-business-regression.json
```

Resultado final focalizado: **2 PASS, 0 FAIL, 3 filtradas**. SHA-256:
`718c4f1fc34ddef4c6f877710a4263220328be36cded9f5382fe05ad8849bdb2`.
Incluye creación/consulta TLS, QR no pagado, error de custodia sin HTTP, recuperación
con objetos nuevos, políticas/checksum incorrectos, expiración y revisión única;
GLOBAL por HTTPS hasta SQL real de precios, replay de ceremonia, origen/CSRF
incorrectos, permiso inexistente, cookie GLOBAL renombrada rechazada por BUSINESS,
reinicio, credencial revocada, logout incluso después de revocación;
emisión contractual denegada sin permiso/política/pago confirmado, concurrencia,
idempotencia y rollback de licencia/outbox por fallo de auditoría.

Regresión justificada por extensión del verificador/MFA compartidos: **2 PASS**,
resto filtrado, no las suites completas 23/25. SHA-256:
`4380f7182141b6f50d636588730014c8e3b6f9f055d1c39b9bd05c7227645717`.
Antes del consumidor Licensing, los cinco escenarios de quotes/recaudos/GLOBAL
aprobaron juntos en collections-global-final.json. No sumar repeticiones como
escenarios nuevos. Las ejecuciones iniciales fallidas se conservan en artifacts.

Fallos corregidos: checksum de Payment incluía un campo extra de configuración
de integración; se normaliza el binding canónico. Scope GLOBAL no puede usar la
función SAS que exige tenant: 021 define la función GLOBAL acotada equivalente.
Un evento de auditoría GLOBAL no puede incluir FK operation_id tenant-scoped:
referencia real del outbox queda en payload protegido por checksum, sin relajar
constraints. Fixtures corregidos: expectativa de error sanitizado y variable
request que ocultaba el generador. TypeScript detectó optional explícito undefined;
se omite la propiedad ausente, sin desactivar exactOptionalPropertyTypes.

## Activación operativa

Archivos de provisión absolutos, regulares, no symlink; permisos restringidos
de archivos en Unix y ACL de Service bajo responsabilidad del operador Windows.
No pegar tokens por chat ni guardar secretos en Git. Schemas ejecutables:
GlobalAdministrationProvisionSchema / FactusPayCollectionsProvisionSchema.
Vigencias, límites, fingerprints/checksums, políticas y entorno son explícitos;
no se proporcionan valores productivos de ejemplo. El token de FACTUS debe venir
de su cuenta auténtica y mantenerse vigente por custodia del operador.

Las políticas fiscales/soporte no definidas dejan `/quotes/issue` y la emisión
contractual bloqueadas en el montaje sin sus dependencias. No se habilitaron
archivos de provisión ni cobros reales en este computador. No se aplicó DDL a
bases comerciales. PR #96 Draft, sin Actions ni merge.

TypeScript Central/database-postgres/contracts/runner, ARCH-003 y diff --check:
PASS. El transporte de ofertas añade locks GLOBAL y revalidación de contraseña,
factor y permiso dentro de la escritura, con límites explícitos; no conserva un
snapshot de permisos anterior a una espera. No hay build propio de Central en
package.json; no se anuncian builds Electron ni certificación Windows nuevos.

## Lo que esto todavía no cierra

El panel Electron existente no está hospedado/conectado al contexto GLOBAL HTTPS;
el transporte y sus efectos SQL sí están probados, no el producto administrativo
completo. Faltan fuente central de asignaciones de cajas, emisor/entrega de
capacidad firmada por DEV-003 y consumidor Windows de esa provisión automática.
Contrato ACTIVE no equivale a caja activada. No hay emisión fiscal de suscripción
ni proveedor de correo montados. Se necesitan sus consumidores y datos auténticos,
además de política fiscal/soporte aprobada. No presentar estos huecos de código
como si sólo faltaran credenciales ni declarar cierre comercial o producción.

Fuentes del transporte FACTUS: [crear](https://pay-developers.factus.com.co/recaudos/crear/)
y [consultar](https://pay-developers.factus.com.co/recaudos/ver/).

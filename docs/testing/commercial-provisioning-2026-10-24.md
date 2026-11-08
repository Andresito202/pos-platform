# P0-05 — preparación de infraestructura y aprovisionamiento Windows

Base local/remota `076eff0bb07e41e3cc7949a6d101831db65a3cde`, única rama activa
`feat/android-commercial-runtime`, PR #96 draft. Árbol rastreado inicialmente
limpio; `docs/product/oracleJdk-27/` conservado intacto y fuera del commit.
No hay despliegue central externo confirmado ni nuevos valores productivos.

## Implementaciones sobre los owners existentes

| Entregable | Incremento comprobable | Límite |
| --- | --- | --- |
| P0-01 | Perfil opt-in tipado en Central, TLS hoja/clave/hostname/vigencia, issuer Ed25519, rol/schema PostgreSQL, ready acotado y drain HTTP→DB | No despliegue, DNS, cadena TLS comercial ni aprobación de límites; legacy enrollment compatible, BUSINESS cerrado |
| P0-02 | Resolución D3 Windows y validación comercial de registro/RP/origen; rechazo de dominios reservados, clientes/redirect incompatibles | Metadata estructural no demuestra control del dominio ni aprobación; cliente real aún sin registrar |
| P0-03 | Preflight del rol/schema que usa DeviceEnrollment; binding/credencial/custodia anteriores conservados | Sin registros/activación/cadena reales, no se enrola ningún equipo; sucursal requiere mapping confiable externo |
| P0-05 | Proveedor HTTPS existente ampliado con TLS del runtime y autenticador nativo obligatorio; separación de material SSA/SAS en cada consumo | No se monta un publicador/formato SAS no aprobado ni un protocolo de access productivo |
| P0-06 | Comprobaciones read-only de rol/schema y rechazo de owner/privilegios inseguros; límites de infraestructura explícitos | Ningún DDL/grant, migración, política de sesión/refresh/abuso/offline o composición de roles aprobados automáticamente |

`HttpsAuthorizationSnapshotProvider` implementa el mismo SnapshotProvider. El
alias IsolatedHttpsSnapshotProvider conserva el constructor del host probado.
SYSTEM_TRUST usa las CA confiables del runtime Node y `rejectUnauthorized:true`;
no admite CA/puerto auxiliares del fixture, redirects, cookies, headers de origen
ni sustituciones del destino. El endpoint SAS es fijo. La configuración se copia
para evitar cambios del caller después de validarla.

El modo comercial exige una función de autenticación inyectada por código nativo
confiable para **ese cuerpo/path/IDs**. No se acepta un JSON del cliente como
prueba ni se selecciona formato de access. El header de laboratorio
`x-isolated-business-access` se rechaza en SYSTEM_TRUST. La implementación real
de esa dependencia espera el perfil aprobado; no hay fallback ni caller comercial
montado. En laboratorio se conserva DeviceProof y el transporte existente.

El resultado HTTP sólo tiene validación estructural: firma, binding, ventanas,
revocación, secuencia y permisos siguen verificados por adquisición/store/componente
canónicos. El nuevo guard rechaza clave privada, algoritmo distinto, mismo key-id
o **misma clave pública bajo un alias** entre los mapas SSA/SAS. También se ejecuta
al releer un snapshot persistido y tras rotación del mapa. No verifica una cadena
de distribución nueva: esos mapas aún deben proceder de provisión autenticada.

Defecto concreto corregido: dos mapas con nombres distintos podían contener el
mismo material criptográfico. Tres fixtures antiguos usaban la misma pareja para
SSA y SAS; ahora usan parejas distintas, sin ampliar permisos ni cambiar claims.
El productor SQL, reservas 011/012, login, PKCE y canal P0-04 no se reconstruyen.

## Pruebas y nivel de evidencia

Artefactos completos locales: `artifacts/commercial-provisioning/2026-10-24/`;
resultados, hashes y archivos: [evidencia](commercial-provisioning-evidence-2026-10-24.json).

| Ejecución final | PASS | FAIL | Omitidas |
| --- | ---: | ---: | ---: |
| Central: perfil, listener y D3 | 29 | 0 | 0 |
| Registro Windows/RP (contracts) | 12 | 0 | 0 |
| Local: proveedor, recepción y canal afectado | 95 | 0 | 0 |
| Custodia/credencial: selección requerida por esta misión | 5 | 0 | 23 |
| PostgreSQL/Electron: preflight, revocación de credencial y E2E | 3 | 0 | 166 |
| **Casos distintos seleccionados** | **144** | **0** | **189** |

Las 11 pruebas del proveedor se revalidaron después del ajuste de fixture y no
se suman otra vez a los 95. TypeScript de cuatro proyectos afectados, build
completo Electron y las 16 pruebas de ARCH-003 aprobaron. El primer gate de
fronteras falló por importar un helper TLS desde otra aplicación; se reemplazó
únicamente por el setup efímero dentro del test local, sin cambiar reglas ni
transporte productivo. El gate final aprueba. No hubo fallos de casos funcionales
en las selecciones ejecutadas.

Política de repositorio PASS con 1023 archivos rastreados, incluidos los nuevos
preparados. El perfil incompleto no cae silenciosamente al arranque legacy;
se rechazan también parámetros DB duplicados/ambiguos y la desactivación global
de verificación TLS. Son validaciones de infraestructura, no políticas BUSINESS.

- Perfil: configuración completa/incompleta, enteros/timeout inválidos, token
  ambiguo, rol privilegiado, TLS DB no verificado, dominios reservados; certificado
  TLS real con clave/hostname/fecha incorrectos; drain real y readiness concurrente.
- Windows/RP: S256/registro existentes, RP incompatible, redirect ajeno, origen
  HTTP/no canónico/reservado; resolver D3 sin evidencia completa falla cerrado.
- SAS: HTTPS real loopback con CA válida y CA ajena; redirects/cache/401; contexto
  de petición cerrado; ausencia de autenticador y rechazo de protocolo LAB en
  modo comercial; mutación posterior de configuración; reutilización SSA como SAS.
- Recepción y regresiones afectadas: firmas, alcance, falta de permisos, expiración,
  revocación, secuencia antigua/repetida, rollback y rotación de claves. Los tests
  de canal afectados se repiten únicamente por la separación de claves nueva.
- PostgreSQL temporal: preflight read-only contra rol canónico y rechazo del owner.
  Electron real: regresión del recorrido Service/DPAPI/HTTPS/BUSINESS/SSA/SAS y
  dashboard AUDIT_EVENT_READ del productor SQL; catálogo directo denegado.

Los nombres comerciales de metadata en unit tests no se resuelven, registran ni
despliegan. TLS físico de prueba usa `.test` y CA efímera sólo en LOCAL/fixture.
La prueba de transporte con una firma placeholder no autoriza operaciones: la
recepción criptográfica se prueba por separado. Ningún empleado humano ni CA
productiva se simulan como certificados. No se toca una base comercial.

Comandos focalizados:

```powershell
pnpm --filter @pos-platform/contracts exec vitest run tests/windows-commercial-registration.test.ts
pnpm --filter @pos-platform/central-authority exec vitest run tests/central-deployment-configuration.test.ts tests/enrollment-rate-limit.test.ts tests/fixed-window-rate-limiter.test.ts tests/d3-deployment-readiness.test.ts
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/authorization-https-provider.test.ts tests/central-sas-reception.test.ts tests/commercial-ipc.test.ts tests/channel-commercial-vertical.test.ts --no-file-parallelism
pnpm --filter @pos-platform/pos-desktop build
pnpm --filter @pos-platform/pos-desktop exec esbuild e2e/ssa-native-transport.ts --bundle --platform=node --format=esm --outfile=dist/ssa-native-transport-probe.mjs
# Requiere sólo PostgreSQL tmpfs dedicado 127.0.0.1:55433 y los probes previos P0-04.
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-access-preparation-physical.test.ts -t 'commercial deployment:|central SAS: Electron.*custody=true'
pnpm --filter @pos-platform/contracts --filter @pos-platform/central-authority --filter @pos-platform/pos-local-service --filter @pos-platform/pos-desktop run typecheck
node --test tools/architecture/validate-boundaries.test.mjs
node tools/architecture/validate-boundaries.mjs
pnpm ci:repository-policy
```

No se repite la selección completa anterior de 179 casos ni suites Argon2id/MFA/negocio completas. El perfil
opt-in tiene pruebas propias; los tests legacy del listener conservan su alcance
HTTP/rate-limit y no acreditan TLS de producción. SIGTERM Windows/servicio instalado
y supervisión del entorno real siguen requiriendo certificación operacional.

## Decisiones externas concretas (misma solicitud consolidada)

| Contrato | Riesgo | Opciones compatibles / recomendación a revisar | Decisión y trabajo independiente terminado |
| --- | --- | --- | --- |
| DEV-003 y D3 despliegue | Host o sucursal autodeclarados; confianza falsa | Operador resuelve registros canónicos y mapping de sucursal por canal privilegiado, compara huellas y registra cliente exacto | Proporcionar entorno/admin/DNS-TLS/IDs y cadena pública verificados; perfil/TLS/rol/registro ya validados sin inventarlos |
| DEC-011 distribución de confianza SAS | Confundir propósito SSA/SAS o retroceder una generación | Extender el mecanismo root-signed existente con propósito SAS cerrado y store separado, o raíz SAS independiente; revisar formato/custodia/versiones/revocación antes de codificar el artefacto | Owner Authorization/seguridad debe aprobar perfil y fuente. Contrato actual de session-trust admite sólo SESSION_ASSERTION: no se lo relaja; guard de separación terminado |
| Protocolo access/refresh D3 | Enviar credenciales LAB a un host comercial; replay de refresh | Perfil sender-constrained compatible con DeviceProof y binding durable en tablas existentes, o protocolo estándar completo aprobado; no llamar DPoP al formato propio | Aprobar headers/body/audience/custodia/rotación y vigencias. Transporte TLS con dependencia nativa explícita terminado, sin formato por defecto |
| Owner Authorization: contador SAS y locks RBAC | UPDATE de fuentes para FOR SHARE puede ampliar autoridad de escritura | Migración canónica de contador por user/install/device y privilegios sólo de su owner; evaluar función mínima revisada con search_path/scope fijos frente a grants de UPDATE de fuentes | DB/seguridad aprueban DDL/roles/RLS/estrategia de locks. Preflight read-only terminado; ninguna tabla validation se promueve ni se concede UPDATE |
| Vigencias, abuso y offline | Ventanas inventadas, gracia no aprobada o revocación offline presentada como instantánea | Mantener dependencias explícitas; SAS sin gracia y revalidación por uso; medir candidatos previos antes de fijar valores | Propietario/seguridad/operación ratifican política. Expiración/replay/revocación locales existentes preservados; refresh productivo permanece cerrado |

Estas decisiones amplían la [propuesta única](android-commercial-approval-proposal-2026-10-22.md),
no constituyen aprobaciones ni solicitudes de secretos. Sin ellas se mantienen
los bloqueos P0-01/02/03/05/06 y P0-07 no certificado. Actions pendiente hasta el
1 de noviembre de 2026 según el propietario; workflows intactos, sin CI verde.

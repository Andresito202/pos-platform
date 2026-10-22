# BUSINESS: custodia HTTP canónica y HTTPS de laboratorio

Base: `519272174688f736cb16213128d4a447f10ac5e5`, rama única
`feat/android-commercial-runtime`. PR #96 conserva draft y su base histórica.
Alcance: identidad, sesión y transporte; sin cambios comerciales ni hardware.

## Implementación y procedencia

Migration PostgreSQL **013_business_browser_sessions**, posterior a 012, añade
dos tablas propiedad de Identity: `browser_session_handoffs` y `browser_sessions`.
No modifica migrations cerradas, `identity.sessions.device_id IS NULL`, SSA,
permisos operativos ni tablas de refresh existentes. Sólo guarda SHA-256 del
handoff/cookie/CSRF. FORCE RLS; el rol central tiene INSERT/SELECT y UPDATE de
columnas de ciclo de vida. El historial no puede borrarse, sustituirse ni revivirse.
El down rechaza borrar tablas con historial. No se aplicó a bases persistentes.

`BusinessSessionAuthority.createBrowserHandoff` consume exclusivamente el receipt
WeakMap original del flujo contraseña/WebAuthn. El writer participa en **la misma
transacción** que revalida identidad, versión de contraseña, factor, MFA y
membresía, crea BUSINESS y audita. Devuelve un secreto aleatorio de 256 bits sólo
después de commit y sólo desde el objeto retornado por esa transacción. No se
aceptan UUID, copias JSON ni booleanos como procedencia. El secreto se consume
bajo bloqueo PostgreSQL, con origen y vencimiento asociados; la cookie no expone
el handoff ni la referencia interna.

`DurableBrowserSessionStore` vive en database-postgres, dueño del SQL. El perfil
canónico no impone nombres de bases o puertos de fixtures. Recibe explícitamente
vigencia absoluta, inactividad y antigüedad de reautenticación. Revalida BUSINESS,
usuario, tenant, membresía, contraseña original y factor en cada operación.
Usa reloj PostgreSQL y bloqueos; la rotación conserva exactamente el vencimiento
original, incluidos microsegundos. Logout revoca cookie, BUSINESS y refresh y
audita en una transacción. El wrapper aislado anterior conserva su API/restricciones.

Se retiró la dependencia directa de Central Authority sobre `pg`: los tipos y
la factoría se importan desde database-postgres. No se relajó ARCH-003.

## Transporte observado

`createIsolatedCommercialHttpsServer` compone los owners existentes y las seis
rutas reservadas, con TLS real mínimo 1.2. Sólo escucha en loopback/puerto efímero,
con PostgreSQL temporal localhost:55433 y nombre aleatorio validado. **No es una
opción de activación productiva**, ni está montado en `main.ts`.

`login` tiene fases begin/complete: contraseña real, challenge, firma WebAuthn y
selección de membresía revalidada; nunca entrega receipts al cliente. Las rutas
browser exigen cookie + CSRF + Origin exacto + Fetch Metadata same-origin.
Authorize resuelve esa cookie dos veces mediante el inspector confiable y reutiliza
DeviceProof y el emisor PKCE. Devuelve campos estructurados de un redirect
registrado, sin redirección abierta. **La prueba DeviceProof delegada conserva la
ruta firmada canónica de SSA; no firma el envelope HTTP externo /authorize.**
Su aprobación como protocolo público sigue pendiente.

Token usa el contrato estricto existente y el canje/emisión conjunta en una
transacción. Es un back-channel nativo: rechaza cookies/Origin/Fetch Metadata.
Cookies `__Host-`, Secure/HttpOnly/SameSite=Strict; JSON limitado y estricto,
cabeceras duplicadas/proxy/encoding ambiguo rechazadas, no-store, errores
sanitizados, sin logs de secretos; presupuesto por dirección para todo el servidor
y auditoría canónica de rechazos. Este límite local de laboratorio no aprueba una
política distribuida de abuso. `main.ts` conserva sus seis rutas 503 antes de D3.

## Evidencia ejecutada en Windows

Node 22, PostgreSQL 16 temporal ya disponible en Docker, puerto 55433, almacenamiento
tmpfs. Cada suite crea/elimina una base aleatoria; rol runtime sin superuser ni
BYPASSRLS. TLS generado para el nombre reservado `business.example.test`, confiado
sólo por el cliente de prueba, sin modificar el almacén Windows ni DNS.

```powershell
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/pos_target_test'
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-access-preparation-physical.test.ts -t 'HTTPS commercial|canonical browser|persists opaque browser|rejects durable browser'
```

**25 aprobadas, 68 omitidas por filtro, 0 fallidas**. Incluye 8 casos de transporte
HTTPS real (sin mock de HTTPS), 15 nuevos de persistencia canónica y 2 de
compatibilidad del almacén anterior. Verifica firmas, password/MFA/BUSINESS,
cookies/CSRF/origen, replay, tenant/usuario/membresía/factor/contraseña revocados,
rotación concurrente, PKCE inválido/concurrente/repetido, JWT y revocación, refresh
invalidado por logout, rollback de creación/canje/logout y protección del down.
Logs locales ignorados: `artifacts/auth-http/2026-10-22/browser-https-final.log`.

```powershell
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-session-authority-physical.test.ts
```

**25/25**, repetidas por modificar directamente el contrato de esa transacción.
No se repitieron las suites completas de MFA, Argon2id o comerciales.

```powershell
pnpm --filter @pos-platform/central-authority exec vitest run tests/enrollment-rate-limit.test.ts tests/isolated-commercial-binding-adapter.test.ts tests/isolated-business-audit-session-guard.test.ts tests/isolated-postgres-native-code-consumer.test.ts tests/commercial-token-http-contract.test.ts tests/native-authorization-code-exchange.test.ts
```

**30/30**. El test del bloqueo de producción utiliza el listener de main con TLS
reemplazado por HTTP: acredita el gate, no una prueba TLS de producción.
TypeScript de Central Authority, database-postgres y target-migrations: exit 0.
ARCH-003: PASS. Revisión final y CI del SHA publicado se registrarán por separado.

Fallos conservados: primer run canónico tuvo 2 fallos (estado INACTIVE del fixture
y precisión de microsegundos al rotar); corregidos y reprobados. Primer run HTTPS
tuvo 2 fallos de auditoría por falta del contexto tenant RLS del caller de prueba;
corregido sin cambiar RLS. Logs iniciales permanecen en artifacts. La resolución
offline del lockfile no encontró metadatos; resolución normal con ignore-scripts
completó y el lockfile sólo elimina la dependencia directa pg de Central Authority.

## Límites y continuación

TESTED en laboratorio. No RUNTIME_VERIFIED ni END_TO_END del POS. Las credenciales
son fixtures criptográficas sobre PostgreSQL real; no se autenticó una persona ni
se abrió una sesión en Electron/M60WL. El endpoint refresh público, la superficie
WebAuthn del navegador y el retorno/custodia nativos aún requieren integración de
código; no se atribuyen esos pendientes exclusivamente a D3.

Externos: autoridad HTTPS real no confirmada; dominio/RP/origen, registros nativos,
firma Android/Digital Asset Links, confianza DEV-003 y custodia central verificada;
aprobación conjunta D3/SEC-004/DEC-025 y políticas de vigencia/reauth/abuso/acceso
según la propuesta existente. No se activó ningún valor candidato ni se fabricaron
aprobaciones. PR #96 debe permanecer draft; no corresponde merge a main.

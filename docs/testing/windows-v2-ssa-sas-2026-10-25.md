# Windows: V2 → SSA/SAS y custodia durable — 2026-10-25

Base `c24df8b1576a158f8c7dfed6a78c4aa5f1b4ee42`, única rama
`feat/android-commercial-runtime`, PR #96 draft. Sin cambios de diseño, nuevas
autoridades, bases comerciales ni modificación de `oracleJdk-27/`.

## Incremento sobre los owners existentes

- `CommercialBusinessAccessAuthority` entrega una referencia de claims verificados
  reconocida sólo por esa instancia. La revalidación dentro de la transacción
  emisora rechaza objetos serializados y mantiene locks de familia/sesión hasta
  commit. Revocación, rotación de credencial y expiración vuelven a comprobarse.
- `BusinessAccessPreparation` y los emisores SSA/SAS existentes aceptan V2 con
  posesión de propósito exacto. Reutilizan el contador 011, replay 012 y RBAC
  canónico; no interpretan access como permisos. Conservan los guards de entorno
  aislado y el camino V1 de laboratorio.
- `CommercialDeviceCredentialProvider` añade sólo dos operaciones cerradas de
  posesión V2: assertion y autorización. Revalida custodia/binding/enrolamiento en
  cada firma; Central sigue verificando firma del access y familia actual.
- El coordinador nativo existente recibe audiencia V2 explícita y custodia
  OS_BOUND opcional con retención explícita. No hay RPC de tokens o firma
  arbitraria, ni secretos entregados al renderer, preload o Electron main.
- Access/refresh se cifran en el store existente sólo junto a SSA/SAS verificadas.
  La recuperación exige coincidencia exacta con ambas secuencias activadas en
  SQLite y una conexión ya vinculada. Guardar el archivo antes del commit SQLite
  no basta para recuperar credenciales; fallo de activación las cierra.
- La renovación interna `renewAuthorization` consume duraderamente el refresh
  local antes del transporte. Una entrega incierta, cancelación o caída exige
  nuevo login; no reintenta el token viejo. Serializa solicitudes, conserva el
  límite absoluto local y renueva SSA/SAS mediante HTTPS/posesión fresca. No
  añade polling ni selecciona intervalos productivos.

## Evidencia y correcciones

Resultados, comandos y hashes en
[windows-v2-ssa-sas-evidence-2026-10-25.json](windows-v2-ssa-sas-evidence-2026-10-25.json).
Pruebas nuevas: composición V2/SSA/SAS, RBAC vacío, contexto incorrecto,
revocación de familia/credencial, evidencia serializada, rollback; DPAPI con
reapertura/reinicio de identidad, rotación, concurrencia, red/canal perdido,
retención y fallo de activación. Regresiones seleccionadas únicamente por
dependencia modificada: verifier V2, coordinador nativo y E2E previo de custodia.

Electron real recorre formulario HTTPS → contraseña/WebAuthn virtual → BUSINESS
→ solicitud nativa/PKCE → canje → V2/DPAPI → SSA/SAS → renovación HTTPS → permisos
SQL → dashboard. Catálogo sigue UNAUTHORIZED. No hay grants artificiales fuera
del fixture SQL del laboratorio, autenticador humano ni certificación productiva.

Fallos intermedios conservados: ruta refresh no añadida inicialmente a la
allowlist del host aislado; tipos de fixture V1/V2 y propiedad de provisión E2E;
expectativa de ausencia de archivo aunque begin escribe tombstone CLOSED;
aserción de evento sin prefijo canónico, conteo histórico global y else del
fixture asociado al if equivocado. Se corrigieron rutas/tipos/aserciones sin
relajar verificadores o políticas. Los reportes fallidos permanecen en artifacts.

El build Service conserva hash porque main productivo aún no monta este
coordinador: esto NO acredita runtime productivo por compilar clases aisladas.

## Bloqueos externos verificables y siguiente gate

| Requisito | Dato/decisión pendiente | Qué no se hace automáticamente |
|---|---|---|
| SQL/runner | Aceptar coste global RBAC ya medido; timeout/reintentos, owner/EXECUTE y números/predecesores Identity/Authorization | Registrar propuestas como migraciones productivas o conceder UPDATE RBAC |
| Parámetros | Access, familia refresh, MFA/reautenticación, retención/cadencia Service y abuso HTTP durables | Usar los valores explícitos de estos fixtures como política comercial |
| Central/DEV-003 | Operador, origen HTTPS/RP/cliente registrados, TLS, DB, raíces públicas verificadas, claves de custodia, tenant/empresa/sucursal e instalación/dispositivo auténticos | Inventar dominios, claves, activaciones o una persona |
| Certificación | Persona autorizada y autenticador físico; CI exact-head cuando se restablezca | Declarar producción por Electron/CTAP2 virtual o disparar Actions |

La aprobación general SAS/access ya fue otorgada y no se vuelve a solicitar.
Falta el montaje final en main productivo con configuración validada y runner
aprobado: no está habilitado y no se elimina su bloqueo. La recuperación/renovación
automática del runtime necesita esa composición y sus políticas, no una API en React.
Licencias y caché continúan después de este gate, sin presentar el login humano
como certificado. No merge ni cambios workflows.

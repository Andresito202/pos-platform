# Composición Android de seguridad y enrolamiento — 2026-10-22

Base `f1e5a0bb21009608eb49f6f0dcd6435e0d39bd37`, misma rama `feat/android-commercial-runtime`. Incremento interno, sin habilitar producción. PR #96 y #92 permanecen draft.

## Cambio y contrato

`AndroidSecurityFoundation` compone los componentes existentes en orden `local-database → local-security → device-enrollment`. No cambia el entry Windows/Linux ni el APK instalado. Es la siguiente etapa interna al fundamento sin aprovisionar; no constituye otro motor ni otro protocolo de enrolamiento.

Recibe exclusivamente del host privilegiado binding de instalación, instancia de `AndroidKeystoreKeyProvider`, instancia de `DeviceTrustVerifier` con confianza central y reloj explícito. Valida/copia los IDs; no los trata como evidencia. El proveedor se destruye al finalizar el arranque, también si falla. Los almacenes derivados permanecen hasta detener sus componentes y se destruyen en orden inverso. Un fallo parcial de local-security limpia el almacén antes del rollback de la base.

Reutiliza `LocalSecurityComponent`, `deviceIdentityContext`, `DeviceEnrollmentService.prepare/complete`, contratos Activation/Request/Result y almacén `device-trust:<installation>:<device>` existente. La generación de identidad Ed25519 es la operación canónica DEC-020; no se inventa una identidad central ni una sesión. `requireVerifiedDevice` revalida firma, binding, vigencia, revocación operacional, clave pública local y asiento canónico completado **en cada llamada y al reabrir**. Devuelve únicamente una credencial pública de dispositivo; no es evidencia de persona, MFA, licencia, BUSINESS o permiso.

Defecto corregido en el coordinador canónico: una credencial central auténtica para **otra clave pública** con los mismos IDs antes superaba `complete`. Ahora compara SPKI DER con la identidad local antes de persistir. Se conserva el verificador central existente.

Límite explícito: el archivo cifrado y SQLite no admiten un commit distribuido. Si falla la auditoría después de escribir la credencial, el archivo puede permanecer; esta composición rechaza utilizarlo y rechaza el siguiente arranque por ausencia de `DEVICE_ENROLLMENT_COMPLETED`. No elimina/reemplaza secretos ni simula rollback de archivos. La recuperación requiere procedimiento explícito; no se habilita una reparación automática.

## Evidencia ejecutada

- `pnpm --filter @pos-platform/pos-local-service test -- tests/android-security-foundation.test.ts tests/device-enrollment-service.test.ts`: **16/16**, exit 0 (11 nuevas + 5 del coordinador modificado). SQLite real temporal, semillas/firmas exclusivamente de fixtures. Log local `artifacts/android-runtime/2026-10-22/security-foundation-tests.log`.
- `pnpm --filter @pos-platform/pos-local-service typecheck`: exit 0, `security-foundation-types.log`.
- `pnpm architecture:check`: 16 validaciones y ARCH-003 PASS, exit 0.

Casos observados: dependencias serializadas rechazadas, acceso antes de READY, identidad local persistente, semilla destruida, activación de otro tenant, replay de activación/resultado, firma alterada, clave local diferente, vigencia, revocación, competencia single-writer, raíz incorrecta, fallo de auditoría y rechazo tras reapertura, liberación del writer después de fallo. No se repiten MFA, Argon2id, suites comerciales ni pruebas físicas anteriores.

No se conectó un caller al APK: faltan binding/activación centrales reales y confianza pública provisionada. El APK `3f9b8014…` de custodia sigue siendo el último entregable físico; no contiene esta composición y no se le atribuyen estas pruebas. No hubo impresión, pulso ni operación comercial física en este incremento.

## Dependencias que continúan cerrando el acceso

Se conserva **una solicitud conjunta**, [custodia y acceso](android-custody-2026-10-22.md#solicitud-conjunta-pendiente-antes-del-siguiente-arranque-comercial), con la solicitud D3 enlazada allí. Faltan: perfil Android SEC-004 aprobado, configuración/activación DEV-003 reales y confianza central, protocolo de acceso BUSINESS con RP/origen HTTPS real/políticas/abuso aprobados, y contrato de origen/transporte/distribución React DEC-025. No se consideran aprobados por esta misión.

El canal actual es Windows-only; no basta quitar su guard o publicar un WebSocket. El servidor de frames, MAC, replay SQLite, connectionId asignado por servidor, handlers y vínculo SSA se reutilizarán cuando se apruebe su transporte Android y custodia del extremo nativo. No se entrega el secreto del canal a React. El pipe heredado actual solo transporta custodia y STOP.

Sin esa autoridad no se activa React ni se emite SSA/sesión, y tampoco se ejecutan ventas/PRINT_RECEIPT físicos. La composición de outbox/comercial existente no se reconstruye. El próximo arranque con autoridad debe verificar el dispositivo antes de exponer operaciones y conservar los verificadores SSA/RBAC existentes.

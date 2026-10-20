# Camacho POS — revisión de integración visual y contrato SSA

## Alcance (2026-10-20)

Esta revisión es estática sobre la rama activa de PR #92. **No certifica una ejecución Windows/Electron ni la existencia de un servicio central de login completo**. El diseño se adapta al POS; ningún componente visual puede elegir identidad, permisos, roles ni clave de firma.

## Contrato comprobado

- `packages/contracts/src/session-assertion.ts` define `SignedSessionAssertionSchema`: sobre `{ claims, signature }`; incluye `user_id`, `tenant_membership_id`, `installation_id`, `device_id`, vigencia, secuencia y `key_id`. Rechaza roles o permisos dentro de la SSA.
- `packages/contracts/src/ipc-commercial.ts` define `session.activate` con `{ session_assertion: SignedSessionAssertionSchema }`. **No recibe contraseña ni usuario declarativo**.
- `apps/pos-local-service/src/security/session-assertion-verifier.ts` verifica Ed25519 sobre `canonicalJson(SessionAssertionClaimsSchema.parse(claims))`; consulta clave operacional confiable, ventana temporal, binding y secuencia anti-replay.
- `apps/pos-local-service/src/session/session-activation.ts` persiste únicamente tras resultado `VALID`; recuperación verifica de nuevo.
- `apps/central-authority/src/session-trust-key-issuer.ts` firma la **clave pública operacional**, no proporciona por sí mismo una emisión SSA de inicio de sesión.
- `apps/pos-desktop/src/preload-api.ts` expone `session.activate`, `session.recover` y consulta de capacidades; no expone `auth.login`. No se identificó en la búsqueda estática una implementación de `SessionAssertionIssuer` ni una ruta `auth.login`.

## Decisión obligatoria

1. La **autoridad central**, después de validar credenciales/MFA, es la única que debe emitir una SSA con su clave privada operacional segura. Nunca firmar en renderer, preload, Local Service, CSS o un mock.
2. La SSA se entrega a `session.activate` únicamente mediante el mecanismo confiable aprobado; no cambiar la forma ni la canonicalización.
3. El Local Service valida firma, clave, instalación, dispositivo, tiempo y secuencia; el snapshot de autorización controla permisos de forma independiente.
4. Los estados de carga y rechazo mantienen `fail-closed` y no muestran pantallas operativas. Los estilos de áreas no representan identidad ni sustituyen autorización.
5. **No conectar un formulario de credenciales todavía:** primero demostrar el endpoint central real, el transporte y la emisión SSA; de lo contrario sería una simulación de autenticación.

## Criterios de cierre antes de aprobar merge

- Registrar implementación real de UC-AUTH-001: contraseña, MFA, limitación de intentos, estado de dispositivo/tenant, registro de auditoría, sesión revocable.
- Comprobar desde el cliente real: central → SSA firmada → `session.activate` → permisos efectivos; rechazar firma inválida, replay, binding incorrecto y sesión expirada.
- Ejecutar `pnpm --filter @pos-platform/pos-desktop typecheck`, `build:renderer`, tests React y Electron en ambiente compatible.
- Confirmar visualmente el logo aprobado, pantalla de acceso y variaciones autorizadas; verificar foco, teclado, movimiento reducido, colores y cordón.
- Revisar CI de PR #92; no fusionar a `main` con gates fallidos.

**Resultado:** el verificador SSA existe; la firma de SSA asociada al login real y su entrega al renderer **no quedan demostradas** con los contratos inspeccionados. Las pruebas locales y de CI siguen siendo requisitos de cierre.

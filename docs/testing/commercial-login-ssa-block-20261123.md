# Bloqueo — login comercial SSA/SAS (2026-11-23)

Rama: `cursor/commercial-login-form-c53a`  
Auditoría reconfirmada sobre HEAD `a6de6ce8` y continuación del bloque A.

## Conclusión operativa

**No se puede completar** el flujo  
`credenciales humanas → SSA → session.activate → SAS → authorization.capabilities.get`  
sin inventar un emisor Central de SSA/SAS para el POS, ni sin desactivar validaciones.

Esta rama **no** fabrica identidades, claves ni snapshots.  
**No** habilita `POS_LOCAL_OPERATOR_AUTH_STORE` en producción.  
**No** usa `local-operator-development-bridge` como autoridad BUSINESS.  
**No** toca la PR #127 / rama SCM.

## Matriz de dependencias (A1)

| Pieza | Estado real | Montaje |
|---|---|---|
| Contratos IPC `session.activate` / `recover` / `capabilities.get` | Implementados | Allowlist + preload + handler |
| `CommercialRequestHandler.activate/recover/getAuthorizationCapabilities` | Implementados | Sí |
| `SessionActivationService` + verifier Ed25519 | Implementados | Sí (mapa de trust vacío → fail-closed) |
| Trust keys `SESSION_ASSERTION` (G1.2) | Implementados | Condicional a `POS_SESSION_TRUST_*` |
| `LocalChannelComponent` | Implementado | Solo `win32` |
| Device Trust + `CommercialDeviceCredentialProvider` | Implementado | Firma posesión hacia rutas comerciales |
| Constantes de path `/v1/business-session/assertions` y `/authorization` | Documentadas / possession | **Sin handler HTTP emisor en Central** |
| `BusinessBrowserSessionIssuer` | Implementado | Emite **cookie BUSINESS web** + MFA; **no** emite SSA del POS Electron |
| `SnapshotAcquisitionService` (SAS-003) | TESTED | **No** instanciado en `main.ts` (`DEC-020`) |
| `SnapshotProvider` HTTP productivo | Ausente | Solo fixtures de prueba |
| Emisor Central de SSA POS (humano + dispositivo) | **Inexistente** | `DEC-012` / `SEC-G02` NOT_EVALUATED; `DEC-020` D6 |
| UI renderer que llame `session.activate` | Ausente | E2E `real-channel` inyecta SSA de arnés de prueba |

## Por qué no se “completa Central” en esta rama

1. **`BusinessBrowserSessionIssuer` no es el emisor SSA del POS.** Produce `setCookie`/`csrfToken` para administración BUSINESS en navegador tras MFA. Confundirlo con SSA Electron inventaría un contrato.
2. **No hay ruta HTTP montada** en `central-authority` que responda `POST /v1/business-session/assertions` ni que entregue SAS firmado al dispositivo. Solo existen verificadores de posesión de dispositivo para esas paths.
3. **`SnapshotProvider` productivo no existe.** Cablear `SnapshotAcquisitionService` a un proveedor en memoria fabricaría confianza (`DEC-020` §3 lo prohíbe explícitamente).
4. **Login humano POS → SSA** pertenece a `SEC-G02` / alcance Central aún `NOT_EVALUATED`. Implementarlo aquí sin decisión de seguridad ratificada viola la gobernanza del repositorio.
5. El arnés `real-service-host` / `real-channel.spec.ts` firma SSA de prueba: válido para canal, **no** es evidencia de emisión comercial Central.

## Flujo objetivo (cuando exista el emisor)

1. Autenticación BUSINESS humana + MFA en Central (SEC-G02).
2. Posesión de Device Trust sobre el dispositivo enrolado.
3. Central emite SSA firmada (`SESSION_ASSERTION` operational key).
4. Desktop transporta SSA → `session.activate` (sin firmar en renderer).
5. Central entrega SAS; servicio adquiere vía `SnapshotAcquisitionService` + provider HTTP.
6. `authorization.capabilities.get` proyecta permisos del snapshot firmado.
7. Revocación/caducidad/recover siguen los handlers ya materializados.

## Separación vigente en el POS actual

| Concepto | Mecanismo actual | Comercial firmado |
|---|---|---|
| Operador local (solo `NODE_ENV=development`) | Password store + bridge | No |
| Vinculación de sesión | `session.activate` / `recover` | Sí, si hay SSA real |
| Permisos BUSINESS | SAS firmado en store | Sí, si hay SAS real |
| Permisos UI | Solo `capabilities.get` AVAILABLE | React no concede |

## Procedimiento pendiente Windows / Central

1. Ratificar e implementar emisor Central SSA/SAS para POS (SEC-G02 + contratos HTTP).
2. Publicar trust operacional y enrolar Device Trust en el terminal.
3. Conectar `SnapshotProvider` HTTP y montar `SnapshotAcquisitionService` en `main.ts`.
4. Conectar el formulario aprobado: tras emisión legítima → `session.activate` → capabilities.
5. Ejecutar negativos: SSA inválida, SAS caducado/revocado, empresa ajena, sin Device Trust.
6. Conservar bloqueo SCM; no modificar PR #127.
7. Capturas de Caja/roles solo con sesión firmada real.

## Commits de esta continuación

- Bloque A: este documento (bloqueo exacto; sin cableado inventado).
- Bloque B: correcciones visuales del login/Caja/supervisor/admin sin alterar autoridad.

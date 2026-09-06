---
name: dian-electronic-invoicing
description: Usar para cualquier trabajo relacionado con facturación electrónica, DIAN, CUFE, o integraciones con Siigo/Factus/Alegra en pos-platform.
---
# Facturación electrónica / DIAN

Estado actual — verificar en `docs/governance/materialization-state.md`, **no en
el backlog**, que marca `DONE` cuando el caso de uso está escrito:

- Los **cinco puertos de capacidad** existen en `packages/fiscal-adapters/src/ports/`.
- El **adapter FACTUS** existe y está `MOCK_TESTED`. Su autenticación sí está
  `SANDBOX_VERIFIED` contra el sandbox real; el adapter completo no.
- SIIGO y ALEGRA: **sin adapter**, faltan credenciales de prueba (gestión
  comercial, no ingeniería).
- No hay emisión fiscal real: no se ha emitido un solo documento.

Las decisiones ratificadas están en `docs/governance/fiscal-adapter-gate.md` §9.

Reglas:
1. Providers fiscales (Factus, Siigo, datáfonos) se integran vía adapters — nunca definen el
   dominio canónico de facturación.
2. El schema fiscal (migration 003) está `INTEGRATED` en PostgreSQL únicamente — SQLite sigue
   `NONE`. No inventes equivalencia.
3. Cualquier cambio fiscal conserva Modelo A (append-only, gates exact-head) — no se corrige
   con sobrescritura destructiva.
4. No marques nada como `NON_FISCAL` u operable en producción sin verificar el estado real en
   backlog.md primero.
5. Nunca generes credenciales, tokens o sandbox keys de DIAN/Factus/Siigo de ejemplo que parezcan reales.
6. **La credencial de cada proveedor tiene forma distinta** y ningún puerto ni
   tabla puede asumir «usuario y contraseña»: SIIGO usa `username` + `access_key`
   más un `Partner-Id` de plataforma; FACTUS cuatro valores en OAuth2 con
   refresh; ALEGRA email + token en HTTP Basic sin refresh. El núcleo guarda
   **referencia opaca**; sólo el adapter conoce la forma.
7. **`is_validated` es la evidencia fiscal de FACTUS**, no una cadena de estado.
   Y `data.errors` trae notificaciones DIAN que **no implican rechazo**.
8. Un timeout después de transmitir es `UNKNOWN_OUTCOME` y se resuelve por
   consulta o conciliación, **nunca** por vencimiento de plazo ni reemisión
   ciega: eso duplica una factura bajo otro consecutivo DIAN.

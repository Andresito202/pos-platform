---
name: dian-electronic-invoicing
description: Usar para cualquier trabajo relacionado con facturación electrónica, DIAN, CUFE, o integraciones con Siigo/Factus/Alegra en pos-platform.
---
# Facturación electrónica / DIAN

Estado actual (verificar en docs/product/backlog.md antes de asumir): SIIGO/FACTUS/ALEGRA están
`DESIGNED / NOT_EVALUATED`. No hay operación fiscal real todavía.

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

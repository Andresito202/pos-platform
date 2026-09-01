---
name: local-first-outbox-sync
description: Usar para cualquier trabajo sobre el POS Local Service, SQLite local, outbox/inbox o sincronización con el backend central en pos-platform.
---
# Local-first / Outbox / Idempotencia

Reglas no negociables del runtime objetivo (Renderer React → Electron main → POS Local Service → SQLite):
1. Una venta ordinaria autorizada debe poder confirmarse SIN Internet.
2. El POS Local Service es el ÚNICO proceso que escribe SQLite. El renderer nunca abre SQLite,
   nunca ejecuta reglas financieras, nunca accede directo a hardware o secretos.
3. Toda operación crítica (venta, pago, ajuste de inventario) conserva identidad, checksum y
   causalidad para soportar retry sin duplicar efectos.
4. Sin last-write-wins genérico: el reloj local de una terminal no decide autoridad global sobre
   datos compartidos.
5. Sync usa patrón Outbox/Inbox — no llamadas directas síncronas al backend central desde el flujo
   de venta local.

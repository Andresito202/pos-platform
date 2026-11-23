# 3C-3 — Salsamentaria / balanza (evidencia local)

## Reutilizado

- `WindowsCh340Transport` + perfil absoluto `windows_scale_profile_file`
  (`port` COM*, `pnp_device_id` VID_1A86/PID_7523, `cash_register_id`,
  protocolo `TEK_ATLAS_ASCII_CRLF_9600_8N1`).
- `Ch340ScaleReader` (cero estable, ventana estable, consumo único, stale,
  disconnect/reconnect).
- `scaleQuantity` → cantidad scale-6 por `KGM`/`GRM`.
- `hardware.command` / `capture_weight` ligado a caja con turno abierto.
- `inventory.transform.execute` (salsamentaria) con lotes/vencimiento comercial.

El puerto **no** es fijo: pertenece al perfil del dispositivo autorizado.
Referencias históricas a COM5 son de laboratorio, no contrato de instalación.

## Pruebas ejecutadas en este bloque

- `tests/ch340-scale-reader.test.ts`
- `tests/windows-ch340-transport.test.ts`
- `tests/scale-quantity.test.ts`
- `tests/salsamentaria-transform.test.ts`

## No acreditado aquí

- Certificación física nueva en hardware real de esta corrida de agente
  (entorno Linux sin puerto CH340). La lógica de binding/serial se mantiene
  fail-closed hasta que el perfil y el dispositivo coincidan en Windows.

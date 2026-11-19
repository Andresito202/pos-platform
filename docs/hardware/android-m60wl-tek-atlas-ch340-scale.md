# Balanza TEK ATLAS + CH340 en M60WL — evidencia de campo y perfil para adaptador

**Registro:** 2026-11-06. **Responsable de la observación:** operador del equipo.  
**Alcance:** lector físico externo `Camacho POS Print Mini` + Firefox/Violentmonkey + MásControlApp, **no** ventas nativas de Camacho POS.  
**Estado del perfil en Camacho POS:** `UNTESTED` hasta implementar el adaptador y superar pruebas propias. **No declarar `CERTIFIED`.**

## Identificación observada

| Componente | Valor / alcance |
|---|---|
| Terminal | M60WL, Android 9, Qualcomm msm8953_64; build `qti/msm8953_64/msm8953_64:9/PKQ1.190504.001/Data.BU08121737:user/release-keys` |
| Báscula | TEK ATLAS (denominación informada por el operador; pendiente fotografía de placa, revisión, firmware y metrología legal) |
| USB serial | CH340, VID `0x1A86` (6790), PID `0x7523` (29987) |
| Configuración serie | 9600 baudios, 8 bits, sin paridad, 1 stop bit |
| Muestra recibida | Texto ASCII de lectura decimal en kg, p. ej. `000.455\r\n`; cero `000.000\r\n` |
| App externa que realmente lee USB | `co.camachopos.printmini`; componentes `ScaleLoopbackService`, `ScaleBridgeActivity`, `ScaleBootReceiver` y actividad de autorización |
| Consulta local externa | GET `http://127.0.0.1:18766/v1/weight`, limitada a loopback del M60WL; no conectar por LAN |
| Consumidor probado | Firefox con Violentmonkey en MásControlApp; la web calcula importes y descuentos |
| Impresora de ese terminal | Gprinter GP-L80160, USB VID 26728/PID 1280 según evidencia previa; capacidad independiente del CH340 |
| Cajón | 3nStar CD350 reportado; no atribuir a esta prueba certificación eléctrica de apertura |

**Importante:** el VID/PID identifica la familia del chip adaptador CH340, **no** una TEK ATLAS única. Otro equipo podría compartir esos IDs. La configuración comercial requiere vincular una báscula concreta y confirmar puerto/topología, trama y estabilidad; rechazar 0 o más de 1 candidato sin selección explícita.

## Lectura, eventos y seguridad observados

- El servicio Android abre **solo** el CH340 autorizado por Android, no la Gprinter. Mantiene HTTP en loopback, lectura USB y supervisión de desconexión en procesos/hilos independientes.
- Una muestra válida tiene la forma decimal exacta de tres cifras después del punto; la política del laboratorio filtró pesajes entre **0.100 y 40.000 kg** en incrementos de 0.005 kg. Esto es un **límite de software del ensayo**, NO la capacidad homologada de la balanza.
- El lector estima estabilidad a partir de múltiples muestras (al menos cinco y alrededor de 750 ms de observación, dispersión máxima de 0.010 kg); no equivale a la indicación legal de estabilidad del fabricante.
- Tras cero estable se habilita una nueva lectura positiva estable. Un evento se identifica con `session` + `eventId`; el servicio entrega `status`, `ageMs` y `kg` **solo** si el evento sigue fresco (`ready`, hasta 2 s en servicio; consumidor anterior aceptaba hasta 1.8 s).
- Al perder el USB se invalida la lectura; el supervisor reintenta la conexión. Cuando el proceso reinicia, cambia la sesión. No restaurar un peso anterior ni crear un segundo evento sin volver a pasar por cero.
- MásControl permitió varias filas del mismo producto; el script escribía solo si **exactamente una** fila elegible tenía cantidad vacía y no sobrescribía una cantidad manual. Precio, descuentos y total permanecieron bajo MásControl.
- En Android 9 un reinicio con CH340 ya conectado puede producir `usb_permission_missing` aun cuando `dumpsys usb` conserve `device_preferences` para `co.camachopos.printmini`. El operador informa que la versión posterior de Print Mini presenta **Activar báscula → Permitir** y oculta el aviso al recuperar la lectura. No prometer autorización totalmente silenciosa después de un reinicio.

## Evidencia funcional reportada (2026-11-06)

| Ensayo | Resultado reportado | Alcance |
|---|---|---|
| Pesaje único y múltiples pesajes del mismo producto | PASS observado; cantidades `0.555`, `0.975`, `0.520`, `0.455` kg y recálculo por MásControl | Tercero, no Camacho POS |
| Cantidad manual `0.300` frente a báscula `0.920` | No se sobrescribió | Userscript externo |
| Retirar y recolocar el producto varias veces | No se reescribió ni duplicó la cantidad inicial | Userscript externo |
| Desconectar CH340 | `usb_error` en v0.21; `usb_not_found` en v0.22 | Bridge externo |
| Reconectar CH340 | `waiting_weight` y nuevo pesaje ingresado automáticamente | Bridge externo |
| Reiniciar Android con USB conectado | Servicio HTTP reinicia; permiso USB **no** persiste; luego se recuperó al reconectar | Límite Android 9 |
| Botón «Activar báscula» | El operador confirma su funcionamiento y ocultación automática del aviso | Versión externa posterior, no comprobada mediante CI de Camacho POS |
| Impresora / corte / cajón después de actualizar | Pendiente evidencia de regresión física consolidada en esta entrega | No elevar estado |

No hay aquí registro de pesas patrón calibradas, placa/firmware de báscula, precisión legal, ensayo de todos los errores, aprobación fiscal/metrológica o piloto comercial. La observación externa no satisface por sí sola la certificación de hardware en `docs/hardware/support-matrix.md`.

## Integración nativa requerida en Camacho POS (no implementada por este registro)

1. **Detección y asociación:** añadir `SCALE` a los tipos de hardware, descubrimiento Android USB host con permiso del sistema, perfil de dispositivo ligado a caja/sucursal y elección inequívoca cuando aparezcan varios CH340. Validar trama y versión; nunca asumir marca solo por VID/PID.
2. **Adaptador aislado y versionado:** portar parser serie, watchdog, estabilidad, zero-gating, sesión/evento y reinicio a la frontera `hardware` del runtime Android; exponer `health` y lectura tipada `ScaleMeasurement`. Nunca abrir impresora/cajón desde el adaptador de báscula.
3. **Seguridad del origen:** `http://127.0.0.1:18766` es un puente local **sin autenticación de fuente** para un ensayo con tercero. No elevar directamente ese JSON a una venta de Camacho POS; preferir servicio nativo confiable o canal autenticado del propio runtime, validación de origen/dispositivo y frescura, y controlar acceso por permisos.
4. **Integración comercial:** un evento consumible una vez, confirmado para la fila correcta por el operador o política aprobada. Usar unidad/precisión del catálogo (`MASS`, kg, escala permitida); el servicio de ventas, no el adapter ni renderer, calcula precios, descuentos, impuestos y persistencia. No rellenar campos ocultos ni auto-facturar.
5. **UI:** en Hardware mostrar detección real, estado `CONECTADA`/`SIN PERMISO`/`DESCONECTADA` solo cuando exista backend real; ofrecer autorización Android cuando sea legítima. En venta mostrar último peso y estado solo con permiso y binding de caja, sin controles ficticios.
6. **Pruebas de salida:** parser con tramas completas/parciales/corruptas, cero/negativos/sobrecarga/unidad errónea, antirreplay y timeout, desconexión, reinicio, USB duplicado, permiso denegado, varios renglones, cantidad manual, venta offline, monetaria, compatibilidad impresión/corte/cajón y prueba con pesa patrón calibrada.

Archivo de datos de referencia (no activa un adaptador): `docs/hardware/profiles/tek-atlas-ch340-m60wl.lab.json`.

## Respaldo e instalación externa

La APK **Print Mini** abarca servicio de impresión y servicio de peso en el **mismo paquete** `co.camachopos.printmini`. Para volver a instalar se utiliza una copia de ese APK firmada con la misma identidad: no hace falta instalar dos APK. Mantener el archivo APK y SHA-256 fuera de Git; un APK de laboratorio/debug no constituye release comercial.

Al reinstalar después de desinstalar, Android puede perder permisos USB, configuración de servicio de impresión, preferencias y datos de la app. Confirmar impresora/corte/cajón, báscula y autorización de Android. El archivo de copia no conserva datos privados de la aplicación ni su configuración. No guardar claves de firma ni secretos en una USB de uso común.

**No retirar apps Android por su nombre** (Quick Printer, Printer, HardwareManager, etc.) sin comprobar servicio de impresión predeterminado, vínculos hardware y dependencias reales.

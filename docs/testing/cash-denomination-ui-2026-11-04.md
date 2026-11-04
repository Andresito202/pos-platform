# Selector de billetes y monedas en caja — 2026-11-04

## Alcance

Esta intervención continúa sobre `feat/android-commercial-runtime`, modificando **únicamente presentación y estado local de selección física**. No modifica backend, contratos, permisos, idempotencia, ventas, caja, cambio definitivo ni conciliación.

`SalePanel.tsx` y `commercial-precision.css` presentan seis billetes y cinco monedas de Colombia de manera **independiente**, con una acción para sumar una unidad y otra para restar una unidad. Las cantidades se guardan localmente en el renderer y se limpian al borrar o reiniciar la venta.

Cada imagen se obtiene opcionalmente del recurso estático `./payment-denominations/billetes/billete_<valor>_cop.png` o `./payment-denominations/monedas/moneda_<valor>_cop.png`. El botón conserva su texto y operación si la imagen todavía no está instalada. Dado que las fotografías son binarias, **no se publicaron las imágenes al repositorio mediante la integración de GitHub**: están en el ZIP entregado al propietario y hay un instalador local `Instalar_Imagenes_POS.ps1`. No declarar que las imágenes se visualizan en el runtime de GitHub hasta copiar los assets y ejecutar build.

## Regla de cálculo

- El total de la venta, `sale.sale.payableAmount`, procede del backend.
- El importe de este pago, `paymentAmount`, se conserva exactamente como antes. Si está vacío se usa el total vigente del backend.
- El efectivo entregado se calcula sumando `valor × cantidad` de cada denominación, más el valor de entrada manual. Se utiliza `BigInt` para **no redondear** importes enteros ni seis decimales.
- La diferencia previa visible está marcada como **estimación** de cambio o falta, nunca se persiste como resultado del cobro.
- El único cobro real continúa mediante `sale.chargeCash(tendered || undefined, paymentAmount || undefined)` y usa la respuesta `sale.payment.change_amount` para mostrar el **cambio definitivo**. Seleccionar billetes no realiza transacción, no confirma venta, no altera saldo de caja ni comunica otra entidad de pago.
- Los pagos parciales, autorizaciones, bloqueo de acciones no materializadas, transferencia manual, cambio de turno e idempotencia conservan el contrato anterior.

## Recursos proporcionados y procedencia

ZIP de entrega: `camacho_pos_denominaciones_individuales.zip` (fuera del repositorio; sin dependencia de red ni scripts de terceros).

| Tipo | Valores, COP |
| --- | --- |
| Billetes | 2.000, 5.000, 10.000, 20.000, 50.000, 100.000 |
| Monedas | 50, 100, 200, 500, 1.000 |
| Marcas | Nequi (SVG/PNG del ZIP del usuario); DaviPlata (PNG del vector Illustrator aportado); QR pictograma genérico no escaneable |

Se conservaron fotografías de origen para los billetes y monedas; se recortaron los fondos de las monedas y se respetó la relación de aspecto. Las imágenes agrupadas generadas antes **no** se utilizan como fuente, pues una recreación generativa de billetes puede deformar detalles e importes.

**Nota de marca:** el archivo DaviPlata de su manual corresponde a una versión diferente de la captura antigua aportada. No presentar ambos como idénticos. Los logos quedan pendientes de aprobación visual y no suponen convenios o integración bancaria.

## Instalación del paquete de imágenes en PC

1. Extraer el ZIP en una carpeta local.
2. Ejecutar PowerShell desde la carpeta extraída:
   ```powershell
   .\Instalar_Imagenes_POS.ps1 -Repositorio 'C:\Proyectos\pos-platform'
   ```
   O copiar manualmente `billetes`, `monedas`, `logos` a `apps/pos-desktop/renderer/public/payment-denominations/`.
3. Verificar que cada archivo PNG existe y revisar `git status`.
4. Probar el renderer: `pnpm --filter @pos-platform/pos-desktop run typecheck` y `pnpm --filter @pos-platform/pos-desktop run build:renderer`.
5. Probar la interfaz: `pnpm --filter @pos-platform/pos-desktop exec vitest run tests/renderer/SalePanel.test.tsx`.
6. Validar Electron real, modo táctil, teclado, visualización en pantallas angostas y estado offline.

## Corrección de renderizado y ampliación posterior

Se corrigió el orden de inicialización React: `paymentAmount` se evaluaba al crear `previewPayable` **antes** de ejecutar su `useState`, lo cual podía lanzar `ReferenceError` durante renderizado. Ahora `paymentAmount` y `paymentId` se inicializan previamente.

Se añadió el valor `100` al catálogo local `cashDenominations`, cuya ruta de imagen resultante es `./payment-denominations/monedas/moneda_100_cop.png`. El ZIP `camacho_pos_denominaciones_individuales_v2.zip` contiene ese archivo. Se añadió prueba de dos monedas de 100 COP, importe visible de 200 COP y ninguna llamada a `payment.register.cash` al seleccionar.

**Verificación remota:** inspección del código y ZIP. GitHub sólo informó un flujo `strix-penetration-test` exitoso para el commit; no equivalió a Vitest ni a certificación Electron.

## Comprobaciones de código

Por inspección remota de GitHub se constató que `sale.chargeCash`, `sale.registerTransfer`, permisos y `data-testid` históricos siguen presentes; se añadieron cuatro tests de denominaciones (incluida la moneda de 100 COP), combinación con teclado y borrado. **No se ejecutaron TypeScript, Vitest ni Electron en el PC**. Los tests agregados no acreditan PASS hasta ejecutarse.

La validación visual de marcas y moneda queda a cargo de la aprobación del propietario. No integrar a `main` sin gates/PR.

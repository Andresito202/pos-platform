# Iconos de medios de pago — procedencia y límites

Fecha: 2026-11-04. Alcance: **presentación únicamente**. No implica habilitación de una API, convenio bancario, QR interoperable ni validación automática de transferencias.

## Iconografía que sí está integrada

Cinco SVG originales, copiados sin modificación desde `lucide-icons/lucide`:
- Efectivo: `banknote.svg`.
- Transferencia manual: `landmark.svg`.
- Tarjeta: `credit-card.svg` (el método sigue deshabilitado).
- QR integrado: `qr-code.svg` (el método sigue deshabilitado).
- Fiado/crédito: `notebook-pen.svg` (el método sigue deshabilitado).

Ruta: `apps/pos-desktop/renderer/src/assets/payment-icons/`.

Origen fijado: https://github.com/lucide-icons/lucide/tree/91a1359b5ea235f620ba3a9682015ab8d6ada3af/icons

Licencia original preservada: `LICENSE.lucide.txt` (ISC, con atribuciones MIT para componentes Feather).

Se usa cada imagen como decoración accesible (`alt=""`, `aria-hidden`). Los botones conservan etiquetas, IDs `data-testid`, permisos, estados `disabled` y handlers previos. No se añaden dependencias ni llamadas externas: las imágenes se empaquetan localmente con Vite. La denominación transferencias/Nequi/Daviplata sigue siendo una **única** operación manual: el backend no recibe una marca separada.

## Marcas auténticas localizadas, todavía NO integradas

### Nequi

- Fuente del titular: https://www.nequi.com.co/conocenos/sala-de-prensa
- Sección: **Kit de prensa → Logos**. Nequi publica el logotipo en varios formatos.
- Estado: `OFFICIAL_SOURCE_IDENTIFIED / ORIGINAL_BINARY_NOT_RETRIEVED / USAGE_NOT_CLEARED`.

### DaviPlata

- Fuente del titular: https://sunegocio.daviplata.com/es/documentacion
- Archivo ofrecido por el titular: `Logo y manual DaviPlata.zip` (documentos complementarios, API Pago DaviPlata).
- URL de archivo publicada por la propia fuente: https://sunegocio.daviplata.com/sites/default/files/2022-10/Logo%20y%20manual%20DaviPlata.zip
- Condiciones del portal: https://sunegocio.daviplata.com/sites/default/files/2021-10/davivienda_terminos_condiciones-devportal.pdf
- Estado: `OFFICIAL_SOURCE_IDENTIFIED / ORIGINAL_BINARY_NOT_RETRIEVED / COMMERCIAL_USE_REQUIRES_RIGHTS_REVIEW`.

**No reemplazar** el original por trazados de Wikimedia, espejos de terceros o imágenes recreadas sin informar la procedencia. Si se incorporan las marcas, almacenarlas localmente tras inspección, verificación de vigencia y derechos de uso comercial, sin redibujar, recolorear ni hacerlas parecer un aval/alianza del titular.

## Restricciones funcionales

Separar Nequi y DaviPlata en botones **visualmente independientes y activos** exige decidir si el backend puede conservar la billetera seleccionada. La operación vigente es `registerTransfer` sin discriminación del proveedor. No inventar integración, conciliación o cobro confirmado. No tocar autorización, antifraude, caja o contratos sin decisión expresa.

## Verificación

Comprobado por inspección de archivos GitHub: cinco blobs SVG idénticos a la versión fuente, licencia presente, `onClick` y permisos preservados, código TSX variado sólo para agregar presentación de imágenes.

**Pendiente para certificar**: `pnpm --filter @pos-platform/pos-desktop run typecheck`, `pnpm --filter @pos-platform/pos-desktop run build:renderer`, tests de `SalePanel` y capturas reales (desktop, táctil y navegación teclado). No declarar PASS de esos comandos por inspección estática.

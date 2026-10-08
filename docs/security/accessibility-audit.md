# Auditoría de accesibilidad — texto alternativo, contraste y teclado

**Producto:** Camacho POS Colombia  
**Fecha:** 2026-10-07  
**Estado:** MATERIALIZADA — mejoras aplicadas en la línea activa; indicador de foco reforzado y verificado por contraste

## 1. Texto alternativo / nombres accesibles

La única imagen `<img>` del README ya tiene `alt` descriptivo. El logotipo dentro del renderer se expone como un elemento semántico con `role="img"` y `aria-label="Camacho POS Colombia"`.

Los inputs del renderer que antes dependían sólo de `placeholder` ahora tienen nombres accesibles mediante `aria-label`, preservando el aspecto visual y el contrato funcional. El checkbox de catálogo ya estaba contenido dentro de un `<label>` explícito y no se reescribió.

Archivos modificados en este bloque:

- `apps/pos-desktop/renderer/src/components/SalePanel.tsx`
- `apps/pos-desktop/renderer/src/components/CatalogPanel.tsx`
- `apps/pos-desktop/renderer/src/components/CustomerPanel.tsx`
- `apps/pos-desktop/renderer/src/components/InventoryPanel.tsx`
- `apps/pos-desktop/renderer/src/components/OperationPanel.tsx`
- `apps/pos-desktop/renderer/src/components/FiscalPanel.tsx`
- `apps/pos-desktop/renderer/src/components/ReceiptPanel.tsx`

Se añadió una prueba de renderer que verifica nombres accesibles en las pantallas autorizadas.

## 2. Contraste

Se revisaron los colores definidos en `apps/pos-desktop/renderer/src/App.css` y se calculó el contraste relativo conforme a la fórmula WCAG 2.x.

| Combinación | Contraste calculado | Resultado para texto normal |
|---|---:|---|
| `#ffffff` sobre `#172033` | 16.27:1 | Cumple AA |
| `#b9c2d0` sobre `#172033` | 9.06:1 | Cumple AA |
| `#1f5fae` sobre `#f4f6f8` | 5.86:1 | Cumple AA |
| `#5f6b7a` sobre `#ffffff` | 5.43:1 | Cumple AA |
| `#172033` sobre `#ffffff` | 16.27:1 | Cumple AA |
| `#263249` sobre `#ffffff` | 12.85:1 | Cumple AA |
| `#4d8fd1` sobre `#172033` | 4.78:1 | Cumple indicador de foco ≥3:1 |
| `#4d8fd1` sobre `#f4f6f8` | 3.14:1 | Cumple indicador de foco ≥3:1 |
| `#4d8fd1` sobre `#ffffff` | 3.41:1 | Cumple indicador de foco ≥3:1 |

Estos valores corresponden a las combinaciones explícitas observadas en la hoja principal. No se declara una certificación WCAG completa de toda la aplicación porque todavía no existe un gate automatizado que recorra todos los estados visuales.

## 3. Navegación por teclado

Los controles principales usan elementos HTML nativos (`button`, `input`, `select` cuando corresponda), por lo que conservan el orden de tabulación nativo. No se eliminó el outline del navegador.

Además, `App.css` incorpora `:focus-visible` para botones, inputs, selects y textareas, haciendo visible el foco de teclado con un contorno de 3 px y desplazamiento de 2 px. El color del indicador se reforzó a `#4d8fd1`: alcanza 4.78:1 sobre la barra lateral `#172033`, 3.14:1 sobre `#f4f6f8` y 3.41:1 sobre blanco; por tanto supera el mínimo 3:1 exigido para el indicador.

La prueba de renderer verifica nombres accesibles, pero **no se declara todavía una prueba E2E completa de navegación exclusivamente por teclado**. Esa distinción se conserva para no afirmar más de lo ejecutado.

## 4. Resultado

- Texto alternativo/nombres accesibles: **mejorado y probado en renderer**.
- Contraste de la paleta principal: **verificado manualmente sobre combinaciones observadas**.
- Foco visible: **materializado en CSS y corregido para contraste ≥3:1 en fondos claros y oscuros auditados**.
- Suite WCAG automatizada completa: **pendiente**.
- E2E completo de teclado: **pendiente**.

No se creó una segunda librería de accesibilidad ni se rehízo el renderer.

# Panel logo unify — evidencia visual 2026-11-23

## Alcance

Unificación del `BrandMark` del POS Desktop al lockup amarillo aprobado del login
(`docs/brand/camacho-pos-colombia-login-entry.png`), sin cajas artificiales detrás
del logo y sin el mark metálico azul legacy.

No cambia lógica comercial, permisos, caja, ventas ni licencias.

## Capturas (implementación final real)

Generadas con Electron + renderer compilado (`pnpm build:renderer`) y
`e2e/panel-logo-visual.spec.ts` el 2026-11-23.

| Archivo | Superficie |
| --- | --- |
| `01-login.png` | Login aprobado (referencia) |
| `02-sidebar-shell.png` | Sidebar + shell ADMINISTRADOR |
| `03-dashboard.png` | Dashboard administrativo |
| `04-sales.png` | Panel Caja y ventas (CAJERO) |
| `05-admin.png` | Auditoría administrativa |

Confirmación: estas capturas son de la implementación final de esta rama
(después de `BrandMark` + `brand.css` + ajuste sidebar en `workspace.css`).

## Assets

- **Antes (paneles):** `login.png` (header), `apilado.png` (sidebar ≥1025px),
  más caja `background: rgb(255 255 255 / 6%)` en `.pos-brand--sidebar`.
- **Ahora (todos los paneles BrandMark):** sólo `camacho-pos-colombia-login-entry.png`
  (RGBA transparente, misma familia visual del login).
- Legacy metálico (`logo.png` / `logo-960.png`) **no** se usa en BrandMark.

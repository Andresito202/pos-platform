# Panel logo unify — evidencia 2026-11-23 / 2026-11-24

## Qué faltaba (hallazgo de revisión)

1. El asset del logo se unificó al lockup transparente del login, pero la **zona
   del logo** en sidebar/header seguía sobre el flat `#152530` / fondo claro del
   header, sin el tratamiento navy/azul/ámbar del login aprobado.
2. Las capturas iniciales usaron `panel-logo-visual-entry.mjs` (stub). Eso
   **no certifica** apariencia con login comercial real.

## Qué se corrigió

- Stage local en `.pos-brand--sidebar` / `.pos-brand--header`: mismos gradientes
  familia que `.pos-entry-brand`, **sólo** alrededor del logo (no todo el panel).
- Logo sigue siendo `camacho-pos-colombia-login-entry.png` (RGBA transparente).
- Evidencia reclasificada: visual renderer ≠ certificación con login real.
- Captura adicional: sidebar colapsado.

## Niveles de evidencia (no confundir)

| Nivel | Qué demuestra | Qué NO demuestra |
| --- | --- | --- |
| **A — Visual renderer** | Asset + stage CSS en Electron compilado | Login comercial, RBAC, licencias |
| **B — Login UI unbound** | Pantalla de acceso real (smoke/unbound) | Sesión autenticada comercial |
| **C — Login real Windows** | Operador + local service físicos | *(fuera de este entorno Linux CI)* |

Las capturas de esta carpeta son **nivel A** (paneles) y **nivel B** (login).
**No** son certificación comercial nivel C.

## Capturas (HEAD de la rama)

| Archivo | Superficie | Nivel |
| --- | --- | --- |
| `before/*` | Estado previo al stage login-coherente | A (histórico) |
| `01-login.png` | Login UI unbound + BrandMark entry | B |
| `02-sidebar-expanded.png` | Sidebar expandido + stage | A |
| `03-dashboard.png` | Dashboard | A |
| `04-sales.png` | Caja y ventas | A |
| `05-admin.png` | Auditoría administrativa | A |
| `06-sidebar-collapsed.png` | Shell con menú oculto | A |

Enlaces HTTPS (rama `cursor/panel-logo-unify-c53a`) se publican en el cuerpo del
PR tras el push; rutas locales del repo:

`docs/testing/panel-logo-unify-20261123/`

## Assets BrandMark

- Única fuente UI: `docs/brand/camacho-pos-colombia-login-entry.png`
- No usados en BrandMark: `apilado.png`, `login.png`, `logo.png` metálico

# Refinamiento visual de acceso — 2026-11-04

## Alcance autorizado

Se realizó una mejora de diseño de **dos superficies existentes** sobre la línea activa `feat/android-commercial-runtime`, usando la dirección Commercial Precision B y criterios de `emil-design-eng`. No hay cambio de modelo de autenticación, dominio, contratos, rutas, eventos, handlers ni IPC.

1. `apps/central-authority/src/commercial-browser-entry.ts` — reemplazo exclusivo del texto CSS situado entre el comentario de presentación y el cierre `</style>`. Panel de marca azul oscuro, formulario claro, tipografía y espaciado, botones con jerarquía, estados de operación, contraste y media queries. El HTML de autenticación, los IDs, `WebAuthn`, MFA, CSRF, destinos, script nonce, respuesta HTTPS y CSP permanecen intactos.
2. `apps/pos-desktop/renderer/src/commercial-precision.css` — refinamiento exclusivo de reglas `.pos-entry*` y adaptación 800/600 px. La superficie Electron **no** solicita contraseña ni sustituye la ceremonia Central; sólo representa estados de autorización existentes. Los componentes `App.tsx`, `StatusPanel.tsx` y sus llamadas no se tocaron.

No se añadieron bibliotecas, fuentes remotas, imágenes generadas ni animaciones de entrada. Se reutiliza el logo oficial y los colores B existentes. El botón de reintento y los estados siguen sujetos a los mismos handlers/atributos.

## Comprobaciones estáticas ejecutadas a través de lectura de GitHub

- Bloque no CSS del módulo HTTPS: **idéntico** al baseline `913ea8cc6b24dfcd672f4f794e74b48ce3731c93`.
- Bloque JavaScript del documento HTTPS: **idéntico**.
- `res.writeHead`, headers CSP y permisos: **idénticos**.
- SHA del `App.tsx` renderer: **idéntico**.
- Balance de llaves del CSS de renderer: cero diferencias.
- Selector `[hidden]` respetado en el login HTTPS, incluido `#confirm`, para no mostrar acciones condicionadas por el estado.
- Comprobación matemática de contraste (WCAG luminancia relativa) para pares usados: blanco/navy **15.08:1**, blanco/verde primario **6.09:1**, blanco/ink **14.62:1**, subtítulo/navy **10.43:1**, estado informativo **7.86:1** y aviso **7.99:1**.

Estas comprobaciones son de **inspección estática**, no ejecución de pruebas automáticas del repositorio ni captura del runtime. No declarar PASS de Vitest, CI, Electron, Edge o Playwright en esta intervención.

## Pruebas que faltan antes de certificar visualmente

```powershell
pnpm --filter @pos-platform/central-authority run typecheck
pnpm --filter @pos-platform/pos-desktop run typecheck
pnpm --filter @pos-platform/pos-desktop exec vitest run tests/renderer/App.test.tsx
pnpm --filter @pos-platform/pos-desktop build
```

Revisar en Edge/Playwright y Electron real al menos 1440 × 900, 1024 × 768, 800 × 900, 390 × 844 y 320 × 700, con zoom 200 %, teclado sin ratón, `prefers-reduced-motion` y touch. Capturar pantalla Electron en `loading`, `unauthenticated`, `denied`, `expired` y `error`, y navegador HTTPS en `IDLE`, `AUTHENTICATING`, `MFA_REQUIRED`, `REJECTED` y `BUSINESS_VERIFIED`, únicamente con estados realmente alcanzables y sin grants falsos.

La certificación del login humano/SCM/DPAPI de Windows sigue separada y bloqueada por sus propios requisitos. Esta tarea no autoriza a mover el cierre del PR #99 ni declara el login comercial listo.

## Continuidad

Trabajo realizado en la rama PR #96; no integrar a `main` sin gates de gobernanza. No abrir rama paralela; evitar mezclar las mejoras estéticas con la misión del login Windows PR #99 hasta reconciliar SHA y CI. La prioridad siguiente es verificar capturas reales de los accesos y después abordar jerarquía/consistencia de Venta, Catálogo, Inventario y Administración sobre sus componentes actuales.

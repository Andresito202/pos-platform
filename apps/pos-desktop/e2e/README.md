# E2E — `@pos-platform/pos-desktop`

Arranque real de la aplicación Electron compilada, conducido por Playwright.
**Cinco specs en `boot.spec.ts`**, ejecutados en CI sobre `dist/` recién
construido.

## Qué cubre hoy

`boot.spec.ts` lanza el proceso principal compilado y comprueba, sobre la
ventana real:

1. el proceso principal arranca y abre una ventana;
2. el renderer compilado monta la aplicación;
3. la superficie comercial está montada en esa ventana;
4. el preload expone `window.posService` con la superficie completa;
5. el aislamiento de contexto sigue activo: el renderer no ve Node.

**Por qué existen estas cinco y no bastaban las unitarias.** `src/main.ts` era
un proceso principal completo que nunca se había ejecutado. Dos defectos reales
sólo aparecen al arrancar, y ambos son invisibles para `tsc` y para las pruebas
de `vitest` sobre jsdom:

- el bundle del renderer se emitía con rutas **absolutas**, que no resuelven
  bajo `file://` — corregido con `base: "./"` en `vite.config.ts`;
- el preload se emitía como **ESM**, y `sandbox: true` no admite ESM, así que
  `contextBridge` nunca corría y `window.posService` quedaba indefinido —
  corregido con una segunda construcción Vite en formato CJS
  (`vite.preload.config.ts`).

Con las 88 unitarias en verde, la aplicación abría una ventana en blanco. Esa
es la razón de ser de este directorio.

## Qué **no** cubre

La cadena hasta SQLite. `smoke-entry.mjs` es una entrada **de prueba** que
inyecta un `ServiceChannel` de doble: no hay named pipe ni servicio local
detrás. La cadena completa
`renderer → IPC → POS Local Service → Use Case → SQLite` sigue siendo objetivo
futuro y depende de la entrada de producción de Electron, hoy bloqueada por el
handshake autorizado.

## Cómo se ejecuta

El build es requisito: las specs apuntan a `dist/`.

```bash
pnpm --filter @pos-platform/pos-desktop build
xvfb-run -a pnpm --filter @pos-platform/pos-desktop test:e2e
```

`xvfb-run` es necesario en entornos sin servidor gráfico (contenedor y CI).

## Dos detalles del lanzamiento que no son opcionales

- **`executablePath` es obligatorio.** Sin él Playwright intenta descargar su
  propia copia de Electron, y esa descarga falla tras el proxy del entorno. Se
  apunta al binario que el repositorio ya fija (Electron 44.1.1), que además es
  el que se empaquetará: `createRequire(import.meta.url)("electron")`.
- **`--no-sandbox`.** CI ejecuta como root y el sandbox de Chromium rehúsa
  arrancar ahí. No relaja la seguridad de la aplicación: `WINDOW_SECURITY_CONFIG`
  —`contextIsolation`, `nodeIntegration` desactivada, `sandbox` del renderer— no
  se toca, y la quinta spec lo comprueba sobre la ventana real.

## Chromium

No se instala Chromium: estas pruebas conducen la aplicación Electron, que trae
el suyo empaquetado. `playwright.config.ts` no declara `projects` de navegador.
Si algún día se añaden pruebas de navegador puro:

```bash
pnpm --filter @pos-platform/pos-desktop exec playwright install chromium
```

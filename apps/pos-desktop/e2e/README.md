# E2E — `@pos-platform/pos-desktop`

Infraestructura preparada. **No contiene todavía pruebas funcionales del POS.**

## Objetivo futuro

```
renderer/UI → IPC (canal Electron pos:*) → POS Local Service → Use Case → SQLite → respuesta observable
```

## Qué hay aquí

- `playwright.config.ts` — configuración mínima. Sin `projects` de navegador:
  las pruebas lanzarán la app Electron completa, no una página aislada.
- Dependencias instaladas en `apps/pos-desktop/package.json`:
  `@playwright/test@1.63.0` (test runner) y `playwright@1.63.0` (expone
  `_electron`, no reexportado por `@playwright/test`).

## Cómo se lanza Electron con Playwright (API oficial, sin escribir aún)

```ts
import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";

test("la app abre una ventana", async () => {
  const app = await electron.launch({ args: ["<entrada compilada>"] });
  const window = await app.firstWindow();
  await expect(window).toHaveTitle(/.+/);
  await app.close();
});
```

`electron.launch()` sin `executablePath` usa por defecto
`node_modules/.bin/electron` del propio paquete — ya presente (Electron
44.1.1). **No requiere descargar un Chromium gestionado por Playwright**:
Electron trae el suyo empaquetado.

## Bloqueo real, documentado y no resuelto en este pase

**No existe un paso de compilación del proceso principal.** `tsconfig.json`
hereda `noEmit: true` de `tsconfig.base.json` y no hay script
`build:main` en `package.json` (sólo `build:renderer`, vía Vite). Por tanto
`args: ["<entrada compilada>"]` arriba no tiene hoy un archivo `.js` real al
que apuntar: `src/main.ts` no se emite.

Esto es una decisión de arquitectura de build (ESM vs CJS, bundler para el
proceso principal, ubicación de `dist/`) que corresponde a un bloque propio,
no a la preparación de Playwright. Se deja documentado en vez de improvisar
un `tsc --outDir` que no armoniza con el resto del pipeline.

## Cómo ejecutar (una vez existan specs)

```bash
pnpm --filter @pos-platform/pos-desktop test:e2e
```

## Chromium

No aplica un paso de instalación de Chromium para este objetivo: las
pruebas E2E aquí previstas conducen la aplicación Electron, no un navegador
Playwright gestionado. Si en el futuro se añaden pruebas de navegador puro
(sin Electron), instalar únicamente Chromium con:

```bash
pnpm --filter @pos-platform/pos-desktop exec playwright install chromium
```

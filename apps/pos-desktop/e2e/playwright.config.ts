import { defineConfig } from "@playwright/test";

/**
 * Configuración Playwright para E2E de `@pos-platform/pos-desktop`.
 *
 * Objetivo futuro (no implementado todavía): renderer/UI → IPC → POS Local
 * Service → Use Case → SQLite → respuesta observable.
 *
 * No se declaran `projects` de navegador: las pruebas futuras lanzan la
 * aplicación Electron directamente vía `_electron` (paquete `playwright`,
 * ver `e2e/README.md`), no una página de Chromium administrada por
 * Playwright. Electron trae su propio Chromium empaquetado.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  // Real-channel serial case covers sale + receipt + shift close over a live
  // socket; 30s was starving the final shift-close step under CI load after
  // auth remount. Tip local-operator live uses a higher per-suite budget.
  timeout: 90_000,
});

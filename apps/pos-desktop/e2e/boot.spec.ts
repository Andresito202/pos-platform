import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RENDERER_API_METHODS } from "../src/preload-api.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "smoke-entry.mjs");

/**
 * Electron ya está instalado como dependencia del proyecto. Sin
 * `executablePath`, Playwright intenta descargar su propia copia y la descarga
 * falla tras el proxy del entorno: se apunta al binario que el repositorio ya
 * fija, que además es el que se empaquetará.
 */
const require = createRequire(import.meta.url);
const executablePath = require("electron") as string;

let app: ElectronApplication;

test.beforeAll(async () => {
  // `--no-sandbox`: el entorno de CI ejecuta como root y el sandbox de Chromium
  // rehúsa arrancar ahí, impidiendo que Playwright se conecte. No relaja la
  // seguridad de la aplicación: `WINDOW_SECURITY_CONFIG` —`contextIsolation`,
  // `nodeIntegration` desactivada, `sandbox` del renderer— no se toca, y la
  // última prueba de este archivo lo comprueba sobre la ventana real.
  // Strip ELECTRON_RUN_AS_NODE (tip #106): Playwright may set it and Electron
  // then runs as Node without opening a BrowserWindow.
  const env = Object.fromEntries(Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
  ));
  app = await electron.launch({
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), entry],
    executablePath,
    env,
  });
});

test.afterAll(async () => {
  await app?.close();
});

test("el proceso principal compilado arranca y abre una ventana", async () => {
  const window = await app.firstWindow();
  await expect(window).toHaveTitle("Camacho POS Colombia");
});

test("el renderer compilado monta la aplicación", async () => {
  const window = await app.firstWindow();
  // The original identity replaces the hidden text eyebrow with the actual logo.
  const brand = window.getByRole("img", { name: "Camacho POS Colombia", exact: true });
  await expect(brand).toBeVisible();
  await expect.poll(() => brand.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(window.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
});

test("sin sesión vinculada muestra login local y no monta la superficie comercial", async () => {
  const window = await app.firstWindow();
  await expect(window.getByTestId("authorization-unauthenticated")).toBeVisible();
  await expect(window.getByRole("textbox", { name: "Usuario" })).toBeVisible();
  await expect(window.locator("#pos-local-password")).toBeVisible();
  await expect(window.getByRole("button", { name: "Ingresar" })).toBeVisible();
  await expect(window.getByTestId("sale-panel")).toHaveCount(0);
  await expect(window.getByTestId("authorization-error")).toHaveCount(0);
});

test("el preload expone window.posService con la superficie completa", async () => {
  const window = await app.firstWindow();
  const exposed = await window.evaluate(() => {
    const service = (globalThis as { posService?: Record<string, unknown> }).posService;
    return service === undefined ? [] : Object.keys(service).sort();
  });
  expect(exposed).toEqual([...RENDERER_API_METHODS].sort());
});

test("el aislamiento de contexto sigue activo: el renderer no ve Node", async () => {
  const window = await app.firstWindow();
  const leaked = await window.evaluate(
    () => "require" in globalThis || "process" in globalThis,
  );
  expect(leaked).toBe(false);
});

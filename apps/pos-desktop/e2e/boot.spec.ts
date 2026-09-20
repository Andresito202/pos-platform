import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RENDERER_API_METHODS } from "../src/preload-api.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "smoke-entry.mjs");

/**
 * Electron ya está instalado como dependencia del proyecto (44.1.1). Sin
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
  app = await electron.launch({ args: ["--no-sandbox", entry], executablePath });
});

test.afterAll(async () => {
  await app.close();
});

test("el proceso principal compilado arranca y abre una ventana", async () => {
  const window = await app.firstWindow();
  await expect(window).toHaveTitle("POS Local");
});

test("el renderer compilado monta la aplicación", async () => {
  const window = await app.firstWindow();
  await expect(window.getByRole("heading", { name: "POS Local" })).toBeVisible();
});

test("la superficie comercial está montada en la ventana real", async () => {
  const window = await app.firstWindow();
  await expect(window.getByTestId("sale-panel")).toBeVisible();
  await expect(window.getByTestId("open-shift-button")).toBeVisible();
});

/**
 * La sesion es la precondicion de todo lo demas y hasta este bloque no tenia
 * pantalla: `session.recover` estaba ruteado y nadie lo llamaba, de modo que un
 * equipo real abria su ventana sin vinculo y cada operacion se rechazaba con
 * `SESSION_NOT_BOUND` sin explicacion.
 *
 * No se exige aqui un desenlace concreto —`boot.spec` corre contra un canal
 * doble—: se exige que el panel exista en la ventana compilada y que no ofrezca
 * activar, porque activar necesita una SSA firmada que todavia no existe (D-28).
 */
test("el panel de sesion esta montado en la ventana real y no ofrece activar", async () => {
  const window = await app.firstWindow();
  await expect(window.getByTestId("session-panel")).toBeVisible();
  await expect(window.getByTestId("recover-session-button")).toBeVisible();
  expect(await window.getByTestId("activate-session-button").count()).toBe(0);
});

test("el panel de cobro por proveedor esta montado en la ventana real", async () => {
  const window = await app.firstWindow();
  await expect(window.getByTestId("provider-payment-panel")).toBeVisible();
  await expect(window.getByTestId("charge-qr-button")).toBeVisible();
  await expect(window.getByTestId("cancel-payment-button")).toBeVisible();
});

/**
 * Alcanzabilidad no es pantalla: el puente enrutaba las cinco operaciones de
 * crédito desde `f342f05`, pero ningún panel las ofrecía. Esta prueba mira la
 * ventana compilada real —no un DOM de prueba— y exige que el panel exista con
 * sus tres acciones: abrir cuenta, fiar una venta y registrar un abono.
 */
test("el panel de crédito está montado en la ventana real", async () => {
  const window = await app.firstWindow();
  await expect(window.getByTestId("credit-panel")).toBeVisible();
  await expect(window.getByTestId("open-credit-account-button")).toBeVisible();
  await expect(window.getByTestId("charge-to-credit-button")).toBeVisible();
  await expect(window.getByTestId("register-repayment-button")).toBeVisible();
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

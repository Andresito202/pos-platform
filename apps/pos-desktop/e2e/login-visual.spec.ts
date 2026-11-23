import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "smoke-entry.mjs");
const artifactDir = "/opt/cursor/artifacts/camacho-pos-login-refine-20261123";
const require = createRequire(import.meta.url);
const executablePath = require("electron") as string;

/**
 * Visual evidence for the commercial login gate only.
 * Uses the e2e smoke channel unbound contract (SESSION_NOT_BOUND → form).
 * Does not grant commercial permissions or open Caja.
 */
test.describe.configure({ mode: "serial" });

let app: ElectronApplication;
let window: Page;

async function setWindowBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
  const browserWindow = await app.browserWindow(window);
  await browserWindow.evaluate((win, next) => {
    win.setBounds(next);
  }, bounds);
}

test.beforeAll(async () => {
  mkdirSync(artifactDir, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
  ));
  app = await electron.launch({
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), entry],
    executablePath,
    env,
  });
  window = await app.firstWindow();
  await expect(window.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await expect(window.getByTestId("authorization-unauthenticated")).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

test("captura login limpio a 1366x768 sin superficie comercial", async () => {
  await setWindowBounds({ x: 0, y: 40, width: 1366, height: 768 });
  await expect(window.getByRole("textbox", { name: "Usuario" })).toBeVisible();
  await expect(window.getByRole("button", { name: "Ingresar" })).toBeVisible();
  await expect(window.getByTestId("sale-panel")).toHaveCount(0);
  await window.screenshot({
    path: join(artifactDir, "01-login-clean-1366x768.png"),
    animations: "disabled",
  });
});

test("captura denegación de credenciales sin conceder acceso", async () => {
  await setWindowBounds({ x: 0, y: 40, width: 1366, height: 768 });
  await window.getByRole("textbox", { name: "Usuario" }).fill("cajero.demo");
  await window.locator("#pos-local-password").fill("clave-incorrecta");
  await window.getByRole("button", { name: "Ingresar" }).click();
  await expect(window.getByRole("alert")).toContainText("Usuario o contraseña incorrectos.");
  await expect(window.getByTestId("sale-panel")).toHaveCount(0);
  await window.screenshot({
    path: join(artifactDir, "02-login-rejected-1366x768.png"),
    animations: "disabled",
  });
});

test("captura login a ~1920x1080", async () => {
  await setWindowBounds({ x: 0, y: 0, width: 1920, height: 1080 });
  await expect(window.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await expect(window.getByTestId("sale-panel")).toHaveCount(0);
  await window.screenshot({
    path: join(artifactDir, "03-login-1920x1080.png"),
    animations: "disabled",
  });
  await window.locator(".pos-entry-card").screenshot({
    path: join(artifactDir, "04-login-card-closeup.png"),
    animations: "disabled",
  });
});

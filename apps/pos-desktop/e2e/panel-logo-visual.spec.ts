import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const loginEntry = join(here, "smoke-entry.mjs");
const shellEntry = join(here, "panel-logo-visual-entry.mjs");
const artifactDir = process.env.POS_DESKTOP_VISUAL_ARTIFACT_DIR?.trim()
  || join(here, "artifacts", "panel-logo-unify");
const require = createRequire(import.meta.url);
const executablePath = require("electron") as string;

test.describe.configure({ mode: "serial" });

async function launch(
  entry: string,
  extraEnv: Record<string, string> = {},
): Promise<{ app: ElectronApplication; window: Page }> {
  const env = Object.fromEntries(Object.entries({ ...process.env, ...extraEnv }).filter(
    (pair): pair is [string, string] => pair[1] !== undefined && pair[0] !== "ELECTRON_RUN_AS_NODE",
  ));
  const app = await electron.launch({
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), entry],
    executablePath,
    env,
  });
  const window = await app.firstWindow();
  return { app, window };
}

async function setBounds(app: ElectronApplication, window: Page, width: number, height: number): Promise<void> {
  const browserWindow = await app.browserWindow(window);
  await browserWindow.evaluate((win, next) => {
    win.setBounds(next);
  }, { x: 0, y: 40, width, height });
}

async function assertTransparentBrand(window: Page, selector: string): Promise<void> {
  const brand = window.locator(selector);
  await expect(brand).toBeVisible();
  await expect.poll(() => brand.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const boxBg = await brand.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(boxBg === "rgba(0, 0, 0, 0)" || boxBg === "transparent").toBe(true);
}

test.beforeAll(() => {
  mkdirSync(artifactDir, { recursive: true });
});

test("01 login aprobado — logo entry transparente sin caja", async () => {
  const { app, window } = await launch(loginEntry);
  try {
    await setBounds(app, window, 1366, 768);
    await expect(window.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await assertTransparentBrand(window, ".pos-brand--entry");
    await window.screenshot({
      path: join(artifactDir, "01-login.png"),
      animations: "disabled",
    });
  } finally {
    await app.close();
  }
});

test("02–03–05 admin shell — sidebar, dashboard, administración", async () => {
  const { app, window } = await launch(shellEntry, { POS_LOGO_VISUAL_ROLE: "ADMINISTRADOR" });
  try {
    await setBounds(app, window, 1366, 768);
    await expect(window.locator(".pos-sidebar")).toBeVisible();
    await assertTransparentBrand(window, ".pos-sidebar .pos-brand--sidebar");

    await window.screenshot({
      path: join(artifactDir, "02-sidebar-shell.png"),
      animations: "disabled",
    });

    const dashboardBtn = window.getByRole("button", { name: "Dashboard" });
    await expect(dashboardBtn).toBeVisible();
    await dashboardBtn.click();
    await expect(dashboardBtn).toHaveAttribute("aria-current", "page");
    await expect(window.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await window.screenshot({
      path: join(artifactDir, "03-dashboard.png"),
      animations: "disabled",
    });

    const auditBtn = window.getByRole("button", { name: "Auditoría administrativa" });
    await expect(auditBtn).toBeVisible();
    await auditBtn.click();
    await expect(auditBtn).toHaveAttribute("aria-current", "page");
    await window.screenshot({
      path: join(artifactDir, "05-admin.png"),
      animations: "disabled",
    });
  } finally {
    await app.close();
  }
});

test("04 cajero shell — panel de ventas con logo sidebar unificado", async () => {
  const { app, window } = await launch(shellEntry, { POS_LOGO_VISUAL_ROLE: "CAJERO" });
  try {
    await setBounds(app, window, 1366, 768);
    await expect(window.locator(".pos-sidebar")).toBeVisible();
    await assertTransparentBrand(window, ".pos-sidebar .pos-brand--sidebar");
    const salesBtn = window.getByRole("button", { name: "Caja y ventas" });
    await expect(salesBtn).toBeVisible();
    await salesBtn.click();
    await expect(salesBtn).toHaveAttribute("aria-current", "page");
    await expect(window.getByTestId("sale-panel")).toBeVisible();
    await window.screenshot({
      path: join(artifactDir, "04-sales.png"),
      animations: "disabled",
    });
  } finally {
    await app.close();
  }
});

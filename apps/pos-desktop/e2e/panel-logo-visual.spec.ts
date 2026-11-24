import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Visual evidence of BrandMark + login-coherent logo stage in the compiled renderer.
 *
 * CLAIM BOUNDARY (binding):
 * - These captures prove UI chrome (logo asset + stage CSS) in Electron/renderer.
 * - The shell harness uses a stub channel for panel layout only.
 * - This suite does NOT certify commercial login, RBAC, licenses, or SSA/SAS.
 * - Real-operator certification remains on physical Windows + live local service.
 */
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

async function assertLoginCoherentStage(window: Page, selector: string): Promise<void> {
  const brand = window.locator(selector);
  await expect(brand).toBeVisible();
  await expect.poll(() => brand.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const stage = await brand.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      backgroundImage: style.backgroundImage,
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
    };
  });
  // Login family: navy linear-gradient + blue/amber radials — not a white plate.
  expect(stage.backgroundImage).toContain("linear-gradient");
  expect(stage.backgroundImage).toMatch(/rgb\(\s*6,\s*28,\s*48|#061c30/i);
  expect(stage.backgroundColor === "rgb(255, 255, 255)" || stage.backgroundColor === "#ffffff").toBe(false);
}

test.beforeAll(() => {
  mkdirSync(artifactDir, { recursive: true });
});

test("01 login UI — BrandMark entry on approved login stage (unbound session)", async () => {
  const { app, window } = await launch(loginEntry);
  try {
    await setBounds(app, window, 1366, 768);
    await expect(window.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await expect(window.getByTestId("authorization-unauthenticated")).toBeVisible();
    const brand = window.locator(".pos-brand--entry");
    await expect(brand).toBeVisible();
    await expect.poll(() => brand.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    // Entry sits on .pos-entry-brand (approved login backdrop) — not a white box.
    const entryStage = await window.locator(".pos-entry-brand").evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(entryStage).toContain("linear-gradient");
    await window.screenshot({
      path: join(artifactDir, "01-login.png"),
      animations: "disabled",
    });
  } finally {
    await app.close();
  }
});

test("02–03–05–06 admin shell visual — stage, dashboard, admin, collapsed sidebar", async () => {
  const { app, window } = await launch(shellEntry, { POS_LOGO_VISUAL_ROLE: "ADMINISTRADOR" });
  try {
    await setBounds(app, window, 1366, 768);
    await expect(window.locator(".pos-sidebar")).toBeVisible();
    await assertLoginCoherentStage(window, ".pos-sidebar .pos-brand--sidebar");

    await window.screenshot({
      path: join(artifactDir, "02-sidebar-expanded.png"),
      animations: "disabled",
    });

    const dashboardBtn = window.getByRole("button", { name: "Dashboard" });
    await expect(dashboardBtn).toBeVisible();
    await dashboardBtn.click();
    await expect(dashboardBtn).toHaveAttribute("aria-current", "page");
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

    await window.getByRole("button", { name: "Ocultar menú" }).click();
    await expect(window.locator(".pos-sidebar")).toBeHidden();
    await expect(window.getByRole("button", { name: "Mostrar menú" })).toHaveAttribute("aria-expanded", "false");
    await window.screenshot({
      path: join(artifactDir, "06-sidebar-collapsed.png"),
      animations: "disabled",
    });
  } finally {
    await app.close();
  }
});

test("04 cajero shell visual — sales panel + logo stage (layout only)", async () => {
  const { app, window } = await launch(shellEntry, { POS_LOGO_VISUAL_ROLE: "CAJERO" });
  try {
    await setBounds(app, window, 1366, 768);
    await assertLoginCoherentStage(window, ".pos-sidebar .pos-brand--sidebar");
    const salesBtn = window.getByRole("button", { name: "Caja y ventas" });
    await expect(salesBtn).toBeVisible();
    await salesBtn.click();
    await expect(window.getByTestId("sale-panel")).toBeVisible();
    await window.screenshot({
      path: join(artifactDir, "04-sales.png"),
      animations: "disabled",
    });
  } finally {
    await app.close();
  }
});

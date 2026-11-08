import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const executablePath = require("electron") as string;
const output = process.env.POS_E2E_AUDIT_DIRECTORY;

/**
 * Layout evidence only. visual-preview-entry.mjs supplies test-only capabilities,
 * rejects every commercial operation and labels the window as unauthenticated.
 * This must never be represented as a live user or login certification.
 */
test("compiled Electron renders isolated role-gated screens and existing icon assets", async () => {
  const app: ElectronApplication = await electron.launch({
    executablePath,
    args: ["--no-sandbox", join(here, "visual-preview-entry.mjs")],
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("heading", { name: "Camacho POS Colombia", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Caja y ventas" })).toBeVisible();
    await expect(page.locator("#pos-visual-preview-banner")).toBeVisible();
    const observations: unknown[] = [];
    for (const width of [1440, 1024, 768]) {
      await app.evaluate(({ BrowserWindow }, dimensions) => {
        BrowserWindow.getAllWindows()[0]!.setSize(dimensions.width, dimensions.height);
      }, { width, height: 900 });
      const buttons = page.locator(".pos-nav button");
      const count = await buttons.count();
      for (let i = 0; i < count; i++) {
        const label = (await buttons.nth(i).innerText()).trim();
        await buttons.nth(i).click();
        const current = page.locator(".pos-screen > div:not([hidden])");
        await expect(current).toBeVisible();
        const data = await page.evaluate(() => {
          const visible = (el: Element) => el.getClientRects().length > 0;
          const active = document.querySelector(".pos-screen > div:not([hidden])");
          const badRects = [...(active?.querySelectorAll("input, button, select, table, img") ?? [])]
            .filter(visible).filter(el => {
              const rect = el.getBoundingClientRect();
              return rect.width <= 0 || rect.height <= 0;
            }).map(el => el.getAttribute("data-testid") ?? el.tagName.toLowerCase());
          const paymentIcons = [...(active?.querySelectorAll<HTMLImageElement>(".pos-payment-method-icon") ?? [])]
            .filter(visible).map(img => ({ source: img.getAttribute("src"), complete: img.complete, naturalWidth: img.naturalWidth }));
          return {
            viewportWidth: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            overflow: document.documentElement.scrollWidth > innerWidth,
            zeroSizedControls: badRects,
            paymentIcons,
          };
        });
        observations.push({ width, screen: label, ...data });
        if (output) {
          mkdirSync(output, { recursive: true });
          await page.screenshot({ path: join(output, `preview-${width}-${i}.png`), fullPage: true });
        }
      }
    }
    if (output) writeFileSync(join(output, "visual-preview-observations.json"), JSON.stringify({
      provenance: "VISUAL_ONLY_NO_LOGIN_NO_SERVICE_NO_COMMERCIAL_WRITES",
      note: "Missing cash denomination PNGs cannot be certified by these screenshots because the payment area has no created sale.",
      observations,
    }, null, 2));
    expect(observations.length).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});

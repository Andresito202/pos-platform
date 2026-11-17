/**
 * Captura real del renderer comercial compilado (entrada de login).
 * Usa el smoke-entry E2E existente — no role-preview ni visual-preview.
 * Evidencia de arranque Electron + marca + shell de acceso; no acredita login BUSINESS.
 */
import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");
const outDir = process.env.POS_E2E_AUDIT_DIRECTORY ?? join(desktop, "../../docs/testing/bloque6-captures");
mkdirSync(outDir, { recursive: true });

const require = createRequire(join(desktop, "package.json"));
const executablePath = require("electron");
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry) => entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
  ),
);

const app = await electron.launch({
  args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), join(here, "smoke-entry.mjs")],
  executablePath,
  env,
});

try {
  const window = await app.firstWindow();
  await window.waitForSelector('[data-testid="authorization-error"], h1:has-text("Iniciar sesión")', {
    timeout: 15000,
  });
  await window.screenshot({
    path: join(outDir, "bloque6-login-entry-real.png"),
    fullPage: true,
  });
  console.log(JSON.stringify({ ok: true, capture: join(outDir, "bloque6-login-entry-real.png") }));
} finally {
  await app.close();
}

// Documentation-only visual review. Uses the existing Playwright installation.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, sep, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const proposal = resolve(repository, "docs/design/pos-proposals-2026-10-24");
const require = createRequire(resolve(repository, "apps/pos-desktop/package.json"));
const { chromium } = require("playwright");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };
const roots = new Map([
  ["/design/pos-proposals-2026-10-24/", proposal],
  ["/brand/", resolve(repository, "docs/brand")],
  ["/current/", resolve(repository, "apps/pos-desktop/dist/renderer")],
]);
const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET") { res.writeHead(405).end(); return; }
    const url = new URL(req.url, "http://127.0.0.1");
    const route = [...roots].find(([prefix]) => url.pathname.startsWith(prefix));
    if (!route) { res.writeHead(404).end(); return; }
    const [prefix, root] = route;
    const file = resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)) || "index.html");
    if (!file.startsWith(root + sep) || !mime[extname(file)]) { res.writeHead(404).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": mime[extname(file)], "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
// Use the already installed browser; do not download another runtime.
const browser = await chromium.launch({ headless: true, channel: "msedge" }).catch(error => { server.close(); throw error; });
const report = { scope: "DOCUMENTATION_PROTOTYPES_ONLY", data: "NONE", backendCalls: 0, consoleErrors: [], layouts: [], screenshots: [], contrasts: [], currentRenderer: null };
const contrast = (a, b) => {
  const lum = hex => {
    const rgb = hex.replace("#", "").match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  };
  const values = [lum(a), lum(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
};
try {
  await mkdir(resolve(proposal, "captures"), { recursive: true });
  const page = await browser.newPage();
  page.on("pageerror", error => report.consoleErrors.push(error.message));
  page.on("console", message => { if (message.type() === "error") report.consoleErrors.push(message.text()); });
  page.on("request", request => {
    if (["fetch", "xhr", "websocket"].includes(request.resourceType())) report.backendCalls++;
    assert(request.url().startsWith(origin), "prototype must not load remote resources");
  });
  const screens = ["inventario", "ventas", "dashboard", "login", "catalogo", "clientes", "caja", "auditoria", "hardware", "estados", "componentes"];
  for (const theme of ["a", "b", "c"]) {
    for (const [density, width, height] of [["desktop", 1440, 1000], ["touch", 1024, 768], ["touch", 768, 1024], ["touch", 390, 844]]) {
      await page.setViewportSize({ width, height });
      for (const screen of screens) {
        await page.goto(`${origin}/design/pos-proposals-2026-10-24/index.html?theme=${theme}&screen=${screen}&density=${density}`);
        await page.locator("main h1, main h2").first().waitFor();
        const metrics = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          contentWidth: document.documentElement.scrollWidth,
          logoLoaded: [...document.images].every(img => img.complete && img.naturalWidth > 0),
          enabledBusinessInputs: document.querySelectorAll("main input:not(:disabled),main button:not(:disabled),main select:not(:disabled)").length,
          minimumControlHeight: Math.min(...[...document.querySelectorAll(".review select")].map(el => el.getBoundingClientRect().height)),
        }));
        assert(metrics.contentWidth <= metrics.width + 1, `${theme}/${screen}/${width}: document overflow`);
        assert(metrics.logoLoaded, "approved logo must load");
        assert.equal(metrics.enabledBusinessInputs, 0, "no business actions or credential capture in prototype");
        if (density === "touch") assert(metrics.minimumControlHeight >= 44, "touch controls need adequate height");
        report.layouts.push({ theme, screen, density, width, ...metrics });
        if ((width === 1440 || width === 1024) && ["inventario", "ventas", "dashboard", "login"].includes(screen)) {
          const name = `${theme}-${screen}-${density}.png`;
          await page.screenshot({ path: resolve(proposal, "captures", name), fullPage: true });
          report.screenshots.push(name);
        }
      }
    }
  }
  await page.goto(`${origin}/design/pos-proposals-2026-10-24/index.html?theme=%3Cscript%3E&screen=__proto__&density=unknown`);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "b");
  assert.equal(await page.locator("main h1").textContent(), "Inventario");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.className), "skip");
  for (const [theme, blue, green, ink, muted, paper] of [
    ["a", "#174a74", "#176a4c", "#172d3b", "#536471", "#f7f8fa"],
    ["b", "#123d68", "#087052", "#142b3a", "#536475", "#f3f6f8"],
    ["c", "#064b78", "#136750", "#163145", "#526572", "#f5f8f7"],
  ]) {
    for (const [pair, fg, bg] of [["primary", "#ffffff", green], ["blue", blue, "#ffffff"], ["body", ink, paper], ["muted", muted, "#ffffff"]]) {
      const ratio = contrast(fg, bg); assert(ratio >= 4.5, `${theme}/${pair} contrast`);
      report.contrasts.push({ theme, pair, foreground: fg, background: bg, ratio: Number(ratio.toFixed(2)) });
    }
  }
  assert.equal(report.backendCalls, 0); assert.deepEqual(report.consoleErrors, []);
  // Real bundled renderer, without a bridge or fabricated session. Record its
  // genuine disconnected state; do not inject capabilities to inspect screens.
  const current = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await current.goto(`${origin}/current/index.html`);
  await current.getByRole("heading", { name: "Acceso no disponible", exact: true }).waitFor();
  await current.screenshot({ path: resolve(proposal, "captures/current-renderer-disconnected.png"), fullPage: true, animations: "disabled" });
  report.currentRenderer = "Observed built renderer: no bridge/session injected, Acceso no disponible";
  const labels = { a: "Enterprise Minimal", b: "Commercial Precision", c: "Modern Professional POS" };
  const sections = ["inventario", "ventas", "dashboard", "login"].map(screen => `<section><h2>${screen}</h2><div class="triptych">${["a", "b", "c"].map(theme => `<figure><figcaption>${theme.toUpperCase()} · ${labels[theme]}</figcaption><a href="captures/${theme}-${screen}-desktop.png"><img src="captures/${theme}-${screen}-desktop.png" alt="${labels[theme]}, ${screen}, escritorio"></a><a href="captures/${theme}-${screen}-touch.png">Ver captura táctil</a></figure>`).join("")}</div></section>`).join("");
  await writeFile(resolve(proposal, "comparison.html"), `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'"><title>Comparación · Camacho POS Colombia</title><link rel="stylesheet" href="comparison.css"></head><body><header><p>CAMACHO POS COLOMBIA · REVISIÓN VISUAL</p><h1>Tres direcciones. Un mismo producto.</h1><p>Capturas reales de prototipos sin datos ni operaciones. No representan sesión autorizada.</p><a href="index.html">Abrir explorador de propuestas</a></header>${sections}</body></html>`);
  await page.setViewportSize({ width: 1728, height: 1100 });
  await page.goto(`${origin}/design/pos-proposals-2026-10-24/comparison.html`);
  await page.screenshot({ path: resolve(proposal, "captures/comparison.png"), fullPage: true });
  await writeFile(resolve(proposal, "visual-checks.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ layouts: report.layouts.length, captures: report.screenshots.length, contrasts: report.contrasts.length, backendCalls: report.backendCalls, consoleErrors: report.consoleErrors.length, currentRenderer: report.currentRenderer }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

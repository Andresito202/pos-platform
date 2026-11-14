/** Visual QA of the built renderer and inert server-rendered real components.
 * No session, bridge, business record or capability is created by this tool. */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname, sep, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = resolve(root, "apps/pos-desktop/dist/renderer");
const artifacts = resolve(root, "artifacts/commercial-precision/2026-10-25/visual");
await mkdir(artifacts, { recursive: true });
const { chromium } = createRequire(resolve(root, "apps/pos-desktop/package.json"))("playwright");
const { componentMarkup } = await import(pathToFileURL(resolve(root, "apps/pos-desktop/dist/visual-components.mjs")).href);
const index = await readFile(resolve(dist, "index.html"), "utf8");
const css = index.match(/href="([^\"]+\.css)"/)?.[1];
assert(css, "build must provide stylesheet");
const views = ["sales", "catalog", "inventory", "customers", "admin", "hardware", "receipt", "fiscal"];
const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET") { res.writeHead(405).end(); return; }
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/component/")) {
      const name = url.pathname.slice("/component/".length);
      if (!views.includes(name)) { res.writeHead(404).end(); return; }
      const markup = componentMarkup(name);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/runtime/${css.replace(/^\.\//, "")}"><title>Revisión estática</title></head><body>${markup}</body></html>`);
      return;
    }
    if (!url.pathname.startsWith("/runtime/")) { res.writeHead(404).end(); return; }
    const relative = decodeURIComponent(url.pathname.slice("/runtime/".length)) || "index.html";
    const file = resolve(dist, relative);
    const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png" }[extname(file)];
    if (!file.startsWith(dist + sep) || !mime) { res.writeHead(404).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": mime, "cache-control": "no-store" }); res.end(data);
  } catch (error) { console.error(error.message); if (!res.headersSent) res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: "msedge" }).catch(error => { server.close(); throw error; });
const evidence = { mode: "REAL_COMPONENT_STATIC_REVIEW_NOT_AUTHENTICATED", renderer: [], components: [], errors: [], runtimeBridgeInjected: false };
try {
  const page = await browser.newPage();
  page.on("pageerror", error => evidence.errors.push(error.message));
  for (const [width, height, touch] of [[1440, 1000, false], [1024, 768, true], [768, 1024, true], [390, 844, true]]) {
    await page.setViewportSize({ width, height });
    // Touch targets are verified using a real coarse-pointer browser context.
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
    const panel = await context.newPage();
    panel.on("pageerror", error => evidence.errors.push(error.message));
    await panel.goto(`${origin}/runtime/index.html`);
    await panel.getByRole("heading", { name: "Acceso no disponible", exact: true }).waitFor();
    const result = await panel.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      font: getComputedStyle(document.documentElement).fontFamily, background: getComputedStyle(document.querySelector(".pos-entry")).backgroundColor,
      buttonHeight: document.querySelector(".pos-entry-card > button").getBoundingClientRect().height }));
    assert(result.scrollWidth <= width + 1); assert.equal(result.background, "rgb(243, 246, 248)");
    if (touch) assert(result.buttonHeight >= 48);
    evidence.renderer.push(result);
    await panel.screenshot({ path: resolve(artifacts, `access-${width}.png`), fullPage: true, animations: "disabled" });
    for (const view of views) {
      await panel.goto(`${origin}/component/${view}`);
      await panel.locator(".pos-screen section").first().waitFor();
      const metrics = await panel.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, inert: document.querySelector(".pos-screen").inert,
        body: getComputedStyle(document.body).backgroundColor, bridge: "posService" in window }));
      assert(metrics.scrollWidth <= width + 1, `${view}/${width} document overflow`);
      assert(metrics.inert); assert.equal(metrics.bridge, false);
      evidence.components.push({ view, touch, ...metrics });
      if (width === 1440 || width === 1024) await panel.screenshot({ path: resolve(artifacts, `${view}-${width}.png`), fullPage: true });
    }
    await context.close();
  }
  assert.deepEqual(evidence.errors, []);
  await writeFile(resolve(artifacts, "checks.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ runtimeLayouts: evidence.renderer.length, staticComponents: evidence.components.length, errors: evidence.errors.length }));
} finally { await browser.close(); await new Promise(done => server.close(done)); }

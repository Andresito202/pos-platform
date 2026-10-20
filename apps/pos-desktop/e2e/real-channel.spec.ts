import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrCreateWindowsLocalChannelSecret } from "@pos-platform/local-channel";

/**
 * El POS de escritorio **real** contra el Camacho POS Colombia Service **real**.
 *
 * `boot.spec.ts` comprueba que la aplicación monta, y para eso le basta un
 * `ServiceChannel` de doble. Aquí el canal y el handler comercial son reales:
 * dos procesos distintos hablan por un socket. El proveedor fiscal sigue siendo
 * el FakeIssuancePort del arnés; esta prueba no acredita FACTUS.
 *
 *     Electron (proceso A)                    Local Service (proceso B)
 *       renderer → preload → ChannelBridge  ⇄  LocalChannelServer
 *       → LocalChannelClient → socket          → CommercialRequestHandler
 *                                              → SQLite
 *
 * El arnés aporta identidad, snapshot y SSA de prueba. En Windows el secreto
 * del canal usa DPAPI en el directorio temporal. Cliente, socket, MAC,
 * anti-replay, handler comercial y base de datos son los de producción.
 *
 * En Windows usa LocalChannelComponent y named pipe de producción; en POSIX
 * conserva el host de transporte de prueba. No prueba login central ni un rol
 * comercial legítimo: la sesión se firma dentro del arnés aislado.
 */

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const executablePath = require("electron") as string;

const TENANT = "018f0000-0000-7000-8000-0000000000a4";
const COMPANY = "018f0000-0000-7000-8000-0000000000a5";
const BRANCH = "018f0000-0000-7000-8000-0000000000a6";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000a2";
const DEVICE = "018f0000-0000-7000-8000-0000000000a3";
const USER = "018f0000-0000-7000-8000-0000000000a1";
const REGISTER = "018f0000-0000-7000-8000-00000000aa01";
const BARCODE = "7701234567890";

let dataDirectory: string;
let service: ChildProcessWithoutNullStreams;
let app: ElectronApplication;
let sessionAssertion: unknown;
const auditDirectory = process.env.POS_E2E_AUDIT_DIRECTORY;
const rendererErrors: string[] = [];

async function captureState(name: string): Promise<void> {
  if (auditDirectory) await (await app.firstWindow()).screenshot({ path: join(auditDirectory, `${name}.png`), fullPage: true });
}

async function captureScreens(): Promise<void> {
  if (!auditDirectory) return;
  mkdirSync(auditDirectory, { recursive: true });
  const page = await app.firstWindow();
  const observations = [];
  const names = await page.locator(".pos-nav button").allTextContents();
  for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
    await app.evaluate(({ BrowserWindow }, dimensions) => {
      BrowserWindow.getAllWindows()[0]!.setSize(dimensions.width, dimensions.height);
    }, size);
    for (let index = 0; index < names.length; index += 1) {
      await page.locator(".pos-nav button").nth(index).click();
      const current = page.locator(".pos-screen > div:not([hidden])");
      const monitoring = current.getByRole("button", { name: "Seguimiento", exact: true });
      if (await monitoring.count()) {
        await monitoring.click();
        const refresh = current.getByRole("button", { name: /^Actualizar( métricas)?$/ });
        await refresh.click();
        await expect(refresh).toBeEnabled();
        await page.screenshot({ path: join(auditDirectory, `screen-${index}-monitoring-${size.width}.png`), fullPage: true });
        await current.getByRole("button", { name: "Seguridad", exact: true }).click();
        await page.screenshot({ path: join(auditDirectory, `screen-${index}-security-${size.width}.png`), fullPage: true });
        await current.getByRole("button", { name: "Resumen", exact: true }).click();
      }
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      const file = `screen-${index}-${size.width}.png`;
      await page.screenshot({ path: join(auditDirectory, file) });
      observations.push({ name: names[index], file, ...await page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight },
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        verticalScroll: document.documentElement.scrollHeight > innerHeight,
        disabledButtons: [...document.querySelectorAll<HTMLButtonElement>("button:disabled")]
          .filter((button) => button.checkVisibility())
          .map((button) => ({ text: button.innerText, testId: button.dataset["testid"], title: button.title })),
        alerts: [...document.querySelectorAll('[role="alert"]')]
          .filter((node) => node.getClientRects().length > 0).map((node) => node.textContent),
      })) });
    }
  }
  writeFileSync(join(auditDirectory, "screens.json"), JSON.stringify({
    evidence: "ISOLATED_E2E", authentication: "test-signed SSA; all canonical test permissions; no business role authenticated",
    data: "temporary SQLite", fiscalProvider: "existing FakeIssuancePort; no FACTUS request",
    observations, rendererErrors,
  }, null, 2));
  await page.getByRole("button", { name: "Caja y ventas", exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.maximize());
  await page.screenshot({ path: join(auditDirectory, "sales-maximized.png") });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.unmaximize());
}

/** Espera a que el servicio anuncie que está listo y devuelve lo que publica. */
function waitForService(child: ChildProcessWithoutNullStreams): Promise<{
  endpoint: string;
  sessionAssertion: unknown;
}> {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => { reject(new Error("the local service did not become ready")); }, 30_000);
    child.stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const line = buffered.split("\n").find((candidate) => candidate.includes("\"ready\""));
      if (line !== undefined) {
        clearTimeout(timer);
        resolve(JSON.parse(line) as { endpoint: string; sessionAssertion: unknown });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { process.stderr.write(chunk); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`the local service exited early with code ${String(code)}`));
    });
  });
}

test.beforeAll(async () => {
  dataDirectory = mkdtempSync(join(tmpdir(), "pos-real-channel-"));
  const channelSecret = (process.platform === "win32"
    ? loadOrCreateWindowsLocalChannelSecret(dataDirectory, INSTALLATION)
    : randomBytes(32)).toString("hex");

  const serviceRoot = join(here, "..", "..", "pos-local-service");
  service = spawn(
    process.execPath,
    [createRequire(join(serviceRoot, "package.json")).resolve("tsx/cli"), join(serviceRoot, "e2e-host", "real-service-host.ts")],
    {
      cwd: serviceRoot,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        // El arnés declara que es una prueba, y tiene que hacerlo: desde
        // `DEC-021` F5 abre un almacén de secretos para la credencial fiscal, y
        // `InsecureDerivedKeyProvider` **se niega a construirse** fuera de
        // `NODE_ENV=test`. No es una concesión del proveedor de clave —ese
        // guardia es de producción y hace bien en negarse—: es el arnés
        // diciendo la verdad sobre lo que es.
        NODE_ENV: "test",
        POS_E2E_DATA_DIR: dataDirectory,
        POS_E2E_CHANNEL_SECRET: channelSecret,
        POS_E2E_TENANT_ID: TENANT,
        POS_E2E_COMPANY_ID: COMPANY,
        POS_E2E_BRANCH_ID: BRANCH,
        POS_E2E_INSTALLATION_ID: INSTALLATION,
        POS_E2E_DEVICE_ID: DEVICE,
        POS_E2E_USER_ID: USER,
        POS_E2E_REGISTER_ID: REGISTER,
      },
    },
  ) as ChildProcessWithoutNullStreams;

  const ready = await waitForService(service);
  sessionAssertion = ready.sessionAssertion;

  app = await electron.launch({
    args: ["--no-sandbox", join(here, "real-channel-entry.mjs")],
    executablePath,
    env: {
      ...process.env,
      POS_E2E_CHANNEL_ENDPOINT: ready.endpoint,
      POS_E2E_CHANNEL_SECRET: channelSecret,
      POS_E2E_INSTALLATION_ID: INSTALLATION,
      POS_E2E_DEVICE_ID: DEVICE,
    },
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") rendererErrors.push(message.text()); });
});

test.afterAll(async () => {
  await app?.close();
  if (service?.exitCode === null) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("E2E service shutdown timed out")), 10_000);
      service.once("exit", () => { clearTimeout(timer); resolve(); });
      service.send("pos-e2e-shutdown");
    });
  }
  if (dataDirectory !== undefined) rmSync(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("un cajero vende de verdad: Electron real → canal real → servicio real", async () => {
  const page = await app.firstWindow();
  await expect(page).toHaveTitle("Camacho POS Colombia");
  const security = await app.evaluate(({ BrowserWindow }) => {
    // Runtime inspection used only by the test; Electron omits this method
    // from its public WebContents typings, so describe the observed subset.
    const contents = BrowserWindow.getAllWindows()[0]!.webContents as unknown as {
      getLastWebPreferences(): { contextIsolation?: boolean; nodeIntegration?: boolean; sandbox?: boolean };
    };
    const preferences = contents.getLastWebPreferences();
    return { contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration, sandbox: preferences.sandbox };
  });
  expect(security).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
  expect(await page.evaluate(() => ({ require: typeof (globalThis as { require?: unknown }).require, process: typeof (globalThis as { process?: unknown }).process })))
    .toEqual({ require: "undefined", process: "undefined" });
  await expect(page.getByTestId("status-connected")).toBeVisible();
  await expect(page.getByTestId("authorization-error")).toBeVisible();
  if (auditDirectory) {
    mkdirSync(auditDirectory, { recursive: true });
    writeFileSync(join(auditDirectory, "electron-security.json"), JSON.stringify(security, null, 2));
    await page.screenshot({ path: join(auditDirectory, "access-without-session.png") });
  }

  // El canal ya negoció el handshake contra el servicio real: si no, Electron
  // no habría llegado a abrir ventana (`startPosDesktop` falla cerrado).

  // 1 · El cajero se identifica. La SSA la firma el servicio; el escritorio
  //     sólo la transporta, y nunca afirma identidad por su cuenta.
  const activated = await page.evaluate(async (assertion) => {
    const posService = (globalThis as unknown as {
      posService: Record<string, (request: unknown) => Promise<unknown>>;
    }).posService;
    // `ChannelBridge` entrega al canal lo que reciba, sin envolverlo: el sobre
    // lo construye quien llama, igual que hace `useCommercialSale`.
    const response = await posService["session.activate"]!({
      protocol_version: "1.0.0",
      message_type: "session.activate",
      request_id: crypto.randomUUID(),
      correlation_id: crypto.randomUUID(),
      payload_schema_version: "1.0.0",
      payload: { session_assertion: assertion },
    });
    return (response as { status: string }).status;
  }, sessionAssertion);
  expect(activated).toBe("SUCCEEDED");
  await page.reload();
  await expect(page.getByRole("button", { name: "Caja y ventas", exact: true })).toBeVisible();
  await captureScreens();

  // 2 · Preparación del mostrador: el producto y su existencia. Va por el canal
  //     real. El tercer recorrido prueba el alta desde la pantalla de catálogo.
  const prepared = await page.evaluate(async (barcode) => {
    const posService = (globalThis as unknown as {
      posService: Record<string, (request: unknown) => Promise<unknown>>;
    }).posService;
    const mutating = (messageType: string, payload: unknown) => ({
      protocol_version: "1.0.0",
      message_type: messageType,
      request_id: crypto.randomUUID(),
      correlation_id: crypto.randomUUID(),
      operation_id: crypto.randomUUID(),
      idempotency_key: crypto.randomUUID(),
      payload_schema_version: "1.0.0",
      payload,
    });
    const register = await posService["catalog.product.register"]!(mutating("catalog.product.register", {
      code: "CAFE-001",
      name: "Café Americano 500 g",
      stock_controlled: true,
      presentation_name: "Bolsa 500 g",
      unit_code: "UND",
      unit_precision: 0,
      barcode,
      price_amount: "18000.000000",
      currency_code: "COP",
    }));
    const presentationId = (register as { result: { presentation_id: string } }).result.presentation_id;
    const received = await posService["inventory.stock.receive"]!(mutating("inventory.stock.receive", {
      presentation_id: presentationId,
      movement_type: "PURCHASE_RECEIPT",
      quantity: "12.000000",
      reason_code: "SUPPLIER_DELIVERY",
      business_date: "2026-09-03",
    }));
    return {
      presentationId,
      quantityAfter: (received as { result: { quantity_after: string } }).result.quantity_after,
    };
  }, BARCODE);
  expect(prepared.quantityAfter).toBe("12.000000");

  // 3 · A partir de aquí, **sólo la interfaz**: es lo que hace el cajero.
  await page.getByTestId("cash-register-input").fill(REGISTER);
  await page.getByTestId("opening-amount-input").fill("0");
  await page.getByTestId("open-shift-button").click();
  await expect(page.getByTestId("shift-open")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("barcode-input").fill(BARCODE);
  await page.getByTestId("find-item-button").click();
  await expect(page.getByTestId("quantity-input")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("quantity-input").fill("2");
  await page.getByTestId("add-item-button").click();

  await page.getByTestId("create-sale-button").click();
  await expect(page.getByTestId("sale-created")).toBeVisible({ timeout: 15_000 });

  // Instrumentación **sólo de la prueba**: cuenta cuántas veces aparece la
  // señal que gobierna el cha-ching. Producción no se toca.
  await page.evaluate(() => {
    const counter = { count: 0 };
    (globalThis as unknown as { __chime: { count: number } }).__chime = counter;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.dataset["testid"] === "sale-completed") {
            counter.count += 1;
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  await page.getByTestId("charge-cash-button").click();

  // 4 · La venta queda cobrada. Éste es el estado que gobierna el cha-ching:
  //     `sale-completed` sólo se pinta cuando `sale_completed === true`.
  await expect(page.getByTestId("sale-completed")).toBeVisible({ timeout: 15_000 });

  // 4b · La señal se emite **exactamente una vez**. Ni cero —no habría
  //      cha-ching— ni dos —sonaría repetido para una sola venta—.
  expect(await page.getByTestId("sale-completed").count()).toBe(1);
  expect(await page.getByTestId("payment-partial").count()).toBe(0);
  await captureState("cash-completed");
  expect(await page.evaluate(
    () => (globalThis as unknown as { __chime: { count: number } }).__chime.count,
  )).toBe(1);

  // 5 · La existencia bajó por la venta, consultada por el canal real: 12 − 2.
  const remaining = await page.evaluate(async (presentationId) => {
    const posService = (globalThis as unknown as {
      posService: Record<string, (request: unknown) => Promise<unknown>>;
    }).posService;
    const stock = await posService["inventory.stock.get"]!({
      protocol_version: "1.0.0",
      message_type: "inventory.stock.get",
      request_id: crypto.randomUUID(),
      correlation_id: crypto.randomUUID(),
      payload_schema_version: "1.0.0",
      payload: { presentation_id: presentationId },
    });
    return (stock as { result: { quantity_on_hand: string } }).result.quantity_on_hand;
  }, prepared.presentationId);
  expect(remaining).toBe("10.000000");

  // ── 6 · El recibo, en la misma sesión y en la misma pantalla ───────────────
  //
  // Va dentro de este recorrido y no en una prueba aparte **a propósito**: el
  // vínculo de sesión vive en el servidor por `connectionId`, de modo que otra
  // prueba no lo hereda, y reactivar sobre una conexión ya vinculada se rechaza
  // —correctamente: una conexión tiene una sesión, no dos—. Un cajero tampoco
  // cambia de sesión para mirar lo que acaba de vender.

  const saleId = (await page.locator(".pos-payment-reference").textContent())?.replace("Venta ", "").trim() ?? "";
  expect(saleId).toMatch(/^[0-9a-f-]{36}$/);

  // La verdad contra la que se contrasta la pantalla: lo que el canal real
  // devuelve para esa misma venta.
  //
  // El contraste contra SQLite vive donde puede hacerse de verdad —
  // `channel-commercial-vertical.test.ts`, en el propio servicio, compara la
  // respuesta del canal con las filas carácter a carácter—. Aquí no se puede:
  // `LocalDatabase.open` toma el lock de escritor y el servicio lo tiene
  // (`SQLite writer already active`), que es un mecanismo de producción
  // haciendo su trabajo. Encadenados, ambos ficheros acreditan pantalla ==
  // SQLite, y cada eslabón se prueba donde es honesto probarlo.
  const truth = await page.evaluate(async (id) => {
    const posService = (globalThis as unknown as {
      posService: Record<string, (request: unknown) => Promise<unknown>>;
    }).posService;
    const response = await posService["sales.receipt.get"]!({
      protocol_version: "1.0.0",
      message_type: "sales.receipt.get",
      request_id: crypto.randomUUID(),
      correlation_id: crypto.randomUUID(),
      payload_schema_version: "1.0.0",
      payload: { sale_id: id },
    });
    return (response as { result: Record<string, unknown> }).result;
  }, saleId);
  expect(truth["outcome"]).toBe("FOUND");

  // A partir de aquí, sólo la interfaz: es lo que hace el cajero cuando el
  // cliente vuelve con una duda.
  await page.getByRole("button", { name: "Comprobantes", exact: true }).click();
  await page.getByTestId("receipt-sale-id-input").fill(saleId);
  await page.getByTestId("receipt-load-button").click();
  await expect(page.getByTestId("receipt")).toBeVisible({ timeout: 15_000 });

  expect(await page.getByTestId("receipt-sale-id").textContent()).toBe(saleId);
  expect(await page.getByTestId("receipt-document").textContent())
    .toBe(`${String(truth["document_series"])}-${String(truth["sale_number"])}`);
  expect(await page.getByTestId("receipt-business-date").textContent()).toBe(truth["business_date"]);
  expect(await page.getByTestId("receipt-subtotal").textContent()).toBe(truth["subtotal_amount"]);
  expect(await page.getByTestId("receipt-discount").textContent()).toBe(truth["discount_amount"]);
  expect(await page.getByTestId("receipt-tax").textContent()).toBe(truth["tax_amount"]);
  expect(await page.getByTestId("receipt-rounding").textContent())
    .toBe(truth["commercial_rounding_adjustment"]);
  expect(await page.getByTestId("receipt-payable").textContent()).toBe(truth["payable_amount"]);
  expect(await page.getByTestId("receipt-currency").textContent()).toBe(truth["currency_code"]);

  // Las líneas llegan completas a la pantalla, no resumidas.
  const receiptLines = truth["lines"] as Array<Record<string, unknown>>;
  expect(await page.getByTestId("receipt-line").count()).toBe(receiptLines.length);
  expect(await page.getByTestId("receipt-line-name").first().textContent())
    .toBe(receiptLines[0]!["product_name"]);
  expect(await page.getByTestId("receipt-line-presentation").first().textContent())
    .toBe(receiptLines[0]!["presentation_name"]);
  expect(await page.getByTestId("receipt-line-quantity").first().textContent())
    .toBe(receiptLines[0]!["quantity"]);
  expect(await page.getByTestId("receipt-line-unit-price").first().textContent())
    .toBe(receiptLines[0]!["unit_price_amount"]);
  expect(await page.getByTestId("receipt-line-total").first().textContent())
    .toBe(receiptLines[0]!["line_total_amount"]);

  // Y los cobros: importe y cambio, que es lo que el cliente revisa.
  const receiptPayments = truth["payments"] as Array<Record<string, unknown>>;
  expect(await page.getByTestId("receipt-payment").count()).toBe(receiptPayments.length);
  expect(await page.getByTestId("receipt-payment-method").first().textContent())
    .toBe(receiptPayments[0]!["payment_method"]);
  expect(await page.getByTestId("receipt-payment-amount").first().textContent())
    .toBe(receiptPayments[0]!["confirmed_amount"]);
  await captureState("receipt-found");

  // ── 7 · Los dos desenlaces que no son un recibo ────────────────────────────

  await page.getByTestId("receipt-sale-id-input").fill("018f0000-0000-7000-8000-0000000000fc");
  await page.getByTestId("receipt-load-button").click();
  await expect(page.getByTestId("receipt-not-found")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("receipt").count()).toBe(0);
  expect(await page.getByTestId("receipt-not-completed").count()).toBe(0);

  // Una venta nueva y sin cobrar existe, y por eso no puede anunciarse como
  // inexistente: el cajero la tiene delante y lo que debe hacer es cobrarla.
  await page.getByRole("button", { name: "Caja y ventas", exact: true }).click();
  await page.getByTestId("reset-button").click();

  // Segunda venta por la ruta táctil real: búsqueda de catálogo → tarjeta → carrito
  // → sale.create. La tarjeta no aporta precio ni identidad; sólo selecciona la
  // presentación que ya devolvió el catálogo confiable.
  await page.getByTestId("catalog-search-input").fill("Café");
  await page.getByTestId("catalog-search-button").click();
  await page.getByTestId("quantity-input").fill("1");
  const catalogCard = page.locator('[data-testid^="catalog-product-"]').first();
  await expect(catalogCard).toBeVisible({ timeout: 15_000 });
  await catalogCard.click();
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await page.getByTestId("create-sale-button").click();
  await expect(page.getByTestId("sale-created")).toBeVisible({ timeout: 15_000 });

  const pendingSale = (await page.locator(".pos-payment-reference").textContent())?.replace("Venta ", "").trim() ?? "";
  expect(pendingSale).not.toBe(saleId);
  await page.getByRole("button", { name: "Comprobantes", exact: true }).click();
  await page.getByTestId("receipt-sale-id-input").fill(pendingSale);
  await page.getByTestId("receipt-load-button").click();
  await expect(page.getByTestId("receipt-not-completed")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("receipt-not-found").count()).toBe(0);
  expect(await page.getByTestId("receipt").count()).toBe(0);

  // ── 8 · El cierre del turno, que es lo que permite abrir el siguiente ──────
  //
  // `DEC-012` §25.2 admite un unico turno OPEN o CLOSING por caja. Sin cierre,
  // la caja queda inservible al dia siguiente: es el bloqueo que este tramo
  // levanta, y se comprueba aqui desde la pantalla real.

  await page.getByRole("button", { name: "Caja y ventas", exact: true }).click();
  await page.getByTestId("counted-amount-input").fill("0");
  await page.getByTestId("close-shift-button").click();
  await expect(page.getByTestId("shift-close-result")).toBeVisible({ timeout: 15_000 });

  // El arqueo lo calcula el servicio. La pantalla lo muestra y no lo recalcula.
  const expectedCash = await page.getByTestId("shift-expected-cash").textContent();
  const countedAmount = await page.getByTestId("shift-counted-amount").textContent();
  const difference = await page.getByTestId("shift-difference").textContent();
  expect(countedAmount).toBe("0.000000");
  expect(expectedCash).not.toBeNull();
  expect(difference).not.toBeNull();

  // El turno deja de estar abierto y la caja vuelve a admitir apertura: eso es
  // lo que convierte el POS en usable mas alla del primer dia.
  await expect(page.getByTestId("shift-closed")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("shift-open").count()).toBe(0);

});

/**
 * El cobro por transferencia, entero y por la cadena real.
 *
 * Reportar y atestiguar son dos actos con dos permisos distintos, y la pantalla
 * los mantiene separados: entre uno y otro la venta sigue sin cobrarse. Se
 * comprueba aqui contra el servicio real, no contra un doble.
 */
test("un cajero cobra por transferencia: reportar, leer version y atestiguar", async () => {
  const page = await app.firstWindow();

  // Turno nuevo sobre la misma caja, que el cierre anterior libero.
  await page.getByTestId("reset-button").click();
  await page.getByTestId("cash-register-input").fill(REGISTER);
  await page.getByTestId("opening-amount-input").fill("0");
  await page.getByTestId("open-shift-button").click();
  await expect(page.getByTestId("shift-open")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("barcode-input").fill(BARCODE);
  await page.getByTestId("find-item-button").click();
  await expect(page.getByTestId("quantity-input")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("quantity-input").fill("1");
  await page.getByTestId("add-item-button").click();
  await page.getByTestId("create-sale-button").click();
  await expect(page.getByTestId("sale-created")).toBeVisible({ timeout: 15_000 });

  // 1 · Reportar la transferencia.
  await page.getByTestId("register-transfer-button").click();
  await expect(page.getByTestId("transfer-registered")).toBeVisible({ timeout: 15_000 });

  // Reportar no es cobrar: queda pendiente y la venta no se declara cobrada.
  await expect(page.getByTestId("transfer-pending")).toBeVisible();
  expect(await page.getByTestId("transfer-sale-completed").count()).toBe(0);
  expect(await page.getByTestId("sale-completed").count()).toBe(0);

  // El estado y el importe salen de `payment.get` contra el servicio real.
  expect(await page.getByTestId("transfer-status").textContent()).not.toBe("CONFIRMED");
  const payable = await page.getByTestId("payable-amount").textContent();
  expect(await page.getByTestId("transfer-expected-amount").textContent()).toBe(payable);

  // 2 · Atestiguar, que es el unico acto que puede completar la venta.
  await page.getByTestId("confirm-transfer-button").click();
  await expect(page.getByTestId("transfer-sale-completed")).toBeVisible({ timeout: 15_000 });

  // La cobertura la emite el servicio; la pantalla la muestra.
  expect(await page.getByTestId("transfer-confirmed-coverage").textContent()).toBe(payable);
  expect(await page.getByTestId("transfer-partial").count()).toBe(0);
  expect(await page.getByTestId("sale-error").count()).toBe(0);
  await captureState("transfer-confirmed");
});

/**
 * El primer dia de la tienda, entero y por la cadena real.
 *
 * Hasta aqui el catalogo y la existencia se sembraban con `page.evaluate`, que
 * es el canal pero **no es superficie de producto**: por eso B6, B7 y B10 se
 * quedaban en `CALLER_REACHABLE` por mucho que el motor funcionara. Esta prueba
 * no usa `page.evaluate` para nada: da de alta el producto, mete la mercancia,
 * la consulta, la ajusta y registra el adquiriente **tecleando en la pantalla**,
 * contra el servicio real por socket.
 *
 * Es tambien la comprobacion de que el POS se puede usar el primer dia, que es
 * algo que hasta ahora ninguna prueba afirmaba.
 */
test("una tienda se monta desde la pantalla: alta, existencia y adquiriente", async () => {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "Catálogo", exact: true }).click();

  const code = `COD-${randomUUID().slice(0, 8)}`;
  const barcode = `77012345${String(Date.now()).slice(-5)}`;

  // --- Alta de producto ----------------------------------------------------
  await page.getByTestId("product-code-input").fill(code);
  await page.getByTestId("product-name-input").fill("Panela");
  await page.getByTestId("presentation-name-input").fill("Bloque 500g");
  await page.getByTestId("unit-code-input").fill("UND");
  await page.getByTestId("unit-precision-input").fill("0");
  await page.getByTestId("product-barcode-input").fill(barcode);
  await page.getByTestId("product-price-input").fill("2500");
  await page.getByTestId("product-currency-input").fill("COP");
  await page.getByTestId("register-product-button").click();

  await expect(page.getByTestId("product-registered")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("product-outcome").textContent()).toBe("REGISTERED");
  const presentationId = await page.getByTestId("presentation-id").textContent();
  expect(presentationId).toMatch(/^[0-9a-f-]{36}$/);

  // --- Existencia antes de recibir: no es cero, es «sin movimientos» --------
  await page.getByRole("button", { name: "Inventario", exact: true }).click();
  await page.getByTestId("inventory-presentation-input").fill(presentationId!);
  await page.getByTestId("get-stock-button").click();
  await expect(page.getByTestId("stock-not-found")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("stock-found").count()).toBe(0);

  // --- Entrada de mercancia ------------------------------------------------
  await page.getByTestId("receive-quantity-input").fill("40");
  await page.getByTestId("receive-reason-input").fill("PURCHASE");
  await page.getByTestId("receive-stock-button").click();
  await expect(page.getByTestId("inventory-movement")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("movement-outcome").textContent()).toBe("POSTED");
  expect(await page.getByTestId("movement-quantity-after").textContent()).toBe("40.000000");

  // --- Ajuste por merma ----------------------------------------------------
  await page.getByTestId("adjust-quantity-input").fill("3");
  await page.getByTestId("adjust-reason-input").fill("BREAKAGE");
  await page.getByTestId("adjust-movement-select").selectOption("SHRINKAGE");
  await page.getByTestId("adjust-stock-button").click();
  await expect(page.getByTestId("movement-quantity-after")).toHaveText("37.000000", { timeout: 15_000 });

  // --- La consulta confirma el saldo que dejaron los dos movimientos -------
  await page.getByTestId("get-stock-button").click();
  await expect(page.getByTestId("stock-found")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("stock-quantity").textContent()).toBe("37.000000");

  // --- Adquiriente: no esta, se registra, y entonces si esta ---------------
  const identification = `10${String(Date.now()).slice(-8)}`;
  await page.getByRole("button", { name: "Clientes", exact: true }).click();
  await page.getByTestId("customer-document-code-input").fill("13");
  await page.getByTestId("customer-identification-input").fill(identification);
  await page.getByTestId("customer-legal-organization-input").fill("2");
  // Codigos DIAN reales, los mismos que usan las pruebas del servicio: "ZZ" es
  // el tributo de no responsable y "R-99-PN" la responsabilidad de persona
  // natural. Un codigo inventado aqui lo rechazaria el servicio, que es
  // exactamente lo que debe hacer.
  await page.getByTestId("customer-tribute-input").fill("ZZ");
  await page.getByTestId("customer-responsibilities-input").fill("R-99-PN");
  await page.getByTestId("customer-names-input").fill("Ana Perez");

  await page.getByTestId("find-customer-button").click();
  await expect(page.getByTestId("customer-not-found")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("register-customer-button").click();
  await expect(page.getByTestId("customer-registered")).toBeVisible({ timeout: 15_000 });
  const customerId = await page.getByTestId("customer-registered-id").textContent();
  expect(customerId).toMatch(/^[0-9a-f-]{36}$/);

  await page.getByTestId("find-customer-button").click();
  await expect(page.getByTestId("customer-found")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("customer-found-id").textContent()).toBe(customerId);
  expect(await page.getByTestId("customer-found-identification").textContent()).toBe(identification);
  expect(await page.getByTestId("customer-not-found").count()).toBe(0);

  // --- Y por ID, que es la tercera operacion del bloque --------------------
  await page.getByTestId("customer-id-input").fill(customerId!);
  await page.getByTestId("get-customer-button").click();
  await expect(page.getByTestId("customer-found")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("customer-found-tribute").textContent()).toBe("ZZ");

  expect(await page.getByTestId("catalog-error").count()).toBe(0);
  expect(await page.getByTestId("inventory-error").count()).toBe(0);
  expect(await page.getByTestId("customer-error").count()).toBe(0);
});

/**
 * La emisión fiscal **desde la pantalla**, contra el servicio real — `DEC-021` F5.
 *
 * Esta prueba afirma lo que hoy ocurre de verdad, no lo que nos gustaría que
 * ocurriera, y por eso su aserción principal es un **bloqueo**:
 *
 * `D-19` está registrado desde hace bloques: «hoy no hay ruta de usuario que
 * inserte» un atributo fiscal de presentación —ni de usuario ni de servicio:
 * `catalog_fiscal_attribute` tiene un lector en producción y **cero
 * escritores**—. Sin `unit_measure_code`, `standard_code`, `tax_code` y
 * `tax_rate`, ninguna línea de venta se puede declarar ante la DIAN, así que
 * **ningún producto dado de alta por la pantalla se puede facturar todavía**.
 *
 * Sembrar ese atributo en el arnés haría pasar la prueba afirmando una
 * capacidad que el producto no tiene. Es exactamente el error que este
 * repositorio lleva corrigiendo desde que se retiró `CANONICALLY_APPLIED`, y no
 * se repite aquí.
 *
 * Lo que sí acredita esta prueba, y no es poco: la pantalla de emisión alcanza
 * el caso de uso real por el canal real, y el motivo del bloqueo llega intacto
 * hasta el ojo del cajero, con su código y su ruta.
 */
test("la emisión fiscal se dispara desde la pantalla y dice la verdad sobre por qué no puede emitir", async () => {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "Caja y ventas", exact: true }).click();

  const code = `FISC-${randomUUID().slice(0, 8)}`;
  const barcode = `77055555${String(Date.now()).slice(-5)}`;

  // El turno que dejó abierto la prueba anterior sigue sirviendo, y usarlo es
  // lo que haría un cajero: no se abre un turno por factura. `reset` limpia la
  // venta en curso, no el turno.
  await page.getByTestId("reset-button").click();
  await expect(page.getByTestId("shift-open")).toBeVisible({ timeout: 15_000 });

  // Producto y existencia, tecleados en la pantalla.
  await page.getByRole("button", { name: "Catálogo", exact: true }).click();
  await page.getByTestId("product-code-input").fill(code);
  await page.getByTestId("product-name-input").fill("Producto facturable");
  await page.getByTestId("presentation-name-input").fill("Unidad");
  await page.getByTestId("unit-code-input").fill("UND");
  await page.getByTestId("unit-precision-input").fill("0");
  await page.getByTestId("product-barcode-input").fill(barcode);
  await page.getByTestId("product-price-input").fill("10000");
  await page.getByTestId("product-currency-input").fill("COP");
  await page.getByTestId("register-product-button").click();
  await expect(page.getByTestId("product-registered")).toBeVisible({ timeout: 15_000 });
  const presentationId = await page.getByTestId("presentation-id").textContent();

  await page.getByRole("button", { name: "Inventario", exact: true }).click();
  await page.getByTestId("inventory-presentation-input").fill(presentationId!);
  await page.getByTestId("receive-quantity-input").fill("5");
  await page.getByTestId("receive-reason-input").fill("PURCHASE");
  await page.getByTestId("receive-stock-button").click();
  await expect(page.getByTestId("inventory-movement")).toBeVisible({ timeout: 15_000 });

  // Venta y cobro, tambien desde la pantalla.
  await page.getByRole("button", { name: "Caja y ventas", exact: true }).click();
  await page.getByTestId("barcode-input").fill(barcode);
  await page.getByTestId("find-item-button").click();
  await expect(page.getByTestId("quantity-input")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("quantity-input").fill("1");
  await page.getByTestId("add-item-button").click();
  await page.getByTestId("create-sale-button").click();
  await expect(page.getByTestId("sale-created")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("charge-cash-button").click();
  await expect(page.getByTestId("sale-completed")).toBeVisible({ timeout: 15_000 });

  const saleId = (await page.locator(".pos-payment-reference").textContent())?.replace("Venta ", "").trim() ?? "";
  expect(saleId).toMatch(/^[0-9a-f-]{36}$/);

  // --- Y aqui empieza lo que esta prueba existe para comprobar ---------------

  // 1 · Venta de mostrador sin identificar: el caso mayoritario de un POS.
  await page.getByRole("button", { name: "Facturación electrónica", exact: true }).click();
  await page.getByTestId("fiscal-sale-id-input").fill(saleId);
  await page.getByTestId("issue-anonymous-button").click();
  await expect(page.getByTestId("fiscal-blocked")).toBeVisible({ timeout: 15_000 });

  // El bloqueo llega con su codigo, y **no** disfrazado de error de transporte.
  expect(await page.getByTestId("fiscal-blocked-code").textContent()).toBe("PAYLOAD_ASSEMBLY_BLOCKED");
  expect(await page.getByTestId("fiscal-error").count()).toBe(0);
  expect(await page.getByTestId("fiscal-issued").count()).toBe(0);

  // El motivo es `D-19`, no el adquiriente: el producto que la pantalla acaba
  // de dar de alta **no tiene atributo fiscal**, porque nada en el sistema
  // puede darselo. Esta asercion es la que documenta el bloqueo real.
  const reasons = await page.getByTestId("fiscal-blocked-reason").allTextContents();
  expect(reasons.join(" ")).toContain("LINE_FISCAL_ATTRIBUTE_MISSING");
  await captureState("fiscal-blocked");

  // 2 · Con un adquiriente identificado el bloqueo es el mismo, que es
  //     justamente lo que prueba que el adquiriente no es la unica pieza que
  //     falta para facturar.
  const identification = `10${String(Date.now()).slice(-8)}`;
  await page.getByRole("button", { name: "Clientes", exact: true }).click();
  await page.getByTestId("customer-document-code-input").fill("13");
  await page.getByTestId("customer-identification-input").fill(identification);
  await page.getByTestId("customer-legal-organization-input").fill("2");
  await page.getByTestId("customer-tribute-input").fill("ZZ");
  await page.getByTestId("customer-responsibilities-input").fill("R-99-PN");
  await page.getByTestId("customer-names-input").fill("Cliente Fiscal");
  await page.getByTestId("register-customer-button").click();
  await expect(page.getByTestId("customer-registered")).toBeVisible({ timeout: 15_000 });
  const customerId = await page.getByTestId("customer-registered-id").textContent();

  await page.getByRole("button", { name: "Facturación electrónica", exact: true }).click();
  await page.getByTestId("fiscal-customer-id-input").fill(customerId!);
  await page.getByTestId("issue-identified-button").click();
  await expect(page.getByTestId("fiscal-blocked")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("fiscal-blocked-code").textContent()).toBe("PAYLOAD_ASSEMBLY_BLOCKED");
  expect((await page.getByTestId("fiscal-blocked-reason").allTextContents()).join(" "))
    .toContain("LINE_FISCAL_ATTRIBUTE_MISSING");

  // 3 · Una venta que no existe no es un bloqueo de payload: es inelegible, y
  //     la pantalla los distingue.
  await page.getByTestId("fiscal-sale-id-input").fill("018f0000-0000-7000-8000-0000000000fd");
  await page.getByTestId("issue-anonymous-button").click();
  await expect(page.getByTestId("fiscal-retriable")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("fiscal-retriable-outcome").textContent()).toBe("NOT_ELIGIBLE");
  expect(await page.getByTestId("fiscal-blocked").count()).toBe(0);
  await captureScreens();
});

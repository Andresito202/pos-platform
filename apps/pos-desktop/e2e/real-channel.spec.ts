import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * El POS de escritorio **real** contra el POS Local Service **real**.
 *
 * `boot.spec.ts` comprueba que la aplicación monta, y para eso le basta un
 * `ServiceChannel` de doble. Esta prueba es otra cosa: **no hay doble en ningún
 * tramo**. Son dos procesos distintos hablando por un socket:
 *
 *     Electron (proceso A)                    Local Service (proceso B)
 *       renderer → preload → ChannelBridge  ⇄  LocalChannelServer
 *       → LocalChannelClient → socket          → CommercialRequestHandler
 *                                              → SQLite
 *
 * Lo único que el arnés aporta es el secreto del canal y la SSA firmada —lo
 * que en producción resuelven DPAPI y el emisor central—. Cliente, socket, MAC,
 * anti-replay, handler comercial y base de datos son los de producción.
 *
 * Corre sobre socket POSIX, así que **se ejecuta en Linux**. El named pipe y su
 * DACL están cubiertos aparte —`channel.test.ts` bajo `windowsIt`, que CI
 * ejecuta en `windows-2022`—; lo que sigue siendo `REQUIRES_LOCAL_VERIFICATION`
 * es **la identidad del proceso cliente**, que aún no existe en ninguna
 * plataforma.
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
  const channelSecret = randomBytes(32).toString("hex");

  const serviceRoot = join(here, "..", "..", "pos-local-service");
  service = spawn(
    join(serviceRoot, "node_modules", ".bin", "tsx"),
    [join(serviceRoot, "e2e-host", "real-service-host.ts")],
    {
      cwd: serviceRoot,
      env: {
        ...process.env,
        // `InsecureDerivedKeyProvider` se niega a construirse fuera de
        // `NODE_ENV=test`, y el arnes lo usa para el almacen de secretos
        // fiscal. La guarda es correcta; lo que faltaba era declarar que esto
        // es un entorno de prueba.
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
});

test.afterAll(async () => {
  await app?.close();
  service?.kill("SIGTERM");
  if (dataDirectory !== undefined) rmSync(dataDirectory, { recursive: true, force: true });
});

test("un cajero vende de verdad: Electron real → canal real → servicio real", async () => {
  const page = await app.firstWindow();
  await expect(page).toHaveTitle("POS Local");

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

  // 2 · Preparación del mostrador: el producto y su existencia. Va por el canal
  //     real igual que todo lo demás; la interfaz aún no tiene pantalla propia
  //     para dar de alta catálogo.
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

  // 3a · Llega una tanda con lote y se declara desde la pantalla de lotes. Es
  //      la que la venta de abajo consumirá por FEFO, y la que el paso 6b
  //      rastreará hasta el recibo.
  await page.getByTestId("lot-presentation-input").fill(prepared.presentationId);
  await page.getByTestId("lot-business-date-input").fill("2026-09-03");
  await page.getByTestId("lot-code-input").fill("CAFE-L1");
  await page.getByTestId("lot-quantity-input").fill("3");
  await page.getByTestId("lot-expiry-input").fill("2099-12-31");
  await page.getByTestId("lot-receive-button").click();
  await expect(page.getByTestId("lot-received-outcome")).toHaveText("RECEIVED", { timeout: 15_000 });
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
  expect(await page.evaluate(
    () => (globalThis as unknown as { __chime: { count: number } }).__chime.count,
  )).toBe(1);

  // 5 · La existencia bajó por la venta, consultada por el canal real:
  //     12 sin lote + 3 de la tanda − 2 vendidas.
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
  expect(remaining).toBe("13.000000");

  // ── 6 · El recibo, en la misma sesión y en la misma pantalla ───────────────
  //
  // Va dentro de este recorrido y no en una prueba aparte **a propósito**: el
  // vínculo de sesión vive en el servidor por `connectionId`, de modo que otra
  // prueba no lo hereda, y reactivar sobre una conexión ya vinculada se rechaza
  // —correctamente: una conexión tiene una sesión, no dos—. Un cajero tampoco
  // cambia de sesión para mirar lo que acaba de vender.

  const saleId = (await page.getByTestId("sale-id").textContent())?.trim() ?? "";
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

  // ── 6b · Del lote a la venta, desde la pantalla ────────────────────────────
  //
  // El retiro sanitario al revés de como se vendió: se parte de la tanda y se
  // llega al recibo. El rastro da la venta; el botón la abre con su recibo.
  await page.getByTestId("lot-code-input").fill("CAFE-L1");
  await page.getByTestId("lot-trace-button").click();
  await expect(page.getByTestId("lot-trace")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("lot-trace-outflow-type").allTextContents()).toEqual(["Venta"]);
  expect(await page.getByTestId("lot-trace-outflow-quantity").allTextContents()).toEqual(["2.000000"]);
  expect(await page.getByTestId("lot-trace-on-hand").textContent()).toBe("1.000000");
  await page.getByTestId("lot-trace-open-sale").click();
  await expect(page.getByTestId("lot-trace-sale-document"))
    .toHaveText(`${String(truth["document_series"])}-${String(truth["sale_number"])}`, { timeout: 15_000 });
  // Venta de mostrador: no nombró comprador, y la pantalla lo dice.
  await expect(page.getByTestId("lot-trace-sale-anonymous")).toBeVisible();
  expect(await page.getByTestId("lot-trace-sale-customer").count()).toBe(0);
  await page.getByTestId("lot-buyers-button").click();
  await expect(page.getByTestId("lot-buyers-anonymous")).toHaveText("1", { timeout: 15_000 });
  expect(await page.getByTestId("lot-buyer").count()).toBe(0);
  expect(await page.getByTestId("lot-buyers-failure").count()).toBe(0);

  // ── 7 · Los dos desenlaces que no son un recibo ────────────────────────────

  await page.getByTestId("receipt-sale-id-input").fill("018f0000-0000-7000-8000-0000000000fc");
  await page.getByTestId("receipt-load-button").click();
  await expect(page.getByTestId("receipt-not-found")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("receipt").count()).toBe(0);
  expect(await page.getByTestId("receipt-not-completed").count()).toBe(0);

  // Una venta nueva y sin cobrar existe, y por eso no puede anunciarse como
  // inexistente: el cajero la tiene delante y lo que debe hacer es cobrarla.
  await page.getByTestId("reset-button").click();
  await page.getByTestId("barcode-input").fill(BARCODE);
  await page.getByTestId("find-item-button").click();
  await expect(page.getByTestId("quantity-input")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("quantity-input").fill("1");
  await page.getByTestId("add-item-button").click();
  await page.getByTestId("create-sale-button").click();
  await expect(page.getByTestId("sale-created")).toBeVisible({ timeout: 15_000 });

  const pendingSale = (await page.getByTestId("sale-id").textContent())?.trim() ?? "";
  expect(pendingSale).not.toBe(saleId);
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

  // --- Merma por vencimiento: exige lote (UC-INVENTORY-002 §Mermas regla 3) --
  // Sin lote, se rechaza y el saldo no se mueve. Con un lote que no existe en
  // esta sucursal, tambien. Las dos respuestas llegan a la pantalla tal cual.
  await page.getByTestId("adjust-quantity-input").fill("2");
  await page.getByTestId("adjust-reason-input").fill("EXPIRED");
  await page.getByTestId("adjust-lot-input").fill("");
  await page.getByTestId("adjust-stock-button").click();
  await expect(page.getByTestId("movement-outcome")).toHaveText("LOT_REQUIRED", { timeout: 15_000 });

  await page.getByTestId("adjust-lot-input").fill("NO-EXISTE");
  await page.getByTestId("adjust-stock-button").click();
  await expect(page.getByTestId("movement-outcome")).toHaveText("LOT_NOT_FOUND", { timeout: 15_000 });
  await page.getByTestId("adjust-lot-input").fill("");

  // --- La consulta confirma el saldo que dejaron los dos movimientos -------
  await page.getByTestId("get-stock-button").click();
  await expect(page.getByTestId("stock-found")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("stock-quantity").textContent()).toBe("37.000000");

  // --- Lotes desde la pantalla: recibir, ver que vence primero, rastrear ---
  // Dos tandas: la que llega segunda vence antes, asi que la lista FEFO la
  // pone primera. La fecha de negocio se teclea: no depende del reloj.
  await page.getByTestId("lot-presentation-input").fill(presentationId!);
  await page.getByTestId("lot-business-date-input").fill("2026-09-22");
  for (const [lotCode, lotQuantity, expiry] of [
    ["PANELA-TARDE", "10", "2026-12-31"],
    // Vence a 5 días de la fecha de negocio: dentro de los 7 de «próximo a vencer».
    ["PANELA-PRONTO", "5", "2026-09-27"],
  ] as const) {
    await page.getByTestId("lot-code-input").fill(lotCode);
    await page.getByTestId("lot-quantity-input").fill(lotQuantity);
    await page.getByTestId("lot-expiry-input").fill(expiry);
    await page.getByTestId("lot-receive-button").click();
    await expect(page.getByTestId("lot-received-outcome")).toHaveText("RECEIVED", { timeout: 15_000 });
  }

  await page.getByTestId("lot-list-button").click();
  await expect(page.getByTestId("lot-list")).toBeVisible({ timeout: 15_000 });
  const listed = await page.locator('[data-testid^="lot-row-PANELA"]').evaluateAll(
    (rows) => rows.map((row) => row.getAttribute("data-testid")),
  );
  expect(listed).toEqual(["lot-row-PANELA-PRONTO", "lot-row-PANELA-TARDE"]);
  expect(await page.getByTestId("lot-row-expiry-state-PANELA-PRONTO").textContent()).toBe("NEAR_EXPIRY");
  expect(await page.getByTestId("lot-row-expiry-state-PANELA-TARDE").textContent()).toBe("VALID");
  // El aviso lo da la pantalla con el umbral que devuelve el servicio.
  expect(await page.getByTestId("lot-near-expiry-count").textContent()).toBe("1");
  expect(await page.getByTestId("lot-near-expiry-days").textContent()).toBe("7");
  expect(await page.getByTestId("lot-expired-alert").count()).toBe(0);

  // Merma de la tanda que se nombra, desde el panel de ajuste.
  await page.getByTestId("adjust-movement-select").selectOption("SHRINKAGE");
  await page.getByTestId("adjust-quantity-input").fill("2");
  await page.getByTestId("adjust-reason-input").fill("DAMAGED");
  await page.getByTestId("adjust-lot-input").fill("PANELA-TARDE");
  await page.getByTestId("adjust-stock-button").click();
  await expect(page.getByTestId("movement-quantity-after")).toHaveText("50.000000", { timeout: 15_000 });
  await page.getByTestId("adjust-lot-input").fill("");

  // Y el rastro la cuenta: entraron 10, quedan 8, salieron 2 por merma.
  await page.getByTestId("lot-code-input").fill("PANELA-TARDE");
  await page.getByTestId("lot-trace-button").click();
  await expect(page.getByTestId("lot-trace")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("lot-trace-received").textContent()).toBe("10.000000");
  expect(await page.getByTestId("lot-trace-on-hand").textContent()).toBe("8.000000");
  expect(await page.getByTestId("lot-trace-outflow-type").allTextContents()).toEqual(["Merma"]);
  expect(await page.getByTestId("lot-trace-outflow-quantity").allTextContents()).toEqual(["2.000000"]);
  // Una merma no es venta: no hay venta que abrir.
  expect(await page.getByTestId("lot-trace-open-sale").count()).toBe(0);

  // Aparecen 3 más en el conteo: se suman a la tanda nombrada, y el rastro lo
  // cuenta como ajuste, no como compra.
  await page.getByTestId("adjust-movement-select").selectOption("ADJUSTMENT_POSITIVE");
  await page.getByTestId("adjust-quantity-input").fill("3");
  await page.getByTestId("adjust-reason-input").fill("COUNT_CORRECTION");
  await page.getByTestId("adjust-lot-input").fill("PANELA-TARDE");
  await page.getByTestId("adjust-stock-button").click();
  await expect(page.getByTestId("movement-quantity-after")).toHaveText("53.000000", { timeout: 15_000 });
  await page.getByTestId("adjust-lot-input").fill("");

  await page.getByTestId("lot-trace-button").click();
  await expect(page.getByTestId("lot-trace-on-hand")).toHaveText("11.000000", { timeout: 15_000 });
  expect(await page.getByTestId("lot-trace-inflow-type").allTextContents()).toEqual(["Recepción", "Ajuste +"]);
  expect(await page.getByTestId("lot-trace-inflow-reason").allTextContents())
    .toEqual(["SUPPLIER_DELIVERY", "COUNT_CORRECTION"]);
  expect(await page.getByTestId("lot-trace-received").textContent()).toBe("13.000000");

  await page.getByTestId("lot-code-input").fill("NO-EXISTE");
  await page.getByTestId("lot-trace-button").click();
  await expect(page.getByTestId("lot-trace-outcome")).toHaveText("NOT_FOUND", { timeout: 15_000 });

  // --- Adquiriente: no esta, se registra, y entonces si esta ---------------
  const identification = `10${String(Date.now()).slice(-8)}`;
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
 * La segunda presentación del mismo artículo, desde la pantalla real.
 *
 * Es el caso de la tienda de barrio y la licorera: vender la unidad y el
 * paquete del mismo producto. `DEC-004` lo admite desde siempre —`Product
 * 1 ─── 1..N ProductPresentation`— y el esquema también, pero hasta hoy no
 * había operación que llegara a la segunda.
 *
 * Lo que esta prueba **no** afirma: conversión. Cada presentación lleva su
 * propia existencia, y eso está fijado en la vertical con saldos medidos.
 */
test("una tienda declara la unidad y el paquete del mismo artículo, desde la pantalla", async () => {
  const page = await app.firstWindow();

  const code = `PRES-${randomUUID().slice(0, 8)}`;
  const unitBarcode = `77090001${String(Date.now()).slice(-5)}`;
  const packBarcode = `77090002${String(Date.now()).slice(-5)}`;

  await page.getByTestId("product-code-input").fill(code);
  await page.getByTestId("product-name-input").fill("Gaseosa 350 ml");
  await page.getByTestId("presentation-name-input").fill("Unidad");
  await page.getByTestId("unit-code-input").fill("UND");
  await page.getByTestId("unit-precision-input").fill("0");
  await page.getByTestId("product-barcode-input").fill(unitBarcode);
  await page.getByTestId("product-price-input").fill("3000");
  await page.getByTestId("product-currency-input").fill("COP");
  await page.getByTestId("register-product-button").click();
  await expect(page.getByTestId("product-registered")).toBeVisible({ timeout: 15_000 });

  const unitPresentationId = await page.getByTestId("presentation-id").textContent();

  // El producto viene prerrellenado del alta: es el paso siguiente natural.
  const productField = page.getByTestId("add-presentation-product-id-input");
  await expect(productField).not.toHaveValue("", { timeout: 15_000 });

  await page.getByTestId("add-presentation-name-input").fill("Paca x12");
  await page.getByTestId("add-presentation-unit-code-input").fill("PACA");
  await page.getByTestId("add-presentation-barcode-input").fill(packBarcode);
  await page.getByTestId("add-presentation-price-input").fill("33000");
  await page.getByTestId("add-presentation-button").click();

  await expect(page.getByTestId("add-presentation-outcome")).toHaveText("ADDED", { timeout: 15_000 });
  const packPresentationId = await page.getByTestId("added-presentation-id").textContent();
  expect(packPresentationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(packPresentationId).not.toBe(unitPresentationId);

  // Y el lector distingue las dos: escanear la paca da la paca, con su precio.
  await page.getByTestId("barcode-input").fill(packBarcode);
  await page.getByTestId("find-item-button").click();
  await expect(page.getByTestId("quantity-input")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("catalog-error").count()).toBe(0);

  // --- La equivalencia entre las dos, y abrir una paca de verdad -----------

  await page.getByTestId("conversion-factor-input").fill("12");
  await page.getByTestId("declare-conversion-button").click();
  await expect(page.getByTestId("conversion-declare-outcome"))
    .toHaveText("DECLARED", { timeout: 15_000 });

  // Tres pacas en existencia, ninguna unidad todavía: una llega con lote
  // —la tanda GAS-L1, declarada desde la pantalla de lotes— y dos sin él.
  await page.getByTestId("lot-presentation-input").fill(packPresentationId!);
  await page.getByTestId("lot-business-date-input").fill("2026-09-03");
  await page.getByTestId("lot-code-input").fill("GAS-L1");
  await page.getByTestId("lot-quantity-input").fill("1");
  await page.getByTestId("lot-expiry-input").fill("2099-12-31");
  await page.getByTestId("lot-receive-button").click();
  await expect(page.getByTestId("lot-received-outcome")).toHaveText("RECEIVED", { timeout: 15_000 });

  await page.getByTestId("inventory-presentation-input").fill(packPresentationId!);
  await page.getByTestId("receive-quantity-input").fill("2");
  await page.getByTestId("receive-reason-input").fill("PURCHASE");
  await page.getByTestId("receive-stock-button").click();
  await expect(page.getByTestId("movement-quantity-after"))
    .toHaveText("3.000000", { timeout: 15_000 });

  // El tendero abre una: sale 1 paca, entran 12 unidades, en un solo acto.
  await page.getByTestId("conversion-target-input").fill(unitPresentationId!);
  await page.getByTestId("conversion-quantity-input").fill("1");
  await page.getByTestId("apply-conversion-button").click();
  await expect(page.getByTestId("conversion-outcome"))
    .toHaveText("CONVERTED", { timeout: 15_000 });
  expect(await page.getByTestId("conversion-source-after").textContent()).toBe("2.000000");
  expect(await page.getByTestId("conversion-target-after").textContent()).toBe("12.000000");
  expect(await page.getByTestId("inventory-error").count()).toBe(0);

  // --- La paca abierta era de la tanda GAS-L1: sus 12 unidades también -----
  //
  // FEFO abrió la paca con lote. El rastro de la tanda baja a las unidades, y
  // desde las unidades se sube otra vez a la paca: el retiro de GAS-L1 no se
  // corta al abrir el paquete.
  await page.getByTestId("lot-code-input").fill("GAS-L1");
  await page.getByTestId("lot-trace-button").click();
  await expect(page.getByTestId("lot-trace")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("lot-trace-outflow-type").allTextContents()).toEqual(["Apertura"]);
  expect(await page.getByTestId("lot-trace-derived-quantity").allTextContents()).toEqual(["12.000000"]);

  await page.getByTestId("lot-trace-follow-derived").click();
  await expect(page.getByTestId("lot-trace-origin-code")).toHaveText("GAS-L1", { timeout: 15_000 });
  expect(await page.getByTestId("lot-presentation-input").inputValue()).toBe(unitPresentationId);
  expect(await page.getByTestId("lot-trace-received").textContent()).toBe("12.000000");

  await page.getByTestId("lot-trace-follow-origin").click();
  await expect(page.getByTestId("lot-trace-derived-lot")).toHaveCount(1, { timeout: 15_000 });
  expect(await page.getByTestId("lot-presentation-input").inputValue()).toBe(packPresentationId);
});

/**
 * Fiar una venta, entero y por la cadena real.
 *
 * `f342f05` dejo las cinco operaciones de credito ruteadas hasta el servicio, y
 * el panel las ofrece desde esta sesion. Nada de eso demuestra todavia que un
 * cajero pueda **fiar**: la deuda nace de una venta con adquiriente, y la venta
 * solo admite adquiriente en el momento de crearse. Este recorrido lo hace
 * entero desde la pantalla —alta del cliente, apertura de cuenta, venta a su
 * nombre, cobro a credito y abono— contra el servicio real por socket.
 *
 * Las cifras no se afirman de memoria: cada una se contrasta contra la que
 * emite `credit.account.get` despues del hecho.
 */
test("un cajero fia una venta y recibe el abono, por la cadena real", async () => {
  const page = await app.firstWindow();
  await page.getByTestId("reset-button").click();

  // --- 1 · El cliente al que se le va a fiar -------------------------------
  const identification = `11${String(Date.now()).slice(-8)}`;
  await page.getByTestId("customer-document-code-input").fill("13");
  await page.getByTestId("customer-identification-input").fill(identification);
  await page.getByTestId("customer-legal-organization-input").fill("2");
  await page.getByTestId("customer-tribute-input").fill("ZZ");
  await page.getByTestId("customer-responsibilities-input").fill("R-99-PN");
  await page.getByTestId("customer-names-input").fill("Rosa Quintero");
  await page.getByTestId("register-customer-button").click();
  await expect(page.getByTestId("customer-registered")).toBeVisible({ timeout: 15_000 });
  const customerId = (await page.getByTestId("customer-registered-id").textContent())?.trim() ?? "";
  expect(customerId).toMatch(/^[0-9a-f-]{36}$/);

  // --- 2 · La cuenta de credito, con su cupo -------------------------------
  await page.getByTestId("credit-customer-id-input").fill(customerId);
  await page.getByTestId("credit-limit-input").fill("50000.000000");
  await page.getByTestId("credit-currency-input").fill("COP");
  await page.getByTestId("open-credit-account-button").click();
  await expect(page.getByTestId("credit-opened")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("credit-opened-outcome").textContent()).toBe("OPENED");
  expect((await page.getByTestId("credit-opened-account-id").textContent())?.trim())
    .toMatch(/^[0-9a-f-]{36}$/);

  // Recien abierta no debe nada y el cupo esta entero.
  await page.getByTestId("read-credit-account-button").click();
  await expect(page.getByTestId("credit-account")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("credit-account-limit").textContent()).toBe("50000.000000");
  expect(await page.getByTestId("credit-account-balance").textContent()).toBe("0.000000");
  expect(await page.getByTestId("credit-account-available").textContent()).toBe("50000.000000");

  // --- 2b · Una tanda propia del cafe, que es la que esta venta se llevara --
  //
  // Vence antes que `CAFE-L1` del primer recorrido, asi que FEFO la elige sin
  // depender de lo que hayan vendido las pruebas de en medio. El ID de la
  // presentacion se prepara por el canal, como la preparacion del primer
  // recorrido: la pantalla de venta no lo muestra.
  const cafePresentation = await page.evaluate(async (barcode) => {
    const posService = (globalThis as unknown as {
      posService: Record<string, (request: unknown) => Promise<unknown>>;
    }).posService;
    const found = await posService["catalog.item.find"]!({
      protocol_version: "1.0.0",
      message_type: "catalog.item.find",
      request_id: crypto.randomUUID(),
      correlation_id: crypto.randomUUID(),
      payload_schema_version: "1.0.0",
      payload: { barcode },
    });
    return (found as { result: { presentation_id: string } }).result.presentation_id;
  }, BARCODE);
  await page.getByTestId("lot-presentation-input").fill(cafePresentation);
  await page.getByTestId("lot-business-date-input").fill("2026-09-03");
  await page.getByTestId("lot-code-input").fill("CAFE-FIADO");
  await page.getByTestId("lot-quantity-input").fill("1");
  await page.getByTestId("lot-expiry-input").fill("2098-12-31");
  await page.getByTestId("lot-receive-button").click();
  await expect(page.getByTestId("lot-received-outcome")).toHaveText("RECEIVED", { timeout: 15_000 });

  // --- 3 · La venta, a nombre del cliente ----------------------------------
  //
  // El adquiriente va en la creacion o no va: `SqlitePaymentStore.register`
  // rechaza con `CUSTOMER_REQUIRED` toda venta con `customer_id` nulo.
  await page.getByTestId("barcode-input").fill(BARCODE);
  await page.getByTestId("find-item-button").click();
  await expect(page.getByTestId("quantity-input")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("quantity-input").fill("1");
  await page.getByTestId("add-item-button").click();
  await page.getByTestId("sale-customer-id-input").fill(customerId);
  await page.getByTestId("create-sale-button").click();
  await expect(page.getByTestId("sale-created")).toBeVisible({ timeout: 15_000 });

  const saleId = (await page.getByTestId("sale-id").textContent())?.trim() ?? "";
  const payable = (await page.getByTestId("payable-amount").textContent())?.trim() ?? "";
  expect(saleId).toMatch(/^[0-9a-f-]{36}$/);

  // --- 4 · Fiarla ----------------------------------------------------------
  await page.getByTestId("credit-sale-id-input").fill(saleId);
  await page.getByTestId("credit-charge-amount-input").fill(payable);
  await page.getByTestId("charge-to-credit-button").click();
  await expect(page.getByTestId("credit-charged")).toBeVisible({ timeout: 15_000 });

  // Fiar **cobra la venta**: la cobertura la da el credito, y la mercancia sale.
  expect(await page.getByTestId("credit-charged-completed").textContent()).toBe("COMPLETED");
  expect(await page.getByTestId("credit-limit-exceeded").count()).toBe(0);
  expect(await page.getByTestId("credit-charge-rejected").count()).toBe(0);

  // --- 4b · Del lote a la persona, desde la pantalla ------------------------
  //
  // Rastro → venta → comprador: lo que un retiro sanitario necesita para
  // llamar a alguien. Cada salto lo da el contrato de su dueño.
  await page.getByTestId("lot-code-input").fill("CAFE-FIADO");
  await page.getByTestId("lot-trace-button").click();
  await expect(page.getByTestId("lot-trace")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("lot-trace-outflow-type").allTextContents()).toEqual(["Venta"]);
  await page.getByTestId("lot-trace-open-sale").click();
  await expect(page.getByTestId("lot-trace-sale-customer")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("lot-trace-sale-customer").click();
  await expect(page.getByTestId("lot-trace-buyer-name")).toHaveText("Rosa Quintero", { timeout: 15_000 });
  expect(await page.getByTestId("lot-trace-buyer-identification").textContent()).toBe(identification);

  await page.getByTestId("lot-buyers-button").click();
  await expect(page.getByTestId("lot-buyers")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("lot-buyer-name").allTextContents()).toEqual(["Rosa Quintero"]);
  expect(await page.getByTestId("lot-buyers-anonymous").textContent()).toBe("0");
  expect(await page.getByTestId("lot-buyers-failure").count()).toBe(0);

  // Y deja deuda: el saldo es el importe fiado y el cupo baja en la misma cifra.
  await page.getByTestId("read-credit-account-button").click();
  await expect(page.getByTestId("credit-account-balance")).toHaveText(payable, { timeout: 15_000 });
  const availableAfterCharge = await page.getByTestId("credit-account-available").textContent();
  expect(availableAfterCharge).not.toBe("50000.000000");

  // --- 5 · Un abono parcial en efectivo ------------------------------------
  //
  // El turno sigue abierto del recorrido anterior, que es lo que el efectivo
  // exige: un abono en efectivo entra al cajon (`DEC-002` §146 regla 10).
  await page.getByTestId("credit-repayment-amount-input").fill("5000.000000");
  await page.getByTestId("credit-repayment-method-select").selectOption("CASH");
  await page.getByTestId("credit-repayment-register-input").fill(REGISTER);
  // La fecha de negocio la teclea el cajero: el abono no la deduce del reloj
  // del equipo, igual que ninguna otra operacion con efecto contable.
  const today = new Date();
  const businessDate = [
    String(today.getFullYear()),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  await page.getByTestId("credit-repayment-date-input").fill(businessDate);
  await page.getByTestId("register-repayment-button").click();
  await expect(page.getByTestId("credit-repaid")).toBeVisible({ timeout: 15_000 });
  expect((await page.getByTestId("credit-repaid-transaction-id").textContent())?.trim())
    .toMatch(/^[0-9a-f-]{36}$/);

  // El saldo que declara el abono es el mismo que devuelve la consulta: la
  // pantalla no lo recalcula, y las dos rutas de lectura coinciden.
  const balanceAfterRepayment = (await page.getByTestId("credit-repaid-balance").textContent())?.trim() ?? "";
  const availableAfterRepayment = (await page.getByTestId("credit-repaid-available").textContent())?.trim() ?? "";
  expect(balanceAfterRepayment).not.toBe(payable);

  await page.getByTestId("read-credit-account-button").click();
  await expect(page.getByTestId("credit-account-balance"))
    .toHaveText(balanceAfterRepayment, { timeout: 15_000 });
  expect(await page.getByTestId("credit-account-available").textContent())
    .toBe(availableAfterRepayment);

  expect(await page.getByTestId("credit-repayment-rejected").count()).toBe(0);
  expect(await page.getByTestId("credit-error").count()).toBe(0);
  expect(await page.getByTestId("sale-error").count()).toBe(0);
});

/**
 * La sesion del equipo, leida de la pantalla contra el servicio real.
 *
 * Es la operacion que gobierna todas las demas y era la ultima sin superficie:
 * `session.recover` estaba ruteado desde `f342f05` y nadie lo llamaba. Aqui se
 * comprueba lo unico que no puede comprobarse con un doble: que el servicio
 * real encuentra **la sesion de este equipo** —resuelta por `installation_id` y
 * `device_id` de la configuracion local, no por nada que mande el llamador— y
 * que revincula la conexion.
 *
 * Va al final a proposito: la sesion existe porque el primer recorrido la
 * activo. Al montar la ventana todavia no existia, que es justo la diferencia
 * que esta prueba observa.
 */
/**
 * El panel de estado contra el servicio real.
 *
 * Estuvo roto y ninguna prueba lo veia: el hook enviaba el payload desnudo y
 * `channel/server.ts` valida todo request entrante con `IpcRequestSchema`, de
 * modo que el servicio lo rechazaba **siempre**. En la aplicacion real el panel
 * decia «Sin conexion» con el servicio vivo al otro lado del socket. Los dobles
 * de prueba lo aceptaban, asi que el defecto solo aparece aqui.
 */
test("el panel de estado dice conectado contra el servicio real", async () => {
  const page = await app.firstWindow();
  await expect(page.getByTestId("status-connected")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("status-error").count()).toBe(0);
});

test("la pantalla recupera la sesion de este equipo contra el servicio real", async () => {
  const page = await app.firstWindow();

  // El identificador que el servicio firmo al arrancar: la verdad contra la que
  // se contrasta lo que pinta la pantalla.
  const expectedSession = (sessionAssertion as { claims: { session_id: string } }).claims.session_id;

  // Antes de pulsar, la pantalla sigue mostrando lo que encontro al montar:
  // **no habia sesion**, porque el primer recorrido aun no la habia activado.
  // Sin esta comprobacion la prueba pasaria igual aunque el boton no hiciera
  // nada, y no demostraria que la recuperacion es lo que cambia el estado.
  await expect(page.getByTestId("session-none")).toBeVisible();
  expect(await page.getByTestId("session-active").count()).toBe(0);

  await page.getByTestId("recover-session-button").click();
  await expect(page.getByTestId("session-active")).toBeVisible({ timeout: 15_000 });

  expect(await page.getByTestId("session-id").textContent()).toBe(expectedSession);

  // La ventana offline sale del servicio y llega literal: es lo que dice hasta
  // cuando se puede seguir vendiendo sin Internet.
  const offlineValidUntil = await page.getByTestId("session-offline-valid-until").textContent();
  expect(offlineValidUntil).toBe(
    (sessionAssertion as { claims: { offline_valid_until: string } }).claims.offline_valid_until,
  );

  expect(await page.getByTestId("session-none").count()).toBe(0);
  expect(await page.getByTestId("session-unverifiable").count()).toBe(0);
  expect(await page.getByTestId("session-error").count()).toBe(0);
});

/**
 * El QR sin adquiriente y la cancelacion de un pago abandonado, por la cadena
 * real.
 *
 * Son las dos ultimas operaciones de pago que quedaban sin pantalla. Se prueban
 * juntas porque son el mismo problema operativo: un cobro que nadie completa
 * deja la venta con un componente pendiente, y alguien tiene que poder
 * soltarlo.
 *
 * **La cancelacion se prueba sobre una transferencia, no sobre un QR.** Una
 * transferencia reportada y sin atestiguar es exactamente un pago pendiente
 * cancelable, y no necesita proveedor: asi el recorrido entero corre contra el
 * servicio real sin un solo doble. El QR se ejerce en el unico desenlace que
 * este equipo puede producir de verdad.
 */
test("QR sin adquiriente y cancelacion de un pago pendiente, por la cadena real", async () => {
  const page = await app.firstWindow();
  await page.getByTestId("reset-button").click();

  // --- 1 · Una venta nueva, para no tocar ninguna de las anteriores --------
  await page.getByTestId("barcode-input").fill(BARCODE);
  await page.getByTestId("find-item-button").click();
  await expect(page.getByTestId("quantity-input")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("quantity-input").fill("1");
  await page.getByTestId("add-item-button").click();
  await page.getByTestId("create-sale-button").click();
  await expect(page.getByTestId("sale-created")).toBeVisible({ timeout: 15_000 });

  const saleId = (await page.getByTestId("sale-id").textContent())?.trim() ?? "";
  const payable = (await page.getByTestId("payable-amount").textContent())?.trim() ?? "";

  // --- 2 · El QR: este equipo no tiene adquiriente -------------------------
  //
  // `PROVIDER_NOT_CONFIGURED` es una negativa tipada, no un fallo, y es el
  // estado real de toda instalacion sin proveedor. Que llegue a la pantalla es
  // lo que distingue «no hay adquiriente» de «la operacion no existe».
  await page.getByTestId("qr-sale-id-input").fill(saleId);
  await page.getByTestId("qr-amount-input").fill(payable);
  await page.getByTestId("charge-qr-button").click();
  await expect(page.getByTestId("qr-provider-not-configured")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("qr-pending").count()).toBe(0);
  expect(await page.getByTestId("qr-rejected").count()).toBe(0);
  expect(await page.getByTestId("provider-payment-error").count()).toBe(0);

  // La venta sigue sin cobrar: un QR rechazado no deja rastro de cobertura.
  expect(await page.getByTestId("sale-completed").count()).toBe(0);

  // --- 3 · Un pago pendiente de verdad: la transferencia reportada ---------
  await page.getByTestId("register-transfer-button").click();
  await expect(page.getByTestId("transfer-registered")).toBeVisible({ timeout: 15_000 });
  const paymentId = (await page.getByTestId("transfer-payment-id").textContent())?.trim() ?? "";
  expect(paymentId).toMatch(/^[0-9a-f-]{36}$/);

  // --- 4 · Leer antes de ordenar: la version es control optimista ----------
  await page.getByTestId("payment-id-input").fill(paymentId);
  await page.getByTestId("read-payment-button").click();
  await expect(page.getByTestId("payment-found")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("payment-expected-amount").textContent()).toBe(payable);
  const statusBeforeCancel = await page.getByTestId("payment-status").textContent();
  expect(statusBeforeCancel).not.toBe("CONFIRMED");

  // --- 5 · Cancelar ---------------------------------------------------------
  await page.getByTestId("cancel-payment-button").click();
  await expect(page.getByTestId("payment-cancelled")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("cancelled-payment-id").textContent()).toBe(paymentId);
  expect(await page.getByTestId("cancel-rejected").count()).toBe(0);

  // La venta sigue sin cobrar: cancelar libera el componente, no lo cobra.
  expect(await page.getByTestId("sale-completed").count()).toBe(0);
  expect(await page.getByTestId("transfer-sale-completed").count()).toBe(0);

  // --- 6 · Cancelar lo ya cancelado no es un rechazo ------------------------
  //
  // El servicio devuelve `IDEMPOTENT` —el pago ya estaba cancelado, que es el
  // mismo hecho— y no `PAYMENT_NOT_CANCELLABLE`. Se relee la version primero:
  // sin eso el intento chocaria antes contra el control de concurrencia.
  // Se espera al **texto**, no a que el bloque siga visible: `payment-found`
  // nunca desaparece entre lecturas, asi que esperar su visibilidad no espera
  // a la respuesta nueva y la asercion leeria el valor anterior.
  await page.getByTestId("read-payment-button").click();
  await expect(page.getByTestId("payment-status")).toHaveText("CANCELLED", { timeout: 15_000 });
  await page.getByTestId("cancel-payment-button").click();
  await expect(page.getByTestId("payment-already-cancelled")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("cancel-rejected").count()).toBe(0);

  // --- 7 · Un pago confirmado si es inmutable ------------------------------
  //
  // Esto es lo que `PAYMENT_NOT_CANCELLABLE` protege de verdad, y no puede
  // probarse sobre un pago cancelado: hace falta uno **confirmado**. Se cobra
  // la venta por transferencia y se intenta cancelarla despues. Deshacer un
  // cobro confirmado es una operacion compensatoria que V1 no implementa
  // (`DEC-002`, deuda D-22), no una cancelacion.
  // Venta nueva: la pantalla admite una sola transferencia por venta, y la de
  // arriba quedo cancelada. Cobrarla de nuevo exige empezar limpio, que es
  // ademas lo que haria el cajero.
  await page.getByTestId("reset-button").click();
  await page.getByTestId("barcode-input").fill(BARCODE);
  await page.getByTestId("find-item-button").click();
  await expect(page.getByTestId("quantity-input")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("quantity-input").fill("1");
  await page.getByTestId("add-item-button").click();
  await page.getByTestId("create-sale-button").click();
  await expect(page.getByTestId("sale-created")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("register-transfer-button").click();
  await expect(page.getByTestId("transfer-registered")).toBeVisible({ timeout: 15_000 });
  const confirmedPaymentId = (await page.getByTestId("transfer-payment-id").textContent())?.trim() ?? "";
  expect(confirmedPaymentId).not.toBe(paymentId);

  await page.getByTestId("confirm-transfer-button").click();
  await expect(page.getByTestId("transfer-sale-completed")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("payment-id-input").fill(confirmedPaymentId);
  await page.getByTestId("read-payment-button").click();
  await expect(page.getByTestId("payment-status")).toHaveText("CONFIRMED", { timeout: 15_000 });

  await page.getByTestId("cancel-payment-button").click();
  await expect(page.getByTestId("payment-not-cancellable")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("provider-payment-error").count()).toBe(0);
});

/**
 * La emisión fiscal **desde la pantalla**, contra el servicio real — `DEC-021` F5.
 *
 * Esta prueba cambió de desenlace al cerrarse `D-19`, y el cambio es su
 * contenido. Antes su aserción principal era un bloqueo: `catalog_fiscal_attribute`
 * tenía lectores y **cero escritores**, así que ningún producto dado de alta
 * por la pantalla se podía facturar, y la prueba lo afirmaba en vez de sembrar
 * la fila a mano para fingir la capacidad.
 *
 * Ahora la pantalla declara esos códigos (`catalog.fiscal.attribute.set`) y la
 * cadena llega hasta el final. Lo que se comprueba, en orden:
 *
 * 1. `LINE_FISCAL_ATTRIBUTE_MISSING` **ya no aparece**: es la prueba de que el
 *    escritor existe y de que lo que escribe es lo que la emisión lee.
 * 2. El mostrador anónimo sigue bloqueado, y ahora por su motivo real y único:
 *    `GENERIC_ACQUIRER_NOT_VERIFIED` (`D-13`). Que el bloqueo se reduzca a una
 *    sola causa es lo que demuestra que la otra se cerró.
 * 3. Con adquiriente identificado la factura se **emite**, con su CUFE y su
 *    número, tecleado todo desde la ventana.
 *
 * **Alcance de ese `ISSUED`.** El único trozo que el arnés sustituye es el
 * puerto de emisión (`FakeIssuancePort` en `real-service-host.ts`): hablar de
 * verdad con FACTUS es `F6` y exige credenciales que no están aquí. Contrato,
 * canal, handler, caso de uso, máquina de estados y SQLite son de producción.
 * Esto acredita `END_TO_END` contra un proveedor sustituido, no `PRODUCTION`.
 */
test("la emisión fiscal se dispara desde la pantalla: sin atributo no había factura, con él la hay", async () => {
  const page = await app.firstWindow();

  const code = `FISC-${randomUUID().slice(0, 8)}`;
  const barcode = `77055555${String(Date.now()).slice(-5)}`;

  // El turno que dejó abierto la prueba anterior sigue sirviendo, y usarlo es
  // lo que haría un cajero: no se abre un turno por factura. `reset` limpia la
  // venta en curso, no el turno.
  await page.getByTestId("reset-button").click();
  await expect(page.getByTestId("shift-open")).toBeVisible({ timeout: 15_000 });

  // Producto y existencia, tecleados en la pantalla.
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

  // D-19: los códigos fiscales de la presentación, tecleados en la pantalla.
  // Este paso es el que no existía. La presentación viene prerrellenada del
  // alta, así que el operador sólo aporta la referencia del artículo.
  await page.getByTestId("fiscal-code-reference-input").fill(code);
  await page.getByTestId("set-fiscal-attribute-button").click();
  await expect(page.getByTestId("fiscal-attribute-outcome")).toHaveText("SET", { timeout: 15_000 });
  expect(await page.getByTestId("fiscal-attribute-findings").count()).toBe(0);

  await page.getByTestId("inventory-presentation-input").fill(presentationId!);
  await page.getByTestId("receive-quantity-input").fill("5");
  await page.getByTestId("receive-reason-input").fill("PURCHASE");
  await page.getByTestId("receive-stock-button").click();
  await expect(page.getByTestId("inventory-movement")).toBeVisible({ timeout: 15_000 });

  // Venta y cobro, tambien desde la pantalla.
  await page.getByTestId("barcode-input").fill(barcode);
  await page.getByTestId("find-item-button").click();
  await expect(page.getByTestId("quantity-input")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("quantity-input").fill("1");
  await page.getByTestId("add-item-button").click();
  await page.getByTestId("create-sale-button").click();
  await expect(page.getByTestId("sale-created")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("charge-cash-button").click();
  await expect(page.getByTestId("sale-completed")).toBeVisible({ timeout: 15_000 });

  const saleId = (await page.getByTestId("sale-id").textContent())?.trim() ?? "";
  expect(saleId).toMatch(/^[0-9a-f-]{36}$/);

  // --- Y aqui empieza lo que esta prueba existe para comprobar ---------------

  // 1 · Venta de mostrador sin identificar: el caso mayoritario de un POS.
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
  // El motivo ya **no** es `D-19`: el producto que la pantalla acaba de dar de
  // alta sí tiene atributo fiscal, porque la propia pantalla se lo dio. Queda
  // una sola causa, y es la del adquiriente anónimo.
  const reasons = (await page.getByTestId("fiscal-blocked-reason").allTextContents()).join(" ");
  expect(reasons).not.toContain("LINE_FISCAL_ATTRIBUTE_MISSING");
  expect(reasons).toContain("GENERIC_ACQUIRER_NOT_VERIFIED");

  // 2 · Con un adquiriente identificado ya **no** queda nada que bloquee: la
  //     factura se emite. Antes de `D-19` este mismo paso bloqueaba igual que
  //     el anterior, y ésa era la prueba de que al adquiriente le faltaba
  //     compañía.
  const identification = `10${String(Date.now()).slice(-8)}`;
  await page.getByTestId("customer-document-code-input").fill("13");
  await page.getByTestId("customer-identification-input").fill(identification);
  await page.getByTestId("customer-legal-organization-input").fill("2");
  await page.getByTestId("customer-tribute-input").fill("ZZ");
  await page.getByTestId("customer-responsibilities-input").fill("R-99-PN");
  await page.getByTestId("customer-names-input").fill("Cliente Fiscal");
  await page.getByTestId("register-customer-button").click();
  await expect(page.getByTestId("customer-registered")).toBeVisible({ timeout: 15_000 });
  const customerId = await page.getByTestId("customer-registered-id").textContent();

  await page.getByTestId("fiscal-customer-id-input").fill(customerId!);
  await page.getByTestId("issue-identified-button").click();
  await expect(page.getByTestId("fiscal-issued")).toBeVisible({ timeout: 15_000 });

  // El CUFE y el número los pone el puerto sustituido; lo que acredita la
  // prueba es que llegan **intactos** hasta el ojo del cajero, no que la DIAN
  // los haya emitido.
  const issued = (await page.getByTestId("fiscal-issued").textContent()) ?? "";
  expect(issued).toContain("ISSUED");
  expect(issued).toContain("990000001");
  expect(await page.getByTestId("fiscal-blocked").count()).toBe(0);
  expect(await page.getByTestId("fiscal-error").count()).toBe(0);

  // 3 · Una venta que no existe no es un bloqueo de payload: es inelegible, y
  //     la pantalla los distingue.
  await page.getByTestId("fiscal-sale-id-input").fill("018f0000-0000-7000-8000-0000000000fd");
  await page.getByTestId("issue-anonymous-button").click();
  await expect(page.getByTestId("fiscal-retriable")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("fiscal-retriable-outcome").textContent()).toBe("NOT_ELIGIBLE");
  expect(await page.getByTestId("fiscal-blocked").count()).toBe(0);
});

/**
 * La carga inicial del catálogo, desde la ventana y contra el servicio real.
 *
 * Es la pantalla que convierte «se lo monto yo» en «el comerciante lo hace
 * solo». Se conduce con lo que un comerciante entrega de verdad: **CSV de
 * Excel en español, con `;`**, con una línea mala en medio.
 *
 * La prueba no se conforma con que la pantalla diga «cargado»: escanea lo
 * cargado en la caja y comprueba que aparece con su nombre y su precio. Una
 * pantalla que dijera «2 cargados» sin haber cargado nada pasaría cualquier
 * prueba que sólo mirase su propio texto.
 */
test("el comerciante carga su catálogo pegando su hoja de Excel, y lo cargado se escanea en caja", async () => {
  const page = await app.firstWindow();

  // **Autosuficiente.** La sesión la vincula la primera prueba del fichero, y
  // esta fallaba con `SESSION_NOT_BOUND` al ejecutarla sola: una prueba que
  // sólo pasa si otra corrió antes no prueba lo que dice.
  //
  // Aislada, activar responde `ACTIVATED`. En la suite la SSA ya se aceptó, y
  // reenviarla es un replay: lo rechaza el **verificador** —`SEQUENCE_REPLAY`—
  // antes de llegar al almacén, y la conexión sigue vinculada desde la primera
  // prueba. Se comprueba la decisión exacta y no «cualquier rechazo»: aceptar
  // cualquiera dejaría pasar una firma inválida como si fuera un reenvío.
  const activation = await page.evaluate(async (assertion) => {
    const posService = (globalThis as unknown as {
      posService: Record<string, (request: unknown) => Promise<unknown>>;
    }).posService;
    const response = await posService["session.activate"]!({
      protocol_version: "1.0.0",
      message_type: "session.activate",
      request_id: crypto.randomUUID(),
      correlation_id: crypto.randomUUID(),
      payload_schema_version: "1.0.0",
      payload: { session_assertion: assertion },
    });
    const typed = response as { result_code: string; result: { decision: string | null } | null };
    return `${typed.result_code}/${typed.result?.decision ?? "-"}`;
  }, sessionAssertion);
  expect(["ACTIVATED/-", "REJECTED/SEQUENCE_REPLAY"]).toContain(activation);
  const suffix = randomUUID().slice(0, 6).toUpperCase();
  const arrozBarcode = `77091${String(Date.now()).slice(-8)}`;
  const aceiteBarcode = `77092${String(Date.now()).slice(-8)}`;

  // Tal como lo exporta Excel en español: `;` y coma decimal. La línea 3 no
  // tiene nombre, que es un error de captura real.
  const hoja = [
    "codigo;nombre;presentacion;unidad;decimales;codigo_barras;precio;existencia_inicial",
    `ARROZ-${suffix};Arroz Diana 500 g;Bolsa;UND;0;${arrozBarcode};3200;40`,
    `ROTA-${suffix};;Unidad;UND;0;;1000;`,
    `ACEITE-${suffix};Aceite 1000 ml;Botella;UND;0;${aceiteBarcode};12500,5;`,
  ].join("\n");

  await page.getByTestId("catalog-import-text").fill(hoja);
  await page.getByTestId("catalog-import-review").click();

  // Revisar no envía nada: dice qué está listo y qué no, con la línea.
  await expect(page.getByTestId("catalog-import-ready")).toHaveText("2 línea(s) lista(s)");
  await expect(page.getByTestId("catalog-import-error-count"))
    .toHaveText("1 línea(s) con error — se omiten al cargar");
  await expect(page.getByTestId("catalog-import-errors")).toContainText("Línea 3: nombre vacío");

  await page.getByTestId("catalog-import-submit").click();
  await expect(page.getByTestId("catalog-import-imported"))
    .toHaveText("2 cargado(s)", { timeout: 15_000 });
  expect(await page.getByTestId("catalog-import-rejected").count()).toBe(0);
  expect(await page.getByTestId("catalog-import-error").count()).toBe(0);

  // **Lo cargado existe de verdad**: se escanea en la caja y aparece con su
  // nombre y su precio, leídos del servicio.
  await page.getByTestId("barcode-input").fill(arrozBarcode);
  await page.getByTestId("find-item-button").click();
  await expect(page.getByTestId("found-item-name")).toHaveText("Arroz Diana 500 g", { timeout: 15_000 });
  await expect(page.getByTestId("found-item-price")).toHaveText("3200.000000");

  // La coma decimal de la hoja llegó como precio exacto, no truncado.
  await page.getByTestId("barcode-input").fill(aceiteBarcode);
  await page.getByTestId("find-item-button").click();
  await expect(page.getByTestId("found-item-name")).toHaveText("Aceite 1000 ml", { timeout: 15_000 });
  await expect(page.getByTestId("found-item-price")).toHaveText("12500.500000");

  // Recargar la misma hoja no duplica nada: responde que ya existía.
  await page.getByTestId("catalog-import-review").click();
  await page.getByTestId("catalog-import-submit").click();
  await expect(page.getByTestId("catalog-import-imported"))
    .toHaveText("0 cargado(s)", { timeout: 15_000 });
  await expect(page.getByTestId("catalog-import-rejected")).toContainText("CODE_ALREADY_REGISTERED");
  await expect(page.getByTestId("catalog-import-rejected")).toContainText("Línea 2");
});

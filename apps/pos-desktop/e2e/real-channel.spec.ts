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
});

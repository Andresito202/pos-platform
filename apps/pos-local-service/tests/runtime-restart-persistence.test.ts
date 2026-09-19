import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalChannelAuthenticator, LocalChannelClient } from "@pos-platform/local-channel";

/**
 * Lo vendido sobrevive al proceso que lo vendió.
 *
 * ## Qué faltaba, exactamente
 *
 * El repositorio probaba persistencia por partes —`session-assertion-store`
 * y `authorization-snapshot-store` cierran y reabren SQLite dentro del mismo
 * proceso, y `process.test.ts` demuestra que la identidad de dispositivo
 * sobrevive a un reinicio real—. Ninguna prueba recorría el trayecto que le
 * importa a un comerciante:
 *
 * ```
 * runtime #1 → venta cobrada y COMPLETED
 *            → el proceso muere
 * runtime #2 → misma base → la venta sigue ahí, cobrada una sola vez
 * ```
 *
 * Reabrir un store dentro del mismo proceso no lo demuestra: el caché de
 * `better-sqlite3`, el estado en memoria de los componentes y el WAL sin
 * consolidar siguen vivos. Aquí hay **dos procesos distintos**, el segundo
 * arrancado después de que el primero haya salido con código 0.
 *
 * ## Por qué el arnés y no `src/main.ts`
 *
 * En POSIX `main.ts` no registra `LocalChannelComponent` —sólo lo añade bajo
 * `win32`— de modo que el runtime productivo no sirve comercio fuera de
 * Windows. El único runtime que sí lo hace en este entorno es
 * `e2e-host/real-service-host.ts`, que es el que ya conduce
 * `real-channel.spec.ts`: `LocalChannelServer`, `CommercialComponent`,
 * `CommercialRequestHandler` y SQLite de producción, sin dobles en ningún
 * tramo. Esta prueba lo reutiliza tal cual.
 *
 * **Esto no es evidencia de Windows.** Corre sobre socket POSIX. El named pipe
 * y su DACL siguen cubiertos aparte y siguen sin ejecutarse aquí.
 *
 * ## Por qué el segundo arranque pide `sequence` 2
 *
 * No es un atajo: es el contrato. `SqliteSessionAssertionStore` persiste la
 * cota `highestAcceptedSequence` por binding, así que reutilizar la secuencia
 * del primer arranque se rechazaría como replay. Que haga falta subirla es,
 * en sí mismo, prueba de que la cota anti-replay cruzó el reinicio.
 *
 * TODO EL MATERIAL CRIPTOGRÁFICO LO GENERA EL ARNÉS EN MEMORIA Y ES EXCLUSIVO
 * DE VERIFICACIÓN.
 */

const TENANT = "018f0000-0000-7000-8000-0000000000a4";
const COMPANY = "018f0000-0000-7000-8000-0000000000a5";
const BRANCH = "018f0000-0000-7000-8000-0000000000a6";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000a2";
const DEVICE = "018f0000-0000-7000-8000-0000000000a3";
const USER = "018f0000-0000-7000-8000-0000000000a1";
const REGISTER = "018f0000-0000-7000-8000-00000000aa01";
const BARCODE = "7701234567891";

const BUSINESS_DATE = "2026-09-03";
const UNITS = "2.000000";
const RECEIVED = "12.000000";
const REMAINING = "10.000000";

const directories: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

interface Ready {
  readonly endpoint: string;
  readonly sessionAssertion: unknown;
}

/** Arranca un runtime sobre `dataDirectory` y espera a que anuncie su canal. */
function startRuntime(
  dataDirectory: string,
  channelSecret: string,
  sessionSequence: number,
): { child: ChildProcessWithoutNullStreams; ready: Promise<Ready> } {
  const child = spawn(
    join(process.cwd(), "node_modules", ".bin", "tsx"),
    [join(process.cwd(), "e2e-host", "real-service-host.ts")],
    {
      cwd: process.cwd(),
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
        POS_E2E_SESSION_SEQUENCE: String(sessionSequence),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  ) as ChildProcessWithoutNullStreams;
  children.push(child);

  const ready = new Promise<Ready>((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => { reject(new Error("the runtime did not become ready")); }, 30_000);
    timer.unref?.();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffered += chunk;
      const line = buffered.split("\n").find((candidate) => candidate.includes("\"ready\""));
      if (line !== undefined) {
        clearTimeout(timer);
        resolve(JSON.parse(line) as Ready);
      }
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`the runtime exited early with code ${String(code)}: ${stderr}`));
    });
  });

  return { child, ready };
}

/** Apaga el runtime como lo haría el gestor de servicios y devuelve su código. */
function stopRuntime(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("the runtime did not exit within the shutdown timeout"));
    }, 15_000);
    timer.unref?.();
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.kill("SIGTERM");
  });
}

const BASE = { protocol_version: "1.0.0", payload_schema_version: "1.0.0" } as const;

/** Cliente real del canal, con handshake real. */
async function connect(endpoint: string, channelSecret: string): Promise<LocalChannelClient> {
  const client = new LocalChannelClient(
    endpoint,
    new LocalChannelAuthenticator(Buffer.from(channelSecret, "hex")),
    { min: "1.0.0", max: "1.0.0" },
    15_000,
  );
  await client.connect({
    ...BASE,
    message_type: "runtime.handshake",
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    payload: {
      desktop_version: "1.0.0",
      service_version: "1.0.0",
      protocol_min: "1.0.0",
      protocol_max: "1.0.0",
      installation_id: INSTALLATION,
      device_id: DEVICE,
      schema_version: "22",
      service_state: "READY",
    },
  });
  return client;
}

interface ChannelResponse {
  readonly status: string;
  readonly result_code: string;
  readonly error: { code: string } | null;
  readonly result: Record<string, unknown>;
}

async function reading(
  client: LocalChannelClient,
  messageType: string,
  payload: Record<string, unknown>,
): Promise<ChannelResponse> {
  return await client.request({
    ...BASE,
    message_type: messageType,
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    payload,
  }) as ChannelResponse;
}

async function mutating(
  client: LocalChannelClient,
  messageType: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<ChannelResponse> {
  return await client.request({
    ...BASE,
    message_type: messageType,
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    operation_id: randomUUID(),
    idempotency_key: idempotencyKey,
    payload,
  }) as ChannelResponse;
}

/** Cuenta filas por el canal no es posible: se cuenta donde están, en disco. */
function rowCount(dataDirectory: string, sql: string, ...params: readonly string[]): Promise<number> {
  return import("@pos-platform/database-sqlite").then(({ LocalDatabase }) => {
    const database = LocalDatabase.open({ dataDirectory });
    try {
      return (database.native.prepare(sql).get(...params) as { n: number }).n;
    } finally {
      database.close();
    }
  });
}

describe("reinicio del runtime — lo vendido sobrevive al proceso", () => {
  it("una venta cobrada sigue COMPLETED, íntegra y sin duplicar, en un proceso nuevo", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "pos-restart-"));
    directories.push(dataDirectory);
    const channelSecret = randomBytes(32).toString("hex");

    // ── Runtime #1 · el mostrador ──────────────────────────────────────────
    const first = startRuntime(dataDirectory, channelSecret, 1);
    const firstReady = await first.ready;
    const firstClient = await connect(firstReady.endpoint, channelSecret);

    const activated = await reading(firstClient, "session.activate", {
      session_assertion: firstReady.sessionAssertion,
    });
    expect(activated.status).toBe("SUCCEEDED");

    const shift = await mutating(firstClient, "cash.shift.open", {
      cash_register_id: REGISTER,
      opening_amount: "0.000000",
      business_date: BUSINESS_DATE,
      timezone_id: "America/Bogota",
      utc_offset_minutes: -300,
    }, "restart:shift");
    expect(shift.status).toBe("SUCCEEDED");

    const product = await mutating(firstClient, "catalog.product.register", {
      code: "CAFE-RESTART",
      name: "Café Americano 500 g",
      stock_controlled: true,
      presentation_name: "Bolsa 500 g",
      unit_code: "UND",
      unit_precision: 0,
      barcode: BARCODE,
      price_amount: "18000.000000",
      currency_code: "COP",
    }, "restart:catalog");
    expect(product.status).toBe("SUCCEEDED");
    const presentationId = product.result["presentation_id"] as string;
    const productId = product.result["product_id"] as string;

    const received = await mutating(firstClient, "inventory.stock.receive", {
      presentation_id: presentationId,
      movement_type: "PURCHASE_RECEIPT",
      quantity: RECEIVED,
      reason_code: "SUPPLIER_DELIVERY",
      business_date: BUSINESS_DATE,
    }, "restart:inventory");
    expect(received.status).toBe("SUCCEEDED");

    const sale = await mutating(firstClient, "sale.create", {
      cash_register_id: REGISTER,
      channel: "POS",
      business_date: BUSINESS_DATE,
      timezone_id: "America/Bogota",
      utc_offset_minutes: -300,
      document_series: "A",
      currency_code: "COP",
      lines: [{ product_id: productId, presentation_id: presentationId, quantity: UNITS }],
    }, "restart:sale");
    expect(sale.status).toBe("SUCCEEDED");
    const saleId = sale.result["sale_id"] as string;
    const payable = sale.result["payable_amount"] as string;

    const payment = await mutating(firstClient, "payment.register.cash", {
      sale_id: saleId,
      amount: payable,
      tendered_amount: null,
    }, "restart:payment");
    expect(payment.status).toBe("SUCCEEDED");
    expect(payment.result["sale_completed"]).toBe(true);

    // Lo que el runtime #1 ve antes de morir, para comparar contra el #2.
    const receiptBefore = await reading(firstClient, "sales.receipt.get", { sale_id: saleId });
    expect(receiptBefore.result["outcome"]).toBe("FOUND");
    const payableBefore = receiptBefore.result["payable_amount"] as string;

    // ── El proceso muere ───────────────────────────────────────────────────
    await firstClient.close();
    const exitCode = await stopRuntime(first.child);
    expect(exitCode).toBe(0);

    // ── Runtime #2 · proceso nuevo, misma base ─────────────────────────────
    const second = startRuntime(dataDirectory, channelSecret, 2);
    const secondReady = await second.ready;
    const secondClient = await connect(secondReady.endpoint, channelSecret);

    // Que la sesión se active prueba de paso que el snapshot de autorización
    // persistido por el #1 sigue siendo el activo: sin él, `authenticate()`
    // rechazaría cada operación con `AUTHORIZATION_SNAPSHOT_UNAVAILABLE`.
    const reactivated = await reading(secondClient, "session.activate", {
      session_assertion: secondReady.sessionAssertion,
    });
    expect(reactivated.status).toBe("SUCCEEDED");

    // 1 · La venta sigue completada y con el mismo importe.
    const receiptAfter = await reading(secondClient, "sales.receipt.get", { sale_id: saleId });
    expect(receiptAfter.result["outcome"]).toBe("FOUND");
    expect(receiptAfter.result["sale_id"]).toBe(saleId);
    expect(receiptAfter.result["payable_amount"]).toBe(payableBefore);

    // 2 · El pago sigue persistido y es el mismo.
    const paymentId = payment.result["payment_id"] as string;
    const persistedPayment = await reading(secondClient, "payment.get", { payment_id: paymentId });
    expect(persistedPayment.result["outcome"]).toBe("FOUND");
    expect(persistedPayment.result["status"]).toBe("CONFIRMED");
    expect(persistedPayment.result["sale_id"]).toBe(saleId);
    expect(persistedPayment.result["method"]).toBe("CASH");
    // El importe no se movió con el reinicio: ni lo esperado ni lo confirmado.
    expect(persistedPayment.result["expected_amount"]).toBe(payableBefore);
    expect(persistedPayment.result["confirmed_amount"]).toBe(payableBefore);

    // 3 · El inventario conserva lo que quedó: 12 − 2.
    const stock = await reading(secondClient, "inventory.stock.get", {
      presentation_id: presentationId,
    });
    expect(stock.result["outcome"]).toBe("FOUND");
    expect(stock.result["quantity_on_hand"]).toBe(REMAINING);

    // ── Sin runtime vivo ───────────────────────────────────────────────────
    //
    // Los recuentos se hacen con los dos procesos ya muertos, y no por gusto:
    // `LocalDatabase.open` toma el lock de escritor único de `DEC-010`, de
    // modo que abrir la base mientras el runtime la sirve falla —como debe—
    // con «SQLite writer already active». Que el #2 arrancara sobre esta misma
    // base ya demostró que el #1 soltó su lock al apagarse.
    await secondClient.close();
    expect(await stopRuntime(second.child)).toBe(0);

    // 4 · El reinicio no fabricó una segunda venta ni un segundo pago. Se
    //     cuenta en disco porque el canal no expone recuentos, y porque es
    //     ahí donde una duplicación aparecería.
    expect(await rowCount(
      dataDirectory, "SELECT COUNT(*) AS n FROM sales_sales WHERE tenant_id=?", TENANT,
    )).toBe(1);
    expect(await rowCount(
      dataDirectory,
      `SELECT COUNT(DISTINCT payment_id) AS n FROM payments_payment_allocations
        WHERE collection_subject_type='SALE' AND collection_subject_id=?`,
      saleId,
    )).toBe(1);
    expect(await rowCount(
      dataDirectory,
      `SELECT COUNT(*) AS n FROM payments_payment_allocations
        WHERE collection_subject_type='SALE' AND collection_subject_id=?`,
      saleId,
    )).toBe(1);

    // 5 · El estado persistido de la venta, leído fuera de todo caché.
    expect(await rowCount(
      dataDirectory, "SELECT COUNT(*) AS n FROM sales_sales WHERE id=? AND status='COMPLETED'", saleId,
    )).toBe(1);
  }, 120_000);
});

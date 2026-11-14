import { randomBytes, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {Server,Socket} from "node:net";
import {
  LocalChannelAuthenticator,
  LocalChannelClient,
  localChannelEndpoint,
} from "@pos-platform/local-channel";
import { LocalChannelServer } from "../src/index.js";

// Keep actual sockets, framing and MAC. On non-Windows use ephemeral loopback
// TCP because managed Linux may prohibit Unix sockets. Windows keeps the real
// named pipe. Handler responses below remain fixtures, not business E2E.
const loopback=vi.hoisted(()=>({server:undefined as Server|undefined}));
vi.mock("node:net",async original=>{
  const net=await original<typeof import("node:net")>();
  if(process.platform==="win32")return net;
  return {...net,createServer:(listener:(socket:Socket)=>void)=>{
    const server=net.createServer(listener),listen=server.listen.bind(server);
    Object.defineProperty(server,"listen",{value:(_endpoint:string,ready:()=>void)=>listen({host:"127.0.0.1",port:0},ready)});
    loopback.server=server;return server;
  },createConnection:()=>{
    const address=loopback.server?.address();
    if(!address||typeof address==="string")throw Error("TCP_TEST_LISTENER_REQUIRED");
    return net.createConnection({host:"127.0.0.1",port:address.port});
  }};
});

/**
 * Ida y vuelta **real** de las operaciones comerciales por el canal local.
 *
 * Ésta es la prueba que no existía, y su ausencia dejaba pasar el defecto:
 * `LocalChannelClient` mapeaba toda operación no técnica a
 * `OperationResultResponseSchema`, de modo que **ninguna de las 19 respuestas
 * comerciales se podía parsear**. Las pruebas del canal sólo ejercitaban
 * `runtime.status.get`, que sí tenía su esquema.
 *
 * Linux usa TCP loopback efímero; Windows conserva named pipe. No acredita
 * identidad de pares Windows ni transporte SCM multicuenta.
 *
 * El named pipe y su DACL **no** quedan sin verificar por ello: `channel.test.ts`
 * los ejercita con `windowsIt` y CI ejecuta esa suite en `windows-2022`. Lo que
 * sigue siendo `REQUIRES_LOCAL_VERIFICATION` es **la identidad del proceso
 * cliente**, que es otra cosa y todavía no existe.
 */

const clock = { now: () => new Date("2026-08-28T00:00:00Z") };
const installationId = "018f0000-0000-7000-8000-0000000000a1";
const deviceId = "018f0000-0000-7000-8000-0000000000a2";
const directories: string[] = [];

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function directory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pos-commercial-transport-"));
  directories.push(dir);
  return dir;
}

function handshakeRequest() {
  return {
    protocol_version: "1.0.0",
    message_type: "runtime.handshake" as const,
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    payload_schema_version: "1.0.0",
    payload: {
      desktop_version: "1.0.0",
      service_version: "1.0.0",
      protocol_min: "1.0.0",
      protocol_max: "1.0.0",
      installation_id: installationId,
      device_id: deviceId,
      schema_version: "5",
      service_state: "READY",
    },
  };
}

function commercialRequest(messageType: string, payload: unknown) {
  return {
    protocol_version: "1.0.0",
    message_type: messageType,
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    operation_id: randomUUID(),
    idempotency_key: randomUUID(),
    payload_schema_version: "1.0.0",
    payload,
  };
}

function responseFor(request: unknown, resultCode: string, result: unknown) {
  const envelope = request as { request_id: string; correlation_id: string; operation_id?: string };
  return {
    protocol_version: "1.0.0",
    request_id: envelope.request_id,
    correlation_id: envelope.correlation_id,
    operation_id: envelope.operation_id ?? null,
    status: "SUCCEEDED",
    result_code: resultCode,
    result_schema_version: "1.0.0",
    error: null,
    server_time: "2026-08-28T00:00:00.000Z",
    result,
  };
}

/**
 * Estos códigos son los **mismos** en la petición y en la respuesta, y esa
 * simetría es hoy una regla del contrato.
 *
 * Hasta `D-26` no lo era. Aquí vivía una nota que decía que un `"13"` que entra
 * válido «no puede salir», que la asimetría quedaba registrada y que no se
 * corregía «porque tocaría los contratos». El fixture se rellenó entonces con
 * `"CC"`, `"PERSONA_NATURAL"` y `"NO_APLICA"` —valores inventados que ningún
 * catálogo DIAN contiene— porque eran los que el esquema roto aceptaba.
 *
 * El precio de aquella decisión se cobró donde tenía que cobrarse: la primera
 * pantalla que leyó un adquiriente real contra el servicio real mató el socket.
 * Doblar el fixture para que pasara la prueba fue lo que dejó el defecto vivo
 * tres bloques.
 */
const CUSTOMER_READ = {
  outcome: "FOUND",
  customer_id: "018f0000-0000-7000-8000-0000000000f1",
  identification_document_code: "13",
  identification: "1020304050",
  verification_digit: null,
  legal_organization_code: "2",
  company: null,
  names: "Cliente de mostrador",
  tribute_code: "ZZ",
  fiscal_responsibility_codes: ["R-99-PN"],
  email: null, phone: null, address: null,
  country_code: null, municipality_code: null,
  version: 1,
} as const;

const INVENTORY_MOVEMENT = {
  outcome: "POSTED", stock_sequence: 1,
  quantity_after: "10.000000", available: "10.000000",
} as const;

const INVENTORY_STOCK = {
  outcome: "FOUND",
  presentation_id: "018f0000-0000-7000-8000-0000000000c2",
  quantity_on_hand: "10.000000", last_movement_sequence: 1,
} as const;

/** Respuestas comerciales del canal: vertical de caja y catálogo público de licencias. */
const COMMERCIAL_CASES = [
  {
    messageType: "cash.shift.open",
    payload: {
      cash_register_id: "018f0000-0000-7000-8000-0000000000b1",
      opening_amount: "0.000000",
      business_date: "2026-08-28",
      timezone_id: "America/Bogota",
      utc_offset_minutes: -300,
    },
    resultCode: "OPENED",
    result: { outcome: "OPENED", shift_id: "018f0000-0000-7000-8000-0000000000b2", version: 1 },
  },
  {
    messageType: "catalog.item.find",
    payload: { barcode: "7701234567890" },
    resultCode: "FOUND",
    result: {
      outcome: "FOUND",
      product_id: "018f0000-0000-7000-8000-0000000000c1",
      presentation_id: "018f0000-0000-7000-8000-0000000000c2",
      code: "ARZ-500", name: "Arroz", presentation_name: "Bolsa 500g",
      unit_code: "GRM", unit_precision: 0, barcode: "7701234567890",
      stock_controlled: true, price_amount: "3500.000000", currency_code: "COP",
    },
  },
  {
    messageType: "sale.create",
    payload: {
      cash_register_id: "018f0000-0000-7000-8000-0000000000b1",
      channel: "POS", business_date: "2026-08-28", timezone_id: "America/Bogota",
      utc_offset_minutes: -300, document_series: "POS1", currency_code: "COP",
      lines: [{
        product_id: "018f0000-0000-7000-8000-0000000000c1",
        presentation_id: "018f0000-0000-7000-8000-0000000000c2",
        quantity: "1.000000",
      }],
    },
    resultCode: "CREATED",
    result: {
      outcome: "CREATED",
      sale_id: "018f0000-0000-7000-8000-0000000000d1",
      sale_number: 1, payable_amount: "3500.000000",
      calculation_checksum: "a".repeat(64),
    },
  },
  {
    messageType: "payment.register.cash",
    payload: {
      sale_id: "018f0000-0000-7000-8000-0000000000d1",
      amount: "3500.000000", tendered_amount: "3500.000000",
    },
    resultCode: "CONFIRMED",
    result: {
      outcome: "CONFIRMED",
      payment_id: "018f0000-0000-7000-8000-0000000000e1",
      sale_completed: true, confirmed_coverage: "3500.000000",
      payable_amount: "3500.000000", change_amount: "0.000000",
    },
  },
  {messageType:"license.offers.list",payload:{},resultCode:"AVAILABLE",result:{outcome:"AVAILABLE",catalog:{profile:"CAMACHO_PUBLIC_LICENSE_CATALOG_V1",offers:[]}}},
] as const;

const PAYLOAD_BY_MESSAGE_TYPE: Record<string, unknown> = {
  "customer.register": {
    identification_document_code: "13",
    identification: "1020304050",
    verification_digit: null,
    legal_organization_code: "2",
    company: null, names: "Cliente de mostrador",
    tribute_code: "21", fiscal_responsibility_codes: [],
    email: null, phone: null, address: null,
    country_code: null, municipality_code: null,
  },
  "customer.get": { customer_id: "018f0000-0000-7000-8000-0000000000f1" },
  "customer.find": {
    identification_document_code: "13",
    identification: "1020304050",
  },
  "catalog.product.register": {
    code: "ARZ-500", name: "Arroz", stock_controlled: true,
    presentation_name: "Bolsa 500g", unit_code: "GRM", unit_precision: 0,
    barcode: "7701234567890", price_amount: "3500.000000", currency_code: "COP",
  },
  "catalog.item.get": { presentation_id: "018f0000-0000-7000-8000-0000000000c2" },
  "inventory.stock.receive": {
    presentation_id: "018f0000-0000-7000-8000-0000000000c2",
    movement_type: "PURCHASE_RECEIPT", quantity: "10.000000",
    reason_code: "PURCHASE", business_date: "2026-08-28",
  },
  "inventory.stock.adjust": {
    presentation_id: "018f0000-0000-7000-8000-0000000000c2",
    movement_type: "ADJUSTMENT_POSITIVE", quantity: "10.000000",
    reason_code: "COUNT", business_date: "2026-08-28",
  },
  "inventory.stock.get": { presentation_id: "018f0000-0000-7000-8000-0000000000c2" },
};

const EXTRA_RESPONSES: Record<string, readonly [string, unknown]> = {
  "customer.register": ["REGISTERED", {
    outcome: "REGISTERED",
    customer_id: "018f0000-0000-7000-8000-0000000000f1",
    version: 1, findings: [],
  }],
  "customer.get": ["FOUND", CUSTOMER_READ],
  "customer.find": ["FOUND", CUSTOMER_READ],
  "catalog.product.register": ["REGISTERED", {
    outcome: "REGISTERED",
    product_id: "018f0000-0000-7000-8000-0000000000f2",
    presentation_id: "018f0000-0000-7000-8000-0000000000f3",
  }],
  "catalog.item.get": ["FOUND", COMMERCIAL_CASES[1].result],
  "inventory.stock.receive": ["POSTED", INVENTORY_MOVEMENT],
  "inventory.stock.adjust": ["POSTED", INVENTORY_MOVEMENT],
  "inventory.stock.get": ["FOUND", INVENTORY_STOCK],
};

async function withChannel(
  run: (client: LocalChannelClient) => Promise<void>,
): Promise<void> {
  const dir = await directory();
  const endpoint = localChannelEndpoint(installationId, process.platform, dir);
  const secret = randomBytes(32);
  const server = new LocalChannelServer(
    endpoint,
    new LocalChannelAuthenticator(secret, clock),
    (request) => {
      const envelope = request as { message_type: string };
      if (envelope.message_type === "runtime.handshake") {
        return Promise.resolve(responseFor(request, "COMPATIBLE", {
          status: "COMPATIBLE",
          negotiated_protocol_version: "1.0.0",
        }));
      }
      const commercial = COMMERCIAL_CASES.find((c) => c.messageType === envelope.message_type);
      if (commercial !== undefined) {
        return Promise.resolve(responseFor(request, commercial.resultCode, commercial.result));
      }
      const extra = EXTRA_RESPONSES[envelope.message_type];
      if (extra === undefined) throw new Error(`unexpected message type ${envelope.message_type}`);
      return Promise.resolve(responseFor(request, extra[0], extra[1]));
    },
    { min: "1.0.0", max: "1.0.0" },
  );
  const client = new LocalChannelClient(
    endpoint,
    new LocalChannelAuthenticator(secret, clock),
    { min: "1.0.0", max: "1.0.0" },
  );

  try {
    await server.start();
    await client.connect(handshakeRequest());
    await run(client);
  } finally {
    await client.close();
    await server.stop();
    secret.fill(0);
  }
}

describe("transporte de las operaciones comerciales", () => {
  for (const testCase of COMMERCIAL_CASES) {
    it(`${testCase.messageType} viaja y su respuesta se parsea con su propio esquema`, async () => {
      await withChannel(async (client) => {
        const response = await client.request(
          commercialRequest(testCase.messageType, testCase.payload),
        );
        expect(response).toMatchObject({
          status: "SUCCEEDED",
          result_code: testCase.resultCode,
          result: testCase.result,
        });
      });
    }, 15_000);
  }

  it("la vertical completa recorre el canal en una sola conexión", async () => {
    await withChannel(async (client) => {
      const outcomes: string[] = [];
      for (const testCase of COMMERCIAL_CASES) {
        const response = await client.request(
          commercialRequest(testCase.messageType, testCase.payload),
        ) as { result: { outcome: string } };
        outcomes.push(response.result.outcome);
      }
      expect(outcomes).toEqual(["OPENED", "FOUND", "CREATED", "CONFIRMED", "AVAILABLE"]);
    });
  }, 20_000);

  /**
   * Las nueve que el `switch` de `validateResponse` no contemplaba. No prueban
   * un esquema: prueban que **la conexión sobrevive**. Antes la función
   * devolvía `undefined`, el servidor desreferenciaba `.protocol_version` y
   * destruía el socket sin un solo mensaje.
   */
  it("las nueve operaciones antes sin enrutar ya no matan la conexión", async () => {
    await withChannel(async (client) => {
      const seen: string[] = [];
      for (const messageType of Object.keys(EXTRA_RESPONSES)) {
        const response = await client.request(
          commercialRequest(messageType, PAYLOAD_BY_MESSAGE_TYPE[messageType]),
        ) as { status: string };
        seen.push(`${messageType}:${response.status}`);
      }
      expect(seen).toEqual(Object.keys(EXTRA_RESPONSES).map((m) => `${m}:SUCCEEDED`));
    });
  }, 20_000);

  it("el cobro que completa la venta llega con sale_completed intacto", async () => {
    await withChannel(async (client) => {
      const response = await client.request(
        commercialRequest("payment.register.cash", COMMERCIAL_CASES[3].payload),
      ) as { result: { sale_completed: boolean } };
      expect(response.result.sale_completed).toBe(true);
    });
  }, 15_000);
});

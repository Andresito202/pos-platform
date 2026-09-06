import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IpcMessageTypeSchema, type IpcRequest } from "@pos-platform/contracts";
import { LocalDatabaseComponent } from "../src/local-database-component.js";
import { DurableSyncComponent } from "../src/sync/durable-sync-component.js";
import { OperationConfirmationComponent } from "../src/operations/operation-confirmation-component.js";
import { CommercialComponent } from "../src/commercial/commercial-component.js";
import { LocalChannelComponent } from "../src/channel/local-channel-component.js";
import type { ChannelRequestContext } from "../src/channel/server.js";
import type { ServiceConfig } from "../src/config.js";

/**
 * Cobertura de enrutamiento del canal local.
 *
 * `LocalChannelComponent.handle` despacha por `switch` sobre `message_type` y
 * **no tiene `default`**. Un tipo del contrato sin `case` no falla de forma
 * visible: la función cae al final, devuelve `undefined`, y `validateResponse`
 * en `server.ts` lo rechaza con un `parse` fallido que el servidor convierte en
 * `socket.destroy()`. El síntoma es una conexión caída, no un error de ruteo.
 *
 * Así estuvieron los cinco `payment.*` desde `BLOQUE 4E`: presentes en la unión
 * `IpcMessageTypeSchema`, en `validateResponse`, en la allowlist del desktop y
 * en `CommercialRequestHandler`, pero ausentes del `switch` de producción. Las
 * pruebas existentes no lo detectaron porque `commercial-ipc.test.ts` invoca
 * `CommercialRequestHandler` directamente y nunca atraviesa este componente.
 *
 * La lista se toma de `IpcMessageTypeSchema.options`, de modo que un tipo nuevo
 * en el contrato queda cubierto sin editar esta prueba.
 *
 * **Sólo Windows.** El componente calcula su endpoint en el constructor con
 * `localChannelEndpoint(installation_id)`, que fuera de `win32` exige un
 * directorio de prueba que el componente no inyecta, y `start()` rechaza
 * explícitamente cualquier plataforma que no sea Windows. El canal local es
 * Windows-only por decisión de producto, así que su prueba de enrutamiento vive
 * donde el canal existe: el job "Windows local runtime platform checks".
 */

const windowsIt = process.platform === "win32" ? it : it.skip;

const TENANT = "018f0000-0000-7000-8000-0000000000d1";
const COMPANY = "018f0000-0000-7000-8000-0000000000d2";
const BRANCH = "018f0000-0000-7000-8000-0000000000d3";
const DEVICE = "018f0000-0000-7000-8000-0000000000d4";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000d5";

const directories: string[] = [];
const components: LocalDatabaseComponent[] = [];

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-routing-"));
  directories.push(value);
  return value;
}

afterEach(async () => {
  for (const component of components.splice(0)) {
    try {
      await component.stop();
    } catch {
      // Un cierre fallido no debe ocultar el fallo real de la prueba.
    }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function config(dataDirectory: string): ServiceConfig {
  return {
    tenant_id: TENANT,
    company_id: COMPANY,
    branch_id: BRANCH,
    device_id: DEVICE,
    installation_id: INSTALLATION,
    data_directory: dataDirectory,
    service_version: "1.0.0",
    protocol_min: "1.0.0",
    protocol_max: "1.0.0",
  } as ServiceConfig;
}

async function buildComponent(): Promise<LocalChannelComponent> {
  const dataDirectory = await directory();
  const localDatabase = new LocalDatabaseComponent(dataDirectory);
  components.push(localDatabase);
  await localDatabase.start();

  const durableSync = new DurableSyncComponent(localDatabase);
  await durableSync.start();

  const operationConfirmation = new OperationConfirmationComponent(localDatabase, durableSync);
  await operationConfirmation.start();

  const commercial = new CommercialComponent(config(dataDirectory), localDatabase, durableSync);
  await commercial.start();

  return new LocalChannelComponent(
    config(dataDirectory),
    localDatabase,
    () => "READY",
    operationConfirmation,
    commercial,
  );
}

/**
 * `handle` es privado por diseño: sólo lo invoca el servidor. La prueba accede
 * a él mediante un cast acotado en vez de ampliar la superficie pública del
 * componente, porque el objetivo es verificar el despacho real de producción y
 * no una copia del `switch` escrita en la prueba.
 */
type RoutableComponent = {
  handle(request: IpcRequest, signal: AbortSignal, context: ChannelRequestContext): Promise<unknown>;
};

const context: ChannelRequestContext = {
  transportSessionId: "018f0000-0000-7000-8000-0000000000e0",
  connectionId: "018f0000-0000-7000-8000-0000000000e1",
};

/** Sobre mínimo: basta para alcanzar el `switch`; el payload no se valida aquí. */
function envelope(messageType: string): IpcRequest {
  return {
    protocol_version: "1.0.0",
    message_type: messageType,
    request_id: randomUUID(),
    correlation_id: randomUUID(),
    payload_schema_version: "1.0.0",
    payload: {},
  } as unknown as IpcRequest;
}

describe("Local channel routing coverage", () => {
  windowsIt("routes every message type declared in the IPC contract", async () => {
    const component = await buildComponent();
    const routable = component as unknown as RoutableComponent;
    const unrouted: string[] = [];

    for (const messageType of IpcMessageTypeSchema.options) {
      let outcome: unknown;
      try {
        outcome = await routable.handle(envelope(messageType), new AbortController().signal, context);
      } catch {
        // Un rechazo demuestra que el tipo llegó a un `case`: el sobre mínimo no
        // satisface todos los payloads y eso es esperado. Lo que se persigue es
        // la caída silenciosa del `switch`, que resuelve `undefined`.
        continue;
      }
      if (outcome === undefined) unrouted.push(messageType);
    }

    expect(unrouted).toEqual([]);
  }, 20_000);

  windowsIt("routes the five payment message types that BLOQUE 4E left unwired", async () => {
    const component = await buildComponent();
    const routable = component as unknown as RoutableComponent;

    const paymentTypes = IpcMessageTypeSchema.options.filter((type) => type.startsWith("payment."));
    expect(paymentTypes).toHaveLength(5);

    for (const messageType of paymentTypes) {
      let resolved: unknown;
      let rejected = false;
      try {
        resolved = await routable.handle(envelope(messageType), new AbortController().signal, context);
      } catch {
        rejected = true;
      }
      expect(
        rejected || resolved !== undefined,
        `${messageType} no está enrutado: el switch cayó al final y devolvió undefined`,
      ).toBe(true);
    }
  }, 20_000);
});

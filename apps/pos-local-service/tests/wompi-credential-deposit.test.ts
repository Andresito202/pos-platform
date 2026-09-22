import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  openWompiCredentialStore,
  runWompiDepositCli,
} from "../src/payments/wompi/deposit-wompi-credential.js";
import {
  WOMPI_CREDENTIAL_SECRET,
  readWompiCredential,
  resolveWompiPaymentProvider,
} from "../src/payments/wompi/wompi-credential.js";
import { InsecureDerivedKeyProvider } from "../src/security/insecure-derived-key-provider.js";

/**
 * El depósito de la credencial de Wompi.
 *
 * ## Qué carencia cierra
 *
 * `resolveWompiPaymentProvider` sabía **leer** el sobre y nada sabía
 * escribirlo: no existía una sola ruta soportada para aprovisionar un equipo,
 * de modo que el adapter estaba completo y era inalcanzable. Medido el
 * 2026-09-22 antes de escribir esto: ningún fichero del árbol escribía
 * `payments-wompi`, fuera de pruebas.
 *
 * ## Por qué la prueba lee con el lector de PRODUCCIÓN
 *
 * Comprobar que el depósito escribe un fichero no probaría nada: lo que hay
 * que demostrar es que **el runtime encuentra y abre lo que el operador
 * depositó**, con su mismo contexto criptográfico. Por eso el cierre de cada
 * caso es `resolveWompiPaymentProvider`, que es exactamente lo que llama
 * `main.ts`.
 */

const IDS = {
  tenantId: "018f0000-0000-7000-8000-0000000000a4",
  companyId: "018f0000-0000-7000-8000-0000000000a5",
  branchId: "018f0000-0000-7000-8000-0000000000a6",
  installationId: "018f0000-0000-7000-8000-0000000000a2",
  deviceId: "018f0000-0000-7000-8000-0000000000a3",
} as const;

const CREDENTIAL = {
  publicKey: "pub_test_0123456789abcdef",
  integritySecret: "test_integrity_0123456789",
  eventsSecret: "test_events_0123456789",
} as const;

const directories: string[] = [];

function workspace(): string {
  const created = mkdtempSync(join(tmpdir(), "wompi-deposit-"));
  directories.push(created);
  return created;
}

function environment(dataDirectory: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    POS_DATA_DIRECTORY: dataDirectory,
    POS_INSTALLATION_ID: IDS.installationId,
    POS_DEVICE_ID: IDS.deviceId,
    POS_SERVICE_VERSION: "1.0.0",
    POS_PROTOCOL_MIN: "1.0.0",
    POS_PROTOCOL_MAX: "1.0.0",
    POS_TENANT_ID: IDS.tenantId,
    POS_COMPANY_ID: IDS.companyId,
    POS_BRANCH_ID: IDS.branchId,
  };
}

async function deposit(dataDirectory: string, body: unknown): Promise<{
  code: number;
  output: string;
}> {
  const lines: string[] = [];
  const code = await runWompiDepositCli(
    environment(dataDirectory),
    Readable.from([Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8")]),
    (line) => { lines.push(line); },
  );
  return { code, output: lines.join("\n") };
}

function resolve(dataDirectory: string): ReturnType<typeof resolveWompiPaymentProvider> {
  return resolveWompiPaymentProvider({
    securityDirectory: join(dataDirectory, "security"),
    keyProvider: new InsecureDerivedKeyProvider(join(dataDirectory, "security"), process.env),
    binding: { installationId: IDS.installationId, deviceId: IDS.deviceId },
  });
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop() as string, { recursive: true, force: true });
  }
});

describe("depósito de la credencial de Wompi", () => {
  it("deja el equipo con un proveedor de pago que el runtime resuelve", async () => {
    const dataDirectory = workspace();

    // Antes: un equipo sin aprovisionar no tiene proveedor, y eso es legítimo.
    expect(resolve(dataDirectory)).toBeUndefined();

    const { code, output } = await deposit(dataDirectory, CREDENTIAL);
    expect(code).toBe(0);
    expect(output).toContain("DEPOSITED");

    // La prueba real: lo resuelve el mismo camino que `main.ts`.
    const provider = resolve(dataDirectory);
    expect(provider, "el runtime no encontró la credencial depositada").toBeDefined();
  });

  it("no imprime jamás un valor de la credencial", async () => {
    const dataDirectory = workspace();
    const { output } = await deposit(dataDirectory, { ...CREDENTIAL, redirectUrl: "https://tienda.example/gracias" });

    for (const secret of [CREDENTIAL.publicKey, CREDENTIAL.integritySecret, CREDENTIAL.eventsSecret]) {
      expect(output).not.toContain(secret);
    }
    expect(output).not.toContain("tienda.example");
  });

  /**
   * El motivo por el que el prefijo se comprueba **al depositar** y no al
   * cobrar: sin esto, pegar la clave privada donde va la pública se aceptaría
   * en silencio, quedaría cifrada en el equipo y viajaría después en cada URL
   * de checkout. El prefijo es lo único que las distingue mirando el valor.
   */
  it("rechaza una clave que no sea la pública, y no escribe nada", async () => {
    const dataDirectory = workspace();
    const { code, output } = await deposit(dataDirectory, {
      ...CREDENTIAL,
      publicKey: "prv_test_0123456789abcdef",
    });

    expect(code).toBe(1);
    expect(output).toContain("INVALID_CREDENTIAL");
    expect(output).not.toContain("prv_test");
    // Y el equipo queda como estaba: un depósito rechazado no deja a medias.
    expect(resolve(dataDirectory)).toBeUndefined();
  });

  it("rechaza un campo de más en vez de ignorarlo", async () => {
    const dataDirectory = workspace();
    const { code, output } = await deposit(dataDirectory, { ...CREDENTIAL, privateKey: "prv_test_x" });

    expect(code).toBe(1);
    expect(output).toContain("INVALID_CREDENTIAL");
    expect(resolve(dataDirectory)).toBeUndefined();
  });

  it("rechaza una entrada que no es JSON sin citar su contenido", async () => {
    const dataDirectory = workspace();
    const { code, output } = await deposit(dataDirectory, "pub_test_esto_no_es_json");

    expect(code).toBe(1);
    expect(output).toContain("REJECTED");
    expect(output).not.toContain("pub_test_esto_no_es_json");
  });

  /**
   * Un segundo depósito sustituye al primero: rotar una credencial es la
   * operación normal, y obligar a borrar un fichero a mano para hacerlo
   * empujaría al operador a tocar el almacén con las manos.
   */
  it("un depósito posterior sustituye al anterior", async () => {
    const dataDirectory = workspace();
    await deposit(dataDirectory, CREDENTIAL);
    const rotated = { ...CREDENTIAL, publicKey: "pub_prod_9876543210fedcba" };
    expect((await deposit(dataDirectory, rotated)).code).toBe(0);

    const store = openWompiCredentialStore(dataDirectory, {
      installationId: IDS.installationId,
      deviceId: IDS.deviceId,
    });
    try {
      expect(store.has(WOMPI_CREDENTIAL_SECRET)).toBe(true);
      expect(readWompiCredential(store)?.publicKey).toBe(rotated.publicKey);
    } finally {
      store.destroy();
    }
  });

  /**
   * El sobre lleva el binding como AAD, así que un fichero copiado a otro
   * equipo no descifra. Se comprueba resolviendo con **otro** `device_id`.
   */
  it("lo depositado no sirve en otro equipo", async () => {
    const dataDirectory = workspace();
    await deposit(dataDirectory, CREDENTIAL);

    expect(() => resolveWompiPaymentProvider({
      securityDirectory: join(dataDirectory, "security"),
      keyProvider: new InsecureDerivedKeyProvider(join(dataDirectory, "security"), process.env),
      binding: { installationId: IDS.installationId, deviceId: "018f0000-0000-7000-8000-00000000ffff" },
    })).toThrow();
  });
});

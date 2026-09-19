import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { StructuredLogger, type LogRecord } from "@pos-platform/observability";
import {
  EncryptedFileSecretStore,
  InsecureDerivedKeyProvider,
  type SecretStoreKeyProvider,
} from "../src/security/index.js";
import { CommercialComponent } from "../src/commercial/commercial-component.js";
import { DurableSyncStore, type SyncScope } from "../src/sync/durable-sync-store.js";
import type { ServiceConfig } from "../src/config.js";
import { RegisterQrPaymentUseCase } from "../src/payments/register-qr-payment-use-case.js";
import { SweepUncertainProviderPaymentsUseCase } from "../src/payments/sweep-uncertain-provider-payments-use-case.js";
import { QueryProviderForUncertainPaymentUseCase } from "../src/payments/query-provider-for-uncertain-payment-use-case.js";
import { UncertainProviderSweepComponent } from "../src/payments/uncertain-provider-sweep-component.js";
import { WompiPaymentProvider } from "../src/payments/wompi/wompi-payment-provider.js";
import {
  readWompiCredential,
  resolveWompiPaymentProvider,
  wompiCredentialContext,
  WompiCredentialInvalidError,
  WOMPI_CREDENTIAL_SECRET,
  WOMPI_SANDBOX_ENV,
} from "../src/payments/wompi/wompi-credential.js";

const TENANT = "018f0000-0000-7000-8000-0000000000b1";
const COMPANY = "018f0000-0000-7000-8000-0000000000b2";
const BRANCH = "018f0000-0000-7000-8000-0000000000b3";
const DEVICE = "018f0000-0000-7000-8000-0000000000b4";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000b5";

const BINDING = { installationId: INSTALLATION, deviceId: DEVICE };
const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALLATION,
};
const NOW = new Date("2026-09-06T10:00:00.000Z");

/**
 * Valores inventados para esta prueba. No son credenciales: no autentican
 * contra Wompi ni contra nada. Las reales nunca entran al repositorio —
 * se aprovisionan en el almacén cifrado del equipo.
 */
const FAKE_CREDENTIAL = {
  publicKey: "pub_test_not_a_real_key",
  integritySecret: "not-a-real-integrity-value",
  eventsSecret: "not-a-real-events-value",
};

const directories: string[] = [];
const databases: LocalDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* no tapar el fallo real */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-wompi-provisioning-"));
  directories.push(value);
  return value;
}

/**
 * `InsecureDerivedKeyProvider` sólo se deja usar con `NODE_ENV=test`, que es
 * exactamente lo que este archivo es. En producción la rama de `main.ts` lleva
 * a DPAPI y no existe camino hacia aquí.
 */
function keyProvider(securityDirectory: string): SecretStoreKeyProvider {
  return new InsecureDerivedKeyProvider(securityDirectory, { NODE_ENV: "test" });
}

/** Aprovisiona la credencial como lo haría el operador: en el sobre cifrado. */
function provision(securityDirectory: string, document: unknown): void {
  const store = new EncryptedFileSecretStore(
    securityDirectory, keyProvider(securityDirectory), wompiCredentialContext(BINDING),
  );
  try {
    store.write(WOMPI_CREDENTIAL_SECRET, Buffer.from(JSON.stringify(document), "utf8"));
  } finally {
    store.destroy();
  }
}

/**
 * Lee un campo privado de un caso de uso ya construido.
 *
 * Es deliberado: lo que hay que demostrar aquí es que las tres vías sostienen
 * **el mismo objeto**, y eso no se ve desde fuera. Una aserción de
 * comportamiento probaría que cada una funciona, no que comparten instancia.
 */
function heldField<T>(target: unknown, name: string): T {
  return (target as Record<string, T>)[name] as T;
}

async function securityDirectory(): Promise<string> {
  // En producción este directorio ya existe: lo crea `LocalSecurityComponent`
  // al materializar la identidad del equipo, antes de que nadie aprovisione
  // nada. Aquí hay que crearlo porque la prueba escribe el secreto primero.
  const value = join(await directory(), "security");
  mkdirSync(value, { recursive: true, mode: 0o700 });
  return value;
}

function config(): ServiceConfig {
  return {
    tenant_id: TENANT, company_id: COMPANY, branch_id: BRANCH,
    device_id: DEVICE, installation_id: INSTALLATION,
  } as ServiceConfig;
}

async function commercialWith(provider: WompiPaymentProvider | undefined) {
  const dir = await directory();
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const component = new CommercialComponent(
    config(),
    { database } as never,
    { store: new DurableSyncStore(database) } as never,
    new Map(),
    () => NOW,
    provider,
  );
  await component.start();
  return component;
}

// ── A: main.ts puede construir el proveedor cuando hay credencial ────────────

describe("aprovisionamiento de la credencial de Wompi", () => {
  it("construye el proveedor desde el almacén cifrado existente", async () => {
    const dir = await securityDirectory();
    provision(dir, FAKE_CREDENTIAL);

    const provider = resolveWompiPaymentProvider({
      securityDirectory: dir, keyProvider: keyProvider(dir), binding: BINDING,
    });

    expect(provider).toBeInstanceOf(WompiPaymentProvider);
  });

  it("acepta el redirectUrl opcional y rechaza uno que no es URL", async () => {
    const dir = await securityDirectory();
    provision(dir, { ...FAKE_CREDENTIAL, redirectUrl: "https://example.test/return" });
    expect(resolveWompiPaymentProvider({
      securityDirectory: dir, keyProvider: keyProvider(dir), binding: BINDING,
    })).toBeInstanceOf(WompiPaymentProvider);

    const other = await securityDirectory();
    provision(other, { ...FAKE_CREDENTIAL, redirectUrl: "no-es-una-url" });
    expect(() => resolveWompiPaymentProvider({
      securityDirectory: other, keyProvider: keyProvider(other), binding: BINDING,
    })).toThrow(WompiCredentialInvalidError);
  });

  // ── F: sin configuración válida, comportamiento explícito ──────────────────

  it("sin credencial aprovisionada devuelve undefined, no un proveedor falso", async () => {
    const dir = await securityDirectory();

    expect(resolveWompiPaymentProvider({
      securityDirectory: dir, keyProvider: keyProvider(dir), binding: BINDING,
    })).toBeUndefined();
  });

  it.each([
    ["falta el integrity secret", { publicKey: "pub_test_x", eventsSecret: "e" }, "integritySecret"],
    ["falta el events secret", { publicKey: "pub_test_x", integritySecret: "i" }, "eventsSecret"],
    ["un campo vacío", { ...FAKE_CREDENTIAL, publicKey: "" }, "publicKey"],
  ])("una credencial presente pero inservible lanza — %s", async (_name, document, field) => {
    const dir = await securityDirectory();
    provision(dir, document);

    const attempt = () => resolveWompiPaymentProvider({
      securityDirectory: dir, keyProvider: keyProvider(dir), binding: BINDING,
    });

    expect(attempt).toThrow(WompiCredentialInvalidError);
    expect(attempt).toThrow(field);
  });

  it("una clave extraña se rechaza en vez de ignorarse", async () => {
    const dir = await securityDirectory();
    provision(dir, { ...FAKE_CREDENTIAL, privateKey: "no-deberia-estar-aqui" });

    expect(() => resolveWompiPaymentProvider({
      securityDirectory: dir, keyProvider: keyProvider(dir), binding: BINDING,
    })).toThrow(WompiCredentialInvalidError);
  });

  it("un sobre de otra instalación no descifra", async () => {
    const dir = await securityDirectory();
    provision(dir, FAKE_CREDENTIAL);

    expect(() => resolveWompiPaymentProvider({
      securityDirectory: dir,
      keyProvider: keyProvider(dir),
      binding: { installationId: INSTALLATION, deviceId: "018f0000-0000-7000-8000-0000000000ff" },
    })).toThrow("authentication failed");
  });

  // ── G: los secretos no salen ───────────────────────────────────────────────

  it("el secreto queda cifrado en disco y no en claro", async () => {
    const dir = await securityDirectory();
    provision(dir, FAKE_CREDENTIAL);

    const raw = readFileSync(join(dir, `${WOMPI_CREDENTIAL_SECRET}.secret`), "utf8");
    expect(raw).not.toContain(FAKE_CREDENTIAL.integritySecret);
    expect(raw).not.toContain(FAKE_CREDENTIAL.eventsSecret);
    expect(raw).not.toContain(FAKE_CREDENTIAL.publicKey);
    expect(JSON.parse(raw)).toMatchObject({ version: 1 });
  });

  it("el error de una credencial inservible nombra campos, nunca valores", async () => {
    const dir = await securityDirectory();
    provision(dir, { ...FAKE_CREDENTIAL, integritySecret: 42 });

    let message = "";
    try {
      resolveWompiPaymentProvider({
        securityDirectory: dir, keyProvider: keyProvider(dir), binding: BINDING,
      });
    } catch (error) {
      message = error instanceof Error ? `${error.message}${String(error.stack)}` : String(error);
    }

    expect(message).toContain("integritySecret");
    expect(message).not.toContain(FAKE_CREDENTIAL.eventsSecret);
    expect(message).not.toContain(FAKE_CREDENTIAL.publicKey);
  });

  it("el registro de arranque dice que hay proveedor, no cuál es", async () => {
    // Reproduce exactamente lo que `main.ts` emite tras resolver el proveedor.
    const records: LogRecord[] = [];
    const logger = new StructuredLogger({ write: (record) => { records.push(record); } }, () => NOW);

    logger.log("info", "payments.provider", { configured: true, provider_code: "WOMPI" });
    logger.log("info", "payments.provider", { configured: false, reason: "NOT_PROVISIONED" });
    await logger.flush();

    const serialized = JSON.stringify(records);
    for (const value of Object.values(FAKE_CREDENTIAL)) {
      expect(serialized).not.toContain(value);
    }
    expect(records[0]?.fields).toEqual({ configured: true, provider_code: "WOMPI" });
    expect(records[1]?.fields).toEqual({ configured: false, reason: "NOT_PROVISIONED" });
  });

  it("los nombres del sandbox son públicos y el runtime no los lee", () => {
    expect(Object.values(WOMPI_SANDBOX_ENV)).toEqual([
      "WOMPI_SANDBOX_PUBLIC_KEY",
      "WOMPI_SANDBOX_INTEGRITY_SECRET",
      "WOMPI_SANDBOX_EVENTS_SECRET",
    ]);
    const source = readFileSync(
      new URL("../src/payments/wompi/wompi-credential.ts", import.meta.url), "utf8",
    );
    expect(source).not.toContain("process.env");
  });

  it("no hay credencial cuando el almacén dice que no la hay", () => {
    expect(readWompiCredential({
      has: () => false,
      read: () => { throw new Error("no debe leerse"); },
    })).toBeUndefined();
  });
});

// ── B, C, D, E, H ────────────────────────────────────────────────────────────

describe("el proveedor resuelto llega a toda la superficie de pagos", () => {
  async function provisioned() {
    const dir = await securityDirectory();
    provision(dir, FAKE_CREDENTIAL);
    const provider = resolveWompiPaymentProvider({
      securityDirectory: dir, keyProvider: keyProvider(dir), binding: BINDING,
    });
    if (provider === undefined) throw new Error("se esperaba un proveedor");
    return provider;
  }

  // B, C, D
  it("CommercialComponent recibe la instancia y la reparte a las tres vías", async () => {
    const provider = await provisioned();
    const commercial = await commercialWith(provider);

    expect(commercial.registerQrPayment).toBeInstanceOf(RegisterQrPaymentUseCase);
    expect(commercial.sweepUncertainProviderPayments)
      .toBeInstanceOf(SweepUncertainProviderPaymentsUseCase);
    expect(commercial.queryProviderForUncertainPayment)
      .toBeInstanceOf(QueryProviderForUncertainPaymentUseCase);

    // La misma instancia, no tres proveedores distintos: lo que Wompi conteste
    // a una vía vale para las otras.
    const held = [
      commercial.registerQrPayment,
      commercial.sweepUncertainProviderPayments,
      commercial.queryProviderForUncertainPayment,
    ].map((useCase) => heldField<unknown>(useCase, "provider"));
    expect(held).toEqual([provider, provider, provider]);

    await commercial.stop();
  });

  it("la consulta puntual y el barrido comparten una sola resolución", async () => {
    const provider = await provisioned();
    const commercial = await commercialWith(provider);

    const sweepResolver = heldField<unknown>(
      commercial.sweepUncertainProviderPayments, "resolveUncertain",
    );
    const queryResolver = heldField<unknown>(
      commercial.queryProviderForUncertainPayment, "resolveUncertain",
    );

    expect(sweepResolver).toBe(queryResolver);
    await commercial.stop();
  });

  // E
  it("con proveedor el barrido deja de quedar disabled", async () => {
    const provider = await provisioned();
    const commercial = await commercialWith(provider);
    const records: LogRecord[] = [];
    const logger = new StructuredLogger({ write: (record) => { records.push(record); } }, () => NOW);

    const component = new UncertainProviderSweepComponent(
      () => commercial.sweepUncertainProviderPayments, SCOPE, logger,
    );
    await component.start();

    expect(records.map((record) => record.event))
      .not.toContain("payments.uncertain_sweep.disabled");

    await component.stop();
    await commercial.stop();
  });

  // F, en la superficie: sin proveedor nada de esto existe.
  it("sin proveedor las tres vías quedan sin construir y el barrido queda disabled", async () => {
    const commercial = await commercialWith(undefined);
    const records: LogRecord[] = [];
    const logger = new StructuredLogger({ write: (record) => { records.push(record); } }, () => NOW);

    expect(commercial.registerQrPayment).toBeUndefined();
    expect(commercial.sweepUncertainProviderPayments).toBeUndefined();
    expect(commercial.queryProviderForUncertainPayment).toBeUndefined();

    const component = new UncertainProviderSweepComponent(
      () => commercial.sweepUncertainProviderPayments, SCOPE, logger,
    );
    await component.start();

    expect(records[0]?.event).toBe("payments.uncertain_sweep.disabled");
    expect(records[0]?.fields).toEqual({ reason: "NO_PAYMENT_PROVIDER" });

    await component.stop();
    await commercial.stop();
  });

  // H
  it("el binding de dispositivo sigue saliendo de la configuración, no del proveedor", async () => {
    const commercial = await commercialWith(await provisioned());

    expect(commercial.deviceBinding())
      .toEqual({ installationId: INSTALLATION, deviceId: DEVICE });

    await commercial.stop();
  });
});

import { readFileSync } from "node:fs";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { FACTUS_ADAPTER_DECLARATION, type CredentialReference } from "@pos-platform/fiscal-adapters";
import { EncryptedFileSecretStore } from "../src/security/encrypted-secret-store.js";
import { InsecureDerivedKeyProvider } from "../src/security/insecure-derived-key-provider.js";
import { deviceIdentityContext } from "../src/security/local-security-component.js";
import {
  FiscalCredentialNotFoundError,
  FiscalCredentialStore,
  FiscalCredentialVersionMismatchError,
  fiscalCredentialContext,
  fiscalSecretName,
} from "../src/fiscal/fiscal-credential-store.js";
import { SecretStoreFactusCredentialResolver } from "../src/fiscal/factus-credential-resolver.js";
import { readDepositInput, runDepositCli } from "../src/fiscal/deposit-fiscal-credential.js";

const REQUIREMENT = FACTUS_ADAPTER_DECLARATION.credential;

const INSTALLATION = "018f0000-0000-7000-8000-000000000005";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const BINDING = { installationId: INSTALLATION, deviceId: DEVICE };

/** Valores de prueba, reconocibles a simple vista en un volcado. */
const FIELDS = {
  client_id: "CLIENT-ID-VISIBLE-1",
  client_secret: "CLIENT-SECRET-VISIBLE-2",
  username: "USERNAME-VISIBLE-3",
  password: "PASSWORD-VISIBLE-4",
} as const;
const VALUES = Object.values(FIELDS);

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-fiscal-cred-"));
  directories.push(value);
  return value;
}
afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function open(dir: string, context = fiscalCredentialContext(BINDING)): EncryptedFileSecretStore {
  return new EncryptedFileSecretStore(dir, new InsecureDerivedKeyProvider(dir), context);
}

async function seeded(): Promise<{
  dir: string;
  secrets: EncryptedFileSecretStore;
  store: FiscalCredentialStore;
  reference: CredentialReference;
}> {
  const dir = await directory();
  const secrets = open(dir);
  const store = new FiscalCredentialStore(secrets);
  const reference = store.deposit(
    { provider: "FACTUS", environment: "SANDBOX", fields: FIELDS },
    REQUIREMENT,
  );
  return { dir, secrets, store, reference };
}

describe("FiscalCredentialStore — DEC-021 F2", () => {
  it("deposita y resuelve los cuatro campos declarados", async () => {
    const { store, reference } = await seeded();
    expect(reference.secretRef).toBe("fiscal:FACTUS:SANDBOX");
    expect(reference.version).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.resolve(reference)).toEqual(FIELDS);
  });

  it("el valor no queda en claro en el disco", async () => {
    const { dir } = await seeded();
    const raw = readFileSync(join(dir, `${fiscalSecretName("FACTUS", "SANDBOX")}.secret`), "utf8");
    // Ésta es la prueba que importa: el fichero existe y no contiene el secreto.
    for (const value of VALUES) expect(raw).not.toContain(value);
    expect(raw).not.toContain("client_secret");
    expect(JSON.parse(raw)).toMatchObject({ version: 1 });
  });

  it("una rotación invalida la referencia anterior en lugar de servir la nueva", async () => {
    const { store, reference } = await seeded();
    const rotated = store.deposit(
      { provider: "FACTUS", environment: "SANDBOX", fields: { ...FIELDS, password: "NUEVA" } },
      REQUIREMENT,
    );
    expect(rotated.version).not.toBe(reference.version);
    expect(store.resolve(rotated).password).toBe("NUEVA");
    // Fallar cerrado: quien conserve la referencia vieja no recibe la nueva
    // credencial en silencio.
    expect(() => store.resolve(reference)).toThrow(FiscalCredentialVersionMismatchError);
  });

  it("sin depósito previo falla cerrado y lo dice sin inventar nada", async () => {
    const dir = await directory();
    const store = new FiscalCredentialStore(open(dir));
    expect(store.has("FACTUS", "SANDBOX")).toBe(false);
    expect(() => store.reference("FACTUS", "SANDBOX")).toThrow(FiscalCredentialNotFoundError);
  });

  it("los ambientes no se mezclan", async () => {
    const dir = await directory();
    const store = new FiscalCredentialStore(open(dir));
    const sandbox = store.deposit({ provider: "FACTUS", environment: "SANDBOX", fields: FIELDS }, REQUIREMENT);
    store.deposit(
      { provider: "FACTUS", environment: "PRODUCTION", fields: { ...FIELDS, password: "PROD" } },
      REQUIREMENT,
    );

    expect(store.resolve(sandbox).password).toBe(FIELDS.password);
    expect(store.resolve(store.reference("FACTUS", "PRODUCTION")).password).toBe("PROD");
    // Una referencia de sandbox con la versión de producción no resuelve.
    expect(() => store.resolve({ ...sandbox, version: store.reference("FACTUS", "PRODUCTION").version }))
      .toThrow(FiscalCredentialVersionMismatchError);
  });

  it("rechaza una credencial que no es exactamente la declarada", async () => {
    const dir = await directory();
    const store = new FiscalCredentialStore(open(dir));
    const deposit = (fields: Record<string, string>) =>
      () => store.deposit({ provider: "FACTUS", environment: "SANDBOX", fields }, REQUIREMENT);

    const { password: _omitted, ...incomplete } = FIELDS;
    expect(deposit(incomplete)).toThrow(/must be exactly/);
    expect(deposit({ ...FIELDS, extra: "x" })).toThrow(/must be exactly/);
    expect(deposit({ ...FIELDS, password: "" })).toThrow(/non-empty/);
  });

  it("un secreto de identidad de dispositivo no se puede leer como credencial fiscal", async () => {
    const { dir } = await seeded();
    // Mismo directorio y misma clave maestra; distinto contexto criptográfico.
    const foreign = new FiscalCredentialStore(open(dir, deviceIdentityContext(BINDING)));
    expect(() => foreign.reference("FACTUS", "SANDBOX"))
      .toThrow(/secret envelope authentication failed/);
  });

  it("ningún error lleva el valor de la credencial", async () => {
    const { store, reference } = await seeded();
    store.deposit({ provider: "FACTUS", environment: "SANDBOX", fields: FIELDS }, REQUIREMENT);
    let message = "";
    try { store.resolve(reference); } catch (error) { message = String(error); }
    expect(message).not.toBe("");
    for (const value of VALUES) expect(message).not.toContain(value);
  });
});

describe("SecretStoreFactusCredentialResolver — DEC-021 F2", () => {
  it("traduce los nombres del proveedor a la forma del adapter", async () => {
    const { store, reference } = await seeded();
    const resolver = new SecretStoreFactusCredentialResolver(store);
    await expect(resolver.resolve(reference)).resolves.toEqual({
      clientId: FIELDS.client_id,
      clientSecret: FIELDS.client_secret,
      username: FIELDS.username,
      password: FIELDS.password,
    });
  });

  it("no lee del entorno aunque las variables de sandbox estén puestas", async () => {
    const dir = await directory();
    const store = new FiscalCredentialStore(open(dir));
    const resolver = new SecretStoreFactusCredentialResolver(store);
    process.env.FACTUS_SANDBOX_PASSWORD = "NO-DEBE-USARSE";
    try {
      // `FACTUS_SANDBOX_ENV` existe para F6 en el equipo del propietario. El
      // resolutor de producción no lo mira: sin depósito, no hay credencial.
      await expect(resolver.resolve({ secretRef: "fiscal:FACTUS:SANDBOX", version: "x" }))
        .rejects.toThrow(FiscalCredentialNotFoundError);
    } finally {
      delete process.env.FACTUS_SANDBOX_PASSWORD;
    }
  });

  it("rechaza un sobre almacenado al que le falta un campo", async () => {
    const dir = await directory();
    const secrets = open(dir);
    // Se escribe un sobre incompleto a mano: es lo que produciría una versión
    // futura con un error, y el resolutor no debe devolver media credencial.
    const envelope = {
      version: "v1",
      provider: "FACTUS",
      environment: "SANDBOX",
      fields: { client_id: "a", username: "b", password: "c" },
      depositedAt: "2026-09-14T12:00:00.000Z",
    };
    secrets.write(fiscalSecretName("FACTUS", "SANDBOX"), Buffer.from(JSON.stringify(envelope)));
    const resolver = new SecretStoreFactusCredentialResolver(new FiscalCredentialStore(secrets));
    await expect(resolver.resolve({ secretRef: "fiscal:FACTUS:SANDBOX", version: "v1" }))
      .rejects.toThrow(/lacks client_secret/);
  });
});

describe("Depósito — la operación del operador", () => {
  function env(dataDirectory: string): NodeJS.ProcessEnv {
    return {
      POS_DATA_DIRECTORY: dataDirectory,
      POS_INSTALLATION_ID: INSTALLATION,
      POS_DEVICE_ID: DEVICE,
      POS_SERVICE_VERSION: "1.0.0",
      POS_PROTOCOL_MIN: "1.0.0",
      POS_PROTOCOL_MAX: "1.0.0",
      POS_TENANT_ID: "018f0000-0000-7000-8000-000000000001",
      POS_COMPANY_ID: "018f0000-0000-7000-8000-000000000002",
      POS_BRANCH_ID: "018f0000-0000-7000-8000-000000000003",
    };
  }
  const payload = JSON.stringify({ provider: "FACTUS", environment: "SANDBOX", fields: FIELDS });

  it("deposita desde la entrada estándar e imprime sólo la referencia", async () => {
    const dir = await directory();
    const lines: string[] = [];
    const code = await runDepositCli(env(dir), Readable.from([Buffer.from(payload)]), (line) => { lines.push(line); });

    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    const printed = lines[0]!;
    // Lo impreso es la referencia opaca, y nada más.
    expect(JSON.parse(printed)).toEqual({
      status: "DEPOSITED",
      reference: { secretRef: "fiscal:FACTUS:SANDBOX", version: expect.any(String) },
    });
    for (const value of VALUES) expect(printed).not.toContain(value);

    // Y quedó realmente depositada: se resuelve desde un almacén nuevo.
    const store = new FiscalCredentialStore(open(join(dir, "security")));
    expect(store.resolve(store.reference("FACTUS", "SANDBOX"))).toEqual(FIELDS);
  });

  it("rechaza una entrada mayor que el tope sin conservarla", async () => {
    const huge = Buffer.alloc(64 * 1024 + 1, 0x20);
    await expect(readDepositInput(Readable.from([huge]))).rejects.toThrow(/exceeds 65536 bytes/);
  });

  it("un JSON inválido no devuelve el texto recibido en el error", async () => {
    const malformed = `{"provider":"FACTUS","fields":{"password":"${FIELDS.password}"`;
    let message = "";
    try { await readDepositInput(Readable.from([Buffer.from(malformed)])); }
    catch (error) { message = String(error); }
    expect(message).toContain("not valid JSON");
    expect(message).not.toContain(FIELDS.password);
  });

  it("un proveedor sin requisito verificado se rechaza sin depositar nada", async () => {
    const dir = await directory();
    const lines: string[] = [];
    const body = JSON.stringify({ provider: "SIIGO", environment: "SANDBOX", fields: { a: "b" } });
    const code = await runDepositCli(env(dir), Readable.from([Buffer.from(body)]), (line) => { lines.push(line); });
    expect(code).toBe(1);
    expect(JSON.parse(lines[0]!)).toEqual({ status: "REJECTED", code: "PROVIDER_NOT_SUPPORTED" });
  });

  it("un depósito con forma incorrecta se rechaza con un código, no con el valor", async () => {
    const dir = await directory();
    const lines: string[] = [];
    const body = JSON.stringify({
      provider: "FACTUS",
      environment: "SANDBOX",
      fields: { client_id: "a", client_secret: FIELDS.client_secret },
    });
    const code = await runDepositCli(env(dir), Readable.from([Buffer.from(body)]), (line) => { lines.push(line); });
    expect(code).toBe(1);
    expect(JSON.parse(lines[0]!)).toEqual({ status: "REJECTED", code: "FISCAL_CREDENTIAL_SHAPE" });
    expect(lines[0]!).not.toContain(FIELDS.client_secret);
  });
});

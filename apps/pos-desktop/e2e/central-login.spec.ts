import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { spawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { showSectionOf } from "./navigation.js";

/**
 * Login real de operadores de punta a punta (`DEC-026` §13.10–§13.12).
 *
 *   Electron (puerta de login) → canal real → servicio (modo central)
 *     → HTTPS → pasarela de laboratorio → apps/api (login + SSA/SAS firmados)
 *                                       → central-authority (enrolamiento D-3)
 *     → PostgreSQL real
 *
 * Nada de la cadena de confianza es doble: el equipo genera su clave, publica
 * su identidad, la central de laboratorio lo registra y le emite activación,
 * el servicio se enrola por el protocolo D-3 y verifica la credencial; el login
 * firma el desafío con la clave del equipo, la API emite SSA y SAS con los
 * permisos de los roles de la base, y el servicio los verifica contra el
 * bundle firmado por la raíz de laboratorio. Los permisos que se ven aquí —el
 * cajero no puede dar de alta un producto y el supervisor sí— vienen de la
 * base central, no del arnés.
 *
 * Exige PostgreSQL (`POSTGRES_TEST_URL`, por defecto el de las pruebas de
 * `apps/api`). Sin él **se salta y lo dice**: no se finge un paso.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const require = createRequire(import.meta.url);
const executablePath = require("electron") as string;
// `pg` es dependencia de `apps/api`, no del escritorio: se toma de allí en vez
// de añadir una dependencia al paquete de la ventana sólo para esta prueba.
interface PgClient { connect(): Promise<void>; query(sql: string): Promise<unknown>; end(): Promise<void> }
const pg = createRequire(join(repoRoot, "apps", "api", "package.json"))("pg") as {
  Client: new (options: { connectionString: string; connectionTimeoutMillis?: number }) => PgClient;
};
const SERVER_URL = process.env.POSTGRES_TEST_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";
const PORTS = { api: "18080", authority: "19443", gateway: "18443" };

let state: string;
let dataDirectory: string;
let databaseUrl: string;
let central: ChildProcess | undefined;
let service: ChildProcessWithoutNullStreams | undefined;
let app: ElectronApplication | undefined;
let users: Record<string, string> = {};
let adminTotpSecret = "";
let postgresAvailable = false;

async function probePostgres(): Promise<boolean> {
  const client = new pg.Client({ connectionString: SERVER_URL, connectionTimeoutMillis: 3_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}

function waitForLine(child: ChildProcess, predicate: (line: string) => boolean, timeoutMs: number, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => reject(new Error(`${label}: no llegó a tiempo`)), timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (predicate(line)) { clearTimeout(timer); resolve(line); return; }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => { process.stderr.write(`[${label}] ${chunk.toString()}`); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`${label} terminó con código ${String(code)}`)); });
  });
}

/** RFC 6238 (HMAC-SHA1, 30 s, 6 dígitos): lo que calcula la app autenticadora. */
function totp(base32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32.replace(/=+$/, "")) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  postgresAvailable = await probePostgres();
  if (!postgresAvailable) return;

  state = mkdtempSync(join(tmpdir(), "pos-lab-central-"));
  dataDirectory = mkdtempSync(join(tmpdir(), "pos-central-login-"));
  const url = new URL(SERVER_URL);
  url.pathname = `/pos_lab_e2e_${String(Date.now())}`;
  databaseUrl = url.toString();
  const lab = (command: string, extra: string[] = []) => [
    "--filter", "@pos-platform/api", "exec", "tsx", "lab/lab-central.ts", command,
    "--state", state, "--database-url", databaseUrl,
    "--api-port", PORTS.api, "--authority-port", PORTS.authority, "--gateway-port", PORTS.gateway, ...extra,
  ];

  const setup = spawnSync("pnpm", lab("setup"), { cwd: repoRoot, encoding: "utf8" });
  if (setup.status !== 0) throw new Error(`lab-central setup falló:\n${setup.stderr}\n${setup.stdout}`);
  const credentials = readFileSync(join(state, "usuarios-lab.txt"), "utf8");
  for (const match of credentials.matchAll(/Usuario: (\S+)\s+Contraseña: (\S+)/g)) users[match[1]!] = match[2]!;
  adminTotpSecret = /secreto: ([A-Z2-7]+)/.exec(credentials)![1]!;

  central = spawn("pnpm", lab("serve", ["--watch-device", join(dataDirectory, "device-public-identity.json")]), {
    cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  await waitForLine(central, (line) => line.includes("\"gateway.listening\""), 120_000, "lab-central");

  const env = JSON.parse(readFileSync(join(state, "service-env.json"), "utf8")) as Record<string, string>;
  const channelSecret = randomBytes(32).toString("hex");
  const serviceRoot = join(repoRoot, "apps", "pos-local-service");
  service = spawn(join(serviceRoot, "node_modules", ".bin", "tsx"), [join(serviceRoot, "e2e-host", "real-service-host.ts")], {
    cwd: serviceRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      NODE_EXTRA_CA_CERTS: env["NODE_EXTRA_CA_CERTS"],
      POS_E2E_DATA_DIR: dataDirectory,
      POS_E2E_CHANNEL_SECRET: channelSecret,
      POS_E2E_CENTRAL_ENV: join(state, "service-env.json"),
    },
  }) as ChildProcessWithoutNullStreams;
  const ready = JSON.parse(await waitForLine(service, (line) => line.includes("\"ready\""), 180_000, "servicio")) as { endpoint: string };

  app = await electron.launch({
    args: ["--no-sandbox", join(here, "real-channel-entry.mjs")],
    executablePath,
    env: {
      ...process.env,
      POS_E2E_REQUIRE_LOGIN: "1",
      POS_E2E_CHANNEL_ENDPOINT: ready.endpoint,
      POS_E2E_CHANNEL_SECRET: channelSecret,
      POS_E2E_INSTALLATION_ID: env["POS_INSTALLATION_ID"]!,
      POS_E2E_DEVICE_ID: env["POS_DEVICE_ID"]!,
    },
  });
});

test.afterAll(async () => {
  await app?.close();
  service?.kill("SIGTERM");
  if (central?.pid !== undefined) { try { process.kill(-central.pid, "SIGTERM"); } catch { /* ya terminó */ } }
  if (postgresAvailable && databaseUrl !== undefined) {
    const admin = new pg.Client({ connectionString: SERVER_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${new URL(databaseUrl).pathname.slice(1)}" WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  }
  for (const directory of [state, dataDirectory]) if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
});

async function login(name: string, password: string, code?: string): Promise<void> {
  const page = await app!.firstWindow();
  await page.getByTestId("login-name-input").fill(name);
  await page.getByTestId("login-password-input").fill(password);
  if (code !== undefined) await page.getByTestId("login-totp-input").fill(code);
  await page.getByTestId("login-submit-button").click();
}

async function registerProduct(code: string): Promise<void> {
  const page = await app!.firstWindow();
  const fields: Array<[string, string]> = [
    ["product-code-input", code], ["product-name-input", "Producto de login"], ["presentation-name-input", "Unidad"],
    ["unit-code-input", "UND"], ["unit-precision-input", "0"], ["product-barcode-input", `77099${String(Date.now()).slice(-8)}`],
    ["product-price-input", "1000"], ["product-currency-input", "COP"],
  ];
  for (const [testId, value] of fields) {
    await showSectionOf(page, testId);
    await page.getByTestId(testId).fill(value);
  }
  await showSectionOf(page, "register-product-button");
  await page.getByTestId("register-product-button").click();
}

test("sin sesión la ventana pide iniciar sesión y no monta el POS", async () => {
  test.skip(!postgresAvailable, "sin PostgreSQL no hay autoridad central que probar");
  const page = await app!.firstWindow();
  await expect(page.getByTestId("login-name-input")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("app-sidebar").count()).toBe(0);
});

test("una contraseña equivocada se rechaza con un mensaje, sin decir si la cuenta existe", async () => {
  test.skip(!postgresAvailable, "sin PostgreSQL no hay autoridad central que probar");
  const page = await app!.firstWindow();
  await login("cajero", "esta no es la contraseña del cajero");
  await expect(page.getByTestId("login-error")).toContainText("Usuario o contraseña incorrectos", { timeout: 30_000 });
  await login("nadie-se-llama-asi", "esta no es la contraseña de nadie");
  await expect(page.getByTestId("login-error")).toContainText("Usuario o contraseña incorrectos", { timeout: 30_000 });
  expect(await page.getByTestId("app-sidebar").count()).toBe(0);
});

test("el cajero entra con la sesión que firma la central, y sus permisos son los de su rol", async () => {
  test.skip(!postgresAvailable, "sin PostgreSQL no hay autoridad central que probar");
  const page = await app!.firstWindow();
  await login("cajero", users["cajero"]!);
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("operator-session")).toBeVisible();

  // El SAS del cajero no trae CATALOG_PRODUCT_REGISTER (reparto de ejemplo de
  // la base central): el servicio lo rechaza.
  await registerProduct(`CAJ-${String(Date.now())}`);
  await showSectionOf(page, "product-rejected");
  // `UNAUTHORIZED` y no otro rechazo: un código duplicado o un dato mal
  // capturado también mostrarían este bloque sin probar nada del rol.
  await expect(page.getByTestId("product-rejected")).toHaveText("UNAUTHORIZED", { timeout: 15_000 });
  expect(await page.getByTestId("product-registered").count()).toBe(0);
});

test("salir cierra la sesión: la ventana vuelve al login y la sesión cerrada no se recupera", async () => {
  test.skip(!postgresAvailable, "sin PostgreSQL no hay autoridad central que probar");
  const page = await app!.firstWindow();
  await page.getByTestId("logout-button").click();
  await expect(page.getByTestId("login-screen")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("login-recheck-button").click();
  await expect(page.getByTestId("login-name-input")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("app-sidebar").count()).toBe(0);
});

test("el supervisor sí puede dar de alta un producto: el permiso viene de su rol en la central", async () => {
  test.skip(!postgresAvailable, "sin PostgreSQL no hay autoridad central que probar");
  const page = await app!.firstWindow();
  await login("supervisor", users["supervisor"]!);
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30_000 });
  await registerProduct(`SUP-${String(Date.now())}`);
  await showSectionOf(page, "product-registered");
  await expect(page.getByTestId("product-registered")).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId("product-outcome").textContent()).toBe("REGISTERED");
  await page.getByTestId("logout-button").click();
  await expect(page.getByTestId("login-screen")).toBeVisible({ timeout: 15_000 });
});

test("el administrador necesita el código de su app autenticadora, y con él entra", async () => {
  test.skip(!postgresAvailable, "sin PostgreSQL no hay autoridad central que probar");
  const page = await app!.firstWindow();
  await login("admin", users["admin"]!);
  await expect(page.getByTestId("login-totp-input")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("login-error")).toContainText("app autenticadora");
  await login("admin", users["admin"]!, totp(adminTotpSecret));
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("operator-session")).toBeVisible();
});

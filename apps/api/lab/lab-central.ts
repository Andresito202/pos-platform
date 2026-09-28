/**
 * Autoridad central de LABORATORIO en un solo equipo (`DEC-026` §13.12).
 *
 * Monta en local lo que en producción serían servicios desplegados: la base
 * PostgreSQL con sus migraciones, la API de login (`apps/api`), la autoridad
 * de enrolamiento (`apps/central-authority`) y, delante de ambas, una pasarela
 * HTTPS con certificado propio —el POS sólo habla `https`—.
 *
 * **No es producción ni se le parece en custodia**: todas las claves privadas
 * se generan aquí y quedan en ficheros del directorio de estado; la base se
 * usa con el superusuario (el RLS por comercio no se ejerce); los usuarios y
 * contraseñas se imprimen. Sirve para probar de punta a punta, en un PC, el
 * login real con las mismas piezas de código que irán a producción.
 *
 * Comandos:
 *   setup           claves, bundle de confianza, TLS, migraciones y semilla.
 *   serve           API + autoridad + pasarela; registra el equipo cuando
 *                   aparece su identidad pública (--watch-device).
 *   register-device registra el equipo a mano desde su identidad pública.
 *
 * Uso: pnpm --filter @pos-platform/api exec tsx lab/lab-central.ts <comando>
 *        --state <dir> --database-url <postgres://…> [opciones]
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpsServer, request as httpsRequest } from "node:https";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  SessionAssertionOperationalKeyClaimsSchema,
  SessionAssertionTrustBundleSchema,
  unsignedSessionAssertionOperationalKeyBytes,
  uuidV7,
} from "@pos-platform/contracts";
import { activationSecretChecksum } from "@pos-platform/device-trust";
import { hashPassword } from "../src/authentication/password-hasher.js";
import { MfaSecretCipher } from "../src/authentication/mfa-secret-cipher.js";
import { base32Encode, generateTotpSecret, totpProvisioningUri } from "../src/authentication/totp.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

// ── argumentos ───────────────────────────────────────────────────────────────

interface Options {
  readonly command: string;
  readonly state: string;
  readonly databaseUrl: string;
  readonly apiPort: number;
  readonly authorityPort: number;
  readonly gatewayPort: number;
  readonly watchDevice: string | null;
  readonly publicIdentity: string | null;
}

function parseOptions(argv: readonly string[]): Options {
  const [command, ...rest] = argv;
  const value = (name: string): string | undefined => {
    const index = rest.indexOf(`--${name}`);
    return index >= 0 ? rest[index + 1] : undefined;
  };
  const state = value("state");
  const databaseUrl = value("database-url");
  if (command === undefined || state === undefined || databaseUrl === undefined) {
    throw new Error("uso: lab-central.ts <setup|serve|register-device> --state <dir> --database-url <postgres://…>");
  }
  return {
    command,
    state: resolve(state),
    databaseUrl,
    apiPort: Number(value("api-port") ?? "8080"),
    authorityPort: Number(value("authority-port") ?? "9443"),
    gatewayPort: Number(value("gateway-port") ?? "8443"),
    watchDevice: value("watch-device") ?? null,
    publicIdentity: value("public-identity") ?? null,
  };
}

// ── estado en disco ─────────────────────────────────────────────────────────

interface LabIdentity {
  readonly tenant_id: string;
  readonly company_id: string;
  readonly branch_id: string;
  readonly installation_id: string;
  readonly device_id: string;
}

interface LabSecrets {
  readonly mfa_key: string;
  readonly transport_token: string;
}

const KEY_IDS = {
  deviceTrustOperational: "LAB-DEVICE-TRUST-1",
  sessionAssertion: "LAB-SSA-1",
  authorizationSnapshot: "LAB-SAS-1",
} as const;
const TRUST_ENVIRONMENT = "LAB";

const paths = (state: string) => ({
  keys: join(state, "keys"),
  key: (name: string) => join(state, "keys", `${name}.pem`),
  pub: (name: string) => join(state, "keys", `${name}.pub.pem`),
  bundle: join(state, "session-trust-bundle.json"),
  tlsKey: join(state, "tls.key"),
  tlsCert: join(state, "tls.crt"),
  secrets: join(state, "secrets.json"),
  identity: join(state, "identity.json"),
  users: join(state, "usuarios-lab.txt"),
  serviceEnv: join(state, "service-env.json"),
  enrollment: join(state, "enrollment"),
  activation: join(state, "enrollment", "activation.json"),
  token: join(state, "enrollment", "transport.token"),
});

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as T;
}

// ── setup: claves ───────────────────────────────────────────────────────────

function generateKey(state: string, name: string): void {
  const p = paths(state);
  if (existsSync(p.key(name))) return;
  const pair = generateKeyPairSync("ed25519");
  writeFileSync(p.key(name), pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  writeFileSync(p.pub(name), pair.publicKey.export({ type: "spki", format: "pem" }));
}

function generateTls(state: string): void {
  const p = paths(state);
  if (existsSync(p.tlsCert)) return;
  const openssl = process.platform === "win32" && !commandExists("openssl")
    ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"
    : "openssl";
  const result = spawnSync(openssl, [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", p.tlsKey, "-out", p.tlsCert,
    "-subj", "/CN=localhost", "-days", "825",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  if (result.status !== 0) throw new Error(`openssl no pudo crear el certificado TLS de laboratorio:\n${result.stderr}`);
}

function commandExists(command: string): boolean {
  return spawnSync(process.platform === "win32" ? "where" : "which", [command], { encoding: "utf8" }).status === 0;
}

function writeSessionTrustBundle(state: string): void {
  const p = paths(state);
  if (existsSync(p.bundle)) return;
  const root = readFileSync(p.key("session-trust-root"));
  const validFrom = new Date(Date.now() - 3_600_000).toISOString();
  const keys = ([
    [KEY_IDS.sessionAssertion, "SESSION_ASSERTION", "ssa"],
    [KEY_IDS.authorizationSnapshot, "AUTHORIZATION_SNAPSHOT", "sas"],
  ] as const).map(([keyId, purpose, file]) => {
    const claims = SessionAssertionOperationalKeyClaimsSchema.parse({
      key_id: keyId, key_purpose: purpose, environment: TRUST_ENVIRONMENT,
      public_key_pem: readFileSync(p.pub(file), "utf8"), status: "ACTIVE",
      valid_from: validFrom, valid_until: null, version: 1,
    });
    return { claims, signature: sign(null, unsignedSessionAssertionOperationalKeyBytes(claims), { key: root, format: "pem" }).toString("base64url") };
  });
  writeJson(p.bundle, SessionAssertionTrustBundleSchema.parse({ version: 1, keys }));
}

function ensureKeys(state: string): LabSecrets {
  const p = paths(state);
  mkdirSync(p.keys, { recursive: true });
  mkdirSync(p.enrollment, { recursive: true });
  for (const name of ["device-trust-root", "device-trust-operational", "session-trust-root", "ssa", "sas"]) generateKey(state, name);
  generateTls(state);
  writeSessionTrustBundle(state);
  if (!existsSync(p.secrets)) {
    writeJson(p.secrets, { mfa_key: randomBytes(32).toString("base64url"), transport_token: randomBytes(32).toString("base64url") });
  }
  const secrets = readJson<LabSecrets>(p.secrets);
  writeFileSync(p.token, `${secrets.transport_token}\n`, { mode: 0o600 });
  return secrets;
}

// ── setup: base de datos ────────────────────────────────────────────────────

function withDatabase(url: string, name: string): string {
  const value = new URL(url);
  value.pathname = `/${name}`;
  return value.toString();
}

async function ensureDatabase(databaseUrl: string): Promise<void> {
  const target = new URL(databaseUrl).pathname.replace(/^\//, "");
  const admin = new pg.Client({ connectionString: withDatabase(databaseUrl, "postgres") });
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [target]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${target.replace(/"/g, "")}"`);
  } finally {
    await admin.end();
  }
}

async function migrate(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const applied = await client.query("SELECT to_regclass('identity.session_trust_sequence') AS sequence");
    if (applied.rows[0]?.sequence !== null) return;
  } finally {
    await client.end();
  }
  // 001 y 002 con sus runners (crean los roles y el libro); 004–006 como
  // `pos_schema_owner`, igual que las pruebas con PostgreSQL de `apps/api`.
  const script = `(async () => {
    const { readFile } = await import("node:fs/promises");
    const { default: pg } = await import("pg");
    const { applyPostgres001, applyPostgres002 } = await import("./src/postgres.js");
    const adminUrl = process.env.TARGET_URL;
    await applyPostgres001({ adminUrl });
    await applyPostgres002({ adminUrl, skipSmoke: true });
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    for (const file of ["sql/postgres/004_device_trust.up.sql", "sql/postgres/005_identity_login.up.sql", "sql/postgres/006_session_trust_sequence.up.sql"]) {
      await client.query("SET ROLE pos_schema_owner");
      await client.query(await readFile(file, "utf8"));
      await client.query("RESET ROLE");
    }
    await client.end();
  })().catch((error) => { console.error(error); process.exit(1); });`;
  const run = spawnSync(pnpm, ["--filter", "@pos-platform/target-migrations", "exec", "tsx", "--eval", script], {
    cwd: repoRoot, env: { ...process.env, TARGET_URL: databaseUrl }, encoding: "utf8", shell: process.platform === "win32",
  });
  if (run.status !== 0) throw new Error(`migraciones fallidas:\n${run.stderr}\n${run.stdout}`);
}

// ── setup: semilla ──────────────────────────────────────────────────────────

/**
 * Repartos de permisos **de ejemplo** de `dev-only/dev-role-presets.ts`, leídos
 * de su única fuente en vez de copiarlos: no son la política de `SEC-G03`, y
 * así el laboratorio no puede divergir de la revisión por rol.
 */
function samplePresets(): Record<"CAJERO" | "SUPERVISOR" | "ADMIN", string[]> {
  const run = spawnSync(pnpm, [
    "--filter", "@pos-platform/pos-local-service", "exec", "tsx", "--eval",
    "import('./src/dev-only/dev-role-presets.ts').then((m) => process.stdout.write(JSON.stringify(m.DEV_ROLE_PRESETS)))",
  ], { cwd: repoRoot, encoding: "utf8", shell: process.platform === "win32" });
  if (run.status !== 0) throw new Error(`no se pudieron leer los repartos de ejemplo:\n${run.stderr}`);
  const json = run.stdout.slice(run.stdout.indexOf("{"));
  return JSON.parse(json) as Record<"CAJERO" | "SUPERVISOR" | "ADMIN", string[]>;
}

const LAB_USERS = [
  { login: "cajero", name: "Cajero de laboratorio", preset: "CAJERO", role: "CASHIER", membership: "MEMBER", mfa: false },
  { login: "supervisor", name: "Supervisor de laboratorio", preset: "SUPERVISOR", role: "SUPERVISOR", membership: "MEMBER", mfa: false },
  { login: "admin", name: "Administrador de laboratorio", preset: "ADMIN", role: "GENERAL_ADMIN", membership: "ADMIN", mfa: true },
] as const;

function labPassword(): string {
  // 20 caracteres: por encima de los 15 de `A-5` para un solo factor.
  return randomBytes(15).toString("base64url");
}

async function seed(options: Options, secrets: LabSecrets): Promise<LabIdentity> {
  const p = paths(options.state);
  if (existsSync(p.identity)) return readJson<LabIdentity>(p.identity);

  const now = new Date();
  const identity: LabIdentity = {
    tenant_id: uuidV7(), company_id: uuidV7(), branch_id: uuidV7(), installation_id: uuidV7(), device_id: uuidV7(),
  };
  const presets = samplePresets();
  const client = new pg.Client({ connectionString: options.databaseUrl });
  await client.connect();
  const lines: string[] = [
    "USUARIOS DE LABORATORIO — sólo para este PC. No son cuentas reales.",
    `Generados: ${now.toISOString()}`,
    "",
  ];
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO tenancy.tenants (id,name,status,created_at,updated_at) VALUES ($1,'Comercio de laboratorio','ACTIVE',$2,$2)`, [identity.tenant_id, now]);
    await client.query(
      `INSERT INTO organization.companies (id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at) VALUES ($1,$2,'Tienda de laboratorio','America/Bogota','COP','ACTIVE',$3,$3)`,
      [identity.company_id, identity.tenant_id, now],
    );
    await client.query(
      `INSERT INTO organization.branches (id,tenant_id,company_id,name,timezone,status,created_at,updated_at) VALUES ($1,$2,$3,'Sede principal','America/Bogota','ACTIVE',$4,$4)`,
      [identity.branch_id, identity.tenant_id, identity.company_id, now],
    );

    const permissionIds = new Map<string, string>();
    for (const code of [...new Set(Object.values(presets).flat())].sort()) {
      const id = uuidV7();
      permissionIds.set(code, id);
      await client.query(
        `INSERT INTO "authorization".permissions (id,code,module,description,status,created_at) VALUES ($1,$2,$3,$4,'ACTIVE',$5)
         ON CONFLICT (code) DO NOTHING`,
        [id, code, code.split("_")[0], code, now],
      );
      const stored = await client.query<{ id: string }>(`SELECT id FROM "authorization".permissions WHERE code = $1`, [code]);
      permissionIds.set(code, stored.rows[0]!.id);
    }

    const cipher = new MfaSecretCipher(Buffer.from(secrets.mfa_key, "base64url"));
    for (const user of LAB_USERS) {
      const role = await client.query<{ id: string }>(`SELECT id FROM "authorization".roles WHERE code = $1 AND version = 1`, [user.role]);
      let roleId = role.rows[0]?.id;
      if (roleId === undefined) {
        roleId = uuidV7();
        await client.query(`INSERT INTO "authorization".roles (id,code,name,scope_type,version,status,created_at) VALUES ($1,$2,$2,'BUSINESS',1,'ACTIVE',$3)`, [roleId, user.role, now]);
        for (const code of presets[user.preset]) {
          await client.query(
            `INSERT INTO "authorization".role_permission_grants (id,role_id,permission_id,grant_version,status,valid_from,created_at) VALUES ($1,$2,$3,1,'ACTIVE',$4,$4)`,
            [uuidV7(), roleId, permissionIds.get(code), now],
          );
        }
      }

      const userId = uuidV7();
      const membershipId = uuidV7();
      const password = labPassword();
      await client.query(`INSERT INTO identity.users (id,full_name,status,created_at,updated_at) VALUES ($1,$2,'ACTIVE',$3,$3)`, [userId, user.name, now]);
      await client.query(
        `INSERT INTO tenancy.tenant_memberships (id,tenant_id,user_id,membership_type,status,created_by_actor_type,created_at,activated_at) VALUES ($1,$2,$3,$4,'ACTIVE','SYSTEM',$5,$5)`,
        [membershipId, identity.tenant_id, userId, user.membership, now],
      );
      await client.query(
        `INSERT INTO identity.user_login_names (id,tenant_id,tenant_membership_id,user_id,login_name,login_name_normalized,status,created_at) VALUES ($1,$2,$3,$4,$5,$5,'ACTIVE',$6)`,
        [uuidV7(), identity.tenant_id, membershipId, userId, user.login, now],
      );
      await client.query(
        `INSERT INTO identity.user_credentials (id,user_id,credential_type,verifier,status,failed_attempt_count,must_change_at_next_login,created_at) VALUES ($1,$2,'PASSWORD',$3,'ACTIVE',0,false,$4)`,
        [uuidV7(), userId, await hashPassword(password), now],
      );
      await client.query(
        `INSERT INTO "authorization".user_role_assignments (id,tenant_id,tenant_membership_id,role_id,status,valid_from,created_at,created_by_actor_type) VALUES ($1,$2,$3,$4,'ACTIVE',$5,$5,'SYSTEM')`,
        [uuidV7(), identity.tenant_id, membershipId, roleId, now],
      );
      lines.push(`Usuario: ${user.login}    Contraseña: ${password}    Rol: ${user.role}`);
      if (user.mfa) {
        const secret = generateTotpSecret();
        await client.query(
          `INSERT INTO identity.mfa_factors (id,user_id,factor_type,secret_reference,status,enrolled_at,verified_at) VALUES ($1,$2,'TOTP',$3,'ACTIVE',$4,$4)`,
          [uuidV7(), userId, cipher.encrypt(secret), now],
        );
        lines.push(`  Código TOTP (app autenticadora) — secreto: ${base32Encode(secret)}`);
        lines.push(`  URI: ${totpProvisioningUri({ secret, accountName: `${user.login}@laboratorio`, issuer: "Camacho POS Laboratorio" })}`);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  writeFileSync(p.users, `${lines.join("\n")}\n`, { mode: 0o600 });
  writeJson(p.identity, identity);
  return identity;
}

function writeServiceEnv(options: Options, identity: LabIdentity): void {
  const p = paths(options.state);
  writeJson(p.serviceEnv, {
    POS_TENANT_ID: identity.tenant_id,
    POS_COMPANY_ID: identity.company_id,
    POS_BRANCH_ID: identity.branch_id,
    POS_INSTALLATION_ID: identity.installation_id,
    POS_DEVICE_ID: identity.device_id,
    POS_CENTRAL_AUTH_URL: `https://localhost:${String(options.gatewayPort)}`,
    POS_DEVICE_ENROLLMENT_ACTIVATION_PATH: p.activation,
    POS_DEVICE_ENROLLMENT_TOKEN_PATH: p.token,
    POS_DEVICE_TRUST_ROOT_PUBLIC_KEY_PEM: readFileSync(p.pub("device-trust-root"), "utf8"),
    POS_DEVICE_TRUST_OPERATIONAL_KEY_ID: KEY_IDS.deviceTrustOperational,
    POS_DEVICE_TRUST_OPERATIONAL_PUBLIC_KEY_PEM: readFileSync(p.pub("device-trust-operational"), "utf8"),
    POS_SESSION_TRUST_ENVIRONMENT: TRUST_ENVIRONMENT,
    POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM: readFileSync(p.pub("session-trust-root"), "utf8"),
    POS_SESSION_TRUST_ARTIFACT_PATH: p.bundle,
    NODE_EXTRA_CA_CERTS: p.tlsCert,
  });
}

// ── registro del equipo ─────────────────────────────────────────────────────

interface DevicePublicIdentity {
  readonly tenant_id: string;
  readonly company_id: string;
  readonly installation_id: string;
  readonly device_id: string;
  readonly device_key_id: string;
  readonly device_public_key_pem: string;
}

/**
 * Registra el equipo con la clave pública que **él mismo** publicó y emite su
 * activación (`D-3`). Se niega si la identidad no es la de este laboratorio:
 * no se registra un equipo ajeno.
 */
async function registerDevice(options: Options, publicIdentityPath: string): Promise<"REGISTERED" | "ALREADY_REGISTERED"> {
  const p = paths(options.state);
  const identity = readJson<LabIdentity>(p.identity);
  const device = readJson<DevicePublicIdentity>(publicIdentityPath);
  for (const field of ["tenant_id", "company_id", "installation_id", "device_id"] as const) {
    if (device[field] !== identity[field]) {
      throw new Error(`la identidad pública del equipo no es la de este laboratorio (${field}: ${device[field]} ≠ ${identity[field]})`);
    }
  }
  const secrets = readJson<LabSecrets>(p.secrets);
  const client = new pg.Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    const existing = await client.query("SELECT 1 FROM identity.device_registry WHERE device_id = $1", [device.device_id]);
    if (existing.rowCount !== 0) return "ALREADY_REGISTERED";
    const now = new Date();
    const activationSecret = randomBytes(36).toString("base64url");
    const activationId = uuidV7();
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO identity.device_registry (device_id,installation_id,tenant_id,company_id,device_key_id,device_public_key,device_public_key_algorithm,status,trust_key_id,trust_key_purpose,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'Ed25519','PENDING',$7,'DEVICE_TRUST',$8,$8)`,
      [device.device_id, device.installation_id, device.tenant_id, device.company_id, device.device_key_id,
        Buffer.from(device.device_public_key_pem, "utf8"), KEY_IDS.deviceTrustOperational, now],
    );
    const expiresAt = new Date(now.getTime() + 24 * 3_600_000);
    await client.query(
      `INSERT INTO identity.device_enrollment_activations (activation_id,tenant_id,company_id,installation_id,device_id,activation_checksum,status,issued_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,'ISSUED',$7,$8)`,
      [activationId, device.tenant_id, device.company_id, device.installation_id, device.device_id, activationSecretChecksum(activationSecret), now, expiresAt],
    );
    await client.query("COMMIT");
    writeFileSync(p.token, `${secrets.transport_token}\n`, { mode: 0o600 });
    writeJson(p.activation, {
      activation_id: activationId, tenant_id: device.tenant_id, company_id: device.company_id,
      installation_id: device.installation_id, device_id: device.device_id, activation_secret: activationSecret,
      status: "ISSUED", issued_at: now.toISOString(), expires_at: expiresAt.toISOString(), version: 1,
    });
    return "REGISTERED";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

// ── serve ───────────────────────────────────────────────────────────────────

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ service: "lab-central", event, ...fields })}\n`);
}

function startProcess(name: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(pnpm, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[${name}] ${chunk.toString()}`));
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[${name}] ${chunk.toString()}`));
  child.on("exit", (code) => log("process.exit", { process: name, code }));
  return child;
}

function proxy(request: IncomingMessage, response: ServerResponse, target: { readonly secure: boolean; readonly port: number; readonly path: string; readonly ca?: Buffer }): void {
  const options = {
    host: "127.0.0.1", port: target.port, path: target.path, method: request.method,
    headers: { ...request.headers, host: `localhost:${String(target.port)}` },
    ...(target.secure ? { ca: target.ca, servername: "localhost" } : {}),
  };
  const upstream = (target.secure ? httpsRequest : httpRequest)(options, (answer) => {
    response.writeHead(answer.statusCode ?? 502, answer.headers);
    answer.pipe(response);
  });
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ result_code: "LAB_UPSTREAM_UNAVAILABLE", result: null }));
  });
  request.pipe(upstream);
}

async function serve(options: Options): Promise<void> {
  const p = paths(options.state);
  const secrets = readJson<LabSecrets>(p.secrets);
  const common = { CENTRAL_DATABASE_URL: options.databaseUrl };

  const api = startProcess("api", ["--filter", "@pos-platform/api", "exec", "tsx", "src/main.ts"], repoRoot, {
    ...common,
    API_PORT: String(options.apiPort),
    DEVICE_TRUST_ROOT_PUBLIC_KEY_PEM: readFileSync(p.pub("device-trust-root"), "utf8"),
    DEVICE_TRUST_OPERATIONAL_KEY_ID: KEY_IDS.deviceTrustOperational,
    DEVICE_TRUST_OPERATIONAL_PUBLIC_KEY_PEM: readFileSync(p.pub("device-trust-operational"), "utf8"),
    MFA_SECRET_ENCRYPTION_KEY_BASE64URL: secrets.mfa_key,
    MFA_TOTP_ISSUER: "Camacho POS Laboratorio",
    SESSION_ASSERTION_SIGNING_KEY_ID: KEY_IDS.sessionAssertion,
    SESSION_ASSERTION_SIGNING_KEY_FILE: p.key("ssa"),
    AUTHORIZATION_SNAPSHOT_SIGNING_KEY_ID: KEY_IDS.authorizationSnapshot,
    AUTHORIZATION_SNAPSHOT_SIGNING_KEY_FILE: p.key("sas"),
  });
  const authority = startProcess("authority", ["--filter", "@pos-platform/central-authority", "start"], repoRoot, {
    ...common,
    CENTRAL_AUTHORITY_PORT: String(options.authorityPort),
    D3_ENROLLMENT_TRANSPORT_TOKEN: secrets.transport_token,
    D3_ISSUER_PRIVATE_KEY_FILE: p.key("device-trust-operational"),
    // Un año: la renovación de credenciales de equipo no existe todavía, y con
    // las 24 h por defecto el laboratorio dejaría de iniciar sesión al día siguiente.
    D3_CREDENTIAL_LIFETIME_MS: String(365 * 24 * 3_600_000),
    CENTRAL_TLS_KEY_FILE: p.tlsKey,
    CENTRAL_TLS_CERT_FILE: p.tlsCert,
  });

  const ca = readFileSync(p.tlsCert);
  const gateway = createHttpsServer({ key: readFileSync(p.tlsKey), cert: ca, minVersion: "TLSv1.2" }, (request, response) => {
    const url = request.url ?? "/";
    if (url === "/health") return proxy(request, response, { secure: false, port: options.apiPort, path: "/v1/health" });
    if (url.startsWith("/v1/auth/")) return proxy(request, response, { secure: false, port: options.apiPort, path: url });
    if (url === "/v1/device-enrollment") return proxy(request, response, { secure: true, port: options.authorityPort, path: url, ca });
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ result_code: "NOT_FOUND", result: null }));
  });
  gateway.listen(options.gatewayPort, "127.0.0.1", () => log("gateway.listening", { port: options.gatewayPort }));

  let watcher: NodeJS.Timeout | undefined;
  if (options.watchDevice !== null) {
    const watched = options.watchDevice;
    const check = async (): Promise<void> => {
      if (!existsSync(watched)) return;
      try {
        const outcome = await registerDevice(options, watched);
        log("device.registered", { outcome });
        if (watcher !== undefined) clearInterval(watcher);
      } catch (error) {
        log("device.register_failed", { error: error instanceof Error ? error.message : String(error) });
      }
    };
    watcher = setInterval(() => { void check(); }, 2_000);
  }

  const stop = (): void => {
    if (watcher !== undefined) clearInterval(watcher);
    gateway.close();
    for (const child of [api, authority]) child.kill("SIGTERM");
    setTimeout(() => process.exit(0), 1_000).unref();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  log("serving", { api: options.apiPort, authority: options.authorityPort, gateway: options.gatewayPort });
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  mkdirSync(options.state, { recursive: true });
  if (options.command === "setup") {
    const secrets = ensureKeys(options.state);
    await ensureDatabase(options.databaseUrl);
    await migrate(options.databaseUrl);
    const identity = await seed(options, secrets);
    writeServiceEnv(options, identity);
    log("setup.done", { state: options.state, users: paths(options.state).users });
    return;
  }
  if (options.command === "serve") return serve(options);
  if (options.command === "register-device") {
    if (options.publicIdentity === null) throw new Error("register-device necesita --public-identity <fichero>");
    log("device.registered", { outcome: await registerDevice(options, options.publicIdentity) });
    return;
  }
  throw new Error(`comando desconocido: ${options.command}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

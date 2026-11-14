/**
 * Prepares an ISOLATED commercial design-review runtime:
 * persistent installation IDs, signed license-capacity provision (same V2
 * mechanism exercised by license-capacity tests), cash register projection,
 * and demo catalog rows via RegisterProductUseCase.
 *
 * Does NOT touch production data directories or bypass LicenseCapacityGate.
 * Lab / design-review only — not a BUSINESS Central issuance.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  LicenseCapacityClaimsSchema,
  type LicenseCapacityClaims,
} from "@pos-platform/contracts";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteCatalogStore } from "../src/catalog/sqlite-catalog-store.js";
import { RegisterProductUseCase } from "../src/catalog/register-product-use-case.js";
import { unsignedLicenseCapacityBytes } from "../src/security/license-verifier.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

const PROFILE = "CAMACHO_DESIGN_REVIEW_RUNTIME_V1";
const KEY_ID = "DESIGN_REVIEW_LICENSE";

type Installation = {
  readonly installation_id: string;
  readonly device_id: string;
  readonly tenant_id: string;
  readonly company_id: string;
  readonly branch_id: string;
  readonly register_id: string;
};

function fail(code: string): never {
  process.stderr.write(`${code}\n`);
  process.exit(1);
}

function requireAbsoluteRoot(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") fail("DESIGN_REVIEW_ROOT_REQUIRED");
  const root = resolve(raw.trim());
  if (!isAbsolute(root)) fail("DESIGN_REVIEW_ROOT_MUST_BE_ABSOLUTE");
  return root;
}

function writeExclusive(path: string, content: string): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeAtomic(path: string, content: string): void {
  const temporary = `${path}.tmp.${randomUUID()}`;
  writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    try { unlinkSync(path); } catch { /* first write */ }
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* keep original error */ }
    throw error;
  }
}

function loadOrCreateInstallation(path: string): Installation {
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Installation>;
    for (const key of ["installation_id", "device_id", "tenant_id", "company_id", "branch_id", "register_id"] as const) {
      if (typeof parsed[key] !== "string" || !/^[0-9a-f-]{36}$/i.test(parsed[key]!)) {
        fail("DESIGN_REVIEW_INSTALLATION_INVALID");
      }
    }
    return {
      installation_id: parsed.installation_id!.toLowerCase(),
      device_id: parsed.device_id!.toLowerCase(),
      tenant_id: parsed.tenant_id!.toLowerCase(),
      company_id: parsed.company_id!.toLowerCase(),
      branch_id: parsed.branch_id!.toLowerCase(),
      register_id: parsed.register_id!.toLowerCase(),
    };
  }
  const installation: Installation = {
    installation_id: randomUUID(),
    device_id: randomUUID(),
    tenant_id: randomUUID(),
    company_id: randomUUID(),
    branch_id: randomUUID(),
    register_id: randomUUID(),
  };
  writeExclusive(path, `${JSON.stringify({ profile: PROFILE, ...installation }, null, 2)}\n`);
  return installation;
}

function loadOrCreateKeyPair(directory: string): { publicPem: string; privatePem: string; spkiSha256: string } {
  const privatePath = join(directory, "license-signing.private.pem");
  const publicPath = join(directory, "license-signing.public.pem");
  if (existsSync(privatePath) && existsSync(publicPath)) {
    const privatePem = readFileSync(privatePath, "utf8");
    const publicPem = readFileSync(publicPath, "utf8");
    const publicKey = createPublicKey(publicPem);
    const spkiSha256 = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
    return { publicPem, privatePem, spkiSha256 };
  }
  const pair = generateKeyPairSync("ed25519");
  const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const spkiSha256 = createHash("sha256").update(pair.publicKey.export({ type: "spki", format: "der" })).digest("hex");
  writeExclusive(privatePath, privatePem);
  writeExclusive(publicPath, publicPem);
  return { publicPem, privatePem, spkiSha256 };
}

function buildProvision(
  installation: Installation,
  keys: { publicPem: string; privatePem: string; spkiSha256: string },
  licenseId: string,
  planId: string,
): unknown {
  const now = Date.now();
  const issued = new Date(now - 60_000).toISOString();
  const notBefore = new Date(now - 30_000).toISOString();
  // Long lab window so design review survives overnight without re-signing.
  const expires = new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString();
  const claims = LicenseCapacityClaimsSchema.parse({
    profile: "CAMACHO_LICENSE_CAPACITY_V2",
    license_id: licenseId,
    tenant_id: installation.tenant_id,
    company_id: installation.company_id,
    installation_id: installation.installation_id,
    device_id: installation.device_id,
    mode: "HYBRID",
    entitlements: ["CASH_REGISTER"],
    issued_at: issued,
    not_before: notBefore,
    expires_at: expires,
    offline_grace_until: null,
    key_id: KEY_ID,
    license_version: 1,
    plan_id: planId,
    plan_version: 1,
    cash_register_capacity: {
      included: 1,
      paid_additional: 0,
      allocations: [{ register_id: installation.register_id, branch_id: installation.branch_id }],
    },
  } satisfies LicenseCapacityClaims);
  const privateKey = createPrivateKey(keys.privatePem);
  const artifact = {
    claims,
    signature: sign(null, unsignedLicenseCapacityBytes(claims), privateKey).toString("base64url"),
  };
  return {
    profile: "CAMACHO_LICENSE_CAPACITY_PROVISION_V2",
    keys: [{
      key_id: KEY_ID,
      public_key_pem: keys.publicPem,
      spki_sha256: keys.spkiSha256,
      status: "ACTIVE",
    }],
    artifact,
  };
}

function ensureCashRegister(database: LocalDatabase, installation: Installation): void {
  const now = new Date().toISOString();
  database.native.prepare(
    `INSERT OR IGNORE INTO local_master_snapshot_artifact(
      snapshot_type, tenant_id, company_id, branch_id, sequence,
      environment, key_id, issued_at, claims_json, claims_checksum, signature, activated_at
    ) VALUES ('CASH_REGISTER',?,?,?,?,'SANDBOX','DESIGN_REVIEW',?,?,?,?,?)`,
  ).run(
    installation.tenant_id,
    installation.company_id,
    installation.branch_id,
    1,
    now,
    JSON.stringify({ sequence: 1, payload: [] }),
    "a".repeat(64),
    "design-review-master-sig",
    now,
  );
  database.native.prepare(
    `INSERT OR IGNORE INTO cash_register(
      id, tenant_id, company_id, branch_id,
      code, code_normalized, name, currency_code, status,
      created_at, retired_at, version, last_seen_sequence
    ) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,1,?)`,
  ).run(
    installation.register_id,
    installation.tenant_id,
    installation.company_id,
    installation.branch_id,
    "CAJA-DESIGN",
    "caja-design",
    "Caja diseño",
    "COP",
    "ACTIVE",
    now,
    1,
  );
}

function authSnapshot(installation: Installation): StoredAuthorizationSnapshot {
  const issued = new Date().toISOString();
  const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  return {
    claims: {
      snapshot_id: randomUUID(),
      user_id: randomUUID(),
      installation_id: installation.installation_id,
      device_id: installation.device_id,
      sequence: 1,
      issued_at: issued,
      expires_at: expires,
      key_id: "DESIGN_REVIEW_SEED",
      assignments: [{
        tenant_id: installation.tenant_id,
        company_id: installation.company_id,
        branch_id: installation.branch_id,
        status: "ACTIVE",
        role_status: "ACTIVE",
        valid_from: issued,
        valid_until: expires,
        permissions: [
          { code: "CATALOG_PRODUCT_REGISTER", status: "ACTIVE" },
          { code: "CATALOG_PRODUCT_READ", status: "ACTIVE" },
        ],
      }],
    },
    signature: "",
    activatedAt: issued,
  };
}

const DEMO_PRODUCTS = [
  {
    code: "ARZ-500",
    name: "Arroz",
    stockControlled: false,
    presentationName: "Bolsa 500g",
    unitCode: "UND",
    unitPrecision: 0,
    barcode: "7701234567890",
    priceAmount: "3500.000000",
    currencyCode: "COP",
  },
  {
    code: "CAF-250",
    name: "Café molido",
    stockControlled: false,
    presentationName: "Bolsa 250g",
    unitCode: "UND",
    unitPrecision: 0,
    barcode: "7701234567891",
    priceAmount: "12500.000000",
    currencyCode: "COP",
  },
  {
    code: "ACE-1000",
    name: "Aceite vegetal",
    stockControlled: false,
    presentationName: "Botella 1L",
    unitCode: "UND",
    unitPrecision: 0,
    barcode: "7701234567892",
    priceAmount: "9800.000000",
    currencyCode: "COP",
  },
  {
    code: "LEC-1000",
    name: "Leche entera",
    stockControlled: false,
    presentationName: "Caja 1L",
    unitCode: "UND",
    unitPrecision: 0,
    barcode: "7701234567893",
    priceAmount: "4200.000000",
    currencyCode: "COP",
  },
] as const;

function seedCatalog(database: LocalDatabase, installation: Installation): { seeded: number; skipped: number } {
  const scope: SyncScope = {
    tenantId: installation.tenant_id,
    companyId: installation.company_id,
    branchId: installation.branch_id,
    deviceId: installation.device_id,
    installationId: installation.installation_id,
  };
  const store = new SqliteCatalogStore(database, new DurableSyncStore(database));
  const register = new RegisterProductUseCase(store);
  const snapshot = authSnapshot(installation);
  const sessionId = randomUUID();
  let seeded = 0;
  let skipped = 0;
  for (const product of DEMO_PRODUCTS) {
    const existing = database.native.prepare(
      `SELECT 1 AS n FROM catalog_product WHERE tenant_id=? AND company_id=? AND code=? LIMIT 1`,
    ).get(installation.tenant_id, installation.company_id, product.code);
    if (existing) {
      skipped += 1;
      continue;
    }
    const result = register.execute(scope, sessionId, snapshot, {
      ...product,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
    });
    if (result.kind !== "REGISTERED" && result.kind !== "IDEMPOTENT") {
      fail(`DESIGN_REVIEW_CATALOG_SEED_FAILED:${product.code}:${result.kind}`);
    }
    seeded += 1;
  }
  return { seeded, skipped };
}

function main(): void {
  const args = process.argv.slice(2);
  let rootArg: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--root") rootArg = args[i + 1];
  }
  const root = requireAbsoluteRoot(rootArg);
  const dataDirectory = join(root, "data");
  const trustDirectory = join(root, "trust");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(trustDirectory, { recursive: true, mode: 0o700 });

  const markerPath = join(root, "DESIGN_REVIEW_ISOLATED.txt");
  if (!existsSync(markerPath)) {
    writeExclusive(
      markerPath,
      "Camacho POS design-review runtime. Isolated SQLite and lab license provision. Not production BUSINESS data.\n",
    );
  }

  const installationPath = join(root, "installation.json");
  const installation = loadOrCreateInstallation(installationPath);
  const keys = loadOrCreateKeyPair(trustDirectory);
  const idsPath = join(trustDirectory, "license-ids.json");
  let licenseId: string;
  let planId: string;
  if (existsSync(idsPath)) {
    const ids = JSON.parse(readFileSync(idsPath, "utf8")) as { license_id?: string; plan_id?: string };
    if (typeof ids.license_id !== "string" || typeof ids.plan_id !== "string") fail("DESIGN_REVIEW_LICENSE_IDS_INVALID");
    licenseId = ids.license_id.toLowerCase();
    planId = ids.plan_id.toLowerCase();
  } else {
    licenseId = randomUUID();
    planId = randomUUID();
    writeExclusive(idsPath, `${JSON.stringify({ license_id: licenseId, plan_id: planId }, null, 2)}\n`);
  }

  const provisionPath = join(trustDirectory, "license-capacity-provision.json");
  const provision = buildProvision(installation, keys, licenseId, planId);
  writeAtomic(provisionPath, `${JSON.stringify(provision, null, 2)}\n`);

  const database = LocalDatabase.open({ dataDirectory });
  try {
    ensureCashRegister(database, installation);
    const catalog = seedCatalog(database, installation);
    const summary = {
      profile: PROFILE,
      root,
      data_directory: dataDirectory,
      installation_path: installationPath,
      license_capacity_provision_file: provisionPath,
      register_id: installation.register_id,
      tenant_id: installation.tenant_id,
      company_id: installation.company_id,
      branch_id: installation.branch_id,
      installation_id: installation.installation_id,
      device_id: installation.device_id,
      catalog,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    database.close();
  }
}

main();

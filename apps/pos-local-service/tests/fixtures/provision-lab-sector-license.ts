/**
 * Lab-only signed capacity provision (CASH_REGISTER + three sectors).
 *
 * Modes:
 *   (default) write the signed CAMACHO_LICENSE_CAPACITY_PROVISION_V2 JSON only.
 *   --activate  open the existing LocalDatabase after the service has registered
 *               its real device identity, then LicenseCapacityGate.authorize
 *               (no registerInitialDeviceKey — that conflicts with service boot).
 */
import { createHash, createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  LicenseCapacityClaimsSchema,
  LicenseSectorEntitlement,
  type LicenseCapacityClaims,
} from "@pos-platform/contracts";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { LicenseCapacityGate, readLicenseCapacityProvision } from "../../src/security/license-capacity-gate.js";
import { unsignedLicenseCapacityBytes } from "../../src/security/license-verifier.js";

function fail(code: string): never {
  process.stderr.write(`${code}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const activateOnly = args.includes("--activate");
function flag(name: string): string {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) fail(`MISSING_${name}`);
  return args[i + 1]!;
}

const dataDirectory = resolve(flag("--data-directory"));
if (!isAbsolute(dataDirectory)) fail("DATA_DIRECTORY_MUST_BE_ABSOLUTE");
const tenantId = flag("--tenant-id");
const companyId = flag("--company-id");
const branchId = flag("--branch-id");
const installationId = flag("--installation-id");
const deviceId = flag("--device-id");
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });

const provisionPath = resolve(dataDirectory, "license-capacity-provision.json");
const metaPath = resolve(dataDirectory, "license-capacity-lab-meta.json");

if (!activateOnly) {
  const pair = generateKeyPairSync("ed25519");
  const keyId = "LAB_SECTOR_LICENSE";
  const registerId = randomUUID();
  const now = Date.now();
  const claims = LicenseCapacityClaimsSchema.parse({
    profile: "CAMACHO_LICENSE_CAPACITY_V2",
    license_id: randomUUID(),
    tenant_id: tenantId,
    company_id: companyId,
    installation_id: installationId,
    device_id: deviceId,
    mode: "HYBRID",
    entitlements: [
      "CASH_REGISTER",
      LicenseSectorEntitlement.SALSAMENTARIA,
      LicenseSectorEntitlement.FARMACIA,
      LicenseSectorEntitlement.PASTELERIA,
    ],
    issued_at: new Date(now - 60_000).toISOString(),
    not_before: new Date(now - 30_000).toISOString(),
    expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    offline_grace_until: null,
    key_id: keyId,
    license_version: 1,
    plan_id: randomUUID(),
    plan_version: 1,
    cash_register_capacity: {
      included: 1,
      paid_additional: 0,
      allocations: [{ register_id: registerId, branch_id: branchId }],
    },
  } satisfies LicenseCapacityClaims);

  const privateKey = createPrivateKey(pair.privateKey.export({ type: "pkcs8", format: "pem" }));
  const provision = {
    profile: "CAMACHO_LICENSE_CAPACITY_PROVISION_V2" as const,
    keys: [{
      key_id: keyId,
      public_key_pem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      spki_sha256: createHash("sha256").update(pair.publicKey.export({ type: "spki", format: "der" })).digest("hex"),
      status: "ACTIVE" as const,
    }],
    artifact: {
      claims,
      signature: sign(null, unsignedLicenseCapacityBytes(claims), privateKey).toString("base64url"),
    },
  };

  writeFileSync(provisionPath, `${JSON.stringify(provision, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(metaPath, `${JSON.stringify({ registerId, entitlements: claims.entitlements }, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: "write",
    provisionPath,
    registerId,
    entitlements: claims.entitlements,
  })}\n`);
  process.exit(0);
}

if (!existsSync(provisionPath) || !existsSync(metaPath)) fail("PROVISION_FILE_MISSING_RUN_WRITE_FIRST");
const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { registerId: string };
const database = LocalDatabase.open({ dataDirectory });
try {
  // Do NOT register a lab device key here — LocalSecurityComponent owns that.
  const gate = new LicenseCapacityGate(database, () => readLicenseCapacityProvision(provisionPath));
  const scope = { tenantId, companyId, branchId, deviceId, installationId };
  const denial = gate.authorize(scope, meta.registerId);
  if (denial) fail(`LICENSE_ACTIVATE_DENIED:${denial}`);
  const entitlements = gate.listEntitlements(scope);
  if (entitlements.length < 4) fail(`LICENSE_ENTITLEMENTS_INCOMPLETE:${entitlements.join(",")}`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: "activate",
    provisionPath,
    registerId: meta.registerId,
    entitlements,
  })}\n`);
} finally {
  database.close();
}
